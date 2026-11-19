"""
HUẤN LUYỆN & ĐÁNH GIÁ MÔ HÌNH DỰ BÁO ĐA CHẤT (PM2.5, PM10, CO, NO2, SO2, O3)

Quy trình cho từng chất:
  1. Chia theo thời gian (không xáo trộn): huấn luyện | kiểm định (chọn mô hình) | kiểm thử (báo cáo).
  2. Ứng viên: HistGradientBoosting (scikit-learn), XGBoost (nếu cài), RandomForest (tùy chọn).
  3. Chọn mô hình có RMSE kiểm định nhỏ nhất -> huấn luyện lại trên huấn luyện + kiểm định.
  4. Đánh giá trên tập kiểm thử theo nhóm hạn 1-24h, 25-72h, 73-192h; so với 3 mô hình tham chiếu:
     bền vững (persistence), bền vững theo ngày (cùng giờ hôm trước), khí hậu (tháng × giờ).
  5. Sai số trung bình NGÀY theo hạn 1..7 ngày (phát hành lúc 00:00) + độ quan trọng hoán vị.
"""
import json
import os
import time
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance

from app.airdata import config as C
from app.airdata import features as F

BINS = [(1, 24, "1-24h"), (25, 72, "25-72h"), (73, 192, "73-192h")]


def _metrics(y, yhat):
    y, yhat = np.asarray(y, float), np.asarray(yhat, float)
    ok = np.isfinite(y) & np.isfinite(yhat)
    y, yhat = y[ok], yhat[ok]
    if len(y) == 0:
        return {"n": 0}
    err = yhat - y
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    return {"n": int(len(y)), "mae": round(float(np.mean(np.abs(err))), 3),
            "rmse": round(float(np.sqrt(np.mean(err ** 2))), 3), "r2": round(1 - ss_res / ss_tot, 4),
            "bias": round(float(np.mean(err)), 3)}


def _by_bins(y, yhat, h):
    out = {"all": _metrics(y, yhat)}
    for lo, hi, name in BINS:
        m = (h >= lo) & (h <= hi)
        out[name] = _metrics(y[m], yhat[m])
    return out


def _candidates(names):
    models = {}
    if "hgb" in names:
        models["HistGradientBoosting"] = HistGradientBoostingRegressor(
            max_iter=600, learning_rate=0.06, max_leaf_nodes=63, min_samples_leaf=40, l2_regularization=1.0,
            early_stopping=True, validation_fraction=0.1, n_iter_no_change=25, random_state=42)
    if "xgb" in names:
        try:
            from xgboost import XGBRegressor
            models["XGBoost"] = XGBRegressor(
                n_estimators=600, learning_rate=0.05, max_depth=8, subsample=0.8, colsample_bytree=0.8,
                min_child_weight=5, tree_method="hist", n_jobs=-1, random_state=42)
        except Exception:
            pass
    if "rf" in names:
        models["RandomForest"] = RandomForestRegressor(
            n_estimators=150, max_depth=22, min_samples_leaf=5, max_samples=0.3, n_jobs=-1, random_state=42)
    return models


def _clone(model):
    from sklearn.base import clone
    return clone(model)


def split_times(index: pd.DatetimeIndex, val_frac=0.1, test_frac=0.2):
    t0, t1 = index.min(), index.max()
    span = t1 - t0
    test_start = t1 - span * test_frac
    val_start = test_start - span * val_frac
    return val_start.floor("D"), test_start.floor("D")


def train_pollutant(city: pd.DataFrame, p: str, model_names=("hgb", "xgb"), log=print, out_dir=None, extra=None):
    out_dir = out_dir or C.MODEL_DIR
    df = F.complete_hourly(city)
    obs = df[p].dropna()
    if len(obs) < 24 * 120:
        log(f"   [{p}] bỏ qua: chỉ có {len(obs)} giờ dữ liệu (cần ≥ 120 ngày)")
        return None
    val_start, test_start = split_times(obs.index)
    train_mask = df.index < val_start
    clim_tab = F.climatology(df.loc[train_mask, p])
    extra = [k for k in (extra or []) if k in df.columns and df.loc[train_mask, k].notna().mean() > 0.3]
    wx_clim = {k: F.climatology(df.loc[train_mask, k]) for k in F.WX_FEATURES + extra if k in df.columns}
    xkw = {"extra": extra, "wx_clim": wx_clim} if extra else {}

    end_train = val_start - pd.Timedelta(hours=1)
    tr = F.training_frame(df, p, clim_tab, end=end_train, **xkw)
    # tránh rò rỉ: mục tiêu của mẫu huấn luyện phải trước ngày bắt đầu kiểm định
    keep = tr["target_time"] < val_start
    tr = {k: (v[keep] if hasattr(v, "__len__") and len(v) == len(keep) else v) for k, v in tr.items()}
    va = F.training_frame(df, p, clim_tab,
                          start=val_start, end=test_start - pd.Timedelta(hours=1), issue_step=6, **xkw)
    keep = va["target_time"] < test_start
    va = {k: (v[keep] if hasattr(v, "__len__") and len(v) == len(keep) else v) for k, v in va.items()}
    te = F.training_frame(df, p, clim_tab,
                          start=test_start, issue_step=6, **xkw)
    log(f"   [{p}] mẫu: huấn luyện {len(tr['y']):,} | kiểm định {len(va['y']):,} | kiểm thử {len(te['y']):,}")

    # 1-2. chọn mô hình
    scores, fitted = {}, {}
    for name, model in _candidates(model_names).items():
        t = time.time()
        model.fit(tr["X"], tr["y"])
        pred = F.inverse(model.predict(va["X"]), va["y0"])
        scores[name] = _metrics(va["y_true"], pred)
        fitted[name] = model
        log(f"   [{p}] {name}: RMSE kiểm định {scores[name]['rmse']} ({time.time() - t:.0f}s)")
    best = min(scores, key=lambda k: scores[k]["rmse"])

    # 3. huấn luyện lại trên huấn luyện + kiểm định
    final = _clone(fitted[best])
    X_all = np.vstack([tr["X"], va["X"]])
    y_all = np.concatenate([tr["y"], va["y"]])
    final.fit(X_all, y_all)

    # 4. đánh giá kiểm thử + tham chiếu
    pred = F.inverse(final.predict(te["X"]), te["y0"])
    y, h = te["y_true"], te["h"]
    s = df[p].astype(float)
    tt = pd.DatetimeIndex(te["target_time"])
    lag_days = np.ceil(h / 24).astype(int) * 24
    seasonal = s.reindex(tt - pd.to_timedelta(lag_days, unit="h")).to_numpy()
    clim_pred = F.clim_lookup(clim_tab, tt)
    metrics = {
        "model": _by_bins(y, pred, h),
        "persistence": _by_bins(y, te["y0"], h),
        "seasonal_persistence": _by_bins(y, seasonal, h),
        "climatology": _by_bins(y, clim_pred, h),
    }
    for key in ("all",) + tuple(b[2] for b in BINS):
        m, b = metrics["model"].get(key, {}), metrics["persistence"].get(key, {})
        if m.get("rmse") and b.get("rmse"):
            metrics["model"][key]["skill_vs_persistence"] = round(1 - m["rmse"] / b["rmse"], 3)

    # 5a. sai số trung bình ngày theo hạn (phát hành 00:00, hạn 1..192 giờ)
    daily = F.training_frame(df, p, clim_tab,
                             start=test_start, issue_step=1, horizons=list(range(1, 193)), issue_hours=[0], **xkw)
    daily_metrics = []
    if len(daily["y"]):
        dp = F.inverse(final.predict(daily["X"]), daily["y0"])
        dd = pd.DataFrame({"issue": daily["issue"], "day": (daily["h"] - 1) // 24, "y": daily["y_true"],
                           "p": dp, "pers": daily["y0"]})
        g = dd.groupby(["issue", "day"]).agg(y=("y", "mean"), p=("p", "mean"), pers=("pers", "mean"),
                                             n=("y", "size")).reset_index()
        g = g[g["n"] >= 20]
        for k, gk in g.groupby("day"):
            mm = _metrics(gk["y"], gk["p"])
            mm["persistence_mae"] = _metrics(gk["y"], gk["pers"]).get("mae")
            mm["day_ahead"] = int(k)
            daily_metrics.append(mm)

    # 5b. độ quan trọng hoán vị (mẫu 20.000 dòng kiểm thử)
    rng = np.random.default_rng(42)
    idx = rng.choice(len(te["y"]), size=min(20000, len(te["y"])), replace=False)
    imp = permutation_importance(final, te["X"][idx], te["y"][idx], n_repeats=3, random_state=42,
                                 scoring="neg_mean_squared_error")
    importance = sorted(zip(te["cols"], imp.importances_mean), key=lambda x: -x[1])
    total = sum(max(v, 0) for _, v in importance) or 1.0
    importance = [{"feature": f, "share": round(100 * max(v, 0) / total, 2)} for f, v in importance[:15]]

    bundle = {
        "pollutant": p, "model": final, "model_name": best, "features": te["cols"],
        "clim": clim_tab, "wx_clim": wx_clim, "trained_at": datetime.now().isoformat(timespec="seconds"),
        "data_period": [str(obs.index.min()), str(obs.index.max())],
        "split": {"validation_start": str(val_start), "test_start": str(test_start)},
        "validation": scores, "metrics": metrics, "daily": daily_metrics, "importance": importance,
        "horizons": C.TRAIN_HORIZONS, "extra_wx": list(extra),
    }
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump(bundle, os.path.join(out_dir, f"{p}.joblib"), compress=3)
    log(f"   [{p}] => {best}: RMSE kiểm thử {metrics['model']['all'].get('rmse')} "
        f"(bền vững {metrics['persistence']['all'].get('rmse')})")
    # dự báo kiểm thử để vẽ hình báo cáo
    sample = pd.DataFrame({"issue": te["issue"], "target_time": te["target_time"], "h": h, "y": y, "pred": pred})
    return bundle, sample


def train_all(city: pd.DataFrame, pollutants=None, model_names=("hgb", "xgb"), log=print, out_dir=None, extra=None):
    out_dir = out_dir or C.MODEL_DIR
    pollutants = pollutants or C.FORECAST_POLLUTANTS
    summary, samples = {}, {}
    for p in pollutants:
        if p not in city.columns:
            continue
        res = train_pollutant(city, p, model_names, log, out_dir, extra=extra)
        if res is None:
            continue
        bundle, sample = res
        samples[p] = sample
        summary[p] = {k: bundle[k] for k in ("model_name", "trained_at", "data_period", "split", "validation",
                                             "metrics", "daily", "importance", "extra_wx")}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    return summary, samples


def save_figures(summary: dict, samples: dict, out_dir=None):
    """Hình minh họa cho báo cáo (cần matplotlib)."""
    out_dir = os.path.join(out_dir or C.MODEL_DIR, "figures")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return []
    os.makedirs(out_dir, exist_ok=True)
    files = []
    names = {p: C.POLLUTANTS[p]["name"] for p in summary}
    # 1. RMSE theo nhóm hạn: mô hình vs bền vững
    fig, axes = plt.subplots(2, 3, figsize=(13, 7))
    for ax, p in zip(axes.ravel(), summary):
        m = summary[p]["metrics"]
        labels = [b[2] for b in BINS]
        x = np.arange(len(labels))
        for i, (key, lab) in enumerate((("model", summary[p]["model_name"]), ("persistence", "Bền vững"),
                                       ("climatology", "Khí hậu"))):
            ax.bar(x + (i - 1) * 0.27, [m[key][b].get("rmse", np.nan) for b in labels], width=0.27, label=lab)
        ax.set_xticks(x, labels)
        ax.set_title(f"{names[p]} (µg/m³)")
        ax.legend(fontsize=7)
    fig.suptitle("RMSE trên tập kiểm thử theo nhóm hạn dự báo")
    fig.tight_layout()
    path = os.path.join(out_dir, "rmse_by_horizon.png"); fig.savefig(path, dpi=150); plt.close(fig); files.append(path)
    # 2. Chuỗi kiểm thử PM2.5 hạn 24h và 72h
    if "pm2_5" in samples:
        s = samples["pm2_5"]
        fig, ax = plt.subplots(figsize=(13, 4))
        for hh, color in ((24, "tab:orange"), (72, "tab:green")):
            d = s[s["h"] == hh].sort_values("target_time").tail(24 * 45)
            ax.plot(d["target_time"], d["pred"], color=color, lw=1, label=f"Dự báo hạn {hh}h")
        d = s[s["h"] == 24].sort_values("target_time").tail(24 * 45)
        ax.plot(d["target_time"], d["y"], color="black", lw=1.2, label="Giá trị đồng nhất (thực)")
        ax.set_ylabel("PM2.5 (µg/m³)")
        ax.legend()
        fig.tight_layout()
        path = os.path.join(out_dir, "pm25_test_series.png"); fig.savefig(path, dpi=150); plt.close(fig); files.append(path)
    # 3. MAE trung bình ngày theo số ngày dự báo
    fig, ax = plt.subplots(figsize=(8, 4))
    for p in summary:
        d = summary[p]["daily"]
        if d:
            ax.plot([r["day_ahead"] + 1 for r in d], [r["mae"] / max(np.mean([r["mae"] for r in d]), 1e-9) for r in d],
                    marker="o", label=names[p])
    ax.set_xlabel("Ngày dự báo thứ"); ax.set_ylabel("MAE ngày (chuẩn hóa)"); ax.legend(fontsize=8)
    fig.tight_layout()
    path = os.path.join(out_dir, "daily_mae_by_lead.png"); fig.savefig(path, dpi=150); plt.close(fig); files.append(path)
    return files
