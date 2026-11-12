"""
Chỉ mục không gian ranh giới phường/xã từ GeoJSON (dự phòng cho PostGIS).

CSDL HanhChinh_HCM hiện chỉ có hình học cho một phần phường/xã, nên các truy vấn
không gian (điểm thuộc phường nào, tâm phường cho bản đồ nhiệt) dùng thêm file
GeoJSON đầy đủ của WebGIS. Chạy scripts/import_ward_geometry.py để bổ sung hình học
còn thiếu vào PostGIS.
"""
import json
import os
import threading

try:
    from shapely.geometry import Point, shape
    _SHAPELY_OK = True
except Exception as e:  # pragma: no cover
    print(f"-> [WardIndex] Không nạp được shapely: {e}")
    _SHAPELY_OK = False

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CANDIDATE_FILES = [
    os.path.join(BACKEND_DIR, "..", "frontend", "assets", "data", "hcm_wards.json"),
    os.path.join(BACKEND_DIR, "..", "airhcm_mobile", "assets", "data", "hcm_wards.json"),
]

_METERS_PER_DEGREE = 111_320.0
_lock = threading.Lock()
_wards = None  # list[dict(code, name, type, area, geom, rep_lat, rep_lng)]


def _load():
    global _wards
    if _wards is not None:
        return _wards
    with _lock:
        if _wards is not None:
            return _wards
        _wards = []
        if not _SHAPELY_OK:
            return _wards
        path = next((p for p in CANDIDATE_FILES if os.path.exists(p)), None)
        if not path:
            print("-> [WardIndex] Không tìm thấy hcm_wards.json")
            return _wards
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for feat in data.get("features", []):
                props = feat.get("properties") or {}
                geom_json = feat.get("geometry")
                if not geom_json:
                    continue
                geom = shape(geom_json)
                if geom.is_empty:
                    continue
                if not geom.is_valid:
                    geom = geom.buffer(0)
                rep = geom.representative_point()
                _wards.append({
                    "code": str(props.get("ma_xa") or props.get("ma_phuong_xa") or ""),
                    "name": props.get("ten_xa") or props.get("ten_phuong_xa") or "Phường/Xã",
                    "type": props.get("loai") or props.get("loai_don_vi") or "",
                    "area": float(props.get("dtich_km2") or props.get("dien_tich_km2") or 0),
                    "geom": geom,
                    "rep_lat": rep.y,
                    "rep_lng": rep.x,
                })
            print(f"-> [WardIndex] Đã nạp {len(_wards)} ranh giới phường/xã từ GeoJSON.")
        except Exception as e:
            print(f"-> [WardIndex] Lỗi đọc GeoJSON: {e}")
        return _wards


def locate(lat: float, lng: float, max_distance_m: float = 3000):
    """Phường/xã chứa điểm; nếu nằm ngoài ranh giới thì trả về phường gần nhất trong bán kính cho phép"""
    wards = _load()
    if not wards:
        return None
    pt = Point(lng, lat)
    for w in wards:
        if w["geom"].contains(pt):
            return _public(w, inside=True, distance_m=0)
    nearest = min(wards, key=lambda w: w["geom"].distance(pt))
    distance_m = nearest["geom"].distance(pt) * _METERS_PER_DEGREE
    if distance_m <= max_distance_m:
        return _public(nearest, inside=False, distance_m=round(distance_m))
    return None


def by_code(code):
    """Phường/xã theo mã (ma_xa) - dùng khi giao diện đã biết người dùng chọn phường nào"""
    code = str(code or "").strip()
    if not code:
        return None
    for w in _load() or []:
        if w["code"] == code:
            return _public(w, inside=True, distance_m=0)
    return None


def all_wards():
    """Danh mục phường/xã trong GeoJSON: mã, tên, loại, diện tích"""
    return [{"code": w["code"], "name": w["name"], "type": w["type"], "area": w["area"]} for w in _load() or []]


def representative_points():
    """Điểm đại diện (nằm trong đa giác) của từng phường/xã"""
    return [
        {"code": w["code"], "name": w["name"], "lat": w["rep_lat"], "lng": w["rep_lng"]}
        for w in _load()
    ]


def _public(w, inside, distance_m):
    return {
        "ma_phuong_xa": w["code"],
        "ten_phuong_xa": w["name"],
        "loai_don_vi": w["type"],
        "dien_tich_km2": w["area"],
        "inside": inside,
        "distance_m": distance_m,
        "source": "geojson",
    }
