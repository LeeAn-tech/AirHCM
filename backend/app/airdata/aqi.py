"""
TÍNH CHỈ SỐ CHẤT LƯỢNG KHÔNG KHÍ ĐA CHẤT

- VN_AQI theo Quyết định 1459/QĐ-TCMT (12/11/2019): 6 thông số PM2.5, PM10, CO, NO2, SO2, O3;
  AQI giờ của bụi dùng giá trị NowCast 12 giờ; AQI ngày dùng TB 24h (bụi), cực đại 1h (CO, NO2, SO2),
  cực đại 1h và 8h (O3). AQI tổng hợp = giá trị lớn nhất của các AQI thông số.
- US AQI theo US EPA (bảng ngưỡng PM2.5 sửa đổi 02/2024, EPA-454/B-24-002).

Đầu vào là chuỗi nồng độ theo giờ (µg/m³) đã sắp xếp theo thời gian, liên tục từng giờ.
"""
import math

import numpy as np
import pandas as pd

from app.airdata.config import AQI_POLLUTANTS, POLLUTANTS

MOLAR_VOLUME = 24.45  # L/mol ở 25 °C, 1 atm

# ------------------------------------------------------------------------------
# VN_AQI - Bảng 2, QĐ 1459/QĐ-TCMT (đơn vị µg/m³)
# ------------------------------------------------------------------------------
VN_I = [0, 50, 100, 150, 200, 300, 400, 500]
VN_BP = {
    "o3_1h": [0, 160, 200, 300, 400, 800, 1000, 1200],
    "o3_8h": [0, 100, 120, 170, 210, 400],
    "co": [0, 10000, 30000, 45000, 60000, 90000, 120000, 150000],
    "so2": [0, 125, 350, 550, 800, 1600, 2100, 2630],
    "no2": [0, 100, 200, 700, 1200, 2350, 3100, 3850],
    "pm10": [0, 50, 150, 250, 350, 420, 500, 600],
    "pm2_5": [0, 25, 50, 80, 150, 250, 350, 500],
}

# ------------------------------------------------------------------------------
# US AQI - US EPA (PM: µg/m³; O3, CO: ppm; SO2, NO2: ppb)
# ------------------------------------------------------------------------------
US_TABLE = {
    "pm2_5": [(0.0, 9.0, 0, 50), (9.1, 35.4, 51, 100), (35.5, 55.4, 101, 150), (55.5, 125.4, 151, 200),
              (125.5, 225.4, 201, 300), (225.5, 325.4, 301, 500)],
    "pm10": [(0, 54, 0, 50), (55, 154, 51, 100), (155, 254, 101, 150), (255, 354, 151, 200),
             (355, 424, 201, 300), (425, 604, 301, 500)],
    "o3_8h": [(0.000, 0.054, 0, 50), (0.055, 0.070, 51, 100), (0.071, 0.085, 101, 150),
              (0.086, 0.105, 151, 200), (0.106, 0.200, 201, 300)],
    "o3_1h": [(0.125, 0.164, 101, 150), (0.165, 0.204, 151, 200), (0.205, 0.404, 201, 300),
              (0.405, 0.604, 301, 500)],
    "co": [(0.0, 4.4, 0, 50), (4.5, 9.4, 51, 100), (9.5, 12.4, 101, 150), (12.5, 15.4, 151, 200),
           (15.5, 30.4, 201, 300), (30.5, 50.4, 301, 500)],
    "so2": [(0, 35, 0, 50), (36, 75, 51, 100), (76, 185, 101, 150), (186, 304, 151, 200),
            (305, 604, 201, 300), (605, 1004, 301, 500)],
    "no2": [(0, 53, 0, 50), (54, 100, 51, 100), (101, 360, 101, 150), (361, 649, 151, 200),
            (650, 1249, 201, 300), (1250, 2049, 301, 500)],
}
US_DECIMALS = {"pm2_5": 1, "pm10": 0, "o3_8h": 3, "o3_1h": 3, "co": 1, "so2": 0, "no2": 0}

LEVELS = [
    (50, "Tốt", "#00E400"),
    (100, "Trung bình", "#FFFF00"),
    (150, "Kém", "#FF7E00"),
    (200, "Xấu", "#FF0000"),
    (300, "Rất xấu", "#8F3F97"),
    (10 ** 9, "Nguy hại", "#7E0023"),
]


def level_of(aqi):
    if aqi is None or (isinstance(aqi, float) and math.isnan(aqi)):
        return {"level": "Không có dữ liệu", "color": "#94A3B8", "index": 0}
    for i, (hi, name, color) in enumerate(LEVELS, start=1):
        if aqi <= hi:
            return {"level": name, "color": color, "index": i}
    return {"level": "Nguy hại", "color": "#7E0023", "index": 6}


def to_ppb(ugm3, mw):
    return ugm3 * MOLAR_VOLUME / mw


def _vn_scalar(c, bps):
    if c is None or not np.isfinite(c) or c < 0:
        return np.nan
    for i in range(len(bps) - 1):
        if c <= bps[i + 1]:
            return (VN_I[i + 1] - VN_I[i]) / (bps[i + 1] - bps[i]) * (c - bps[i]) + VN_I[i]
    return np.nan if len(bps) < len(VN_I) else 500.0


def _us_scalar(c, key):
    if c is None or not np.isfinite(c) or c < 0:
        return np.nan
    dec = US_DECIMALS[key]
    c = math.floor(c * 10 ** dec) / 10 ** dec  # EPA: cắt bớt (truncate) chữ số thập phân
    table = US_TABLE[key]
    for lo, hi, ilo, ihi in table:
        if c <= hi:
            c_eff = max(c, lo)
            return (ihi - ilo) / (hi - lo) * (c_eff - lo) + ilo
    return 500.0


def vn_index(values, key):
    return np.array([_vn_scalar(v, VN_BP[key]) for v in np.asarray(values, dtype=float)])


def us_index(values, key):
    return np.array([_us_scalar(v, key) for v in np.asarray(values, dtype=float)])


def nowcast(series: pd.Series, hours: int = 12) -> pd.Series:
    """NowCast 12 giờ (QĐ 1459 công thức 2 / US EPA): trọng số w = max(cmin/cmax, 0,5)"""
    vals = series.to_numpy(dtype=float)
    out = np.full(len(vals), np.nan)
    for t in range(len(vals)):
        window = vals[max(0, t - hours + 1): t + 1][::-1]  # c1 = giờ hiện tại
        recent = window[:3]
        if np.sum(np.isfinite(recent)) < 2:
            continue
        valid = window[np.isfinite(window)]
        cmax, cmin = valid.max(), valid.min()
        w = 0.5 if cmax <= 0 else max(cmin / cmax, 0.5)
        weights = np.array([w ** i for i in range(len(window))])
        mask = np.isfinite(window)
        out[t] = np.sum(weights[mask] * window[mask]) / np.sum(weights[mask])
    return pd.Series(out, index=series.index)


def _avg(series, hours):
    return series.rolling(hours, min_periods=max(1, int(hours * 0.75))).mean()


def hourly_aqi(df: pd.DataFrame) -> pd.DataFrame:
    """AQI giờ theo VN_AQI và US AQI cho từng chất + AQI tổng hợp và chất chi phối.

    df: index thời gian (theo giờ, liên tục), cột µg/m³ của các chất trong AQI_POLLUTANTS.
    """
    out = pd.DataFrame(index=df.index)
    vn_cols, us_cols = [], []
    for p in AQI_POLLUTANTS:
        if p not in df.columns:
            continue
        s = df[p].astype(float)
        if p in ("pm2_5", "pm10"):
            nc = nowcast(s)
            out[f"vn_{p}"] = vn_index(nc, p)
            out[f"us_{p}"] = us_index(nc, p)
        elif p == "o3":
            out["vn_o3"] = vn_index(s, "o3_1h")
            ppm8 = to_ppb(_avg(s, 8), POLLUTANTS["o3"]["mw"]) / 1000.0
            ppm1 = to_ppb(s, POLLUTANTS["o3"]["mw"]) / 1000.0
            us8 = us_index(ppm8, "o3_8h")
            us1 = us_index(np.where(ppm1 >= 0.125, ppm1, np.nan), "o3_1h")
            out["us_o3"] = np.fmax(us8, us1)
        elif p == "co":
            out["vn_co"] = vn_index(s, "co")
            out["us_co"] = us_index(to_ppb(_avg(s, 8), POLLUTANTS["co"]["mw"]) / 1000.0, "co")
        else:  # no2, so2
            out[f"vn_{p}"] = vn_index(s, p)
            out[f"us_{p}"] = us_index(to_ppb(s, POLLUTANTS[p]["mw"]), p)
        vn_cols.append(f"vn_{p}")
        us_cols.append(f"us_{p}")
    for std, cols in (("vn", vn_cols), ("us", us_cols)):
        if not cols:
            continue
        block = out[cols]
        out[f"{std}_aqi"] = block.max(axis=1, skipna=True).round()
        dom = block.fillna(-1).idxmax(axis=1).str.replace(f"{std}_", "", regex=False)
        out[f"{std}_dominant"] = dom.where(block.notna().any(axis=1))
    return out


def daily_aqi(df: pd.DataFrame) -> pd.DataFrame:
    """AQI ngày (VN_AQI & US AQI) từ chuỗi giờ; index là ngày (date)."""
    g = df.groupby(df.index.date)
    rows = []
    for day, d in g:
        rec = {"date": day}
        vn, us = {}, {}
        for p in AQI_POLLUTANTS:
            if p not in d.columns or d[p].notna().sum() == 0:
                continue
            s = d[p].astype(float)
            if p in ("pm2_5", "pm10"):
                m = s.mean()
                vn[p] = _vn_scalar(m, VN_BP[p])
                us[p] = _us_scalar(m, p)
            elif p == "o3":
                full = df["o3"].astype(float)
                max8 = _avg(full, 8).loc[d.index].max()
                vn[p] = np.nanmax([_vn_scalar(s.max(), VN_BP["o3_1h"]), _vn_scalar(max8, VN_BP["o3_8h"])])
                ppm1 = to_ppb(s.max(), POLLUTANTS["o3"]["mw"]) / 1000.0
                u1 = _us_scalar(ppm1, "o3_1h") if ppm1 >= 0.125 else np.nan
                us[p] = np.nanmax([_us_scalar(to_ppb(max8, POLLUTANTS["o3"]["mw"]) / 1000.0, "o3_8h"), u1])
            elif p == "co":
                vn[p] = _vn_scalar(s.max(), VN_BP["co"])
                max8 = _avg(df["co"].astype(float), 8).loc[d.index].max()
                us[p] = _us_scalar(to_ppb(max8, POLLUTANTS["co"]["mw"]) / 1000.0, "co")
            else:
                vn[p] = _vn_scalar(s.max(), VN_BP[p])
                us[p] = _us_scalar(to_ppb(s.max(), POLLUTANTS[p]["mw"]), p)
        for std, vals in (("vn", vn), ("us", us)):
            vals = {k: v for k, v in vals.items() if np.isfinite(v)}
            if vals:
                dom = max(vals, key=vals.get)
                rec[f"{std}_aqi"] = int(round(vals[dom]))
                rec[f"{std}_dominant"] = dom
                rec[f"{std}_by_pollutant"] = {k: int(round(v)) for k, v in vals.items()}
        rows.append(rec)
    return pd.DataFrame(rows)


def scalar_vn_pm25(pm25: float) -> int:
    v = _vn_scalar(pm25, VN_BP["pm2_5"])
    return 0 if not np.isfinite(v) else int(round(v))


def scalar_us_pm25(pm25: float) -> int:
    v = _us_scalar(pm25, "pm2_5")
    return 0 if not np.isfinite(v) else int(round(v))
