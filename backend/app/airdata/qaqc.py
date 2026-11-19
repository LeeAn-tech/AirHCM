"""
KIỂM SOÁT CHẤT LƯỢNG DỮ LIỆU (QA/QC)

Áp dụng cho chuỗi giờ (trạm, phường hoặc cấp TP):
  - Giá trị âm / vượt miền vật lý hợp lý            -> loại (cờ NEG, IMPL)
  - Đột biến (spike) theo bộ lọc Hampel trên chuỗi đã khử chu kỳ ngày (trung vị cùng giờ ±7 ngày):
        |r_t − median_t| > k · 1,4826 · MAD_t          -> CHỈ GẮN CỜ (SPIKE), không xóa: cực trị thật
                                                          (cháy, nghịch nhiệt) phải đối chứng trước khi loại
  - Chuỗi đứng (giá trị y hệt ≥ 6 giờ liên tiếp)      -> cờ FLAT (nghi lỗi thiết bị/truyền dữ liệu)
  - Thiếu dữ liệu: số giờ thiếu, đoạn thiếu dài nhất, số ngày đủ điều kiện TB 24 giờ (≥ 18/24 giờ)
Kết quả kèm tiêu chí nghiệm thu: ≥ 80% giờ có dữ liệu cho chuỗi đầu vào trọng yếu.
Với bộ dữ liệu đồng nhất, tổng hợp thêm cờ nguồn gốc co_hieu (nội suy CAMS, hệ số vệ tinh lấp, ...).
"""
import numpy as np
import pandas as pd

from app.airdata import config as C

FLAG_BITS = {1: "CAMS nội suy thời gian", 2: "Hệ số vệ tinh lấy theo ngày gần nhất/mặc định",
             4: "Khí tượng Open-Meteo (đã hiệu chỉnh)", 8: "Khí tượng nội suy IDW", 16: "Giờ dự báo (tương lai)"}


def hampel_flags(s: pd.Series, window: int = None, k: float = None) -> pd.Series:
    """Hampel trên chuỗi đã KHỬ CHU KỲ NGÀY: phần dư = x − trung vị cùng giờ của ±7 ngày;
    spike khi |phần dư − trung vị trượt| > k·1,4826·MAD (MAD tính trên cửa sổ 7 ngày, có sàn 5% mức nền).
    Tránh gắn cờ nhầm đỉnh O3 buổi trưa hay đỉnh NO2 giờ cao điểm (chu kỳ ngày thật)."""
    window = window or C.QC_SPIKE_WINDOW_H
    k = k or C.QC_SPIKE_K
    x = s.astype(float)
    prof = x.groupby(x.index.hour).transform(lambda g: g.rolling(15, center=True, min_periods=5).median())
    r = x - prof
    med = r.rolling(window, center=True, min_periods=window // 2).median()
    mad = (r - med).abs().rolling(168, center=True, min_periods=48).median()
    floor = 0.05 * prof.abs().fillna(x.abs().median()) + 1e-6
    return ((r - med).abs() > k * np.maximum(1.4826 * mad.fillna(0), floor)) & x.notna()


def flat_flags(s: pd.Series, hours: int = None) -> pd.Series:
    hours = hours or C.QC_FLAT_HOURS
    x = s.astype(float)
    same = x.diff().abs() < 1e-9
    grp = (~same).cumsum()
    run = same.groupby(grp).transform("sum") + 1
    return (run >= hours) & same.fillna(False) & x.notna() & (x != 0)


def longest_gap(mask_missing: pd.Series) -> int:
    if not mask_missing.any():
        return 0
    grp = (mask_missing != mask_missing.shift()).cumsum()
    runs = mask_missing.groupby(grp).sum()
    return int(runs.max())


NO_SPIKE_CHECK = ("wind_dir", "precipitation")   # biến vòng (hướng) / bản chất gián đoạn (mưa): không xét spike


def check_series(s: pd.Series, pollutant: str = None, expected_index: pd.DatetimeIndex = None,
                 spikes: bool = True) -> dict:
    """QA/QC một chuỗi giờ. Trả về thống kê và mặt nạ cờ."""
    x = s.astype(float).sort_index()
    if expected_index is not None:
        x = x.reindex(expected_index)
    elif len(x):
        x = x.reindex(pd.date_range(x.index.min(), x.index.max(), freq="h"))
    n = len(x)
    if n == 0:
        return {"n_expected": 0, "completeness": 0.0}
    missing = x.isna()
    neg = (x < 0) & x.notna()
    hi = C.QC_MAX_PLAUSIBLE.get(pollutant, np.inf)
    impl = (x > hi) & x.notna()
    clean = x.mask(neg | impl)
    spike = hampel_flags(clean) if spikes else pd.Series(False, index=x.index)
    flat = flat_flags(clean) if spikes else pd.Series(False, index=x.index)
    day = x.index.normalize()
    nvalid = clean.notna().groupby(day).sum()
    valid_days = int((nvalid >= C.QC_MIN_HOURS_24H).sum())
    comp = float(1 - missing.mean())
    return {
        "n_expected": int(n), "n_present": int((~missing).sum()), "completeness": round(comp, 4),
        "missing_hours": int(missing.sum()), "longest_gap_h": longest_gap(missing),
        "negative": int(neg.sum()), "implausible": int(impl.sum()), "spikes": int(spike.sum()),
        "flat_hours": int(flat.sum()), "days": int(len(nvalid)), "valid_24h_days": valid_days,
        "valid_24h_ratio": round(valid_days / max(len(nvalid), 1), 4),
        "pass_completeness": comp >= C.QC_COMPLETENESS_TARGET,
        "_mask": pd.DataFrame({"missing": missing, "negative": neg, "implausible": impl, "spike": spike, "flat": flat}),
    }


def clean_series(s: pd.Series, pollutant: str = None) -> pd.Series:
    """Loại giá trị âm/ngoài miền vật lý; giữ spike (chỉ gắn cờ)."""
    x = s.astype(float)
    hi = C.QC_MAX_PLAUSIBLE.get(pollutant, np.inf)
    return x.mask((x < 0) | (x > hi))


def flag_summary(co_hieu: pd.Series) -> list:
    v = pd.to_numeric(co_hieu, errors="coerce").fillna(0).astype(int)
    n = max(len(v), 1)
    return [{"bit": b, "label": lab, "share": round(float(((v & b) > 0).sum()) / n, 4)} for b, lab in FLAG_BITS.items()]


def report(city: pd.DataFrame, ward: pd.DataFrame = None, pollutants=None, now=None) -> dict:
    """Báo cáo QA/QC: chuỗi cấp TP (đầu vào huấn luyện) + độ phủ theo phường (nếu có)."""
    pollutants = pollutants or [p for p in C.POLLUTANTS if p in city.columns]
    df = city.copy()
    if "thoi_gian" in df.columns:
        df["thoi_gian"] = pd.to_datetime(df["thoi_gian"])
        df = df.drop_duplicates("thoi_gian").set_index("thoi_gian").sort_index()
    if now is not None:
        df = df[df.index <= pd.Timestamp(now)]
    out = {"period": [str(df.index.min()), str(df.index.max())] if len(df) else None, "city": {}, "wards": {},
           "rules": {"min_hours_24h": C.QC_MIN_HOURS_24H, "spike": f"Hampel {C.QC_SPIKE_WINDOW_H}h, k={C.QC_SPIKE_K}",
                     "flat_hours": C.QC_FLAT_HOURS, "completeness_target": C.QC_COMPLETENESS_TARGET}}
    if df.empty:
        return out
    idx = pd.date_range(df.index.min(), df.index.max(), freq="h")
    for p in pollutants + [k for k in ("temperature_2m", "wind_speed", "wind_dir", "precipitation") if k in df.columns]:
        if p not in df.columns:
            continue
        r = check_series(df[p], p if p in C.POLLUTANTS else None, idx, spikes=p not in NO_SPIKE_CHECK)
        r.pop("_mask", None)
        out["city"][p] = r
    if ward is not None and not ward.empty:
        w = ward.copy()
        w["thoi_gian"] = pd.to_datetime(w["thoi_gian"])
        if now is not None:
            w = w[w["thoi_gian"] <= pd.Timestamp(now)]
        n_hours = max(len(pd.date_range(w["thoi_gian"].min(), w["thoi_gian"].max(), freq="h")), 1)
        for p in pollutants:
            if p not in w.columns:
                continue
            cnt = w.groupby("ma_phuong_xa")[p].count() / n_hours
            out["wards"][p] = {"n_wards": int(cnt.size), "mean_completeness": round(float(cnt.mean()), 4),
                               "min_completeness": round(float(cnt.min()), 4),
                               "wards_below_target": int((cnt < C.QC_COMPLETENESS_TARGET).sum()),
                               "worst": [{"ma_phuong_xa": str(k), "completeness": round(float(v), 4)}
                                         for k, v in cnt.sort_values().head(5).items()]}
        if "co_hieu" in w.columns:
            out["provenance_flags"] = flag_summary(w["co_hieu"])
    key = [p for p in ("pm2_5", "pm10", "no2", "o3", "temperature_2m", "wind_speed") if p in out["city"]]
    out["acceptance"] = {
        "criterion": f"≥ {int(C.QC_COMPLETENESS_TARGET * 100)}% giờ có dữ liệu cho chuỗi đầu vào trọng yếu",
        "series": {p: out["city"][p]["completeness"] for p in key},
        "pass": all(out["city"][p]["pass_completeness"] for p in key) if key else False,
    }
    return out
