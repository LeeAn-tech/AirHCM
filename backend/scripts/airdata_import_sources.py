"""
NẠP ỨNG VIÊN NGUỒN THẢI CHO TRUY VẾT (bảng kk_nguon_thai)

  1) OpenStreetMap (Overpass API, giấy phép ODbL - ghi nguồn "© OpenStreetMap contributors"):
     khu công nghiệp có tên, nhà máy điện nhiệt (loại trừ điện mặt trời/gió/thủy điện), cảng, sân bay,
     bãi rác, mỏ/công trường trong phạm vi TP.HCM (sau sáp nhập) và vùng lân cận.
  2) Điểm cháy FIRMS (Google Earth Engine, ImageCollection "FIRMS"), N ngày gần nhất, vùng Nam Bộ - Campuchia,
     gộp theo ô 0,1° -> phục vụ phân biệt ô nhiễm liên vùng do đốt sinh khối.
  3) Điểm nóng vệ tinh từ CSDL (tỷ số cột NO2/SO2/AOD của phường so với vùng lân cận, 60 ngày gần nhất).

    cd backend
    python scripts/airdata_import_sources.py                  # cả 3 nguồn
    python scripts/airdata_import_sources.py --no-firms --firms-days 14

Ứng viên chỉ phục vụ ƯU TIÊN KIỂM TRA; trạng thái da_xac_minh = FALSE cho tới khi xác minh thực địa.
"""
import argparse
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import requests  # noqa: E402

from app.airdata import store  # noqa: E402

BBOX_CITY = (10.30, 106.35, 11.55, 107.60)        # S, W, N, E
BBOX_REGION = (8.5, 103.5, 12.8, 108.0)           # vùng Nam Bộ - Campuchia cho điểm cháy
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
THERMAL = {"gas", "coal", "oil", "diesel", "biomass", "waste", "biogas", "gas;oil"}


def overpass_query(b):
    s, w, n, e = b
    bb = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:180];
(
  way["landuse"="industrial"]["name"]{bb};
  relation["landuse"="industrial"]["name"]{bb};
  nwr["power"="plant"]{bb};
  nwr["landuse"="port"]{bb};
  nwr["industrial"="port"]{bb};
  nwr["harbour"="yes"]["name"]{bb};
  nwr["aeroway"="aerodrome"]["name"]{bb};
  nwr["landuse"="landfill"]{bb};
  nwr["landuse"="quarry"]{bb};
);
out center tags;"""


def classify(tags):
    if tags.get("power") == "plant":
        src = (tags.get("plant:source") or tags.get("generator:source") or "").lower()
        if src and not (set(src.split(";")) & THERMAL):
            return None                                   # điện mặt trời/gió/thủy điện: không phát thải đốt
        return "nha_may_dien"
    if tags.get("landuse") == "industrial":
        return "khu_cong_nghiep"
    if tags.get("landuse") == "port" or tags.get("industrial") == "port" or tags.get("harbour") == "yes":
        return "cang"
    if tags.get("aeroway") == "aerodrome":
        return "san_bay"
    if tags.get("landuse") == "landfill":
        return "bai_rac"
    if tags.get("landuse") == "quarry":
        return "cong_truong"
    return None


def fetch_osm():
    q = overpass_query(BBOX_CITY)
    last = None
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": q}, timeout=240,
                              headers={"User-Agent": "AirHCM-HCMUNRE/2.0 (do an chuyen nganh)"})
            if r.status_code == 200:
                els = r.json().get("elements", [])
                break
            last = f"HTTP {r.status_code}"
        except Exception as e:
            last = str(e)
        time.sleep(3)
    else:
        raise RuntimeError(f"Overpass lỗi: {last}")
    rows = []
    for el in els:
        tags = el.get("tags", {})
        t = classify(tags)
        if not t:
            continue
        c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
        if c.get("lat") is None:
            continue
        name = tags.get("name:vi") or tags.get("name") or tags.get("operator") or t
        rows.append({"source_id": f"OSM-{el['type'][0]}{el['id']}", "ten": name, "loai": t,
                     "lat": float(c["lat"]), "lon": float(c["lon"]), "dien_tich_ha": None,
                     "chat_lien_quan": None, "hoat_dong": None,
                     "nguon_du_lieu": "OpenStreetMap (ODbL) qua Overpass", "ngay_du_lieu": date.today(),
                     "da_xac_minh": False})
    return pd.DataFrame(rows)


def fetch_firms(days=30, conf=50):
    from app.airdata import sources_gee as G
    ee = G._ee()
    end = date.today()
    start = end - timedelta(days=days)
    s, w, n, e = BBOX_REGION
    region = ee.Geometry.Rectangle([w, s, e, n])
    col = ee.ImageCollection("FIRMS").filterDate(start.isoformat(), end.isoformat()).filterBounds(region)
    cnt = col.map(lambda im: im.select("confidence").gt(conf).selfMask().rename("n")).count().rename("n")
    fc = cnt.sample(region=region, scale=1000, geometries=True, dropNulls=True, numPixels=20000).limit(5000)
    feats = fc.getInfo().get("features", [])
    if not feats:
        return pd.DataFrame()
    pts = pd.DataFrame([{"lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1],
                         "n": f["properties"].get("n", 1)} for f in feats])
    pts["cell_lat"] = (pts["lat"] / 0.1).round() * 0.1
    pts["cell_lon"] = (pts["lon"] / 0.1).round() * 0.1
    g = pts.groupby(["cell_lat", "cell_lon"]).agg(n=("n", "sum"), lat=("lat", "mean"), lon=("lon", "mean")).reset_index()
    g = g.sort_values("n", ascending=False).head(60)
    mx = np.log1p(g["n"].max())
    return pd.DataFrame({
        "source_id": [f"FIRMS-{a:.1f}-{b:.1f}" for a, b in zip(g["cell_lat"], g["cell_lon"])],
        "ten": [f"Cụm điểm cháy ({int(k)} điểm-ngày, {days} ngày)" for k in g["n"]],
        "loai": "diem_chay", "lat": g["lat"].astype(float), "lon": g["lon"].astype(float), "dien_tich_ha": None,
        "chat_lien_quan": "pm2_5,co,pm10", "hoat_dong": (np.log1p(g["n"]) / mx).round(3),
        "nguon_du_lieu": f"NASA FIRMS (GEE), {start}..{end}, confidence > {conf}", "ngay_du_lieu": end,
        "da_xac_minh": False})


def satellite_candidates():
    from app.airdata import source_trace as TR
    from app.services import ward_index
    sat = store.satellite(date.today() - timedelta(days=60), date.today())
    hs = TR.satellite_hotspots(sat, pd.DataFrame(ward_index.representative_points()))
    if hs.empty:
        return hs
    hs["dien_tich_ha"] = None
    hs["ngay_du_lieu"] = date.today()
    return hs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-osm", action="store_true")
    ap.add_argument("--no-firms", action="store_true")
    ap.add_argument("--no-sat", action="store_true")
    ap.add_argument("--firms-days", type=int, default=30)
    a = ap.parse_args()
    store.ensure_schema()
    cols = ["source_id", "ten", "loai", "lat", "lon", "dien_tich_ha", "chat_lien_quan", "hoat_dong", "nguon_du_lieu",
            "ngay_du_lieu", "da_xac_minh"]
    total = 0
    for name, fn, skip in (("OpenStreetMap", fetch_osm, a.no_osm),
                           ("FIRMS", lambda: fetch_firms(a.firms_days), a.no_firms),
                           ("Điểm nóng vệ tinh", satellite_candidates, a.no_sat)):
        if skip:
            continue
        try:
            df = fn()
            if df is None or df.empty:
                print(f"-> {name}: không có ứng viên")
                continue
            df = df.drop_duplicates("source_id")
            n = store.upsert("kk_nguon_thai", df[cols])
            total += n
            print(f"-> {name}: {n} ứng viên ({df['loai'].value_counts().to_dict()})")
        except Exception as e:
            print(f"-> {name}: lỗi {e}")
    print(f"==> Tổng {total} ứng viên trong kk_nguon_thai. Xem API: /api/v1/air/emission-sources")


if __name__ == "__main__":
    main()
