"""
XUẤT BỘ DỮ LIỆU ĐỒNG NHẤT (168 phường × giờ) RA CSV.GZ THEO NĂM - phục vụ báo cáo/nộp kèm đồ án

    cd backend
    python scripts/airdata_export.py --out ../data_export
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd  # noqa: E402

from app.airdata import store  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("..", "data_export"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    cov = store.coverage_summary()["kk_dongnhat_phuong_gio"]
    y0, y1 = pd.Timestamp(cov["from"]).year, pd.Timestamp(cov["to"]).year
    for y in range(y0, y1 + 1):
        df = store.ward_hourly(f"{y}-01-01 00:00", f"{y}-12-31 23:00")
        path = os.path.join(a.out, f"airhcm_dongnhat_phuong_gio_{y}.csv.gz")
        df.to_csv(path, index=False, compression="gzip")
        print(f"-> {path}: {len(df):,} dòng")
    city = store.city_hourly()
    city.to_csv(os.path.join(a.out, "airhcm_dongnhat_tp_gio.csv.gz"), index=False, compression="gzip")
    print("==> Xong.")


if __name__ == "__main__":
    main()
