"""
Bổ sung hình học ranh giới phường/xã còn thiếu (geom IS NULL) trong bảng HanhChinh_HCM
từ file GeoJSON của WebGIS (frontend/assets/data/hcm_wards.json).

- Chỉ cập nhật các dòng đang có geom = NULL, khớp theo mã phường (ma_phuong_xa = ma_xa).
- Không sửa / xóa các dòng đã có hình học.
- Mặc định chạy thử (không ghi CSDL). Thêm --apply để ghi thật.

Cách dùng (chạy trong thư mục backend):
    python scripts/import_ward_geometry.py            # xem trước
    python scripts/import_ward_geometry.py --apply    # ghi vào PostGIS
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402
from app.database import engine  # noqa: E402

GEOJSON_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "assets", "data", "hcm_wards.json",
)


def main(apply: bool):
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        features = json.load(f)["features"]
    by_code = {
        str(feat["properties"].get("ma_xa")): feat["geometry"]
        for feat in features if feat.get("geometry")
    }

    with engine.begin() as conn:
        missing = conn.execute(text(
            "SELECT ma_phuong_xa, ten_phuong_xa FROM HanhChinh_HCM WHERE geom IS NULL ORDER BY ma_phuong_xa"
        )).fetchall()
        print(f"Số phường/xã chưa có hình học: {len(missing)}")

        updated, not_found = 0, []
        for row in missing:
            geom = by_code.get(str(row.ma_phuong_xa))
            if not geom:
                not_found.append(f"{row.ma_phuong_xa} {row.ten_phuong_xa}")
                continue
            if apply:
                conn.execute(text("""
                    UPDATE HanhChinh_HCM
                    SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)))
                    WHERE ma_phuong_xa = :code AND geom IS NULL;
                """), {"g": json.dumps(geom), "code": str(row.ma_phuong_xa)})
            updated += 1

        if not apply:
            conn.rollback()

    print(f"{'Đã cập nhật' if apply else 'Sẽ cập nhật'}: {updated} phường/xã")
    if not_found:
        print(f"Không tìm thấy trong GeoJSON ({len(not_found)}): {', '.join(not_found[:10])}")
    if not apply:
        print("Chạy lại với --apply để ghi vào CSDL.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
