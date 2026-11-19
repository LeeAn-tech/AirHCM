// ==============================================================================
// AIRHCM - TAB PHÂN TÍCH XÁC SUẤT, RỦI RO PHƠI NHIỄM, HOA GIÓ, TRUY VẾT NGUỒN, KỊCH BẢN CAN THIỆP
// API: /api/v1/air/{risk, probability, windrose, trace, scenarios, catalog, qaqc, acceptance}
// Dùng chung biến toàn cục của app.js: API_BASE, escapeHtml; thư viện Leaflet (L) và Chart.js (Chart)
// ==============================================================================
(function () {
    const NAMES = { pm2_5: "PM2.5", pm10: "PM10", co: "CO", no2: "NO2", so2: "SO2", o3: "O3" };
    const TYPE_COLORS = {
        khu_cong_nghiep: "#7c3aed", nha_may_dien: "#111827", cang: "#0369a1", san_bay: "#0891b2", bai_rac: "#92400e",
        diem_chay: "#dc2626", cong_truong: "#a16207", giao_thong: "#ea580c", diem_nong_ve_tinh: "#db2777"
    };
    const P_BINS = [[0.1, "#e0f2fe"], [0.3, "#bae6fd"], [0.5, "#fde68a"], [0.7, "#fb923c"], [0.9, "#ef4444"], [1.01, "#7f1d1d"]];
    const state = {
        inited: false, pane: "risk", ward: "", pollutant: "pm2_5", standard: "qcvn", day: 1,
        geo: null, wards: [], risk: null, prob: null, map: null, layer: null, traceMap: null, traceLayer: null,
        charts: {}, catalog: null, scenCat: null, loaded: {}
    };
    const $ = id => document.getElementById(id);
    const esc = v => (typeof escapeHtml === "function" ? escapeHtml(v) : String(v ?? ""));
    const fmt = (v, nd = 1) => (v === null || v === undefined || Number.isNaN(Number(v))) ? "--"
        : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: nd });
    const pct = (v, nd = 0) => (v === null || v === undefined) ? "--" : `${fmt(v * 100, nd)}%`;
    const base = () => (typeof API_BASE !== "undefined" ? API_BASE : `${location.origin}/api/v1`);
    const qs = obj => {
        const p = new URLSearchParams();
        Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) p.set(k, v); });
        const s = p.toString();
        return s ? `?${s}` : "";
    };
    const pColor = p => (p === null || p === undefined) ? "#e5e7eb" : P_BINS.find(b => p < b[0])[1];

    async function getJSON(path, opts) {
        const res = await fetch(`${base()}${path}`, opts);
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { msg = (await res.json()).detail || msg; } catch (e) { /* bỏ qua */ }
            throw new Error(msg);
        }
        return res.json();
    }
    const postJSON = (path, body) => getJSON(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const emptyRow = (id, cols, msg) => { const el = $(id); if (el) el.innerHTML = `<tr><td colspan="${cols}" class="table-empty">${esc(msg)}</td></tr>`; };

    // ------------------------------------------------------------------ khởi tạo
    function init() {
        if (state.inited) return;
        state.inited = true;
        document.querySelectorAll(".an-subtabs [data-an]").forEach(b => b.addEventListener("click", () => showPane(b.dataset.an)));
        $("an-ward").addEventListener("change", e => { state.ward = e.target.value; reloadForWard(); });
        $("an-pollutant").addEventListener("change", e => { state.pollutant = e.target.value; state.loaded = {}; showPane(state.pane, true); });
        $("an-standard").addEventListener("change", e => { state.standard = e.target.value; state.loaded.risk = false; showPane(state.pane, true); });
        $("an-day").addEventListener("change", e => { state.day = Number(e.target.value); renderRisk(); });
        $("an-rose-run").addEventListener("click", loadRose);
        $("an-trace-run").addEventListener("click", loadTrace);
        $("an-scen-run").addEventListener("click", runScenarios);
        $("an-opt-run").addEventListener("click", runOptimize);
        loadGeo();
    }

    async function loadGeo() {
        try {
            const res = await fetch("assets/data/hcm_wards.json");
            state.geo = await res.json();
            state.wards = state.geo.features.map(f => ({
                code: String(f.properties.ma_xa || f.properties.ma_phuong_xa),
                name: `${f.properties.loai || ""} ${f.properties.ten_xa || f.properties.ten_phuong_xa || ""}`.trim()
            })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
            const sel = $("an-ward");
            if (sel.options.length <= 1) state.wards.forEach(w => sel.add(new Option(w.name, w.code)));
            if (state.risk) renderMap();
        } catch (e) { console.warn("[Phân tích] Không nạp được ranh giới phường:", e); }
    }

    function onShow() {
        init();
        showPane(state.pane);
        setTimeout(() => { if (state.map) state.map.invalidateSize(); if (state.traceMap) state.traceMap.invalidateSize(); }, 200);
    }

    function showPane(name, force = false) {
        state.pane = name;
        document.querySelectorAll(".an-subtabs [data-an]").forEach(b => b.classList.toggle("active", b.dataset.an === name));
        document.querySelectorAll(".an-pane").forEach(p => p.classList.toggle("active", p.id === `an-pane-${name}`));
        if (force) state.loaded[name] = false;
        if (state.loaded[name]) {
            setTimeout(() => { if (state.map) state.map.invalidateSize(); if (state.traceMap) state.traceMap.invalidateSize(); }, 100);
            return;
        }
        state.loaded[name] = true;
        if (name === "risk") { loadRisk(); loadProb(); }
        else if (name === "rose") loadRose();
        else if (name === "trace") loadTrace();
        else if (name === "scen") loadScenCatalog();
        else if (name === "data") loadData();
    }

    function reloadForWard() {
        if (state.pane === "risk") loadProb();
        else if (state.pane === "rose") loadRose();
        else if (state.pane === "trace") loadTrace();
        state.loaded.rose = state.pane === "rose";
        state.loaded.trace = state.pane === "trace";
    }

    function chart(id, cfg) {
        if (state.charts[id]) state.charts[id].destroy();
        const el = $(id);
        if (!el || typeof Chart === "undefined") return null;
        state.charts[id] = new Chart(el.getContext("2d"), cfg);
        return state.charts[id];
    }

    // ------------------------------------------------------------------ XÁC SUẤT & RỦI RO
    async function loadRisk() {
        emptyRow("an-exposure-body", 8, "Đang tính xác suất vượt ngưỡng cho 168 phường...");
        $("an-csv").href = `${base()}/air/risk.csv${qs({ pollutant: state.pollutant, standard: state.standard })}`;
        try {
            state.risk = await getJSON(`/air/risk${qs({ pollutant: state.pollutant, standard: state.standard })}`);
            const sel = $("an-day");
            sel.innerHTML = "";
            state.risk.days.forEach((d, i) => sel.add(new Option(i === 0 ? `Hôm nay ${d.slice(8, 10)}/${d.slice(5, 7)}` : `+${i} ngày (${d.slice(8, 10)}/${d.slice(5, 7)})`, i)));
            state.day = Math.min(state.day, state.risk.days.length - 1);
            sel.value = state.day;
            renderRisk();
        } catch (e) {
            state.risk = null;
            emptyRow("an-exposure-body", 8, `Chưa tính được rủi ro: ${e.message}`);
            $("an-risk-cards").innerHTML = "";
            $("an-map-sub").textContent = e.message;
        }
    }

    function renderRisk() {
        const r = state.risk;
        if (!r) return;
        const c = r.city[state.day] || r.city[0];
        const unit = r.unit;
        $("an-map-title").textContent = `P(${NAMES[r.pollutant]} ${r.period === "8h" ? "TB 8h cực đại" : "TB 24h"} > ${fmt(r.threshold, 0)} ${unit}) - ${r.standard.toUpperCase()}`;
        $("an-map-sub").textContent = `Ngày ${c.date} · phát hành từ số liệu đến ${r.issued_t0} · bấm phường để xem chi tiết`;
        $("an-risk-cards").innerHTML = [
            ["Ngưỡng so sánh", `${fmt(r.threshold, 0)} ${unit}`, `${r.standard === "qcvn" ? "QCVN 05:2023" : "WHO AQG 2021"} · ${r.period === "8h" ? "TB 8 giờ" : "TB 24 giờ"}`],
            ["E[N_T] người phơi nhiễm", fmt(c.people_exceed_expected, 0), `KTC 90%: ${fmt(c.people_exceed_q05, 0)} - ${fmt(c.people_exceed_q95, 0)}`],
            ["N_T theo trung vị", fmt(c.people_exceed_q50, 0), `/ ${fmt(r.population_total, 0)} dân`],
            ["Diện tích vượt A_T", `${fmt(c.area_exceed_km2, 1)} km²`, `${c.wards_p_over_50} phường có P > 50%`],
            ["Phơi nhiễm PWE", `${fmt(c.pwe, 1)}`, `${unit} (trọng số dân số)`],
        ].map(([k, v, s]) => `<div class="an-card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join("");
        $("an-exposure-body").innerHTML = r.city.map(x => `<tr${x.lead_day === state.day ? ' style="background:rgba(2,132,199,.06)"' : ""}>
            <td><b>${esc(x.date)}</b></td><td>${pct(x.forecast_share)}</td><td>${fmt(x.area_exceed_km2, 1)}</td>
            <td>${fmt(x.people_exceed_q50, 0)}</td><td><b>${fmt(x.people_exceed_expected, 0)}</b></td>
            <td>${fmt(x.people_exceed_q05, 0)} - ${fmt(x.people_exceed_q95, 0)}</td><td>${fmt(x.pwe, 1)}</td><td>${x.wards_p_over_50}</td></tr>`).join("");
        $("an-risk-notes").textContent = `${r.method} ${(r.notes || []).join(" ")}`;
        renderMap();
    }

    function renderMap() {
        const r = state.risk;
        if (!r || !state.geo || typeof L === "undefined") return;
        if (!state.map) {
            state.map = L.map("an-map", { zoomControl: true, attributionControl: true }).setView([10.78, 106.72], 9);
            L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
                { attribution: "&copy; Esri &copy; HCMUNRE", maxZoom: 16 }).addTo(state.map);
        }
        const byCode = {};
        r.wards.forEach(w => { byCode[String(w.ma_phuong_xa)] = w; });
        if (state.layer) state.map.removeLayer(state.layer);
        state.layer = L.geoJSON(state.geo, {
            style: f => {
                const w = byCode[String(f.properties.ma_xa || f.properties.ma_phuong_xa)];
                const d = w ? w.days[state.day] : null;
                return { color: "#475569", weight: 0.5, fillOpacity: 0.72, fillColor: pColor(d ? d.p : null) };
            },
            onEachFeature: (f, layer) => {
                const code = String(f.properties.ma_xa || f.properties.ma_phuong_xa);
                const w = byCode[code];
                const d = w ? w.days[state.day] : null;
                layer.bindTooltip(`<b>${esc(f.properties.loai || "")} ${esc(f.properties.ten_xa || "")}</b><br>`
                    + (d ? `P(vượt) = <b>${pct(d.p)}</b><br>q50 ${fmt(d.q50)} [${fmt(d.q05)} - ${fmt(d.q95)}] ${esc(r.unit)}<br>`
                        + `Dân số ${fmt(w.dan_so, 0)} · kỳ vọng phơi nhiễm ${fmt(d.expected_exposed, 0)}`
                        + (d.p_next_day_too !== null ? `<br>P(vượt cả ngày sau) = ${pct(d.p_next_day_too)}` : "") : "Không có dữ liệu"),
                    { sticky: true });
                layer.on("click", () => { state.ward = code; $("an-ward").value = code; loadProb(); });
            }
        }).addTo(state.map);
        $("an-legend").innerHTML = "P(vượt): " + P_BINS.map((b, i) => `<i style="background:${b[1]}"></i>${i === 0 ? "&lt;10%" : `${Math.round(P_BINS[i - 1][0] * 100)}-${Math.min(100, Math.round(b[0] * 100))}%`}`).join(" ");
        setTimeout(() => state.map.invalidateSize(), 120);
    }

    async function loadProb() {
        try {
            const p = await getJSON(`/air/probability${qs({ ward_code: state.ward, pollutant: state.pollutant, standard: state.standard })}`);
            state.prob = p;
            $("an-prob-title").textContent = `${NAMES[p.pollutant]} - ${p.location.ten_phuong_xa}`;
            $("an-prob-sub").textContent = `Đường: q50 · vùng tô: khoảng dự báo 90% (q05-q95) · cột: P(${p.day_period === "8h" ? "TB 8h max" : "TB 24h"} > ${fmt(p.threshold_day, 0)})`;
            const H = p.hourly;
            chart("an-prob-chart", {
                type: "line",
                data: {
                    labels: H.map(h => h.time.slice(5, 13).replace(" ", " ") + "h"),
                    datasets: [
                        { label: "q95", data: H.map(h => h.q95), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: "rgba(2,132,199,.15)" },
                        { label: "q05", data: H.map(h => h.q05), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: "rgba(2,132,199,.18)" },
                        { label: "q50", data: H.map(h => h.q50), borderColor: "#0284c7", borderWidth: 2, pointRadius: 0, fill: false,
                          segment: { borderDash: ctx => (H[ctx.p1DataIndex] && !H[ctx.p1DataIndex].observed ? [5, 4] : undefined) } },
                        ...(p.threshold_hour ? [{ label: `Ngưỡng 1h ${p.threshold_hour}`, data: H.map(() => p.threshold_hour), borderColor: "#dc2626", borderWidth: 1, pointRadius: 0, borderDash: [3, 3] }] : [])
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
                    plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 9 } }, y: { title: { display: true, text: p.unit } } } }
            });
            chart("an-pday-chart", {
                type: "bar",
                data: { labels: p.daily.map(d => d.date.slice(8, 10) + "/" + d.date.slice(5, 7)),
                    datasets: [{ label: "P(vượt ngưỡng ngày)", data: p.daily.map(d => d.p_exceed === undefined ? null : d.p_exceed * 100),
                        backgroundColor: p.daily.map(d => pColor(d.p_exceed)), borderColor: "#64748b", borderWidth: 0.5 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
                    tooltip: { callbacks: { afterLabel: c => { const d = p.daily[c.dataIndex]; return `q50 ${fmt(d.q50)} [${fmt(d.q05)}-${fmt(d.q95)}]` + (d.p_exceed_today_and_next !== undefined ? ` · P(2 ngày liên tục) ${pct(d.p_exceed_today_and_next)}` : ""); } } } },
                    scales: { y: { min: 0, max: 100, title: { display: true, text: "%" } } } }
            });
            const cal = p.calibration && p.calibration.daily && p.calibration.daily["1"];
            $("an-prob-method").textContent = p.method + (cal ? ` Kiểm chứng độc lập (ngày thứ 2): PICP90 = ${pct(cal.picp90)}${cal.brier_who !== undefined ? `, Brier WHO = ${fmt(cal.brier_who, 3)}` : ""}.` : "");
        } catch (e) {
            $("an-prob-method").textContent = `Chưa có dự báo xác suất: ${e.message}`;
        }
    }

    // ------------------------------------------------------------------ HOA GIÓ (SVG)
    function polar(cx, cy, r, deg) {
        const a = (deg * Math.PI) / 180;
        return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    }
    function wedge(cx, cy, r0, r1, a0, a1) {
        const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1);
        const [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
        return `M${x3},${y3} L${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
    }
    function drawRose(el, sectors, stacks, colors, unit, labels) {
        const S = 340, cx = S / 2, cy = S / 2 + 4, R = 132, n = sectors.length, w = 360 / n * 0.86;
        const tot = sectors.map((s, i) => stacks.reduce((a, st) => a + (st[i] || 0), 0));
        const mx = Math.max(...tot, 1e-9);
        const nice = mx <= 1 ? 1 : mx <= 5 ? 5 : mx <= 10 ? 10 : mx <= 20 ? 20 : mx <= 40 ? 40 : Math.ceil(mx / 20) * 20;
        let svg = `<svg viewBox="0 0 ${S} ${S + 10}" width="${S}" xmlns="http://www.w3.org/2000/svg" font-family="inherit">`;
        for (let g = 1; g <= 4; g++) {
            const r = (R * g) / 4;
            svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0"/>`;
            svg += `<text x="${cx + 3}" y="${cy - r + 11}" font-size="9" fill="#94a3b8">${fmt((nice * g) / 4, 1)}${unit}</text>`;
        }
        sectors.forEach((s, i) => {
            let r0 = 0;
            stacks.forEach((st, j) => {
                const v = st[i] || 0;
                if (v <= 0) return;
                const r1 = r0 + (R * v) / nice;
                svg += `<path d="${wedge(cx, cy, r0, r1, s.center_deg - w / 2, s.center_deg + w / 2)}" fill="${typeof colors[j] === "function" ? colors[j](s) : colors[j]}" stroke="#fff" stroke-width="0.6"><title>${esc(s.name)}: ${fmt(v, 2)}${unit}</title></path>`;
                r0 = r1;
            });
            const [tx, ty] = polar(cx, cy, R + 12, s.center_deg);
            svg += `<text x="${tx}" y="${ty + 4}" font-size="${n > 8 ? 9 : 11}" font-weight="700" text-anchor="middle" fill="#334155">${esc(s.name)}</text>`;
        });
        if (labels) svg += `<g font-size="9.5" fill="#475569">${labels.map((l, j) => `<rect x="6" y="${S - 4 - 13 * (labels.length - j)}" width="10" height="9" fill="${colors[j]}"/><text x="20" y="${S + 4 - 13 * (labels.length - j)}">${esc(l)}</text>`).join("")}</g>`;
        el.innerHTML = svg + "</svg>";
    }

    async function loadRose() {
        $("an-rose-body").innerHTML = `<tr><td colspan="8" class="table-empty">Đang tính hoa gió...</td></tr>`;
        try {
            const r = await getJSON(`/air/windrose${qs({ ward_code: state.ward, pollutant: state.pollutant, days: $("an-rose-days").value,
                sectors: $("an-rose-sectors").value, threshold: $("an-rose-T").value })}`);
            const speedColors = ["#bae6fd", "#38bdf8", "#0284c7", "#1e3a8a", "#0b1b4d"];
            drawRose($("an-rose-wind"), r.sectors, r.speed_classes.map((_, j) => r.sectors.map(s => s.by_speed_pct[j])), speedColors, "%", r.speed_classes);
            drawRose($("an-rose-poll"), r.sectors, [r.sectors.map(s => (s.p_exceed || 0) * 100)], [s => (s.low_count ? "#cbd5e1" : "#dc2626")], "%");
            $("an-rose-ptitle").textContent = `Hoa gió ô nhiễm P(${NAMES[r.pollutant]} > ${fmt(r.threshold, 0)} µg/m³ | hướng) - xám: ít mẫu`;
            const sens = (r.sensitivity || []).map(x => `${x.calm_ws} m/s: lặng ${fmt(x.calm_pct, 1)}%, hướng ô nhiễm ${x.dominant_pollution_sector || "--"}`).join(" · ");
            $("an-rose-kpis").innerHTML = [
                ["Số giờ", fmt(r.n_total, 0), `${esc(r.location.ten_phuong_xa)} · ${r.days} ngày`],
                ["Lặng gió (< " + r.calm_threshold + " m/s)", `${fmt(r.calm.freq_pct, 1)}%`, `C̄ = ${fmt(r.calm.mean)} · P = ${pct(r.calm.p_exceed, 1)}`],
                ["Hướng gió trội", r.dominant_wind_sector ? r.dominant_wind_sector.name : "--", r.dominant_wind_sector ? `F = ${fmt(r.dominant_wind_sector.freq_pct, 1)}%` : ""],
                ["Hướng ô nhiễm trội", r.dominant_pollution_sector ? r.dominant_pollution_sector.name : "--", r.dominant_pollution_sector ? `P = ${pct(r.dominant_pollution_sector.p_exceed, 1)} (n=${r.dominant_pollution_sector.n})` : "chưa đủ mẫu"],
                ["P(vượt T) chung", pct(r.overall_p_exceed, 1), `C̄ toàn kỳ ${fmt(r.overall_mean)} µg/m³`],
            ].map(([k, v, s]) => `<div class="an-card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${s}</div></div>`).join("");
            $("an-rose-body").innerHTML = r.sectors.map(s => `<tr><td><b>${esc(s.name)}</b> (${fmt(s.center_deg, 1)}°)</td><td>${s.n}</td><td>${fmt(s.freq_pct, 2)}</td>
                <td>${fmt(s.mean)}</td><td>${fmt(s.median)}</td><td>${fmt(s.p90)}</td><td><b>${pct(s.p_exceed, 1)}</b></td>
                <td>${s.low_count ? '<span class="an-status-part">ít mẫu - không kết luận</span>' : ""}</td></tr>`).join("")
                + (r.by_speed_class || []).map(c => `<tr style="color:#64748b"><td>Lớp ${esc(c.class)}</td><td>${c.n}</td><td></td><td>${fmt(c.mean)}</td><td></td><td></td><td>${pct(c.p_exceed, 1)}</td><td>theo tốc độ gió</td></tr>`).join("");
            $("an-rose-note").textContent = `${r.note} Độ nhạy ngưỡng lặng gió: ${sens}.`;
        } catch (e) {
            emptyRow("an-rose-body", 8, `Chưa tính được hoa gió: ${e.message}`);
        }
    }

    // ------------------------------------------------------------------ TRUY VẾT NGUỒN
    async function loadTrace() {
        emptyRow("an-suspects-body", 11, "Đang phân tích (dấu hiệu, hoa gió, quỹ đạo ngược, điểm nghi vấn)...");
        try {
            const t = await getJSON(`/air/trace${qs({ ward_code: state.ward, pollutant: state.pollutant, days: $("an-trace-days").value,
                event_date: $("an-trace-event").value })}`);
            const evSel = $("an-trace-event");
            const cur = evSel.value;
            evSel.innerHTML = '<option value="">Sự kiện ô nhiễm nhất</option>' + (t.events || []).map(e =>
                `<option value="${e.date}">${e.date} · TB24h ${fmt(e.mean24)} (> ${fmt(e.threshold, 0)})</option>`).join("");
            evSel.value = cur;
            $("an-trace-sub").textContent = `${t.location.ten_phuong_xa} · sự kiện ${t.event_date} · ${t.conclusion_rule}`;
            $("an-ladder").innerHTML = t.evidence_ladder.map(l => `<div class="an-step ${l.done ? "done" : "todo"}">
                <div class="lv">${l.level}</div><div class="nm">${esc(l.name)}</div><div class="md">${esc(l.method)}</div>
                <div class="cc">${esc(l.can_conclude)}</div><div class="st ${l.done ? "an-status-ok" : "an-status-no"}">${l.done ? "✓ Đã thực hiện" : "✗ " + esc(l.data)}</div></div>`).join("");
            const sig = t.signals || {};
            const bg = t.regional_background || {};
            $("an-signals").innerHTML = (sig.findings || []).map(f => `<div class="an-sig"><b>${esc(f.signal)}</b><br>${esc(f.interpretation)}</div>`).join("")
                + (sig.ratios ? `<p>Tỷ lệ trung vị: ${Object.entries(sig.ratios).map(([k, v]) => `${esc(k)} = ${fmt(v, 2)}`).join(" · ")}</p>` : "")
                + (bg.background_p10 !== undefined ? `<div class="an-sig" style="border-color:#f59e0b"><b>Nền liên vùng (ngày ${esc(t.event_date)})</b><br>`
                    + `Nền ≈ P10 của 168 phường = ${fmt(bg.background_p10)} µg/m³; TB TP = ${fmt(bg.city_mean)}; phần tăng đô thị ≈ ${pct(bg.urban_increment_share)} (chỉ định hướng).</div>` : "")
                + `<p class="an-note" style="margin:6px 0">${esc(sig.caveat || "")}</p>`;
            const S = t.suspects || {};
            const rows = S.sources || [];
            $("an-suspects-body").innerHTML = rows.length ? rows.slice(0, 25).map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.ten)}</b></td>
                <td><span class="an-pill" style="background:${TYPE_COLORS[s.loai] || "#64748b"}22;color:${TYPE_COLORS[s.loai] || "#334155"}">${esc(s.loai_label)}</span></td>
                <td>${fmt(s.distance_km)} km</td><td>${fmt(s.components.wind_alignment, 2)}</td><td>${fmt(s.components.distance_decay, 2)}</td>
                <td>${fmt(s.components.emission_activity, 2)}</td><td>${fmt(s.components.chemical_marker, 2)}</td><td>${fmt(s.components.trajectory_support, 2)}</td>
                <td><b>${fmt(s.score, 3)}</b></td><td>${pct(s.p_in_top)}</td></tr>`).join("")
                : `<tr><td colspan="11" class="table-empty">${esc(S.note || "Chưa có ứng viên nguồn.")}</td></tr>`;
            $("an-suspects-note").textContent = rows.length ? `${S.caveat} Trọng số: ${Object.entries(S.weights).map(([k, v]) => `${k} ${v}`).join(", ")}. `
                + `Độ nhạy: ${S.sensitivity.method}, tương quan hạng TB ${S.sensitivity.rank_spearman_mean}.`
                + (S.chemical_marker_is_proxy ? " Thành phần marker đang là mức phù hợp loại nguồn - chất (proxy) do chưa có số liệu hóa học." : "") : "";
            renderTraceMap(t);
        } catch (e) {
            emptyRow("an-suspects-body", 11, `Chưa phân tích được: ${e.message}`);
        }
    }

    function renderTraceMap(t) {
        if (typeof L === "undefined") return;
        if (!state.traceMap) {
            state.traceMap = L.map("an-trace-map").setView([t.location.lat, t.location.lng], 9);
            L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
                { attribution: "&copy; Esri &copy; OpenStreetMap contributors (nguồn ứng viên)", maxZoom: 16 }).addTo(state.traceMap);
        }
        if (state.traceLayer) state.traceMap.removeLayer(state.traceLayer);
        const g = L.layerGroup();
        const colors = ["#0ea5e9", "#22c55e", "#a855f7", "#f97316", "#ef4444", "#14b8a6", "#eab308", "#6366f1"];
        (t.trajectories || []).forEach((tr, i) => {
            L.polyline(tr.map(p => [p.lat, p.lon]), { color: colors[i % colors.length], weight: 2, opacity: 0.85 })
                .bindTooltip(`Quỹ đạo kết thúc ${esc(tr[0].t)} (lùi ${tr.length - 1} giờ)`).addTo(g);
            const last = tr[tr.length - 1];
            L.circleMarker([last.lat, last.lon], { radius: 3, color: colors[i % colors.length] }).addTo(g);
        });
        const mx = Math.max(...((t.suspects && t.suspects.sources) || []).map(s => s.score), 0.01);
        ((t.suspects && t.suspects.sources) || []).forEach(s => {
            L.circleMarker([s.lat, s.lon], { radius: 4 + 10 * s.score / mx, color: "#fff", weight: 1, fillColor: TYPE_COLORS[s.loai] || "#64748b", fillOpacity: 0.9 })
                .bindPopup(`<b>${esc(s.ten)}</b><br>${esc(s.loai_label)} · ${fmt(s.distance_km)} km<br>Điểm nghi vấn <b>${fmt(s.score, 3)}</b> (hạng ${s.rank})<br>P(top-5) = ${pct(s.p_in_top)}`).addTo(g);
        });
        L.marker([t.location.lat, t.location.lng]).bindTooltip(`Điểm tiếp nhận: ${esc(t.location.ten_phuong_xa)}`, { permanent: false }).addTo(g);
        state.traceLayer = g.addTo(state.traceMap);
        const pts = [[t.location.lat, t.location.lng]];
        (t.trajectories || []).forEach(tr => tr.forEach(p => pts.push([p.lat, p.lon])));
        if (pts.length > 1) state.traceMap.fitBounds(L.latLngBounds(pts).pad(0.15));
        setTimeout(() => state.traceMap.invalidateSize(), 120);
    }

    // ------------------------------------------------------------------ KỊCH BẢN
    async function loadScenCatalog() {
        try {
            state.scenCat = await getJSON("/air/scenarios");
            const c = state.scenCat;
            $("an-scen-note").textContent = c.note;
            $("an-measures-body").innerHTML = c.measures.map(m => `<tr data-id="${m.id}">
                <td><input type="checkbox" class="an-s4"></td><td><b>${m.id}</b></td><td>${esc(m.name)}</td><td>${esc(c.sectors[m.sector] || m.sector)}</td>
                <td><input class="an-in an-r" type="number" min="0" max="1" step="0.05" value="${m.reduction}"></td>
                <td><input class="an-in an-e" type="number" min="0" max="1" step="0.05" value="${m.efficiency}"></td>
                <td><input class="an-in an-c" type="number" min="0" step="0.5" value="${m.cost}"></td>
                <td>${m.scope === "noi_do" ? "Phường nội đô" : "Toàn TP"}</td></tr>`).join("");
        } catch (e) {
            $("an-measures-body").innerHTML = `<tr><td colspan="8" class="table-empty">${esc(e.message)}</td></tr>`;
        }
    }

    function overrides() {
        return [...document.querySelectorAll("#an-measures-body tr[data-id]")].map(tr => ({
            id: tr.dataset.id, reduction: Number(tr.querySelector(".an-r").value), efficiency: Number(tr.querySelector(".an-e").value),
            cost: Number(tr.querySelector(".an-c").value)
        }));
    }

    async function runScenarios() {
        if (!state.scenCat) await loadScenCatalog();
        emptyRow("an-scen-body", 10, "Đang đánh giá kịch bản...");
        const sc = JSON.parse(JSON.stringify(state.scenCat.scenarios));
        const s4 = [...document.querySelectorAll("#an-measures-body tr[data-id]")].filter(tr => tr.querySelector(".an-s4").checked).map(tr => tr.dataset.id);
        if (s4.length) sc.S4 = { name: `S4: Tùy chọn (${s4.join(", ")})`, measures: s4 };
        const y0 = $("an-scen-y0").value;
        try {
            const r = await postJSON("/air/scenarios/evaluate", { pollutant: state.pollutant, mode: $("an-scen-mode").value, scenarios: sc,
                overrides: overrides(), baseline_mortality_per_1000: y0 ? Number(y0) : null });
            $("an-scen-sub").textContent = `${NAMES[r.pollutant]} · đường cơ sở ${r.mode === "past" ? `${r.days} ngày đã qua` : "hôm nay + 7 ngày"} · ${r.n_wards} phường × ${r.n_hours} giờ · ngưỡng người-giờ T = ${fmt(r.threshold, 0)} µg/m³`;
            $("an-scen-body").innerHTML = r.scenarios.map(s => `<tr><td><b>${esc(s.name)}</b><br><small>${esc((s.measures || []).join(", "))}</small></td>
                <td>${fmt(s.cost)}</td><td>${fmt(s.pwe_base, 2)}</td><td>${fmt(s.pwe_scenario, 2)}</td><td>${fmt(s.delta_pwe, 2)}</td><td><b>${fmt(s.reduction_pct, 2)}%</b></td>
                <td>${fmt(s.pop_benefit, 0)}</td><td>${fmt(s.person_hours_avoided, 0)} (${fmt(s.person_hours_avoided_pct, 1)}%)</td>
                <td>${s.health ? fmt(s.health.risk_reduction_pct_pwe, 2) + "%" : "--"}</td><td>${s.health && s.health.avoided_deaths_per_year !== undefined ? fmt(s.health.avoided_deaths_per_year, 1) : "--"}</td></tr>`).join("");
            $("an-scen-add").textContent = `${r.additivity_note || ""} ${r.pollutant === "pm2_5" ? "Sức khỏe: RR = 1,08/10 µg/m³ PM2.5 (Chen & Hoek 2020, WHO 2021) - chỉ đúng cho phơi nhiễm dài hạn (*giả định mức giảm ΔC duy trì cả năm); ca tử vong cần tỷ suất chết thô y0 do người dùng nhập từ niên giám thống kê." : ""}`;
        } catch (e) {
            emptyRow("an-scen-body", 10, `Chưa đánh giá được: ${e.message}`);
        }
    }

    async function runOptimize() {
        if (!state.scenCat) await loadScenCatalog();
        $("an-opt-best").innerHTML = "Đang duyệt các tổ hợp biện pháp...";
        try {
            const r = await postJSON("/air/scenarios/optimize", { pollutant: state.pollutant, budget: Number($("an-opt-budget").value),
                equity_min_pct: Number($("an-opt-equity").value), mode: $("an-scen-mode").value, overrides: overrides() });
            const b = r.best;
            $("an-opt-best").innerHTML = b ? `<p><b>Tổ hợp tối ưu</b> (ngân sách ${fmt(r.budget)}, nhóm phơi nhiễm cao giảm ≥ ${fmt(r.equity_min_pct)}%):</p>
                ${b.measure_names.map((n, i) => `<span class="tag">${esc(b.measures[i])} · ${esc(n)}</span>`).join("")}
                <p>Chi phí ${fmt(b.cost)} · giảm phơi nhiễm PWE <b>${fmt(b.reduction_pct, 2)}%</b> · nhóm dễ tổn thương giảm ${fmt(b.vulnerable_reduction_pct, 2)}%`
                + (b.person_hours_avoided !== undefined ? ` · tránh ${fmt(b.person_hours_avoided, 0)} người-giờ vượt ngưỡng` : "") + `</p>
                <p class="an-note" style="margin:6px 0">${r.n_feasible}/${r.n_combinations} tổ hợp thỏa ràng buộc; ${esc(r.vulnerable_definition)}. ${esc(r.note)}</p>`
                : `<p>Không có tổ hợp thỏa ngân sách và ràng buộc công bằng (${r.n_combinations} tổ hợp đã duyệt).</p>`;
            chart("an-pareto-chart", {
                type: "scatter",
                data: { datasets: [
                    { label: "Biên Pareto", data: r.pareto.map(x => ({ x: x.cost, y: x.reduction_pct, m: x.measures.join("+") || "S0" })), showLine: true, borderColor: "#0284c7", backgroundColor: "#0284c7" },
                    ...(b ? [{ label: "Tối ưu", data: [{ x: b.cost, y: b.reduction_pct, m: b.measures.join("+") }], pointRadius: 9, pointStyle: "rectRot", backgroundColor: "#dc2626" }] : [])
                ] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.raw.m}: chi phí ${c.raw.x}, giảm ${fmt(c.raw.y, 2)}%` } } },
                    scales: { x: { title: { display: true, text: "Chi phí (đơn vị tương đối)" } }, y: { title: { display: true, text: "Giảm PWE (%)" } } } }
            });
        } catch (e) {
            $("an-opt-best").textContent = `Chưa tối ưu được: ${e.message}`;
        }
    }

    // ------------------------------------------------------------------ DỮ LIỆU, NGƯỠNG, QA/QC, NGHIỆM THU
    async function loadData() {
        getJSON("/air/catalog").then(c => {
            $("an-thr-body").innerHTML = c.thresholds.map(t => `<tr><td><b>${esc(t.name)}</b><br><small>${esc(t.full)}</small></td>
                <td>${t.qcvn.map(x => `${esc(x.label)}: <b>${fmt(x.value, 0)}</b> ${esc(x.unit)}`).join("<br>") || "--"}</td>
                <td>${t.who.map(x => `${esc(x.label)}: <b>${fmt(x.value, 0)}</b> ${esc(x.unit)}`).join("<br>") || "--"}</td></tr>`).join("");
            $("an-unit-notes").innerHTML = c.unit_notes.map(n => `<li>${esc(n)}</li>`).join("");
            $("an-cat-body").innerHTML = c.catalog.map(r => {
                const cls = r.status.startsWith("đang") ? "an-status-ok" : r.status.startsWith("bổ sung") || r.status.startsWith("thay") ? "an-status-part" : "an-status-no";
                return `<tr><td><b>${esc(r.source)}</b></td><td>${esc(r.variables)}</td><td>${esc(r.frequency)}</td><td class="${cls}">${esc(r.status)}</td><td><small>${esc(r.note)}</small></td></tr>`;
            }).join("");
        }).catch(e => emptyRow("an-thr-body", 3, e.message));
        getJSON("/air/qaqc?days=30").then(q => {
            $("an-qa-sub").textContent = `${q.period ? q.period.join(" → ") : ""} · TB 24h hợp lệ khi ≥ ${q.rules.min_hours_24h}/24 giờ · spike: ${q.rules.spike} (chỉ gắn cờ) · nghiệm thu: ${q.acceptance ? (q.acceptance.pass ? "ĐẠT" : "CHƯA ĐẠT") : "--"}`;
            $("an-qa-body").innerHTML = Object.entries(q.city || {}).map(([k, r]) => `<tr><td><b>${esc(NAMES[k] || k)}</b></td>
                <td class="${r.pass_completeness ? "an-status-ok" : "an-status-no"}">${pct(r.completeness, 1)}</td><td>${r.missing_hours}</td><td>${r.longest_gap_h} h</td>
                <td>${r.negative}</td><td>${r.spikes}</td><td>${r.flat_hours}</td><td>${r.valid_24h_days}/${r.days}</td></tr>`).join("");
            $("an-qa-flags").textContent = q.provenance_flags ? "Cờ nguồn gốc dữ liệu phường (tỷ lệ giờ): " + q.provenance_flags.map(f => `${f.label} ${pct(f.share, 1)}`).join(" · ") : "";
        }).catch(e => emptyRow("an-qa-body", 8, e.message));
        getJSON("/air/acceptance").then(a => {
            $("an-acc-body").innerHTML = a.criteria.map(c => {
                const cls = c.status === "đạt" ? "an-status-ok" : c.status.includes("một phần") ? "an-status-part" : "an-status-no";
                return `<tr><td><b>${esc(c.group)}</b></td><td>${esc(c.requirement)}</td><td class="${cls}">${esc(c.status)}</td><td><small>${esc(c.evidence)}</small></td></tr>`;
            }).join("");
        }).catch(e => emptyRow("an-acc-body", 4, e.message));
    }

    window.AirAnalysis = { onShow, loadRisk, loadProb, loadRose, loadTrace, runScenarios, runOptimize };
    document.addEventListener("DOMContentLoaded", () => {
        if (location.hash === "#analysis") setTimeout(onShow, 300);
    });
})();
