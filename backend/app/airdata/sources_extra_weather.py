"""
KHÍ TƯỢNG BỔ SUNG CẤP THÀNH PHỐ (biến khuếch tán và quang hóa)

Biến (Open-Meteo, theo giờ, giờ Việt Nam):
  shortwave_radiation (W/m²)   - bức xạ sóng ngắn: điều khiển hình thành O3 và bụi thứ cấp
  cloud_cover (%)              - độ che phủ mây
  boundary_layer_height (m)    - độ cao lớp biên: "thể tích" pha loãng chất ô nhiễm
  wind_speed_100m (m/s), wind_direction_100m (°) - gió tầng vận chuyển (đại diện hơn gió 10 m trong đô thị)
Hệ số thông gió (ventilation) = BLH × WS10 (m²/s) được tính trong đặc trưng mô hình.

Nguồn: lịch sử từ Historical Forecast API (cùng họ mô hình với dự báo vận hành -> nhất quán), thiếu thì bù bằng
Historical Weather API (ERA5); gần đây + 9 ngày tới từ Forecast API. Lấy tại 6 điểm đại diện trên địa bàn
TP.HCM (sau sáp nhập) rồi lấy trung bình (hướng gió trung bình theo vectơ). Lưu bảng kk_khituong_bosung_tp_gio.
"""
import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.airdata import config as C

HIST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
ERA5_URL = "https://archive-api.open-meteo.com/v1/archive"
FC_URL = "https://api.open-meteo.com/v1/forecast"
VARS = ["shortwave_radiation", "cloud_cover", "boundary_layer_height", "wind_speed_100m", "wind_direction_100m"]
COLS = ["shortwave_radiation", "cloud_cover", "boundary_layer_height", "wind_speed_100m", "wind_dir_100m"]
# Điểm đại diện: lõi đô thị, Thủ Đức, Bình Chánh, Thủ Dầu Một, Vũng Tàu, Cần Giờ
POINTS = [(10.776, 106.700), (10.850, 106.770), (10.700, 106.580), (10.980, 106.650), (10.350, 107.080),
          (10.410, 106.950)]
_STATE = {"last": None}


def _fetch(url, params):
    from app.airdata.sources_openmeteo import _get
    p = {"latitude": ",".join(f"{a:.3f}" for a, _ in POINTS), "longitude": ",".join(f"{b:.3f}" for _, b in POINTS),
         "hourly": ",".join(VARS), "timezone": C.TIMEZONE, "wind_speed_unit": "ms", **params}
    payloads = _get(url, p)
    frames = []
    for pl in payloads:
        h = pl.get("hourly") or {}
        t = pd.to_datetime(h.get("time") or [])
        frames.append(pd.DataFrame({"thoi_gian": t, **{v: pd.to_numeric(pd.Series(h.get(v, [None] * len(t))), errors="coerce")
                                                        for v in VARS}}))
    return _city_mean(frames)


def _city_mean(frames):
    if not frames:
        return pd.DataFrame(columns=["thoi_gian"] + COLS)
    df = pd.concat(frames, ignore_index=True)
    rad = np.radians(df["wind_direction_100m"])
    df["_u"] = -df["wind_speed_100m"] * np.sin(rad)
    df["_v"] = -df["wind_speed_100m"] * np.cos(rad)
    g = df.groupby("thoi_gian").mean(numeric_only=True)
    out = pd.DataFrame(index=g.index)
    out["shortwave_radiation"] = g["shortwave_radiation"]
    out["cloud_cover"] = g["cloud_cover"]
    out["boundary_layer_height"] = g["boundary_layer_height"]
    out["wind_speed_100m"] = g["wind_speed_100m"]
    out["wind_dir_100m"] = (np.degrees(np.arctan2(-g["_u"], -g["_v"])) + 360) % 360
    return out.reset_index()


def fetch_history(start: date, end: date, log=print, chunk_days=180) -> pd.DataFrame:
    frames = []
    d = start
    while d <= end:
        e = min(end, d + timedelta(days=chunk_days - 1))
        try:
            df = _fetch(HIST_URL, {"start_date": d.isoformat(), "end_date": e.isoformat()})
            src = "hist_forecast"
            # biến thiếu hoàn toàn -> bù bằng ERA5 (Historical Weather API)
            miss = [c for c in COLS if c in df and df[c].notna().mean() < 0.5]
            if miss:
                era = _fetch(ERA5_URL, {"start_date": d.isoformat(), "end_date": e.isoformat()})
                df = df.set_index("thoi_gian")
                era = era.set_index("thoi_gian").reindex(df.index)
                for c in miss:
                    df[c] = df[c].fillna(era[c])
                df = df.reset_index()
                src = "hist_forecast+era5"
            df["nguon"] = src
            frames.append(df)
            log(f"   Khí tượng bổ sung {d}..{e}: {len(df):,} giờ ({src}); BLH có số liệu "
                f"{100 * df['boundary_layer_height'].notna().mean():.0f}%")
        except Exception as ex:
            log(f"   Khí tượng bổ sung {d}..{e}: lỗi {ex}")
        d = e + timedelta(days=1)
        time.sleep(1)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_recent(past_days=7, forecast_days=None) -> pd.DataFrame:
    df = _fetch(FC_URL, {"past_days": past_days, "forecast_days": forecast_days or C.WEATHER_FORECAST_DAYS})
    df["nguon"] = "forecast"
    return df


def enabled() -> bool:
    try:
        from app.airdata import store
        df = store.read_sql("SELECT COUNT(*) AS n FROM kk_khituong_bosung_tp_gio")
        return int(df["n"].iloc[0]) > 0
    except Exception:
        return False


def update_recent(log=print, every_h=3):
    last = _STATE["last"]
    if last is not None and (datetime.now() - last).total_seconds() < every_h * 3600 - 300:
        return 0
    from app.airdata import store
    df = fetch_recent()
    n = store.upsert("kk_khituong_bosung_tp_gio", df[["thoi_gian"] + COLS + ["nguon"]])
    _STATE["last"] = datetime.now()
    log(f"   Khí tượng bổ sung (dự báo): {n:,} giờ")
    return n


def backfill(start: date = None, end: date = None, log=print):
    from app.airdata import store
    store.ensure_schema()
    start = start or C.HISTORY_START
    end = end or date.today()
    hist = fetch_history(start, end, log=log)
    n = store.upsert("kk_khituong_bosung_tp_gio", hist[["thoi_gian"] + COLS + ["nguon"]]) if not hist.empty else 0
    rec = fetch_recent()
    n += store.upsert("kk_khituong_bosung_tp_gio", rec[["thoi_gian"] + COLS + ["nguon"]])
    return n
