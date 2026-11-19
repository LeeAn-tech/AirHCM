// ==============================================================================
// BẢN ĐỒ 3D CHO ỨNG DỤNG DI ĐỘNG (m3d.html, mở trong WebView của app Flutter AirHCM)
// Cùng dữ liệu, giải thuật và cách hiển thị với chế độ 3D của WebGIS (js/map3d.js):
// khối nổi 168 phường, chiều cao = nồng độ, màu tương đối / mức AQI, hoạt cảnh nội suy theo giờ.
// Giao tiếp với app qua kênh JavaScript "AirHCM" (nếu có):
//   {type:"ward", code, name, lat, lng}  chạm "Phân tích" -> app mở bảng phân tích vị trí gốc của app
//   {type:"time", time}                  giờ đang xem -> app đồng bộ thanh mô phỏng 24h khi quay lại
// ==============================================================================
(function () {
    "use strict";

    const ML_VERSION = "4.7.1";
    const API = `${location.origin}/api/v1`;
    const HEIGHT_MAX_M = 9000;
    const FRAMES_PER_SECOND = 1.6;
    const MIN_FRAME_MS = 45;                 // Điện thoại: giới hạn ~22 khung hình/giây cho mượt, đỡ tốn pin
    const RANGES = {
        "24-72": { back: 24, ahead: 72, step: 1 },
        "0-168": { back: 0, ahead: 168, step: 2 },
        "168-0": { back: 168, ahead: 0, step: 2 },
        "720-0": { back: 720, ahead: 0, step: 6 },
    };
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
    const BASEMAPS = {
        light: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        dark: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        osm: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
        satellite: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    };
    const REL_STOPS = ["#1a9641", "#73c255", "#c4e687", "#ffffbf", "#fdc980", "#f07c4a", "#d7191c"];
    const AQI_LEVELS = [
        [50, "#00e400", "Tốt"], [100, "#ffff00", "Trung bình"], [150, "#ff7e00", "Kém"],
        [200, "#ff0000", "Xấu"], [300, "#8f3f97", "Rất xấu"], [Infinity, "#7e0023", "Nguy hại"],
    ];
    const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    const SPEEDS = [1, 2, 4, 0.5];

    const q = new URLSearchParams(location.search);
    const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
    const st = {
        map: null, wardsReady: false, data: null, frame: 0, playing: false, rotate: false,
        speedIdx: 0, pollutant: q.get("pollutant") || "pm2_5", range: "24-72", colorMode: "rel",
        useUS: (q.get("standard") || "VN").toUpperCase() === "US", basemap: BASEMAPS[q.get("basemap")] ? q.get("basemap") : "light",
        startHour: q.has("hour") ? parseInt(q.get("hour"), 10) : null,
        raf: 0, lastTs: 0, lastDraw: 0, lastHud: -1, loadSeq: 0, selected: null, lastPostedTime: null,
    };
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? "--" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: d });

    function post(msg) {
        try {
            if (window.AirHCM && typeof window.AirHCM.postMessage === "function") window.AirHCM.postMessage(JSON.stringify(msg));
        } catch (_) { /* Mở bằng trình duyệt thường: không có kênh app */ }
    }

    // ------------------------------------------------------------------ màu
    const REL_RGB = REL_STOPS.map(h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    function relColor(t) {
        if (!isFinite(t)) return "#cbd5e1";
        t = Math.min(Math.max(t, 0), 1) * (REL_RGB.length - 1);
        const i = Math.min(Math.floor(t), REL_RGB.length - 2), f = t - i, a = REL_RGB[i], b = REL_RGB[i + 1];
        return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(",")})`;
    }
    function aqiLevel(aqi) {
        if (aqi == null || !isFinite(aqi)) return { color: "#cbd5e1", name: "Không có dữ liệu" };
        const lv = AQI_LEVELS.find(l => aqi <= l[0]);
        return { color: lv[1], name: lv[2] };
    }


    // Tâm hình học (theo diện tích) của vòng ngoài lớn nhất. Dùng tâm phường thay cho tọa độ điểm chạm:
    // khi bản đồ nghiêng, chạm vào NÓC khối cao vài km nhưng tọa độ trả về là điểm MẶT ĐẤT dọc tia nhìn (lệch vài km)
    function featureCenter(geom) {
        const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
        let best = null;
        polys.forEach(poly => {
            const ring = poly[0] || [];
            let a = 0, cx = 0, cy = 0;
            for (let i = 0; i < ring.length - 1; i++) {
                const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], f = x0 * y1 - x1 * y0;
                a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
            }
            if (a !== 0 && (!best || Math.abs(a) > best.a)) best = { a: Math.abs(a), c: [cx / (3 * a), cy / (3 * a)], ring };
        });
        if (!best) return null;
        // Phường hình lõm: tâm có thể rơi ra ngoài -> lấy điểm giữa đoạn trong phường dài nhất trên đường ngang qua tâm
        const ring = best.ring, y = best.c[1], xs = [];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y)) {
                const x = xi + (y - yi) * (xj - xi) / (yj - yi);
                xs.push(x);
                if (best.c[0] < x) inside = !inside;
            }
        }
        if (inside || xs.length < 2) return best.c;
        xs.sort((p, q) => p - q);
        let seg = [xs[0], xs[1]];
        for (let k = 2; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > seg[1] - seg[0]) seg = [xs[k], xs[k + 1]];
        return [(seg[0] + seg[1]) / 2, y];
    }

    // ------------------------------------------------------------------ bản đồ
    function loadMapLibre() {
        return new Promise((resolve, reject) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = `https://unpkg.com/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.css`;
            document.head.appendChild(css);
            const js = document.createElement("script");
            js.src = `https://unpkg.com/maplibre-gl@${ML_VERSION}/dist/maplibre-gl.js`;
            js.onload = resolve;
            js.onerror = () => reject(new Error("Không tải được thư viện bản đồ 3D. Kiểm tra kết nối Internet của điện thoại."));
            document.head.appendChild(js);
        });
    }

    function initMap() {
        // Vị trí / thu phóng truyền từ app (thang flutter_map = Leaflet; MapLibre nhỏ hơn 1 bậc)
        st.map = new maplibregl.Map({
            container: "map",
            style: {
                version: 8,
                sources: {
                    base: { type: "raster", tileSize: 256, maxzoom: 19, tiles: [BASEMAPS[st.basemap]], attribution: "© Esri, HERE, Garmin, OSM · AirHCM" }
                },
                layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": st.basemap === "satellite" ? 0 : -0.3 } }]
            },
            center: [num(q.get("lng"), 106.72), num(q.get("lat"), 10.84)],
            zoom: num(q.get("zoom"), 9.85) - 1, pitch: 55, bearing: -15, maxPitch: 75,
            attributionControl: { compact: true }, dragRotate: true, touchPitch: true
        });
        st.map.on("load", () => loadWards().then(loadSeries).catch(showError));
        st.map.on("dragstart", () => setRotate(false));
    }

    function loadWards() {
        return fetch("assets/data/hcm_wards.json")
            .then(r => { if (!r.ok) throw new Error("Không tải được ranh giới phường/xã"); return r.json(); })
            .then(geo => {
                st.centers = {};
                const features = geo.features.map(f => {
                    const p = f.properties || {};
                    const type = p.loai || p.loai_don_vi || "", name = p.ten_xa || p.ten_phuong_xa || "";
                    const c = featureCenter(f.geometry);
                    if (c) st.centers[String(p.ma_xa || p.ma_phuong_xa || "")] = c;
                    return { type: "Feature", geometry: f.geometry,
                        properties: { code: String(p.ma_xa || p.ma_phuong_xa || ""), name: type && !name.startsWith(type) ? `${type} ${name}` : name } };
                });
                st.map.addSource("wards", { type: "geojson", data: { type: "FeatureCollection", features }, promoteId: "code" });
                st.map.addLayer({
                    id: "wards-3d", type: "fill-extrusion", source: "wards",
                    paint: {
                        "fill-extrusion-color": ["coalesce", ["feature-state", "c"], "#cbd5e1"],
                        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"],
                            9, ["coalesce", ["feature-state", "h"], 0],
                            11, ["*", 0.45, ["coalesce", ["feature-state", "h"], 0]],
                            13, ["*", 0.18, ["coalesce", ["feature-state", "h"], 0]],
                            15, ["*", 0.07, ["coalesce", ["feature-state", "h"], 0]]],
                        "fill-extrusion-opacity": 0.93,
                        "fill-extrusion-vertical-gradient": true
                    }
                });
                st.map.addLayer({ id: "wards-outline", type: "line", source: "wards", paint: { "line-color": "#fff", "line-width": 0.6, "line-opacity": 0.55 } });
                st.map.on("click", "wards-3d", e => {
                    const f = e.features && e.features[0];
                    if (f) selectWard(f.properties.code, f.properties.name, e.lngLat);
                });
                st.map.on("click", e => {
                    if (!st.map.queryRenderedFeatures(e.point, { layers: ["wards-3d"] }).length) closeWard();
                });
                st.wardsReady = true;
            });
    }

    // ------------------------------------------------------------------ dữ liệu
    function loadSeries() {
        if (!st.wardsReady) return;
        const r = RANGES[st.range], seq = ++st.loadSeq;
        setPlaying(false);
        showLoading(`Đang dựng dữ liệu 168 phường × ${Math.floor((r.back + r.ahead) / r.step) + 1} mốc giờ...`);
        fetch(`${API}/air/spatial-series?pollutant=${st.pollutant}&back=${r.back}&ahead=${r.ahead}&step=${r.step}`)
            .then(res => res.json().then(b => { if (!res.ok) throw new Error(b.detail || `Máy chủ trả lỗi ${res.status}`); return b; }))
            .then(data => {
                if (seq !== st.loadSeq) return;
                st.data = data;
                $("slider").max = String(data.times.length - 1);
                const nowIdx = data.times.findIndex(t => t >= data.observed_until);
                st.frame = nowIdx >= 0 && r.back > 0 && r.ahead > 0 ? nowIdx : 0;
                if (st.startHour != null && isFinite(st.startHour)) { // Giờ đang xem ở thanh mô phỏng 24h của app
                    const i = data.times.indexOf(`${dayKey(new Date())} ${String(st.startHour).padStart(2, "0")}:00`);
                    if (i >= 0) st.frame = i;
                    st.startHour = null;
                }
                renderMarks();
                renderLegend();
                st.lastHud = -1;
                renderFrame(st.frame, true);
                hideLoading();
            })
            .catch(err => { if (seq === st.loadSeq) showError(err); });
    }

    function valueAt(arr, k, f) {
        const n = arr.length, i0 = Math.min(Math.floor(f), n - 1), i1 = Math.min(i0 + 1, n - 1), t = f - i0;
        const a = arr[i0][k], b = arr[i1][k];
        return a == null ? b : b == null ? a : a + (b - a) * t;
    }

    function renderFrame(f, force) {
        const d = st.data;
        if (!d || !st.wardsReady) return;
        const vmin = d.range.min ?? 0, vmax = Math.max(d.range.p98 ?? d.range.max ?? 1, vmin + 1e-6);
        const aqiArr = st.useUS ? d.us_aqi : d.vn_aqi;
        d.wards.forEach((w, k) => {
            const v = valueAt(d.values, k, f), qv = valueAt(aqiArr, k, f);
            st.map.setFeatureState({ source: "wards", id: w.code }, {
                h: v == null ? 0 : 120 + Math.min(Math.max(v, 0) / vmax, 1.2) * HEIGHT_MAX_M,
                c: st.colorMode === "aqi" ? aqiLevel(qv).color : relColor((v - vmin) / (vmax - vmin)),
                v, q: qv
            });
        });
        const slider = $("slider");
        if (document.activeElement !== slider) slider.value = String(f);
        const i = Math.round(f);
        if (force || i !== st.lastHud) {
            st.lastHud = i;
            renderHud(i);
        }
        if (st.selected) renderWard();
    }

    // ------------------------------------------------------------------ hiển thị
    function dayKey(dt) {
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
    function timeLabel(s) {
        const dt = new Date(s.replace(" ", "T") + ":00");
        const dd = String(dt.getDate()).padStart(2, "0"), mm = String(dt.getMonth() + 1).padStart(2, "0");
        return { hour: `${String(dt.getHours()).padStart(2, "0")}:00`, day: `${WEEKDAYS[dt.getDay()]}, ${dd}/${mm}/${dt.getFullYear()}`, short: `${dd}/${mm}` };
    }

    function renderHud(i) {
        const d = st.data, t = d.times[i], lbl = timeLabel(t), fc = t > d.observed_until;
        $("hour").textContent = lbl.hour;
        $("day").textContent = lbl.day;
        const badge = $("badge");
        badge.textContent = fc ? "Dự báo AI" : (t === d.observed_until ? "Hiện tại" : "Đã quan trắc");
        badge.className = `badge ${fc ? "fc" : "obs"}`;
        const aqiArr = st.useUS ? d.us_aqi : d.vn_aqi;
        const vals = d.wards.map((w, k) => ({ w, v: d.values[i][k], q: aqiArr[i][k] })).filter(x => x.v != null);
        $("mean").textContent = `${fmt(vals.reduce((s, x) => s + x.v, 0) / Math.max(vals.length, 1))} ${d.unit || ""}`;
        vals.sort((a, b) => b.v - a.v);
        $("top5").innerHTML = vals.slice(0, 5).map((x, n) =>
            `<li><span class="r">${n + 1}</span><span class="n">${esc(x.w.name)}</span><b>${fmt(x.v)}</b><i class="dot" style="background:${aqiLevel(x.q).color}"></i></li>`).join("");
        if (t !== st.lastPostedTime) {
            st.lastPostedTime = t;
            post({ type: "time", time: t });
        }
    }

    function renderMarks() {
        const d = st.data, n = d.times.length - 1, idx = d.times.findIndex(t => t >= d.observed_until), mark = $("now-mark");
        mark.hidden = !(idx > 0 && idx < n);
        if (!mark.hidden) mark.style.left = `${(idx / n) * 100}%`;
        const a = timeLabel(d.times[0]), b = timeLabel(d.times[n]);
        $("t-start").textContent = `${a.hour} ${a.short}`;
        $("t-end").textContent = `${b.hour} ${b.short}`;
    }

    function renderLegend() {
        const d = st.data;
        if (!d) return;
        const std = st.useUS ? "US AQI" : "VN_AQI";
        if (st.colorMode === "aqi") {
            $("legend-title").textContent = `Màu: mức ${std} · cao: ${d.name} · Top 5`;
            $("legend-body").innerHTML = `<div class="levels">${AQI_LEVELS.map(l => `<span><i style="background:${l[1]}"></i>${l[2]}</span>`).join("")}</div>`;
        } else {
            const vmin = d.range.min ?? 0, vmax = d.range.p98 ?? d.range.max ?? 0;
            $("legend-title").textContent = `${d.name} (${d.unit || ""}) · màu & chiều cao · Top 5`;
            $("legend-body").innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${REL_STOPS.join(",")})"></div>
                <div class="ramp-labels"><span>${fmt(vmin)}</span><span>${fmt((vmin + vmax) / 2)}</span><span>≥ ${fmt(vmax)}</span></div>`;
        }
        $("color-label").textContent = st.colorMode === "aqi" ? "AQI" : "TĐ";
    }

    // ------------------------------------------------------------------ chạm vào phường
    function selectWard(code, name, lngLat) {
        const c = st.centers && st.centers[code];
        st.selected = { code, name, lat: c ? c[1] : lngLat.lat, lng: c ? c[0] : lngLat.lng };
        $("ward-card").hidden = false;
        renderWard();
    }
    function renderWard() {
        const s = st.map.getFeatureState({ source: "wards", id: st.selected.code }) || {};
        const lv = aqiLevel(s.q), std = st.useUS ? "US AQI" : "VN_AQI";
        $("ward-info").innerHTML = `<b class="t">${esc(st.selected.name)}</b>
            ${esc(st.data ? st.data.name : "")}: <b>${fmt(s.v)}</b> ${esc(st.data ? st.data.unit || "" : "")} ·
            ${std} <b>${s.q == null ? "--" : Math.round(s.q)}</b> <span style="color:${lv.color === "#ffff00" ? "#a16207" : lv.color}">${lv.name}</span>`;
        $("ward-go").hidden = !(window.AirHCM && window.AirHCM.postMessage);
    }
    function closeWard() {
        st.selected = null;
        $("ward-card").hidden = true;
    }

    // ------------------------------------------------------------------ hoạt cảnh
    function tick(ts) {
        st.raf = 0;
        const dt = st.lastTs ? (ts - st.lastTs) / 1000 : 0;
        if (ts - st.lastDraw >= MIN_FRAME_MS || !st.lastTs) {
            st.lastTs = ts;
            st.lastDraw = ts;
            if (st.playing && st.data) {
                const n = st.data.times.length - 1;
                st.frame += dt * FRAMES_PER_SECOND * SPEEDS[st.speedIdx];
                if (st.frame >= n) st.frame = 0;
                renderFrame(st.frame);
            }
            if (st.rotate) st.map.setBearing(st.map.getBearing() + dt * 5);
        }
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
        $("btn-play").innerHTML = st.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        kick();
    }
    function setRotate(on) {
        st.rotate = !!on;
        $("btn-rotate").classList.toggle("active", st.rotate);
        kick();
    }

    // ------------------------------------------------------------------ tải / lỗi
    function showLoading(msg) {
        const el = $("loading");
        el.hidden = false;
        el.classList.remove("err");
        el.innerHTML = `<div class="spinner"></div><span>${esc(msg)}</span><small>Lần đầu cần vài giây để tính AQI từng phường.</small>`;
    }
    function hideLoading() { $("loading").hidden = true; }
    function showError(err) {
        const el = $("loading");
        el.hidden = false;
        el.classList.add("err");
        el.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size:26px"></i><span>${esc(err && err.message || err)}</span>
            <button type="button" id="btn-retry"><i class="fa-solid fa-rotate"></i> Thử lại</button>`;
        $("btn-retry").onclick = () => (st.map ? (st.wardsReady ? loadSeries() : loadWards().then(loadSeries).catch(showError)) : location.reload());
    }

    // ------------------------------------------------------------------ điều khiển
    function bind() {
        $("pollutants").addEventListener("click", e => {
            const b = e.target.closest("[data-p]");
            if (!b || b.dataset.p === st.pollutant) return;
            st.pollutant = b.dataset.p;
            document.querySelectorAll("#pollutants .chip").forEach(x => x.classList.toggle("active", x === b));
            loadSeries();
        });
        $("btn-play").addEventListener("click", () => setPlaying(!st.playing));
        $("slider").addEventListener("input", e => {
            setPlaying(false);
            st.frame = Number(e.target.value);
            renderFrame(st.frame);
        });
        $("btn-speed").addEventListener("click", () => {
            st.speedIdx = (st.speedIdx + 1) % SPEEDS.length;
            $("btn-speed").textContent = `${String(SPEEDS[st.speedIdx]).replace(".", ",")}×`;
        });
        $("btn-now").addEventListener("click", () => {
            if (!st.data) return;
            setPlaying(false);
            const i = st.data.times.findIndex(t => t >= st.data.observed_until);
            st.frame = i >= 0 ? i : st.data.times.length - 1;
            renderFrame(st.frame, true);
        });
        $("btn-rotate").addEventListener("click", () => setRotate(!st.rotate));
        $("btn-color").addEventListener("click", () => {
            st.colorMode = st.colorMode === "rel" ? "aqi" : "rel";
            renderLegend();
            renderFrame(st.frame, true);
        });
        $("btn-reset").addEventListener("click", () => st.map && st.map.flyTo({ center: [106.72, 10.84], zoom: 8.85, pitch: 55, bearing: -15, duration: 1200 }));
        $("btn-range").addEventListener("click", () => { $("range-sheet").hidden = false; });
        $("range-sheet").addEventListener("click", e => {
            const b = e.target.closest("[data-r]");
            $("range-sheet").hidden = true;
            if (!b || b.dataset.r === st.range) return;
            st.range = b.dataset.r;
            document.querySelectorAll("#range-sheet [data-r]").forEach(x => x.classList.toggle("active", x === b));
            loadSeries();
        });
        $("legend-head").addEventListener("click", () => $("legend").classList.toggle("open"));
        $("ward-close").addEventListener("click", closeWard);
        $("ward-go").addEventListener("click", () => st.selected && post(Object.assign({ type: "ward" }, st.selected)));
        document.addEventListener("visibilitychange", () => { if (document.hidden) setPlaying(false); });
    }

    // Chip chất ô nhiễm theo tham số URL
    document.querySelectorAll("#pollutants .chip").forEach(x => x.classList.toggle("active", x.dataset.p === st.pollutant));
    bind();
    loadMapLibre().then(initMap).catch(showError);
})();
