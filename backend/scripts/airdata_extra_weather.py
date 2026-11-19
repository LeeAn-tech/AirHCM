"""
NẠP KHÍ TƯỢNG BỔ SUNG CẤP TP (bức xạ, mây, độ cao lớp biên, gió 100 m) TỪ OPEN-METEO

    cd backend
    python scripts/airdata_extra_weather.py                 # 04/08/2022 -> hôm nay + 9 ngày tới
    python scripts/airdata_extra_weather.py --start 2024-01-01

Sau đó huấn luyện so sánh: python scripts/airdata_train.py --extra-wx
Backend tự cập nhật phần dự báo 3 giờ/lần khi bảng đã có dữ liệu (tắt bằng AIRDATA_EXTRA_WX=0).
"""
import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.airdata import config as C  # noqa: E402
from app.airdata import sources_extra_weather as XW  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default=C.HISTORY_START.isoformat())
    ap.add_argument("--end", default=date.today().isoformat())
    a = ap.parse_args()
    t = time.time()
    n = XW.backfill(date.fromisoformat(a.start), date.fromisoformat(a.end))
    print(f"==> Đã lưu {n:,} giờ vào kk_khituong_bosung_tp_gio sau {(time.time() - t) / 60:.1f} phút.")


if __name__ == "__main__":
    main()
