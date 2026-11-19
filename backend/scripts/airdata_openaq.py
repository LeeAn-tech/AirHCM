"""
KIỂM CHỨNG BỘ DỮ LIỆU ĐỒNG NHẤT BẰNG QUAN TRẮC MẶT ĐẤT (OpenAQ API v3) - TÙY CHỌN

Cần API key miễn phí (đăng ký tại explore.openaq.org), đặt trong backend/.env:  OPENAQ_API_KEY=...

    cd backend
    python scripts/airdata_openaq.py --days 365

Các bước: tìm trạm trong phạm vi TP.HCM -> tải số liệu giờ các cảm biến PM2.5, PM10, NO2, SO2, CO, O3
-> lưu kk_tram, kk_quantrac_tram_gio -> so với giá trị đồng nhất của phường chứa trạm (cùng giờ):
MAE, RMSE, bias, R, tỷ lệ trung bình; xuất saved_models/airdata/analytics/openaq_validation.json.
Kiểm tra giấy phép dữ liệu của từng nhà cung cấp trước khi công bố lại số liệu.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from app.airdata import config as C  # noqa: E402
from app.airdata import store  # noqa: E402

load_dotenv(os.path.join(C.BACKEND_DIR, ".env"))
API = "https://api.openaq.org/v3"
BBOX = "106.35,10.30,107.60,11.55"            # minLon,minLat,maxLon,maxLat
PARAM_MAP = {"pm25": "pm2_5", "pm10": "pm10", "no2": "no2", "so2": "so2", "co": "co", "o3": "o3"}


def _get(path, key, params=None, retries=4):
    last = None
    for i in range(retries):
        try:
            r = requests.get(f"{API}{path}", params=params or {}, headers={"X-API-Key": key}, timeout=60)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                time.sleep(5 * (i + 1))
                continue
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code in (401, 403, 404):
                break
        except Exception as e:
            last = str(e)
        time.sleep(2 ** i)
    raise RuntimeError(last)


def to_ugm3(value, unit, pollutant):
    unit = (unit or "").lower().replace("³", "3")
    mw = C.POLLUTANTS[pollutant]["mw"]
    if unit in ("ppm",) and mw:
        return value * 1000.0 * mw / 24.45
    if unit in ("ppb",) and mw:
        return value * mw / 24.45
    if unit in ("mg/m3",):
        return value * 1000.0
    return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=365)
    a = ap.parse_args()
    key = os.getenv("OPENAQ_API_KEY", "")
    if not key:
        print("-> Thiếu OPENAQ_API_KEY trong backend/.env (đăng ký miễn phí tại https://explore.openaq.org).")
        return
    store.ensure_schema()
    locs = _get("/locations", key, {"bbox": BBOX, "limit": 1000}).get("results", [])
    print(f"-> {len(locs)} trạm OpenAQ trong phạm vi TP.HCM")
    t1 = datetime.now(timezone.utc)
    t0 = t1 - timedelta(days=a.days)
    stations, obs = [], []
    from app.services import ward_index
    for loc in locs:
        coords = loc.get("coordinates") or {}
        lat, lon = coords.get("latitude"), coords.get("longitude")
        if lat is None:
            continue
        w = ward_index.locate(lat, lon)
        sid = f"OAQ-{loc['id']}"
        stations.append({"ma_tram": sid, "ten_tram": loc.get("name"), "lat": lat, "lon": lon,
                         "ma_phuong_xa": w["ma_phuong_xa"] if w else None,
                         "nha_cung_cap": (loc.get("provider") or {}).get("name"), "qc_class": None, "nguon": "openaq",
                         "giay_phep": ", ".join(str((l or {}).get("name")) for l in (loc.get("licenses") or []))})
        for sen in loc.get("sensors") or []:
            par = (sen.get("parameter") or {})
            pol = PARAM_MAP.get(par.get("name"))
            if not pol:
                continue
            page = 1
            while True:
                try:
                    res = _get(f"/sensors/{sen['id']}/hours", key, {"datetime_from": t0.isoformat(),
                                                                   "datetime_to": t1.isoformat(), "limit": 1000,
                                                                   "page": page}).get("results", [])
                except Exception as e:
                    print(f"   cảm biến {sen['id']}: {e}")
                    break
                for m in res:
                    per = (m.get("period") or {}).get("datetimeFrom") or {}
                    tu = per.get("utc")
                    if tu is None or m.get("value") is None:
                        continue
                    t_local = pd.Timestamp(tu).tz_convert("Asia/Ho_Chi_Minh").tz_localize(None).floor("h")
                    obs.append({"ma_tram": sid, "thoi_gian": t_local, "chat": pol,
                                "gia_tri": to_ugm3(float(m["value"]), par.get("units"), pol), "don_vi": "µg/m³",
                                "qc": 0, "nguon": "openaq"})
                if len(res) < 1000:
                    break
                page += 1
                time.sleep(0.3)
        print(f"   {loc.get('name')}: {sum(1 for o in obs if o['ma_tram'] == sid):,} giờ")
    if stations:
        store.upsert("kk_tram", pd.DataFrame(stations))
    if not obs:
        print("-> Không có số liệu giờ.")
        return
    ob = pd.DataFrame(obs).drop_duplicates(["ma_tram", "thoi_gian", "chat"])
    store.upsert("kk_quantrac_tram_gio", ob)
    # So sánh với bộ dữ liệu đồng nhất
    st = pd.DataFrame(stations).set_index("ma_tram")
    out = {}
    for (sid, pol), g in ob.groupby(["ma_tram", "chat"]):
        code = st.loc[sid, "ma_phuong_xa"]
        if not code or len(g) < 48:
            continue
        hw = store.ward_hourly(g["thoi_gian"].min(), g["thoi_gian"].max(), code)
        if hw.empty or pol not in hw:
            continue
        m = g.merge(hw[["thoi_gian", pol]], on="thoi_gian", how="inner").dropna()
        if len(m) < 48:
            continue
        y, x = m["gia_tri"].to_numpy(float), m[pol].to_numpy(float)
        e = x - y
        out[f"{sid}|{pol}"] = {"tram": st.loc[sid, "ten_tram"], "ma_phuong_xa": code, "chat": pol, "n": int(len(m)),
                               "mae": round(float(np.mean(np.abs(e))), 2), "rmse": round(float(np.sqrt(np.mean(e ** 2))), 2),
                               "bias": round(float(np.mean(e)), 2), "r": round(float(np.corrcoef(x, y)[0, 1]), 3),
                               "ratio_mean": round(float(x.mean() / max(y.mean(), 1e-9)), 3),
                               "obs_mean": round(float(y.mean()), 2), "harmonized_mean": round(float(x.mean()), 2)}
    os.makedirs(C.ANALYTICS_DIR, exist_ok=True)
    with open(os.path.join(C.ANALYTICS_DIR, "openaq_validation.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("\n==== KIỂM CHỨNG BỘ DỮ LIỆU ĐỒNG NHẤT BẰNG TRẠM MẶT ĐẤT ====")
    for k, v in out.items():
        print(f"{v['tram'][:30]:<30} {v['chat']:<6} n={v['n']:>5}  MAE {v['mae']:>7}  RMSE {v['rmse']:>7}  "
              f"bias {v['bias']:>7}  r {v['r']:>6}  tỷ lệ TB {v['ratio_mean']}")


if __name__ == "__main__":
    main()
