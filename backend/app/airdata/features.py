"""
ĐẶC TRƯNG CHO MÔ HÌNH DỰ BÁO TRỰC TIẾP ĐA HẠN (DIRECT MULTI-HORIZON)

Mỗi mẫu = (thời điểm phát hành t0, hạn dự báo h); mục tiêu là nồng độ tại T = t0 + h.
Khác bản cũ (dự báo cuốn chiếu từng giờ + hệ số ngày đêm cố định), mô hình trực tiếp không
tích lũy sai số qua các bước và học chu kỳ ngày đêm từ dữ liệu.

Nhóm đặc trưng:
  - Trạng thái tại t0: giá trị trễ 0,1,2,3,6,12,24 giờ; trung bình trượt 6/24/72/168 giờ;
    dị thường so với khí hậu (tháng × giờ); các chất còn lại tại t0 (tương quan chéo).
  - Khí tượng tại T (khi vận hành lấy từ dự báo thời tiết - giả định "perfect prognosis"):
    nhiệt độ, điểm sương, độ ẩm, gió (u, v, tốc độ, TB 6h), mưa (giờ, tổng 24h), áp suất.
  - Lịch tại T: giờ (sin/cos), thứ, cuối tuần, tháng (sin/cos), mùa mưa, dịp Tết Nguyên đán.
  - Hạn dự báo h và khí hậu của chất tại (tháng, giờ) của T.
Mục tiêu học: log(1+y_T) − log(1+y_t0) (biến đổi tương đối, ổn định phương sai).
"""
from datetime import date

import numpy as np
import pandas as pd

from app.airdata import config as C

TET_DAYS = [date(2023, 1, 22), date(2024, 2, 10), date(2025, 1, 29), date(2026, 2, 17),
            date(2027, 2, 6), date(2028, 1, 26)]
WX_FEATURES = ["temperature_2m", "dewpoint_2m", "relative_humidity", "wind_speed", "precipitation",
               "surface_pressure"]
# Khí tượng bổ sung cấp TP (tùy chọn, bảng kk_khituong_bosung_tp_gio): bức xạ, mây, độ cao lớp biên, gió 100 m.
# Chỉ dùng khi mô hình được huấn luyện với --extra-wx (bundle["extra_wx"]); mô hình cũ không bị ảnh hưởng.
EXTRA_WX = ["shortwave_radiation", "cloud_cover", "boundary_layer_height", "wind_speed_100m"]


def complete_hourly(city: pd.DataFrame) -> pd.DataFrame:
    """Chuỗi giờ liên tục, index = thoi_gian."""
    df = city.copy()
    df["thoi_gian"] = pd.to_datetime(df["thoi_gian"])
    df = df.drop_duplicates("thoi_gian").set_index("thoi_gian").sort_index()
    idx = pd.date_range(df.index.min(), df.index.max(), freq="h")
    return df.reindex(idx)


def climatology(series: pd.Series) -> pd.DataFrame:
    """Khí hậu (trung bình) theo tháng × giờ."""
    s = series.dropna()
    tab = s.groupby([s.index.month, s.index.hour]).mean()
    tab.index.names = ["month", "hour"]
    return tab


def clim_lookup(tab: pd.Series, times: pd.DatetimeIndex) -> np.ndarray:
    key = pd.MultiIndex.from_arrays([times.month, times.hour], names=["month", "hour"])
    vals = tab.reindex(key).to_numpy(dtype=float)
    if np.isnan(vals).any():  # tháng chưa có dữ liệu -> khí hậu theo giờ
        by_hour = tab.groupby(level="hour").mean()
        fb = by_hour.reindex(times.hour).to_numpy(dtype=float)
        vals = np.where(np.isnan(vals), fb, vals)
    return vals


def _tet_flag(times: pd.DatetimeIndex) -> np.ndarray:
    d = times.normalize()
    flag = np.zeros(len(times), dtype=np.float32)
    for t in TET_DAYS:
        delta = (d - pd.Timestamp(t)).days
        flag = np.maximum(flag, ((delta >= -3) & (delta <= 5)).astype(np.float32))
    return flag


def _wind_uv(df):
    rad = np.radians(df["wind_dir"].to_numpy(dtype=float)) if "wind_dir" in df else 0
    ws = df["wind_speed"].to_numpy(dtype=float) if "wind_speed" in df else np.nan
    return -ws * np.sin(rad), -ws * np.cos(rad)


def state_features(df: pd.DataFrame, p: str, clim_tab) -> pd.DataFrame:
    """Đặc trưng trạng thái tính tại mọi giờ (dùng làm t0)."""
    y = df[p].astype(float)
    st = pd.DataFrame(index=df.index)
    for L in C.LAGS_H:
        st[f"lag_{L}"] = y.shift(L)
    for w in C.ROLL_H:
        st[f"mean_{w}"] = y.rolling(w, min_periods=max(1, w // 2)).mean()
    st["std_24"] = y.rolling(24, min_periods=12).std()
    st["anom_0"] = y - clim_lookup(clim_tab, df.index)
    for q in C.AQI_POLLUTANTS:
        if q != p and q in df.columns:
            st[f"x_{q}"] = df[q].astype(float)
    return st


def target_features(df: pd.DataFrame, p: str, clim_tab, wx_clim: dict = None, extra=None) -> pd.DataFrame:
    """Đặc trưng tại thời điểm đích T (khí tượng + lịch + khí hậu [+ khí tượng bổ sung nếu extra])."""
    t = df.index
    tf = pd.DataFrame(index=t)
    for k in WX_FEATURES:
        v = df[k].astype(float) if k in df.columns else pd.Series(np.nan, index=t)
        if wx_clim is not None and k in wx_clim:
            v = v.fillna(pd.Series(clim_lookup(wx_clim[k], t), index=t))
        tf[f"w_{k}"] = v
    u, v = _wind_uv(df) if "wind_dir" in df.columns else (np.nan, np.nan)
    tf["w_u"], tf["w_v"] = u, v
    tf["w_wind_6h"] = tf["w_wind_speed"].rolling(6, min_periods=1).mean()
    tf["w_rain_24h"] = tf["w_precipitation"].rolling(24, min_periods=1).sum()
    tf["t_hour_sin"] = np.sin(2 * np.pi * t.hour / 24)
    tf["t_hour_cos"] = np.cos(2 * np.pi * t.hour / 24)
    tf["t_dow"] = t.dayofweek
    tf["t_weekend"] = (t.dayofweek >= 5).astype(np.float32)
    tf["t_month_sin"] = np.sin(2 * np.pi * (t.month - 1) / 12)
    tf["t_month_cos"] = np.cos(2 * np.pi * (t.month - 1) / 12)
    tf["t_rainy_season"] = ((t.month >= 5) & (t.month <= 11)).astype(np.float32)
    tf["t_tet"] = _tet_flag(t)
    tf["clim_T"] = clim_lookup(clim_tab, t)
    for k in extra or []:
        v = df[k].astype(float) if k in df.columns else pd.Series(np.nan, index=t)
        if wx_clim is not None and k in wx_clim and len(wx_clim[k]):
            v = v.fillna(pd.Series(clim_lookup(wx_clim[k], t), index=t))
        tf[f"x_{k}"] = v
    if extra and "boundary_layer_height" in extra:
        tf["x_ventilation"] = tf["x_boundary_layer_height"] * tf["w_wind_speed"]   # hệ số thông gió (m²/s)
    return tf


def assemble(state: pd.DataFrame, target: pd.DataFrame, issue_pos: np.ndarray, horizons: np.ndarray):
    """Ghép (t0, h) -> ma trận đặc trưng. issue_pos, horizons: mảng vị trí cùng độ dài."""
    S = state.to_numpy(dtype=np.float32)[issue_pos]
    T = target.to_numpy(dtype=np.float32)[issue_pos + horizons]
    X = np.hstack([S, T, horizons[:, None].astype(np.float32)])
    cols = list(state.columns) + list(target.columns) + ["horizon"]
    return X, cols


def training_frame(city: pd.DataFrame, p: str, clim_tab, issue_step=None, horizons=None,
                   start=None, end=None, issue_hours=None, extra=None, wx_clim=None):
    """Tập mẫu (X, y_log_change, y_true, y0, issue_time, h) cho chất p trong khoảng phát hành [start, end]."""
    df = complete_hourly(city) if "thoi_gian" in city.columns else city
    state = state_features(df, p, clim_tab)
    target = target_features(df, p, clim_tab, wx_clim if extra else None, extra=extra)
    y = df[p].to_numpy(dtype=float)
    n = len(df)
    horizons = np.array(horizons or C.TRAIN_HORIZONS)
    step = issue_step or C.TRAIN_ISSUE_STEP_H
    first = max(C.ROLL_H) + max(C.LAGS_H)
    pos = np.arange(first, n, step)
    times = df.index
    if start is not None:
        pos = pos[times[pos] >= pd.Timestamp(start)]
    if end is not None:
        pos = pos[times[pos] <= pd.Timestamp(end)]
    if issue_hours is not None:
        pos = pos[np.isin(times[pos].hour, issue_hours)]
    I = np.repeat(pos, len(horizons))
    H = np.tile(horizons, len(pos))
    ok = I + H < n
    I, H = I[ok], H[ok]
    y_t = y[I + H]
    y_0 = y[I]
    valid = np.isfinite(y_t) & np.isfinite(y_0)
    I, H, y_t, y_0 = I[valid], H[valid], y_t[valid], y_0[valid]
    X, cols = assemble(state, target, I, H)
    target_log = np.log1p(np.maximum(y_t, 0)) - np.log1p(np.maximum(y_0, 0))
    return {"X": X, "cols": cols, "y": target_log, "y_true": y_t, "y0": y_0,
            "issue": times[I], "h": H, "target_time": times[I + H]}


def inverse(pred_change, y0):
    return np.expm1(np.log1p(np.maximum(y0, 0)) + pred_change)
