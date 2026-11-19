// ==============================================================================
// AIRHCM - TAB DỰ BÁO ĐA CHẤT (AirData) - realtime: hôm nay + 7 ngày tới + xu hướng tháng
// Nguồn: GET /api/v1/air/forecast, /air/model-metrics, /air/sources (backend/app/airdata)
// Dùng chung biến toàn cục của app.js: API_BASE, currentAQIStandard, allWardsData, selectedWardFeature,
// myLocation, wardCodeOf, escapeHtml, getAQILevelIndex
// ==============================================================================
(function () {
    const POLL_ORDER = ["pm2_5", "pm10", "co", "no2", "so2", "o3", "co2"];
    const POLL_NAMES = { pm2_5: "PM2.5", pm10: "PM10", co: "CO", no2: "NO2", so2: "SO2", o3: "O3", co2: "CO2" };
    // Giới hạn tham chiếu để vẽ thanh mức độ (µg/m³; CO2 không có QCVN)
    const REF_LIMIT = { pm2_5: 45, pm10: 100, co: 30000, no2: 200, so2: 350, o3: 200 };
    const COLORS = { pm2_5: "#0284c7", pm10: "#0d9488", co: "#7c3aed", no2: "#dc2626", so2: "#d97706", o3: "#16a34a", co2: "#475569" };

    const state = { data: null, metrics: null, sources: null, pollutant: "pm2_5", range: 24, ward: "", lat: null, lng: null,
                    chart: null, monthly: null, loading: false, lastLoad: 0 };

    const $ = id => document.getElementById(id);
    const esc = v => (typeof escapeHtml === "function" ? escapeHtml(v) : String(v ?? ""));
    const std = () => (typeof currentAQIStandard !== "undefined" && currentAQIStandard === "US") ? "us" : "vn";
    const lvlIndex = aqi => (typeof getAQILevelIndex === "function" ? getAQILevelIndex(aqi) : 1);
    const LEVEL_NAMES = ["Tốt", "Trung bình", "Kém", "Xấu", "Rất xấu", "Nguy hại"];
    const LEVEL_COLORS = ["#00e400", "#ffff00", "#ff7e00", "#ff0000", "#8f3f97", "#7e0023"];
    const fmt = (v, nd = 1) => (v === null || v === undefined || Number.isNaN(v)) ? "--" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: nd });
    const unit = p => (p === "co2" ? "ppm" : "µg/m³");

    async function getJSON(path) {
        const res = await fetch(`${API_BASE}${path}`);
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { msg = (await res.json()).detail || msg; } catch (e) { /* bỏ qua */ }
            throw new Error(msg);
        }
        return res.json();
    }

    function query() {
        const q = new URLSearchParams();
        if (state.ward) q.set("ward_code", state.ward);
        else if (state.lat !== null && state.lng !== null) { q.set("lat", state.lat); q.set("lng", state.lng); }
        return q.toString() ? `?${q}` : "";
    }

    // ------------------------------------------------------------------ nạp dữ liệu
    async function load(force = false) {
        if (state.loading) return;
        if (!force && state.data && Date.now() - state.lastLoad < 60000) { render(); return; }
        state.loading = true;
        try {
            state.data = await getJSON(`/air/forecast${query()}`);
            state.lastLoad = Date.now();
            render();
        } catch (err) {
            showError(err.message);
        } finally {
            state.loading = false;
        }
        if (!state.metrics) getJSON("/air/model-metrics").then(m => { state.metrics = m; renderModel(); renderXAI(); }).catch(() => renderModel());
        if (!state.sources) getJSON("/air/sources").then(s => { state.sources = s; renderSources(); }).catch(() => {});
    }

    function showError(msg) {
        const body = $("air-table-body");
        if (body) body.innerHTML = `<tr><td colspan="10" class="table-empty">Chưa có dữ liệu dự báo đa chất: ${esc(msg)}.<br>`
            + `Hãy chạy <b>python scripts/airdata_backfill.py</b> rồi khởi động lại backend.</td></tr>`;
        const lbl = $("air-today-label");
        if (lbl) lbl.textContent = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    }

    // ------------------------------------------------------------------ hiển thị
    function render() {
        const d = state.data;
        if (!d || !d.ok) return;
        $("air-today-label").textContent = `${d.today.label} · ${d.today.now}`;
        $("air-location-name").textContent = d.location.ten_phuong_xa || "TP. Hồ Chí Minh";
        $("air-today-sub").textContent = d.location.scope === "ward"
            ? `Phường/xã · dữ liệu đồng nhất ${d.resolution.temporal}, hạ quy mô từ CAMS + Sentinel-5P/MAIAC`
            : "Trung bình có trọng số diện tích 168 phường/xã · cập nhật mỗi giờ";
        renderNow(); renderDays(); renderChips(); renderChart(); renderTable(); renderMonthly(); renderModel(); renderXAI();
        const th = $("air-table-aqi-th");
        if (th) th.textContent = std() === "us" ? "US AQI" : "VN_AQI";
    }

    function renderNow() {
        const c = state.data.current;
        const aqi = c[`${std()}_aqi`];
        const dom = c[`${std()}_dominant`];
        const box = $("air-now-aqi");
        const li = aqi === null ? 1 : lvlIndex(aqi);
        box.style.borderColor = LEVEL_COLORS[li - 1];
        box.style.background = `${LEVEL_COLORS[li - 1]}22`;
        box.innerHTML = `<b>${aqi ?? "--"}</b><span>${std() === "us" ? "US AQI" : "VN_AQI"} · ${c.time.slice(11)}</span>`
            + `<small>${LEVEL_NAMES[li - 1]}${dom ? ` · chi phối: ${POLL_NAMES[dom] || dom}` : ""}</small>`;
        const grid = $("air-now-grid");
        grid.innerHTML = POLL_ORDER.filter(p => p in c.values).map(p => {
            const v = c.values[p];
            const lim = REF_LIMIT[p];
            const pct = lim && v !== null ? Math.min(100, 100 * v / lim) : 0;
            const color = pct >= 100 ? "#dc2626" : pct >= 60 ? "#f59e0b" : "#16a34a";
            return `<div class="air-poll ${p === state.pollutant ? "active" : ""}" onclick="AirForecast.setPollutant('${p}')">
                ${dom === p ? '<span class="dom">CHI PHỐI</span>' : ""}
                <div class="n">${POLL_NAMES[p]}</div>
                <div><span class="v">${fmt(v, p === "co" ? 0 : 1)}</span><span class="u">${unit(p)}</span></div>
                ${lim ? `<div class="bar" title="So với QCVN ${lim} µg/m³"><i style="width:${pct}%;background:${color}"></i></div>` : '<div class="bar"></div>'}
            </div>`;
        }).join("") + (c.weather && c.weather.temperature_2m !== undefined ? `<div class="air-poll"><div class="n">Thời tiết</div>
            <div><span class="v">${fmt(c.weather.temperature_2m)}</span><span class="u">°C</span></div>
            <div class="n">${fmt(c.weather.relative_humidity, 0)}% · gió ${fmt(c.weather.wind_speed)} m/s</div></div>` : "");
    }

    function renderDays() {
        const host = $("air-days");
        host.innerHTML = state.data.daily.map((d, i) => {
            const aqi = d[`${std()}_aqi`];
            const li = aqi === null || aqi === undefined ? 1 : lvlIndex(aqi);
            const dom = d[`${std()}_dominant`];
            const p = state.pollutant;
            const exceed = (d.qcvn_exceed || []).map(e => `${POLL_NAMES[e.pollutant]} (${e.basis})`).join(", ");
            return `<div class="air-day ${i === 0 ? "today" : ""}">
                <div class="d1">${esc(d.label)}</div>
                <div class="d2">${i < 2 ? `${esc(d.weekday)} · ` : ""}${esc(d.date_label)}</div>
                <div class="aqi" style="background:${LEVEL_COLORS[li - 1]}33;color:#0f172a">${aqi ?? "--"}</div>
                <div class="lv">${LEVEL_NAMES[li - 1]}${dom ? ` · ${POLL_NAMES[dom]}` : ""}</div>
                <div class="row"><span>${POLL_NAMES[p]} TB</span><b>${fmt(d[p] && d[p].mean)}</b></div>
                <div class="row"><span>Cao nhất</span><b>${fmt(d[p] && d[p].max)}</b></div>
                ${exceed ? `<div class="warn"><i class="fa-solid fa-triangle-exclamation"></i> Vượt QCVN: ${esc(exceed)}</div>` : ""}
                <div class="obs">${d.observed_hours ? `${d.observed_hours} giờ đã có số liệu · ` : ""}${d.forecast_hours} giờ dự báo</div>
            </div>`;
        }).join("");
    }

    function renderChips() {
        const host = $("air-pollutant-chips");
        host.innerHTML = POLL_ORDER.filter(p => state.data.pollutants[p]).map(p =>
            `<button class="air-chip ${p === state.pollutant ? "active" : ""}" onclick="AirForecast.setPollutant('${p}')">${POLL_NAMES[p]}</button>`).join("");
        const meta = state.data.pollutants[state.pollutant];
        $("air-chart-title").textContent = `${meta.full} (${meta.name}) theo giờ`;
    }

    function rangeRows() {
        const rows = state.data.hourly;
        return rows.slice(0, Math.min(rows.length, state.range));
    }

    function renderChart() {
        const canvas = $("airForecastChart");
        if (!canvas || typeof Chart === "undefined") return;
        const p = state.pollutant;
        const rows = rangeRows();
        const labels = rows.map(r => state.range <= 24 ? r.time.slice(11) : `${r.time.slice(11)} ${r.time.slice(8, 10)}/${r.time.slice(5, 7)}`);
        const obs = rows.map(r => r.observed ? r[p] : null);
        // nối đường dự báo từ điểm quan trắc cuối để không bị đứt
        let lastObs = -1; rows.forEach((r, i) => { if (r.observed) lastObs = i; });
        const fc = rows.map((r, i) => (!r.observed || i === lastObs) ? r[p] : null);
        const aqi = rows.map(r => r[`${std()}_aqi`]);
        const lim = (state.data.pollutants[p].qcvn || {});
        const limit = p === "pm2_5" || p === "pm10" ? lim["24h"] : (lim["1h"] || null);
        const color = COLORS[p];
        if (state.chart) state.chart.destroy();
        const datasets = [
            { label: `${POLL_NAMES[p]} đã có số liệu (${unit(p)})`, data: obs, yAxisID: "y", borderColor: color, backgroundColor: `${color}22`,
              borderWidth: 2.5, fill: true, tension: .35, pointRadius: 0, spanGaps: false },
            { label: `${POLL_NAMES[p]} dự báo`, data: fc, yAxisID: "y", borderColor: color, borderDash: [6, 4], borderWidth: 2.5,
              fill: false, tension: .35, pointRadius: 0 },
            { label: std() === "us" ? "US AQI tổng hợp" : "VN_AQI tổng hợp", data: aqi, yAxisID: "yAQI", borderColor: "#f59e0b",
              borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0, tension: .3 },
        ];
        if (limit) datasets.push({ label: `QCVN ${limit} ${unit(p)} (${p.startsWith("pm") ? "TB 24h" : "TB 1h"})`,
            data: rows.map(() => limit), yAxisID: "y", borderColor: "#dc2626", borderWidth: 1, pointRadius: 0, borderDash: [10, 6] });
        state.chart = new Chart(canvas.getContext("2d"), {
            type: "line", data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
                plugins: { legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 8 } } },
                scales: {
                    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: state.range <= 24 ? 12 : 10 }, grid: { display: false } },
                    y: { position: "left", beginAtZero: true, title: { display: true, text: `${POLL_NAMES[p]} (${unit(p)})` } },
                    yAQI: { position: "right", beginAtZero: true, suggestedMax: 150, grid: { drawOnChartArea: false },
                            title: { display: true, text: std() === "us" ? "US AQI" : "VN_AQI" } },
                },
            },
        });
        // KPI đỉnh trong 7 ngày tới
        const fut = state.data.hourly.filter(r => !r.observed && r[p] !== null && r[p] !== undefined);
        if (fut.length) {
            const peak = fut.reduce((a, b) => (b[p] > a[p] ? b : a));
            $("kpi-air-peak-label").textContent = `Đỉnh ${POLL_NAMES[p]} 7 ngày tới`;
            $("kpi-air-peak").textContent = `${fmt(peak[p])} ${unit(p)}`;
            $("kpi-air-peak-time").textContent = `Lúc ${peak.time.slice(11)} ngày ${peak.time.slice(8, 10)}/${peak.time.slice(5, 7)}`;
        }
        const days = state.data.daily.filter(d => d[`${std()}_aqi`] !== null && d[`${std()}_aqi`] !== undefined);
        if (days.length) {
            const worst = days.reduce((a, b) => (b[`${std()}_aqi`] > a[`${std()}_aqi`] ? b : a));
            $("kpi-air-aqi").textContent = `${worst[`${std()}_aqi`]} (${LEVEL_NAMES[lvlIndex(worst[`${std()}_aqi`]) - 1]})`;
            $("kpi-air-aqi-sub").textContent = `${worst.label} ${worst.date_label} · ${std() === "us" ? "US EPA" : "QĐ 1459/QĐ-TCMT"}`;
        }
    }

    function renderTable() {
        const body = $("air-table-body");
        const rows = rangeRows();
        body.innerHTML = rows.map(r => {
            const aqi = r[`${std()}_aqi`];
            const li = aqi === null || aqi === undefined ? 1 : lvlIndex(aqi);
            const dom = r[`${std()}_dominant`];
            return `<tr>
                <td class="cell-strong">${r.time.slice(8, 10)}/${r.time.slice(5, 7)} ${r.time.slice(11)}</td>
                <td class="center">${r.observed ? '<span class="air-badge-obs">Đã có</span>' : '<span class="air-badge-fc">Dự báo</span>'}</td>
                ${["pm2_5", "pm10", "co", "no2", "so2", "o3"].map(p => `<td class="center">${fmt(r[p], p === "co" ? 0 : 1)}</td>`).join("")}
                <td class="center"><b class="aqi-num t-${li}">${aqi ?? "--"}</b></td>
                <td class="center"><span class="aqi-pill lvl-${li}">${dom ? POLL_NAMES[dom] : "--"}</span></td>
            </tr>`;
        }).join("");
    }

    function renderMonthly() {
        const canvas = $("airMonthlyChart");
        const months = (state.data.monthly && state.data.monthly.months) || [];
        const p = state.pollutant;
        if (!canvas || typeof Chart === "undefined") return;
        if (state.monthly) state.monthly.destroy();
        const rows = months.filter(m => m[p]);
        if (!rows.length) { $("air-month-sub").textContent = "Chưa đủ 12 tháng dữ liệu để ước lượng xu hướng tháng."; return; }
        const bt = (state.data.monthly.backtest || {})[p];
        $("air-month-sub").textContent = `${POLL_NAMES[p]} trung bình tháng, khoảng tin cậy 80%`
            + (bt && bt.available ? ` · kiểm chứng ngược: MAE ${fmt(bt.mae, 2)} (khí hậu thuần ${fmt(bt.mae_climatology, 2)})` : "");
        state.monthly = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: rows.map(m => m.label + (m[p].observed_so_far !== undefined ? " (đang diễn ra)" : "")),
                datasets: [
                    { label: "Khoảng tin cậy 80%", data: rows.map(m => [m[p].lo, m[p].hi]), backgroundColor: `${COLORS[p]}33`,
                      borderColor: COLORS[p], borderWidth: 1, borderSkipped: false, barPercentage: .5 },
                    { type: "line", label: "Ước lượng trung bình tháng", data: rows.map(m => m[p].mean), borderColor: COLORS[p],
                      backgroundColor: COLORS[p], pointRadius: 5, borderWidth: 2 },
                    { type: "line", label: "Khí hậu nhiều năm", data: rows.map(m => m[p].climatology), borderColor: "#94a3b8",
                      borderDash: [5, 4], pointRadius: 3, borderWidth: 1.5 },
                ],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "top", align: "end" } },
                       scales: { y: { beginAtZero: false, title: { display: true, text: unit(p) } } } },
        });
    }

    function renderModel() {
        const d = state.data;
        const p = state.pollutant;
        if (d && d.model && d.model[p]) {
            const m = d.model[p];
            const names = { ml: "Học máy", "ml+cams": "Học máy + CAMS", cams: "CAMS (vật lý)", climatology: "Khí hậu" };
            $("kpi-air-source").textContent = names[m.source] || m.source;
            $("kpi-air-source-sub").textContent = m.model ? `${m.model} · phát hành ${m.t0.slice(11, 16)}` : `Chưa huấn luyện mô hình ${POLL_NAMES[p]}`;
        }
        const met = state.metrics && state.metrics[p];
        if (met) {
            const a = met.metrics.model["1-24h"] || {};
            const b = met.metrics.persistence["1-24h"] || {};
            $("kpi-air-skill").textContent = `${fmt(a.rmse, 2)} ${unit(p)}`;
            $("kpi-air-skill-sub").textContent = `Bền vững: ${fmt(b.rmse, 2)} · R² ${fmt(a.r2, 3)} · ${met.model_name}`;
        } else {
            $("kpi-air-skill").textContent = "--";
            $("kpi-air-skill-sub").textContent = "Chưa có kết quả huấn luyện cho chất này";
        }
    }

    const FEATURE_VI = {
        lag_0: "Nồng độ tại thời điểm phát hành", lag_1: "Trễ 1 giờ", lag_2: "Trễ 2 giờ", lag_3: "Trễ 3 giờ", lag_6: "Trễ 6 giờ",
        lag_12: "Trễ 12 giờ", lag_24: "Trễ 24 giờ", mean_6: "TB trượt 6 giờ", mean_24: "TB trượt 24 giờ", mean_72: "TB trượt 72 giờ",
        mean_168: "TB trượt 7 ngày", std_24: "Độ lệch chuẩn 24 giờ", anom_0: "Dị thường so với khí hậu", horizon: "Hạn dự báo (giờ)",
        clim_T: "Khí hậu tháng × giờ tại thời điểm đích", t_hour_sin: "Giờ trong ngày (sin)", t_hour_cos: "Giờ trong ngày (cos)",
        t_dow: "Thứ trong tuần", t_weekend: "Cuối tuần", t_month_sin: "Tháng (sin)", t_month_cos: "Tháng (cos)",
        t_rainy_season: "Mùa mưa", t_tet: "Dịp Tết Nguyên đán", w_temperature_2m: "Nhiệt độ 2 m", w_dewpoint_2m: "Điểm sương 2 m",
        w_relative_humidity: "Độ ẩm tương đối", w_wind_speed: "Tốc độ gió 10 m", w_precipitation: "Lượng mưa giờ",
        w_surface_pressure: "Áp suất bề mặt", w_u: "Gió thành phần u", w_v: "Gió thành phần v", w_wind_6h: "Gió TB 6 giờ",
        w_rain_24h: "Tổng mưa 24 giờ",
    };

    function renderXAI() {
        const host = $("air-xai-list");
        const met = state.metrics && state.metrics[state.pollutant];
        if (!host) return;
        if (!met || !met.importance) { host.innerHTML = '<p class="air-sub">Chưa có kết quả huấn luyện cho chất này.</p>'; return; }
        $("air-xai-sub").textContent = `${POLL_NAMES[state.pollutant]} · ${met.model_name} · huấn luyện ${met.trained_at.replace("T", " ")}`;
        const palette = ["#0284c7", "#16a34a", "#d97706", "#dc2626", "#7e22ce", "#0d9488", "#475569", "#db2777"];
        host.innerHTML = met.importance.slice(0, 8).map((f, i) => {
            let name = FEATURE_VI[f.feature] || f.feature;
            if (f.feature.startsWith("x_")) name = `Nồng độ ${POLL_NAMES[f.feature.slice(2)] || f.feature.slice(2)} hiện tại`;
            return `<div class="xai-row" style="--w: ${Math.max(f.share, 0.5)}%; --c: ${palette[i % palette.length]};">
                <div class="xai-row-head"><span>${esc(name)}</span><b>${fmt(f.share, 1)}%</b></div>
                <div class="xai-track"><div class="xai-fill"></div></div></div>`;
        }).join("");
    }

    function renderSources() {
        const s = state.sources;
        if (!s) return;
        $("air-target-res").textContent = `Đích đồng nhất: ${s.target_resolution.spatial} · ${s.target_resolution.temporal}`;
        $("air-sources-body").innerHTML = s.sources.map(r => `<tr><td class="cell-strong">${esc(r.name)}</td><td>${esc(r.variables)}</td>`
            + `<td class="nowrap">${esc(r.spatial)}</td><td>${esc(r.temporal)}</td></tr>`).join("");
    }

    function fillWardSelect() {
        const sel = $("air-ward-select");
        if (!sel || sel.options.length > 1) return;
        const wards = (typeof allWardsData !== "undefined" && Array.isArray(allWardsData)) ? allWardsData : [];
        if (!wards.length) return;
        [...wards].sort((a, b) => String(a.ten_phuong_xa).localeCompare(String(b.ten_phuong_xa), "vi"))
            .forEach(w => sel.add(new Option(w.ten_phuong_xa, w.ma_phuong_xa)));
    }

    // ------------------------------------------------------------------ API công khai
    window.AirForecast = {
        load,
        rerender: () => { if (state.data) render(); },
        setPollutant(p) { state.pollutant = p; render(); },
        setRange(h, btn) {
            state.range = h;
            document.querySelectorAll(".air-range").forEach(b => b.classList.toggle("active", b === btn));
            renderChart(); renderTable();
        },
        setWard(code) { state.ward = code || ""; state.lat = state.lng = null; load(true); },
        useMyLocation() {
            const loc = (typeof myLocation !== "undefined") ? myLocation : null;
            if (loc && loc.lat !== undefined) {
                state.ward = ""; state.lat = loc.lat; state.lng = loc.lng; $("air-ward-select").value = ""; load(true); return;
            }
            if (!navigator.geolocation) return;
            navigator.geolocation.getCurrentPosition(pos => {
                state.ward = ""; state.lat = pos.coords.latitude; state.lng = pos.coords.longitude; load(true);
            }, () => alert("Không lấy được vị trí. Hãy chọn phường/xã trong danh sách."), { enableHighAccuracy: true, timeout: 12000 });
        },
    };

    document.addEventListener("DOMContentLoaded", () => {
        const sel = $("air-ward-select");
        if (sel) sel.addEventListener("change", () => window.AirForecast.setWard(sel.value));
        const nav = document.querySelector('.nav-item[data-tab="tab-forecast"]');
        if (nav) nav.addEventListener("click", () => {
            fillWardSelect();
            // Mở tab dự báo -> ưu tiên phường đang chọn trên bản đồ
            if (typeof selectedWardFeature !== "undefined" && selectedWardFeature && typeof wardCodeOf === "function") {
                const code = wardCodeOf(selectedWardFeature);
                if (code && code !== state.ward) { state.ward = code; if (sel) sel.value = code; load(true); return; }
            }
            load(false);
        });
        load(true);
        setInterval(() => { if (document.visibilityState === "visible") load(true); }, 15 * 60 * 1000);
        setTimeout(fillWardSelect, 4000);
    });
})();
