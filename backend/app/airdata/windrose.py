"""
GIÓ, HOA GIÓ VÀ HOA GIÓ Ô NHIỄM (POLLUTION ROSE, CBPF)

Quy ước khí tượng: U > 0 không khí chuyển động về hướng Đông; V > 0 về hướng Bắc.
Hướng gió WD là hướng gió THỔI TỪ ĐÂU, Bắc = 0°, Đông = 90°:
    WS = sqrt(U² + V²);   WD = (degrees(atan2(−U, −V)) + 360) mod 360
    Ví dụ U = −2, V = −1 -> WS = 2,236 m/s; WD = 63,4° (gió đến từ Đông Bắc).

Với K hướng (8 hoặc 16), lớp lặng gió tách riêng (WS < CALM_WS):
    F_k    = n_k / N × 100%                         tần suất gió theo hướng (N gồm cả giờ lặng gió)
    C̄_k   = Σ C_t (WD_t ∈ k) / n_k                  nồng độ trung bình theo hướng
    P_k    = #{C_t > T, WD_t ∈ k} / n_k             xác suất vượt ngưỡng CÓ ĐIỀU KIỆN theo hướng
    CBPF   = #{C_t > T, WD_t ∈ k, WS_t ∈ lớp v} / n_{k,v}   (hướng × tốc độ gió)
F_k (gió thổi từ đâu nhiều) và P_k (từ hướng nào hay ô nhiễm) là HAI đại lượng khác nhau. Hướng có ít bản ghi
(n_k < ROSE_MIN_COUNT) được gắn cờ, không dùng để kết luận. Hoa gió ô nhiễm mô tả quan hệ THỐNG KÊ,
không xác nhận một cơ sở phát thải cụ thể.
"""
import numpy as np
import pandas as pd

from app.airdata import config as C

NAMES_8 = ["B", "ĐB", "Đ", "ĐN", "N", "TN", "T", "TB"]
NAMES_16 = ["B", "BĐB", "ĐB", "ĐĐB", "Đ", "ĐĐN", "ĐN", "NĐN", "N", "NTN", "TN", "TTN", "T", "TTB", "TB", "BTB"]
FULL_8 = ["Bắc", "Đông Bắc", "Đông", "Đông Nam", "Nam", "Tây Nam", "Tây", "Tây Bắc"]


def uv_to_wswd(u, v):
    u = np.asarray(u, dtype=float)
    v = np.asarray(v, dtype=float)
    ws = np.hypot(u, v)
    wd = (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0
    return ws, wd


def wswd_to_uv(ws, wd):
    """Thành phần u, v của chuyển động không khí (gió thổi TỚI) từ WS, WD (thổi TỪ)."""
    rad = np.radians(np.asarray(wd, dtype=float))
    ws = np.asarray(ws, dtype=float)
    return -ws * np.sin(rad), -ws * np.cos(rad)


def sector_index(wd, n_sectors: int = 8) -> np.ndarray:
    width = 360.0 / n_sectors
    wd = np.asarray(wd, dtype=float)
    idx = np.floor(((wd + width / 2.0) % 360.0) / width)
    return np.where(np.isfinite(wd), idx, -1).astype(int)


def sector_names(n_sectors: int):
    return NAMES_16 if n_sectors == 16 else NAMES_8 if n_sectors == 8 else [f"{i * 360 / n_sectors:.0f}°" for i in range(n_sectors)]


def _speed_labels(bins):
    edges = list(bins) + [np.inf]
    labels = []
    for a, b in zip(edges[:-1], edges[1:]):
        labels.append(f"{a:g}-{b:g} m/s" if np.isfinite(b) else f"≥ {a:g} m/s")
    return labels


def rose(ws, wd, conc=None, threshold: float = None, n_sectors: int = 8, calm: float = None,
         speed_bins=None, min_count: int = None) -> dict:
    """Hoa gió (+ hoa gió ô nhiễm nếu có nồng độ). Đầu vào là mảng theo giờ cùng độ dài."""
    calm = C.CALM_WS if calm is None else calm
    speed_bins = speed_bins or C.WIND_SPEED_BINS
    min_count = min_count or C.ROSE_MIN_COUNT
    ws = np.asarray(ws, dtype=float)
    wd = np.asarray(wd, dtype=float)
    c = np.asarray(conc, dtype=float) if conc is not None else np.full(len(ws), np.nan)
    ok = np.isfinite(ws) & np.isfinite(wd)
    if conc is not None:
        ok &= np.isfinite(c)
    ws, wd, c = ws[ok], wd[ok], c[ok]
    N = int(len(ws))
    res = {"n_total": N, "n_sectors": n_sectors, "calm_threshold": calm, "threshold": threshold,
           "speed_classes": _speed_labels(speed_bins), "sectors": [], "calm": None}
    if N == 0:
        return res
    is_calm = ws < calm
    sec = sector_index(wd, n_sectors)
    edges = list(speed_bins) + [np.inf]
    names = sector_names(n_sectors)
    has_c = conc is not None
    exceed = (c > threshold) if (has_c and threshold is not None) else None
    for k in range(n_sectors):
        m = (sec == k) & ~is_calm
        n_k = int(m.sum())
        rec = {"k": k, "name": names[k], "center_deg": k * 360.0 / n_sectors, "n": n_k,
               "freq_pct": round(100.0 * n_k / N, 2), "low_count": n_k < min_count,
               "by_speed_pct": [round(100.0 * float((m & (ws >= a) & (ws < b)).sum()) / N, 2)
                                for a, b in zip(edges[:-1], edges[1:])]}
        if has_c and n_k:
            ck = c[m]
            rec.update({"mean": round(float(ck.mean()), 2), "median": round(float(np.median(ck)), 2),
                        "p90": round(float(np.percentile(ck, 90)), 2)})
            if exceed is not None:
                rec["p_exceed"] = round(float(exceed[m].mean()), 4)
                rec["n_exceed"] = int(exceed[m].sum())
                cb = []
                for a, b in zip(edges[:-1], edges[1:]):
                    mv = m & (ws >= a) & (ws < b)
                    nv = int(mv.sum())
                    cb.append({"n": nv, "p": round(float(exceed[mv].mean()), 4) if nv else None,
                               "low_count": nv < max(5, min_count // 3)})
                rec["cbpf"] = cb
        res["sectors"].append(rec)
    n_c = int(is_calm.sum())
    calm_rec = {"n": n_c, "freq_pct": round(100.0 * n_c / N, 2)}
    if has_c and n_c:
        calm_rec.update({"mean": round(float(c[is_calm].mean()), 2), "median": round(float(np.median(c[is_calm])), 2)})
        if exceed is not None:
            calm_rec["p_exceed"] = round(float(exceed[is_calm].mean()), 4)
    res["calm"] = calm_rec
    if has_c:
        res["overall_mean"] = round(float(c.mean()), 2)
        if exceed is not None:
            res["overall_p_exceed"] = round(float(exceed.mean()), 4)
        # Nồng độ trung bình theo lớp tốc độ gió (kể cả lặng gió) -> vai trò pha loãng
        cls = [("lặng gió", is_calm)] + [(lab, ~is_calm & (ws >= a) & (ws < b))
                                         for lab, a, b in zip(_speed_labels(speed_bins), edges[:-1], edges[1:])]
        res["by_speed_class"] = [{"class": lab, "n": int(m.sum()),
                                  "mean": round(float(c[m].mean()), 2) if m.any() else None,
                                  "p_exceed": (round(float(exceed[m].mean()), 4) if (exceed is not None and m.any()) else None)}
                                 for lab, m in cls]
        valid = [s for s in res["sectors"] if not s["low_count"] and s.get("p_exceed") is not None]
        if valid:
            top = max(valid, key=lambda s: s["p_exceed"])
            res["dominant_pollution_sector"] = {"name": top["name"], "p_exceed": top["p_exceed"], "n": top["n"]}
        top_f = max(res["sectors"], key=lambda s: s["freq_pct"])
        res["dominant_wind_sector"] = {"name": top_f["name"], "freq_pct": top_f["freq_pct"]}
    return res


def calm_sensitivity(ws, wd, conc=None, threshold=None, n_sectors=8, thresholds=None) -> list:
    """Độ nhạy theo ngưỡng lặng gió: tỷ lệ lặng gió và hướng ô nhiễm trội có đổi không."""
    out = []
    for t in thresholds or C.CALM_SENSITIVITY:
        r = rose(ws, wd, conc, threshold, n_sectors, calm=t)
        out.append({"calm_ws": t, "calm_pct": r["calm"]["freq_pct"] if r["calm"] else None,
                    "dominant_pollution_sector": (r.get("dominant_pollution_sector") or {}).get("name"),
                    "dominant_wind_sector": (r.get("dominant_wind_sector") or {}).get("name")})
    return out


def rose_from_frame(df: pd.DataFrame, pollutant: str = None, threshold: float = None, n_sectors: int = 8,
                    calm: float = None) -> dict:
    """df có cột wind_speed (m/s), wind_dir (độ, thổi từ) và (tùy chọn) cột chất ô nhiễm."""
    conc = df[pollutant].to_numpy(dtype=float) if pollutant and pollutant in df.columns else None
    if threshold is None and pollutant:
        threshold = C.ROSE_DEFAULT_T.get(pollutant)
    r = rose(df["wind_speed"].to_numpy(dtype=float), df["wind_dir"].to_numpy(dtype=float), conc, threshold,
             n_sectors, calm)
    r["pollutant"] = pollutant
    r["sensitivity"] = calm_sensitivity(df["wind_speed"].to_numpy(dtype=float), df["wind_dir"].to_numpy(dtype=float),
                                        conc, threshold, n_sectors)
    r["note"] = ("P_k là xác suất vượt ngưỡng có điều kiện theo hướng gió (không phải ngưỡng QCVN trừ khi chọn); "
                 "hướng có ít bản ghi được gắn cờ; hoa gió ô nhiễm chỉ mô tả quan hệ thống kê.")
    return r


def bearing_deg(lat1, lon1, lat2, lon2):
    """Phương vị (độ, Bắc = 0) từ điểm 1 tới điểm 2 (gần đúng phẳng, đủ cho phạm vi đô thị)."""
    dy = (np.asarray(lat2, float) - lat1) * 111.32
    dx = (np.asarray(lon2, float) - lon1) * 111.32 * np.cos(np.radians(lat1))
    return (np.degrees(np.arctan2(dx, dy)) + 360.0) % 360.0


def distance_km(lat1, lon1, lat2, lon2):
    dy = (np.asarray(lat2, float) - lat1) * 111.32
    dx = (np.asarray(lon2, float) - lon1) * 111.32 * np.cos(np.radians(lat1))
    return np.hypot(dx, dy)
