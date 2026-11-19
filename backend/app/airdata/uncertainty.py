"""
DỰ BÁO XÁC SUẤT VÀ KHOẢNG BẤT ĐỊNH (PROBABILISTIC FORECAST)

Phương pháp: "ensemble thực nghiệm" từ sai số dự báo trên tập kiểm thử độc lập theo thời gian
(split-conformal theo nhóm hạn). Với chất p và nhóm hạn g (ngày dự báo thứ 1..8: h = 1-24, 25-48, ...):
    r = log(1 + y) − log(1 + ŷ)                       (sai số tương đối, ổn định phương sai)
    M thành viên:  Ĉ_m = (1 + ŷ) · exp(r_m) − 1,  r_m = phân vị thứ (m − 0,5)/M của r trong nhóm g
    Xác suất vượt ngưỡng:  p̂(T) = (1/M) Σ_m 1{Ĉ_m > T}
    Khoảng dự báo 90%:     [q05, q95] của {Ĉ_m};  trung vị q50
Thống kê NGÀY (TB 24 giờ hoặc cực đại TB 8 giờ) dùng vectơ sai số ngày [r_ngày1..r_ngày8] của cùng một lần
phát hành (giữ tương quan giữa các ngày) -> P(vượt 2 ngày liên tục) tính trực tiếp, không giả định độc lập.

Đánh giá độ tin cậy (trên phần SAU của tập kiểm thử, phần đầu dùng để hiệu chỉnh):
    PICP = #{L ≤ y ≤ U} / N  (mục tiêu ≈ 90%),  độ rộng khoảng, pinball loss, CRPS
    Brier = mean(p − o)²,  Brier skill so với tần suất khí hậu, reliability diagram, ECE
    Precision/Recall/F1 (q50 > T) và PR-AUC (theo p̂); KTC 95% bằng block bootstrap theo NGÀY phát hành
Dự phòng khi chưa chạy hiệu chỉnh: phân phối chuẩn quanh ŷ − bias với σ = RMSE kiểm thử của nhóm hạn.
"""
import json
import os

import numpy as np
import pandas as pd

from app.airdata import config as C

N_DAYS = 8


def lead_group(h):
    """Nhóm hạn theo ngày: h = 1..24 -> 0, 25..48 -> 1, ..., ≥ 169 -> 7."""
    h = np.asarray(h, dtype=float)
    return np.clip(np.floor((h - 1) / 24), 0, N_DAYS - 1).astype(int)


def log_resid(y, yhat):
    return np.log1p(np.clip(np.asarray(y, float), 0, None)) - np.log1p(np.clip(np.asarray(yhat, float), 0, None))


def _levels(M):
    return (np.arange(M) + 0.5) / M


def residual_quantiles(r, M=None):
    M = M or C.N_RESIDUAL_SAMPLES
    r = np.asarray(r, float)
    r = r[np.isfinite(r)]
    if len(r) < 20:
        return None
    return np.quantile(r, _levels(M)).round(5).tolist()


# ------------------------------------------------------------------------------
# CÁC THƯỚC ĐO
# ------------------------------------------------------------------------------
def picp(y, lo, hi):
    y, lo, hi = (np.asarray(a, float) for a in (y, lo, hi))
    ok = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
    return float(np.mean((y[ok] >= lo[ok]) & (y[ok] <= hi[ok]))) if ok.any() else np.nan


def pinball(y, q, tau):
    d = np.asarray(y, float) - np.asarray(q, float)
    return float(np.nanmean(np.maximum(tau * d, (tau - 1) * d)))


def crps_ensemble(y, X):
    """CRPS cho ensemble đã sắp xếp X[n, M] (công thức O(M) trên mẫu đã sắp)."""
    X = np.sort(np.asarray(X, float), axis=1)
    y = np.asarray(y, float)[:, None]
    M = X.shape[1]
    i = np.arange(1, M + 1)[None, :]
    val = (2.0 / M ** 2) * np.sum((X - y) * (M * (y < X) - i + 0.5), axis=1)
    return float(np.nanmean(val))


def brier(p, o):
    p, o = np.asarray(p, float), np.asarray(o, float)
    ok = np.isfinite(p) & np.isfinite(o)
    return float(np.mean((p[ok] - o[ok]) ** 2)) if ok.any() else np.nan


def reliability(p, o, bins=10):
    p, o = np.asarray(p, float), np.asarray(o, float)
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    rows, ece, n = [], 0.0, len(p)
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        pm, om = float(p[m].mean()), float(o[m].mean())
        rows.append({"bin": f"{edges[b]:.1f}-{edges[b + 1]:.1f}", "p_mean": round(pm, 4), "o_freq": round(om, 4),
                     "n": int(m.sum())})
        ece += m.sum() / n * abs(pm - om)
    return rows, round(float(ece), 4)


def classification(p, o, q50_exceed):
    from sklearn.metrics import average_precision_score
    o = np.asarray(o, bool)
    pred = np.asarray(q50_exceed, bool)
    tp, fp, fn = int((pred & o).sum()), int((pred & ~o).sum()), int((~pred & o).sum())
    prec = tp / (tp + fp) if tp + fp else np.nan
    rec = tp / (tp + fn) if tp + fn else np.nan
    f1 = 2 * prec * rec / (prec + rec) if (tp and np.isfinite(prec) and np.isfinite(rec)) else (0.0 if o.any() else np.nan)
    ap = float(average_precision_score(o, p)) if 0 < o.sum() < len(o) else np.nan
    return {"precision": _r(prec), "recall": _r(rec), "f1": _r(f1), "pr_auc": _r(ap), "base_rate": _r(o.mean()),
            "n_events": int(o.sum())}


def _r(v, nd=4):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


def block_bootstrap(blocks, fn, n_boot=300, seed=42):
    """KTC 95% của thống kê fn(mask) khi lấy mẫu lại theo khối (ngày phát hành) có hoàn lại."""
    blocks = np.asarray(blocks)
    uniq = np.unique(blocks)
    if len(uniq) < 5:
        return None
    rng = np.random.default_rng(seed)
    pos = {b: np.where(blocks == b)[0] for b in uniq}
    vals = []
    for _ in range(n_boot):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([pos[b] for b in pick])
        v = fn(idx)
        if np.isfinite(v):
            vals.append(v)
    if len(vals) < 20:
        return None
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


# ------------------------------------------------------------------------------
# HIỆU CHỈNH TỪ SAI SỐ KIỂM THỬ (chạy trong scripts/airdata_analytics.py)
# ------------------------------------------------------------------------------
def daily_stat_kind(pollutant):
    return "max8" if pollutant == "o3" else "mean24"


def _daily_table(daily_rec: pd.DataFrame, pollutant: str) -> pd.DataFrame:
    """daily_rec: issue, h (1..192), y, yhat (phát hành 00:00) -> bảng (issue, day, y_stat, yhat_stat)."""
    d = daily_rec.copy()
    d["day"] = lead_group(d["h"])
    kind = daily_stat_kind(pollutant)
    rows = []
    for (iss, day), g in d.groupby(["issue", "day"]):
        g = g.sort_values("h")
        if g["y"].notna().sum() < C.QC_MIN_HOURS_24H:
            continue
        if kind == "max8":
            ys = g["y"].rolling(8, min_periods=6).mean().max()
            ps = g["yhat"].rolling(8, min_periods=6).mean().max()
        else:
            ys, ps = g["y"].mean(), g["yhat"].mean()
        rows.append((iss, int(day), float(ys), float(ps)))
    return pd.DataFrame(rows, columns=["issue", "day", "y", "yhat"])


def _thresholds_for(pollutant, day=None):
    """Ngưỡng ngày dùng đánh giá xác suất: QCVN và WHO (theo đúng kỳ trung bình)."""
    from app.airdata import standards as S
    out = {}
    kind = daily_stat_kind(pollutant)
    want = "8h" if kind == "max8" else "24h"
    for std in ("qcvn", "who"):
        v = S.limits(std, day).get(pollutant, {}).get(want)
        if v:
            out[std] = float(v)
    return out


def fit_and_evaluate(hourly_rec: pd.DataFrame, daily_rec: pd.DataFrame, pollutant: str,
                     calib_frac: float = 0.5, M: int = None) -> dict:
    """hourly_rec: issue, target_time, h, y, yhat (tập kiểm thử). daily_rec: như trên, phát hành 00:00, h 1..192.

    1) Chia theo thời gian phát hành: nửa đầu -> hiệu chỉnh phân vị sai số; nửa sau -> đánh giá độc lập.
    2) Mô hình vận hành dùng TOÀN BỘ tập kiểm thử để ước lượng phân vị sai số.
    """
    M = M or C.N_RESIDUAL_SAMPLES
    hr = hourly_rec.dropna(subset=["y", "yhat"]).copy()
    hr["g"] = lead_group(hr["h"])
    hr["r"] = log_resid(hr["y"], hr["yhat"])
    issues = np.sort(hr["issue"].unique())
    cut = issues[int(len(issues) * calib_frac)] if len(issues) > 10 else issues[-1]
    cal, ev = hr[hr["issue"] < cut], hr[hr["issue"] >= cut]
    lv = _levels(M)
    out = {"pollutant": pollutant, "method": "empirical_log_residual", "M": M,
           "calibration_period": [str(cal["issue"].min()), str(cal["issue"].max())] if len(cal) else None,
           "evaluation_period": [str(ev["issue"].min()), str(ev["issue"].max())] if len(ev) else None,
           "hourly": {}, "evaluation": {"hourly": {}, "daily": {}}}
    # --- phân vị sai số vận hành (toàn bộ tập kiểm thử)
    for g, gg in hr.groupby("g"):
        q = residual_quantiles(gg["r"], M)
        if q:
            out["hourly"][str(int(g))] = q
    # --- đánh giá độc lập theo giờ
    i05, i50, i95 = int(0.05 * M), int(0.5 * M), int(0.95 * M) - 1
    hourly_T = C.ROSE_DEFAULT_T.get(pollutant)
    for g, gg in ev.groupby("g"):
        qc = residual_quantiles(cal.loc[cal["g"] == g, "r"], M)
        if not qc:
            continue
        qc = np.asarray(qc)
        base = np.log1p(np.clip(gg["yhat"].to_numpy(float), 0, None))[:, None]
        ens = np.expm1(base + qc[None, :]).clip(min=0)
        y = gg["y"].to_numpy(float)
        lo, med, hi = ens[:, i05], ens[:, i50], ens[:, i95]
        blocks = pd.to_datetime(gg["issue"]).dt.normalize().to_numpy()
        hit = (y >= lo) & (y <= hi)
        rec = {"n": int(len(y)), "picp90": _r(hit.mean()), "width90": _r(np.mean(hi - lo), 3),
               "picp90_ci": block_bootstrap(blocks, lambda idx: float(hit[idx].mean())),
               "pinball_q05": _r(pinball(y, lo, 0.05), 3), "pinball_q95": _r(pinball(y, hi, 0.95), 3),
               "crps": _r(crps_ensemble(y[:5000], ens[:5000]), 3),
               "mae_q50": _r(np.mean(np.abs(med - y)), 3)}
        if hourly_T:
            p = (ens > hourly_T).mean(axis=1)
            o = (y > hourly_T).astype(float)
            rec["threshold"] = hourly_T
            rec["brier"] = _r(brier(p, o))
            rec["base_rate"] = _r(o.mean())
        out["evaluation"]["hourly"][str(int(g))] = rec
    # --- ngày: vectơ sai số theo lần phát hành (giữ tương quan giữa các ngày)
    if daily_rec is not None and len(daily_rec):
        dt = _daily_table(daily_rec.dropna(subset=["yhat"]), pollutant)
        dt["r"] = log_resid(dt["y"], dt["yhat"])
        piv = dt.pivot_table(index="issue", columns="day", values="r").reindex(columns=range(N_DAYS))
        rng = np.random.default_rng(42)
        keep = piv.index if len(piv) <= 400 else rng.choice(piv.index, 400, replace=False)
        out["daily_joint"] = [[None if not np.isfinite(v) else round(float(v), 5) for v in row]
                              for row in piv.loc[sorted(keep)].to_numpy()]
        out["daily_kind"] = daily_stat_kind(pollutant)
        iss = np.sort(dt["issue"].unique())
        cut_d = iss[int(len(iss) * calib_frac)] if len(iss) > 10 else iss[-1]
        thr = _thresholds_for(pollutant)
        for day in range(N_DAYS):
            cal_r = dt[(dt["issue"] < cut_d) & (dt["day"] == day)]["r"].to_numpy()
            evd = dt[(dt["issue"] >= cut_d) & (dt["day"] == day)]
            if len(cal_r) < 15 or len(evd) < 10:
                continue
            qc = np.quantile(cal_r[np.isfinite(cal_r)], lv)
            ens = np.expm1(np.log1p(np.clip(evd["yhat"].to_numpy(float), 0, None))[:, None] + qc[None, :]).clip(min=0)
            y = evd["y"].to_numpy(float)
            lo, med, hi = ens[:, i05], ens[:, i50], ens[:, i95]
            hit = (y >= lo) & (y <= hi)
            blocks = pd.to_datetime(evd["issue"]).to_numpy()
            rec = {"n": int(len(y)), "picp90": _r(hit.mean()), "width90": _r(np.mean(hi - lo), 3),
                   "picp90_ci": block_bootstrap(blocks, lambda idx: float(hit[idx].mean())),
                   "mae_q50": _r(np.mean(np.abs(med - y)), 3), "thresholds": {}}
            for std, T in thr.items():
                p = (ens > T).mean(axis=1)
                o = (y > T).astype(float)
                clim = float((dt[(dt["issue"] < cut_d) & (dt["day"] == day)]["y"] > T).mean())
                bs = brier(p, o)
                bs_ref = brier(np.full(len(o), clim), o)
                rel, ece = reliability(p, o)
                rec["thresholds"][std] = {
                    "T": T, "brier": _r(bs), "brier_climatology": _r(bs_ref),
                    "brier_skill": _r(1 - bs / bs_ref) if bs_ref and bs_ref > 0 else None,
                    "brier_ci": block_bootstrap(blocks, lambda idx: brier(p[idx], o[idx])),
                    "ece": ece, "reliability": rel, **classification(p, o, med > T)}
            out["evaluation"]["daily"][str(day)] = rec
    return out


def save(results: dict, path: str = None):
    path = path or C.UNCERTAINTY_FILE
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)
    return path


# ------------------------------------------------------------------------------
# MÔ HÌNH SAI SỐ DÙNG KHI VẬN HÀNH
# ------------------------------------------------------------------------------
class ResidualModel:
    """Sinh ensemble M thành viên cho dự báo điểm của từng chất."""

    def __init__(self, data: dict = None, metrics: dict = None):
        self.data = data or {}
        self.metrics = metrics or {}
        self.M = C.N_RESIDUAL_SAMPLES
        self._z = None

    @classmethod
    def load(cls, model_dir: str = None):
        model_dir = model_dir or C.MODEL_DIR
        data, metrics = {}, {}
        try:
            with open(os.path.join(model_dir, "uncertainty.json"), encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
        try:
            with open(os.path.join(model_dir, "metrics.json"), encoding="utf-8") as f:
                metrics = json.load(f)
        except Exception:
            pass
        return cls(data, metrics)

    def method(self, p):
        if p in self.data and self.data[p].get("hourly"):
            return "empirical"
        if p in self.metrics:
            return "gaussian_rmse"
        return "none"

    def describe(self, p):
        m = self.method(p)
        if m == "empirical":
            d = self.data[p]
            return (f"Ensemble thực nghiệm {self.M} thành viên từ sai số log trên tập kiểm thử độc lập "
                    f"(hiệu chỉnh {d.get('calibration_period')}, kiểm chứng {d.get('evaluation_period')}).")
        if m == "gaussian_rmse":
            return ("Xấp xỉ chuẩn quanh dự báo với σ = RMSE kiểm thử theo nhóm hạn (CHƯA hiệu chỉnh; "
                    "chạy scripts/airdata_analytics.py để có phân phối thực nghiệm).")
        return "Chưa có thông tin sai số: chỉ có dự báo điểm."

    def _z_levels(self):
        if self._z is None:
            from scipy.stats import norm
            self._z = norm.ppf(_levels(self.M))
        return self._z

    def _gauss_params(self, p, h):
        bins = {"1-24h": (1, 24), "25-72h": (25, 72), "73-192h": (73, 10 ** 6)}
        m = self.metrics.get(p, {}).get("metrics", {}).get("model", {})
        h = np.asarray(h, float)
        sd = np.full(len(h), np.nan)
        bias = np.zeros(len(h))
        for name, (a, b) in bins.items():
            rec = m.get(name, {})
            sel = (h >= a) & (h <= b)
            if rec.get("rmse") is not None:
                sd[sel] = rec["rmse"]
                bias[sel] = rec.get("bias", 0.0) or 0.0
        return sd, bias

    def ensemble(self, p, yhat, h):
        """Ma trận [n, M] các thành viên ensemble cho dự báo ŷ ở hạn h (giờ)."""
        yhat = np.clip(np.asarray(yhat, float), 0, None)
        h = np.asarray(h, float)
        n = len(yhat)
        if self.method(p) == "empirical":
            tab = self.data[p]["hourly"]
            g = lead_group(h)
            ens = np.full((n, self.M), np.nan)
            base = np.log1p(yhat)
            for gi in np.unique(g):
                key = str(int(gi))
                q = tab.get(key) or tab.get(max(tab, key=lambda k: int(k)))
                q = np.asarray(q, float)
                if len(q) != self.M:
                    q = np.interp(_levels(self.M), _levels(len(q)), q)
                sel = g == gi
                ens[sel] = np.expm1(base[sel, None] + q[None, :])
            return ens.clip(min=0)
        if self.method(p) == "gaussian_rmse":
            sd, bias = self._gauss_params(p, h)
            sd = np.where(np.isfinite(sd), sd, np.nanmax(sd) if np.isfinite(sd).any() else 0.0)
            return (yhat[:, None] - bias[:, None] + sd[:, None] * self._z_levels()[None, :]).clip(min=0)
        return np.repeat(yhat[:, None], self.M, axis=1)

    def quantiles(self, p, yhat, h, qs=None):
        qs = qs or C.QUANTILES
        ens = self.ensemble(p, yhat, h)
        return {f"q{int(round(q * 100)):02d}": np.quantile(ens, q, axis=1) for q in qs}

    def p_exceed(self, p, yhat, h, T):
        return (self.ensemble(p, yhat, h) > T).mean(axis=1)

    # ---------------------------------------------------------------- thống kê ngày
    def daily_residuals(self, p):
        """Ma trận [n_issue, 8] sai số log của thống kê ngày (có thể NaN) hoặc None."""
        d = self.data.get(p, {}).get("daily_joint")
        if not d:
            return None
        return np.array([[np.nan if v is None else v for v in row] for row in d], dtype=float)

    def _daily_gauss_sd(self, p):
        rows = self.metrics.get(p, {}).get("daily") or []
        sd = np.full(N_DAYS, np.nan)
        for r in rows:
            k = int(r.get("day_ahead", -1))
            if 0 <= k < N_DAYS and r.get("mae") is not None:
                sd[k] = 1.2533 * r["mae"]   # σ ≈ √(π/2)·MAE với sai số chuẩn
        if np.isfinite(sd).any():
            sd = pd.Series(sd).ffill().bfill().to_numpy()
        return sd

    def daily_ensemble(self, p, stat_by_day, forecast_frac=None):
        """stat_by_day: mảng [n_ward, n_day] thống kê ngày dự báo (TB 24h hoặc max 8h).
        forecast_frac: [n_day] tỷ lệ giờ là dự báo (ngày hôm nay một phần đã có số liệu) -> co sai số.
        Trả về mảng [n_ward, n_day, M]."""
        S = np.clip(np.asarray(stat_by_day, float), 0, None)
        nw, nd = S.shape
        frac = np.ones(nd) if forecast_frac is None else np.clip(np.asarray(forecast_frac, float), 0, 1)
        R = self.daily_residuals(p)
        if R is not None and len(R) >= 20:
            # dùng cùng một bộ vectơ phát hành cho mọi ngày -> giữ tương quan giữa các ngày
            R = np.where(np.isfinite(R), R, np.nanmedian(R, axis=0, keepdims=True))
            R = np.where(np.isfinite(R), R, 0.0)
            idx = np.linspace(0, len(R) - 1, self.M).round().astype(int)
            Rm = R[idx][:, :nd] * frac[None, :nd]            # [M, nd]
            return np.expm1(np.log1p(S)[:, :, None] + Rm.T[None, :, :]).clip(min=0)
        sd = self._daily_gauss_sd(p)
        if np.isfinite(sd).any():
            z = self._z_levels()
            return (S[:, :, None] + (sd[None, :nd, None] * frac[None, :nd, None]) * z[None, None, :]).clip(min=0)
        return np.repeat(S[:, :, None], self.M, axis=2)


_MODEL = {"obj": None, "mtime": None}


def residual_model() -> ResidualModel:
    """Nạp lại khi uncertainty.json/metrics.json thay đổi."""
    paths = [os.path.join(C.MODEL_DIR, f) for f in ("uncertainty.json", "metrics.json")]
    mt = tuple(os.path.getmtime(p) if os.path.exists(p) else 0 for p in paths)
    if _MODEL["obj"] is None or _MODEL["mtime"] != mt:
        _MODEL["obj"] = ResidualModel.load()
        _MODEL["mtime"] = mt
    return _MODEL["obj"]
