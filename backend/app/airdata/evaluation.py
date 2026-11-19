"""
ĐÁNH GIÁ MỞ RỘNG TRÊN TẬP KIỂM THỬ ĐỘC LẬP (không huấn luyện lại)

- Tái tạo dự báo của mô hình đã lưu (saved_models/airdata/<chất>.joblib) trên giai đoạn kiểm thử.
- Sai số theo MÙA (khô: 12-4, mưa: 5-11), theo đợt CỰC TRỊ (giá trị thực > P90), theo nhóm hạn.
- Chỉ tiêu phân loại vượt ngưỡng theo GIỜ (precision, recall, F1, PR-AUC, Brier) dựa trên ensemble thực nghiệm.
- Đầu ra hourly_rec / daily_rec dùng cho hiệu chỉnh xác suất (uncertainty.fit_and_evaluate).
"""
import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata import features as F
from app.airdata import uncertainty as U


def test_predictions(city: pd.DataFrame, bundle: dict, pollutant: str, issue_step: int = 6):
    """Trả về (hourly_rec, daily_rec): issue, target_time, h, y, yhat trên giai đoạn kiểm thử của mô hình."""
    df = F.complete_hourly(city)
    test_start = pd.Timestamp(bundle["split"]["test_start"])
    clim = bundle["clim"]
    xkw = {"extra": bundle["extra_wx"], "wx_clim": bundle.get("wx_clim")} if bundle.get("extra_wx") else {}
    te = F.training_frame(df, pollutant, clim, start=test_start, issue_step=issue_step, **xkw)
    if te["cols"] != bundle["features"]:
        raise RuntimeError(f"[{pollutant}] đặc trưng không khớp mô hình đã lưu - hãy huấn luyện lại.")
    pred = F.inverse(bundle["model"].predict(te["X"]), te["y0"])
    hourly = pd.DataFrame({"issue": pd.to_datetime(te["issue"]), "target_time": pd.to_datetime(te["target_time"]),
                           "h": te["h"], "y": te["y_true"], "yhat": pred})
    dd = F.training_frame(df, pollutant, clim, start=test_start, issue_step=1, horizons=list(range(1, 193)),
                          issue_hours=[0], **xkw)
    daily = pd.DataFrame()
    if len(dd["y"]):
        dp = F.inverse(bundle["model"].predict(dd["X"]), dd["y0"])
        daily = pd.DataFrame({"issue": pd.to_datetime(dd["issue"]), "target_time": pd.to_datetime(dd["target_time"]),
                              "h": dd["h"], "y": dd["y_true"], "yhat": dp})
    return hourly, daily


def _m(y, p):
    y, p = np.asarray(y, float), np.asarray(p, float)
    ok = np.isfinite(y) & np.isfinite(p)
    if ok.sum() < 10:
        return {"n": int(ok.sum())}
    e = p[ok] - y[ok]
    sst = float(np.sum((y[ok] - y[ok].mean()) ** 2)) or 1e-9
    return {"n": int(ok.sum()), "mae": round(float(np.mean(np.abs(e))), 3), "rmse": round(float(np.sqrt(np.mean(e ** 2))), 3),
            "bias": round(float(np.mean(e)), 3), "r2": round(1 - float(np.sum(e ** 2)) / sst, 4)}


def extended_metrics(hourly: pd.DataFrame, pollutant: str, rm: U.ResidualModel = None) -> dict:
    h = hourly.dropna(subset=["y", "yhat"]).copy()
    month = h["target_time"].dt.month
    h["season"] = np.where((month >= 5) & (month <= 11), "mua_mua", "mua_kho")
    p90 = float(h["y"].quantile(0.9))
    bins = [(1, 24, "1-24h"), (25, 72, "25-72h"), (73, 192, "73-192h")]
    out = {"pollutant": pollutant, "by_season": {}, "extremes": {"threshold_p90": round(p90, 2)}, "threshold_hourly": None}
    for s, g in h.groupby("season"):
        out["by_season"][s] = {name: _m(g.loc[(g["h"] >= a) & (g["h"] <= b), "y"], g.loc[(g["h"] >= a) & (g["h"] <= b), "yhat"])
                               for a, b, name in bins}
    ext = h[h["y"] > p90]
    out["extremes"].update({name: _m(ext.loc[(ext["h"] >= a) & (ext["h"] <= b), "y"],
                                     ext.loc[(ext["h"] >= a) & (ext["h"] <= b), "yhat"]) for a, b, name in bins})
    T = C.ROSE_DEFAULT_T.get(pollutant)
    if T is not None and rm is not None:
        sub = h.sample(min(len(h), 60000), random_state=1) if len(h) > 60000 else h
        ens = rm.ensemble(pollutant, sub["yhat"].to_numpy(), sub["h"].to_numpy())
        p = (ens > T).mean(axis=1)
        o = (sub["y"].to_numpy() > T).astype(float)
        q50 = np.median(ens, axis=1)
        rel, ece = U.reliability(p, o)
        out["threshold_hourly"] = {"T": T, "brier": round(U.brier(p, o), 4), "ece": ece, "reliability": rel,
                                   **U.classification(p, o, q50 > T)}
    return out
