"""
HUẤN LUYỆN MÔ HÌNH DỰ BÁO ĐA CHẤT TỪ BỘ DỮ LIỆU ĐỒNG NHẤT (bảng kk_dongnhat_tp_gio)

    cd backend
    python scripts/airdata_train.py                    # HistGradientBoosting + XGBoost
    python scripts/airdata_train.py --models hgb,xgb,rf --pollutants pm2_5,pm10
    python scripts/airdata_train.py --extra-wx         # so sánh có/không khí tượng bổ sung (bức xạ, lớp biên,
                                                       # gió 100 m), chọn biến thể tốt hơn theo RMSE KIỂM ĐỊNH

Kết quả: saved_models/airdata/<chất>.joblib, metrics.json, figures/*.png (hình cho báo cáo).
Sau khi huấn luyện: khởi động lại backend hoặc gọi POST /api/v1/admin/air/reload-models.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd  # noqa: E402

from app.airdata import config as C  # noqa: E402
from app.airdata import store, train  # noqa: E402


def _val_rmse(summary_p):
    return min(v.get("rmse", float("inf")) for v in summary_p.get("validation", {}).values())


def train_with_extra(city, pollutants, models):
    """Huấn luyện 2 biến thể (không / có khí tượng bổ sung) trong cùng một lần, chọn theo RMSE kiểm định."""
    from app.airdata import features as F
    ex = store.extra_weather(end=pd.Timestamp.now().floor("h") + pd.Timedelta(days=9))
    if ex.empty:
        print("-> Chưa có khí tượng bổ sung: chạy scripts/airdata_extra_weather.py trước. Huấn luyện bản thường.")
        return train.train_all(city, pollutants, models)
    ex = ex.drop_duplicates("thoi_gian")
    cityx = city.merge(ex[["thoi_gian"] + [c for c in F.EXTRA_WX if c in ex.columns]], on="thoi_gian", how="left")
    print(f"-> Khí tượng bổ sung: {len(ex):,} giờ; độ phủ BLH {100 * cityx['boundary_layer_height'].notna().mean():.0f}%")
    d_base, d_x = tempfile.mkdtemp(), tempfile.mkdtemp()
    print("\n[1/2] Biến thể CƠ SỞ (khí tượng 10 m + lịch):")
    s_base, smp_base = train.train_all(city, pollutants, models, out_dir=d_base)
    print("\n[2/2] Biến thể BỔ SUNG (+ bức xạ, mây, độ cao lớp biên, gió 100 m, hệ số thông gió):")
    s_x, smp_x = train.train_all(cityx, pollutants, models, out_dir=d_x, extra=F.EXTRA_WX)
    summary, samples, compare = {}, {}, {}
    os.makedirs(C.MODEL_DIR, exist_ok=True)
    for p in s_base:
        use_x = p in s_x and _val_rmse(s_x[p]) < _val_rmse(s_base[p])
        src, sm, smp = (d_x, s_x[p], smp_x[p]) if use_x else (d_base, s_base[p], smp_base[p])
        shutil.copy(os.path.join(src, f"{p}.joblib"), os.path.join(C.MODEL_DIR, f"{p}.joblib"))
        summary[p], samples[p] = sm, smp
        compare[p] = {"chosen": "bo_sung" if use_x else "co_so",
                      "val_rmse_co_so": round(_val_rmse(s_base[p]), 3),
                      "val_rmse_bo_sung": round(_val_rmse(s_x[p]), 3) if p in s_x else None,
                      "test_rmse_co_so": s_base[p]["metrics"]["model"]["all"].get("rmse"),
                      "test_rmse_bo_sung": s_x[p]["metrics"]["model"]["all"].get("rmse") if p in s_x else None}
        summary[p]["variant_compare"] = compare[p]
    with open(os.path.join(C.MODEL_DIR, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("\n=========== SO SÁNH BIẾN THỂ (RMSE kiểm định -> chọn; RMSE kiểm thử để báo cáo) ===========")
    for p, c in compare.items():
        print(f"{C.POLLUTANTS[p]['name']:<7} kiểm định: cơ sở {c['val_rmse_co_so']} | bổ sung {c['val_rmse_bo_sung']}  "
              f"-> chọn {c['chosen']:<8} | kiểm thử: cơ sở {c['test_rmse_co_so']} | bổ sung {c['test_rmse_bo_sung']}")
    return summary, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="hgb,xgb")
    ap.add_argument("--pollutants", default=",".join(C.FORECAST_POLLUTANTS))
    ap.add_argument("--extra-wx", action="store_true", help="so sánh thêm biến thể có khí tượng bổ sung")
    a = ap.parse_args()
    t = time.time()
    city = store.city_hourly(end=pd.Timestamp.now().floor("h"))
    print(f"-> Chuỗi cấp TP: {len(city):,} giờ ({city['thoi_gian'].min()} -> {city['thoi_gian'].max()})")
    pols = [p.strip() for p in a.pollutants.split(",")]
    models = tuple(m.strip() for m in a.models.split(","))
    if a.extra_wx:
        summary, samples = train_with_extra(city, pols, models)
    else:
        summary, samples = train.train_all(city, pols, models)
    figs = train.save_figures(summary, samples)
    print("\n================ KẾT QUẢ KIỂM THỬ (RMSE, µg/m³) ================")
    print(f"{'Chất':<7}{'Mô hình':<22}{'1-24h':>9}{'25-72h':>9}{'73-192h':>9}{'Bền vững 1-24h':>16}{'Kỹ năng':>9}")
    for p, s in summary.items():
        m = s["metrics"]
        print(f"{C.POLLUTANTS[p]['name']:<7}{s['model_name']:<22}"
              f"{m['model']['1-24h'].get('rmse', '-'):>9}{m['model']['25-72h'].get('rmse', '-'):>9}"
              f"{m['model']['73-192h'].get('rmse', '-'):>9}{m['persistence']['1-24h'].get('rmse', '-'):>16}"
              f"{m['model']['all'].get('skill_vs_persistence', '-'):>9}")
    print(f"\nĐã lưu: {C.MODEL_DIR}\\metrics.json; hình: {', '.join(os.path.basename(f) for f in figs)}")
    print("Tiếp theo: python scripts/airdata_analytics.py  (hiệu chỉnh xác suất + số liệu báo cáo)")
    print(f"==> Xong sau {(time.time() - t) / 60:.1f} phút.")


if __name__ == "__main__":
    main()
