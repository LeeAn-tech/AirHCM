"""
NẠP DỮ LIỆU LỊCH SỬ ĐA CHẤT VÀO POSTGRESQL (chạy một lần, có thể chạy lại an toàn)

    cd backend
    python scripts/airdata_backfill.py                         # 04/08/2022 -> hôm nay, đủ 4 bước
    python scripts/airdata_backfill.py --start 2025-01-01 --steps cams,harmonize
    python scripts/airdata_backfill.py --steps harmonize       # chỉ chạy lại giải thuật đồng nhất

Các bước: cams (Open-Meteo) | era5 (GEE) | sat (GEE: Sentinel-5P + MAIAC) | harmonize
Yêu cầu: đã `earthengine authenticate` (hoặc khai báo service account trong .env) cho bước era5/sat.
"""
import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.airdata import config as C  # noqa: E402
from app.airdata import pipeline  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Nạp lịch sử AirData")
    ap.add_argument("--start", default=C.HISTORY_START.isoformat())
    ap.add_argument("--end", default=date.today().isoformat())
    ap.add_argument("--steps", default="cams,era5,sat,harmonize")
    a = ap.parse_args()
    t = time.time()
    pipeline.backfill(date.fromisoformat(a.start), date.fromisoformat(a.end),
                      steps=tuple(s.strip() for s in a.steps.split(",")))
    print(f"==> Xong sau {(time.time() - t) / 60:.1f} phút.")


if __name__ == "__main__":
    main()
