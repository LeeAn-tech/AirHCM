"""
ĐỘNG CƠ DỰ BÁO THỜI GIAN THỰC ĐA CHẤT (REALTIME FORECAST ENGINE)

Mỗi lần ứng dụng mở (hoặc mỗi giờ theo lịch), động cơ:
  1. Lấy trạng thái mới nhất của bộ dữ liệu đồng nhất (giờ gần nhất đã có số liệu = t0).
  2. Dự báo trực tiếp nồng độ cấp TP cho từng giờ T ∈ (t0, cuối ngày thứ 7 kể từ hôm nay] bằng mô hình ML
     của từng chất, với khí tượng tại T lấy từ dự báo thời tiết đã đồng nhất.
  3. Kết hợp với dự báo vật lý CAMS (đã đồng nhất về phường) theo trọng số nghịch đảo sai số bình phương
     học từ nhật ký đối chiếu trực tuyến; khi chưa đủ 14 ngày đối chiếu -> dùng ML, CAMS làm tham chiếu.
     Thiếu mô hình ML -> dùng CAMS; ngoài tầm CAMS -> bền vững tắt dần về khí hậu.
  4. Phân rã cấp TP -> 168 phường bằng hệ số không gian S(phường, giờ trong ngày) = trung vị tỷ số
     phường/TP của 14 ngày gần nhất (giữ cấu trúc không gian của dữ liệu đã hạ quy mô).
  5. Tính VN_AQI / US AQI theo giờ và theo ngày, xu hướng các tháng tới.
"""
import glob
import os
import threading
import time
from datetime import timedelta

import joblib
import numpy as np
import pandas as pd

from app.airdata import aqi as AQ
from app.airdata import config as C
from app.airdata import features as F
from app.airdata import seasonal

WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]
BINS = [(1, 24, "1-24h"), (25, 72, "25-72h"), (73, 10 ** 6, "73-192h")]


def day_label(d, today):
    delta = (pd.Timestamp(d).normalize() - pd.Timestamp(today).normalize()).days
    if delta == 0:
        return "Hôm nay"
    if delta == 1:
        return "Ngày mai"
    return WEEKDAYS[pd.Timestamp(d).dayofweek]


def _bin_of(h):
    for lo, hi, name in BINS:
        if lo <= h <= hi:
            return name
    return BINS[-1][2]


class DBLoader:
    """Đọc/ghi PostgreSQL (các bảng kk_*)."""

    def city(self, start=None, end=None):
        from app.airdata import store
        return store.city_hourly(start, end)

    def ward(self, start, end, code=None):
        from app.airdata import store
        return store.ward_hourly(start, end, code)

    def save_issued(self, df):
        from app.airdata import store
        store.upsert("kk_du_bao_phat_hanh", df)

    def issued(self, start, end):
        from app.airdata import store
        return store.read_sql("SELECT * FROM kk_du_bao_phat_hanh WHERE thoi_gian_dich BETWEEN :a AND :b",
                              {"a": start, "b": end})

    def extra(self, start, end):
        """Khí tượng bổ sung cấp TP (bức xạ, mây, lớp biên, gió 100 m) - rỗng nếu chưa nạp."""
        from app.airdata import store
        return store.extra_weather(start, end)


class AirForecastEngine:
    def __init__(self, loader=None, model_dir=None, ttl_seconds=1800):
        self.loader = loader or DBLoader()
        self.model_dir = model_dir or C.MODEL_DIR
        self.ttl = ttl_seconds
        self._bundles = None
        self._state = None
        self._monthly = {"time": 0.0, "data": None, "now": None}
        self._lock = threading.Lock()
        self._memo = {}

    def _cached(self, key, ttl, fn):
        """Bộ nhớ đệm ngắn hạn cho các API gọi dày (bản đồ, số liệu hiện tại)."""
        hit = self._memo.get(key)
        built = self._state["built"] if self._state else None
        if hit and time.time() - hit[0] < ttl and hit[2] == built:
            return hit[1]
        val = fn()
        # Không ghi nhớ kết quả rỗng (trạng thái đang dựng / chưa có dữ liệu) -> lần gọi sau thử lại ngay
        if val is not None:
            self._memo[key] = (time.time(), val, self._state["built"] if self._state else None)
        return val

    # ------------------------------------------------------------------ mô hình
    def bundles(self):
        if self._bundles is None:
            self._bundles = {}
            for path in glob.glob(os.path.join(self.model_dir, "*.joblib")):
                p = os.path.splitext(os.path.basename(path))[0]
                if p in C.POLLUTANTS:
                    try:
                        self._bundles[p] = joblib.load(path)
                    except Exception as e:
                        print(f"-> [AirData] Không nạp được mô hình {path}: {e}")
        return self._bundles

    def reload_models(self):
        """Nạp lại mô hình + xóa bộ đệm (sau khi huấn luyện / nạp thêm lịch sử) để API trả kết quả mới ngay"""
        self._bundles = None
        self._state = None
        self._monthly = {"time": 0.0, "data": None, "now": None}
        self._memo = {}

    # ------------------------------------------------------------------ làm mới
    def state(self, now=None, force=False):
        with self._lock:
            # Dự báo realtime: sang giờ mới theo đồng hồ hệ thống thì tính lại ngay (không chờ hết bộ đệm 30 phút)
            same_hour = self._state is not None and self._state.get("now") == pd.Timestamp.now().floor("h")
            if (not force and self._state is not None and time.time() - self._state["built"] < self.ttl
                    and now is None and same_hour):
                return self._state
            self._state = self._build(now)
            return self._state

    def _blend_weights(self, now):
        """Trọng số ML so với CAMS theo nhóm hạn từ nhật ký đối chiếu (≥ VERIFY_MIN_PAIRS cặp)."""
        try:
            v = self.verification(now)
        except Exception:
            return {}
        w = {}
        for p, bins in v.get("by_pollutant", {}).items():
            for name, m in bins.items():
                if m.get("n", 0) < C.VERIFY_MIN_PAIRS or not m.get("rmse_ml") or not m.get("rmse_cams"):
                    continue
                a, b = 1 / m["rmse_ml"] ** 2, 1 / m["rmse_cams"] ** 2
                w.setdefault(p, {})[name] = round(a / (a + b), 3)
        return w

    def _build(self, now=None):
        now_h = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
        today = now_h.normalize()
        end = today + pd.Timedelta(days=8) - pd.Timedelta(hours=1)  # hết ngày thứ 7 kể từ hôm nay
        hist_start = now_h - pd.Timedelta(days=21)
        city = self.loader.city(hist_start, end)
        if city is None or city.empty:
            return {"built": time.time(), "ok": False, "reason": "Chưa có dữ liệu đồng nhất trong CSDL.",
                    "now": now_h}
        df = F.complete_hourly(city)
        df = df.reindex(pd.date_range(min(df.index.min(), hist_start), end, freq="h"))
        bundles = self.bundles()
        if any(b.get("extra_wx") for b in bundles.values()) and callable(getattr(self.loader, "extra", None)):
            try:
                ex = self.loader.extra(df.index.min(), end)
                if ex is not None and not ex.empty:
                    ex = ex.drop_duplicates("thoi_gian").set_index(pd.to_datetime(ex["thoi_gian"]))
                    for col in F.EXTRA_WX:
                        if col in ex.columns:
                            df[col] = ex[col].astype(float).reindex(df.index)
            except Exception as e:
                print(f"-> [AirData] Không đọc được khí tượng bổ sung: {e}")
        weights = self._blend_weights(now_h)
        fc, sources, issued_rows, info = {}, {}, [], {}
        for p in C.POLLUTANTS:
            if p not in df.columns:
                continue
            obs = df[p][df.index <= now_h].dropna()
            if obs.empty:
                continue
            t0 = obs.index.max()
            horizon_idx = df.index[df.index > t0]
            cams = df.loc[horizon_idx, p].astype(float)
            b = bundles.get(p)
            ml = pd.Series(np.nan, index=horizon_idx)
            if b is not None and len(horizon_idx):
                frame = df.copy()
                pcols = [c for c in C.POLLUTANTS if c in frame.columns]
                frame.loc[frame.index > t0, pcols] = np.nan  # tương lai: chỉ còn khí tượng
                state = F.state_features(frame, p, b["clim"])
                target = F.target_features(frame, p, b["clim"], b.get("wx_clim"), extra=b.get("extra_wx"))
                pos0 = frame.index.get_loc(t0)
                hs = np.arange(1, len(horizon_idx) + 1)
                X, cols = F.assemble(state, target, np.full(len(hs), pos0), hs)
                if cols == b["features"]:
                    X[:, -1] = np.minimum(X[:, -1], max(b.get("horizons", [192])))
                    ml = pd.Series(F.inverse(b["model"].predict(X), np.full(len(hs), obs.iloc[-1])),
                                   index=horizon_idx)
            # khí hậu dự phòng (tháng × giờ)
            clim_tab = b["clim"] if b is not None else F.climatology(df[p].dropna())
            clim = pd.Series(F.clim_lookup(clim_tab, horizon_idx), index=horizon_idx)
            hours_ahead = ((horizon_idx - t0) / pd.Timedelta(hours=1)).astype(int)
            damped = clim + (obs.iloc[-1] - F.clim_lookup(clim_tab, pd.DatetimeIndex([t0]))[0]) * np.exp(-hours_ahead / 48.0)
            if ml.notna().any():
                wp = weights.get(p, {})
                w = np.array([wp.get(_bin_of(h), 1.0) for h in hours_ahead])
                blended = np.where(cams.notna(), w * ml + (1 - w) * cams, ml)
                final = pd.Series(blended, index=horizon_idx)
                src = "ml+cams" if wp else "ml"
            else:
                final = cams.where(cams.notna(), damped)
                src = "cams" if cams.notna().any() else "climatology"
            final = final.clip(lower=0)
            fc[p] = final
            sources[p] = src
            info[p] = {"t0": str(t0), "source": src, "model": b["model_name"] if b else None,
                       "stale_hours": int((now_h - t0) / pd.Timedelta(hours=1)), "weights": weights.get(p, {})}
            if p in C.FORECAST_POLLUTANTS:
                issued_rows.append(pd.DataFrame({
                    "phat_hanh_luc": now_h, "thoi_gian_dich": horizon_idx, "chat": p,
                    "gia_tri_ml": ml.to_numpy(dtype=float), "gia_tri_cams": cams.to_numpy(dtype=float),
                    "gia_tri_ket_hop": final.to_numpy(dtype=float)}))
        if issued_rows:
            try:
                self.loader.save_issued(pd.concat(issued_rows, ignore_index=True))
            except Exception as e:
                print(f"-> [AirData] Không ghi được nhật ký dự báo: {e}")
        factors = self._ward_factors(now_h, df)
        return {"built": time.time(), "ok": True, "now": now_h, "today": today, "end": end, "city": df,
                "forecast": fc, "sources": sources, "info": info, "factors": factors}

    def _ward_factors(self, now_h, city_df):
        """S[p] : DataFrame (ma_phuong_xa × giờ trong ngày) = trung vị tỷ số phường/TP 14 ngày gần nhất."""
        start = now_h - pd.Timedelta(days=C.SPATIAL_FACTOR_DAYS)
        try:
            ward = self.loader.ward(start, now_h)
        except Exception as e:
            print(f"-> [AirData] Không đọc được dữ liệu phường: {e}")
            return {}
        if ward is None or ward.empty:
            return {}
        ward = ward.assign(ma_phuong_xa=ward["ma_phuong_xa"].astype(str))
        out = {}
        for p in C.POLLUTANTS:
            if p not in ward.columns or p not in city_df.columns:
                continue
            cityv = city_df[p].reindex(pd.DatetimeIndex(ward["thoi_gian"])).to_numpy(dtype=float)
            with np.errstate(divide="ignore", invalid="ignore"):
                r = ward[p].to_numpy(dtype=float) / cityv
            tmp = pd.DataFrame({"ma_phuong_xa": ward["ma_phuong_xa"], "hod": ward["thoi_gian"].dt.hour, "r": r})
            tmp = tmp[np.isfinite(tmp["r"])]
            if tmp.empty:
                continue
            out[p] = tmp.groupby(["ma_phuong_xa", "hod"])["r"].median().unstack().reindex(columns=range(24))
        return out

    # ------------------------------------------------------------------ xu hướng tháng
    def monthly(self, now=None, force=False):
        now = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
        fresh = self._monthly.get("now") is not None and self._monthly["now"].normalize() == now.normalize()
        if not force and fresh and self._monthly["data"] is not None and time.time() - self._monthly["time"] < 6 * 3600:
            return self._monthly["data"]
        city = self.loader.city(None, now)
        out = {}
        if city is not None and not city.empty:
            df = F.complete_hourly(city)
            df = df[df.index <= now]
            for p in C.POLLUTANTS:
                if p in df.columns:
                    out[p] = seasonal.outlook(df[p], C.MONTHLY_OUTLOOK_MONTHS, now)
        self._monthly = {"time": time.time(), "data": out, "now": now}
        return out

    # ------------------------------------------------------------------ chuỗi cho một phạm vi
    def _series(self, st, ward_code=None):
        """Chuỗi giờ (quan trắc + dự báo) từ 24h trước 00:00 hôm nay đến hết ngày thứ 7."""
        today, end, now_h = st["today"], st["end"], st["now"]
        idx = pd.date_range(today - pd.Timedelta(hours=24), end, freq="h")
        out = pd.DataFrame(index=idx)
        ward_df = None
        if ward_code:
            try:
                ward_df = self.loader.ward(idx[0], end, ward_code)
            except Exception:
                ward_df = None
            if ward_df is not None and not ward_df.empty:
                ward_df = ward_df.drop_duplicates("thoi_gian").set_index("thoi_gian").reindex(idx)
        for p in C.POLLUTANTS:
            if p not in st["city"].columns:
                continue
            base = st["city"][p].reindex(idx)
            if ward_df is not None and p in ward_df.columns:
                base = ward_df[p].astype(float)
            fc = st["forecast"].get(p)
            series = base.copy()
            if fc is not None:
                fcv = fc.reindex(idx)
                if ward_code:
                    S = st["factors"].get(p)
                    if S is not None and str(ward_code) in S.index:
                        prof = S.loc[str(ward_code)].reindex(range(24)).fillna(S.loc[str(ward_code)].mean())
                        fcv = fcv * prof.reindex(idx.hour).fillna(1.0).to_numpy()
                t0 = pd.Timestamp(st["info"][p]["t0"])
                future = idx > t0
                series[future] = fcv[future]
            out[p] = series.astype(float)
        t0_pm = pd.Timestamp(st["info"].get("pm2_5", {}).get("t0", st["now"]))
        out["observed"] = (out.index <= t0_pm) & out.get("pm2_5", pd.Series(np.nan, index=idx)).notna()
        wx_src = ward_df if ward_df is not None else st["city"].reindex(idx)
        for k in ("temperature_2m", "relative_humidity", "wind_speed", "wind_dir", "precipitation"):
            if k in wx_src.columns:
                out[k] = wx_src[k].astype(float).to_numpy()
        return out

    def payload(self, ward_code=None, lat=None, lng=None, now=None):
        if now is not None:
            return self._payload(ward_code, lat, lng, now)
        key = ("payload", ward_code, None if lat is None else round(lat, 3), None if lng is None else round(lng, 3))
        return self._cached(key, 120, lambda: self._payload(ward_code, lat, lng, None))

    def _payload(self, ward_code=None, lat=None, lng=None, now=None):
        st = self.state(now)
        if not st.get("ok"):
            return {"ok": False, "reason": st.get("reason")}
        location = {"scope": "city", "ma_phuong_xa": None, "ten_phuong_xa": "TP. Hồ Chí Minh"}
        try:
            from app.services import ward_index
            w = ward_index.by_code(ward_code) if ward_code else (
                ward_index.locate(lat, lng) if lat is not None and lng is not None else None)
            if w:
                location = {"scope": "ward", "ma_phuong_xa": w["ma_phuong_xa"], "ten_phuong_xa": w["ten_phuong_xa"]}
        except Exception:
            pass
        code = location["ma_phuong_xa"]
        s = self._series(st, code)
        today, now_h = st["today"], st["now"]
        aqi_h = AQ.hourly_aqi(s[[p for p in C.AQI_POLLUTANTS if p in s.columns]])
        view = s[s.index >= today]
        aqi_v = aqi_h.loc[view.index]

        def num(v, nd=1):
            return None if v is None or not np.isfinite(v) else round(float(v), nd)

        hourly = []
        for t, row in view.iterrows():
            a = aqi_v.loc[t]
            rec = {"time": t.strftime("%Y-%m-%d %H:00"), "observed": bool(row["observed"]),
                   "vn_aqi": None if pd.isna(a.get("vn_aqi")) else int(a["vn_aqi"]),
                   "us_aqi": None if pd.isna(a.get("us_aqi")) else int(a["us_aqi"]),
                   "vn_dominant": a.get("vn_dominant") if isinstance(a.get("vn_dominant"), str) else None,
                   "us_dominant": a.get("us_dominant") if isinstance(a.get("us_dominant"), str) else None}
            for p in C.POLLUTANTS:
                if p in row:
                    rec[p] = num(row[p], 3 if p == "co2" else 1)
            for k in ("temperature_2m", "relative_humidity", "wind_speed", "precipitation"):
                if k in row:
                    rec[k] = num(row[k])
            hourly.append(rec)

        daily_df = AQ.daily_aqi(s[(s.index >= today)][[p for p in C.AQI_POLLUTANTS if p in s.columns]])
        limits = C.qcvn_limits(today.date())
        daily = []
        for _, r in daily_df.iterrows():
            d = pd.Timestamp(r["date"])
            part = s[s.index.normalize() == d]
            rec = {"date": d.strftime("%Y-%m-%d"), "label": day_label(d, today), "weekday": WEEKDAYS[d.dayofweek],
                   "date_label": d.strftime("%d/%m"), "observed_hours": int(part["observed"].sum()),
                   "forecast_hours": int((~part["observed"]).sum())}
            for std in ("vn", "us"):
                v = r.get(f"{std}_aqi")
                rec[f"{std}_aqi"] = None if v is None or pd.isna(v) else int(v)
                rec[f"{std}_dominant"] = r.get(f"{std}_dominant") if isinstance(r.get(f"{std}_dominant"), str) else None
            lv = AQ.level_of(rec["vn_aqi"])
            rec.update({"level": lv["level"], "color": lv["color"]})
            exceed = []
            for p in C.POLLUTANTS:
                if p not in part.columns:
                    continue
                vals = part[p].astype(float)
                rec[p] = {"mean": num(vals.mean(), 2 if p == "co2" else 1), "max": num(vals.max(), 2 if p == "co2" else 1),
                          "min": num(vals.min(), 2 if p == "co2" else 1)}
                lim = limits.get(p, {})
                if "24h" in lim and np.isfinite(vals.mean()) and vals.mean() > lim["24h"]:
                    exceed.append({"pollutant": p, "basis": "TB 24h", "value": num(vals.mean()), "limit": lim["24h"]})
                if "1h" in lim and np.isfinite(vals.max()) and vals.max() > lim["1h"]:
                    exceed.append({"pollutant": p, "basis": "TB 1h", "value": num(vals.max()), "limit": lim["1h"]})
                if "8h" in lim:
                    m8 = s[p].astype(float).rolling(8, min_periods=6).mean().reindex(part.index).max()
                    if np.isfinite(m8) and m8 > lim["8h"]:
                        exceed.append({"pollutant": p, "basis": "TB 8h", "value": num(m8), "limit": lim["8h"]})
            rec["qcvn_exceed"] = exceed
            daily.append(rec)

        cur_row = s.loc[now_h] if now_h in s.index else s.iloc[-1]
        cur_aqi = aqi_h.loc[now_h] if now_h in aqi_h.index else aqi_h.iloc[-1]
        vn_now = None if pd.isna(cur_aqi.get("vn_aqi")) else int(cur_aqi["vn_aqi"])
        us_now = None if pd.isna(cur_aqi.get("us_aqi")) else int(cur_aqi["us_aqi"])
        lv = AQ.level_of(vn_now)
        current = {"time": now_h.strftime("%Y-%m-%d %H:00"), "observed": bool(cur_row["observed"]),
                   "values": {p: num(cur_row[p], 3 if p == "co2" else 1) for p in C.POLLUTANTS if p in cur_row},
                   "vn_aqi": vn_now, "us_aqi": us_now,
                   "vn_dominant": cur_aqi.get("vn_dominant") if isinstance(cur_aqi.get("vn_dominant"), str) else None,
                   "us_dominant": cur_aqi.get("us_dominant") if isinstance(cur_aqi.get("us_dominant"), str) else None,
                   "level": lv["level"], "color": lv["color"],
                   "weather": {k: num(cur_row[k]) for k in ("temperature_2m", "relative_humidity", "wind_speed",
                                                            "wind_dir", "precipitation") if k in cur_row}}

        monthly = self.monthly(now_h)
        scale = 1.0
        if code:
            S = st["factors"].get("pm2_5")
            if S is not None and str(code) in S.index:
                scale = float(np.nanmean(S.loc[str(code)].to_numpy())) or 1.0
        months = []
        for p, o in monthly.items():
            if not o.get("available"):
                continue
            fac = scale if C.POLLUTANTS[p]["pattern"] else 1.0
            for i, m in enumerate(o["months"]):
                if len(months) <= i:
                    per = pd.Period(m["month"])
                    months.append({"month": m["month"], "label": f"Tháng {per.month}/{per.year}"})
                months[i][p] = {k: round(v * fac, 2) for k, v in m.items() if isinstance(v, (int, float))}

        return {
            "ok": True,
            "generated_at": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
            "today": {"date": today.strftime("%Y-%m-%d"), "weekday": WEEKDAYS[today.dayofweek],
                      "label": f"{WEEKDAYS[today.dayofweek]}, {today.strftime('%d/%m/%Y')}",
                      "now": now_h.strftime("%H:00")},
            "location": location,
            "current": current,
            "hourly": hourly,
            "daily": daily,
            "monthly": {"months": months, "method": "Khí hậu tháng + xu thế tuyến tính + dị thường AR(1)",
                        "backtest": {p: o.get("backtest") for p, o in monthly.items() if o.get("available")}},
            "model": st["info"],
            "pollutants": {p: {"name": m["name"], "full": m["full"], "unit": m["unit"], "qcvn": limits.get(p, {})}
                           for p, m in C.POLLUTANTS.items()},
            "resolution": C.TARGET_RESOLUTION,
        }

    # ------------------------------------------------------------------ bản đồ theo phường
    def spatial(self, pollutant="pm2_5", hour=None):
        """Giá trị từng phường tại một giờ (hiện tại hoặc tương lai) + VN_AQI/US AQI của phường."""
        return self._cached(("spatial", pollutant, str(hour)), 300, lambda: self._spatial(pollutant, hour))

    def _spatial(self, pollutant, hour):
        st = self.state()
        if not st.get("ok"):
            return None
        T = pd.Timestamp(hour).floor("h") if hour else st["now"]
        T = min(max(T, st["now"] - pd.Timedelta(days=7)), st["end"])
        idx = pd.date_range(T - pd.Timedelta(hours=23), T, freq="h")
        try:
            ward = self.loader.ward(idx[0], idx[-1])
        except Exception:
            ward = None
        if ward is None or ward.empty:
            return None
        ward = ward.assign(ma_phuong_xa=ward["ma_phuong_xa"].astype(str))
        polls = [p for p in C.AQI_POLLUTANTS if p in ward.columns]
        if pollutant not in polls and pollutant in ward.columns:
            polls.append(pollutant)
        names = {}
        try:
            from app.services import ward_index
            names = {w["code"]: w["name"] for w in ward_index.all_wards()}
        except Exception:
            pass
        rows = []
        for code, g in ward.groupby("ma_phuong_xa"):
            g = g.drop_duplicates("thoi_gian").set_index("thoi_gian").reindex(idx)
            frame = pd.DataFrame(index=idx)
            for p in polls:
                s = g[p].astype(float)
                fc = st["forecast"].get(p)
                info = st["info"].get(p)
                if fc is not None and info:
                    future = idx > pd.Timestamp(info["t0"])
                    if future.any():
                        S = st["factors"].get(p)
                        prof = np.ones(len(idx))
                        if S is not None and code in S.index:
                            row = S.loc[code]
                            prof = row.reindex(idx.hour).fillna(row.mean()).fillna(1.0).to_numpy()
                        s[future] = (fc.reindex(idx) * prof)[future]
                frame[p] = s
            a = AQ.hourly_aqi(frame[[p for p in C.AQI_POLLUTANTS if p in frame.columns]]).iloc[-1]
            val = frame[pollutant].iloc[-1] if pollutant in frame.columns else np.nan
            vn = None if pd.isna(a.get("vn_aqi")) else int(a["vn_aqi"])
            lv = AQ.level_of(vn)
            rows.append({"ma_phuong_xa": code, "ten_phuong_xa": names.get(code, code),
                         "value": None if not np.isfinite(val) else round(float(val), 2),
                         "pm2_5": None if "pm2_5" not in frame or not np.isfinite(frame["pm2_5"].iloc[-1])
                         else round(float(frame["pm2_5"].iloc[-1]), 1),
                         "pm2_5_24h": None if "pm2_5" not in frame else round(float(frame["pm2_5"].mean()), 1),
                         "vn_aqi": vn, "us_aqi": None if pd.isna(a.get("us_aqi")) else int(a["us_aqi"]),
                         "vn_dominant": a.get("vn_dominant") if isinstance(a.get("vn_dominant"), str) else None,
                         "level": lv["level"], "color": lv["color"]})
        rows.sort(key=lambda r: -(r["value"] or 0))
        return {"time": T.strftime("%Y-%m-%d %H:00"), "pollutant": pollutant,
                "unit": C.POLLUTANTS.get(pollutant, {}).get("unit"), "observed": bool(T <= st["now"]),
                "wards": rows}

    # ------------------------------------------------------------------ chuỗi không gian - thời gian (bản đồ 3D)
    def spatial_series(self, pollutant="pm2_5", back_hours=24, ahead_hours=72, step_hours=1):
        """Giá trị 168 phường cho cả một chuỗi giờ (quá khứ + dự báo) trong một lần gọi - dùng cho hoạt cảnh 3D."""
        key = ("spatial_series", pollutant, int(back_hours), int(ahead_hours), int(step_hours))
        return self._cached(key, 600, lambda: self._spatial_series(pollutant, back_hours, ahead_hours, step_hours))

    def _spatial_series(self, pollutant, back_hours, ahead_hours, step_hours):
        st = self.state()
        if not st.get("ok"):
            return None
        now = st["now"]
        step = max(1, min(int(step_hours), 24))
        t0 = now - pd.Timedelta(hours=max(0, min(int(back_hours), 24 * 30)))
        t1 = min(now + pd.Timedelta(hours=max(0, min(int(ahead_hours), 24 * 8))), st["end"])
        times = pd.date_range(t0, t1, freq=f"{step}h")[:240]  # Tối đa 240 khung hình
        if len(times) == 0:
            return None
        idx = pd.date_range(times[0] - pd.Timedelta(hours=23), times[-1], freq="h")  # +23 giờ trước cho NowCast
        try:
            ward = self.loader.ward(idx[0], idx[-1])
        except Exception:
            ward = None
        if ward is None or ward.empty:
            return None
        ward = ward.assign(ma_phuong_xa=ward["ma_phuong_xa"].astype(str))
        aqi_polls = [p for p in C.AQI_POLLUTANTS if p in ward.columns]
        polls = aqi_polls + ([pollutant] if pollutant not in aqi_polls and pollutant in ward.columns else [])
        names = {}
        try:
            from app.services import ward_index
            names = {w["code"]: w["name"] for w in ward_index.all_wards()}
        except Exception:
            pass

        def num(v, nd):
            return None if v is None or not np.isfinite(v) else round(float(v), nd)

        # Ma trận [giờ x phường] cho từng chất (tính trên ma trận, không lặp từng phường)
        codes = sorted(ward["ma_phuong_xa"].unique())
        hours = idx.hour.to_numpy()
        mats = {}
        for p in polls:
            m = (ward.pivot_table(index="thoi_gian", columns="ma_phuong_xa", values=p, aggfunc="mean")
                 .reindex(index=idx, columns=codes).to_numpy(dtype=float))
            fc, info = st["forecast"].get(p), st["info"].get(p)
            if fc is not None and info:  # Giờ tương lai: dự báo cấp TP x hệ số phường theo giờ trong ngày
                future = idx > pd.Timestamp(info["t0"])
                if future.any():
                    S = st["factors"].get(p)
                    prof = np.ones((len(idx), len(codes)))
                    if S is not None:
                        Sw = S.reindex(index=codes, columns=range(24))
                        Sw = Sw.apply(lambda r: r.fillna(r.mean()), axis=1).fillna(1.0).to_numpy(dtype=float)
                        prof = Sw[:, hours].T
                    fcv = fc.reindex(idx).to_numpy(dtype=float)
                    m[future] = fcv[future, None] * prof[future]
            mats[p] = m

        # AQI theo giờ: xếp các phường nối tiếp, xen GAP dòng trống để cửa sổ NowCast (12 giờ) / TB 8 giờ
        # không lấn sang phường bên cạnh -> một lần gọi thay cho 168 lần, kết quả giống hệt tính từng phường
        GAP = 12
        T, N = len(idx), len(codes)
        stacked = {p: np.vstack([np.full((GAP, N), np.nan), mats[p]]).T.reshape(-1) for p in aqi_polls}
        a = AQ.hourly_aqi(pd.DataFrame(stacked))
        pos = idx.get_indexer(times)
        vn_m = a["vn_aqi"].to_numpy(dtype=float).reshape(N, GAP + T)[:, GAP:][:, pos].T   # [thời gian x phường]
        us_m = a["us_aqi"].to_numpy(dtype=float).reshape(N, GAP + T)[:, GAP:][:, pos].T
        val_m = mats[pollutant][pos] if pollutant in mats else np.full((len(times), N), np.nan)

        values = [[num(x, 2) for x in row] for row in val_m]
        vn_aqi = [[num(x, 0) for x in row] for row in vn_m]
        us_aqi = [[num(x, 0) for x in row] for row in us_m]
        flat = val_m[np.isfinite(val_m)]
        return {
            "pollutant": pollutant, "unit": C.POLLUTANTS.get(pollutant, {}).get("unit"),
            "name": C.POLLUTANTS.get(pollutant, {}).get("name", pollutant),
            "times": [t.strftime("%Y-%m-%d %H:00") for t in times],
            "observed_until": now.strftime("%Y-%m-%d %H:00"),
            "wards": [{"code": c, "name": names.get(c, c)} for c in codes],
            # Ma trận [thời gian][phường] để client dựng từng khung hình
            "values": values, "vn_aqi": vn_aqi, "us_aqi": us_aqi,
            "range": {"min": num(flat.min(), 2) if flat.size else None, "max": num(flat.max(), 2) if flat.size else None,
                      "p98": num(np.percentile(flat, 98), 2) if flat.size else None},
        }

    def current_legacy(self, max_age_hours=3):
        """Số liệu hiện tại cấp TP theo định dạng /aqi/current cũ (+ đa chất, VN_AQI)."""
        return self._cached(("current", max_age_hours), 120, lambda: self._current_legacy(max_age_hours))

    def _current_legacy(self, max_age_hours):
        from app.services.dss_service import DSSEngine
        st = self.state()
        if not st.get("ok") or "pm2_5" not in st["info"]:
            return None
        if st["info"]["pm2_5"]["stale_hours"] > max_age_hours:
            return None
        pl = self.payload()
        cur = pl["current"]
        pm = cur["values"].get("pm2_5")
        if pm is None:
            return None
        us_pm = AQ.scalar_us_pm25(pm)
        wx = cur.get("weather", {})
        return {
            "timestamp": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
            "pm2_5": pm, "pm10": cur["values"].get("pm10"),
            "temperature_2m": wx.get("temperature_2m"),
            "us_aqi": us_pm, "vn_aqi": cur["vn_aqi"], "us_aqi_all": cur["us_aqi"],
            "dominant": cur["vn_dominant"],
            "wind_speed": round((wx.get("wind_speed") or 0) * 3.6, 1),  # km/h như bản cũ
            "wind_direction": wx.get("wind_dir"),
            "pollutants": cur["values"],
            "advisory": DSSEngine.get_health_advisory(us_pm, pm),
            "source": "AirData (CAMS + Sentinel-5P/MAIAC + ERA5-Land, đồng nhất 168 phường)",
        }

    # ------------------------------------------------------------------ tương thích API cũ
    def legacy_hourly(self, hours=24):
        """Danh sách giờ tương lai cấp TP theo định dạng /forecast/hourly cũ (+ các chất mới)."""
        return self._cached(("legacy", hours), 300, lambda: self._legacy_hourly(hours))

    def _legacy_hourly(self, hours):
        from app.services.dss_service import DSSEngine
        st = self.state()
        if not st.get("ok") or "pm2_5" not in st["forecast"]:
            return None
        s = self._series(st)
        aqi_h = AQ.hourly_aqi(s[[p for p in C.AQI_POLLUTANTS if p in s.columns]])
        fut = s[s.index > st["now"]].head(hours)
        out = []
        for t, row in fut.iterrows():
            pm = float(row["pm2_5"])
            us_pm = AQ.scalar_us_pm25(pm)
            adv = DSSEngine.get_health_advisory(us_pm, pm)
            a = aqi_h.loc[t]
            rec = {"time": t.strftime("%Y-%m-%d %H:00"), "pm2_5": round(pm, 2),
                   "pm10": round(float(row.get("pm10", pm * 1.36)), 2), "aqi": int(us_pm),
                   "level": adv["level"], "color": adv["color"], "qcvn_status": adv["qcvn_comparison"],
                   "vn_aqi": None if pd.isna(a.get("vn_aqi")) else int(a["vn_aqi"]),
                   "us_aqi_all": None if pd.isna(a.get("us_aqi")) else int(a["us_aqi"]),
                   "source": st["sources"].get("pm2_5")}
            for p in ("co", "no2", "so2", "o3"):
                if p in row and np.isfinite(row[p]):
                    rec[p] = round(float(row[p]), 1)
            out.append(rec)
        return out

    # ------------------------------------------------------------------ đối chiếu trực tuyến
    def verification(self, now=None, days=30):
        now_h = pd.Timestamp(now or pd.Timestamp.now()).floor("h")
        issued = self.loader.issued(now_h - pd.Timedelta(days=days), now_h)
        if issued is None or issued.empty:
            return {"available": False, "reason": "Chưa có dự báo nào đến hạn đối chiếu."}
        city = self.loader.city(now_h - pd.Timedelta(days=days + 9), now_h)
        if city is None or city.empty:
            return {"available": False}
        obs = F.complete_hourly(city)
        issued["thoi_gian_dich"] = pd.to_datetime(issued["thoi_gian_dich"])
        issued["phat_hanh_luc"] = pd.to_datetime(issued["phat_hanh_luc"])
        res = {}
        for p, g in issued.groupby("chat"):
            if p not in obs.columns:
                continue
            y = obs[p].reindex(pd.DatetimeIndex(g["thoi_gian_dich"])).to_numpy(dtype=float)
            h = ((g["thoi_gian_dich"] - g["phat_hanh_luc"]) / pd.Timedelta(hours=1)).to_numpy()
            for lo, hi, name in BINS:
                m = (h >= lo) & (h <= hi) & np.isfinite(y)
                if not m.any():
                    continue
                rec = {"n": int(m.sum())}
                for col, key in (("gia_tri_ml", "ml"), ("gia_tri_cams", "cams"), ("gia_tri_ket_hop", "final")):
                    pr = g[col].to_numpy(dtype=float)[m]
                    ok = np.isfinite(pr)
                    if ok.sum():
                        e = pr[ok] - y[m][ok]
                        rec[f"mae_{key}"] = round(float(np.mean(np.abs(e))), 3)
                        rec[f"rmse_{key}"] = round(float(np.sqrt(np.mean(e ** 2))), 3)
                res.setdefault(p, {})[name] = rec
        return {"available": bool(res), "days": days, "by_pollutant": res}


ENGINE = AirForecastEngine()
