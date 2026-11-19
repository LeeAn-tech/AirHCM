"""
KỊCH BẢN CAN THIỆP, ĐỊNH LƯỢNG HIỆU QUẢ VÀ TỐI ƯU LỰA CHỌN

Mô hình tác động (giản lược, minh bạch giả định):
    C_s,j,t = C_base,j,t · [1 − Σ_k share_p,k · (1 − Π_{m∈s, ngành k} (1 − r_m · e_m · cov_m,j))]
  share_p,k : tỷ phần ngành k trong nồng độ chất p (GIẢ ĐỊNH THỬ NGHIỆM, chưa kiểm chứng cho TP.HCM)
  r_m       : mức giảm hoạt động/phát thải của biện pháp m (0-1);  e_m: hiệu suất thực thi (0-1)
  cov_m,j   : phạm vi áp dụng tại phường j (1 = áp dụng)
Nhiều biện pháp cùng ngành kết hợp theo tích (không cộng giản đơn), phần nền liên vùng không đổi;
O3 là chất thứ cấp phi tuyến (NOx-VOC) -> KHÔNG suy tuyến tính từ giảm phát thải.

Chỉ tiêu (mục 9 tài liệu tham chiếu):
    ΔC_s = C_base − C_s;   tỷ lệ giảm = ΔC_s / C_base × 100%
    PopBenef_s = Σ_j Pop_j · I(C_s,j < C_base,j − δ)
    Người-giờ phơi nhiễm vượt ngưỡng tránh được = Σ_j,t Pop_j [I(C_base,j,t > T) − I(C_s,j,t > T)]
    Sức khỏe (chỉ phơi nhiễm dài hạn PM2.5): RR = exp(β·ΔC), AF = (RR − 1)/RR, β = ln(1,08)/10 (WHO 2021);
        ca tử vong tránh được ≈ y0 · Pop · (1 − exp(−β·ΔC))   (cần tỷ suất chết nền y0 - người dùng cung cấp)
    NPV_s = Σ_t (Benefit_t − Cost_t)/(1 + r)^t − CapEx_s;  BCR_s = PV(Benefit)/PV(Cost)
Tối ưu: min Σ_j Pop_j·E[C_j(s)] với Σ Cost ≤ Budget và ràng buộc công bằng (nhóm phường phơi nhiễm cao
nhất phải giảm tối thiểu x%); duyệt toàn bộ tổ hợp (≤ 12 biện pháp) + biên Pareto (chi phí - hiệu quả).
"""
import itertools
import math

import numpy as np
import pandas as pd

from app.airdata import config as C

SECTORS = {"giao_thong": "Giao thông", "cong_nghiep": "Công nghiệp, lò hơi", "xay_dung": "Xây dựng, bụi đường",
           "cang": "Tàu biển, cảng, logistics", "dot": "Đốt rác, sinh khối, cháy", "dan_dung": "Dân dụng, khác",
           "lien_vung": "Nền liên vùng (ngoài TP)"}

# GIẢ ĐỊNH THỬ NGHIỆM cho phần mềm - KHÔNG phải kết quả phân bổ nguồn đã kiểm chứng tại TP.HCM.
SECTOR_SHARES = {
    "pm2_5": {"giao_thong": 0.30, "cong_nghiep": 0.20, "xay_dung": 0.10, "cang": 0.05, "dot": 0.10, "dan_dung": 0.05, "lien_vung": 0.20},
    "pm10": {"giao_thong": 0.25, "cong_nghiep": 0.15, "xay_dung": 0.30, "cang": 0.05, "dot": 0.05, "dan_dung": 0.05, "lien_vung": 0.15},
    "no2": {"giao_thong": 0.60, "cong_nghiep": 0.15, "cang": 0.10, "dot": 0.02, "dan_dung": 0.05, "lien_vung": 0.08},
    "so2": {"giao_thong": 0.05, "cong_nghiep": 0.55, "cang": 0.25, "dan_dung": 0.05, "lien_vung": 0.10},
    "co": {"giao_thong": 0.55, "cong_nghiep": 0.10, "dot": 0.20, "dan_dung": 0.05, "lien_vung": 0.10},
}

# Danh mục biện pháp (mục 8). cost: chi phí GIẢ ĐỊNH theo đơn vị tương đối/năm - phải thay bằng khảo sát.
MEASURES = [
    {"id": "M1", "name": "Điều tiết luồng xe, vùng phát thải thấp nội đô", "sector": "giao_thong", "reduction": 0.15, "efficiency": 0.7, "cost": 6, "scope": "noi_do"},
    {"id": "M2", "name": "Kiểm định khí thải xe máy, ô tô", "sector": "giao_thong", "reduction": 0.10, "efficiency": 0.8, "cost": 3, "scope": "toan_tp"},
    {"id": "M3", "name": "Phát triển xe buýt/xe điện, giao thông công cộng", "sector": "giao_thong", "reduction": 0.12, "efficiency": 0.6, "cost": 9, "scope": "toan_tp"},
    {"id": "M4", "name": "Che chắn, rửa bánh xe, tưới ẩm công trường", "sector": "xay_dung", "reduction": 0.35, "efficiency": 0.7, "cost": 2, "scope": "toan_tp"},
    {"id": "M5", "name": "Vệ sinh, hút bụi đường phù hợp", "sector": "xay_dung", "reduction": 0.15, "efficiency": 0.7, "cost": 2, "scope": "noi_do"},
    {"id": "M6", "name": "CEMS, lọc bụi túi/ESP, khử SO2/NOx lò hơi", "sector": "cong_nghiep", "reduction": 0.30, "efficiency": 0.8, "cost": 8, "scope": "toan_tp"},
    {"id": "M7", "name": "Nhiên liệu ít lưu huỳnh, điện bờ tại cảng", "sector": "cang", "reduction": 0.40, "efficiency": 0.6, "cost": 7, "scope": "toan_tp"},
    {"id": "M8", "name": "Ngăn đốt lộ thiên, giám sát điểm cháy", "sector": "dot", "reduction": 0.40, "efficiency": 0.6, "cost": 2, "scope": "toan_tp"},
    {"id": "M9", "name": "Phối hợp liên tỉnh theo lưu vực khí", "sector": "lien_vung", "reduction": 0.10, "efficiency": 0.5, "cost": 4, "scope": "toan_tp"},
]
SCENARIOS = {
    "S0": {"name": "S0: Không can thiệp", "measures": []},
    "S1": {"name": "S1: Kiểm soát bụi công trường", "measures": ["M4", "M5"]},
    "S2": {"name": "S2: Giảm phát thải giao thông", "measures": ["M1", "M2", "M3"]},
    "S3": {"name": "S3: Công nghiệp + giao thông", "measures": ["M1", "M2", "M3", "M6"]},
}
ASSUMPTION_NOTE = ("Tỷ phần ngành, mức giảm và chi phí là GIẢ ĐỊNH THỬ NGHIỆM cho phần mềm, KHÔNG phải ước lượng đã "
                   "kiểm chứng tại TP.HCM. Muốn đánh giá kịch bản thật cần mô hình nhân quả/kiểm kê phát thải hoặc "
                   "mô hình khí quyển (WRF-Chem/CMAQ).")
INNER_TYPES = ("Phường",)


def catalog():
    return {"sectors": SECTORS, "shares": SECTOR_SHARES, "measures": MEASURES, "scenarios": SCENARIOS,
            "note": ASSUMPTION_NOTE, "o3_note": "O3 phi tuyến (hóa học NOx-VOC): không áp dụng giảm tuyến tính."}


def _measure_table(selected, overrides=None):
    by_id = {m["id"]: dict(m) for m in MEASURES}
    for o in overrides or []:
        if o.get("id") in by_id:
            by_id[o["id"]].update({k: v for k, v in o.items() if k in ("reduction", "efficiency", "cost", "scope")})
        elif o.get("id") and o.get("sector") in SECTORS:
            by_id[o["id"]] = {"name": o.get("name", o["id"]), "scope": "toan_tp", "efficiency": 1.0, "cost": 0, **o}
    return [by_id[i] for i in selected if i in by_id]


def reduction_factor(pollutant, measures, ward_types, shares=None):
    """Hệ số nhân [phường] = C_s / C_base cho tổ hợp biện pháp."""
    shares = shares or SECTOR_SHARES.get(pollutant)
    n = len(ward_types)
    if not shares:
        return np.ones(n)
    inner = np.isin(np.asarray(ward_types), INNER_TYPES)
    keep = np.ones((len(SECTORS), n))
    sec_idx = {k: i for i, k in enumerate(SECTORS)}
    for m in measures:
        cov = inner.astype(float) if m.get("scope") == "noi_do" else np.ones(n)
        i = sec_idx.get(m["sector"])
        if i is None:
            continue
        keep[i] *= 1.0 - float(m["reduction"]) * float(m.get("efficiency", 1.0)) * cov
    total = np.zeros(n)
    for k, sh in shares.items():
        total += sh * (1.0 - keep[sec_idx[k]])
    return 1.0 - total


def evaluate(base: np.ndarray, pop: np.ndarray, ward_types, pollutant: str, measure_ids, T: float = None,
             delta: float = 0.5, overrides=None, health: dict = None, economics: dict = None) -> dict:
    """base: [phường, giờ] nồng độ đường cơ sở; trả về chỉ tiêu hiệu quả của tổ hợp biện pháp."""
    ms = _measure_table(measure_ids, overrides)
    if pollutant == "o3":
        f = np.ones(base.shape[0])
    else:
        f = reduction_factor(pollutant, ms, ward_types)
    scen = base * f[:, None]
    mb = np.nanmean(base, axis=1)
    ms_ = np.nanmean(scen, axis=1)
    dC = mb - ms_
    w = pop / max(pop.sum(), 1)
    pwe_b, pwe_s = float(np.nansum(w * mb)), float(np.nansum(w * ms_))
    res = {"measures": [m["id"] for m in ms], "measure_names": [m["name"] for m in ms],
           "cost": float(sum(m.get("cost", 0) or 0 for m in ms)),
           "city_mean_base": round(float(np.nanmean(mb)), 2), "city_mean_scenario": round(float(np.nanmean(ms_)), 2),
           "pwe_base": round(pwe_b, 2), "pwe_scenario": round(pwe_s, 2), "delta_pwe": round(pwe_b - pwe_s, 3),
           "reduction_pct": round(100 * (pwe_b - pwe_s) / pwe_b, 2) if pwe_b > 0 else 0.0,
           "pop_benefit": int(pop[dC > delta].sum()), "delta_threshold": delta,
           "delta_by_ward": dC}
    if T is not None:
        eb = (base > T)
        es = (scen > T)
        res["threshold"] = T
        res["person_hours_exceed_base"] = int(np.nansum(pop[:, None] * eb))
        res["person_hours_avoided"] = int(np.nansum(pop[:, None] * (eb & ~es)))
        res["person_hours_avoided_pct"] = round(100 * res["person_hours_avoided"] / max(res["person_hours_exceed_base"], 1), 2)
    if pollutant == "pm2_5" and health:
        rr10 = health.get("rr_per10", C.HEALTH_RR_PM25_PER10["central"])
        beta = math.log(rr10) / 10.0
        paf = 1 - np.exp(-beta * np.clip(dC, 0, None))
        res["health"] = {"beta": round(beta, 5), "rr_per10": rr10, "source": C.HEALTH_RR_PM25_PER10["source"],
                         "risk_reduction_pct_pwe": round(100 * float(np.nansum(w * paf)), 3),
                         "applies_to": "Phơi nhiễm dài hạn (đường cơ sở nên là TB năm)."}
        y0 = health.get("baseline_mortality_per_1000")
        if y0:
            res["health"]["avoided_deaths_per_year"] = round(float(np.nansum(pop * (y0 / 1000.0) * paf)), 1)
            res["health"]["baseline_mortality_per_1000"] = y0
    if economics:
        res["economics"] = npv_bcr(economics.get("benefit_per_year", 0.0), res["cost"], economics.get("capex", 0.0),
                                   economics.get("years", 5), economics.get("rate", C.DISCOUNT_RATE))
    return res


def npv_bcr(benefit_per_year, cost_per_year, capex=0.0, years=5, rate=C.DISCOUNT_RATE):
    t = np.arange(1, int(years) + 1)
    disc = (1 + rate) ** t
    pv_b = float(np.sum(benefit_per_year / disc))
    pv_c = float(np.sum(cost_per_year / disc)) + capex
    return {"npv": round(pv_b - pv_c, 3), "bcr": round(pv_b / pv_c, 3) if pv_c > 0 else None, "pv_benefit": round(pv_b, 3),
            "pv_cost": round(pv_c, 3), "years": int(years), "rate": rate,
            "note": "Giá trị tiền phải công bố nguồn giá, năm gốc và khoảng bất định."}


def compare(base, pop, ward_types, pollutant, T=None, scenarios=None, **kw):
    scenarios = scenarios or SCENARIOS
    rows = []
    for sid, sc in scenarios.items():
        r = evaluate(base, pop, ward_types, pollutant, sc["measures"], T, **kw)
        r.pop("delta_by_ward", None)
        r.update({"id": sid, "name": sc["name"]})
        rows.append(r)
    # Kiểm tra không cộng giản đơn: tác động đồng thời của các biện pháp trong S2 so với tổng từng biện pháp riêng
    note = None
    s2 = scenarios.get("S2") or next((v for v in scenarios.values() if len(v["measures"]) > 1), None)
    if s2 and len(s2["measures"]) > 1:
        joint = evaluate(base, pop, ward_types, pollutant, s2["measures"], None, **kw)["delta_pwe"]
        single = sum(evaluate(base, pop, ward_types, pollutant, [m], None, **kw)["delta_pwe"] for m in s2["measures"])
        note = (f"{s2['name']}: ΔPWE khi áp dụng đồng thời = {joint} µg/m³, tổng ΔPWE từng biện pháp riêng lẻ = "
                f"{round(single, 3)} µg/m³ -> các biện pháp cùng ngành kết hợp theo tích, không cộng giản đơn. "
                "Tương tác hóa học - khí quyển giữa các ngành (thứ cấp, O3) chưa được mô hình hóa.")
    return {"pollutant": pollutant, "threshold": T, "scenarios": rows, "additivity_note": note, "note": ASSUMPTION_NOTE}


def optimize(base, pop, ward_types, pollutant, budget: float, equity_min_pct: float = 0.0, T=None,
             candidates=None, overrides=None, vulnerable_quantile: float = 0.75):
    """Duyệt mọi tổ hợp biện pháp (≤ 12) thỏa ngân sách và ràng buộc công bằng; trả về tối ưu + biên Pareto."""
    cands = candidates or [m["id"] for m in MEASURES]
    cands = cands[:12]
    mb = np.nanmean(base, axis=1)
    vul = mb >= np.nanquantile(mb, vulnerable_quantile)          # nhóm phường phơi nhiễm cao nhất
    rows = []
    for r in range(0, len(cands) + 1):
        for combo in itertools.combinations(cands, r):
            ms = _measure_table(combo, overrides)
            cost = float(sum(m.get("cost", 0) or 0 for m in ms))
            f = np.ones(len(mb)) if pollutant == "o3" else reduction_factor(pollutant, ms, ward_types)
            exp_s = float(np.nansum(pop * mb * f))
            red_v = float(100 * (1 - np.nansum(pop[vul] * mb[vul] * f[vul]) / max(np.nansum(pop[vul] * mb[vul]), 1e-9)))
            rows.append({"measures": list(combo), "cost": cost, "objective": exp_s, "vulnerable_reduction_pct": round(red_v, 2),
                         "pwe": round(exp_s / max(pop.sum(), 1), 3)})
    base_obj = float(np.nansum(pop * mb))
    for r in rows:
        r["reduction_pct"] = round(100 * (1 - r["objective"] / base_obj), 3) if base_obj > 0 else 0.0
    feas = [r for r in rows if r["cost"] <= budget + 1e-9 and r["vulnerable_reduction_pct"] >= equity_min_pct]
    best = min(feas, key=lambda r: (r["objective"], r["cost"])) if feas else None
    # biên Pareto: không tổ hợp nào rẻ hơn mà hiệu quả hơn
    srt = sorted(rows, key=lambda r: (r["cost"], r["objective"]))
    pareto, best_obj = [], np.inf
    for r in srt:
        if r["objective"] < best_obj - 1e-9:
            pareto.append(r)
            best_obj = r["objective"]
    for r in pareto + ([best] if best else []):
        r["measure_names"] = [m["name"] for m in _measure_table(r["measures"], overrides)]
    if T is not None and best:
        ev = evaluate(base, pop, ward_types, pollutant, best["measures"], T, overrides=overrides)
        best["person_hours_avoided"] = ev.get("person_hours_avoided")
    return {"pollutant": pollutant, "budget": budget, "equity_min_pct": equity_min_pct,
            "vulnerable_definition": f"phường có nồng độ TB ≥ phân vị {int(vulnerable_quantile * 100)}%",
            "n_combinations": len(rows), "n_feasible": len(feas), "best": best,
            "pareto": [{k: v for k, v in r.items() if k != "objective"} for r in pareto],
            "note": ASSUMPTION_NOTE}
