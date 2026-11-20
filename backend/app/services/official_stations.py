"""Trạm quan trắc không khí CHÍNH THỨC của TP.HCM - lớp tham khảo vị trí (không có số liệu).

Nguồn: Phụ lục 1, Chương trình quan trắc tài nguyên và môi trường TP.HCM năm 2026
(kèm Quyết định 921/QĐ-UBND ngày 11/02/2026). 157 điểm quan trắc không khí = 124 điểm định kỳ +
33 trạm tự động liên tục; 33 trạm này đang "tạm thời triển khai quan trắc định kỳ trong quá trình chờ
phát triển thành trạm tự động" và chưa công bố số liệu theo giờ.

Vì vậy AirHCM chỉ hiển thị VỊ TRÍ 33 trạm (backend/app/data/official_aq_stations.json) để đối chiếu;
không gán số AQI cho các điểm này. Tọa độ do AirHCM xác định từ địa chỉ trong văn bản (thuộc tính `accuracy`).
Số liệu chất lượng không khí của hệ thống là ƯỚC TÍNH từ vệ tinh + CAMS/ERA5 hạ quy mô về 168 phường.
"""
import json
import math
import os
from collections import Counter
from functools import lru_cache
from typing import Optional

PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "official_aq_stations.json")


@lru_cache(maxsize=1)
def collection() -> dict:
    try:
        with open(PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"-> [Trạm chính thức] Không đọc được {PATH}: {e}")
        return {"type": "FeatureCollection", "features": []}


def features() -> list:
    return collection().get("features", [])


@lru_cache(maxsize=1)
def count_by_ward() -> dict:
    """Số trạm chính thức (QĐ 921) nằm trong từng phường/xã: mã phường -> số trạm"""
    return dict(Counter(str(f["properties"].get("ward_code")) for f in features()))


def _distance_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest(lat: float, lng: float) -> Optional[dict]:
    """Trạm chính thức gần tọa độ nhất (chỉ thông tin vị trí, không có số đo)"""
    best = None
    for f in features():
        lo, la = f["geometry"]["coordinates"]
        d = _distance_m(lat, lng, la, lo)
        if best is None or d < best[0]:
            best = (d, f, la, lo)
    if best is None:
        return None
    d, f, la, lo = best
    p = f["properties"]
    return {
        "code": p.get("code"), "name": p.get("name"), "kind": p.get("kind"), "ward": p.get("ward"),
        "location": p.get("location"), "status": p.get("status"), "accuracy": p.get("accuracy"),
        "lat": la, "lng": lo, "distance_m": round(d),
        "source": "QĐ 921/QĐ-UBND ngày 11/02/2026",
    }
