"""
TRUY VẾT NGUỒN THẢI THEO THANG BẰNG CHỨNG A-E

  A. Dấu hiệu   : tương quan đa chất, chu kỳ ngày (giờ cao điểm), ngày thường/cuối tuần, tỷ lệ PM2.5/PM10,
                  SO2/NO2, CO/NO2 -> NGHI NGỜ nhóm nguồn (giao thông / công nghiệp / đốt), không phải nhân quả.
  B. Gió-không gian: hoa gió ô nhiễm, CBPF theo hướng × tốc độ gió -> hướng/khu vực nguồn tiềm năng.
  C. Vận chuyển : quỹ đạo ngược ĐƠN GIẢN HÓA (động học 2D, gió 10 m đồng nhất 168 phường, bước 1 giờ)
                  -> vùng khí đoàn đi qua; KHÔNG thay thế HYSPLIT (không có gió các tầng, khuếch tán).
  D. Dấu vân tay: PMF  X_ij ≈ Σ_k G_ik F_kj + E_ij  (NMF có trọng số 1/σ²) - CHỈ chạy khi có dữ liệu
                  thành phần hóa học PM2.5 (OC/EC, ion, kim loại, levoglucosan); PM2.5 tổng + gió là chưa đủ.
  E. Vật lý     : WRF-Chem/CMAQ, source tagging/zero-out - ngoài phạm vi đồ án (cần kiểm kê phát thải).

Điểm nghi vấn của ứng viên nguồn s (KHÔNG phải phần trăm đóng góp, chỉ để ƯU TIÊN KIỂM TRA):
    Score_s = w1·wind_alignment + w2·distance_decay + w3·emission_activity + w4·chemical_marker + w5·trajectory_support
mỗi thành phần chuẩn hóa 0-1; độ nhạy trọng số đánh giá bằng lấy mẫu Dirichlet quanh w (độ ổn định thứ hạng).
Lưu ý: bộ dữ liệu đồng nhất bắt nguồn từ CAMS (dựa trên kiểm kê phát thải toàn cầu) hạ quy mô bằng vệ tinh,
nên dấu hiệu mức A-B phản ánh cả cấu trúc của kiểm kê phát thải; cần quan trắc độc lập để khẳng định.
"""
import numpy as np
import pandas as pd

from app.airdata import config as C
from app.airdata import windrose as WR

# Loại nguồn: mức hoạt động mặc định (0-1) và mức phù hợp loại nguồn - chất (thay cho marker hóa học khi
# CHƯA có số liệu phòng thí nghiệm; được ghi rõ là "proxy" trong kết quả)
SOURCE_TYPES = {
    "khu_cong_nghiep": {"label": "Khu/cụm công nghiệp", "activity": 0.9,
                        "aff": {"so2": 0.9, "no2": 0.7, "pm2_5": 0.7, "pm10": 0.6, "co": 0.6, "o3": 0.3}},
    "nha_may_dien": {"label": "Nhà máy điện", "activity": 1.0,
                     "aff": {"so2": 1.0, "no2": 0.9, "pm2_5": 0.6, "pm10": 0.4, "co": 0.5, "o3": 0.3}},
    "cang": {"label": "Cảng biển/logistics", "activity": 0.8,
             "aff": {"so2": 0.9, "no2": 0.8, "pm2_5": 0.6, "pm10": 0.5, "co": 0.5, "o3": 0.3}},
    "san_bay": {"label": "Sân bay", "activity": 0.6, "aff": {"no2": 0.8, "co": 0.6, "pm2_5": 0.4, "pm10": 0.3}},
    "bai_rac": {"label": "Bãi rác/xử lý chất thải", "activity": 0.6, "aff": {"pm2_5": 0.6, "pm10": 0.5, "co": 0.6}},
    "diem_chay": {"label": "Điểm cháy (FIRMS)", "activity": 0.8,
                  "aff": {"pm2_5": 1.0, "co": 0.9, "pm10": 0.7, "no2": 0.3, "o3": 0.3}},
    "cong_truong": {"label": "Công trường/mỏ/vật liệu", "activity": 0.5, "aff": {"pm10": 1.0, "pm2_5": 0.5}},
    "giao_thong": {"label": "Trục/nút giao thông lớn", "activity": 0.7,
                   "aff": {"no2": 1.0, "co": 0.9, "pm2_5": 0.7, "pm10": 0.6, "o3": 0.2}},
    "diem_nong_ve_tinh": {"label": "Điểm nóng theo vệ tinh (S5P/MAIAC)", "activity": 0.6,
                          "aff": {"no2": 0.8, "so2": 0.8, "pm2_5": 0.7, "pm10": 0.6, "co": 0.6}},
}
DEFAULT_WEIGHTS = {"wind_alignment": 0.30, "distance_decay": 0.20, "emission_activity": 0.20,
                   "chemical_marker": 0.10, "trajectory_support": 0.20}
DECAY_KM = 10.0


# ------------------------------------------------------------------------------
# MỨC A - DẤU HIỆU ĐA CHẤT
# ------------------------------------------------------------------------------
def signals(df: pd.DataFrame, pollutants=None) -> dict:
    """df: index thời gian (giờ), cột các chất. Trả về tương quan, chu kỳ ngày, tỷ lệ và nhận định mức A."""
    pollutants = [p for p in (pollutants or C.AQI_POLLUTANTS) if p in df.columns]
    d = df[pollutants].astype(float).dropna(how="all")
    out = {"level": "A", "n_hours": int(len(d)), "findings": []}
    if len(d) < 48:
        out["findings"].append({"signal": "Không đủ dữ liệu", "interpretation": "Cần ≥ 48 giờ.", "strength": 0})
        return out
    out["correlation"] = d.corr(method="spearman").round(3).to_dict()
    hod = d.groupby(d.index.hour).mean()
    out["diurnal"] = {p: (hod[p] / hod[p].mean()).round(3).tolist() for p in pollutants if hod[p].mean() > 0}
    rush = lambda s: s[[6, 7, 8, 9, 17, 18, 19, 20]].mean() / max(s[[0, 1, 2, 3, 4]].mean(), 1e-9)  # noqa: E731
    wk = d.index.dayofweek < 5
    ratios = {}
    if "pm2_5" in d and "pm10" in d:
        ratios["pm25_pm10"] = float((d["pm2_5"] / d["pm10"].replace(0, np.nan)).median())
    if "so2" in d and "no2" in d:
        ratios["so2_no2"] = float((d["so2"] / d["no2"].replace(0, np.nan)).median())
    if "co" in d and "no2" in d:
        ratios["co_no2"] = float((d["co"] / d["no2"].replace(0, np.nan)).median())
    out["ratios"] = {k: round(v, 3) for k, v in ratios.items() if np.isfinite(v)}
    f = out["findings"]
    for p in ("no2", "co"):
        if p in hod:
            ri = float(rush(hod[p]))
            wr = float(d.loc[wk, p].mean() / max(d.loc[~wk, p].mean(), 1e-9)) if (~wk).any() else np.nan
            out.setdefault("traffic_index", {})[p] = {"rush_over_night": round(ri, 3), "weekday_over_weekend": round(wr, 3)}
            if ri >= 1.2:
                f.append({"signal": f"{C.POLLUTANTS[p]['name']} tăng giờ cao điểm (×{ri:.2f} so với 0-4h)"
                                    + (f", ngày thường/cuối tuần ×{wr:.2f}" if np.isfinite(wr) else ""),
                          "interpretation": "Nghi ngờ đóng góp giao thông đường bộ.", "group": "giao_thong",
                          "strength": round(min(1.0, (ri - 1) / 1.0), 2)})
    r = out["ratios"]
    if "pm25_pm10" in r:
        if r["pm25_pm10"] >= 0.6:
            f.append({"signal": f"PM2.5/PM10 trung vị = {r['pm25_pm10']:.2f} (≥ 0,6)",
                      "interpretation": "Bụi mịn chiếm ưu thế: quá trình đốt (giao thông, công nghiệp, sinh khối) "
                                        "hoặc bụi thứ cấp.", "group": "dot_nhien_lieu", "strength": round(min(1, (r["pm25_pm10"] - 0.5) * 3), 2)})
        elif r["pm25_pm10"] <= 0.5:
            f.append({"signal": f"PM2.5/PM10 trung vị = {r['pm25_pm10']:.2f} (≤ 0,5)",
                      "interpretation": "Bụi thô đáng kể: xây dựng, bụi đường, vật liệu rời.", "group": "cong_truong",
                      "strength": round(min(1, (0.6 - r["pm25_pm10"]) * 3), 2)})
    if r.get("so2_no2", 0) >= 0.5:
        f.append({"signal": f"SO2/NO2 trung vị = {r['so2_no2']:.2f} (≥ 0,5)",
                  "interpretation": "Dấu hiệu đốt nhiên liệu chứa lưu huỳnh: công nghiệp, nhiệt điện, tàu biển.",
                  "group": "cong_nghiep_cang", "strength": round(min(1, r["so2_no2"]), 2)})
    if "pm2_5" in d and "co" in d:
        rho = float(d[["pm2_5", "co"]].corr(method="spearman").iloc[0, 1])
        if rho >= 0.7:
            f.append({"signal": f"PM2.5 tương quan chặt với CO (ρ = {rho:.2f})",
                      "interpretation": "Cùng nguồn đốt cháy không hoàn toàn (giao thông, đốt sinh khối/rác) hoặc "
                                        "cùng chịu điều kiện pha loãng kém.", "group": "dot_nhien_lieu",
                      "strength": round(rho, 2)})
    out["caveat"] = ("Dấu hiệu mức A chỉ để nêu giả thuyết, không chứng minh nhân quả; tương quan đa chất cũng "
                     "có thể do cùng điều kiện khí tượng (lặng gió, nghịch nhiệt).")
    return out


# ------------------------------------------------------------------------------
# MỨC B - GIÓ VÀ KHÔNG GIAN
# ------------------------------------------------------------------------------
def wind_alignment(rose_res: dict, receptor, src_lat, src_lon) -> np.ndarray:
    """Gió thổi TỪ nguồn TỚI điểm tiếp nhận khi WD ≈ phương vị (điểm tiếp nhận -> nguồn).
    Điểm = P_k của hướng chứa phương vị đó / max P_k (hướng ít mẫu bị giảm một nửa)."""
    sectors = rose_res.get("sectors") or []
    if not sectors or "p_exceed" not in sectors[0]:
        return np.zeros(len(np.atleast_1d(src_lat)))
    n = rose_res["n_sectors"]
    pk = np.array([(s.get("p_exceed") or 0.0) * (0.5 if s.get("low_count") else 1.0) for s in sectors])
    mx = pk.max() if pk.max() > 0 else 1.0
    b = WR.bearing_deg(receptor[0], receptor[1], np.atleast_1d(src_lat), np.atleast_1d(src_lon))
    k = WR.sector_index(b, n)
    return pk[k] / mx


def distance_decay(d_km, L=DECAY_KM):
    return np.exp(-np.asarray(d_km, float) / L)


# ------------------------------------------------------------------------------
# MỨC C - QUỸ ĐẠO NGƯỢC ĐƠN GIẢN HÓA
# ------------------------------------------------------------------------------
class WindField:
    """Trường gió giờ từ bộ dữ liệu đồng nhất (ws, wd tại điểm đại diện phường)."""

    def __init__(self, ward_hourly: pd.DataFrame, wards: pd.DataFrame):
        w = ward_hourly.dropna(subset=["wind_speed", "wind_dir"]).copy()
        w["ma_phuong_xa"] = w["ma_phuong_xa"].astype(str)
        u, v = WR.wswd_to_uv(w["wind_speed"].to_numpy(), w["wind_dir"].to_numpy())
        w["u"], w["v"] = u, v
        self.u = w.pivot_table(index="thoi_gian", columns="ma_phuong_xa", values="u")
        self.v = w.pivot_table(index="thoi_gian", columns="ma_phuong_xa", values="v")
        meta = wards.set_index(wards["code"].astype(str))
        cols = [c for c in self.u.columns if c in meta.index]
        self.u, self.v = self.u[cols], self.v[cols]
        self.lat = meta.loc[cols, "lat"].to_numpy(float)
        self.lon = meta.loc[cols, "lng"].to_numpy(float)
        self.mean_u = self.u.mean(axis=1)
        self.mean_v = self.v.mean(axis=1)

    def at(self, t, lat, lon, max_km=15.0):
        t = pd.Timestamp(t).floor("h")
        if t not in self.u.index:
            return np.nan, np.nan, False
        d = np.hypot((self.lat - lat) * 111.32, (self.lon - lon) * 111.32 * np.cos(np.radians(lat)))
        j = int(np.argmin(d))
        if d[j] <= max_km and np.isfinite(self.u.iloc[self.u.index.get_loc(t), j]):
            return float(self.u.loc[t].iloc[j]), float(self.v.loc[t].iloc[j]), True
        return float(self.mean_u.loc[t]), float(self.mean_v.loc[t]), False


def back_trajectory(field: WindField, lat, lon, end_time, hours=48):
    """Lùi theo thời gian: vị trí(t−1) = vị trí(t) − vận tốc(t)·Δt (Δt = 1 giờ)."""
    pts = [{"t": str(pd.Timestamp(end_time)), "lat": round(lat, 5), "lon": round(lon, 5), "in_domain": True}]
    t = pd.Timestamp(end_time).floor("h")
    for _ in range(hours):
        u, v, inside = field.at(t, lat, lon)
        if not np.isfinite(u):
            break
        lat -= v * 3600.0 / 111320.0
        lon -= u * 3600.0 / (111320.0 * np.cos(np.radians(lat)))
        t -= pd.Timedelta(hours=1)
        pts.append({"t": str(t), "lat": round(lat, 5), "lon": round(lon, 5), "in_domain": inside})
    return pts


def trajectory_support(trajs: list, src_lat, src_lon, radius_km=5.0) -> np.ndarray:
    src_lat, src_lon = np.atleast_1d(src_lat).astype(float), np.atleast_1d(src_lon).astype(float)
    if not trajs:
        return np.zeros(len(src_lat))
    hits = np.zeros(len(src_lat))
    for tr in trajs:
        la = np.array([p["lat"] for p in tr])
        lo = np.array([p["lon"] for p in tr])
        d = np.hypot((la[None, :] - src_lat[:, None]) * 111.32,
                     (lo[None, :] - src_lon[:, None]) * 111.32 * np.cos(np.radians(src_lat[:, None])))
        hits += (d.min(axis=1) <= radius_km)
    return hits / len(trajs)


def regional_background(ward_values: pd.Series) -> dict:
    """Tách sơ bộ nền liên vùng và phần tăng đô thị tại một thời điểm/ngày:
    nền ≈ phân vị 10% của 168 phường; phần tăng = giá trị phường − nền (chỉ định hướng)."""
    v = ward_values.astype(float).dropna()
    if v.empty:
        return {}
    bg = float(v.quantile(0.10))
    return {"background_p10": round(bg, 2), "city_mean": round(float(v.mean()), 2),
            "urban_increment_share": round(float(max(v.mean() - bg, 0) / max(v.mean(), 1e-9)), 3)}


# ------------------------------------------------------------------------------
# ĐIỂM NGHI VẤN + ĐỘ NHẠY TRỌNG SỐ
# ------------------------------------------------------------------------------
def suspicion_scores(cands: pd.DataFrame, receptor, pollutant: str, rose_res: dict = None, trajs: list = None,
                     weights: dict = None, n_draws: int = 500, top_n: int = 5, seed: int = 7) -> dict:
    """cands: source_id, ten, loai, lat, lon, [hoat_dong 0-1], [chemical_marker 0-1]."""
    w = dict(DEFAULT_WEIGHTS)
    w.update(weights or {})
    if cands is None or cands.empty:
        return {"sources": [], "weights": w}
    c = cands.copy().reset_index(drop=True)
    lat, lon = c["lat"].to_numpy(float), c["lon"].to_numpy(float)
    d = WR.distance_km(receptor[0], receptor[1], lat, lon)
    types = c["loai"].map(lambda t: SOURCE_TYPES.get(t, {}))
    comp = pd.DataFrame({
        "wind_alignment": wind_alignment(rose_res or {}, receptor, lat, lon),
        "distance_decay": distance_decay(d),
        "emission_activity": c["hoat_dong"].astype(float).fillna(types.map(lambda t: t.get("activity", 0.5)))
        if "hoat_dong" in c else types.map(lambda t: t.get("activity", 0.5)).astype(float),
        "chemical_marker": c["chemical_marker"].astype(float) if "chemical_marker" in c and c["chemical_marker"].notna().any()
        else types.map(lambda t: t.get("aff", {}).get(pollutant, 0.3)).astype(float),
        "trajectory_support": trajectory_support(trajs or [], lat, lon),
    }).clip(0, 1).fillna(0)
    keys = list(DEFAULT_WEIGHTS)
    wv = np.array([w[k] for k in keys], float)
    wv = wv / wv.sum()
    X = comp[keys].to_numpy()
    score = X @ wv
    # độ nhạy: lấy mẫu trọng số Dirichlet(α = 20·w)
    rng = np.random.default_rng(seed)
    draws = rng.dirichlet(20 * wv, size=n_draws)
    S = X @ draws.T                                                   # [nguồn, lần lấy mẫu]
    ranks = (-S).argsort(axis=0).argsort(axis=0)
    in_top = (ranks < top_n).mean(axis=1)
    base_rank = (-score).argsort().argsort()
    from scipy.stats import spearmanr
    rho = [spearmanr(score, S[:, i])[0] for i in range(min(n_draws, 200))] if len(score) > 2 else [1.0]
    out = []
    for i in np.argsort(-score):
        out.append({"source_id": str(c.loc[i, "source_id"]), "ten": c.loc[i, "ten"], "loai": c.loc[i, "loai"],
                    "loai_label": SOURCE_TYPES.get(c.loc[i, "loai"], {}).get("label", c.loc[i, "loai"]),
                    "lat": float(lat[i]), "lon": float(lon[i]), "distance_km": round(float(d[i]), 2),
                    "score": round(float(score[i]), 3), "rank": int(base_rank[i]) + 1,
                    "p_in_top": round(float(in_top[i]), 3),
                    "components": {k: round(float(comp.loc[i, k]), 3) for k in keys}})
    return {"sources": out, "weights": dict(zip(keys, wv.round(3).tolist())),
            "sensitivity": {"method": f"Dirichlet(20·w), {n_draws} lần", "rank_spearman_mean": round(float(np.nanmean(rho)), 3),
                            "top_n": top_n},
            "chemical_marker_is_proxy": not ("chemical_marker" in c and c["chemical_marker"].notna().any()),
            "caveat": "Điểm nghi vấn chỉ để ƯU TIÊN KIỂM TRA thực địa, không phải phần trăm đóng góp."}


def satellite_hotspots(sat: pd.DataFrame, wards: pd.DataFrame, top: int = 8) -> pd.DataFrame:
    """Ứng viên từ dữ liệu vệ tinh đã có trong CSDL: phường có tỷ số cột NO2/SO2/AOD so với vùng lân cận
    cao nhất (trung bình các ngày gần nhất) -> điểm nóng phát thải tiềm năng (không gian 1 km)."""
    if sat is None or sat.empty:
        return pd.DataFrame()
    s = sat.copy()
    s["ma_phuong_xa"] = s["ma_phuong_xa"].astype(str)
    g = s.groupby("ma_phuong_xa")[[c for c in ("r_no2", "r_so2", "r_aod", "r_co") if c in s.columns]].mean()
    meta = wards.set_index(wards["code"].astype(str))
    rows = []
    for col, pol in (("r_no2", "no2"), ("r_so2", "so2"), ("r_aod", "pm2_5")):
        if col not in g:
            continue
        for code, val in g[col].dropna().sort_values(ascending=False).head(top).items():
            if code not in meta.index or val <= 1.05:
                continue
            rows.append({"source_id": f"VT-{pol}-{code}", "ten": f"Điểm nóng {C.POLLUTANTS[pol]['name']} vệ tinh - "
                                                                  f"{meta.loc[code, 'name']}",
                         "loai": "diem_nong_ve_tinh", "lat": float(meta.loc[code, "lat"]),
                         "lon": float(meta.loc[code, "lng"]), "hoat_dong": float(min(1.0, (val - 1) / 0.5)),
                         "chat_lien_quan": pol, "nguon_du_lieu": "Sentinel-5P/MAIAC (GEE)", "da_xac_minh": False})
    return pd.DataFrame(rows).drop_duplicates("source_id") if rows else pd.DataFrame()


def find_events(city: pd.DataFrame, pollutant: str = "pm2_5", T: float = None, top: int = 10) -> list:
    """Sự kiện = ngày có TB 24 giờ cấp TP vượt T (mặc định WHO 24h), xếp theo mức độ."""
    from app.airdata import standards as S
    T = T or C.WHO_AQG_2021.get(pollutant, {}).get("24h") or C.ROSE_DEFAULT_T.get(pollutant)
    s = city.set_index(pd.to_datetime(city["thoi_gian"]))[pollutant] if "thoi_gian" in city.columns else city[pollutant]
    st = S.daily_stats(s)
    ev = st[st["mean24"] > T].sort_values("mean24", ascending=False).head(top)
    return [{"date": d.strftime("%Y-%m-%d"), "mean24": round(float(r["mean24"]), 1), "threshold": T,
             "max1": round(float(r["max1"]), 1)} for d, r in ev.iterrows()]


# ------------------------------------------------------------------------------
# MỨC D - PMF (NMF CÓ TRỌNG SỐ) - sẵn sàng khi có dữ liệu thành phần hóa học
# ------------------------------------------------------------------------------
def pmf(X, U=None, k=4, n_starts=8, iters=1500, seed=0, n_boot=50):
    """X[i, j] ≥ 0: nồng độ thành phần j ở mẫu i; U: độ bất định (σ). Trả về hồ sơ F, đóng góp G,
    tỷ lệ đóng góp khối lượng từng yếu tố + KTC bootstrap, Q và Q/Q_kỳ vọng."""
    X = np.clip(np.asarray(X, float), 1e-9, None)
    n, m = X.shape
    U = np.asarray(U, float) if U is not None else 0.1 * X + 0.05 * np.median(X, axis=0)
    Wt = 1.0 / np.clip(U, 1e-9, None) ** 2
    rng = np.random.default_rng(seed)

    def _fit(Xs, Ws, rs):
        best = None
        for _ in range(n_starts):
            G = rs.random((Xs.shape[0], k)) + 0.1
            F = rs.random((k, m)) + 0.1
            for _ in range(iters):
                GF = G @ F
                G *= ((Ws * Xs) @ F.T) / np.clip((Ws * GF) @ F.T, 1e-12, None)
                GF = G @ F
                F *= (G.T @ (Ws * Xs)) / np.clip(G.T @ (Ws * GF), 1e-12, None)
            Q = float(np.sum(Ws * (Xs - G @ F) ** 2))
            if best is None or Q < best[0]:
                best = (Q, G.copy(), F.copy())
        return best

    Q, G, F = _fit(X, Wt, rng)
    scale = F.sum(axis=1, keepdims=True)
    F_n = F / scale
    G_n = G * scale.T
    mass = G_n.sum(axis=0)
    share = mass / mass.sum()
    boots = []
    for b in range(n_boot):
        idx = rng.integers(0, n, n)
        _, Gb, Fb = _fit(X[idx], Wt[idx], np.random.default_rng(seed + b + 1))
        sb = Fb.sum(axis=1, keepdims=True)
        Fb_n = Fb / sb
        # ghép yếu tố bootstrap với yếu tố gốc theo tương quan hồ sơ
        corr = np.corrcoef(np.vstack([F_n, Fb_n]))[:k, k:]
        order = np.argmax(corr, axis=1)
        mb = (Gb * sb.T).sum(axis=0)[order]
        boots.append(mb / mb.sum())
    boots = np.array(boots) if boots else None
    q_exp = n * m - k * (n + m)
    return {"k": k, "Q": round(Q, 2), "Q_expected": q_exp, "Q_ratio": round(Q / max(q_exp, 1), 3),
            "profiles": F_n.round(4).tolist(), "contributions": G_n.round(4).tolist(),
            "share": share.round(4).tolist(),
            "share_ci": (np.percentile(boots, [2.5, 97.5], axis=0).T.round(4).tolist() if boots is not None else None),
            "note": "Nhãn yếu tố (giao thông, đốt sinh khối, bụi đất, thứ cấp...) phải do người phân tích gán theo "
                    "thành phần đánh dấu (EC, K+/levoglucosan, Al/Si, SO4²⁻/NH4⁺...) và báo cáo kèm KTC."}


# ------------------------------------------------------------------------------
# THANG BẰNG CHỨNG
# ------------------------------------------------------------------------------
def evidence_ladder(has_signals: bool, has_rose: bool, has_traj: bool, has_chem: bool = False, has_ctm: bool = False):
    lv = [
        ("A", "Dấu hiệu", "Tương quan đa chất, chu kỳ cao điểm, tỷ lệ chất",
         "Nghi ngờ nhóm nguồn (giao thông/công nghiệp/đốt); không phải nhân quả.", has_signals, "Dữ liệu đồng nhất 168 phường × giờ"),
        ("B", "Gió và không gian", "Hoa gió ô nhiễm, CBPF hướng × tốc độ",
         "Hướng/khu vực nguồn tiềm năng; phụ thuộc chất lượng gió và thời điểm.", has_rose, "Gió ERA5-Land/Open-Meteo + nồng độ phường"),
        ("C", "Vận chuyển", "Quỹ đạo ngược đơn giản hóa (gió 10 m, 2D); chuẩn: HYSPLIT",
         "Vùng khí đoàn đi qua; không chứng minh nồng độ xuất phát tại đó.", has_traj, "Trường gió giờ 168 phường"),
        ("D", "Dấu vân tay hóa học", "PMF/CMB với ion, kim loại, OC/EC, marker",
         "Nhóm nguồn và tỷ lệ đóng góp kèm sai số.", has_chem, "CẦN số liệu phòng thí nghiệm PM2.5 (chưa có)"),
        ("E", "Vật lý - can thiệp", "WRF-Chem/CMAQ, source tagging/zero-out",
         "Tác động kịch bản nguồn khi có kiểm kê phát thải và hiệu chuẩn.", has_ctm, "Ngoài phạm vi đồ án"),
    ]
    return [{"level": a, "name": b, "method": c, "can_conclude": d, "done": bool(e), "data": f} for a, b, c, d, e, f in lv]
