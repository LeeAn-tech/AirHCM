"""
API REST PHÂN HỆ AIRDATA (đa chất ô nhiễm, dự báo realtime 7 ngày, xu hướng tháng)

  GET  /api/v1/air/forecast        Hôm nay + hiện tại + chuỗi giờ (hôm nay -> hết ngày thứ 7) + 8 thẻ ngày + xu hướng tháng
  GET  /api/v1/air/current         Số liệu hiện tại đa chất của phường/TP
  GET  /api/v1/air/spatial         Giá trị 168 phường tại một giờ (bản đồ)
  GET  /api/v1/air/sources         Nguồn dữ liệu, độ phân giải gốc/đích, mô tả giải thuật đồng nhất, độ phủ CSDL
  GET  /api/v1/air/model-metrics   Kết quả huấn luyện/kiểm thử các mô hình
  GET  /api/v1/air/verification    Đối chiếu trực tuyến dự báo đã phát hành với số liệu thực
  GET  /api/v1/air/status          Trạng thái luồng cập nhật realtime
  POST /api/v1/admin/air/update    (admin) chạy ngay một lượt cập nhật realtime
  POST /api/v1/admin/air/reload-models (admin) nạp lại mô hình sau khi huấn luyện
"""
import json
import os
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.airdata import config as C
from app.airdata import pipeline
from app.airdata.forecast import ENGINE
from app.services.auth_service import require_admin

router = APIRouter()
TAG = "Dữ liệu không khí đa chất (AirData)"


def _payload_or_503(**kw):
    try:
        data = ENGINE.payload(**kw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi động cơ dự báo: {e}")
    if not data.get("ok"):
        raise HTTPException(status_code=503, detail=data.get("reason") or "Chưa có dữ liệu.")
    return data


@router.get("/api/v1/air/forecast", tags=[TAG])
def air_forecast(ward_code: Optional[str] = Query(None, description="Mã phường/xã (ưu tiên)"),
                 lat: Optional[float] = Query(None), lng: Optional[float] = Query(None),
                 hourly: bool = Query(True, description="Kèm chuỗi theo giờ")):
    """Dự báo realtime: mở ứng dụng là có ngày hiện tại, giờ hiện tại và 7 ngày tới (đa chất + VN_AQI/US AQI)."""
    data = _payload_or_503(ward_code=ward_code, lat=lat, lng=lng)
    if not hourly:
        data.pop("hourly", None)
    return data


@router.get("/api/v1/air/current", tags=[TAG])
def air_current(ward_code: Optional[str] = None, lat: Optional[float] = None, lng: Optional[float] = None):
    data = _payload_or_503(ward_code=ward_code, lat=lat, lng=lng)
    return {k: data[k] for k in ("generated_at", "today", "location", "current", "pollutants")} | {
        "today_summary": data["daily"][0] if data["daily"] else None}


@router.get("/api/v1/air/spatial", tags=[TAG])
def air_spatial(pollutant: str = Query("pm2_5"), time: Optional[str] = Query(None, description="YYYY-MM-DD HH:00")):
    if pollutant not in C.POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Chất không hợp lệ. Chọn: {', '.join(C.POLLUTANTS)}")
    data = ENGINE.spatial(pollutant, time)
    if data is None:
        raise HTTPException(status_code=503, detail="Chưa có dữ liệu đồng nhất theo phường.")
    return data


@router.get("/api/v1/air/spatial-series", tags=[TAG])
def air_spatial_series(pollutant: str = Query("pm2_5"),
                       back: int = Query(24, ge=0, le=720, description="Số giờ quá khứ"),
                       ahead: int = Query(72, ge=0, le=192, description="Số giờ dự báo"),
                       step: int = Query(1, ge=1, le=24, description="Bước thời gian (giờ)")):
    """Chuỗi không gian - thời gian: giá trị + VN_AQI/US AQI của 168 phường cho từng giờ (bản đồ 3D)."""
    if pollutant not in C.POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Chất không hợp lệ. Chọn: {', '.join(C.POLLUTANTS)}")
    data = ENGINE.spatial_series(pollutant, back, ahead, step)
    if data is None:
        raise HTTPException(status_code=503, detail="Chưa có dữ liệu đồng nhất theo phường.")
    return data


@router.get("/api/v1/air/sources", tags=[TAG])
def air_sources():
    from app.airdata import harmonize
    coverage = {}
    try:
        from app.airdata import store
        coverage = store.coverage_summary()
    except Exception as e:
        coverage = {"error": str(e)[:150]}
    return {"sources": C.SOURCES, "target_resolution": C.TARGET_RESOLUTION,
            "algorithm": harmonize.__doc__, "pollutants": C.POLLUTANTS, "coverage": coverage}


@router.get("/api/v1/air/model-metrics", tags=[TAG])
def air_model_metrics():
    path = os.path.join(C.MODEL_DIR, "metrics.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Chưa huấn luyện mô hình (chạy scripts/airdata_train.py).")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/api/v1/air/verification", tags=[TAG])
def air_verification(days: int = Query(30, ge=1, le=180)):
    return ENGINE.verification(days=days)


@router.get("/api/v1/air/status", tags=[TAG])
def air_status():
    st = ENGINE.state()
    return {"pipeline": pipeline.status(), "engine_ok": st.get("ok"), "now": str(st.get("now")),
            "model": st.get("info"), "models_loaded": sorted(ENGINE.bundles().keys())}


@router.post("/api/v1/admin/air/update", dependencies=[Depends(require_admin)], tags=["Admin - ETL Pipeline"])
def air_admin_update(with_gee: bool = True):
    threading.Thread(target=pipeline.realtime_update, kwargs={"with_gee": with_gee}, daemon=True).start()
    return {"status": "started", "message": "Đang chạy cập nhật realtime (CAMS + khí tượng + GEE) ở luồng nền."}


@router.post("/api/v1/admin/air/reload-models", dependencies=[Depends(require_admin)], tags=["Admin - ETL Pipeline"])
def air_admin_reload():
    ENGINE.reload_models()
    return {"status": "ok", "models": sorted(ENGINE.bundles().keys())}
