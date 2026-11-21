// ==============================================================================
// CHẾ ĐỘ XEM 3D CỦA BẢN ĐỒ WEBGIS: DIỄN BIẾN CHẤT LƯỢNG KHÔNG KHÍ THEO KHÔNG GIAN - THỜI GIAN
//  - Cùng trang với bản đồ 2D (Leaflet); nút "Chế độ xem: Bản đồ 2D | Khối 3D" ở bảng điều khiển
//  - Không gian: 168 phường/xã dựng thành khối nổi (MapLibre GL fill-extrusion)
//    chiều cao khối = nồng độ; màu = mức tương đối hoặc mức AQI
//  - Thời gian: chuỗi giờ quan trắc + dự báo AI (API /api/v1/air/spatial-series), hoạt cảnh nội suy mượt
//  - Đồng bộ với 2D: vị trí/thu phóng, giờ đang xem, bản đồ nền, tìm kiếm địa điểm, bảng phân tích phường
// ==============================================================================
(function () {
    "use strict";

    const ML_VERSION = "4.7.1";
    const API = (typeof API_BASE !== "undefined") ? API_BASE : `${location.origin}/api/v1`;
    const HEIGHT_MAX_M = 9000;            // Chiều cao (m) của khối có nồng độ cao nhất
    const FRAMES_PER_SECOND = 1.6;        // Tốc độ phát ở mức 1x
    const RANGES = {
        "24-72": { back: 24, ahead: 72, step: 1 },
        "0-168": { back: 0, ahead: 168, step: 2 },
        "168-0": { back: 168, ahead: 0, step: 2 },
        "720-0": { back: 720, ahead: 0, step: 6 },
    };
    // Bản đồ nền 3D theo lựa chọn ở bảng "Bản đồ nền" của 2D (Esri - không cần API key)
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
    const BASEMAPS = {
        light: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        dark: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        osm: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
        satellite: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    };
    // Thang màu tương đối (xanh -> vàng -> cam -> đỏ): làm nổi khác biệt giữa các phường
    const REL_STOPS = ["#1a9641", "#73c255", "#c4e687", "#ffffbf", "#fdc980", "#f07c4a", "#d7191c"];
    // Màu mức AQI chuẩn (QĐ 1459/QĐ-TCMT và US EPA dùng cùng bảng màu)
    const AQI_LEVELS = [
        [50, "#00e400", "Tốt"], [100, "#ffff00", "Trung bình"], [150, "#ff7e00", "Kém"],
        [200, "#ff0000", "Xấu"], [300, "#8f3f97", "Rất xấu"], [Infinity, "#7e0023", "Nguy hại"],
    ];
    const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

    const st = {
        mode: "2d", map: null, mlPromise: null, wardsReady: false, controlsBound: false,
        data: null, frame: 0, playing: false, speed: 1, rotate: false,
        pollutant: "pm2_5", range: "24-72", colorMode: "rel",
        raf: 0, lastTs: 0, lastHudFrame: -1, loadSeq: 0, popup: null, hoverCode: null, hoverName: "",
        pendingSync: false,
    };
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? "--" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: d, minimumFractionDigits: d });
    const useUS = () => (typeof currentAQIStandard !== "undefined" && currentAQIStandard === "US");
    const leaflet = () => (typeof map !== "undefined" && map && typeof map.getCenter === "function") ? map : null;
    const is3D = () => st.mode === "3d";

    // ------------------------------------------------------------------ thư viện MapLibre (nạp khi bật 3D)
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

    // ------------------------------------------------------------------ bản đồ 3D
    function currentBasemap() {
        const sel = $("select-basemap");
        return (sel && BASEMAPS[sel.value]) ? sel.value : "light";
    }

    function setBasemap(key) {
        if (!st.map || !st.map.getSource) return;
        if (st.map.getLayer("base")) st.map.removeLayer("base");
        if (st.map.getSource("base")) st.map.removeSource("base");
        st.map.addSource("base", {
            type: "raster", tileSize: 256, maxzoom: 19, tiles: [BASEMAPS[key] || BASEMAPS.light],
            attribution: "© Esri, HERE, Garmin, OpenStreetMap · Dữ liệu: AirHCM (CAMS, Sentinel-5P, ERA5-Land)"
        });
        const before = st.map.getLayer("wards-3d") ? "wards-3d" : undefined;
        st.map.addLayer({ id: "base", type: "raster", source: "base", paint: { "raster-saturation": key === "satellite" ? 0 : -0.3 } }, before);
    }

    function initMap() {
        // Mở 3D tại đúng vị trí / mức thu phóng đang xem ở 2D (MapLibre dùng ô 512px -> zoom nhỏ hơn Leaflet 1 bậc)
        const L2 = leaflet();
        const c = L2 ? L2.getCenter() : { lat: 10.84, lng: 106.72 };
        const z = L2 ? L2.getZoom() - 1 : 8.85;
        st.map = new maplibregl.Map({
            container: "map3d",
            style: { version: 8, sources: {}, layers: [] },
            center: [c.lng, c.lat], zoom: z, pitch: 55, bearing: -15, maxPitch: 75, antialias: true,
            attributionControl: { compact: true }
        });
        st.map.on("load", () => {
            setBasemap(currentBasemap());
            loadWards().then(() => loadSeries()).catch(showError);
        });
        st.map.on("dragstart", () => setRotate(false)); // Người dùng tự xoay / kéo -> tắt xoay tự động
    }

    function loadWards() {
        return fetch("assets/data/hcm_wards.json")
            .then(r => { if (!r.ok) throw new Error("Không tải được ranh giới phường/xã"); return r.json(); })
            .then(geo => {
                // Giữ lại thuộc tính cần thiết: mã + tên phường (mã dùng làm id cho feature-state)
                st.centers = {};
                const features = geo.features.map(f => {
                    const p = f.properties || {};
                    const c = featureCenter(f.geometry);
                    if (c) st.centers[String(p.ma_xa || p.ma_phuong_xa || "")] = c;
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
                        // Phóng to vào nội thành -> giảm chiều cao để khối không thành "bức tường" che bản đồ
                        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"],
                            9, ["coalesce", ["feature-state", "h"], 0],
                            11, ["*", 0.45, ["coalesce", ["feature-state", "h"], 0]],
                            13, ["*", 0.18, ["coalesce", ["feature-state", "h"], 0]],
                            15, ["*", 0.07, ["coalesce", ["feature-state", "h"], 0]]],
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
                $("m3d-slider").max = String(data.times.length - 1);
                const nowIdx = data.times.findIndex(t => t >= data.observed_until);
                st.frame = nowIdx >= 0 && r.back > 0 && r.ahead > 0 ? nowIdx : 0;
                if (st.pendingSync) syncFrom2D(); // Mở 3D tại đúng giờ đang xem ở 2D
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

    // ------------------------------------------------------------------ thông tin hiển thị
    function parseTime(s) {
        return new Date(s.replace(" ", "T") + ":00");
    }
    function timeLabel(s) {
        const dt = parseTime(s);
        const dd = String(dt.getDate()).padStart(2, "0"), mm = String(dt.getMonth() + 1).padStart(2, "0");
        return { hour: `${String(dt.getHours()).padStart(2, "0")}:00`, day: `${WEEKDAYS[dt.getDay()]}, ${dd}/${mm}/${dt.getFullYear()}`, short: `${dd}/${mm}` };
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
        badge.className = `badge-period m3d-badge ${forecast ? "is-forecast" : "is-observed"}`;

        const aqiArr = useUS() ? d.us_aqi : d.vn_aqi;
        const vals = d.wards.map((w, k) => ({ w, v: d.values[i][k], q: aqiArr[i][k] })).filter(x => x.v != null);
        const mean = vals.reduce((s, x) => s + x.v, 0) / Math.max(vals.length, 1);
        vals.sort((a, b) => b.v - a.v);
        $("m3d-mean").textContent = `${fmt(mean)} ${d.unit || ""}`;
        $("m3d-max").textContent = vals.length ? `${vals[0].w.name} · ${fmt(vals[0].v)}` : "--";
        $("m3d-top-title").textContent = `Top 5 phường ${d.name} cao nhất`;
        $("m3d-top").innerHTML = vals.slice(0, 5).map((x, n) => {
            const lv = aqiLevel(x.q);
            return `<li data-code="${esc(x.w.code)}"><span class="m3d-rank">${n + 1}</span><span class="m3d-name">${esc(x.w.name)}</span>
                <b>${fmt(x.v)}</b><i class="m3d-dot" style="background:${lv.color}" title="${esc(lv.name)}"></i></li>`;
        }).join("");
    }

    function renderMarks() {
        // Vạch "Hiện tại" trên thanh thời gian (ranh giới quan trắc | dự báo)
        const d = st.data, mark = $("m3d-now-mark");
        const n = d.times.length - 1;
        const idx = d.times.findIndex(t => t >= d.observed_until);
        mark.hidden = !(idx > 0 && idx < n);
        if (!mark.hidden) mark.style.left = `${(idx / n) * 100}%`;
        const a = timeLabel(d.times[0]), b = timeLabel(d.times[n]);
        $("m3d-start").textContent = `${a.hour} ${a.short}`;
        $("m3d-end").textContent = `${b.hour} ${b.short}`;
    }

    function renderLegend() {
        const d = st.data, el = $("m3d-legend");
        if (!d) return;
        const std = useUS() ? "US AQI" : "VN_AQI";
        if (st.colorMode === "aqi") {
            el.innerHTML = `<h5>Màu: mức ${std} · cao: ${esc(d.name)}</h5>
                <div class="m3d-levels">${AQI_LEVELS.map(l => `<span><i style="background:${l[1]}"></i>${l[2]}</span>`).join("")}</div>`;
        } else {
            const vmin = d.range.min ?? 0, vmax = d.range.p98 ?? d.range.max ?? 0;
            el.innerHTML = `<h5>${esc(d.name)} (${esc(d.unit || "")}) · màu & chiều cao</h5>
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
        // Bấm vào khối phường -> mở bảng phân tích phường như ở bản đồ 2D
        st.map.on("click", "wards-3d", e => {
            const f = e.features && e.features[0];
            if (!f || typeof window.openPlacePanel !== "function") return;
            const c = st.centers[f.properties.code] || [e.lngLat.lng, e.lngLat.lat];
            window.openPlacePanel({ kind: "ward", code: f.properties.code, name: f.properties.name,
                address: "TP. Hồ Chí Minh", lat: c[1], lng: c[0] });
        });
    }

    function refreshPopup() {
        if (!st.hoverCode || !st.data) return;
        const s = st.map.getFeatureState({ source: "wards", id: st.hoverCode }) || {};
        const lv = aqiLevel(s.q);
        const std = useUS() ? "US AQI" : "VN_AQI";
        st.popup.setHTML(`<b>${esc(st.hoverName)}</b>
            <div>${esc(st.data.name)}: <b>${fmt(s.v)}</b> ${esc(st.data.unit || "")}</div>
            <div>${std}: <b>${s.q == null ? "--" : Math.round(s.q)}</b> · <span style="color:${lv.color === "#ffff00" ? "#a16207" : lv.color}">${lv.name}</span></div>
            <small>Bấm để xem phân tích chi tiết</small>`);
    }

    // ------------------------------------------------------------------ phát hoạt cảnh
    function tick(ts) {
        st.raf = 0;
        const tab = $("tab-map");
        if (!is3D() || !tab || !tab.classList.contains("active")) { st.lastTs = 0; return; } // Không hiển thị: dừng vẽ
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
            btn.classList.toggle("playing", st.playing);
            btn.setAttribute("aria-label", st.playing ? "Tạm dừng" : "Phát");
        }
        kick();
    }

    function setRotate(on) {
        st.rotate = !!on;
        const chk = $("m3d-rotate");
        if (chk) chk.checked = st.rotate;
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

    // ------------------------------------------------------------------ đồng bộ với bản đồ 2D
    function dayKey(dt) {
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }

    // Mở chế độ 3D luôn ở thời điểm hiện tại (theo đồng hồ hệ thống / dữ liệu mới nhất)
    function syncFrom2D() {
        st.pendingSync = false;
        if (!st.data) return;
        const i = st.data.times.findIndex(t => t >= st.data.observed_until);
        st.frame = i >= 0 ? i : 0;
    }

    // Quay về 2D: nếu giờ đang xem trên 3D nằm trong thanh dự báo 48 giờ của 2D -> 2D nhảy tới đúng giờ đó
    function syncTo2D() {
        if (!st.data || typeof applyTimeStep !== "function" || typeof forecastSeries === "undefined" || !forecastSeries) return;
        const t = st.data.times[Math.round(st.frame)];
        const idx = t ? forecastSeries.times.indexOf(t) : -1;
        if (idx < 0) return;
        const slider = $("time-slider");
        if (slider) {
            slider.value = String(idx);
            if (typeof window.syncRangeFill === "function") window.syncRangeFill(slider);
        }
        applyTimeStep(idx);
    }

    function syncCameraTo2D() {
        const L2 = leaflet();
        if (!L2 || !st.map) return;
        const c = st.map.getCenter();
        L2.setView([c.lat, c.lng], Math.round(st.map.getZoom() + 1), { animate: false });
    }

    function syncCameraFrom2D() {
        const L2 = leaflet();
        if (!L2 || !st.map) return;
        const c = L2.getCenter();
        st.map.jumpTo({ center: [c.lng, c.lat], zoom: L2.getZoom() - 1 });
    }

    function setMode(mode) {
        const want3d = mode === "3d";
        if (want3d === is3D() && (st.map || !want3d)) return;
        st.mode = want3d ? "3d" : "2d";

        const tab = $("tab-map");
        if (tab) tab.classList.toggle("is-3d", want3d);
        [["map3d-wrap", !want3d], ["layers-3d", !want3d], ["panel-playback-3d", !want3d], ["panel-legend-3d", !want3d],
            ["layers-2d", want3d], ["panel-playback", want3d], ["panel-legend", want3d]]
            .forEach(([id, hide]) => { const el = $(id); if (el) el.hidden = hide; });
        document.querySelectorAll("#view-mode [data-view]").forEach(b => {
            const on = b.dataset.view === st.mode;
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", String(on));
        });
        // Đường dẫn chia sẻ được: #map3d mở thẳng chế độ 3D
        if (tab && tab.classList.contains("active")) {
            const hash = want3d ? "#map3d" : "#map";
            if (location.hash !== hash) history.replaceState(null, "", hash);
        }

        if (want3d) {
            if (typeof window.stopPlayback === "function") window.stopPlayback(); // Dừng mô phỏng 2D
            bindControls();
            if (!st.map) {
                if (st.initStarted) return; // Đang khởi tạo (VD mở thẳng #map3d gọi 2 lần)
                st.initStarted = true;
                st.pendingSync = true;
                showLoading("Đang tải bản đồ 3D...");
                loadMapLibre().then(initMap).catch(err => { st.initStarted = false; showError(err); });
            } else {
                syncCameraFrom2D();
                if (st.data) {
                    syncFrom2D();
                    renderFrame(st.frame, true);
                }
                requestAnimationFrame(() => st.map.resize());
                kick();
            }
        } else {
            setPlaying(false);
            setRotate(false);
            if (st.map) {
                syncCameraTo2D();
                syncTo2D();
            }
            const L2 = leaflet();
            if (L2) setTimeout(() => L2.invalidateSize(), 60);
        }
    }

    // ------------------------------------------------------------------ điều khiển
    function bindControls() {
        if (st.controlsBound) return;
        st.controlsBound = true;
        $("m3d-pollutant").addEventListener("change", e => { st.pollutant = e.target.value; loadSeries(); });
        $("m3d-range").addEventListener("change", e => { st.range = e.target.value; loadSeries(); });
        document.querySelectorAll("#m3d-color button").forEach(b => b.addEventListener("click", () => {
            st.colorMode = b.dataset.color;
            document.querySelectorAll("#m3d-color button").forEach(x => x.classList.toggle("active", x === b));
            renderLegend();
            renderFrame(st.frame, true);
        }));
        $("m3d-rotate").addEventListener("change", e => setRotate(e.target.checked));
        $("m3d-play").addEventListener("click", () => setPlaying(!st.playing));
        // Nút tốc độ (cùng kiểu với thanh thời gian 2D); 1× = FRAMES_PER_SECOND khung hình/giây
        st.speed = window.createSpeedControl ? window.createSpeedControl("m3d-speed", "airhcm_3d_speed", v => { st.speed = v; }) : 1;
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
        // Top 5: bấm tên phường -> camera bay tới phường đó
        $("m3d-top").addEventListener("click", e => {
            const li = e.target.closest("li[data-code]");
            const c = li && st.map && st.centers && st.centers[li.dataset.code];
            if (c) st.map.flyTo({ center: c, zoom: Math.max(st.map.getZoom(), 11), duration: 1200 });
        });
    }

    function bindShared() {
        // Nút chế độ xem 2D | 3D
        document.querySelectorAll("#view-mode [data-view]").forEach(b =>
            b.addEventListener("click", () => setMode(b.dataset.view)));
        // Bản đồ nền dùng chung: chọn ở bảng "Bản đồ nền" -> đổi luôn nền 3D
        const sel = $("select-basemap");
        if (sel) sel.addEventListener("change", () => { if (st.map && st.map.isStyleLoaded()) setBasemap(currentBasemap()); });
        // Nút thu phóng (+/-) ở bảng điều khiển: ở chế độ 3D điều khiển camera 3D
        const zoomSlot = $("custom-zoom-slot");
        if (zoomSlot) zoomSlot.addEventListener("click", e => {
            if (!is3D() || !st.map) return;
            const btn = e.target.closest("a, button");
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            if (btn.classList.contains("leaflet-control-zoom-in")) st.map.zoomIn();
            else if (btn.classList.contains("leaflet-control-zoom-out")) st.map.zoomOut();
        }, true);
        // Đổi chuẩn VN_AQI / US AQI ở thanh trên cùng -> cập nhật màu, chú giải 3D
        ["btn-std-vn", "btn-std-us"].forEach(id => {
            const b = $(id);
            if (b) b.addEventListener("click", () => setTimeout(() => {
                if (st.data) { renderLegend(); renderFrame(st.frame, true); }
            }, 30));
        });
        // Tìm kiếm / chọn địa điểm khi đang ở 3D -> camera 3D bay tới địa điểm đó
        if (typeof window.openPlacePanel === "function" && !window.openPlacePanel.__m3d) {
            const original = window.openPlacePanel;
            const wrapped = function (place) {
                const out = original.apply(this, arguments);
                if (is3D() && st.map && place && isFinite(place.lat) && isFinite(place.lng)) {
                    st.map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(st.map.getZoom(), 10.5), duration: 1200 });
                }
                return out;
            };
            wrapped.__m3d = true;
            window.openPlacePanel = wrapped;
        }
    }

    // ------------------------------------------------------------------ API công khai
    window.AirMap3D = {
        setMode,
        // Mở lại tab Bản đồ: căn lại khung 3D, tiếp tục hoạt cảnh
        onTabShow() {
            if (!is3D() || !st.map) return;
            requestAnimationFrame(() => st.map.resize());
            if (location.hash !== "#map3d") history.replaceState(null, "", "#map3d");
            kick();
        },
        reload() {
            if (!st.map) return setMode("3d");
            if (!st.wardsReady) return loadWards().then(loadSeries).catch(showError);
            loadSeries();
        }
    };

    function boot() {
        bindShared();
        if (location.hash === "#map3d" || window.__airhcmStart3D) setMode("3d");
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
