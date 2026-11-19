"""
XU HƯỚNG THEO THÁNG (DỰ BÁO DÀI HẠN, THAM KHẢO)

Với ~4 năm dữ liệu (08/2022 -> nay), dự báo giờ cụ thể quá 7-8 ngày không còn kỹ năng; thay vào đó
hệ thống ước lượng TRUNG BÌNH THÁNG cho tháng hiện tại và các tháng kế tiếp bằng mô hình thống kê:

    ŷ(m+k) = Khí_hậu(tháng) + Xu_thế(m+k) + φ^k · e(m)

  - Khí_hậu(tháng): trung bình nhiều năm của cùng tháng (mùa khô/mùa mưa).
  - Xu_thế: hồi quy tuyến tính dị thường theo thời gian (khi có ≥ 24 tháng).
  - φ^k · e(m): dị thường gần nhất tắt dần theo AR(1), φ = tự tương quan bậc 1 của dị thường.
  - Khoảng tin cậy 80%: ± 1,28 · σ_e · sqrt(1 − φ^(2k)).
Mô hình được kiểm chứng ngược (rolling-origin backtest) trên 12 tháng gần nhất và so với khí hậu thuần.
"""
import numpy as np
import pandas as pd

Z80 = 1.2816


def monthly_means(series: pd.Series, min_coverage=0.8) -> pd.Series:
    s = series.dropna()
    if s.empty:
        return pd.Series(dtype=float)
    g = s.groupby(s.index.to_period("M"))
    means, counts = g.mean(), g.size()
    hours = pd.Series([p.days_in_month * 24 for p in means.index], index=means.index)
    return means[counts >= hours * min_coverage]


def _fit(m: pd.Series):
    months = np.array([p.month for p in m.index])
    clim = pd.Series(m.values).groupby(months).mean()
    clim_v = clim.reindex(months).to_numpy()
    anom = m.to_numpy() - clim_v
    t = np.array([p.ordinal for p in m.index], dtype=float)
    slope = intercept = 0.0
    if len(m) >= 24:
        slope, intercept = np.polyfit(t, anom, 1)
    resid = anom - (slope * t + intercept)
    phi = 0.0
    if len(resid) >= 6 and np.std(resid) > 0:
        phi = float(np.clip(np.corrcoef(resid[:-1], resid[1:])[0, 1], 0.0, 0.9))
    sigma = float(np.std(resid, ddof=1)) if len(resid) > 2 else float(np.std(m.values) or 1.0)
    return {"clim": clim, "slope": float(slope), "intercept": float(intercept), "phi": phi, "sigma": sigma,
            "last_resid": float(resid[-1]), "last_ordinal": int(t[-1])}


def _predict(fit, period: pd.Period):
    k = period.ordinal - fit["last_ordinal"]
    clim = fit["clim"]
    base = clim.get(period.month, clim.mean())
    trend = fit["slope"] * period.ordinal + fit["intercept"]
    mean = base + trend + (fit["phi"] ** k) * fit["last_resid"]
    sd = fit["sigma"] * np.sqrt(max(1 - fit["phi"] ** (2 * k), 0.15))
    return float(mean), float(sd), float(base)


def outlook(series: pd.Series, months_ahead: int = 3, now=None) -> dict:
    """Ước lượng TB tháng hiện tại + months_ahead tháng tới. series: chuỗi giờ (index thời gian)."""
    m = monthly_means(series)
    if len(m) < 12:
        return {"available": False, "reason": f"Chỉ có {len(m)} tháng đủ dữ liệu (cần ≥ 12)."}
    now = pd.Timestamp(now or pd.Timestamp.now())
    cur = now.to_period("M")
    hist = m[m.index < cur]
    fit = _fit(hist)
    rows = []
    cur_mean, cur_sd = None, None
    for k in range(0, months_ahead + 1):
        per = cur + k
        mean, sd, clim = _predict(fit, per)
        if k == 0:
            cur_mean, cur_sd = mean, sd
        rows.append({"month": str(per), "mean": round(max(mean, 0), 2),
                     "lo": round(max(mean - Z80 * sd, 0), 2), "hi": round(mean + Z80 * sd, 2),
                     "climatology": round(clim, 2)})
    # Tháng hiện tại: kết hợp phần đã quan trắc (nếu ≥ 7 ngày) với ước lượng thống kê cho phần còn lại.
    # Phần đã quan trắc coi như đã biết -> khoảng tin cậy chỉ còn độ bất định của (1 - frac) số giờ chưa tới,
    # và luôn bao quanh giá trị ước lượng.
    part = series[(series.index >= cur.start_time) & (series.index <= now)].dropna()
    if len(part) >= 24 * 7:
        frac = min(len(part) / (cur.days_in_month * 24), 1.0)
        obs = float(part.mean())
        mean = frac * obs + (1 - frac) * cur_mean
        half = Z80 * (1 - frac) * cur_sd
        rows[0].update({"observed_so_far": round(obs, 2), "mean": round(max(mean, 0), 2),
                        "lo": round(max(mean - half, 0), 2), "hi": round(mean + half, 2)})
    return {"available": True, "months": rows, "params": {"phi": round(fit["phi"], 3),
            "trend_per_year": round(fit["slope"] * 12, 3), "sigma": round(fit["sigma"], 3)},
            "n_months": int(len(hist)), "backtest": backtest(m)}


def backtest(m: pd.Series, n_origins: int = 12, horizon: int = 3) -> dict:
    """Kiểm chứng ngược: tại mỗi gốc, khớp trên dữ liệu trước đó, dự báo 1..horizon tháng."""
    errs, errs_clim = [], []
    for i in range(len(m) - n_origins - horizon, len(m) - horizon):
        if i < 12:
            continue
        fit = _fit(m.iloc[:i + 1])
        for k in range(1, horizon + 1):
            per = m.index[i] + k
            if per not in m.index:
                continue
            mean, _, clim = _predict(fit, per)
            errs.append(abs(mean - m[per]))
            errs_clim.append(abs(clim - m[per]))
    if not errs:
        return {"available": False}
    mae, mae_c = float(np.mean(errs)), float(np.mean(errs_clim))
    return {"available": True, "pairs": len(errs), "mae": round(mae, 3), "mae_climatology": round(mae_c, 3),
            "skill_vs_climatology": round(1 - mae / mae_c, 3) if mae_c > 0 else None}
