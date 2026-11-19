"""
THU THẬP DỮ LIỆU TỪ OPEN-METEO

1) Air Quality API (CAMS toàn cầu 0,4°): lấy tại các NÚT LƯỚI CAMS bao quanh 168 phường/xã
   (không lấy trực tiếp tại tâm phường) để bước đồng nhất tự nội suy song tuyến, tránh hiện tượng
   "bậc thang" khi nhiều phường rơi vào cùng một ô 45 km.
2) Weather Forecast API: khí tượng theo giờ tại điểm đại diện của từng phường (quá khứ gần + 7 ngày tới),
   bù cho khoảng trễ ~5 ngày của ERA5-Land và làm đầu vào cho dự báo.
"""
import math
import time
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

from app.airdata.config import CAMS_EXTRA, CAMS_GRID_STEP, POLLUTANTS, TIMEZONE

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "AirHCM-HCMUNRE/2.0 (do an chuyen nganh)"}
BATCH = 50  # số tọa độ mỗi lượt gọi


def _get(url, params, retries=4, timeout=60):
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
            if r.status_code == 200:
                data = r.json()
                return data if isinstance(data, list) else [data]
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code == 400:
                break
        except Exception as e:  # mạng chập chờn -> thử lại
            last = str(e)
        time.sleep(2 ** i)
    raise RuntimeError(f"Open-Meteo lỗi: {last}")


def grid_nodes_for_points(points, step=CAMS_GRID_STEP):
    """Tập nút lưới (4 góc ô) bao quanh mọi điểm -> đủ cho nội suy song tuyến."""
    nodes = set()
    for lat, lon in points:
        la0 = math.floor(lat / step) * step
        lo0 = math.floor(lon / step) * step
        for dla in (0, step):
            for dlo in (0, step):
                nodes.add((round(la0 + dla, 4), round(lo0 + dlo, 4)))
    return sorted(nodes)


def _frame_from_payload(payload, keys, rename):
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    df = pd.DataFrame({"thoi_gian": pd.to_datetime(times)})
    for k in keys:
        df[rename.get(k, k)] = pd.to_numeric(pd.Series(hourly.get(k, [None] * len(times))), errors="coerce")
    return df


def fetch_cams_nodes(nodes, start: date = None, end: date = None, past_days: int = None,
                     forecast_days: int = None, chunk_days: int = 31) -> pd.DataFrame:
    """CAMS theo giờ tại các nút lưới. Trả về bảng dài: node_lat, node_lon, thoi_gian, <chất>..."""
    om_vars = {v["om"]: k for k, v in POLLUTANTS.items()}
    om_vars.update({v: k for k, v in CAMS_EXTRA.items()})
    keys = list(om_vars.keys())
    windows = []
    if start is not None:
        d = start
        while d <= end:
            e = min(end, d + timedelta(days=chunk_days - 1))
            windows.append({"start_date": d.isoformat(), "end_date": e.isoformat()})
            d = e + timedelta(days=1)
    else:
        windows.append({"past_days": past_days or 1, "forecast_days": forecast_days or 7})

    frames = []
    for w in windows:
        for i in range(0, len(nodes), BATCH):
            batch = nodes[i:i + BATCH]
            params = {
                "latitude": ",".join(f"{n[0]:.4f}" for n in batch),
                "longitude": ",".join(f"{n[1]:.4f}" for n in batch),
                "hourly": ",".join(keys),
                "timezone": TIMEZONE,
                **w,
            }
            for node, payload in zip(batch, _get(AQ_URL, params)):
                df = _frame_from_payload(payload, keys, om_vars)
                df["node_lat"], df["node_lon"] = node
                frames.append(df)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    return out.drop_duplicates(["node_lat", "node_lon", "thoi_gian"], keep="last")


def fetch_weather_points(points: pd.DataFrame, past_days: int = 7, forecast_days: int = 7) -> pd.DataFrame:
    """Khí tượng theo giờ tại điểm đại diện phường. points: cột code, lat, lng."""
    keys = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "wind_speed_10m",
            "wind_direction_10m", "precipitation", "surface_pressure"]
    rename = {"dew_point_2m": "dewpoint_2m", "relative_humidity_2m": "relative_humidity",
              "wind_speed_10m": "wind_speed", "wind_direction_10m": "wind_dir"}
    frames = []
    rows = points.to_dict("records")
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        params = {
            "latitude": ",".join(f"{r['lat']:.5f}" for r in batch),
            "longitude": ",".join(f"{r['lng']:.5f}" for r in batch),
            "hourly": ",".join(keys),
            "timezone": TIMEZONE,
            "wind_speed_unit": "ms",
            "past_days": past_days,
            "forecast_days": forecast_days,
        }
        for r, payload in zip(batch, _get(WX_URL, params)):
            df = _frame_from_payload(payload, keys, rename)
            df["ma_phuong_xa"] = r["code"]
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def fetch_cams_point_live(lat: float, lon: float) -> dict:
    """Giá trị CAMS hiện tại tại một điểm (dùng khi CSDL chưa có dữ liệu đồng nhất)."""
    om_vars = {v["om"]: k for k, v in POLLUTANTS.items()}
    params = {"latitude": lat, "longitude": lon, "current": ",".join(om_vars), "timezone": TIMEZONE}
    payload = _get(AQ_URL, params, retries=2, timeout=8)[0]
    cur = payload.get("current") or {}
    out = {"thoi_gian": cur.get("time")}
    for om, key in om_vars.items():
        v = cur.get(om)
        out[key] = float(v) if v is not None else np.nan
    return out
