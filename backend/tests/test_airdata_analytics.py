"""
Kiểm thử các phân hệ phân tích nâng cao bằng DỮ LIỆU GIẢ LẬP (không cần mạng, GEE hay PostgreSQL):
ngưỡng & quy đổi, QA/QC, hoa gió, dự báo xác suất (hiệu chỉnh + đánh giá), rủi ro phơi nhiễm,
truy vết nguồn A-D, kịch bản can thiệp & tối ưu, tiêu chí nghiệm thu.

    cd backend
    python tests/test_airdata_analytics.py
"""
import json
import os
import sys
import tempfile
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_airdata_synthetic import NOW, MemoryLoader, dataset  # noqa: E402

from app.airdata import analytics as AN  # noqa: E402
from app.airdata import config as C  # noqa: E402
from app.airdata import evaluation as EV  # noqa: E402
from app.airdata import qaqc as QC  # noqa: E402
from app.airdata import risk as RK  # noqa: E402
from app.airdata import scenarios as SC  # noqa: E402
from app.airdata import source_trace as TR  # noqa: E402
from app.airdata import standards as S  # noqa: E402
from app.airdata import train  # noqa: E402
from app.airdata import uncertainty as U  # noqa: E402
from app.airdata import windrose as WR  # noqa: E402
from app.airdata.forecast import AirForecastEngine  # noqa: E402

_ENV = {}


def env():
    """Huấn luyện nhanh 2 chất, hiệu chỉnh xác suất, dựng động cơ dự báo trên dữ liệu giả lập."""
    if _ENV:
        return _ENV
    d = dataset()
    tmp = tempfile.mkdtemp()
    hist = d["city"][d["city"]["thoi_gian"] <= NOW]
    train.train_all(hist, ["pm2_5", "no2"], ("hgb",), log=lambda *a: None, out_dir=tmp)
    import joblib
    unc = {}
    for p in ("pm2_5", "no2"):
        b = joblib.load(os.path.join(tmp, f"{p}.joblib"))
        hr, dr = EV.test_predictions(hist, b, p, issue_step=12)
        unc[p] = U.fit_and_evaluate(hr, dr, p, M=200)
        _ENV[f"hr_{p}"] = hr
    U.save(unc, os.path.join(tmp, "uncertainty.json"))
    C.MODEL_DIR = tmp                      # để residual_model() đọc đúng thư mục tạm
    C.UNCERTAINTY_FILE = os.path.join(tmp, "uncertainty.json")
    C.ANALYTICS_DIR = os.path.join(tmp, "analytics")
    wards = d["wards"].copy()
    wards["pop"] = np.linspace(20000, 150000, len(wards)).round()
    wards["type"] = ["Phường"] * (len(wards) - 5) + ["Xã"] * 5
    RK.ward_meta = lambda: wards.rename(columns={"lng": "lng"})[["code", "name", "area", "pop", "type"]]
    AN._wards_rep = lambda: wards[["code", "name", "lat", "lng"]]
    eng = AirForecastEngine(loader=MemoryLoader(d["ward"], d["city"]), model_dir=tmp)
    eng.state(now=NOW)
    _ENV.update(d=d, tmp=tmp, eng=eng, unc=unc, wards=wards)
    return _ENV


def test_standards_and_units():
    f = S.normal_factor(30.0, 1008.0)
    assert 1.02 < float(f) < 1.03
    t = S.threshold_table()
    pm = next(r for r in t if r["pollutant"] == "pm2_5")
    assert any(x["value"] == 15.0 for x in pm["who"]) and any(x["period"] == "24h" for x in pm["qcvn"])
    idx = pd.date_range("2026-01-01", periods=48, freq="h")
    s = pd.Series(50.0, index=idx)
    s.iloc[:10] = np.nan                          # ngày 1 chỉ còn 14 giờ -> TB 24h không hợp lệ
    st = S.daily_stats(s)
    assert np.isnan(st["mean24"].iloc[0]) and st["mean24"].iloc[1] == 50.0
    ex = S.daily_exceedances(s, "pm2_5", "qcvn")
    assert ex.loc[ex["valid"], "exceed"].all()    # 50 > 45 (QCVN từ 2026)


def test_wind_conventions_and_rose():
    ws, wd = WR.uv_to_wswd(-2, -1)
    assert abs(float(ws) - 2.236) < 1e-3 and abs(float(wd) - 63.4) < 0.1
    u, v = WR.wswd_to_uv(ws, wd)
    assert abs(float(u) + 2) < 1e-9 and abs(float(v) + 1) < 1e-9
    rng = np.random.default_rng(3)
    wdv = rng.uniform(0, 360, 5000)
    wsv = rng.gamma(2, 1.3, 5000)
    c = 20 + 40 * (np.abs(((wdv - 90 + 180) % 360) - 180) < 30) + rng.normal(0, 3, 5000)
    r = WR.rose(wsv, wdv, c, 40, 8)
    assert r["dominant_pollution_sector"]["name"] == "Đ"
    assert abs(sum(s["freq_pct"] for s in r["sectors"]) + r["calm"]["freq_pct"] - 100) < 0.1
    assert len(r["sectors"][0]["cbpf"]) == len(C.WIND_SPEED_BINS)
    assert len(WR.calm_sensitivity(wsv, wdv, c, 40)) == len(C.CALM_SENSITIVITY)


def test_qaqc():
    e = env()
    rep = QC.report(e["d"]["city"], e["d"]["ward"], now=NOW)
    assert rep["city"]["pm2_5"]["completeness"] > 0.99 and rep["acceptance"]["pass"]
    assert any(f["bit"] == 16 for f in rep["provenance_flags"])
    idx = pd.date_range("2025-01-01", periods=200, freq="h")
    s = pd.Series(30 + np.sin(np.arange(200) / 5), index=idx)
    s.iloc[50] = 400
    s.iloc[60] = -5
    r = QC.check_series(s, "pm2_5")
    assert r["spikes"] >= 1 and r["negative"] == 1


def test_uncertainty_calibration():
    e = env()
    ev = e["unc"]["pm2_5"]["evaluation"]
    assert ev["hourly"] and ev["daily"]
    pic = [v["picp90"] for v in ev["hourly"].values()]
    assert all(0.75 <= p <= 0.99 for p in pic), pic      # bao phủ gần 90% trên phần kiểm chứng độc lập
    d1 = ev["daily"]["1"]
    assert "who" in d1["thresholds"] and d1["thresholds"]["who"]["brier"] is not None
    rm = U.ResidualModel.load(e["tmp"])
    q = rm.quantiles("pm2_5", np.array([20.0, 20.0]), np.array([3, 150]))
    assert q["q05"][0] < 20 < q["q95"][0] and (q["q95"][1] - q["q05"][1]) > (q["q95"][0] - q["q05"][0])
    # dự phòng chuẩn từ RMSE khi chưa hiệu chỉnh
    rg = U.ResidualModel({}, json.load(open(os.path.join(e["tmp"], "metrics.json"), encoding="utf-8")))
    assert rg.method("pm2_5") == "gaussian_rmse" and rg.p_exceed("pm2_5", np.array([30.0]), np.array([10]), 25)[0] > 0.5
    ex = EV.extended_metrics(e["hr_pm2_5"], "pm2_5", rm)
    assert set(ex["by_season"]) <= {"mua_kho", "mua_mua"} and ex["threshold_hourly"]["brier"] is not None


def test_probability_and_risk():
    e = env()
    pr = AN.probability_payload(e["eng"], pollutant="pm2_5", standard="who", now=NOW)
    assert pr["ok"] and len(pr["daily"]) == 8 and len(pr["hourly"]) == 8 * 24
    fut = [h for h in pr["hourly"] if not h["observed"]]
    assert all(h["q05"] <= h["q50"] <= h["q95"] for h in fut)
    assert all(0 <= d.get("p_exceed", 0) <= 1 for d in pr["daily"])
    rk = AN.risk_payload(e["eng"], "pm2_5", "qcvn", now=NOW)
    assert rk["ok"] and len(rk["wards"]) == len(e["wards"]) and rk["threshold"] == C.qcvn_pm25_24h(NOW.date())
    c0 = rk["city"][1]
    # E[N_T] có thể > q95 khi xác suất vượt nhỏ (đuôi nặng) -> chỉ kiểm tra thứ tự phân vị và miền giá trị
    assert c0["people_exceed_q05"] <= c0["people_exceed_q95"] and 0 <= c0["people_exceed_expected"] <= rk["population_total"]
    assert rk["population_total"] == int(e["wards"]["pop"].sum())
    st = AN.stats_payload(e["eng"].loader, None, "pm2_5", 60, None, now=NOW)
    assert st["ok"] and st["stats"]["p95"] >= st["stats"]["median"]


def test_windrose_and_trace():
    e = env()
    wr = AN.windrose_payload(e["eng"].loader, None, "pm2_5", 120, 8, 30, now=NOW)
    assert wr["ok"] and len(wr["sectors"]) == 8
    w = e["wards"]
    cands = pd.DataFrame({"source_id": ["KCN1", "CANG1", "XA"], "ten": ["KCN A", "Cảng B", "Xa"],
                          "loai": ["khu_cong_nghiep", "cang", "bai_rac"],
                          "lat": [w["lat"].iloc[2], w["lat"].iloc[7], 12.0], "lon": [w["lng"].iloc[2], w["lng"].iloc[7], 108.0]})
    tr = AN.trace_payload(e["eng"], None, "pm2_5", 60, now=NOW, cands=cands)
    assert tr["ok"] and tr["evidence_ladder"][0]["done"] and not tr["evidence_ladder"][3]["done"]
    assert tr["trajectories"] and len(tr["trajectories"][0]) > 10
    sus = tr["suspects"]["sources"]
    assert sus[-1]["source_id"] == "XA"                 # nguồn rất xa có điểm thấp nhất
    assert all(0 <= s["score"] <= 1 for s in sus)


def test_pmf_recovers_factors():
    rng = np.random.default_rng(0)
    F_true = np.array([[0.6, 0.3, 0.05, 0.05, 0.0], [0.05, 0.05, 0.6, 0.2, 0.1], [0.0, 0.1, 0.1, 0.2, 0.6]])
    G_true = rng.gamma(2, 5, (150, 3))
    X = G_true @ F_true * np.exp(rng.normal(0, 0.05, (150, 5)))
    r = TR.pmf(X, k=3, n_starts=3, iters=600, n_boot=5)
    corr = np.corrcoef(np.vstack([F_true, np.array(r["profiles"])]))[:3, 3:]
    assert (corr.max(axis=1) > 0.95).all(), corr
    assert abs(sum(r["share"]) - 1) < 1e-6


def test_scenarios_and_optimize():
    e = env()
    sc = AN.scenarios_payload(e["eng"], "pm2_5", "past", 30, now=NOW, health={"baseline_mortality_per_1000": 6.0})
    assert sc["ok"]
    by = {r["id"]: r for r in sc["scenarios"]}
    assert by["S0"]["delta_pwe"] == 0
    assert 0 < by["S1"]["reduction_pct"] < by["S3"]["reduction_pct"]
    assert by["S3"]["delta_pwe"] <= by["S1"]["delta_pwe"] + by["S2"]["delta_pwe"] + 0.6  # không cộng giản đơn
    assert by["S2"]["health"]["avoided_deaths_per_year"] > 0
    o3 = AN.scenarios_payload(e["eng"], "o3", "past", 30, now=NOW)
    assert all(r["delta_pwe"] == 0 for r in o3["scenarios"])   # O3 không suy tuyến tính
    op = AN.optimize_payload(e["eng"], "pm2_5", budget=10, equity_min_pct=1.0, now=NOW)
    assert op["ok"] and op["best"]["cost"] <= 10 and op["pareto"]
    assert op["n_combinations"] == 2 ** len(SC.MEASURES)
    e2 = SC.npv_bcr(10, 4, capex=5, years=5, rate=0.1)
    assert e2["npv"] > 0 and e2["bcr"] > 1


def test_extra_weather_variant():
    """Mô hình có khí tượng bổ sung (bức xạ, lớp biên) vẫn dự báo realtime được; mô hình cũ không bị ảnh hưởng."""
    e = env()
    from app.airdata import features as F
    city = e["d"]["city"].copy()
    t = pd.to_datetime(city["thoi_gian"])
    hod = t.dt.hour.to_numpy()
    city["shortwave_radiation"] = np.clip(np.sin(np.pi * (hod - 6) / 12), 0, None) * 800
    city["boundary_layer_height"] = 300 + 900 * np.clip(np.sin(np.pi * (hod - 7) / 12), 0, None)
    city["cloud_cover"] = 50.0
    city["wind_speed_100m"] = city["wind_speed"] * 1.6
    hist = city[city["thoi_gian"] <= NOW]
    with tempfile.TemporaryDirectory() as tmp:
        s, _ = train.train_all(hist, ["pm2_5"], ("hgb",), log=lambda *a: None, out_dir=tmp, extra=F.EXTRA_WX)
        assert s["pm2_5"]["extra_wx"] == F.EXTRA_WX
        ex = city[["thoi_gian"] + F.EXTRA_WX]

        class XLoader(MemoryLoader):
            def extra(self, start, end):
                return ex[(ex["thoi_gian"] >= start) & (ex["thoi_gian"] <= end)]

        eng = AirForecastEngine(loader=XLoader(e["d"]["ward"], e["d"]["city"]), model_dir=tmp)
        p = eng.payload(now=NOW)
        assert p["ok"] and p["model"]["pm2_5"]["source"] in ("ml", "ml+cams")
        import joblib
        b = joblib.load(os.path.join(tmp, "pm2_5.joblib"))
        assert "x_ventilation" in b["features"]
        hr, dr = EV.test_predictions(hist, b, "pm2_5", issue_step=24)
        assert len(hr) > 100


def test_acceptance_and_catalog():
    a = AN.acceptance_payload()
    assert len(a["criteria"]) == 6
    c = AN.catalog_payload()
    assert any("OpenAQ" in x["source"] for x in c["catalog"]) and c["normal_conditions"]["T_C"] == 25.0


if __name__ == "__main__":
    t0 = time.time()
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            fn()
            print(f"OK  {name}  ({time.time() - t:.1f}s)")
    print(f"Tổng: {time.time() - t0:.0f}s")
