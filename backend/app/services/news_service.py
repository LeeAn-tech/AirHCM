"""
BẢN TIN MÔI TRƯỜNG: tự động lấy tin từ RSS các báo, chỉ giữ tin về KHÔNG KHÍ - THỜI TIẾT - MÔI TRƯỜNG.

- Nguồn chuyên mục (thời tiết, môi trường): bài nào cũng đúng chủ đề, chỉ loại bài quá cũ.
- Nguồn chung (thời sự, khoa học, sức khỏe): chỉ giữ bài có từ khóa chủ đề trong TIÊU ĐỀ, hoặc
  có ít nhất 2 từ khóa khác nhau trong phần tóm tắt; loại các cụm dễ nhầm ("môi trường kinh doanh", "bão giá"...).
- Từ khóa so khớp theo NGUYÊN TỪ ("lũ" không khớp "lũy"; "bụi" không khớp "bụi đời").
- Các nguồn được tải song song; kết quả lưu đệm 15 phút để trang Bản tin mở nhanh.
"""
import concurrent.futures
import email.utils
import html
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Optional

VN_TZ = timezone(timedelta(hours=7))
MAX_AGE_DAYS = 45          # Bỏ tin cũ hơn (một số báo ngừng cập nhật chuyên mục RSS)
# Số bài tối đa mỗi nhóm (tin thời tiết ra hằng ngày, không để lấn át tin môi trường / bụi mịn)
CATEGORY_QUOTA = {"WEATHER": 14, "POLICY": 14, "PM25": 10}
CACHE_SECONDS = 15 * 60
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AirHCM-News/1.0"

SOURCES = [
    # Chuyên mục thời tiết / môi trường
    {"source": "Tuổi Trẻ · Thời tiết", "url": "https://tuoitre.vn/rss/thoi-tiet.rss", "badge_color": "#0284c7",
     "dedicated": "WEATHER"},
    {"source": "Tuổi Trẻ · Môi trường", "url": "https://tuoitre.vn/rss/moi-truong.rss", "badge_color": "#16a34a",
     "dedicated": "POLICY"},
    {"source": "Người Lao Động · Môi trường", "url": "https://nld.com.vn/rss/moi-truong.rss", "badge_color": "#0d9488",
     "dedicated": "POLICY"},
    # Chuyên mục chung: lọc theo từ khóa
    {"source": "VnExpress", "url": "https://vnexpress.net/rss/thoi-su.rss", "badge_color": "#7c2d12"},
    {"source": "Báo Tuổi Trẻ", "url": "https://tuoitre.vn/rss/thoi-su.rss", "badge_color": "#e11d48"},
    {"source": "Thanh Niên", "url": "https://thanhnien.vn/rss/thoi-su.rss", "badge_color": "#1d4ed8"},
    # Khoa học / Sức khỏe nhiều chủ đề khác: chỉ xét TIÊU ĐỀ
    {"source": "Tuổi Trẻ · Khoa học", "url": "https://tuoitre.vn/rss/khoa-hoc.rss", "badge_color": "#7c3aed",
     "title_only": True},
    {"source": "VnExpress · Sức khỏe", "url": "https://vnexpress.net/rss/suc-khoe.rss", "badge_color": "#be123c",
     "title_only": True},
]

AIR_TERMS = ["không khí", "bụi mịn", "bụi", "pm2.5", "pm 2.5", "pm10", "aqi", "ô nhiễm không khí", "chất lượng không khí",
             "khí thải", "khói bụi", "khẩu trang"]
WEATHER_TERMS = ["thời tiết", "khí tượng", "thủy văn", "nắng nóng", "nhiệt độ", "mưa", "mưa lớn", "bão", "áp thấp",
                 "không khí lạnh", "rét", "giá rét", "triều cường", "ngập", "lũ", "lụt", "hạn hán", "khô hạn",
                 "xâm nhập mặn", "el nino", "la nina", "dông", "giông", "lốc", "nồm", "độ c", "trời lạnh", "chuyển lạnh",
                 "trở lạnh", "lạnh giá", "gió mùa", "lũ quét", "sương mù",
                 "mùa đông", "mùa mưa", "mùa khô"]
ENV_TERMS = ["môi trường", "ô nhiễm", "rác", "rác thải", "nước thải", "xả thải", "chất thải", "biến đổi khí hậu",
             "khí hậu", "phát thải", "tín chỉ carbon", "trung hòa carbon", "net zero", "cây xanh", "trồng rừng",
             "phá rừng", "đa dạng sinh học", "năng lượng tái tạo", "điện mặt trời", "rác nhựa", "kênh rạch", "sinh thái",
             "động vật hoang dã", "nguồn nước", "ô nhiễm sông"]
# Cụm có chứa từ khóa nhưng không thuộc chủ đề
EXCLUDE_PHRASES = ["môi trường kinh doanh", "môi trường đầu tư", "môi trường làm việc", "môi trường giáo dục",
                   "môi trường học đường", "môi trường pháp lý", "môi trường số", "môi trường mạng", "môi trường quân đội",
                   "bão giá", "bão sale", "bão like", "bão mạng", "cơn bão dư luận", "bụi đời", "khí thế", "mưa bom",
                   "không khí tết", "không khí lễ hội", "không khí vui", "bầu không khí", "sốt rét", "rét run"]
FALLBACK_IMAGES = {
    "PM25": "https://images.unsplash.com/photo-1534088568595-a066f410bcda?auto=format&fit=crop&w=700&q=80",
    "WEATHER": "https://images.unsplash.com/photo-1501691223387-dd0500403074?auto=format&fit=crop&w=700&q=80",
    "POLICY": "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=700&q=80",
}
_MEDIA_NS = "{http://search.yahoo.com/mrss/}"


def _pattern(terms):
    # \w của Python nhận cả chữ có dấu tiếng Việt -> so khớp đúng nguyên từ
    return re.compile(r"(?<!\w)(" + "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True)) + r")(?!\w)")


_AIR = _pattern(AIR_TERMS)
_WEATHER = _pattern(WEATHER_TERMS)
_ANY = _pattern(AIR_TERMS + WEATHER_TERMS + ENV_TERMS)
_EXCLUDE = _pattern(EXCLUDE_PHRASES)


def _clean(text: str) -> str:
    """Bỏ thẻ HTML, giải mã ký tự (&iacute; ...), gộp khoảng trắng"""
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _normalize(text: str) -> str:
    return _EXCLUDE.sub(" ", text.lower())


def _image(item, description_raw: str) -> Optional[str]:
    """Ảnh bài báo: Tuổi Trẻ đặt trong <enclosure>, VnExpress có cả <img> trong mô tả, báo khác dùng <media:thumbnail>"""
    enc = item.find("enclosure")
    if enc is not None and enc.get("url") and (enc.get("type") or "image").startswith("image"):
        return enc.get("url").strip()
    for tag in ("thumbnail", "content"):
        media = item.find(_MEDIA_NS + tag)
        if media is not None and media.get("url"):
            return media.get("url").strip()
    m = re.search(r"""<img[^>]+src\s*=\s*["']([^"']+)["']""", description_raw or "", re.I)
    return m.group(1).strip() if m and m.group(1).startswith("http") else None


def _published(raw: str) -> Optional[datetime]:
    """Ngày đăng -> giờ Việt Nam. RFC 822 (VnExpress, Thanh Niên) hoặc kiểu Mỹ của Tuổi Trẻ ("11/19/2026 2:47:13 PM")"""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(raw)
        return (dt if dt.tzinfo else dt.replace(tzinfo=VN_TZ)).astimezone(VN_TZ)
    except (TypeError, ValueError, IndexError):
        pass
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return (dt if dt.tzinfo else dt.replace(tzinfo=VN_TZ)).astimezone(VN_TZ)
        except ValueError:
            continue
    return None


def is_relevant(title: str, summary: str, title_only: bool = False) -> bool:
    """Bài ở chuyên mục chung: từ khóa trong tiêu đề, hoặc >= 2 từ khóa khác nhau trong tóm tắt"""
    if _ANY.search(_normalize(title)):
        return True
    return not title_only and len(set(_ANY.findall(_normalize(summary)))) >= 2


def categorize(title: str, default: str = "POLICY") -> str:
    """PM25 = Bụi mịn & AQI | WEATHER = Khí quyển & Thời tiết | POLICY = Môi trường & Chính sách"""
    t = _normalize(title)
    if _AIR.search(t.replace("không khí lạnh", " ")):
        return "PM25"
    if _WEATHER.search(t):
        return "WEATHER"
    return default


def _fetch_source(src: dict, now: datetime) -> list:
    req = urllib.request.Request(src["url"], headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as res:
        root = ET.fromstring(res.read())
    out = []
    for item in root.findall("./channel/item"):
        title = _clean(item.findtext("title"))
        link = (item.findtext("link") or "").strip()
        description_raw = item.findtext("description") or ""
        summary = _clean(description_raw)
        if not title or not link.startswith("http"):
            continue
        published = _published(item.findtext("pubDate"))
        if published and now - published > timedelta(days=MAX_AGE_DAYS):
            continue
        dedicated = src.get("dedicated")
        if not dedicated and not is_relevant(title, summary, src.get("title_only", False)):
            continue
        cat = categorize(title, default=dedicated or "POLICY")
        out.append({
            "title": title,
            "link": link,
            "summary": summary[:220] + ("..." if len(summary) > 220 else ""),
            "source": src["source"],
            "badge_color": src["badge_color"],
            "pub_date": published.strftime("%d/%m/%Y • %H:%M") if published else "",
            "published_at": published.isoformat() if published else None,
            "image": _image(item, description_raw) or FALLBACK_IMAGES[cat],
            "category": cat,
        })
    return out


_cache = {"time": 0.0, "items": []}
_lock = threading.Lock()


def fetch_news(force: bool = False) -> list:
    """Tin mới nhất (đã lọc, bỏ trùng, sắp theo thời gian đăng). Lưu đệm CACHE_SECONDS."""
    with _lock:
        if not force and _cache["items"] and time.time() - _cache["time"] < CACHE_SECONDS:
            return list(_cache["items"])
        now = datetime.now(VN_TZ)
        items = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(SOURCES)) as pool:
            futures = {pool.submit(_fetch_source, s, now): s for s in SOURCES}
            for fut in concurrent.futures.as_completed(futures):
                try:
                    items.extend(fut.result())
                except Exception as e:
                    print(f"-> [Lỗi đọc RSS từ {futures[fut]['source']}]: {type(e).__name__}: {str(e)[:120]}")
        # Bỏ trùng: cùng đường dẫn, hoặc cùng tiêu đề (một bài đăng ở nhiều chuyên mục)
        seen, unique = set(), []
        for n in sorted(items, key=lambda n: n["published_at"] or "", reverse=True):
            key_title = re.sub(r"\W+", "", n["title"].lower())
            if n["link"] in seen or key_title in seen:
                continue
            seen.update({n["link"], key_title})
            unique.append(n)
        # Hạn mức theo nhóm, rồi sắp lại theo thời gian đăng
        taken = {}
        picked = []
        for n in unique:
            if taken.get(n["category"], 0) < CATEGORY_QUOTA.get(n["category"], 10):
                taken[n["category"]] = taken.get(n["category"], 0) + 1
                picked.append(n)
        unique = picked
        if unique:  # Mất mạng: giữ kết quả cũ thay vì trả danh sách rỗng
            _cache.update({"time": time.time(), "items": unique})
        return list(unique or _cache["items"])
