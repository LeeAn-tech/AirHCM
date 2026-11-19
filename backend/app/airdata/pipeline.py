"""
LUỒNG XỬ LÝ (PIPELINE): THU THẬP -> ĐỒNG NHẤT -> LƯU POSTGRESQL -> DỰ BÁO

- backfill(start, end): nạp lịch sử (08/2022 -> nay) theo từng tháng.
- realtime_update(): chạy mỗi giờ trong FastAPI (APScheduler):
    CAMS (2 ngày qua + 7 ngày tới) + khí tượng Open-Meteo (7 ngày qua + 9 ngày tới)
    + vệ tinh GEE (1 lần/ngày, NRTI) + ERA5-Land GEE (1 lần/ngày, 10 ngày gần nhất)
    -> đồng nhất cửa sổ [hiện tại − 10 ngày, hết ngày thứ 7] -> làm mới dự báo.
"""
import os
import threading
import traceback
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata import harmonize as H
from app.airdata import sources_openmeteo as OM

_run_lock = threading.Lock()
_status = {"last_realtime": None, "last_error": None, "last_gee_day": None, "last_era5_day": None,
           "last_weather": None, "running": False}
WEATHER_EVERY_H = 3  # dự báo thời tiết cập nhật 3-6 giờ/lần -> gọi 3 giờ/lần để tiết kiệm hạn mức Open-Meteo


def status():
    return {k: (v.isoformat(timespec="seconds") if isinstance(v, datetime) else (str(v) if isinstance(v, date) else v))
            for k, v in _status.items()}


def load_wards() -> pd.DataFrame:
    """168 phường/xã: mã, tên, điểm đại diện (nằm trong đa giác), diện tích km²."""
    from app.services import ward_index
    pts = pd.DataFrame(ward_index.representative_points())
    meta = pd.DataFrame(ward_index.all_wards())
    if pts.empty:
        raise RuntimeError("Không đọc được ranh giới phường/xã (frontend/assets/data/hcm_wards.json).")
    df = pts.merge(meta[["code", "area"]], on="code", how="left")
    df = df.drop_duplicates("code").reset_index(drop=True)
    df["code"] = df["code"].astype(str)
    df["area"] = pd.to_numeric(df["area"], errors="coerce")
    df.loc[df["area"] <= 0, "area"] = np.nan
    df["area"] = df["area"].fillna(df["area"].median())
    return df


def _cams_nodes(wards):
    return OM.grid_nodes_for_points(list(zip(wards["lat"], wards["lng"])))


def _store_cams(df, now):
    from app.airdata import store
    if df.empty:
        return 0
    df = df.copy()
    df["la_du_bao"] = df["thoi_gian"] > pd.Timestamp(now).floor("h")
    df["cap_nhat_luc"] = pd.Timestamp(now)
    cols = ["node_lat", "node_lon", "thoi_gian"] + [c for c in H.CAMS_KEYS if c in df.columns] + ["la_du_bao", "cap_nhat_luc"]
    return store.upsert("kk_nut_cams_gio", df[cols])


def _store_weather(df, source):
    from app.airdata import store
    if df is None or df.empty:
        return 0
    df = df.copy()
    df["nguon"] = source
    cols = ["ma_phuong_xa", "thoi_gian", "nguon"] + [c for c in H.WX_KEYS if c in df.columns]
    return store.upsert("kk_khituong_phuong_gio", df[cols])


def harmonize_window(wards, start, end, now=None, log=print):
    """Đọc nguồn gốc trong CSDL -> đồng nhất -> ghi bảng phường & TP."""
    from app.airdata import store
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    cams = store.cams_nodes(start - timedelta(hours=6), end + timedelta(hours=6))
    if cams.empty:
        log("   (không có CAMS trong cửa sổ)")
        return 0
    cams["thoi_gian"] = pd.to_datetime(cams["thoi_gian"])
    sat = store.satellite((start - timedelta(days=60)).date(), end.date())
    era5 = store.weather(start, end, "era5land")
    om = store.weather(start - timedelta(hours=C.BIAS_WINDOW_H + 24), end, "openmeteo")
    for d in (era5, om):
        if not d.empty:
            d["thoi_gian"] = pd.to_datetime(d["thoi_gian"])
    ward_df = H.harmonize(wards, cams, sat, era5, om, start=start, end=end, now=now)
    city = H.city_series(ward_df, wards)
    n1 = store.upsert("kk_dongnhat_phuong_gio", ward_df)
    city_cols = ["thoi_gian"] + [c for c in city.columns if c in set(store.POLL + store.EXTRA + store.WX)]
    n2 = store.upsert("kk_dongnhat_tp_gio", city[city_cols])
    log(f"   Đồng nhất {start:%Y-%m-%d %H}h..{end:%Y-%m-%d %H}h: {n1:,} dòng phường, {n2:,} dòng TP")
    return n1


def backfill(start: date, end: date, steps=("cams", "era5", "sat", "harmonize"), log=print):
    from app.airdata import store
    store.ensure_schema()
    wards = load_wards()
    log(f"-> {len(wards)} phường/xã; {len(_cams_nodes(wards))} nút lưới CAMS 0,4°")
    now = datetime.now()
    if "cams" in steps:
        log("[1/4] CAMS (Open-Meteo Air Quality) ...")
        d = start
        while d <= end:
            e = min(end, (pd.Timestamp(d) + pd.offsets.MonthEnd(0)).date())
            df = OM.fetch_cams_nodes(_cams_nodes(wards), start=d, end=e)
            log(f"   {d}..{e}: {_store_cams(df, now):,} dòng")
            d = e + timedelta(days=1)
    if "era5" in steps:
        log("[2/4] ERA5-Land theo giờ (GEE) ...")
        from app.airdata import sources_gee as G
        pts = wards[["code", "lat", "lng"]]
        d = start
        while d <= end:
            e = min(end, d + timedelta(days=29))
            df = G.fetch_era5land_points(pts, d, e, window_days=7, log=log)
            _store_weather(df, "era5land")
            d = e + timedelta(days=1)
    if "sat" in steps:
        log("[3/4] Sentinel-5P + MAIAC AOD (GEE) ...")
        from app.airdata import sources_gee as G
        sat = G.fetch_satellite_range(start, end, step_days=7, log=log)
        store.upsert("kk_vetinh_phuong_ngay", sat)
    if "harmonize" in steps:
        log("[4/4] Đồng nhất dữ liệu theo tháng ...")
        d = pd.Timestamp(start)
        while d.date() <= end:
            e = min(pd.Timestamp(end) + pd.Timedelta(hours=23), d + pd.offsets.MonthEnd(0) + pd.Timedelta(hours=23))
            harmonize_window(wards, d, e, now=now, log=log)
            d = (e + pd.Timedelta(hours=1)).normalize()


def realtime_update(log=print, with_gee=True):
    """Một lượt cập nhật thời gian thực (an toàn khi gọi lặp; bỏ qua nếu lượt trước chưa xong)."""
    if not _run_lock.acquire(blocking=False):
        return {"status": "busy"}
    _status["running"] = True
    try:
        from app.airdata import store
        store.ensure_schema()
        wards = load_wards()
        now = datetime.now()
        cams = OM.fetch_cams_nodes(_cams_nodes(wards), past_days=2, forecast_days=C.CAMS_FORECAST_DAYS)
        n_cams = _store_cams(cams, now)
        n_wx = 0
        last_wx = _status["last_weather"]
        if last_wx is None or (now - last_wx).total_seconds() >= WEATHER_EVERY_H * 3600 - 300:
            wx = OM.fetch_weather_points(wards[["code", "lat", "lng"]], past_days=7,
                                         forecast_days=C.WEATHER_FORECAST_DAYS)
            n_wx = _store_weather(wx, "openmeteo")
            _status["last_weather"] = now
        today = date.today()
        if with_gee:
            try:
                from app.airdata import sources_gee as G
                if _status["last_gee_day"] != today:
                    sat = G.fetch_satellite_ward_day(today - timedelta(days=1), nrt=True)
                    store.upsert("kk_vetinh_phuong_ngay", sat)
                    _status["last_gee_day"] = today
                if _status["last_era5_day"] != today:
                    era = G.fetch_era5land_points(wards[["code", "lat", "lng"]], today - timedelta(days=10),
                                                  today, log=lambda *_: None)
                    _store_weather(era, "era5land")
                    _status["last_era5_day"] = today
            except Exception as e:
                log(f"-> [AirData] GEE tạm bỏ qua: {e}")
        start = pd.Timestamp(now).floor("h") - pd.Timedelta(days=10)
        end = pd.Timestamp(today) + pd.Timedelta(days=8) - pd.Timedelta(hours=1)
        harmonize_window(wards, start, end, now=now, log=log)
        from app.airdata.forecast import ENGINE
        ENGINE.state(force=True)
        # Phân vị dự báo (q05/q50/q95) + rủi ro phường theo ngày -> bảng kk_du_bao_phan_vi, kk_rui_ro_phuong_ngay
        if os.getenv("AIRDATA_PERSIST_RISK", "1") != "0":
            try:
                from app.airdata import analytics
                analytics.persist(ENGINE, log=log)
            except Exception as e:
                log(f"-> [AirData] Bỏ qua lưu phân vị/rủi ro: {e}")
        # Khí tượng bổ sung cấp TP (bức xạ, mây, lớp biên, gió 100 m) nếu đã bật
        if os.getenv("AIRDATA_EXTRA_WX", "1") != "0":
            try:
                from app.airdata import sources_extra_weather as XW
                if XW.enabled():
                    XW.update_recent(log=log)
            except Exception as e:
                log(f"-> [AirData] Bỏ qua khí tượng bổ sung: {e}")
        _status.update({"last_realtime": now.isoformat(timespec="seconds"), "last_error": None})
        return {"status": "ok", "cams_rows": n_cams, "weather_rows": n_wx}
    except Exception as e:
        _status["last_error"] = f"{e}"
        log(f"-> [AirData] Lỗi cập nhật realtime: {e}\n{traceback.format_exc()}")
        return {"status": "error", "error": str(e)}
    finally:
        _status["running"] = False
        _run_lock.release()


def schedule(scheduler):
    """Gắn job cập nhật mỗi giờ (phút 05) vào APScheduler sẵn có của backend."""
    import os
    if os.getenv("AIRDATA_REALTIME", "1") == "0":
        print("-> [AirData] Đã tắt cập nhật realtime (AIRDATA_REALTIME=0).")
        return
    with_gee = os.getenv("AIRDATA_GEE", "1") != "0"
    scheduler.add_job(lambda: realtime_update(with_gee=with_gee), "cron", minute=5,
                      id="airdata_realtime", replace_existing=True, max_instances=1, coalesce=True)
    if os.getenv("AIRDATA_ON_STARTUP", "1") != "0":
        scheduler.add_job(lambda: realtime_update(with_gee=with_gee), "date",
                          run_date=datetime.now() + timedelta(seconds=20), id="airdata_startup",
                          replace_existing=True)
