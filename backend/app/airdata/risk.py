"""
XÁC SUẤT VƯỢT NGƯỠNG THEO PHƯỜNG, PHƠI NHIỄM DÂN SỐ VÀ THỐNG KÊ RỦI RO

Với phường j, ngày d, ngưỡng T (QCVN 05:2023 hoặc WHO 2021, đúng kỳ trung bình):
    P_j,d = P(C_j,d > T)                     từ ensemble thực nghiệm (uncertainty.ResidualModel)
    A_T   = Σ_j A_j · I(q50_j > T)            diện tích vùng vượt ngưỡng (km²)
    N_T   = Σ_j Pop_j · I(q50_j > T)          dân số trong vùng vượt ngưỡng (theo trung vị)
    E[N_T]= Σ_j Pop_j · P(C_j > T)            kỳ vọng số người ở vùng vượt ngưỡng
    PWE   = Σ_j Pop_j · C_j / Σ_j Pop_j       phơi nhiễm có trọng số dân số
Các thành viên ensemble dùng CHUNG một vectơ sai số cho mọi phường -> phân phối N_T (q05-q95) có tính đến
tương quan không gian của sai số dự báo. Giả định: người dân ở tại nơi cư trú (chưa có dữ liệu di chuyển).
QCVN so trên µg/Nm³ (quy đổi theo T, P của phường); WHO so trên µg/m³.
"""
import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata import standards as S
from app.airdata import uncertainty as U


def ward_meta() -> pd.DataFrame:
    from app.services import ward_index
    df = pd.DataFrame(ward_index.all_wards())
    if df.empty:
        return pd.DataFrame(columns=["code", "name", "area", "pop"])
    df["code"] = df["code"].astype(str)
    df["pop"] = pd.to_numeric(df.get("pop", 0), errors="coerce").fillna(0.0)
    df["area"] = pd.to_numeric(df["area"], errors="coerce").fillna(0.0)
    return df.drop_duplicates("code").reset_index(drop=True)


def ward_matrix(st: dict, pollutant: str, loader, codes: list):
    """Ma trận nồng độ giờ [phường, giờ] từ 00:00 hôm nay đến hết ngày thứ 7:
    giờ ≤ t0 lấy số liệu đồng nhất của phường; giờ > t0 = dự báo cấp TP × hệ số không gian S(phường, giờ)."""
    today, end = st["today"], st["end"]
    idx = pd.date_range(today, end, freq="h")
    fc = st["forecast"].get(pollutant)
    info = st["info"].get(pollutant)
    if fc is None or info is None:
        return None
    t0 = pd.Timestamp(info["t0"])
    future = idx > t0
    try:
        ward = loader.ward(idx[0], idx[-1])
    except Exception:
        ward = None
    Mx = np.full((len(codes), len(idx)), np.nan)
    T = np.full((len(codes), len(idx)), np.nan)
    P = np.full((len(codes), len(idx)), np.nan)
    pos = {c: i for i, c in enumerate(codes)}
    if ward is not None and not ward.empty:
        ward = ward.assign(ma_phuong_xa=ward["ma_phuong_xa"].astype(str))
        for code, g in ward.groupby("ma_phuong_xa"):
            i = pos.get(code)
            if i is None:
                continue
            g = g.drop_duplicates("thoi_gian").set_index("thoi_gian").reindex(idx)
            if pollutant in g.columns:
                Mx[i] = g[pollutant].to_numpy(dtype=float)
            if "temperature_2m" in g.columns:
                T[i] = g["temperature_2m"].to_numpy(dtype=float)
            if "surface_pressure" in g.columns:
                P[i] = g["surface_pressure"].to_numpy(dtype=float)
    city_fc = fc.reindex(idx).to_numpy(dtype=float)
    city_obs = st["city"][pollutant].reindex(idx).to_numpy(dtype=float) if pollutant in st["city"].columns else city_fc
    Sfac = st["factors"].get(pollutant)
    for code, i in pos.items():
        prof = np.ones(len(idx))
        if Sfac is not None and code in Sfac.index:
            row = Sfac.loc[code]
            prof = row.reindex(idx.hour).fillna(row.mean()).fillna(1.0).to_numpy(dtype=float)
        fut_vals = city_fc * prof
        Mx[i, future] = fut_vals[future]
        miss = ~np.isfinite(Mx[i]) & ~future
        Mx[i, miss] = (city_obs * prof)[miss]
    return {"idx": idx, "values": Mx, "future": future, "t0": t0, "T": T, "P": P}


def daily_stat_matrix(values: np.ndarray, idx: pd.DatetimeIndex, kind: str):
    """[phường, giờ] -> [phường, ngày] theo TB 24 giờ (mean24) hoặc cực đại TB trượt 8 giờ (max8)."""
    days = pd.DatetimeIndex(sorted(set(idx.normalize())))
    out = np.full((values.shape[0], len(days)), np.nan)
    df = pd.DataFrame(values.T, index=idx)
    if kind == "max8":
        r8 = df.rolling(8, min_periods=C.QC_MIN_HOURS_8H).mean()
        g = r8.groupby(idx.normalize()).max()
    else:
        cnt = df.notna().groupby(idx.normalize()).sum()
        g = df.groupby(idx.normalize()).mean().where(cnt >= C.QC_MIN_HOURS_24H)
    g = g.reindex(days)
    out[:, :] = g.to_numpy().T
    return days, out


def daily_risk(st: dict, loader, pollutant: str = "pm2_5", standard: str = "qcvn", rm=None) -> dict:
    """Bảng rủi ro theo phường cho hôm nay + 7 ngày tới và các chỉ tiêu phơi nhiễm cấp TP."""
    rm = rm or U.residual_model()
    meta = ward_meta()
    if meta.empty:
        return {"ok": False, "reason": "Không đọc được danh mục phường/xã."}
    codes = meta["code"].tolist()
    wm = ward_matrix(st, pollutant, loader, codes)
    if wm is None:
        return {"ok": False, "reason": f"Chưa có dự báo cho {pollutant}."}
    kind = U.daily_stat_kind(pollutant)
    period = "8h" if kind == "max8" else "24h"
    days, stat = daily_stat_matrix(wm["values"], wm["idx"], kind)
    lim_day = S.limits(standard, st["today"].date()).get(pollutant, {})
    T = lim_day.get(period)
    if T is None:
        alt = {"mean24": "24h", "max8": "8h"}
        return {"ok": False, "reason": f"{standard.upper()} không quy định {pollutant} theo {alt[kind]}.",
                "available": list(lim_day.keys())}
    # QCVN: quy đổi sang µg/Nm³ theo T, P trung bình ngày của phường
    nf = np.ones_like(stat)
    if standard == "qcvn":
        f = S.normal_factor(wm["T"], wm["P"])
        fd = pd.DataFrame(f.T, index=wm["idx"]).groupby(wm["idx"].normalize()).mean().reindex(days).to_numpy().T
        nf = np.where(np.isfinite(fd), fd, 1.0)
    stat_n = stat * nf
    frac = pd.Series(wm["future"], index=wm["idx"]).groupby(wm["idx"].normalize()).mean().reindex(days).fillna(1.0).to_numpy()
    ens = rm.daily_ensemble(pollutant, np.nan_to_num(stat_n, nan=0.0), frac)       # [w, d, M]
    valid = np.isfinite(stat_n)
    exceed = ens > T
    p = exceed.mean(axis=2)
    p = np.where(valid, p, np.nan)
    q05, q50, q95 = (np.quantile(ens, q, axis=2) for q in (0.05, 0.5, 0.95))
    pop = meta["pop"].to_numpy(dtype=float)
    area = meta["area"].to_numpy(dtype=float)
    both = (exceed[:, :-1, :] & exceed[:, 1:, :]).mean(axis=2) if exceed.shape[1] > 1 else np.zeros((len(codes), 0))
    NT_members = np.einsum("w,wdm->dm", pop, exceed.astype(float))       # phân phối N_T theo thành viên
    city = []
    tot_pop = pop.sum() or np.nan
    for k, d in enumerate(days):
        ok = valid[:, k]
        city.append({
            "date": d.strftime("%Y-%m-%d"), "lead_day": k, "forecast_share": round(float(frac[k]), 2),
            "area_exceed_km2": round(float((area * (q50[:, k] > T) * ok).sum()), 2),
            "people_exceed_q50": int((pop * (q50[:, k] > T) * ok).sum()),
            "people_exceed_expected": int(np.nansum(pop * p[:, k])),
            "people_exceed_q05": int(np.quantile(NT_members[k], 0.05)),
            "people_exceed_q95": int(np.quantile(NT_members[k], 0.95)),
            "pwe": round(float(np.nansum(pop * q50[:, k]) / tot_pop), 2),
            "wards_p_over_50": int(np.nansum(p[:, k] > 0.5)),
            "max_p": round(float(np.nanmax(p[:, k])), 3) if np.isfinite(p[:, k]).any() else None,
        })
    wards = []
    for i, code in enumerate(codes):
        rec = {"ma_phuong_xa": code, "ten_phuong_xa": meta.loc[i, "name"], "dan_so": int(pop[i]),
               "dien_tich_km2": round(float(area[i]), 2), "days": []}
        for k in range(len(days)):
            rec["days"].append({"p": None if not np.isfinite(p[i, k]) else round(float(p[i, k]), 3),
                                "q05": round(float(q05[i, k]), 1), "q50": round(float(q50[i, k]), 1),
                                "q95": round(float(q95[i, k]), 1),
                                "p_next_day_too": round(float(both[i, k]), 3) if k < both.shape[1] else None,
                                "expected_exposed": int(round(pop[i] * (p[i, k] if np.isfinite(p[i, k]) else 0)))})
        wards.append(rec)
    return {
        "ok": True, "pollutant": pollutant, "standard": standard, "period": period, "stat": kind,
        "threshold": T, "unit": "µg/Nm³" if standard == "qcvn" else "µg/m³", "issued_t0": str(wm["t0"]),
        "days": [d.strftime("%Y-%m-%d") for d in days], "city": city, "wards": wards,
        "population_total": int(pop.sum()), "method": rm.describe(pollutant),
        "notes": ["Giả định người dân ở tại phường cư trú; chưa dùng dữ liệu di chuyển.",
                  "Sai số được hiệu chỉnh ở cấp TP; sai số hạ quy mô phường chưa định lượng -> khoảng có thể hẹp hơn thực tế.",
                  "Điểm xác suất là ước lượng thống kê, không phải quan trắc."],
    }


def describe(series: pd.Series, T: float = None) -> dict:
    """Thống kê mô tả chuỗi giờ: TB, trung vị, P90/P95, phương sai, độ lệch chuẩn, số giờ vượt T,
    chuỗi giờ vượt liên tục dài nhất, số ngày (TB 24h) vượt và tần suất vượt 2 ngày liên tục."""
    s = series.astype(float).dropna()
    if s.empty:
        return {"n": 0}
    out = {"n": int(len(s)), "mean": round(float(s.mean()), 2), "median": round(float(s.median()), 2),
           "p90": round(float(s.quantile(0.9)), 2), "p95": round(float(s.quantile(0.95)), 2),
           "var": round(float(s.var()), 2), "sd": round(float(s.std()), 2),
           "min": round(float(s.min()), 2), "max": round(float(s.max()), 2)}
    if T is not None:
        full = series.astype(float)
        ex = (full > T)
        out["threshold"] = T
        out["hours_exceed"] = int(ex.sum())
        out["share_hours_exceed"] = round(float(ex.sum() / max(full.notna().sum(), 1)), 4)
        grp = (ex != ex.shift()).cumsum()
        runs = ex.groupby(grp).sum()
        out["longest_run_h"] = int(runs.max()) if len(runs) else 0
        st = S.daily_stats(series)
        dex = (st["mean24"] > T).where(st["mean24"].notna())
        out["days_valid"] = int(st["mean24"].notna().sum())
        out["days_exceed_mean24"] = int((dex == True).sum())  # noqa: E712
        pair = (dex == True) & (dex.shift(-1) == True)  # noqa: E712
        n_pairs = int((dex.notna() & dex.shift(-1).notna()).sum())
        out["p_two_consecutive_days"] = round(float(pair.sum() / n_pairs), 4) if n_pairs else None
    return out
