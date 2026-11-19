"""
API PHÂN TÍCH NÂNG CAO (bổ sung theo tài liệu "Hệ thống dự báo, phân tích xác suất và truy tìm nguồn thải")

  GET  /api/v1/air/catalog              Danh mục nguồn/biến/giới hạn, bảng ngưỡng QCVN 05:2023 vs WHO 2021, quy đổi Nm³
  GET  /api/v1/air/qaqc                 Báo cáo QA/QC: độ đầy đủ, âm, spike, chuỗi đứng, TB 24h hợp lệ, cờ nguồn gốc
  GET  /api/v1/air/windrose             Hoa gió + hoa gió ô nhiễm (F_k, C̄_k, P_k, CBPF, lặng gió, độ nhạy)
  GET  /api/v1/air/probability          Dự báo xác suất: q05/q50/q95 theo giờ, P(vượt ngưỡng) theo ngày, 2 ngày liên tục
  GET  /api/v1/air/risk                 Rủi ro 168 phường × 8 ngày: P(vượt), A_T, N_T, E[N_T], PWE
  GET  /api/v1/air/risk.csv             Xuất CSV bảng rủi ro phường
  GET  /api/v1/air/stats                Thống kê mô tả: TB, trung vị, P90/P95, phương sai, giờ vượt, chuỗi vượt dài nhất
  GET  /api/v1/air/trace                Truy vết nguồn theo thang A-E + điểm nghi vấn + quỹ đạo ngược
  GET  /api/v1/air/emission-sources     Danh sách ứng viên nguồn thải (OSM/FIRMS/điểm nóng vệ tinh)
  GET  /api/v1/air/scenarios            Danh mục biện pháp, tỷ phần ngành (giả định), kịch bản mẫu
  POST /api/v1/air/scenarios/evaluate   Đánh giá kịch bản: ΔC, % giảm, PopBenef, người-giờ tránh được, sức khỏe, NPV/BCR
  POST /api/v1/air/scenarios/optimize   Tối ưu tổ hợp biện pháp theo ngân sách + ràng buộc công bằng, biên Pareto
  GET  /api/v1/air/acceptance           Bảng tiêu chí nghiệm thu (mục 13) tự đánh giá
  GET  /api/v1/air/evaluation-extra     Kết quả đánh giá mở rộng (theo mùa, cực trị, xác suất) do script tạo
"""
import io
import json
import os
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.airdata import analytics as AN
from app.airdata import config as C
from app.airdata import scenarios as SC
from app.airdata.forecast import ENGINE

router = APIRouter()
TAG = "Phân tích nâng cao: xác suất, rủi ro, truy nguồn, kịch bản"


def clean(o):
    """Chuyển kiểu numpy/pandas sang kiểu JSON chuẩn (NaN -> null)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return [clean(v) for v in o.tolist()]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp,)):
        return str(o)
    return o


def _ok(data):
    if isinstance(data, dict) and data.get("ok") is False:
        raise HTTPException(status_code=503, detail=data.get("reason") or "Chưa có dữ liệu.")
    return clean(data)


def _check_pollutant(p):
    if p not in C.POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Chất không hợp lệ. Chọn: {', '.join(C.AQI_POLLUTANTS)}")


@router.get("/api/v1/air/catalog", tags=[TAG])
def air_catalog():
    return clean(AN.catalog_payload())


@router.get("/api/v1/air/qaqc", tags=[TAG])
def air_qaqc(days: int = Query(30, ge=1, le=400)):
    return clean(AN.qaqc_payload(ENGINE.loader, days))


@router.get("/api/v1/air/windrose", tags=[TAG])
def air_windrose(ward_code: Optional[str] = None, pollutant: str = "pm2_5", days: int = Query(90, ge=3, le=1500),
                 sectors: int = Query(8, description="8 hoặc 16 hướng"), threshold: Optional[float] = None,
                 calm: Optional[float] = Query(None, description="Ngưỡng lặng gió m/s (mặc định 0,5)")):
    _check_pollutant(pollutant)
    if sectors not in (8, 16):
        raise HTTPException(status_code=400, detail="sectors phải là 8 hoặc 16")
    return _ok(AN.windrose_payload(ENGINE.loader, ward_code, pollutant, days, sectors, threshold, calm))


@router.get("/api/v1/air/probability", tags=[TAG])
def air_probability(ward_code: Optional[str] = None, lat: Optional[float] = None, lng: Optional[float] = None,
                    pollutant: str = "pm2_5", standard: str = Query("qcvn", pattern="^(qcvn|who)$"),
                    threshold: Optional[float] = Query(None, description="Ngưỡng giờ tùy chọn (µg/m³)")):
    _check_pollutant(pollutant)
    return _ok(AN.probability_payload(ENGINE, ward_code, lat, lng, pollutant, standard, threshold))


@router.get("/api/v1/air/risk", tags=[TAG])
def air_risk(pollutant: str = "pm2_5", standard: str = Query("qcvn", pattern="^(qcvn|who)$")):
    _check_pollutant(pollutant)
    return _ok(AN.risk_payload(ENGINE, pollutant, standard))


@router.get("/api/v1/air/risk.csv", tags=[TAG])
def air_risk_csv(pollutant: str = "pm2_5", standard: str = Query("qcvn", pattern="^(qcvn|who)$")):
    _check_pollutant(pollutant)
    r = AN.risk_payload(ENGINE, pollutant, standard)
    if not r.get("ok"):
        raise HTTPException(status_code=503, detail=r.get("reason"))
    rows = []
    for w in r["wards"]:
        for d, x in zip(r["days"], w["days"]):
            rows.append({"ma_phuong_xa": w["ma_phuong_xa"], "ten_phuong_xa": w["ten_phuong_xa"], "ngay": d,
                         "chat": pollutant, "chuan": standard, "ky_tb": r["period"], "nguong": r["threshold"],
                         "q05": x["q05"], "q50": x["q50"], "q95": x["q95"], "xac_suat_vuot": x["p"],
                         "xs_vuot_ca_ngay_sau": x["p_next_day_too"], "dan_so": w["dan_so"],
                         "dan_so_phoi_nhiem_ky_vong": x["expected_exposed"]})
    buf = io.StringIO()
    pd.DataFrame(rows).to_csv(buf, index=False)
    data = io.BytesIO(("﻿" + buf.getvalue()).encode("utf-8"))
    name = f"airhcm_rui_ro_{pollutant}_{standard}_{r['days'][0]}.csv"
    return StreamingResponse(data, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/api/v1/air/stats", tags=[TAG])
def air_stats(ward_code: Optional[str] = None, pollutant: str = "pm2_5", days: int = Query(90, ge=2, le=1500),
              threshold: Optional[float] = None):
    _check_pollutant(pollutant)
    return _ok(AN.stats_payload(ENGINE.loader, ward_code, pollutant, days, threshold))


@router.get("/api/v1/air/trace", tags=[TAG])
def air_trace(ward_code: Optional[str] = None, pollutant: str = "pm2_5", days: int = Query(30, ge=3, le=365),
              event_date: Optional[str] = Query(None, description="YYYY-MM-DD; bỏ trống = ngày ô nhiễm nhất")):
    _check_pollutant(pollutant)
    return _ok(AN.trace_payload(ENGINE, ward_code, pollutant, days, event_date))


@router.get("/api/v1/air/emission-sources", tags=[TAG])
def air_emission_sources():
    df = AN.candidate_sources()
    if df is None or df.empty:
        return {"sources": [], "note": "Chưa có ứng viên nguồn: chạy scripts/airdata_import_sources.py."}
    from app.airdata.source_trace import SOURCE_TYPES
    cols = [c for c in ("source_id", "ten", "loai", "lat", "lon", "dien_tich_ha", "chat_lien_quan", "hoat_dong",
                        "nguon_du_lieu", "ngay_du_lieu", "da_xac_minh") if c in df.columns]
    out = df[cols].copy()
    out["loai_label"] = out["loai"].map(lambda t: SOURCE_TYPES.get(t, {}).get("label", t))
    return clean({"sources": out.where(pd.notna(out), None).to_dict("records"), "types": SOURCE_TYPES})


class MeasureOverride(BaseModel):
    id: str
    reduction: Optional[float] = None
    efficiency: Optional[float] = None
    cost: Optional[float] = None
    scope: Optional[str] = None
    sector: Optional[str] = None
    name: Optional[str] = None


class ScenarioRequest(BaseModel):
    pollutant: str = "pm2_5"
    mode: str = "past"                       # past: 30 ngày số liệu đồng nhất | forecast: hôm nay + 7 ngày
    days: int = 30
    threshold: Optional[float] = None
    scenarios: Optional[Dict[str, Dict]] = None   # {"S4": {"name": "...", "measures": ["M1", "M6"]}}
    overrides: Optional[List[MeasureOverride]] = None
    baseline_mortality_per_1000: Optional[float] = None
    rr_per10: Optional[float] = None
    benefit_per_year: Optional[float] = None
    capex: Optional[float] = None
    years: int = 5
    rate: float = C.DISCOUNT_RATE


@router.get("/api/v1/air/scenarios", tags=[TAG])
def air_scenarios_catalog():
    return clean(SC.catalog())


@router.post("/api/v1/air/scenarios/evaluate", tags=[TAG])
def air_scenarios_evaluate(req: ScenarioRequest):
    _check_pollutant(req.pollutant)
    health = {"baseline_mortality_per_1000": req.baseline_mortality_per_1000,
              "rr_per10": req.rr_per10 or C.HEALTH_RR_PM25_PER10["central"]}
    econ = ({"benefit_per_year": req.benefit_per_year, "capex": req.capex or 0.0, "years": req.years, "rate": req.rate}
            if req.benefit_per_year is not None else None)
    ov = [o.model_dump(exclude_none=True) if hasattr(o, "model_dump") else o.dict(exclude_none=True)
          for o in (req.overrides or [])]
    return _ok(AN.scenarios_payload(ENGINE, req.pollutant, req.mode, req.days, req.threshold, req.scenarios, ov,
                                    health, econ))


class OptimizeRequest(BaseModel):
    pollutant: str = "pm2_5"
    budget: float = 15.0
    equity_min_pct: float = 0.0
    mode: str = "past"
    days: int = 30
    candidates: Optional[List[str]] = None
    overrides: Optional[List[MeasureOverride]] = None


@router.post("/api/v1/air/scenarios/optimize", tags=[TAG])
def air_scenarios_optimize(req: OptimizeRequest):
    _check_pollutant(req.pollutant)
    ov = [o.model_dump(exclude_none=True) if hasattr(o, "model_dump") else o.dict(exclude_none=True)
          for o in (req.overrides or [])]
    return _ok(AN.optimize_payload(ENGINE, req.pollutant, req.budget, req.equity_min_pct, req.mode, req.days, ov,
                                   req.candidates))


@router.get("/api/v1/air/acceptance", tags=[TAG])
def air_acceptance():
    return clean(AN.acceptance_payload(ENGINE))


@router.get("/api/v1/air/evaluation-extra", tags=[TAG])
def air_evaluation_extra():
    out = {}
    for name in ("evaluation_extra", "summary", "qaqc", "trace", "scenarios"):
        path = os.path.join(C.ANALYTICS_DIR, f"{name}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                out[name] = json.load(f)
    if os.path.exists(C.UNCERTAINTY_FILE):
        with open(C.UNCERTAINTY_FILE, encoding="utf-8") as f:
            unc = json.load(f)
        out["uncertainty"] = {p: {k: v for k, v in d.items() if k not in ("hourly", "daily_joint")} for p, d in unc.items()}
    if not out:
        raise HTTPException(status_code=404, detail="Chưa chạy scripts/airdata_analytics.py.")
    return out
