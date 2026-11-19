// ==============================================================================
// BẢN ĐỒ 3D DIỄN BIẾN CHẤT LƯỢNG KHÔNG KHÍ THEO KHÔNG GIAN - THỜI GIAN
//  - Không gian: 168 phường/xã (GeoJSON) dựng thành khối nổi (MapLibre GL fill-extrusion)
//  - Chiều cao khối = nồng độ chất ô nhiễm; màu = mức tương đối hoặc mức AQI
//  - Thời gian: chuỗi giờ quan trắc + dự báo AI (API /api/v1/air/spatial-series), phát hoạt cảnh
//    có nội suy mượt giữa hai giờ liên tiếp
// ==============================================================================
(function () {
    "use strict";

    const ML_VERSION = "4.7.1";
    const API = (typeof API_BASE !== "undefined") ? API_BASE : `${location.origin}/api/v1`;
    const HEIGHT_MAX_M = 9000;            // Chiều cao (m) của khối có nồng độ cao nhất
    const FRAMES_PER_SECOND = 1.6;        // Tốc độ phát ở mức 1x
    const RANGES = {
        "24-72": { back: 24, ahead: 72, step: 1, label: "24 giờ qua → 3 ngày tới" },
        "0-168": { back: 0, ahead: 168, step: 2, label: "Hôm nay → 7 ngày tới (dự báo)" },
        "168-0": { back: 168, ahead: 0, step: 2, label: "7 ngày qua (quan trắc)" },
        "720-0": { back: 720, ahead: 0, step: 6, label: "30 ngày qua (quan trắc)" },
    };
    // Thang màu tương đối (xanh -> vàng -> cam -> đỏ) giống bản đồ mẫu: làm nổi khác biệt giữa các phường
    const REL_STOPS = ["#1a9641", "#73c255", "#c4e687", "#ffffbf", "#fdc980", "#f07c4a", "#d7191c"];
    // Màu mức AQI chuẩn (QĐ 1459/QĐ-TCMT và US EPA dùng cùng bảng màu)
    const AQI_LEVELS = [
        [50, "#00e400", "Tốt"], [100, "#ffff00", "Trung bình"], [150, "#ff7e00", "Kém"],
        [200, "#ff0000", "Xấu"], [300, "#8f3f97", "Rất xấu"], [Infinity, "#7e0023", "Nguy hại"],
    ];
    const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

    const st = {
        map: null, mapReady: false, mlPromise: null, wardsReady: false,
        data: null, frame: 0, playing: false, speed: 1, rotate: false,
        pollutant: "pm2_5", range: "24-72", colorMode: "rel",
        raf: 0, lastTs: 0, lastHudFrame: -1, loadSeq: 0, popup: null, hoverCode: null,
    };
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? "--" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: d });
    const useUS = () => (typeof currentAQIStandard !== "undefined" && currentAQIStandard === "US");

    // ------------------------------------------------------------------ thư viện MapLibre (nạp khi mở tab)
    function loadMapLibre() {
        if (window.maplibregl) return Promise.resolve();
        if (st.mlPromise) return st.mlPromise;
        st.mlPromise = new Promise((resolve, reject) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = `https://unpkg.com/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.css`;
            document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = `https://unpkg.com/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.js`;
            js.onload = () => resolve();
            js.onerror = () => { st.mlPromise = null; reject(new Error("Không tải được thư viện bản đồ 3D (MapLibre GL).")); };
            document.head.appendChild(js);
        });
        return st.mlPromise;
    }

    // ------------------------------------------------------------------ màu sắc
    function hexToRgb(h) {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const REL_RGB = REL_STOPS.map(hexToRgb);
    function relColor(t) {
        if (!isFinite(t)) return "#cbd5e1";
        t = Math.min(Math.max(t, 0), 1) * (REL_RGB.length - 1);
        const i = Math.min(Math.floor(t), REL_RGB.length - 2), f = t - i;
        const a = REL_RGB[i], b = REL_RGB[i + 1];
        const c = a.map((x, k) => Math.round(x + (b[k] - x) * f));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
    function aqiLevel(aqi) {
        if (aqi == null || !isFinite(aqi)) return { color: "#cbd5e1", name: "Không có dữ liệu" };
        const lv = AQI_LEVELS.find(l => aqi <= l[0]);
        return { color: lv[1], name: lv[2] };
    }

    // ------------------------------------------------------------------ khởi tạo bản đồ
    function initMap() {
        st.map = new maplibregl.Map({
            container: "map3d",
            style: {
                version: 8,
                sources: {
                    // Bản đồ nền Esri (cùng nhà cung cấp với bản đồ 2D, không cần API key)
                    base: {
                        type: "raster", tileSize: 256, maxzoom: 19,
                        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"],
                        attribution: "© Esri, HERE, Garmin, OpenStreetMap · Dữ liệu: AirHCM (CAMS, Sentinel-5P, ERA5-Land)"
                    }
                },
                layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.35, "raster-opacity": 0.9 } }]
            },
            center: [106.72, 10.84], zoom: 8.85, pitch: 55, bearing: -15, maxPitch: 75, antialias: true,
            attributionControl: { compact: true }
        });
        st.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        st.map.on("load", () => {
            st.mapReady = true;
            loadWards().then(() => loadSeries()).catch(showError);
        });
        // Người dùng tự xoay / kéo bản đồ -> tắt xoay tự động
        st.map.on("dragstart", () => setRotate(false));
    }

    function loadWards() {
        return fetch("assets/data/hcm_wards.json")
            .then(r => { if (!r.ok) throw new Error("Không tải được ranh giới phường/xã"); return r.json(); })
            .then(geo => {
                // Giữ lại thuộc tính cần thiết: mã + tên phường (mã dùng làm id cho feature-state)
                const features = geo.features.map(f => {
                    const p = f.properties || {};
                    const type = p.loai || p.loai_don_vi || "";
                    const name = p.ten_xa || p.ten_phuong_xa || "";
                    return {
                        type: "Feature", geometry: f.geometry,
                        properties: { code: String(p.ma_xa || p.ma_phuong_xa || ""), name: type && !name.startsWith(type) ? `${type} ${name}` : name }
                    };
                });
                st.map.addSource("wards", { type: "geojson", data: { type: "FeatureCollection", features }, promoteId: "code" });
                st.map.addLayer({
                    id: "wards-3d", type: "fill-extrusion", source: "wards",
                    paint: {
                        "fill-extrusion-color": ["coalesce", ["feature-state", "c"], "#cbd5e1"],
                        "fill-extrusion-height": ["coalesce", ["feature-state", "h"], 0],
                        "fill-extrusion-base": 0,
                        "fill-extrusion-opacity": 0.93,
                        "fill-extrusion-vertical-gradient": true
                    }
                });
                st.map.addLayer({
                    id: "wards-outline", type: "line", source: "wards",
                    paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.55 }
                });
                bindHover();
                st.wardsReady = true;
            });
    }

    // ------------------------------------------------------------------ dữ liệu không gian - thời gian
    function loadSeries() {
        if (!st.wardsReady) return;
        const r = RANGES[st.range];
        const seq = ++st.loadSeq;
        setPlaying(false);
        showLoading(`Đang dựng dữ liệu 168 phường × ${Math.floor((r.back + r.ahead) / r.step) + 1} mốc giờ...`);
        fetch(`${API}/air/spatial-series?pollutant=${st.pollutant}&back=${r.back}&ahead=${r.ahead}&step=${r.step}`)
            .then(res => res.json().then(body => {
                if (!res.ok) throw new Error(body.detail || `Máy chủ trả lỗi ${res.status}`);
                return body;
            }))
            .then(data => {
                if (seq !== st.loadSeq) return;
                st.data = data;
                st.obsIndex = Math.max(0, data.times.findIndex(t => t > data.observed_until) - 1);
                if (st.obsIndex < 0 || data.times[data.times.length - 1] <= data.observed_until) st.obsIndex = data.times.length - 1;
                const slider = $("m3d-slider");
                slider.max = String(data.times.length - 1);
                // Bắt đầu tại thời điểm hiện tại (ranh giới quan trắc / dự báo)
                const start = data.times.findIndex(t => t >= data.observed_until);
                st.frame = start >= 0 && r.back > 0 && r.ahead > 0 ? start : 0;
                renderMarks();
                renderLegend();
                st.lastHudFrame = -1;
                renderFrame(st.frame, true);
                hideLoading();
            })
            .catch(err => { if (seq === st.loadSeq) showError(err); });
    }

    function valueAt(arr, k, f) {
        const n = arr.length, i0 = Math.min(Math.floor(f), n - 1), i1 = Math.min(i0 + 1, n - 1), t = f - i0;
        const a = arr[i0][k], b = arr[i1][k];
        if (a == null) return b;
        if (b == null) return a;
        return a + (b - a) * t;
    }

    function renderFrame(f, forceHud) {
        const d = st.data;
        if (!d || !st.wardsReady) return;
        const vmin = d.range.min ?? 0;
        const vmax = Math.max(d.range.p98 ?? d.range.max ?? 1, vmin + 1e-6);
        const aqiArr = useUS() ? d.us_aqi : d.vn_aqi;
        d.wards.forEach((w, k) => {
            const v = valueAt(d.values, k, f);
            const q = valueAt(aqiArr, k, f);
            const h = v == null ? 0 : 120 + Math.min(Math.max(v, 0) / vmax, 1.2) * HEIGHT_MAX_M;
            const c = st.colorMode === "aqi" ? aqiLevel(q).color : relColor((v - vmin) / (vmax - vmin));
            st.map.setFeatureState({ source: "wards", id: w.code }, { h, c, v, q });
        });
        const slider = $("m3d-slider");
        if (slider && document.activeElement !== slider) slider.value = String(f);
        const i = Math.round(f);
        if (forceHud || i !== st.lastHudFrame) {
            st.lastHudFrame = i;
            renderHud(i);
        }
        if (st.hoverCode) refreshPopup();
    }

    // ------------------------------------------------------------------ thông tin trên bản đồ
    function timeLabel(s) {
        const dt = new Date(s.replace(" ", "T") + ":00");
        const dd = String(dt.getDate()).padStart(2, "0"), mm = String(dt.getMonth() + 1).padStart(2, "0");
        return { hour: `${String(dt.getHours()).padStart(2, "0")}:00`, day: `${WEEKDAYS[dt.getDay()]}, ${dd}/${mm}/${dt.getFullYear()}` };
    }

    function renderHud(i) {
        const d = st.data;
        const t = d.times[i];
        const lbl = timeLabel(t);
        const forecast = t > d.observed_until;
        $("m3d-hour").textContent = lbl.hour;
        $("m3d-day").textContent = lbl.day;
        const badge = $("m3d-badge");
        badge.textContent = forecast ? "Dự báo AI" : (t === d.observed_until ? "Hiện tại" : "Đã quan trắc");
        badge.className = `m3d-badge ${forecast ? "is-forecast" : "is-observed"}`;

        const vals = d.wards.map((w, k) => ({ w, v: d.values[i][k], q: (useUS() ? d.us_aqi : d.vn_aqi)[i][k] }))
            .filter(x => x.v != null);
        const mean = vals.reduce((s, x) => s + x.v, 0) / Math.max(vals.length, 1);
        vals.sort((a, b) => b.v - a.v);
        $("m3d-mean").textContent = `${fmt(mean)} ${d.unit || ""}`;
        $("m3d-max").textContent = vals.length ? `${vals[0].w.name} · ${fmt(vals[0].v)}` : "--";
        $("m3d-top").innerHTML = vals.slice(0, 5).map((x, n) => {
            const lv = aqiLevel(x.q);
            return `<li><span class="m3d-rank">${n + 1}</span><span class="m3d-name">${esc(x.w.name)}</span>
                <b>${fmt(x.v)}</b><i class="m3d-dot" style="background:${lv.color}" title="${esc(lv.name)}"></i></li>`;
        }).join("");
        $("m3d-top-title").textContent = `Top 5 phường ${d.name} cao nhất`;
    }

    function renderMarks() {
        // Vạch "Hiện tại" trên thanh thời gian (ranh giới quan trắc | dự báo)
        const d = st.data, mark = $("m3d-now-mark");
        const n = d.times.length - 1;
        const idx = d.times.findIndex(t => t >= d.observed_until);
        if (idx > 0 && idx < n) {
            mark.hidden = false;
            mark.style.left = `${(idx / n) * 100}%`;
        } else {
            mark.hidden = true;
        }
        $("m3d-start").textContent = `${timeLabel(d.times[0]).hour} ${timeLabel(d.times[0]).day.split(", ")[1]}`;
        $("m3d-end").textContent = `${timeLabel(d.times[n]).hour} ${timeLabel(d.times[n]).day.split(", ")[1]}`;
    }

    function renderLegend() {
        const d = st.data, el = $("m3d-legend");
        if (!d) return;
        const std = useUS() ? "US AQI" : "VN_AQI";
        if (st.colorMode === "aqi") {
            el.innerHTML = `<div class="m3d-legend-title">Màu: mức ${std} · Cao: nồng độ ${esc(d.name)}</div>
                <div class="m3d-levels">${AQI_LEVELS.map(l => `<span><i style="background:${l[1]}"></i>${l[2]}</span>`).join("")}</div>`;
        } else {
            const vmin = d.range.min ?? 0, vmax = d.range.p98 ?? d.range.max ?? 0;
            el.innerHTML = `<div class="m3d-legend-title">${esc(d.name)} (${esc(d.unit || "")}) · màu và chiều cao theo nồng độ</div>
                <div class="m3d-ramp" style="background: linear-gradient(90deg, ${REL_STOPS.join(", ")});"></div>
                <div class="m3d-ramp-labels"><span>${fmt(vmin)}</span><span>${fmt((vmin + vmax) / 2)}</span><span>≥ ${fmt(vmax)}</span></div>`;
        }
    }

    function bindHover() {
        st.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "m3d-popup" });
        st.map.on("mousemove", "wards-3d", e => {
            const f = e.features && e.features[0];
            if (!f) return;
            st.map.getCanvas().style.cursor = "pointer";
            st.hoverCode = f.properties.code;
            st.hoverName = f.properties.name;
            st.popup.setLngLat(e.lngLat);
            refreshPopup();
            if (!st.popup.isOpen()) st.popup.addTo(st.map);
        });
        st.map.on("mouseleave", "wards-3d", () => {
            st.map.getCanvas().style.cursor = "";
            st.hoverCode = null;
            st.popup.remove();
        });
    }

    function refreshPopup() {
        if (!st.hoverCode || !st.data) return;
        const s = st.map.getFeatureState({ source: "wards", id: st.hoverCode }) || {};
        const lv = aqiLevel(s.q);
        const std = useUS() ? "US AQI" : "VN_AQI";
        st.popup.setHTML(`<b>${esc(st.hoverName)}</b>
            <div>${esc(st.data.name)}: <b>${fmt(s.v)}</b> ${esc(st.data.unit || "")}</div>
            <div>${std}: <b>${s.q == null ? "--" : Math.round(s.q)}</b> · <span style="color:${lv.color === "#ffff00" ? "#a16207" : lv.color}">${lv.name}</span></div>`);
    }

    // ------------------------------------------------------------------ phát hoạt cảnh
    function tick(ts) {
        st.raf = 0;
        const tab = $("tab-map3d");
        if (!tab || !tab.classList.contains("active")) { st.lastTs = 0; return; } // Rời tab: dừng vẽ
        const dt = st.lastTs ? (ts - st.lastTs) / 1000 : 0;
        st.lastTs = ts;
        if (st.playing && st.data) {
            const n = st.data.times.length - 1;
            st.frame += dt * FRAMES_PER_SECOND * st.speed;
            if (st.frame >= n) st.frame = 0; // Lặp lại từ đầu
            renderFrame(st.frame);
        }
        if (st.rotate && st.map) st.map.setBearing(st.map.getBearing() + dt * 5);
        if (st.playing || st.rotate) st.raf = requestAnimationFrame(tick);
    }

    function kick() {
        if (!st.raf && (st.playing || st.rotate)) {
            st.lastTs = 0;
            st.raf = requestAnimationFrame(tick);
        }
    }

    function setPlaying(on) {
        st.playing = !!on && !!st.data;
        const btn = $("m3d-play");
        if (btn) {
            btn.innerHTML = st.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
            btn.setAttribute("aria-label", st.playing ? "Tạm dừng" : "Phát");
        }
        kick();
    }

    function setRotate(on) {
        st.rotate = !!on;
        const btn = $("m3d-rotate");
        if (btn) btn.classList.toggle("active", st.rotate);
        kick();
    }

    // ------------------------------------------------------------------ trạng thái tải / lỗi
    function showLoading(msg) {
        const el = $("m3d-loading");
        el.hidden = false;
        el.classList.remove("is-error");
        el.innerHTML = `<span class="loader-dots"></span> ${esc(msg)}<small>Lần đầu cần tính AQI từng phường theo giờ, mất vài giây; các lần sau mở ngay.</small>`;
    }
    function hideLoading() { $("m3d-loading").hidden = true; }
    function showError(err) {
        const el = $("m3d-loading");
        el.hidden = false;
        el.classList.add("is-error");
        el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(err && err.message || err)}
            <button type="button" class="btn-forecast" onclick="AirMap3D.reload()"><i class="fa-solid fa-rotate"></i> Thử lại</button>`;
    }

    // ------------------------------------------------------------------ điều khiển
    function bindControls() {
        $("m3d-pollutant").addEventListener("change", e => { st.pollutant = e.target.value; loadSeries(); });
        $("m3d-range").addEventListener("change", e => { st.range = e.target.value; loadSeries(); });
        document.querySelectorAll("#m3d-color button").forEach(b => b.addEventListener("click", () => {
            st.colorMode = b.dataset.color;
            document.querySelectorAll("#m3d-color button").forEach(x => x.classList.toggle("active", x === b));
            renderLegend();
            renderFrame(st.frame, true);
        }));
        $("m3d-play").addEventListener("click", () => setPlaying(!st.playing));
        $("m3d-speed").addEventListener("change", e => { st.speed = Number(e.target.value) || 1; });
        $("m3d-slider").addEventListener("input", e => {
            setPlaying(false);
            st.frame = Number(e.target.value);
            renderFrame(st.frame);
        });
        $("m3d-now").addEventListener("click", () => {
            if (!st.data) return;
            setPlaying(false);
            const i = st.data.times.findIndex(t => t >= st.data.observed_until);
            st.frame = i >= 0 ? i : st.data.times.length - 1;
            renderFrame(st.frame, true);
        });
        $("m3d-rotate").addEventListener("click", () => setRotate(!st.rotate));
        $("m3d-view").addEventListener("click", () => {
            const flat = st.map.getPitch() < 10;
            st.map.easeTo({ pitch: flat ? 55 : 0, bearing: flat ? -15 : 0, duration: 900 });
            $("m3d-view").innerHTML = flat ? '<i class="fa-solid fa-cube"></i> 3D' : '<i class="fa-solid fa-map"></i> 2D';
        });
        // Đổi chuẩn VN_AQI / US AQI ở thanh trên cùng -> cập nhật màu, chú giải
        document.addEventListener("click", e => {
            if (e.target.closest && e.target.closest("[onclick*='AQIStandard'], .aqi-standard-btn, #btn-std-vn, #btn-std-us")) {
                setTimeout(() => { renderLegend(); renderFrame(st.frame, true); }, 50);
            }
        });
    }

    // ------------------------------------------------------------------ API công khai
    window.AirMap3D = {
        onShow() {
            if (!$("map3d")) return;
            if (st.map) {
                st.map.resize();
                kick();
                return;
            }
            bindControls();
            showLoading("Đang tải bản đồ 3D...");
            loadMapLibre().then(initMap).catch(showError);
        },
        reload() {
            if (!st.map) return this.onShow();
            if (!st.wardsReady) return loadWards().then(loadSeries).catch(showError);
            loadSeries();
        }
    };
})();
