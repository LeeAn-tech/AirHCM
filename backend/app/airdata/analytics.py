"""
DỊCH VỤ PHÂN TÍCH NÂNG CAO (dùng cho API /api/v1/air/* mới, script báo cáo và lưu CSDL)

Ghép các module: standards (ngưỡng, quy đổi), qaqc, windrose, uncertainty (xác suất), risk (phơi nhiễm),
source_trace (truy vết A-E), scenarios (can thiệp, tối ưu) với động cơ dự báo realtime (forecast.ENGINE).
"""
import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata import qaqc as QC
from app.airdata import risk as RK
from app.airdata import scenarios as SC
from app.airdata import source_trace as TR
from app.airdata import standards as S
from app.airdata import uncertainty as U
from app.airdata import windrose as WR

CITY_CENTER = (10.7769, 106.7009)


def _num(v, nd=2):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


def _frame(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    d = df.copy()
    d["thoi_gian"] = pd.to_datetime(d["thoi_gian"])
    return d.drop_duplicates("thoi_gian").set_index("thoi_gian").sort_index()


def resolve_location(ward_code=None, lat=None, lng=None):
    loc = {"scope": "city", "ma_phuong_xa": None, "ten_phuong_xa": "TP. Hồ Chí Minh", "lat": CITY_CENTER[0],
           "lng": CITY_CENTER[1]}
    try:
        from app.services import ward_index
        w = ward_index.by_code(ward_code) if ward_code else (
            ward_index.locate(lat, lng) if lat is not None and lng is not None else None)
        if w:
            loc.update({"scope": "ward", "ma_phuong_xa": w["ma_phuong_xa"], "ten_phuong_xa": w["ten_phuong_xa"]})
            rep = {r["code"]: r for r in ward_index.representative_points()}.get(str(w["ma_phuong_xa"]))
            if rep:
                loc.update({"lat": rep["lat"], "lng": rep["lng"]})
    except Exception:
        pass
    return loc


def history(loader, code, days, now=None):
    now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
    start = now - pd.Timedelta(days=days)
    df = loader.ward(start, now, code) if code else loader.city(start, now)
    return _frame(df)


# ------------------------------------------------------------------------------
# NGƯỠNG & DANH MỤC DỮ LIỆU
# ------------------------------------------------------------------------------
def catalog_payload():
    return {"catalog": S.data_catalog(), "thresholds": S.threshold_table(), "unit_notes": S.unit_notes(),
            "normal_conditions": {"T_C": 25.0, "P_mmHg": 760, "source": "QCVN 05:2023/BTNMT mục 1.3.10"},
            "timezone": "Lưu và hiển thị theo giờ Việt Nam (UTC+7); ERA5 gốc UTC đã được quy đổi khi thu thập."}


# ------------------------------------------------------------------------------
# QA/QC
# ------------------------------------------------------------------------------
def qaqc_payload(loader, days=30, now=None):
    now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
    start = now - pd.Timedelta(days=days)
    city = loader.city(start, now)
    try:
        ward = loader.ward(start, now)
    except Exception:
        ward = None
    rep = QC.report(city, ward, now=now)
    rep["days"] = days
    return rep


# ------------------------------------------------------------------------------
# HOA GIÓ
# ------------------------------------------------------------------------------
def windrose_payload(loader, ward_code=None, pollutant="pm2_5", days=90, n_sectors=8, threshold=None, calm=None,
                     now=None):
    df = history(loader, ward_code, days, now)
    if df.empty or "wind_speed" not in df or "wind_dir" not in df:
        return {"ok": False, "reason": "Chưa có dữ liệu gió trong khoảng đã chọn."}
    res = WR.rose_from_frame(df, pollutant, threshold, n_sectors, calm)
    res.update({"ok": True, "location": resolve_location(ward_code), "days": days,
                "period": [str(df.index.min()), str(df.index.max())]})
    return res


# ------------------------------------------------------------------------------
# DỰ BÁO XÁC SUẤT CHO MỘT VỊ TRÍ
# ------------------------------------------------------------------------------
def probability_payload(engine, ward_code=None, lat=None, lng=None, pollutant="pm2_5", standard="qcvn",
                        threshold=None, now=None):
    if now is None and hasattr(engine, "_cached"):
        key = ("prob", ward_code, None if lat is None else round(lat, 3), None if lng is None else round(lng, 3),
               pollutant, standard, threshold)
        return engine._cached(key, 120, lambda: _probability(engine, ward_code, lat, lng, pollutant, standard,
                                                             threshold, None))
    return _probability(engine, ward_code, lat, lng, pollutant, standard, threshold, now)


def _probability(engine, ward_code, lat, lng, pollutant, standard, threshold, now):
    st = engine.state(now)
    if not st.get("ok"):
        return {"ok": False, "reason": st.get("reason")}
    if pollutant not in st["forecast"]:
        return {"ok": False, "reason": f"Chưa có dự báo cho {pollutant}."}
    loc = resolve_location(ward_code, lat, lng)
    code = loc["ma_phuong_xa"]
    rm = U.residual_model()
    s = engine._series(st, code)
    today, t0 = st["today"], pd.Timestamp(st["info"][pollutant]["t0"])
    view = s[s.index >= today]
    vals = view[pollutant].to_numpy(dtype=float)
    fut = view.index > t0
    h = ((view.index - t0) / pd.Timedelta(hours=1)).to_numpy()
    q05, q50, q95 = vals.copy(), vals.copy(), vals.copy()
    p_hour = np.full(len(vals), np.nan)
    lim = S.limits(standard, today.date()).get(pollutant, {})
    T_hour = threshold if threshold is not None else lim.get("1h")
    if fut.any():
        ens = rm.ensemble(pollutant, np.nan_to_num(vals[fut]), h[fut])
        q05[fut], q50[fut], q95[fut] = (np.quantile(ens, q, axis=1) for q in (0.05, 0.5, 0.95))
        if T_hour:
            p_hour[fut] = (ens > T_hour).mean(axis=1)
    if T_hour:
        p_hour[~fut] = (vals[~fut] > T_hour).astype(float)
    hourly = [{"time": t.strftime("%Y-%m-%d %H:00"), "observed": bool(not f), "q05": _num(a, 1), "q50": _num(b, 1),
               "q95": _num(c, 1), "p_exceed": _num(p, 3)}
              for t, f, a, b, c, p in zip(view.index, fut, q05, q50, q95, p_hour)]
    # thống kê ngày
    kind = U.daily_stat_kind(pollutant)
    period = "8h" if kind == "max8" else "24h"
    T_day = lim.get(period)
    days, stat = RK.daily_stat_matrix(vals[None, :], view.index, kind)
    nf = np.ones(len(days))
    if standard == "qcvn" and {"temperature_2m", "surface_pressure"} <= set(st["city"].columns):
        cw = st["city"].reindex(view.index)
        f = S.normal_factor(cw["temperature_2m"].to_numpy(), cw["surface_pressure"].to_numpy())
        nf = pd.Series(f, index=view.index).groupby(view.index.normalize()).mean().reindex(days).fillna(1.0).to_numpy()
    stat_n = stat[0] * nf
    frac = pd.Series(fut, index=view.index).groupby(view.index.normalize()).mean().reindex(days).fillna(1.0).to_numpy()
    dens = rm.daily_ensemble(pollutant, np.nan_to_num(stat_n)[None, :], frac)[0]        # [nd, M]
    daily = []
    for k, d in enumerate(days):
        rec = {"date": d.strftime("%Y-%m-%d"), "stat": kind, "value": _num(stat_n[k], 1),
               "q05": _num(np.quantile(dens[k], 0.05), 1), "q50": _num(np.quantile(dens[k], 0.5), 1),
               "q95": _num(np.quantile(dens[k], 0.95), 1), "forecast_share": round(float(frac[k]), 2)}
        if T_day and np.isfinite(stat_n[k]):
            rec["p_exceed"] = round(float((dens[k] > T_day).mean()), 3)
            if k + 1 < len(days):
                rec["p_exceed_today_and_next"] = round(float(((dens[k] > T_day) & (dens[k + 1] > T_day)).mean()), 3)
        daily.append(rec)
    return {"ok": True, "location": loc, "pollutant": pollutant, "standard": standard,
            "unit": "µg/Nm³ (ngày, QCVN)" if standard == "qcvn" else "µg/m³", "issued_t0": str(t0),
            "threshold_hour": T_hour, "threshold_day": T_day, "day_period": period,
            "hourly": hourly, "daily": daily, "method": rm.describe(pollutant),
            "calibration": _calibration_summary(rm, pollutant)}


def _calibration_summary(rm, p):
    ev = rm.data.get(p, {}).get("evaluation") if rm.data else None
    if not ev:
        return None
    out = {"hourly_picp90": {k: v.get("picp90") for k, v in ev.get("hourly", {}).items()},
           "daily": {}}
    for k, v in ev.get("daily", {}).items():
        out["daily"][k] = {"picp90": v.get("picp90"),
                           **{f"brier_{s}": t.get("brier") for s, t in v.get("thresholds", {}).items()}}
    return out


# ------------------------------------------------------------------------------
# RỦI RO PHƠI NHIỄM
# ------------------------------------------------------------------------------
def risk_payload(engine, pollutant="pm2_5", standard="qcvn", now=None):
    st = engine.state(now)
    if not st.get("ok"):
        return {"ok": False, "reason": st.get("reason")}
    if now is None and hasattr(engine, "_cached"):
        return engine._cached(("risk", pollutant, standard), 300,
                              lambda: RK.daily_risk(st, engine.loader, pollutant, standard))
    return RK.daily_risk(st, engine.loader, pollutant, standard)


def stats_payload(loader, ward_code=None, pollutant="pm2_5", days=90, threshold=None, now=None):
    df = history(loader, ward_code, days, now)
    if df.empty or pollutant not in df:
        return {"ok": False, "reason": "Chưa có dữ liệu."}
    T = threshold or C.WHO_AQG_2021.get(pollutant, {}).get("24h") or C.ROSE_DEFAULT_T.get(pollutant)
    return {"ok": True, "location": resolve_location(ward_code), "pollutant": pollutant, "days": days,
            "stats": RK.describe(df[pollutant], T)}


# ------------------------------------------------------------------------------
# TRUY VẾT NGUỒN
# ------------------------------------------------------------------------------
def _wards_rep():
    try:
        from app.services import ward_index
        return pd.DataFrame(ward_index.representative_points())
    except Exception:
        return pd.DataFrame(columns=["code", "name", "lat", "lng"])


def candidate_sources(days_sat=60):
    frames = []
    try:
        from app.airdata import store
        db = store.emission_sources()
        if db is not None and not db.empty:
            frames.append(db)
        sat = store.satellite((pd.Timestamp.now() - pd.Timedelta(days=days_sat)).date(), pd.Timestamp.now().date())
        hs = TR.satellite_hotspots(sat, _wards_rep())
        if not hs.empty:
            frames.append(hs)
    except Exception:
        pass
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    return df.dropna(subset=["lat", "lon"]).drop_duplicates("source_id")


def trace_payload(engine, ward_code=None, pollutant="pm2_5", days=30, event_date=None, now=None, cands=None,
                  n_traj=8, traj_hours=48):
    now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
    loader = engine.loader
    loc = resolve_location(ward_code)
    hist = history(loader, ward_code, days, now)
    if hist.empty:
        return {"ok": False, "reason": "Chưa có dữ liệu trong khoảng đã chọn."}
    sig = TR.signals(hist)
    rose = WR.rose_from_frame(hist, pollutant) if {"wind_speed", "wind_dir"} <= set(hist.columns) else {}
    city = loader.city(now - pd.Timedelta(days=days), now)
    events = TR.find_events(city, pollutant) if city is not None and not city.empty and pollutant in city else []
    ev_day = pd.Timestamp(event_date).normalize() if event_date else (pd.Timestamp(events[0]["date"]) if events else now.normalize())
    trajs, bg = [], {}
    try:
        wwin = loader.ward(ev_day - pd.Timedelta(hours=traj_hours + 6), ev_day + pd.Timedelta(hours=23))
        reps = _wards_rep()
        if wwin is not None and not wwin.empty and not reps.empty:
            field = TR.WindField(wwin, reps)
            ends = [ev_day + pd.Timedelta(hours=int(hh)) for hh in np.linspace(2, 23, n_traj)]
            trajs = [TR.back_trajectory(field, loc["lat"], loc["lng"], t, traj_hours) for t in ends if t <= now]
            trajs = [t for t in trajs if len(t) > 1]
            day_vals = wwin[pd.to_datetime(wwin["thoi_gian"]).dt.normalize() == ev_day].groupby("ma_phuong_xa")[pollutant].mean()
            bg = TR.regional_background(day_vals)
    except Exception as e:
        bg = {"error": str(e)[:120]}
    cands = cands if cands is not None else candidate_sources()
    sus = TR.suspicion_scores(cands, (loc["lat"], loc["lng"]), pollutant, rose, trajs) if cands is not None and not cands.empty \
        else {"sources": [], "note": "Chưa có ứng viên nguồn: chạy scripts/airdata_import_sources.py (OSM + FIRMS)."}
    ladder = TR.evidence_ladder(bool(sig.get("findings")), bool(rose.get("sectors")), bool(trajs))
    return {"ok": True, "location": loc, "pollutant": pollutant, "days": days, "event_date": ev_day.strftime("%Y-%m-%d"),
            "events": events, "signals": sig, "rose": rose, "trajectories": trajs, "regional_background": bg,
            "suspects": sus, "evidence_ladder": ladder,
            "conclusion_rule": "Chỉ kết luận ở mức bằng chứng đã đạt; điểm nghi vấn cao chỉ để ưu tiên kiểm tra thực địa."}


# ------------------------------------------------------------------------------
# KỊCH BẢN CAN THIỆP
# ------------------------------------------------------------------------------
def baseline_matrix(engine, pollutant, mode="past", days=30, now=None):
    meta = RK.ward_meta()
    if meta.empty:
        return None, None
    codes = meta["code"].tolist()
    if mode == "forecast":
        st = engine.state(now)
        wm = RK.ward_matrix(st, pollutant, engine.loader, codes)
        return (wm["values"] if wm else None), meta
    now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
    w = engine.loader.ward(now - pd.Timedelta(days=days), now)
    if w is None or w.empty or pollutant not in w:
        return None, meta
    w = w.assign(ma_phuong_xa=w["ma_phuong_xa"].astype(str))
    piv = w.pivot_table(index="ma_phuong_xa", columns="thoi_gian", values=pollutant).reindex(codes)
    M = piv.to_numpy(dtype=float)
    city = np.nanmean(M, axis=0)
    M = np.where(np.isfinite(M), M, city[None, :])
    return M, meta


def scenarios_payload(engine, pollutant="pm2_5", mode="past", days=30, threshold=None, scenarios=None,
                      overrides=None, health=None, economics=None, now=None):
    base, meta = baseline_matrix(engine, pollutant, mode, days, now)
    if base is None:
        return {"ok": False, "reason": "Chưa có dữ liệu đường cơ sở theo phường."}
    T = threshold or C.ROSE_DEFAULT_T.get(pollutant)
    res = SC.compare(base, meta["pop"].to_numpy(float), meta.get("type", pd.Series([""] * len(meta))).tolist(),
                     pollutant, T, scenarios=scenarios, overrides=overrides, health=health, economics=economics)
    res.update({"ok": True, "mode": mode, "days": days, "n_wards": len(meta), "n_hours": int(base.shape[1])})
    return res


def optimize_payload(engine, pollutant="pm2_5", budget=15.0, equity_min_pct=0.0, mode="past", days=30,
                     overrides=None, candidates=None, now=None):
    base, meta = baseline_matrix(engine, pollutant, mode, days, now)
    if base is None:
        return {"ok": False, "reason": "Chưa có dữ liệu đường cơ sở theo phường."}
    res = SC.optimize(base, meta["pop"].to_numpy(float), meta.get("type", pd.Series([""] * len(meta))).tolist(),
                      pollutant, budget, equity_min_pct, C.ROSE_DEFAULT_T.get(pollutant), candidates, overrides)
    res["ok"] = True
    return res


# ------------------------------------------------------------------------------
# TIÊU CHÍ NGHIỆM THU (mục 13)
# ------------------------------------------------------------------------------
def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def acceptance_payload(engine=None):
    metrics = _load_json(os.path.join(C.MODEL_DIR, "metrics.json")) or {}
    unc = _load_json(C.UNCERTAINTY_FILE) or {}
    extra = _load_json(os.path.join(C.ANALYTICS_DIR, "evaluation_extra.json")) or {}
    qa = _load_json(os.path.join(C.ANALYTICS_DIR, "qaqc.json"))
    tr = _load_json(os.path.join(C.ANALYTICS_DIR, "trace.json")) or {}
    rows = []

    def add(group, req, status, evidence):
        rows.append({"group": group, "requirement": req, "status": status, "evidence": evidence})

    comp = (qa or {}).get("acceptance", {})
    add("Dữ liệu", "Danh mục nguồn và giấy phép; chuẩn giờ, đơn vị; ≥ 80% giờ có dữ liệu cho chuỗi trọng yếu",
        "đạt" if comp.get("pass") else ("chưa đánh giá" if not qa else "chưa đạt"),
        f"Độ đầy đủ: {comp.get('series')}" if qa else "Chạy scripts/airdata_analytics.py để tính độ đầy đủ.")
    base_ok = all(k in v.get("metrics", {}) for v in metrics.values() for k in ("persistence", "seasonal_persistence", "climatology")) if metrics else False
    add("Dự báo", "So sánh ≥ 3 mô hình tham chiếu; MAE/RMSE/Bias theo chất, mùa, chân trời; test thời gian độc lập",
        "đạt" if base_ok and extra else ("đạt một phần" if base_ok else "chưa đạt"),
        f"{len(metrics)} chất × 3 tham chiếu (bền vững, bền vững theo ngày, khí hậu) × 3 nhóm hạn"
        + ("; theo mùa mưa/khô + đợt cực trị có trong evaluation_extra.json" if extra else "; thiếu đánh giá theo mùa (chạy script)")
        + ". Chưa có đánh giá theo TRẠM do chưa có số liệu mặt đất (OpenAQ là bổ sung).")
    if unc:
        picp = {p: (v.get("evaluation", {}).get("daily", {}).get("1", {}) or {}).get("picp90") for p, v in unc.items()}
        add("Xác suất", "Brier score, reliability diagram, coverage khoảng 90%; báo cáo KTC và hiệu chỉnh", "đạt",
            f"PICP90 ngày thứ 2 theo chất: {picp}; Brier/reliability/ECE + KTC block bootstrap trong uncertainty.json.")
    else:
        add("Xác suất", "Brier score, reliability diagram, coverage khoảng 90%", "chưa đánh giá",
            "Đang dùng xấp xỉ chuẩn từ RMSE; chạy scripts/airdata_analytics.py để hiệu chỉnh và đánh giá.")
    n_ev = len(tr.get("events", [])) if tr else 0
    add("Truy nguồn", "≥ 3 sự kiện có xác minh thực địa/quan trắc độc lập; điểm nghi vấn không diễn giải thành %",
        "đạt một phần" if n_ev >= 3 else "chưa đạt",
        f"Đã xác định {n_ev} sự kiện và chạy thang A-C; CHƯA có xác minh thực địa/quan trắc độc lập (mức D-E cần dữ liệu hóa học/CTM).")
    add("Can thiệp", "Đánh giá kịch bản giả định và một ca kiểm chứng trước/sau + đối chứng", "đạt một phần",
        "Đã có S0-S3, người-giờ tránh được, NPV/BCR, tối ưu ngân sách + công bằng; ca kiểm chứng trước/sau chưa thực hiện.")
    add("WebGIS", "Click phường/điểm trạm, đổi thời gian/chất/kịch bản; xuất CSV và báo cáo, phân quyền", "đạt",
        "Tab Phân tích nâng cao: chọn phường, chất, chuẩn, ngày, kịch bản; xuất CSV rủi ro; phân quyền admin/user (JWT).")
    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "criteria": rows}


# ------------------------------------------------------------------------------
# LƯU CSDL SAU MỖI LƯỢT CẬP NHẬT REALTIME
# ------------------------------------------------------------------------------
def persist(engine, pollutants=("pm2_5", "pm10", "no2", "o3"), log=print):
    from app.airdata import store
    st = engine.state()
    if not st.get("ok"):
        return 0
    rm = U.residual_model()
    rows_q, rows_r = [], []
    issued = st["now"]
    for p in C.FORECAST_POLLUTANTS:
        fc = st["forecast"].get(p)
        if fc is None or p not in st["info"]:
            continue
        t0 = pd.Timestamp(st["info"][p]["t0"])
        h = ((fc.index - t0) / pd.Timedelta(hours=1)).to_numpy()
        q = rm.quantiles(p, fc.to_numpy(dtype=float), h)
        rows_q.append(pd.DataFrame({"vi_tri": "TP", "phat_hanh_luc": issued, "thoi_gian_dich": fc.index, "chat": p,
                                    "q05": q["q05"], "q50": q["q50"], "q95": q["q95"],
                                    "model_ver": st["info"][p].get("model") or st["info"][p].get("source")}))
    for p in pollutants:
        for std in ("qcvn", "who"):
            r = RK.daily_risk(st, engine.loader, p, std, rm)
            if not r.get("ok"):
                continue
            for w in r["wards"]:
                for k, d in enumerate(r["days"]):
                    x = w["days"][k]
                    rows_r.append({"ma_phuong_xa": w["ma_phuong_xa"], "ngay": d, "chat": p, "chuan": std,
                                   "nguong": r["threshold"], "xac_suat_vuot": x["p"], "q05": x["q05"], "q50": x["q50"],
                                   "q95": x["q95"], "dan_so": w["dan_so"], "dan_so_phoi_nhiem_ky_vong": x["expected_exposed"],
                                   "dien_tich_km2": w["dien_tich_km2"], "phat_hanh_luc": issued})
    n = 0
    if rows_q:
        n += store.upsert("kk_du_bao_phan_vi", pd.concat(rows_q, ignore_index=True))
    if rows_r:
        n += store.upsert("kk_rui_ro_phuong_ngay", pd.DataFrame(rows_r))
    log(f"   Lưu phân vị dự báo + rủi ro phường: {n:,} dòng")
    return n
