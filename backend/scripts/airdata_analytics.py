"""
TÍNH TOÀN BỘ KẾT QUẢ PHÂN TÍCH NÂNG CAO CHO BÁO CÁO (chạy sau airdata_train.py)

    cd backend
    python scripts/airdata_analytics.py              # ~5-15 phút
    python scripts/airdata_analytics.py --skip-calibration

Các bước (mỗi bước độc lập, lỗi bước nào thì bỏ qua bước đó):
  1. Hiệu chỉnh dự báo xác suất từ sai số tập kiểm thử (nửa đầu hiệu chỉnh, nửa sau kiểm chứng)
     -> saved_models/airdata/uncertainty.json  (backend dùng ngay cho /air/probability, /air/risk)
  2. Đánh giá mở rộng: theo mùa mưa/khô, đợt cực trị, phân loại vượt ngưỡng giờ -> analytics/evaluation_extra.json
  3. QA/QC toàn chuỗi cấp TP + 180 ngày theo phường -> analytics/qaqc.json
  4. Hoa gió & hoa gió ô nhiễm (toàn kỳ, mùa khô, mùa mưa) -> analytics/windrose.json + hình
  5. Sự kiện ô nhiễm + truy vết nguồn A-C cho sự kiện nặng nhất -> analytics/trace.json + hình quỹ đạo
  6. Rủi ro phơi nhiễm hôm nay + 7 ngày (PM2.5, QCVN & WHO) -> analytics/risk_today.json + bản đồ
  7. Kịch bản S0-S3 + tối ưu ngân sách -> analytics/scenarios.json + hình Pareto
  8. Bảng nghiệm thu -> analytics/acceptance.json;  tổng hợp số liệu báo cáo -> analytics/BAO_CAO_SO_LIEU.md
"""
import argparse
import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from app.airdata import analytics as AN  # noqa: E402
from app.airdata import config as C  # noqa: E402
from app.airdata import evaluation as EV  # noqa: E402
from app.airdata import qaqc as QC  # noqa: E402
from app.airdata import store  # noqa: E402
from app.airdata import uncertainty as U  # noqa: E402
from app.airdata import windrose as WR  # noqa: E402
from app.airdata.router_analytics import clean  # noqa: E402

OUT = C.ANALYTICS_DIR
FIG = os.path.join(OUT, "figures")
NAMES = {p: v["name"] for p, v in C.POLLUTANTS.items()}


def dump(name, obj):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, ensure_ascii=False, indent=1)
    return path


def plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as p
    os.makedirs(FIG, exist_ok=True)
    return p


def step(title):
    def deco(fn):
        def run(*a, **k):
            t = time.time()
            print(f"\n=== {title} ===")
            try:
                r = fn(*a, **k)
                print(f"    xong ({time.time() - t:.0f}s)")
                return r
            except Exception as e:
                print(f"    LỖI: {e}\n{traceback.format_exc()[-800:]}")
                return None
        return run
    return deco


def load_city():
    city = store.city_hourly(end=pd.Timestamp.now().floor("h"))
    try:
        ex = store.extra_weather()
        if not ex.empty:
            from app.airdata import features as F
            city = city.merge(ex.drop_duplicates("thoi_gian")[["thoi_gian"] + [c for c in F.EXTRA_WX if c in ex]],
                              on="thoi_gian", how="left")
    except Exception:
        pass
    print(f"-> Chuỗi cấp TP: {len(city):,} giờ ({city['thoi_gian'].min()} -> {city['thoi_gian'].max()})")
    return city


@step("1-2. Hiệu chỉnh xác suất + đánh giá mở rộng")
def calibrate(city, summary):
    unc, extra = {}, {}
    hourly_recs = {}
    for p in C.FORECAST_POLLUTANTS:
        path = os.path.join(C.MODEL_DIR, f"{p}.joblib")
        if not os.path.exists(path):
            continue
        b = joblib.load(path)
        hr, dr = EV.test_predictions(city, b, p, issue_step=6)
        unc[p] = U.fit_and_evaluate(hr, dr, p)
        hourly_recs[p] = hr
        ev = unc[p]["evaluation"]
        d1 = ev["daily"].get("1", {})
        print(f"    {NAMES[p]:<6} PICP90 giờ (ngày 1/4/8): "
              f"{[ev['hourly'].get(k, {}).get('picp90') for k in ('0', '3', '7')]} | ngày thứ 2: PICP90 {d1.get('picp90')}, "
              + ", ".join(f"Brier {s.upper()} {t.get('brier')} (skill {t.get('brier_skill')})"
                          for s, t in d1.get("thresholds", {}).items()))
    U.save(unc)
    rm = U.ResidualModel.load()
    for p, hr in hourly_recs.items():
        extra[p] = EV.extended_metrics(hr, p, rm)
    dump("evaluation_extra", extra)
    summary["calibration"] = {p: {"hourly_picp90": {k: v.get("picp90") for k, v in u["evaluation"]["hourly"].items()},
                                  "daily": {k: {"picp90": v.get("picp90"), "width90": v.get("width90"),
                                                **{f"brier_{s}": t.get("brier") for s, t in v.get("thresholds", {}).items()},
                                                **{f"brier_skill_{s}": t.get("brier_skill") for s, t in v.get("thresholds", {}).items()},
                                                **{f"f1_{s}": t.get("f1") for s, t in v.get("thresholds", {}).items()}}
                                            for k, v in u["evaluation"]["daily"].items()},
                                  "periods": [u.get("calibration_period"), u.get("evaluation_period")]}
                              for p, u in unc.items()}
    summary["season"] = {p: e["by_season"] for p, e in extra.items()}
    summary["extremes"] = {p: e["extremes"] for p, e in extra.items()}
    # Hình: reliability ngày thứ 2 (WHO) + PICP theo ngày dự báo
    pl = plt()
    fig, ax = pl.subplots(1, 2, figsize=(12, 4.6))
    for p, u in unc.items():
        d1 = u["evaluation"]["daily"].get("1", {}).get("thresholds", {}).get("who")
        if d1 and d1.get("reliability"):
            r = d1["reliability"]
            ax[0].plot([x["p_mean"] for x in r], [x["o_freq"] for x in r], marker="o", label=NAMES[p])
        pic = [u["evaluation"]["daily"].get(str(k), {}).get("picp90") for k in range(8)]
        ax[1].plot(range(1, 9), [np.nan if v is None else v for v in pic], marker="o", label=NAMES[p])
    ax[0].plot([0, 1], [0, 1], "k--", lw=1)
    ax[0].set_xlabel("Xác suất dự báo P(vượt WHO)"); ax[0].set_ylabel("Tần suất quan sát"); ax[0].set_title("Reliability - ngày dự báo thứ 2")
    ax[1].axhline(0.9, color="k", ls="--", lw=1)
    ax[1].set_xlabel("Ngày dự báo thứ"); ax[1].set_ylabel("PICP khoảng 90%"); ax[1].set_ylim(0.5, 1.0); ax[1].set_title("Độ bao phủ khoảng dự báo 90%")
    for a in ax:
        a.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "reliability_picp.png"), dpi=150); pl.close(fig)
    return unc


@step("3. QA/QC")
def run_qaqc(city, summary):
    now = pd.Timestamp.now().floor("h")
    ward = store.ward_hourly(now - pd.Timedelta(days=180), now)
    rep = QC.report(city, ward, now=now)
    dump("qaqc", rep)
    summary["qaqc"] = {"city": {p: {k: v for k, v in r.items() if k in ("completeness", "missing_hours", "longest_gap_h",
                                                                         "negative", "spikes", "flat_hours", "valid_24h_ratio")}
                                for p, r in rep["city"].items()},
                       "wards_180d": rep.get("wards"), "acceptance": rep.get("acceptance"),
                       "provenance_flags": rep.get("provenance_flags")}
    print(f"    Nghiệm thu độ đầy đủ: {rep.get('acceptance')}")


def _rose_plot(r, title, path, value="freq"):
    pl = plt()
    n = r["n_sectors"]
    theta = np.radians([s["center_deg"] for s in r["sectors"]])
    width = 2 * np.pi / n * 0.9
    fig = pl.figure(figsize=(5.6, 5.6))
    ax = fig.add_subplot(111, projection="polar")
    ax.set_theta_zero_location("N"); ax.set_theta_direction(-1)
    if value == "freq":
        bottom = np.zeros(n)
        for j, lab in enumerate(r["speed_classes"]):
            vals = np.array([s["by_speed_pct"][j] for s in r["sectors"]])
            ax.bar(theta, vals, width=width, bottom=bottom, label=lab)
            bottom += vals
        ax.legend(loc="lower left", bbox_to_anchor=(-0.15, -0.15), fontsize=7)
    else:
        vals = np.array([(s.get("p_exceed") or 0) * 100 for s in r["sectors"]])
        cols = ["#bbbbbb" if s["low_count"] else "#d62728" for s in r["sectors"]]
        ax.bar(theta, vals, width=width, color=cols)
    ax.set_xticks(theta); ax.set_xticklabels([s["name"] for s in r["sectors"]])
    ax.set_title(title, fontsize=10)
    fig.tight_layout(); fig.savefig(path, dpi=150); pl.close(fig)


@step("4. Hoa gió & hoa gió ô nhiễm")
def run_rose(city, summary):
    df = city.set_index(pd.to_datetime(city["thoi_gian"]))
    df = df[df.index <= pd.Timestamp.now()]
    out = {}
    m = df.index.month
    for key, sub in (("toan_ky", df), ("mua_kho", df[(m <= 4) | (m == 12)]), ("mua_mua", df[(m >= 5) & (m <= 11)])):
        out[key] = {p: WR.rose_from_frame(sub, p, None, 8) for p in ("pm2_5", "no2", "so2")}
        out[key]["wind16"] = WR.rose_from_frame(sub, None, None, 16)
    dump("windrose", out)
    r = out["toan_ky"]["pm2_5"]
    _rose_plot(r, f"Hoa gió TP.HCM ({r['n_total']:,} giờ, % số giờ)", os.path.join(FIG, "windrose_city.png"))
    _rose_plot(r, f"Hoa gió ô nhiễm: P(PM2.5 > {r['threshold']:g} µg/m³ | hướng) (%)",
               os.path.join(FIG, "pollution_rose_pm25.png"), value="p")
    for key in ("mua_kho", "mua_mua"):
        rr = out[key]["pm2_5"]
        _rose_plot(rr, f"Hoa gió {key.replace('_', ' ')} (% số giờ)", os.path.join(FIG, f"windrose_{key}.png"))
    summary["windrose"] = {k: {"calm_pct": v["pm2_5"]["calm"]["freq_pct"] if v["pm2_5"]["calm"] else None,
                               "dominant_wind": v["pm2_5"].get("dominant_wind_sector"),
                               "dominant_pollution_pm25": v["pm2_5"].get("dominant_pollution_sector"),
                               "threshold": v["pm2_5"].get("threshold"),
                               "sectors_pm25": [{x: s.get(x) for x in ("name", "freq_pct", "mean", "p_exceed", "n", "low_count")}
                                                for s in v["pm2_5"]["sectors"]],
                               "by_speed_class": v["pm2_5"].get("by_speed_class"),
                               "sensitivity": v["pm2_5"].get("sensitivity")} for k, v in out.items()}


@step("5. Sự kiện ô nhiễm & truy vết nguồn A-C")
def run_trace(engine, summary):
    tr = AN.trace_payload(engine, None, "pm2_5", days=365, traj_hours=48)
    dump("trace", tr)
    summary["trace"] = {"events": tr.get("events"), "event_date": tr.get("event_date"),
                        "signals": [f["signal"] + " -> " + f["interpretation"] for f in tr.get("signals", {}).get("findings", [])],
                        "ratios": tr.get("signals", {}).get("ratios"), "traffic_index": tr.get("signals", {}).get("traffic_index"),
                        "regional_background": tr.get("regional_background"),
                        "top_suspects": [{k: s.get(k) for k in ("ten", "loai_label", "distance_km", "score", "p_in_top")}
                                         for s in (tr.get("suspects", {}).get("sources") or [])[:8]],
                        "n_candidates": len(tr.get("suspects", {}).get("sources") or []),
                        "ladder": [(x["level"], x["done"]) for x in tr.get("evidence_ladder", [])]}
    if tr.get("trajectories"):
        pl = plt()
        fig, ax = pl.subplots(figsize=(6.5, 6))
        reps = AN._wards_rep()
        ax.scatter(reps["lng"], reps["lat"], s=6, c="#9ca3af", label="Điểm đại diện phường")
        for t in tr["trajectories"]:
            ax.plot([p["lon"] for p in t], [p["lat"] for p in t], lw=1)
        srcs = tr.get("suspects", {}).get("sources") or []
        if srcs:
            ax.scatter([s["lon"] for s in srcs[:10]], [s["lat"] for s in srcs[:10]], marker="^", c="#dc2626", s=40,
                       label="Ứng viên nguồn (top 10)")
        ax.set_title(f"Quỹ đạo ngược 48 giờ (đơn giản hóa) - sự kiện {tr['event_date']}", fontsize=10)
        ax.set_xlabel("Kinh độ"); ax.set_ylabel("Vĩ độ"); ax.legend(fontsize=7)
        fig.tight_layout(); fig.savefig(os.path.join(FIG, "back_trajectories.png"), dpi=150); pl.close(fig)


@step("6. Rủi ro phơi nhiễm hôm nay + 7 ngày")
def run_risk(engine, summary):
    out = {}
    for std in ("qcvn", "who"):
        r = AN.risk_payload(engine, "pm2_5", std)
        if r.get("ok"):
            out[std] = r
    dump("risk_today", out)
    summary["risk"] = {std: {"threshold": r["threshold"], "unit": r["unit"], "population_total": r["population_total"],
                             "city": r["city"], "method": r["method"]} for std, r in out.items()}
    try:
        import geopandas as gpd
        gdf = gpd.read_file(os.path.join(C.BACKEND_DIR, "..", "frontend", "assets", "data", "hcm_wards.json"))
        r = out.get("who")
        if r:
            pmap = {w["ma_phuong_xa"]: w["days"][1]["p"] for w in r["wards"]}
            gdf["p"] = gdf["ma_xa"].astype(str).map(pmap)
            pl = plt()
            fig, ax = pl.subplots(figsize=(7, 7))
            gdf.plot(column="p", cmap="OrRd", vmin=0, vmax=1, legend=True, ax=ax, edgecolor="#555", linewidth=0.2,
                     legend_kwds={"label": "P(PM2.5 TB 24h > 15 µg/m³)", "shrink": 0.6})
            ax.set_title(f"Xác suất vượt WHO ngày {r['days'][1]} theo phường/xã", fontsize=10)
            ax.set_axis_off(); fig.tight_layout(); fig.savefig(os.path.join(FIG, "risk_map_who_day2.png"), dpi=150); pl.close(fig)
    except Exception as e:
        print(f"    (bỏ qua bản đồ: {e})")


@step("7. Kịch bản can thiệp & tối ưu")
def run_scenarios(engine, summary):
    sc = AN.scenarios_payload(engine, "pm2_5", "past", 30, health={"rr_per10": C.HEALTH_RR_PM25_PER10["central"]})
    op = AN.optimize_payload(engine, "pm2_5", budget=15.0, equity_min_pct=5.0)
    dump("scenarios", {"compare": sc, "optimize": op})
    summary["scenarios"] = {"rows": [{k: r.get(k) for k in ("id", "name", "cost", "pwe_base", "pwe_scenario", "delta_pwe",
                                                            "reduction_pct", "pop_benefit", "person_hours_avoided_pct")}
                                     for r in sc.get("scenarios", [])],
                            "additivity_note": sc.get("additivity_note"),
                            "optimize_best": op.get("best"), "n_pareto": len(op.get("pareto") or [])}
    if op.get("pareto"):
        pl = plt()
        fig, ax = pl.subplots(figsize=(6.5, 4.2))
        allp = op["pareto"]
        ax.plot([r["cost"] for r in allp], [r["reduction_pct"] for r in allp], "o-", label="Biên Pareto")
        if op.get("best"):
            ax.scatter([op["best"]["cost"]], [op["best"]["reduction_pct"]], s=120, facecolors="none", edgecolors="r",
                       label=f"Tối ưu với ngân sách {op['budget']:g}")
        ax.set_xlabel("Chi phí (đơn vị tương đối - giả định)"); ax.set_ylabel("Giảm phơi nhiễm PWE PM2.5 (%)")
        ax.set_title("Tối ưu tổ hợp biện pháp (minh họa, giả định thử nghiệm)", fontsize=10); ax.legend(fontsize=8)
        fig.tight_layout(); fig.savefig(os.path.join(FIG, "pareto_scenarios.png"), dpi=150); pl.close(fig)


def write_markdown(summary):
    L = ["# SỐ LIỆU PHÂN TÍCH NÂNG CAO CHO BÁO CÁO (tự sinh bởi scripts/airdata_analytics.py)", "",
         f"Thời điểm chạy: {summary['generated_at']}", ""]
    cal = summary.get("calibration") or {}
    if cal:
        L += ["## 1. Dự báo xác suất - kiểm chứng độc lập", "",
              "| Chất | PICP90 giờ (ngày 1) | PICP90 giờ (ngày 8) | PICP90 TB ngày (ngày 2) | Brier QCVN (ngày 2) | Brier WHO (ngày 2) | Brier skill WHO |",
              "|---|---|---|---|---|---|---|"]
        for p, c in cal.items():
            d = c["daily"].get("1", {})
            L.append(f"| {NAMES[p]} | {c['hourly_picp90'].get('0')} | {c['hourly_picp90'].get('7')} | {d.get('picp90')} | "
                     f"{d.get('brier_qcvn')} | {d.get('brier_who')} | {d.get('brier_skill_who')} |")
        per = next(iter(cal.values()))["periods"]
        L += ["", f"Hiệu chỉnh: {per[0]}; kiểm chứng: {per[1]}.", ""]
    if summary.get("season"):
        L += ["## 2. RMSE theo mùa (hạn 1-24h / 73-192h)", "", "| Chất | Mùa khô | Mùa mưa |", "|---|---|---|"]
        for p, s in summary["season"].items():
            f = lambda k: f"{s.get(k, {}).get('1-24h', {}).get('rmse')} / {s.get(k, {}).get('73-192h', {}).get('rmse')}"  # noqa: E731
            L.append(f"| {NAMES[p]} | {f('mua_kho')} | {f('mua_mua')} |")
        L.append("")
    qa = summary.get("qaqc")
    if qa:
        L += ["## 3. QA/QC chuỗi cấp TP", "", "| Biến | Độ đầy đủ | Giờ thiếu | Đoạn thiếu dài nhất (h) | Spike | Chuỗi đứng (h) | Tỷ lệ ngày TB24h hợp lệ |",
              "|---|---|---|---|---|---|---|"]
        for p, r in qa["city"].items():
            L.append(f"| {p} | {r.get('completeness')} | {r.get('missing_hours')} | {r.get('longest_gap_h')} | {r.get('spikes')} | "
                     f"{r.get('flat_hours')} | {r.get('valid_24h_ratio')} |")
        L += ["", f"Nghiệm thu: {qa.get('acceptance')}", ""]
    wr = summary.get("windrose")
    if wr:
        L += ["## 4. Hoa gió", ""]
        for k, v in wr.items():
            L.append(f"- {k}: lặng gió {v['calm_pct']}%; hướng gió trội {v['dominant_wind']}; hướng ô nhiễm PM2.5 trội "
                     f"{v['dominant_pollution_pm25']} (ngưỡng {v['threshold']} µg/m³)")
        L.append("")
    tr = summary.get("trace")
    if tr:
        L += ["## 5. Truy vết nguồn", "", f"Sự kiện (TB 24h > WHO 15): {tr.get('events')}", "",
              f"Sự kiện phân tích: {tr.get('event_date')}; nền liên vùng: {tr.get('regional_background')}", ""]
        L += [f"- {s}" for s in tr.get("signals") or []]
        L += ["", "| Ứng viên | Loại | Khoảng cách (km) | Điểm nghi vấn | P(top-5) |", "|---|---|---|---|---|"]
        L += [f"| {s['ten']} | {s['loai_label']} | {s['distance_km']} | {s['score']} | {s['p_in_top']} |" for s in tr.get("top_suspects") or []]
        L.append("")
    rk = summary.get("risk")
    if rk:
        L += ["## 6. Rủi ro phơi nhiễm PM2.5", ""]
        for std, r in rk.items():
            L += [f"### {std.upper()} (ngưỡng {r['threshold']} {r['unit']}, dân số {r['population_total']:,})", "",
                  "| Ngày | A_T (km²) | N_T theo q50 | E[N_T] | N_T q05-q95 | PWE |", "|---|---|---|---|---|---|"]
            L += [f"| {c['date']} | {c['area_exceed_km2']} | {c['people_exceed_q50']:,} | {c['people_exceed_expected']:,} | "
                  f"{c['people_exceed_q05']:,}-{c['people_exceed_q95']:,} | {c['pwe']} |" for c in r["city"]]
            L.append("")
    sc = summary.get("scenarios")
    if sc:
        L += ["## 7. Kịch bản can thiệp (GIẢ ĐỊNH THỬ NGHIỆM)", "", "| Kịch bản | Chi phí | PWE cơ sở | PWE kịch bản | Giảm (%) | Dân hưởng lợi | Người-giờ vượt tránh được (%) |",
              "|---|---|---|---|---|---|---|"]
        L += [f"| {r['name']} | {r['cost']} | {r['pwe_base']} | {r['pwe_scenario']} | {r['reduction_pct']} | {r['pop_benefit']:,} | "
              f"{r.get('person_hours_avoided_pct')} |" for r in sc["rows"]]
        L += ["", f"{sc.get('additivity_note')}", "", f"Tối ưu (ngân sách 15, công bằng ≥ 5%): {sc.get('optimize_best')}", ""]
    with open(os.path.join(OUT, "BAO_CAO_SO_LIEU.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(str(x) for x in L))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-calibration", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    store.ensure_schema()
    os.makedirs(FIG, exist_ok=True)
    summary = {"generated_at": pd.Timestamp.now().isoformat(timespec="seconds")}
    city = load_city()
    if not a.skip_calibration:
        calibrate(city, summary)
    run_qaqc(city, summary)
    run_rose(city, summary)
    from app.airdata.forecast import ENGINE
    ENGINE.reload_models()
    run_trace(ENGINE, summary)
    run_risk(ENGINE, summary)
    run_scenarios(ENGINE, summary)
    acc = AN.acceptance_payload(ENGINE)
    dump("acceptance", acc)
    summary["acceptance"] = acc["criteria"]
    dump("summary", summary)
    write_markdown(summary)
    print(f"\n==> Xong sau {(time.time() - t0) / 60:.1f} phút. Kết quả: {OUT}")
    print("    Mở analytics\\BAO_CAO_SO_LIEU.md để lấy số liệu đưa vào báo cáo; hình trong analytics\\figures.")
    print("    Backend đang chạy: POST /api/v1/admin/air/reload-models hoặc khởi động lại để dùng uncertainty.json.")


if __name__ == "__main__":
    main()
