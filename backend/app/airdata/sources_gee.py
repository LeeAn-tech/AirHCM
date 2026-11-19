"""
THU THẬP DỮ LIỆU VỆ TINH VÀ TÁI PHÂN TÍCH QUA GOOGLE EARTH ENGINE (Python API)

1) ERA5-Land Hourly (0,1°, theo giờ): khí tượng tại điểm đại diện 168 phường/xã.
   - Ô ven biển/hải đảo bị mặt nạ (ERA5-Land chỉ có trên đất liền) được lấp bằng trung bình
     lân cận (focal mean 3 ô) -> khắc phục việc thiếu số liệu Côn Đảo, Bình Châu ở bản trước.
   - Thời gian ERA5 là UTC -> đổi sang giờ Việt Nam (UTC+7).
2) Sentinel-5P TROPOMI (NO2, SO2, CO, chỉ số sol khí) và MODIS MAIAC AOD (1 km): với mỗi ngày D,
   - tạo ảnh tổ hợp trượt N ngày [D-N+1, D] (lấp khoảng trống do mây, lọc cloud_fraction < 0,3),
   - tính TỶ SỐ KHÔNG GIAN R = I / mean_lân_cận(I, bán kính ~22 km ≈ nửa ô CAMS),
   - lấy trung bình theo đa giác phường (reduceRegions, scale 1.113,2 m).
   R > 1 nghĩa là phường ô nhiễm hơn vùng xung quanh cỡ một ô CAMS -> dùng để hạ quy mô CAMS.
"""
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.airdata import config as C

_EE_READY = False


def init_ee():
    """Khởi tạo Earth Engine (một lần)."""
    global _EE_READY
    if _EE_READY:
        return
    import ee
    if C.GEE_SERVICE_ACCOUNT and C.GEE_KEY_FILE:
        creds = ee.ServiceAccountCredentials(C.GEE_SERVICE_ACCOUNT, C.GEE_KEY_FILE)
        ee.Initialize(creds, project=C.GEE_PROJECT)
    else:
        ee.Initialize(project=C.GEE_PROJECT)
    _EE_READY = True


def _ee():
    init_ee()
    import ee
    return ee


# ------------------------------------------------------------------------------
# 1. ERA5-LAND THEO GIỜ TẠI ĐIỂM ĐẠI DIỆN PHƯỜNG
# ------------------------------------------------------------------------------
ERA5_BANDS = ["temperature_2m", "dewpoint_temperature_2m", "u_component_of_wind_10m",
              "v_component_of_wind_10m", "total_precipitation_hourly", "surface_pressure"]


def _points_fc(points: pd.DataFrame):
    ee = _ee()
    feats = [ee.Feature(ee.Geometry.Point([float(r["lng"]), float(r["lat"])]), {"code": str(r["code"])})
             for r in points.to_dict("records")]
    return ee.FeatureCollection(feats)


def relative_humidity(t_c, td_c):
    """Độ ẩm tương đối (%) từ nhiệt độ và điểm sương (công thức Magnus)."""
    a, b = 17.625, 243.04
    return 100.0 * np.exp(a * td_c / (b + td_c)) / np.exp(a * t_c / (b + t_c))


def fetch_era5land_points(points: pd.DataFrame, start: date, end: date, window_days: int = 3,
                          log=print) -> pd.DataFrame:
    """ERA5-Land theo giờ [start, end] (ngày giờ VN) tại các điểm. Trả về bảng dài theo phường."""
    ee = _ee()
    fc = _points_fc(points)
    frames = []
    d = start
    while d <= end:
        e = min(end, d + timedelta(days=window_days - 1))
        # Cửa sổ giờ VN [d 00:00, e+1 00:00) = UTC [d-1 17:00, e 17:00)
        t0 = datetime(d.year, d.month, d.day) - timedelta(hours=C.UTC_OFFSET_HOURS)
        t1 = datetime(e.year, e.month, e.day) + timedelta(days=1) - timedelta(hours=C.UTC_OFFSET_HOURS)
        col = (ee.ImageCollection("ECMWF/ERA5_LAND/HOURLY")
               .filterDate(t0.strftime("%Y-%m-%dT%H:%M:%S"), t1.strftime("%Y-%m-%dT%H:%M:%S"))
               .select(ERA5_BANDS))

        def fill_coast(img):
            return img.unmask(img.focalMean(radius=3, kernelType="square", units="pixels"), False)

        n = col.size().getInfo()
        if n == 0:
            log(f"   ERA5-Land: chưa có dữ liệu {d}..{e}")
            d = e + timedelta(days=1)
            continue
        stacked = col.map(fill_coast).toBands()
        res = stacked.reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=11132).getInfo()
        recs = []
        for f in res["features"]:
            props = f["properties"]
            code = props.pop("code")
            by_time = {}
            for k, v in props.items():
                if "_" not in k:
                    continue
                stamp, band = k.split("_", 1)  # '20240101T00', 'temperature_2m'
                by_time.setdefault(stamp, {})[band] = v
            for stamp, vals in by_time.items():
                t_utc = datetime.strptime(stamp, "%Y%m%dT%H")
                recs.append({"ma_phuong_xa": code, "thoi_gian": t_utc + timedelta(hours=C.UTC_OFFSET_HOURS), **vals})
        if recs:
            frames.append(pd.DataFrame(recs))
        log(f"   ERA5-Land {d}..{e}: {len(recs)} bản ghi")
        d = e + timedelta(days=1)
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    out = pd.DataFrame({"ma_phuong_xa": df["ma_phuong_xa"], "thoi_gian": df["thoi_gian"]})
    out["temperature_2m"] = df["temperature_2m"] - 273.15           # K -> °C
    out["dewpoint_2m"] = df["dewpoint_temperature_2m"] - 273.15     # K -> °C
    u, v = df["u_component_of_wind_10m"], df["v_component_of_wind_10m"]
    out["wind_speed"] = np.hypot(u, v)                              # m/s
    out["wind_dir"] = (np.degrees(np.arctan2(-u, -v)) + 360) % 360   # hướng gió thổi TỚI (khí tượng)
    out["precipitation"] = df["total_precipitation_hourly"] * 1000.0  # m -> mm
    out["surface_pressure"] = df["surface_pressure"] / 100.0        # Pa -> hPa
    out["relative_humidity"] = relative_humidity(out["temperature_2m"], out["dewpoint_2m"]).clip(0, 100)
    return out


# ------------------------------------------------------------------------------
# 2. TỶ SỐ KHÔNG GIAN TỪ VỆ TINH (MẪU HẠ QUY MÔ)
# ------------------------------------------------------------------------------
S5P_PRODUCTS = {
    # khóa: (sản phẩm L3, band, ngưỡng dương tối thiểu, lọc mây)
    "no2": ("L3_NO2", "tropospheric_NO2_column_number_density", 1e-6, True),
    "so2": ("L3_SO2", "SO2_column_number_density", 2e-5, True),
    "co": ("L3_CO", "CO_column_number_density", 1e-3, False),
    "aer_ai": ("L3_AER_AI", "absorbing_aerosol_index", None, False),
}


def _wards_fc():
    ee = _ee()
    return ee.FeatureCollection(C.GEE_WARD_ASSET).select([C.GEE_WARD_CODE_FIELD])


def _s5p_composite(key, d0, d1, nrt):
    ee = _ee()
    product, band, _, cloud = S5P_PRODUCTS[key]
    stream = "NRTI" if nrt else "OFFL"
    col = ee.ImageCollection(f"COPERNICUS/S5P/{stream}/{product}").filterDate(d0, d1)
    if cloud:
        col = col.map(lambda im: im.select(band).updateMask(im.select("cloud_fraction").lt(0.3)))
    else:
        col = col.select(band)
    return _safe_mean(col, key), col.size()


def _safe_mean(col, name):
    """Trung bình tổ hợp; nếu cửa sổ không có ảnh nào thì trả về ảnh rỗng (bị mặt nạ) cùng tên band."""
    ee = _ee()
    empty = ee.Image.constant(0).rename(name).updateMask(ee.Image.constant(0))
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.mean().rename(name), empty))


def _aod_composite(d0, d1):
    ee = _ee()
    col = (ee.ImageCollection("MODIS/061/MCD19A2_GRANULES").filterDate(d0, d1)
           .select("Optical_Depth_055"))
    return _safe_mean(col, "aod").multiply(0.001), col.size()


def _ratio(img, name, floor):
    ee = _ee()
    pos = img.max(ee.Number(floor)) if floor is not None else img
    ctx = pos.focalMean(radius=C.SAT_CONTEXT_RADIUS_M, kernelType="circle", units="meters")
    return pos.divide(ctx).rename(f"r_{name}")


def fetch_satellite_ward_day(day: date, composite_days: int = None, nrt: bool = None) -> pd.DataFrame:
    """Giá trị trung bình + tỷ số không gian theo phường cho ngày `day` (tổ hợp trượt)."""
    ee = _ee()
    composite_days = composite_days or C.SAT_COMPOSITE_DAYS
    if nrt is None:
        nrt = day >= date.today() - timedelta(days=7)  # OFFL trễ vài ngày -> dùng NRTI cho gần đây
    d1 = (day + timedelta(days=1)).isoformat()
    d0 = (day - timedelta(days=composite_days - 1)).isoformat()
    bands = []
    for key in ("no2", "so2", "co", "aer_ai"):
        img, _ = _s5p_composite(key, d0, d1, nrt)
        bands.append(img)
        floor = S5P_PRODUCTS[key][2]
        if key != "aer_ai":
            bands.append(_ratio(img, key, floor))
    aod, _ = _aod_composite(d0, d1)
    bands += [aod, _ratio(aod, "aod", 0.02)]
    stack = ee.Image.cat(bands)
    res = stack.reduceRegions(collection=_wards_fc(), reducer=ee.Reducer.mean(),
                              scale=C.SAT_SCALE_M, tileScale=4).getInfo()
    recs = []
    for f in res["features"]:
        p = f["properties"]
        recs.append({
            "ma_phuong_xa": str(p.get(C.GEE_WARD_CODE_FIELD)),
            "ngay": day,
            "no2_col": p.get("no2"), "so2_col": p.get("so2"), "co_col": p.get("co"),
            "aer_ai": p.get("aer_ai"), "aod": p.get("aod"),
            "r_no2": p.get("r_no2"), "r_so2": p.get("r_so2"), "r_co": p.get("r_co"), "r_aod": p.get("r_aod"),
            "nguon": "NRTI" if nrt else "OFFL",
        })
    return pd.DataFrame(recs)


def fetch_satellite_range(start: date, end: date, step_days: int = 7, log=print) -> pd.DataFrame:
    frames = []
    d = start
    while d <= end:
        try:
            frames.append(fetch_satellite_ward_day(d))
            log(f"   Vệ tinh {d}: OK")
        except Exception as e:
            log(f"   Vệ tinh {d}: lỗi {e}")
        d += timedelta(days=step_days)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
