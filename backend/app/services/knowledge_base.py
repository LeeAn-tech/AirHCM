"""
RAG – Kho tri thức AirHCM cho Trợ lý AI.

Tài liệu Markdown trong backend/knowledge/ (QCVN 05:2023, VN_AQI 1459, WHO 2021, US EPA, hướng dẫn
bảo vệ sức khỏe, đặc điểm ô nhiễm TP.HCM, hướng dẫn AirHCM) được cắt theo mục "## ".
Truy xuất lai (hybrid):
  - BM25 trên từ khóa tiếng Việt đã bỏ dấu + cụm 2 từ: chạy offline, luôn sẵn sàng.
  - Vector embedding Gemini (tìm kiếm ngữ nghĩa): embedding tài liệu được cache ra đĩa, mỗi câu hỏi
    chỉ tốn 1 lần gọi embedding. Mất mạng / hết hạn mức -> tự lùi về BM25.
Hai bảng xếp hạng được gộp bằng Reciprocal Rank Fusion (RRF).
"""
import hashlib
import json
import math
import os
import re
import threading
import time
import unicodedata
from collections import Counter

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KNOWLEDGE_DIR = os.path.join(BACKEND_DIR, "knowledge")
CACHE_FILE = os.path.join(KNOWLEDGE_DIR, ".embeddings_cache.json")

EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "models/gemini-embedding-2")
EMBED_DIM = 768
EMBED_TIMEOUT = float(os.getenv("GEMINI_EMBED_TIMEOUT_SECONDS", "8"))
# Ngưỡng liên quan (hiệu chỉnh với gemini-embedding-2: câu lạc đề ~0.60, câu đúng chủ đề 0.65-0.86).
# Một đoạn được giữ khi đủ gần về ngữ nghĩa HOẶC khớp từ khóa đủ mạnh.
SEMANTIC_MIN_SIM = 0.66
BM25_MIN = 6.0
RRF_K = 60

# Hư từ tiếng Việt (đã bỏ dấu) ít mang nghĩa khi tìm kiếm
_STOPWORDS = {
    "la", "va", "cua", "cac", "nhung", "mot", "cho", "de", "thi", "voi", "nay", "duoc", "tu",
    "toi", "ban", "hay", "nhu", "gi", "nhieu", "a", "oi", "nhe", "ah", "ha", "vay", "minh",
}

_lock = threading.Lock()
_chunks = []            # [{id, doc, title, section, source, text, tokens}]
_bm25 = None            # {"df": Counter, "avgdl": float, "tf": [Counter], "len": [int]}
_doc_vectors = None     # list[list[float]] cùng thứ tự _chunks (đã chuẩn hóa)
_semantic_off_until = 0.0


def _strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.replace("đ", "d").replace("Đ", "D")


def tokenize(text: str) -> list:
    t = _strip_accents((text or "").lower())
    t = re.sub(r"pm\s*2[.,]?\s*5", " pm25 ", t)
    t = re.sub(r"pm\s*10", " pm10 ", t)
    words = [w for w in re.findall(r"[a-z0-9]+", t) if w not in _STOPWORDS]
    return words + [f"{a}_{b}" for a, b in zip(words, words[1:])]


def _load_chunks():
    """Đọc & cắt tài liệu theo mục '## ' (gọi một lần)"""
    global _chunks, _bm25
    chunks = []
    if os.path.isdir(KNOWLEDGE_DIR):
        for name in sorted(os.listdir(KNOWLEDGE_DIR)):
            if not name.endswith(".md"):
                continue
            with open(os.path.join(KNOWLEDGE_DIR, name), encoding="utf-8") as f:
                raw = f.read()
            title = re.search(r"^#\s+(.+)$", raw, re.M)
            source = re.search(r"^Nguồn:\s*(.+)$", raw, re.M)
            for part in re.split(r"^##\s+", raw, flags=re.M)[1:]:
                heading, _, body = part.partition("\n")
                body = " ".join(body.split())
                if not body:
                    continue
                chunk = {
                    "id": f"{name[:-3]}#{len(chunks)}",
                    "doc": name[:-3],
                    "title": title.group(1).strip() if title else name[:-3],
                    "section": heading.strip(),
                    "source": source.group(1).strip() if source else "",
                    "text": body,
                }
                # Tiêu đề mục được nhân đôi trọng số khi tìm theo từ khóa
                chunk["tokens"] = tokenize(f"{chunk['title']} {chunk['section']} {chunk['section']} {body}")
                chunks.append(chunk)

    df = Counter()
    tfs, lens = [], []
    for c in chunks:
        tf = Counter(c["tokens"])
        tfs.append(tf)
        lens.append(len(c["tokens"]))
        df.update(tf.keys())
    _chunks = chunks
    _bm25 = {"df": df, "tf": tfs, "len": lens, "avgdl": (sum(lens) / len(lens)) if lens else 1.0}
    print(f"-> [Kho tri thức RAG] Đã nạp {len(chunks)} đoạn từ {len({c['doc'] for c in chunks})} tài liệu.")


def _bm25_scores(query_tokens: list) -> list:
    k1, b = 1.5, 0.75
    n = len(_chunks)
    scores = []
    for i in range(n):
        tf, dl = _bm25["tf"][i], _bm25["len"][i]
        s = 0.0
        for q in set(query_tokens):
            f = tf.get(q)
            if not f:
                continue
            df = _bm25["df"][q]
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / _bm25["avgdl"]))
        scores.append(s)
    return scores


# ------------------------------------------------------------------------------
# EMBEDDING NGỮ NGHĨA (GEMINI)
# ------------------------------------------------------------------------------
def _genai():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    import google.generativeai as genai  # đã được cấu hình trong dss_service
    return genai


def _normalize(v):
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def _text_hash(text: str) -> str:
    return hashlib.sha1(f"{EMBED_MODEL}|{EMBED_DIM}|{text}".encode("utf-8")).hexdigest()


def _ensure_doc_vectors() -> bool:
    """Embedding cho mọi đoạn tài liệu (đọc cache trên đĩa, chỉ gọi API cho đoạn mới)"""
    global _doc_vectors, _semantic_off_until
    if _doc_vectors is not None:
        return True
    if time.time() < _semantic_off_until:
        return False
    genai = _genai()
    if genai is None or not _chunks:
        return False

    cache = {}
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, encoding="utf-8") as f:
                cache = json.load(f)
    except Exception:
        cache = {}

    texts = [f"{c['title']} – {c['section']}. {c['text']}" for c in _chunks]
    hashes = [_text_hash(t) for t in texts]
    missing = [i for i, h in enumerate(hashes) if h not in cache]
    try:
        for start in range(0, len(missing), 50):
            batch = missing[start:start + 50]
            res = genai.embed_content(
                model=EMBED_MODEL,
                content=[texts[i] for i in batch],
                task_type="retrieval_document",
                output_dimensionality=EMBED_DIM,
                request_options={"timeout": 30},
            )
            for i, vec in zip(batch, res["embedding"]):
                cache[hashes[i]] = [round(x, 6) for x in vec]
        if missing:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({h: cache[h] for h in hashes}, f)
        _doc_vectors = [_normalize(cache[h]) for h in hashes]
        print(f"-> [Kho tri thức RAG] Embedding ngữ nghĩa sẵn sàng ({EMBED_MODEL}, {len(missing)} đoạn mới).")
        return True
    except Exception as e:
        _semantic_off_until = time.time() + 600
        print(f"-> [Kho tri thức RAG] Tạm dùng BM25 (embedding lỗi: {type(e).__name__}: {str(e)[:120]})")
        return False


def _query_vector(query: str):
    global _semantic_off_until
    genai = _genai()
    if genai is None:
        return None
    try:
        res = genai.embed_content(
            model=EMBED_MODEL,
            content=query,
            task_type="retrieval_query",
            output_dimensionality=EMBED_DIM,
            request_options={"timeout": EMBED_TIMEOUT},
        )
        return _normalize(res["embedding"])
    except Exception as e:
        _semantic_off_until = time.time() + 120
        print(f"-> [Kho tri thức RAG] Không embedding được câu hỏi ({type(e).__name__}), dùng BM25.")
        return None


# ------------------------------------------------------------------------------
# API CÔNG KHAI
# ------------------------------------------------------------------------------
def warm_up():
    """Gọi khi backend khởi động (luồng nền) để câu hỏi đầu tiên không phải chờ"""
    with _lock:
        if not _chunks:
            _load_chunks()
        _ensure_doc_vectors()


def search(query: str, k: int = 3) -> dict:
    """Trả về {'passages': [...], 'method': 'hybrid'|'bm25'} - mỗi đoạn có số thứ tự trích dẫn"""
    with _lock:
        if not _chunks:
            _load_chunks()
        semantic_ready = _ensure_doc_vectors()
    if not _chunks or not (query or "").strip():
        return {"passages": [], "method": "none"}

    bm25 = _bm25_scores(tokenize(query))
    qv = _query_vector(query) if semantic_ready else None
    sims = [sum(a * b for a, b in zip(qv, dv)) for dv in _doc_vectors] if qv is not None else None
    method = "hybrid" if sims is not None else "bm25"

    # Lọc đoạn liên quan rồi gộp 2 bảng xếp hạng (từ khóa + ngữ nghĩa) bằng RRF
    keep = [i for i in range(len(_chunks))
            if bm25[i] >= BM25_MIN or (sims is not None and sims[i] >= SEMANTIC_MIN_SIM)]
    candidates = {i: 0.0 for i in keep}
    for rank, i in enumerate(sorted((i for i in keep if bm25[i] > 0), key=lambda j: -bm25[j])):
        candidates[i] += 1.0 / (RRF_K + rank + 1)
    if sims is not None:
        for rank, i in enumerate(sorted(keep, key=lambda j: -sims[j])):
            candidates[i] += 1.0 / (RRF_K + rank + 1)

    ranked = sorted(candidates, key=lambda j: -candidates[j])[:k]
    passages = []
    for n, i in enumerate(ranked, start=1):
        c = _chunks[i]
        passages.append({
            "ref": n,
            "title": c["title"],
            "section": c["section"],
            "source": c["source"],
            "text": c["text"],
            "score": round(candidates[i] * 1000, 2),
        })
    return {"passages": passages, "method": method}


def stats() -> dict:
    with _lock:
        if not _chunks:
            _load_chunks()
    return {
        "documents": len({c["doc"] for c in _chunks}),
        "chunks": len(_chunks),
        "semantic": _doc_vectors is not None,
        "embed_model": EMBED_MODEL,
    }
