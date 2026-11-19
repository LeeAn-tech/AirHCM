"""
GIẢI THUẬT ĐỒNG NHẤT DỮ LIỆU ĐA NGUỒN (SPATIO-TEMPORAL HARMONIZATION)

Mục tiêu: từ các nguồn có độ phân giải khác nhau
    CAMS (0,4° ≈ 45 km; 3 giờ -> nội suy giờ), CAMS-GHG (0,1°), Sentinel-5P / MAIAC (≈1 km; 1 ngày, có mây),
    ERA5-Land (0,1° ≈ 11 km; 1 giờ, trễ ~5 ngày), Open-Meteo Weather (≈ 9-11 km; 1 giờ, dự báo)
tạo MỘT bộ dữ liệu thống nhất: theo GIỜ (giờ Việt Nam) × 168 PHƯỜNG/XÃ.

Các bước:
  B1. Đồng bộ thời gian: đưa mọi nguồn về giờ địa phương UTC+7, lưới giờ đầy đủ; khoảng trống ≤ 3 giờ
      nội suy tuyến tính, dài hơn để trống và gắn cờ.
  B2. Nội suy không gian CAMS: nội suy SONG TUYẾN từ 4 nút lưới 0,4° bao quanh điểm đại diện phường;
      nút thiếu giá trị -> chuẩn hóa lại trọng số trên các nút còn lại.
  B3. Hạ quy mô (downscaling) bằng tỷ số vệ tinh:
          C_w(t) = B_w(t) · f_w,p(d),   f = clip(1 + α_p (R_w,p(d) − 1), 0,5, 2,0)
      R là tỷ số "phường / vùng lân cận ~22 km" của ảnh tổ hợp 30 ngày (tính trên GEE),
      α_p là hệ số co theo chất (NO2 0,8; PM 0,6 (AOD MAIAC); CO 0,5; SO2 0,3; O3 0).
      Sau đó chuẩn hóa BẢO TOÀN KHỐI LƯỢNG: trung bình có trọng số diện tích của f trên toàn TP = 1,
      để tổng lượng ô nhiễm vẫn khớp trường CAMS gốc.
      Ngày chưa có ảnh vệ tinh: giữ hệ số gần nhất (≤ 45 ngày), quá hạn -> f = 1.
  B4. Khí tượng: ưu tiên ERA5-Land; các giờ ERA5 chưa có (5 ngày gần nhất + tương lai) dùng Open-Meteo
      đã HIỆU CHỈNH ĐỘ LỆCH theo cửa sổ chồng lấp 72 giờ (cộng cho nhiệt độ/điểm sương/áp suất,
      nhân cho tốc độ gió); độ ẩm tính lại từ T và Td. Phường thiếu hẳn số liệu -> nội suy IDW
      từ 4 phường gần nhất.
  B5. Chuỗi cấp thành phố = trung bình có trọng số diện tích của 168 phường (dùng huấn luyện mô hình).

Cờ chất lượng (bitmask cột `co_hieu`):
  1 = CAMS được nội suy thời gian | 2 = hệ số vệ tinh lấy theo ngày gần nhất/mặc định
  4 = khí tượng Open-Meteo (đã hiệu chỉnh) | 8 = khí tượng nội suy không gian | 16 = giờ dự báo (tương lai)
"""
import math

import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata.sources_gee import relative_humidity

POLL_KEYS = list(C.POLLUTANTS.keys())
CAMS_KEYS = POLL_KEYS + list(C.CAMS_EXTRA.keys())
WX_KEYS = ["temperature_2m", "dewpoint_2m", "relative_humidity", "wind_speed", "wind_dir",
           "precipitation", "surface_pressure"]

FLAG_CAMS_INTERP, FLAG_SAT_FILL, FLAG_WX_OM, FLAG_WX_IDW, FLAG_FUTURE = 1, 2, 4, 8, 16


# ------------------------------------------------------------------------------
# B2. TRỌNG SỐ NỘI SUY SONG TUYẾN
# ------------------------------------------------------------------------------
def bilinear_weights(wards: pd.DataFrame, nodes: list, step: float = C.CAMS_GRID_STEP) -> np.ndarray:
    """Ma trận W[phường, nút]: trọng số song tuyến của 4 nút bao quanh điểm đại diện."""
    index = {(round(a, 4), round(b, 4)): i for i, (a, b) in enumerate(nodes)}
    W = np.zeros((len(wards), len(nodes)))
    for wi, (lat, lon) in enumerate(zip(wards["lat"], wards["lng"])):
        la0 = math.floor(lat / step) * step
        lo0 = math.floor(lon / step) * step
        ty = (lat - la0) / step
        tx = (lon - lo0) / step
        corners = [((la0, lo0), (1 - ty) * (1 - tx)), ((la0, lo0 + step), (1 - ty) * tx),
                   ((la0 + step, lo0), ty * (1 - tx)), ((la0 + step, lo0 + step), ty * tx)]
        for (a, b), w in corners:
            j = index.get((round(a, 4), round(b, 4)))
            if j is not None:
                W[wi, j] += w
    return W


def _masked_matmul(W: np.ndarray, V: np.ndarray) -> np.ndarray:
    """W[w,n] @ V[n,t] bỏ qua NaN và chuẩn hóa lại trọng số trên nút còn giá trị."""
    ok = np.isfinite(V)
    num = W @ np.where(ok, V, 0.0)
    den = W @ ok.astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    out[den < 1e-9] = np.nan
    return out


# ------------------------------------------------------------------------------
# B1. LƯỚI GIỜ ĐẦY ĐỦ + NỘI SUY KHOẢNG TRỐNG NGẮN
# ------------------------------------------------------------------------------
def hourly_index(start, end) -> pd.DatetimeIndex:
    return pd.date_range(pd.Timestamp(start).floor("h"), pd.Timestamp(end).floor("h"), freq="h")


def _fill_short_gaps(s: pd.Series, max_gap: int = C.MAX_INTERP_GAP_H):
    """Nội suy tuyến tính chỉ cho các đoạn thiếu ≤ max_gap giờ; trả về (chuỗi, mặt nạ đã nội suy)."""
    isna = s.isna()
    grp = (isna != isna.shift()).cumsum()
    run = isna.groupby(grp).transform("sum")
    interp = s.interpolate(limit_area="inside")
    fill_mask = isna & (run <= max_gap) & interp.notna()
    out = s.copy()
    out[fill_mask] = interp[fill_mask]
    return out, fill_mask


def cams_to_wards(cams: pd.DataFrame, wards: pd.DataFrame, times: pd.DatetimeIndex):
    """B1 + B2: CAMS tại nút -> giá trị nền B_w(t) tại phường. Trả về (dict biến -> mảng [w,t], cờ [w,t])."""
    nodes = sorted({(round(a, 4), round(b, 4)) for a, b in zip(cams["node_lat"], cams["node_lon"])})
    W = bilinear_weights(wards, nodes)
    flags = np.zeros((len(wards), len(times)), dtype=np.int16)
    out = {}
    cams = cams.assign(node=list(zip(cams["node_lat"].round(4), cams["node_lon"].round(4))))
    for key in CAMS_KEYS:
        if key not in cams.columns:
            continue
        piv = cams.pivot_table(index="thoi_gian", columns="node", values=key, aggfunc="mean")
        piv = piv.reindex(index=times, columns=nodes)
        node_flag = np.zeros(piv.shape, dtype=bool)
        for j, col in enumerate(piv.columns):
            filled, m = _fill_short_gaps(piv[col])
            piv[col] = filled
            node_flag[:, j] = m.to_numpy()
        V = piv.to_numpy(dtype=float).T  # [n, t]
        out[key] = _masked_matmul(W, V)
        if key in C.AQI_POLLUTANTS:
            touched = (W > 0).astype(float) @ node_flag.T.astype(float)
            flags |= np.where(touched > 0, FLAG_CAMS_INTERP, 0).astype(np.int16)
    return out, flags


# ------------------------------------------------------------------------------
# B3. HỆ SỐ HẠ QUY MÔ TỪ VỆ TINH
# ------------------------------------------------------------------------------
def satellite_factors(sat: pd.DataFrame, wards: pd.DataFrame, days: pd.DatetimeIndex,
                      max_carry_days: int = 45):
    """Hệ số f[chất] dạng mảng [w, ngày] + cờ đã lấp. sat: ma_phuong_xa, ngay, r_no2, r_so2, r_co, r_aod."""
    codes = wards["code"].astype(str).tolist()
    area = wards["area"].fillna(wards["area"].median()).clip(lower=0.01).to_numpy()
    factors, filled_any = {}, np.zeros((len(codes), len(days)), dtype=bool)
    for p, meta in C.POLLUTANTS.items():
        pat, alpha = meta["pattern"], meta["alpha"]
        if not pat or alpha <= 0 or sat is None or sat.empty or f"r_{pat}" not in sat.columns:
            factors[p] = np.ones((len(codes), len(days)))
            continue
        piv = (sat.assign(ma_phuong_xa=sat["ma_phuong_xa"].astype(str), ngay=pd.to_datetime(sat["ngay"]))
               .pivot_table(index="ngay", columns="ma_phuong_xa", values=f"r_{pat}", aggfunc="mean"))
        piv = piv.reindex(columns=codes)
        piv = piv.reindex(piv.index.union(days)).sort_index()
        raw_known = piv.notna()
        piv = piv.ffill(limit=max_carry_days)
        piv = piv.reindex(days)
        known = raw_known.reindex(days).fillna(False).to_numpy().T
        R = piv.to_numpy(dtype=float).T  # [w, d]
        f = 1.0 + alpha * (R - 1.0)
        f = np.where(np.isfinite(f), f, 1.0)
        f = np.clip(f, *C.RATIO_CLIP)
        # Bảo toàn khối lượng: trung bình trọng số diện tích = 1 cho từng ngày
        mean = (area[:, None] * f).sum(axis=0) / area.sum()
        f = f / np.where(mean > 0, mean, 1.0)
        factors[p] = f
        filled_any |= ~known
    return factors, filled_any


# ------------------------------------------------------------------------------
# B4. KHÍ TƯỢNG: GHÉP ERA5-LAND + OPEN-METEO (HIỆU CHỈNH ĐỘ LỆCH) + IDW
# ------------------------------------------------------------------------------
def _pivot(df, key, times, codes):
    if df is None or df.empty or key not in df.columns:
        return np.full((len(codes), len(times)), np.nan)
    piv = df.assign(ma_phuong_xa=df["ma_phuong_xa"].astype(str)).pivot_table(
        index="thoi_gian", columns="ma_phuong_xa", values=key, aggfunc="mean")
    return piv.reindex(index=times, columns=codes).to_numpy(dtype=float).T


def merge_weather(era5: pd.DataFrame, om: pd.DataFrame, wards: pd.DataFrame, times: pd.DatetimeIndex):
    codes = wards["code"].astype(str).tolist()
    flags = np.zeros((len(codes), len(times)), dtype=np.int16)
    out = {}
    era = {k: _pivot(era5, k, times, codes) for k in WX_KEYS}
    omv = {k: _pivot(om, k, times, codes) for k in WX_KEYS}
    has_era = np.isfinite(era["temperature_2m"])
    for k in WX_KEYS:
        e, o = era[k], omv[k].copy()
        both = np.isfinite(e) & np.isfinite(o)
        # Cửa sổ chồng lấp: BIAS_WINDOW_H giờ cuối cùng có cả hai nguồn (theo từng phường)
        if both.any() and k in ("temperature_2m", "dewpoint_2m", "surface_pressure", "wind_speed"):
            for wi in range(len(codes)):
                idx = np.where(both[wi])[0][-C.BIAS_WINDOW_H:]
                if len(idx) < 24:
                    continue
                if k == "wind_speed":
                    ratio = np.nanmean(e[wi, idx]) / max(np.nanmean(o[wi, idx]), 0.1)
                    o[wi] *= np.clip(ratio, 0.5, 2.0)
                else:
                    o[wi] += np.nanmean(e[wi, idx] - o[wi, idx])
        merged = np.where(np.isfinite(e), e, o)
        out[k] = merged
    use_om = ~has_era & np.isfinite(out["temperature_2m"])
    flags |= np.where(use_om, FLAG_WX_OM, 0).astype(np.int16)
    # Độ ẩm tính lại cho nhất quán với T, Td đã hiệu chỉnh
    rh = relative_humidity(out["temperature_2m"], out["dewpoint_2m"])
    out["relative_humidity"] = np.where(np.isfinite(rh), np.clip(rh, 0, 100), out["relative_humidity"])
    # IDW cho phường thiếu số liệu
    lat = wards["lat"].to_numpy()
    lon = wards["lng"].to_numpy()
    for k in WX_KEYS:
        A = out[k]
        miss = ~np.isfinite(A)
        if not miss.any():
            continue
        for wi in np.where(miss.any(axis=1))[0]:
            d = np.hypot((lat - lat[wi]) * 111.0, (lon - lon[wi]) * 109.0)
            d[wi] = np.inf
            nn = np.argsort(d)[:4]
            w = 1.0 / np.maximum(d[nn], 0.5) ** 2
            vals = A[nn]
            ok = np.isfinite(vals)
            num = (w[:, None] * np.where(ok, vals, 0)).sum(axis=0)
            den = (w[:, None] * ok).sum(axis=0)
            fill = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
            m = miss[wi]
            A[wi, m] = fill[m]
            flags[wi, m & np.isfinite(fill)] |= FLAG_WX_IDW
    return out, flags


# ------------------------------------------------------------------------------
# HÀM CHÍNH
# ------------------------------------------------------------------------------
def harmonize(wards: pd.DataFrame, cams: pd.DataFrame, sat: pd.DataFrame = None,
              era5: pd.DataFrame = None, om_weather: pd.DataFrame = None,
              start=None, end=None, now=None) -> pd.DataFrame:
    """Trả về bảng dài đồng nhất: ma_phuong_xa, thoi_gian, <chất>, <khí tượng>, co_hieu.

    wards: code, name, lat, lng, area (km²) - 168 phường/xã.
    cams : node_lat, node_lon, thoi_gian, pm2_5, pm10, co, no2, so2, o3, co2, dust, aod.
    """
    wards = wards.reset_index(drop=True)
    start = start or cams["thoi_gian"].min()
    end = end or cams["thoi_gian"].max()
    times = hourly_index(start, end)
    codes = wards["code"].astype(str).tolist()

    base, flags = cams_to_wards(cams, wards, times)
    days = pd.DatetimeIndex(sorted(set(times.normalize())))
    factors, sat_filled = satellite_factors(sat, wards, days)
    day_pos = days.get_indexer(times.normalize())

    out = {}
    for p in POLL_KEYS:
        if p not in base:
            continue
        out[p] = base[p] * factors[p][:, day_pos]
    for k in C.CAMS_EXTRA:
        if k in base:
            out[k] = base[k]
    flags |= np.where(sat_filled[:, day_pos], FLAG_SAT_FILL, 0).astype(np.int16)

    wx, wx_flags = merge_weather(era5, om_weather, wards, times)
    out.update(wx)
    flags |= wx_flags
    now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
    flags |= np.where((times > now)[None, :], FLAG_FUTURE, 0).astype(np.int16)

    n_w, n_t = len(codes), len(times)
    frame = {"ma_phuong_xa": np.repeat(codes, n_t), "thoi_gian": np.tile(times.values, n_w)}
    for k, arr in out.items():
        frame[k] = arr.reshape(-1).astype(np.float32)
    frame["co_hieu"] = flags.reshape(-1)
    df = pd.DataFrame(frame)
    keep = df[[p for p in POLL_KEYS if p in df.columns]].notna().any(axis=1)
    return df[keep].reset_index(drop=True)


def city_series(ward_hourly: pd.DataFrame, wards: pd.DataFrame) -> pd.DataFrame:
    """B5. Chuỗi cấp TP = trung bình có trọng số diện tích các phường (bỏ qua giá trị thiếu)."""
    area = wards.set_index(wards["code"].astype(str))["area"].fillna(wards["area"].median()).clip(lower=0.01)
    df = ward_hourly.copy()
    df["_a"] = df["ma_phuong_xa"].astype(str).map(area).fillna(area.median())
    value_cols = [c for c in df.columns if c not in ("ma_phuong_xa", "thoi_gian", "co_hieu", "_a")]
    num = df[value_cols].mul(df["_a"], axis=0)
    ok = df[value_cols].notna().mul(df["_a"], axis=0)
    g_num = num.groupby(df["thoi_gian"]).sum(min_count=1)
    g_den = ok.groupby(df["thoi_gian"]).sum()
    city = (g_num / g_den.replace(0, np.nan)).sort_index()
    if "wind_dir" in city.columns:  # trung bình hướng gió theo vector
        rad = np.radians(df["wind_dir"])
        u = (np.sin(rad) * df["_a"]).groupby(df["thoi_gian"]).sum()
        v = (np.cos(rad) * df["_a"]).groupby(df["thoi_gian"]).sum()
        city["wind_dir"] = (np.degrees(np.arctan2(u, v)) + 360) % 360
    city.index.name = "thoi_gian"
    return city.reset_index()
