"""
Kiểm thử phân hệ AirData bằng DỮ LIỆU GIẢ LẬP (không cần mạng, GEE hay PostgreSQL).

    cd backend
    python -m pytest tests/test_airdata_synthetic.py -q      (hoặc: python tests/test_airdata_synthetic.py)
"""
import os
import sys
import tempfile
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.airdata import aqi as AQ  # noqa: E402
from app.airdata import config as C  # noqa: E402
from app.airdata import harmonize as H  # noqa: E402
from app.airdata import seasonal, train  # noqa: E402
from app.airdata.forecast import AirForecastEngine  # noqa: E402
from app.airdata.sources_openmeteo import grid_nodes_for_points  # noqa: E402

RNG = np.random.default_rng(7)
START, NOW = pd.Timestamp("2024-01-01 00:00"), pd.Timestamp("2025-12-28 12:00")
END = NOW.normalize() + pd.Timedelta(days=8) - pd.Timedelta(hours=1)


def make_wards(n=30):
    lat = RNG.uniform(10.42, 11.15, n)
    lng = RNG.uniform(106.42, 106.98, n)
    lat[-1], lng[-1] = 8.69, 106.61  # "Côn Đảo" tách biệt -> kiểm tra nút lưới riêng
    return pd.DataFrame({"code": [f"W{i:03d}" for i in range(n)], "name": [f"Phường {i}" for i in range(n)],
                         "lat": lat, "lng": lng, "area": RNG.uniform(2, 60, n)})


def make_weather(wards, times):
    n = len(times)
    hod, doy = np.asarray(times.hour), np.asarray(times.dayofyear)
    rainy = np.asarray((times.month >= 5) & (times.month <= 11))
    base_t = 28 + 4 * np.sin(2 * np.pi * (hod - 9) / 24) + 1.5 * np.sin(2 * np.pi * (doy - 80) / 365)
    wind = np.clip(2.5 + 1.2 * np.sin(2 * np.pi * (hod - 14) / 24) + RNG.normal(0, 0.6, n), 0.2, None)
    rain = np.where(rainy & (RNG.random(n) < 0.08), RNG.gamma(1.5, 3, n), 0.0)
    rows = []
    for w in wards.itertuples():
        t = base_t + RNG.normal(0, 0.4, n) - 0.3 * (w.lat - 10.8)
        rows.append(pd.DataFrame({"ma_phuong_xa": w.code, "thoi_gian": times, "temperature_2m": t,
                                  "dewpoint_2m": t - 5 + 2 * rainy, "wind_speed": wind * (1 + 0.1 * RNG.random()),
                                  "wind_dir": (150 + 30 * np.sin(2 * np.pi * doy / 365)) % 360,
                                  "precipitation": rain, "surface_pressure": 1008 + RNG.normal(0, 1, n)}))
    df = pd.concat(rows, ignore_index=True)
    df["relative_humidity"] = H.relative_humidity(df["temperature_2m"], df["dewpoint_2m"])
    return df, wind, rain


def make_cams(nodes, times, wind, rain):
    n = len(times)
    hod, mon = np.asarray(times.hour), np.asarray(times.month)
    season = np.where((mon <= 4) | (mon == 12), 1.35, 0.85)
    ar = np.zeros(n)
    for i in range(1, n):
        ar[i] = 0.97 * ar[i - 1] + RNG.normal(0, 0.06)
    rush = 1 + 0.35 * np.exp(-((hod - 7) ** 2) / 4) + 0.3 * np.exp(-((hod - 19) ** 2) / 5)
    pm25 = 22 * season * rush * np.exp(ar) * (2.5 / (wind + 0.8)) ** 0.5 * np.exp(-0.05 * rain)
    sun = np.clip(np.sin(np.pi * (hod - 6) / 12), 0, None)
    frames = []
    for la, lo in nodes:
        g = 1 + 0.25 * np.exp(-((la - 10.78) ** 2 + (lo - 106.68) ** 2) / 0.05)
        noise = np.exp(RNG.normal(0, 0.05, n))
        frames.append(pd.DataFrame({
            "node_lat": la, "node_lon": lo, "thoi_gian": times,
            "pm2_5": pm25 * g * noise, "pm10": pm25 * g * noise * 1.45,
            "co": 450 * season * rush * g * np.exp(ar * 0.6), "no2": 18 * rush * g * np.exp(ar * 0.5),
            "so2": 9 * g * np.exp(ar * 0.3), "o3": 35 + 70 * sun * season / g,
            "co2": 425 + 3 * np.sin(2 * np.pi * np.asarray(times.dayofyear) / 365),
            "dust": 3 * season, "aod": 0.3 * season * g}))
    df = pd.concat(frames, ignore_index=True)
    drop = RNG.random(len(df)) < 0.002  # khoảng trống rải rác
    df.loc[drop, ["pm2_5", "pm10"]] = np.nan
    return df


def make_sat(wards, days):
    base = {k: np.exp(RNG.normal(0, 0.3, len(wards))) for k in ("r_no2", "r_so2", "r_co", "r_aod")}
    rows = []
    for d in days[::7]:
        for i, w in enumerate(wards.itertuples()):
            rows.append({"ma_phuong_xa": w.code, "ngay": d, **{k: v[i] * np.exp(RNG.normal(0, 0.05))
                                                             for k, v in base.items()}})
    return pd.DataFrame(rows)


class MemoryLoader:
    def __init__(self, ward_df, city_df):
        self.w, self.c, self.saved = ward_df, city_df, []

    def city(self, start=None, end=None):
        c = self.c
        if start is not None:
            c = c[c["thoi_gian"] >= start]
        if end is not None:
            c = c[c["thoi_gian"] <= end]
        return c.copy()

    def ward(self, start, end, code=None):
        w = self.w[(self.w["thoi_gian"] >= start) & (self.w["thoi_gian"] <= end)]
        return (w[w["ma_phuong_xa"] == code] if code else w).copy()

    def save_issued(self, df):
        self.saved.append(df)

    def issued(self, start, end):
        return pd.concat(self.saved) if self.saved else pd.DataFrame()


_CACHE = {}


def dataset():
    if _CACHE:
        return _CACHE
    wards = make_wards()
    times = pd.date_range(START, END, freq="h")
    wx, wind, rain = make_weather(wards, times)
    nodes = grid_nodes_for_points(list(zip(wards["lat"], wards["lng"])))
    cams = make_cams(nodes, times, wind, rain)
    sat = make_sat(wards, pd.date_range(START, END, freq="D"))
    era5 = wx[wx["thoi_gian"] <= NOW - pd.Timedelta(days=5)]
    om = wx[wx["thoi_gian"] >= NOW - pd.Timedelta(days=7)].copy()
    om["temperature_2m"] += 1.2   # độ lệch hệ thống của nguồn dự báo -> phải được hiệu chỉnh
    om.loc[om["ma_phuong_xa"] == wards["code"].iloc[3], ["temperature_2m", "dewpoint_2m"]] = np.nan  # phường thiếu
    t = time.time()
    ward_df = H.harmonize(wards, cams, sat, era5, om, start=START, end=END, now=NOW)
    city = H.city_series(ward_df, wards)
    _CACHE.update(wards=wards, cams=cams, sat=sat, wx=wx, ward=ward_df, city=city, nodes=nodes,
                  harmonize_s=time.time() - t)
    return _CACHE


def test_aqi_breakpoints():
    assert round(AQ._vn_scalar(25, AQ.VN_BP["pm2_5"])) == 50
    assert round(AQ._vn_scalar(50, AQ.VN_BP["pm2_5"])) == 100
    assert round(AQ._vn_scalar(200, AQ.VN_BP["no2"])) == 100
    assert round(AQ._us_scalar(9.0, "pm2_5")) == 50
    assert round(AQ._us_scalar(35.4, "pm2_5")) == 100
    assert round(AQ._us_scalar(55.5, "pm2_5")) == 151
    df = pd.DataFrame({"pm2_5": [20.0] * 30, "o3": [100.0] * 30, "no2": [250.0] * 30},
                      index=pd.date_range("2025-01-01", periods=30, freq="h"))
    h = AQ.hourly_aqi(df)
    assert h["vn_dominant"].iloc[-1] == "no2"          # NO2 250 µg/m³ > 100 điểm
    assert int(h["vn_aqi"].iloc[-1]) == round(AQ._vn_scalar(250, AQ.VN_BP["no2"]))


def test_harmonize_shapes_and_mass_conservation():
    d = dataset()
    wards, ward_df = d["wards"], d["ward"]
    n_hours = len(pd.date_range(START, END, freq="h"))
    assert ward_df["ma_phuong_xa"].nunique() == len(wards)
    assert len(ward_df) == len(wards) * n_hours
    assert ward_df["pm2_5"].notna().mean() > 0.999
    # cờ: giờ tương lai, khí tượng Open-Meteo, IDW cho phường thiếu
    assert (ward_df.loc[ward_df["thoi_gian"] > NOW, "co_hieu"] & H.FLAG_FUTURE).all()
    assert ((ward_df["co_hieu"] & H.FLAG_WX_OM) > 0).any()
    miss = ward_df[ward_df["ma_phuong_xa"] == wards["code"].iloc[3]]
    assert ((miss["co_hieu"] & H.FLAG_WX_IDW) > 0).any() and miss["temperature_2m"].notna().all()
    # bảo toàn khối lượng của hệ số vệ tinh
    days = pd.DatetimeIndex(sorted(set(pd.date_range(START, END, freq="h").normalize())))
    f, _ = H.satellite_factors(d["sat"], wards, days)
    area = wards["area"].to_numpy()
    m = (area[:, None] * f["no2"]).sum(axis=0) / area.sum()
    assert np.allclose(m, 1.0, atol=1e-6)
    assert np.all(f["o3"] == 1.0)


def test_bias_correction():
    d = dataset()
    w, wards = d["ward"], d["wards"]
    code = wards["code"].iloc[0]
    truth = d["wx"][(d["wx"]["ma_phuong_xa"] == code) & (d["wx"]["thoi_gian"] > NOW - pd.Timedelta(days=4))]
    got = w[(w["ma_phuong_xa"] == code) & (w["thoi_gian"].isin(truth["thoi_gian"]))]
    err = np.mean(got["temperature_2m"].to_numpy() - truth["temperature_2m"].to_numpy())
    assert abs(err) < 0.4, err  # độ lệch +1,2 °C đã được khử


def test_train_and_realtime_payload():
    d = dataset()
    city = d["city"]
    with tempfile.TemporaryDirectory() as tmp:
        hist = city[city["thoi_gian"] <= NOW]
        t = time.time()
        summary, samples = train.train_all(hist, ["pm2_5", "o3"], ("hgb",), log=print, out_dir=tmp)
        print(f"   huấn luyện 2 chất: {time.time() - t:.0f}s")
        m = summary["pm2_5"]["metrics"]
        assert m["model"]["1-24h"]["rmse"] < m["persistence"]["1-24h"]["rmse"]
        assert m["model"]["73-192h"]["rmse"] < m["persistence"]["73-192h"]["rmse"]
        eng = AirForecastEngine(loader=MemoryLoader(d["ward"], city), model_dir=tmp)
        p = eng.payload(now=NOW)
        assert p["ok"] and len(p["daily"]) == 8 and p["daily"][0]["label"] == "Hôm nay"
        assert p["hourly"][0]["time"].endswith("00:00") and len(p["hourly"]) == 8 * 24
        assert p["today"]["date"] == "2025-12-28"
        assert p["model"]["pm2_5"]["source"] in ("ml", "ml+cams")
        assert p["model"]["no2"]["source"] == "cams"   # chưa huấn luyện NO2 -> dùng CAMS
        assert p["current"]["vn_aqi"] is not None
        assert p["monthly"]["months"] and "pm2_5" in p["monthly"]["months"][0]
        pw = eng.payload(ward_code=d["wards"]["code"].iloc[5], now=NOW)
        assert pw["ok"]
        sp = eng.spatial("no2")
        assert sp and len(sp["wards"]) == len(d["wards"])
        assert eng.loader.saved, "phải ghi nhật ký dự báo phát hành"


def test_monthly_outlook():
    d = dataset()
    s = d["city"].set_index("thoi_gian")["pm2_5"]
    o = seasonal.outlook(s[s.index <= NOW], 3, NOW)
    assert o["available"] and len(o["months"]) == 4
    assert o["months"][1]["lo"] <= o["months"][1]["mean"] <= o["months"][1]["hi"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t = time.time()
            fn()
            print(f"OK  {name}  ({time.time() - t:.1f}s)")
    print(f"Đồng nhất dữ liệu giả lập: {_CACHE.get('harmonize_s', 0):.1f}s")
