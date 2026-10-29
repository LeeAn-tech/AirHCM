// ==============================================================================
// HỆ THỐNG WEBGIS AIRHCM - JAVASCRIPT ĐIỀU HÀNH BẢN ĐỒ, AI & DSS
// Khoa CNTT - Trường Đại học Tài nguyên & Môi trường TP.HCM (HCMUNRE)
// SVTH: LÊ HOÀNG ÂN - 1250080001 | GVHD: TS. Dương Thị Thúy Nga
// ==============================================================================

// Tự động lấy localhost khi mở trên PC và tự động lấy IP LAN (192.168.1.X) khi mở trên Điện thoại
const API_BASE = `http://${window.location.hostname || "127.0.0.1"}:8000/api/v1`;

let map = null;
let wardsLayer = null;
let selectedWardLayer = null;
let selectedWardFeature = null;
let stationMarkers = [];
let stationDataList = [];
let heatLayer = null;
let userLocationMarker = null;
let forecastChartInstance = null;
let allWardsData = [];
let cachedForecastData = null;
let cachedForecastHours = 24;
let currentAuthMode = 'login'; // 'login' hoặc 'register'
let adminUsersList = [];

let playbackTimer = null;
let currentHourSimulated = new Date().getHours(); // Tự động lấy giờ thực tế lúc mở web (0 - 23)
let latestBasePM25 = 18.5;
let currentWindSpeed = 12.0;    // Tốc độ gió (km/h) thực tế
let currentWindDeg = 150.0;     // Hướng gió (độ góc 0 - 360°) thực tế
let windCanvas = null;
let windCtx = null;
let windAnimationId = null;
let windParticles = [];
let currentAQIStandard = 'VN';
const NUM_WIND_PARTICLES = 160; // Số lượng vệt gió lướt trên bản đồ

// Hệ số biến thiên PM2.5 theo 24 giờ tại TP.HCM (Cao điểm sáng 7-8h, chiều 17-18h)
const DIURNAL_FACTORS = {
    0: 1.15, 1: 1.20, 2: 1.22, 3: 1.25, 4: 1.30, 5: 1.35,
    6: 1.40, 7: 1.55, 8: 1.50, 9: 1.30, 10: 1.10, 11: 0.95,
    12: 0.85, 13: 0.80, 14: 0.82, 15: 0.90, 16: 1.15, 17: 1.45,
    18: 1.50, 19: 1.40, 20: 1.25, 21: 1.15, 22: 1.10, 23: 1.12
};

// Chu kỳ nhiệt độ ERA5 thực tế tại TP.HCM
const HOURLY_TEMP_ERA5 = {
    0: 25.8, 1: 25.4, 2: 25.1, 3: 24.8, 4: 24.6, 5: 25.0,
    6: 26.2, 7: 27.8, 8: 29.5, 9: 31.2, 10: 32.8, 11: 34.0,
    12: 34.8, 13: 35.2, 14: 34.6, 15: 33.5, 16: 31.8, 17: 30.2,
    18: 28.9, 19: 28.0, 20: 27.4, 21: 26.9, 22: 26.4, 23: 26.0
};

// Chỉ số Sol khí Sentinel-5P (AAI) theo mật độ phát thải
const HOURLY_AEROSOL_S5P = {
    0: 0.65, 1: 0.62, 2: 0.60, 3: 0.65, 4: 0.72, 5: 0.80,
    6: 0.98, 7: 1.25, 8: 1.18, 9: 0.92, 10: 0.78, 11: 0.68,
    12: 0.62, 13: 0.58, 14: 0.64, 15: 0.72, 16: 0.96, 17: 1.22,
    18: 1.28, 19: 1.05, 20: 0.88, 21: 0.80, 22: 0.74, 23: 0.68
};
// ==============================================================================
// THUẬT TOÁN TÍNH TOÁN VN_AQI THEO QUYẾT ĐỊNH 1459/QĐ-TCMT (BỘ TN&MT VIỆT NAM)
// ==============================================================================
function calculateVN_AQI(pm) {
    pm = parseFloat(pm);
    if (isNaN(pm) || pm < 0) return 0;
    if (pm <= 25.0) {
        return Math.round((50.0 / 25.0) * pm);
    } else if (pm <= 50.0) {
        return Math.round(((100.0 - 51.0) / (50.0 - 25.1)) * (pm - 25.1) + 51.0);
    } else if (pm <= 80.0) {
        return Math.round(((150.0 - 101.0) / (80.0 - 50.1)) * (pm - 50.1) + 101.0);
    } else if (pm <= 150.0) {
        return Math.round(((200.0 - 151.0) / (150.0 - 80.1)) * (pm - 80.1) + 151.0);
    } else if (pm <= 250.0) {
        return Math.round(((300.0 - 201.0) / (250.0 - 150.1)) * (pm - 150.1) + 201.0);
    } else if (pm <= 500.0) {
        return Math.round(((500.0 - 301.0) / (500.0 - 250.1)) * (pm - 250.1) + 301.0);
    }
    return 500;
}

// Hàm hợp nhất lấy giá trị AQI dựa theo chuẩn đang được người dùng lựa chọn
function getDynamicAQI(pm) {
    return currentAQIStandard === 'VN' ? calculateVN_AQI(pm) : calculateEPA_AQI(pm);
}

function setSafeText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// 1. ĐỊNH DẠNG NGÀY/THÁNG/NĂM GIỜ:PHÚT:GIÂY CHUẨN VIỆT NAM
function getCurrentFormattedTime() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

// 2. BỘ ĐẾM THỜI GIAN THỰC NHẢY TỪNG GIÂY (AN TOÀN TUYỆT ĐỐI)
function initLiveClock() {
    function tick() {
        setSafeText("realtime-clock", getCurrentFormattedTime());
    }
    tick();
    setInterval(tick, 1000);
}

// BẢNG MÀU CHUẨN THEO THANG CHỈ SỐ US AQI / IQAIR (KHỚP VỚI BẢNG CHÚ GIẢI)
function getAQIColor(aqi) {
    if (aqi <= 50) return "#00E400";   // Tốt (Xanh lá)
    if (aqi <= 100) return "#FFFF00";  // Trung bình (Vàng)
    if (aqi <= 150) return "#FF7E00";  // Kém / Nhóm nhạy cảm (Cam)
    if (aqi <= 200) return "#FF0000";  // Xấu / Không lành mạnh (Đỏ)
    if (aqi <= 300) return "#8F3F97";  // Rất xấu (Tím)
    return "#7E0023";                  // Nguy hại (Nâu đỏ)
}

function calculateEPA_AQI(pm) {
    pm = parseFloat(pm);
    if (isNaN(pm) || pm < 0) return 0;
    if (pm <= 12.0) return Math.round((50 / 12.0) * pm);
    if (pm <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.0)) * (pm - 12.0) + 51);
    if (pm <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.4)) * (pm - 35.4) + 101);
    if (pm <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.4)) * (pm - 55.4) + 151);
    if (pm <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.4)) * (pm - 150.4) + 201);
    if (pm <= 350.4) return Math.round(((400 - 301) / (350.4 - 250.4)) * (pm - 250.4) + 301);
    if (pm <= 500.4) return Math.round(((500 - 401) / (500.4 - 350.4)) * (pm - 350.4) + 401);
    return 500;
}

function getAdvisoryForAQI(aqi, pm25) {
    const qcvn = pm25 <= 50.0 ? "Đạt quy chuẩn QCVN 05:2023" : "Vượt ngưỡng QCVN 05:2023";
    if (aqi <= 50) return { level: "Tốt", color: "#00E400", qcvn_comparison: qcvn, general_population: "Không khí trong lành. Hoạt động bình thường ngoài trời.", sensitive_groups: "An toàn cho sức khỏe người nhạy cảm.", action_plan: "Duy trì giám sát môi trường đô thị." };
    if (aqi <= 100) return { level: "Trung bình", color: "#FFFF00", qcvn_comparison: qcvn, general_population: "Chất lượng không khí ở mức chấp nhận được.", sensitive_groups: "Người nhạy cảm nên giảm vận động thể lực kéo dài.", action_plan: "Kiểm tra lưu lượng giao thông cửa ngõ." };
    if (aqi <= 150) return { level: "Kém (nhóm nhạy cảm)", color: "#FF7E00", qcvn_comparison: qcvn, general_population: "Hạn chế tập thể dục gắng sức cạnh đường lớn.", sensitive_groups: "BẮT BUỘC đeo khẩu trang N95 khi ra ngoài.", action_plan: "Khuyến nghị phương tiện che chắn bụi cẩn thận." };
    if (aqi <= 200) return { level: "Xấu (Không lành mạnh)", color: "#FF0000", qcvn_comparison: qcvn, general_population: "Nên hạn chế ra ngoài, đóng kín cửa sổ.", sensitive_groups: "Tránh hoạt động ngoài trời; bật máy lọc không khí.", action_plan: "Kích hoạt phun nước dập bụi tại nút giao thông." };
    return { level: "Rất xấu", color: "#8F3F97", qcvn_comparison: qcvn, general_population: "Hạn chế tối đa ra đường.", sensitive_groups: "Ở trong phòng kín.", action_plan: "Điều tiết luồng giao thông khẩn cấp." };
}

// Trích xuất tên phường và quận từ GeoJSON
function extractWardDetails(properties) {
    if (!properties) return { ward: "Phường/Xã", district: "" };

    const wardKeys = [
        'ten_phuong_xa', 'ten_phuong', 'Ten_Phuong', 'TenPhuong', 'Phuong', 'phuong',
        'NAME_3', 'Name_3', 'name_3', 'VARNAME_3', 'Ward_Name', 'Ward', 'ward',
        'name', 'Name', 'NAME', 'shapeName', 'Ten', 'ten'
    ];
    const districtKeys = [
        'ten_quan_huyen', 'ten_quan', 'Ten_Quan', 'TenQuan', 'Quan', 'quan',
        'NAME_2', 'Name_2', 'name_2', 'VARNAME_2', 'District_Name', 'District', 'district',
        'Huyen', 'huyen'
    ];

    let ward = "";
    for (let k of wardKeys) {
        if (properties[k] && typeof properties[k] === 'string' && properties[k].trim() !== '') {
            ward = properties[k].trim();
            break;
        }
    }

    let district = "";
    for (let k of districtKeys) {
        if (properties[k] && typeof properties[k] === 'string' && properties[k].trim() !== '') {
            district = properties[k].trim();
            break;
        }
    }

    if (!ward) {
        for (let key in properties) {
            const lk = key.toLowerCase();
            if ((lk.includes('phuong') || lk.includes('ward') || lk.includes('name') || lk.includes('ten')) && typeof properties[key] === 'string') {
                ward = properties[key].trim();
                break;
            }
        }
    }
    if (!district) {
        for (let key in properties) {
            const lk = key.toLowerCase();
            if ((lk.includes('quan') || lk.includes('dist') || lk.includes('huyen')) && typeof properties[key] === 'string') {
                district = properties[key].trim();
                break;
            }
        }
    }

    return {
        ward: ward || (properties.id !== undefined ? `Phường ${properties.id}` : "Phường/Xã"),
        district: district || ""
    };
}

// TỰ ĐỘNG NẠP ĐẦY ĐỦ 166 PHƯỜNG/XÃ TP.HCM VÀO FORM ĐĂNG KÝ
function populateWardDropdown(geojsonData) {
    const wardSelect = document.getElementById("sub-ward");
    if (!wardSelect || !geojsonData || !geojsonData.features) return;

    const wardList = [];
    geojsonData.features.forEach(f => {
        const info = extractWardDetails(f.properties);
        const fullName = info.district ? `${info.ward} (${info.district})` : info.ward;
        if (fullName && !wardList.includes(fullName)) {
            wardList.push(fullName);
        }
    });

    wardList.sort((a, b) => a.localeCompare(b, 'vi'));

    wardSelect.innerHTML = `<option value="ALL">⭐ Tất cả khu vực TP.HCM</option>`;
    wardList.forEach(w => {
        wardSelect.innerHTML += `<option value="${w}">${w}</option>`;
    });
}

// THUẬT TOÁN TÍNH TOÁN PM2.5 & AQI ĐỒNG BỘ GIỮA BẢN ĐỒ VÀ TRẠM TRUNG TÂM
function calculateWardAirStats(feature, hour) {
    const props = feature.properties || {};
    const info = extractWardDetails(props);
    const textKey = (info.ward + " " + info.district).toLowerCase();

    let zoneMultiplier = 1.0;
    if (textKey.includes("bình tân") || textKey.includes("quận 8") || textKey.includes("tân phú") || textKey.includes("bình đông")) {
        zoneMultiplier = 1.15;
    } else if (textKey.includes("quận 1") || textKey.includes("quận 3") || textKey.includes("gò vấp") || textKey.includes("bình thạnh")) {
        zoneMultiplier = 1.05;
    } else if (textKey.includes("thủ đức") || textKey.includes("quận 7") || textKey.includes("quận 12")) {
        zoneMultiplier = 1.00;
    } else if (textKey.includes("củ chi") || textKey.includes("cần giờ") || textKey.includes("long phước") || textKey.includes("nhà bè")) {
        zoneMultiplier = 0.82;
    } else {
        zoneMultiplier = 0.95;
    }

    let charHash = 0;
    for (let i = 0; i < textKey.length; i++) {
        charHash = (charHash << 5) - charHash + textKey.charCodeAt(i);
        charHash |= 0;
    }
    const microVariation = 0.94 + ((Math.abs(charHash) % 13) / 100);

    const basePM = latestBasePM25 > 0 ? latestBasePM25 : 22.0;
    const diurnal = DIURNAL_FACTORS[hour] || 1.0;

    const pm25 = parseFloat((basePM * diurnal * zoneMultiplier * microVariation).toFixed(1));
    const aqi = getDynamicAQI(pm25);
    const color = getAQIColor(aqi);
    const advisory = getAdvisoryForAQI(aqi, pm25);

    return { pm25, aqi, color, advisory };
}

function getWardStyleByAQI(feature, hour = currentHourSimulated) {
    const stats = calculateWardAirStats(feature, hour);
    return {
        color: stats.color,
        weight: 1.2,
        opacity: 0.75,
        fillColor: stats.color,
        fillOpacity: 0.35
    };
}

function createIQAirStationIcon(aqi) {
    const color = getAQIColor(aqi);
    const textColor = aqi > 150 ? '#ffffff' : '#0f172a';
    return L.divIcon({
        className: 'iqair-station-wrapper',
        html: `
            <div class="iqair-station-badge" style="background-color: ${color}; color: ${textColor};" title="US AQI: ${aqi}">
                ${aqi}
            </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

function getStationAirStats(st, hour) {
    if (!st) return { pm25: 18.5, aqi: getDynamicAQI(18.5), color: "#FFFF00", advisory: { level: "Trung bình" } };
    const lat = parseFloat(st.lat) || 10.8231;
    const lng = parseFloat(st.lng) || 106.6297;
    const stationHash = Math.abs(Math.sin(lat * 120 + lng * 60)) * 0.20 + 0.90;

    const basePM = latestBasePM25 > 0 ? latestBasePM25 : 22.0;
    const diurnal = DIURNAL_FACTORS[hour] || 1.0;

    const pm25 = parseFloat((basePM * diurnal * stationHash).toFixed(1));
    const aqi = getDynamicAQI(pm25);
    const color = getAQIColor(aqi);
    const advisory = getAdvisoryForAQI(aqi, pm25);
    return { pm25, aqi, color, advisory };
}

// ==============================================================================
// KHỞI TẠO DOM CONTENT LOADED
// ==============================================================================
document.addEventListener("DOMContentLoaded", () => {
    initNavigationTabs();
    initLeafletMap();
    preventLeafletInterference();

    // 1. Chạy đồng hồ độc lập
    initLiveClock();
    initWindLayer();

    // 2. Nạp dữ liệu các phân hệ
    fetchCurrentAQI();
    fetchStations();
    fetchWardsGeoJSON();
    fetchHourlyForecast(24);
    fetchHotspotsSummary();

    // 3. Khởi tạo tính năng tương tác
    initGPSFeature();
    initLayerControls();
    initPlaybackFeature();
    initAQIEvaluator();
    initSubscribeForm();
    // 4. Cập nhật tính năng admin
    updateAdminButtonState();

    // Khởi tạo kịch bản What-If ban đầu
    if (typeof window.runScenarioSimulation === "function") {
        window.runScenarioSimulation();
    }
    if (typeof window.updatePersonalAdvisory === "function") {
        window.updatePersonalAdvisory();
    }
});

function preventLeafletInterference() {
    const panels = document.querySelectorAll('.panel, .btn-gps, .floating-top-right-controls');
    panels.forEach(p => {
        if (p && typeof L !== 'undefined' && L.DomEvent) {
            L.DomEvent.disableClickPropagation(p);
            L.DomEvent.disableScrollPropagation(p);
        }
    });
}

// ==============================================================================
// ĐIỀU HƯỚNG SPA ROUTER CHUẨN HIỆN ĐẠI (TỰ ĐỔI URL THEO TRANG KHÔNG CẦN F5)
// ==============================================================================
function initNavigationTabs() {
    // 1. Lắng nghe sự kiện click trên Sidebar
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const targetId = item.getAttribute("data-tab");
            switchTab(targetId);

            // Tự động đẩy URL hash lên thanh địa chỉ (vd: #forecast, #dss, #map)
            const routeName = targetId.replace("tab-", "");
            if (window.location.hash !== `#${routeName}`) {
                history.pushState(null, null, `#${routeName}`);
            }
        });
    });

    // 2. Tự động kích hoạt tab dựa theo URL khi người dùng truy cập trực tiếp
    function routeFromURL() {
        const hash = window.location.hash.replace("#", "");
        const validRoutes = ["map", "forecast", "dss", "hotspots", "subscribe", "about", "news"];
        const selectedRoute = validRoutes.includes(hash) ? hash : "map";
        switchTab(`tab-${selectedRoute}`);
    }

    // 3. Xử lý khi bấm nút Back / Forward trên trình duyệt
    window.addEventListener("popstate", routeFromURL);

    // Kích hoạt tuyến đường ban đầu
    routeFromURL();
}

function switchTab(targetId) {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));

    const activeNav = document.querySelector(`.nav-item[data-tab="${targetId}"]`);
    const activeContent = document.getElementById(targetId);

    if (activeNav) activeNav.classList.add("active");
    if (activeContent) activeContent.classList.add("active");

    // Tự động căn chỉnh lại kích thước bản đồ khi mở Tab Map
    if (targetId === "tab-map" && map) {
        setTimeout(() => map.invalidateSize(), 150);
    }

    // Tự động kích hoạt kịch bản What-If khi mở Tab DSS
    if (targetId === "tab-dss" && typeof window.runScenarioSimulation === "function") {
        window.runScenarioSimulation();
    }
}

function initLeafletMap() {
    map = L.map("map", { zoomControl: true }).setView([10.8231, 106.6297], 11);

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { attribution: '&copy; Esri &copy; HCMUNRE', maxZoom: 16 }
    ).addTo(map);

    const zoomSlot = document.getElementById("custom-zoom-slot");
    const zoomControlElement = document.querySelector(".leaflet-control-zoom");
    if (zoomSlot && zoomControlElement) {
        zoomSlot.appendChild(zoomControlElement);
    }
}

function fetchCurrentAQI() {
    fetch(`${API_BASE}/aqi/current`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi API: " + res.status);
            return res.json();
        })
        .then(data => {
            // Cơ chế phòng thủ: nếu thiếu trường nào sẽ lấy giá trị hợp lệ, không bao giờ bị undefined hay NaN
            const pm25 = (data.pm2_5 !== undefined && data.pm2_5 !== null) ? parseFloat(data.pm2_5) : 18.5;
            const pm10 = (data.pm10 !== undefined && data.pm10 !== null) ? parseFloat(data.pm10) : parseFloat((pm25 * 1.35).toFixed(1));
            const aqi = getDynamicAQI(pm25);
            const aqiLabelEl = document.querySelector("#aqi-indicator-circle small");
            if (aqiLabelEl) aqiLabelEl.innerText = currentAQIStandard === 'VN' ? "VN_AQI" : "US AQI";
            let tempC = (data.temperature_2m !== undefined && data.temperature_2m !== null) ? data.temperature_2m : 31.5;

            if (tempC > 100) tempC = (tempC - 273.15).toFixed(1);
            else tempC = Number(tempC).toFixed(1);

            latestBasePM25 = pm25;

            setSafeText("realtime-clock", getCurrentFormattedTime());
            setSafeText("current-aqi", aqi);
            setSafeText("current-pm25", `${pm25.toFixed(1)} µg/m³`);
            setSafeText("current-pm10", `${pm10.toFixed(1)} µg/m³`);
            setSafeText("current-temp", `${tempC} °C`);
            setSafeText("current-aerosol", `${HOURLY_AEROSOL_S5P[currentHourSimulated] || 0.75} AAI`);

            const aqiColor = data.advisory ? data.advisory.color : getAQIColor(aqi);
            const levelText = data.advisory ? data.advisory.level : (aqi <= 50 ? "Tốt" : aqi <= 100 ? "Trung bình" : "Kém");

            const badge = document.getElementById("current-aqi-level");
            if (badge) {
                badge.textContent = levelText;
                badge.style.backgroundColor = aqiColor;
                badge.style.color = aqi > 100 && aqi <= 200 ? "#000" : (aqi > 200 ? "#fff" : "#000");
                if (aqi > 50 && aqi <= 100) {
                    badge.style.backgroundColor = "#fef08a";
                    badge.style.color = "#854d0e";
                    badge.style.border = "1px solid #facc15";
                }
            }

            const aqiCircle = document.getElementById("aqi-indicator-circle");
            if (aqiCircle) aqiCircle.style.borderColor = (aqi > 50 && aqi <= 100) ? "#eab308" : aqiColor;

            const qcvnTag = document.getElementById("qcvn-tag");
            if (qcvnTag) qcvnTag.textContent = data.advisory ? data.advisory.qcvn_comparison : (pm25 <= 50 ? "Đạt quy chuẩn QCVN 05:2023" : "Vượt ngưỡng QCVN 05:2023");

            // Cập nhật thông số gió thật
            if (data.wind_speed) currentWindSpeed = parseFloat(data.wind_speed);
            if (data.wind_direction) currentWindDeg = parseFloat(data.wind_direction);
            startWindAnimation();
        })
        .catch(err => {
            console.error("Lỗi nạp current AQI:", err);
            // Dữ liệu an toàn hiển thị khi API có sự cố mạng
            setSafeText("realtime-clock", getCurrentFormattedTime());
            setSafeText("current-aqi", "68");
            setSafeText("current-pm25", "20.5 µg/m³");
            setSafeText("current-pm10", "27.6 µg/m³");
            setSafeText("current-temp", "31.5 °C");
            const badge = document.getElementById("current-aqi-level");
            if (badge) {
                badge.textContent = "Trung bình";
                badge.style.backgroundColor = "#fef08a";
                badge.style.color = "#854d0e";
            }
        });
}

function fetchStations() {
    fetch(`${API_BASE}/gis/stations`)
        .then(res => res.json())
        .then(stations => {
            stationDataList = stations;
            stationMarkers.forEach(item => {
                if (item && item.marker) map.removeLayer(item.marker);
            });
            stationMarkers = [];

            stations.forEach(st => {
                const lat = parseFloat(st.lat);
                const lng = parseFloat(st.lng);
                if (isNaN(lat) || isNaN(lng)) return;

                const stats = getStationAirStats(st, currentHourSimulated);
                const marker = L.marker([lat, lng], {
                    icon: createIQAirStationIcon(stats.aqi)
                }).addTo(map);

                marker.bindPopup(`
                    <div style="color: #0f172a; font-size: 13px; min-width: 200px; font-family:'Plus Jakarta Sans',sans-serif;">
                        <h4 style="margin:0 0 4px 0; color:#0284c7;"><i class="fa-solid fa-tower-broadcast"></i> ${st.ten_tram}</h4>
                        <p style="margin:2px 0;"><b>Mã trạm:</b> ${st.ma_tram}</p>
                        <p style="margin:2px 0;"><b>Đơn vị:</b> ${st.don_vi_quan_ly}</p>
                        <p style="margin:2px 0;"><b>Tọa độ:</b> ${lat.toFixed(4)}N, ${lng.toFixed(4)}E</p>
                        <hr style="margin:6px 0; border:0; border-top:1px solid #e2e8f0;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Chỉ số US AQI:</span>
                            <b style="color:${stats.color}; font-size:15px;">${stats.aqi} (${stats.advisory.level})</b>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                            <span>Bụi mịn PM2.5:</span>
                            <b style="color:#0284c7;">${stats.pm25} µg/m³</b>
                        </div>
                    </div>
                `);

                stationMarkers.push({ marker: marker, data: st });
            });

            updateHeatmapLayer(currentHourSimulated);
        })
        .catch(err => {
            console.error("Lỗi nạp trạm từ API:", err);
        });
}

function updateStationMarkersHour(hour) {
    if (!stationMarkers || stationMarkers.length === 0) return;
    stationMarkers.forEach(item => {
        if (!item || !item.data || !item.marker) return;
        const stats = getStationAirStats(item.data, hour);
        item.marker.setIcon(createIQAirStationIcon(stats.aqi));
    });
}

function fetchWardsGeoJSON() {
    fetch('assets/data/hcm_wards.json')
        .then(res => {
            if (!res.ok) throw new Error("Không tìm thấy file assets/data/hcm_wards.json");
            return res.json();
        })
        .then(geojson => {
            // TỰ ĐỘNG ĐẾM VÀ ĐỒNG BỘ CHÍNH XÁC SỐ LƯỢNG PHƯỜNG/XÃ THỰC TẾ
            const totalWards = geojson.features ? geojson.features.length : 167;
            const hotspotSubtitle = document.querySelector("#tab-hotspots .panel-header p");
            if (hotspotSubtitle) {
                hotspotSubtitle.innerText = `Xếp hạng mức độ ô nhiễm không khí tại ${totalWards} Phường/Xã/Thị trấn (Mô hình Vùng đô thị TP.HCM mở rộng)`;
            }

            populateWardDropdown(geojson);
            if (wardsLayer) map.removeLayer(wardsLayer);

            wardsLayer = L.geoJSON(geojson, {
                style: function (feature) {
                    return getWardStyleByAQI(feature, currentHourSimulated);
                },
                onEachFeature: (feature, layer) => {
                    const info = extractWardDetails(feature.properties);

                    layer.bindTooltip(`<b>${info.ward}</b>${info.district ? `<br><small>${info.district}</small>` : ''}`, {
                        sticky: true,
                        direction: 'top'
                    });

                    layer.on({
                        mouseover: function (e) {
                            const l = e.target;
                            if (l !== selectedWardLayer) {
                                l.setStyle({ weight: 2.4, opacity: 1.0, fillOpacity: 0.55 });
                            }
                        },
                        mouseout: function (e) {
                            const l = e.target;
                            if (l !== selectedWardLayer) {
                                l.setStyle(getWardStyleByAQI(feature, currentHourSimulated));
                            }
                        },
                        click: function (e) {
                            L.DomEvent.stopPropagation(e);

                            if (selectedWardLayer && selectedWardFeature) {
                                selectedWardLayer.setStyle(getWardStyleByAQI(selectedWardFeature, currentHourSimulated));
                            }

                            selectedWardLayer = layer;
                            selectedWardFeature = feature;

                            layer.setStyle({
                                color: "#facc15",
                                weight: 3.2,
                                opacity: 1.0,
                                fillColor: "#eab308",
                                fillOpacity: 0.65
                            });
                            layer.bringToFront();

                            updateSelectedWardPopup(currentHourSimulated);
                            layer.openPopup(e.latlng);
                        }
                    });
                }
            });

            const chkWards = document.getElementById("chk-wards");
            if (!chkWards || chkWards.checked) {
                wardsLayer.addTo(map);
                wardsLayer.bringToBack();
            }
        })
        .catch(err => console.error("Lỗi tải GeoJSON:", err));
}

window.loadForecast = function (hours, evt) {
    if (evt && evt.target) {
        document.querySelectorAll('.forecast-controls .btn-forecast').forEach(btn => btn.classList.remove('active'));
        evt.target.classList.add('active');
    }
    fetchHourlyForecast(hours);
};

function fetchHourlyForecast(hours = 24) {
    fetch(`${API_BASE}/forecast/hourly?hours=${hours}`)
        .then(res => {
            if (!res.ok) throw new Error("Mã lỗi máy chủ: " + res.status);
            return res.json();
        })
        .then(forecastData => {
            // Đảm bảo dữ liệu nhận được là mảng hợp lệ
            if (Array.isArray(forecastData) && forecastData.length > 0) {
                renderForecastView(forecastData, hours);
            } else {
                throw new Error("Dữ liệu dự báo trả về không đúng định dạng mảng");
            }
        })
        .catch(err => {
            console.warn("Kích hoạt bộ mô phỏng dự báo AI dự phòng:", err);
            const fallbackData = [];
            const now = new Date();
            const count = hours; // Dự báo đúng số giờ được yêu cầu (24h, 72h hoặc 168h)

            for (let i = 1; i <= count; i++) {
                const stepDate = new Date(now.getTime() + i * 3600 * 1000);
                const yyyy = stepDate.getFullYear();
                const mm = String(stepDate.getMonth() + 1).padStart(2, '0');
                const dd = String(stepDate.getDate()).padStart(2, '0');
                const hh = String(stepDate.getHours()).padStart(2, '0');

                const timeStr = `${yyyy}-${mm}-${dd} ${hh}:00`;
                const hourOfDay = stepDate.getHours();

                // Chu kỳ ngày đêm thực nghiệm tại TP.HCM
                const factor = DIURNAL_FACTORS[hourOfDay] || 1.0;
                const basePM = 22.0;
                const wave = 1.0 + 0.06 * Math.sin(i * 0.26);
                const pm25 = parseFloat((basePM * factor * wave).toFixed(2));
                const aqi = calculateEPA_AQI(pm25);
                const advisory = getAdvisoryForAQI(aqi, pm25);

                fallbackData.push({
                    time: timeStr,
                    pm2_5: pm25,
                    pm10: parseFloat((pm25 * 1.36).toFixed(2)),
                    aqi: aqi,
                    level: advisory.level
                });
            }
            renderForecastView(fallbackData, hours);
        });
}

function renderForecastView(forecastData, hours) {
    if (!forecastData || forecastData.length === 0) return;

    // Lưu dữ liệu vào cache để phục vụ chuyển đổi nhanh VN_AQI / US AQI
    cachedForecastData = forecastData;
    cachedForecastHours = hours;

    // 1. Tự động tính toán lại mảng AQI theo đúng chuẩn đang kích hoạt (VN hoặc US)
    forecastData.forEach(item => {
        item.pm2_5 = parseFloat(item.pm2_5);
        item.aqi = getDynamicAQI(item.pm2_5);
        const adv = getAdvisoryForAQI(item.aqi, item.pm2_5);
        item.level = adv.level;
    });

    // 2. Tìm điểm đỉnh PM2.5 và AQI
    let peakItem = forecastData[0];
    forecastData.forEach(item => {
        if (item.pm2_5 > peakItem.pm2_5) peakItem = item;
    });

    setSafeText("kpi-peak-pm25", `${peakItem.pm2_5.toFixed(2)} µg/m³`);
    setSafeText("kpi-peak-time", `Khung: ${peakItem.time}`);
    setSafeText("kpi-peak-aqi", `${peakItem.aqi} (${peakItem.level || 'TB'})`);

    // Đồng bộ nhãn chuẩn môi trường bên dưới thẻ KPI
    const peakStdEl = document.getElementById("kpi-peak-standard");
    if (peakStdEl) {
        peakStdEl.innerText = currentAQIStandard === 'VN'
            ? "QĐ 1459/QĐ-TCMT (Việt Nam)"
            : "Chuẩn US EPA (Hoa Kỳ)";
    }

    // 3. Render Bảng chi tiết chuỗi số liệu theo giờ
    const tbody = document.getElementById("forecast-table-body");
    if (tbody) {
        tbody.innerHTML = "";
        forecastData.forEach(item => {
            const aqiVal = parseInt(item.aqi);

            let aqiTextColor = "#16a34a";
            let badgeBg = "#dcfce7";
            let badgeBorder = "#86efac";
            let badgeText = "#166534";

            if (aqiVal > 50 && aqiVal <= 100) {
                aqiTextColor = "#b45309";
                badgeBg = "#fef3c7";
                badgeBorder = "#fde047";
                badgeText = "#854d0e";
            } else if (aqiVal > 100 && aqiVal <= 150) {
                aqiTextColor = "#c2410c";
                badgeBg = "#ffedd5";
                badgeBorder = "#fdba74";
                badgeText = "#9a3412";
            } else if (aqiVal > 150 && aqiVal <= 200) {
                aqiTextColor = "#dc2626";
                badgeBg = "#fee2e2";
                badgeBorder = "#fca5a5";
                badgeText = "#991b1b";
            } else if (aqiVal > 200) {
                aqiTextColor = "#7e22ce";
                badgeBg = "#f3e8ff";
                badgeBorder = "#d8b4fe";
                badgeText = "#6b21a8";
            }

            const isStandard = item.pm2_5 <= 50;
            const qcvnBadge = isStandard
                ? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;"><i class="fa-solid fa-check"></i> Dưới ngưỡng 24h</span>`
                : `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;"><i class="fa-solid fa-triangle-exclamation"></i> Trên ngưỡng 24h</span>`;

            const row = `
                <tr>
                    <td style="font-weight: 600; color: #0f172a;">${item.time}</td>
                    <td style="color: #0284c7; font-weight: 700; text-align: center;">${item.pm2_5.toFixed(2)} µg/m³</td>
                    <td style="color: #475569; font-weight: 600; text-align: center;">${item.pm10 ? parseFloat(item.pm10).toFixed(2) : (item.pm2_5 * 1.35).toFixed(2)} µg/m³</td>
                    <td style="text-align: center;"><b style="color: ${aqiTextColor}; font-size: 15px; font-weight: 800;">${item.aqi}</b></td>
                    <td style="text-align: center;">
                        <span style="background: ${badgeBg}; color: ${badgeText}; border: 1px solid ${badgeBorder}; padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 11.5px; display: inline-block;">
                            ${item.level || 'Bình thường'}
                        </span>
                    </td>
                    <td style="text-align: center;">${qcvnBadge}</td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    }

    // 4. Định dạng nhãn trục hoành X
    const labels = forecastData.map(item => {
        if (hours > 24 && item.time.includes(" ")) {
            const parts = item.time.split(" ");
            const dateParts = parts[0].split("-");
            return `${parts[1]} (${dateParts[2]}/${dateParts[1]})`;
        }
        return item.time.includes(" ") ? item.time.split(" ")[1] : item.time;
    });

    const pm25Values = forecastData.map(item => item.pm2_5);
    const aqiValues = forecastData.map(item => item.aqi);

    const canvas = document.getElementById("forecastChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (forecastChartInstance) forecastChartInstance.destroy();

    // 5. CẤU HÌNH BIỂU ĐỒ TỰ ĐỘNG THAY ĐỔI THEO CHUẨN ĐANG CHỌN (VN_AQI / US AQI)
    const aqiDatasetLabel = currentAQIStandard === 'VN' ? "Chỉ số VN_AQI (QĐ 1459)" : "Chỉ số US AQI (EPA)";
    const aqiAxisTitle = currentAQIStandard === 'VN' ? "Chỉ số VN_AQI" : "Chỉ số US AQI";

    forecastChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Nồng độ PM2.5 (µg/m³)",
                    data: pm25Values,
                    yAxisID: "yPM",
                    borderColor: "#0284c7",
                    backgroundColor: "rgba(2, 132, 199, 0.12)",
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: hours <= 24 ? 3 : 1.5
                },
                {
                    label: aqiDatasetLabel, // ĐỔI ĐỘNG TÊN LABEL DATASET
                    data: aqiValues,
                    yAxisID: "yAQI",
                    borderColor: "#d97706",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    borderDash: [5, 4],
                    tension: 0.35,
                    pointRadius: hours <= 24 ? 3.5 : 2,
                    pointBackgroundColor: "#d97706"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: {
                        color: "#1e293b",
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '700' }
                    }
                },
                tooltip: {
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    titleColor: "#38bdf8",
                    bodyColor: "#ffffff",
                    borderColor: "#cbd5e1",
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#475569",
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: hours <= 24 ? 12 : 18
                    },
                    grid: { color: "rgba(0, 0, 0, 0.05)" }
                },
                yAQI: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: aqiAxisTitle, // ĐỔI ĐỘNG TIÊU ĐỀ TRỤC Y BÊN TRÁI
                        color: '#d97706',
                        font: { weight: 'bold', size: 12 }
                    },
                    ticks: { color: "#d97706" },
                    suggestedMin: 0,
                    suggestedMax: 160,
                    grid: { color: "rgba(0, 0, 0, 0.06)" }
                },
                yPM: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'PM2.5 (µg/m³)', color: '#0284c7', font: { weight: 'bold', size: 12 } },
                    ticks: { color: "#0284c7" },
                    suggestedMin: 0,
                    suggestedMax: 45,
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

function fetchHotspotsSummary() {
    fetch(`${API_BASE}/aqi/spatial-summary`)
        .then(res => res.json())
        .then(wards => {
            allWardsData = wards;
            renderHotspotsTable(wards);
        })
        .catch(err => {
            const mockWards = [
                { ma_phuong_xa: "27424", ten_phuong_xa: "Bình Đông (Quận 8)", dien_tich_km2: "12.4", so_luong_tram: 2, pm2_5_trung_binh: 22.4 },
                { ma_phuong_xa: "27457", ten_phuong_xa: "Tân Tạo (Bình Tân)", dien_tich_km2: "14.7", so_luong_tram: 3, pm2_5_trung_binh: 24.8 },
                { ma_phuong_xa: "27022", ten_phuong_xa: "Phú Thọ Hòa (Tân Phú)", dien_tich_km2: "3.0", so_luong_tram: 1, pm2_5_trung_binh: 20.1 },
                { ma_phuong_xa: "26857", ten_phuong_xa: "Long Phước (Thủ Đức)", dien_tich_km2: "34.2", so_luong_tram: 1, pm2_5_trung_binh: 14.5 },
                { ma_phuong_xa: "25915", ten_phuong_xa: "Củ Chi Center", dien_tich_km2: "73.6", so_luong_tram: 1, pm2_5_trung_binh: 12.0 }
            ];

            mockWards.forEach(w => {
                w.aqi_trung_binh = calculateEPA_AQI(w.pm2_5_trung_binh);
            });

            allWardsData = mockWards;
            renderHotspotsTable(mockWards);
        });
}

function renderHotspotsTable(data) {
    const tbody = document.getElementById("hotspots-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    data.forEach((w, index) => {
        const pm = parseFloat(w.pm2_5_trung_binh);
        const aqi = getDynamicAQI(pm);
        const color = getAQIColor(aqi);
        const advisory = getAdvisoryForAQI(aqi, pm);

        const row = `
            <tr>
                <td>${index + 1}</td>
                <td><b>${w.ma_phuong_xa}</b></td>
                <td>${w.ten_phuong_xa}</td>
                <td>${w.dien_tich_km2} km²</td>
                <td><span style="background: rgba(56,189,248,0.15); color: #38bdf8; padding: 3px 8px; border-radius: 4px; font-weight:600;">${w.so_luong_tram || 1} trạm</span></td>
                <td style="color: #38bdf8; font-weight: 700;">${pm} µg/m³</td>
                <td><b style="color: ${color}; font-size: 15px;">${aqi}</b></td>
                <td>
                    <span style="background: ${color}; color: ${aqi > 150 ? '#fff' : '#000'}; padding: 4px 10px; border-radius: 12px; font-weight: 700; font-size: 11px;">
                        ${advisory.level}
                    </span>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

window.filterWards = function () {
    const term = document.getElementById("search-ward").value.toLowerCase();
    const filtered = allWardsData.filter(w =>
        w.ten_phuong_xa.toLowerCase().includes(term) || w.ma_phuong_xa.includes(term)
    );
    renderHotspotsTable(filtered);
};

function initAQIEvaluator() {
    const slider = document.getElementById("eval-aqi-slider");
    const valDisplay = document.getElementById("eval-aqi-val");
    const resultBox = document.getElementById("eval-result-box");

    if (!slider || !resultBox) return;

    if (typeof L !== 'undefined' && L.DomEvent) {
        L.DomEvent.disableClickPropagation(slider);
        L.DomEvent.disableScrollPropagation(slider);
    }

    function updateEvaluator() {
        const aqi = parseInt(slider.value);
        const pm25 = (aqi * 0.35).toFixed(1);
        const advisory = getAdvisoryForAQI(aqi, pm25);

        if (valDisplay) {
            valDisplay.innerText = aqi;
            valDisplay.style.color = advisory.color;
        }

        resultBox.style.borderLeftColor = advisory.color;
        resultBox.innerHTML = `
            <b style="color:${advisory.color}">Khuyến cáo Mức ${advisory.level} (US AQI: ${aqi}) - PM2.5 ≈ ${pm25} µg/m³:</b><br>
            • <b>Dân cư:</b> ${advisory.general_population}<br>
            • <b>Nhóm nhạy cảm:</b> ${advisory.sensitive_groups}<br>
            • <b>Ứng phó đô thị:</b> ${advisory.action_plan}
        `;
    }

    slider.addEventListener("input", updateEvaluator);
    slider.addEventListener("change", updateEvaluator);
    updateEvaluator();
}

// ==============================================================================
// KHỞI TẠO TÍNH NĂNG PLAYBACK 24H (CHỐNG LỖI KẸT TIMER SAU KHI SLEEP MÁY)
// ==============================================================================
function initPlaybackFeature() {
    const slider = document.getElementById("time-slider");
    const btnPlay = document.getElementById("btn-play-pause");
    const playIcon = document.getElementById("play-icon");

    if (!slider || !btnPlay) return;

    // 1. Tự động nhảy thanh thời gian về đúng mốc giờ thực tế hiện tại
    const currentActualHour = new Date().getHours();
    currentHourSimulated = currentActualHour;
    slider.value = currentActualHour;
    applyTimeStep(currentActualHour);

    // Kéo thanh trượt bằng tay
    slider.addEventListener("input", e => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) applyTimeStep(val);
    });

    // Hàm dừng chạy timer an toàn
    window.stopPlayback = function () {
        if (playbackTimer) {
            clearInterval(playbackTimer);
            playbackTimer = null;
        }
        if (playIcon) playIcon.className = "fa-solid fa-play";
        btnPlay.classList.remove("playing");
    };

    // Hàm bắt đầu chạy timer
    window.startPlayback = function () {
        if (playbackTimer) clearInterval(playbackTimer);

        if (playIcon) playIcon.className = "fa-solid fa-pause";
        btnPlay.classList.add("playing");

        playbackTimer = setInterval(() => {
            let currentVal = parseInt(slider.value);
            if (isNaN(currentVal)) currentVal = 0;

            let nextHour = (currentVal + 1) % 24; // Luôn xoay vòng 0 -> 23 không bao giờ bị NaN
            slider.value = nextHour;
            applyTimeStep(nextHour);
        }, 1000);
    };

    // Sự kiện click nút Play / Pause
    btnPlay.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();

        if (playbackTimer) {
            window.stopPlayback();
        } else {
            window.startPlayback();
        }
    });
}

function applyTimeStep(hour) {
    currentHourSimulated = hour;
    setSafeText("playback-time-label", `${String(hour).padStart(2, '0')}:00`);

    let periodName = "Sáng";
    let periodText = "Hoạt động giao thông bình thường";

    if (hour >= 0 && hour <= 5) {
        periodName = "Đêm/Sáng sớm";
        periodText = "Nghịch nhiệt bức xạ mặt đất - Khí quyển lắng đọng";
    } else if (hour >= 6 && hour <= 9) {
        periodName = "Cao điểm Sáng";
        periodText = "Ùn tắc giao thông sáng - Ô nhiễm PM2.5 & bụi đường tăng vọt";
    } else if (hour >= 10 && hour <= 15) {
        periodName = "Buổi Trưa";
        periodText = "Bức xạ nhiệt mạnh - Bụi mịn xáo trộn & nhiệt độ cao nhất ngày";
    } else if (hour >= 16 && hour <= 19) {
        periodName = "Cao điểm Chiều";
        periodText = "Giờ tan tầm - Mật độ xe cộ và phát thải khí quyển cực đại";
    } else {
        periodName = "Ban Đêm";
        periodText = "Xe tải nặng liên tỉnh & Hoạt động công nghiệp ven đô";
    }

    setSafeText("playback-badge", periodName);
    setSafeText("playback-period-desc", periodText);

    const factor = DIURNAL_FACTORS[hour] || 1.0;
    const simPM25 = parseFloat((latestBasePM25 * factor).toFixed(1));
    const simAQI = getDynamicAQI(simPM25); // Tự động tính theo VN_AQI hoặc US AQI
    const aqiColor = getAQIColor(simAQI);
    const advisory = getAdvisoryForAQI(simAQI, simPM25);

    const isRushHour = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19);
    const pm10Ratio = isRushHour ? 1.55 : 1.35;
    const simPM10 = (simPM25 * pm10Ratio).toFixed(1);

    const simTemp = (HOURLY_TEMP_ERA5[hour] || 28.5).toFixed(1);
    const simAerosol = (HOURLY_AEROSOL_S5P[hour] || 0.75).toFixed(2);

    setSafeText("current-pm25", `${simPM25} µg/m³`);
    setSafeText("current-pm10", `${simPM10} µg/m³`);
    setSafeText("current-temp", `${simTemp} °C`);
    setSafeText("current-aerosol", `${simAerosol} AAI`);
    setSafeText("current-aqi", simAQI);

    const levelBadge = document.getElementById("current-aqi-level");
    if (levelBadge) {
        levelBadge.textContent = advisory.level;
        levelBadge.style.backgroundColor = aqiColor;
        levelBadge.style.color = simAQI > 150 ? "#fff" : "#000";
        if (simAQI > 50 && simAQI <= 100) {
            levelBadge.style.backgroundColor = "#fef08a";
            levelBadge.style.color = "#854d0e";
            levelBadge.style.border = "1px solid #facc15";
        } else {
            levelBadge.style.border = "none";
        }
    }

    const aqiCircle = document.getElementById("aqi-indicator-circle");
    if (aqiCircle) {
        aqiCircle.style.borderColor = (simAQI > 50 && simAQI <= 100) ? "#eab308" : aqiColor;
    }

    const aqiSmallLabel = document.querySelector("#aqi-indicator-circle small");
    if (aqiSmallLabel) {
        aqiSmallLabel.innerText = currentAQIStandard === 'VN' ? "VN_AQI" : "US AQI";
    }

    const qcvnTag = document.getElementById("qcvn-tag");
    if (qcvnTag) qcvnTag.textContent = advisory.qcvn_comparison;

    // 1. Cập nhật ranh giới phường an toàn
    try {
        if (wardsLayer) {
            wardsLayer.eachLayer(layer => {
                if (layer !== selectedWardLayer && layer.feature) {
                    layer.setStyle(getWardStyleByAQI(layer.feature, hour));
                }
            });
        }
    } catch (err) {
        console.warn("Cảnh báo render ranh giới:", err);
    }

    // 2. Cập nhật trạm quan trắc an toàn
    try {
        updateStationMarkersHour(hour);
    } catch (err) {
        console.warn("Cảnh báo render trạm:", err);
    }

    // 3. Cập nhật popup đang chọn (nếu có)
    try {
        if (selectedWardLayer && selectedWardLayer.isPopupOpen()) {
            updateSelectedWardPopup(hour);
        }
    } catch (err) { }

    // 4. Cập nhật bản đồ nhiệt an toàn
    try {
        updateHeatmapLayer(hour);
    } catch (err) {
        console.warn("Cảnh báo render heatmap:", err);
    }
} // Dấu đóng ngoặc kết thúc hàm applyTimeStep


function updateHeatmapLayer(hour) {
    if (!map) return;
    try {
        const factor = DIURNAL_FACTORS[hour] || 1.0;
        const heatPoints = [];

        stationMarkers.forEach(item => {
            if (item && item.marker) {
                const pos = item.marker.getLatLng();
                heatPoints.push([pos.lat, pos.lng, Math.min(1.0, 0.5 * factor)]);
            }
        });

        const hotspots = [
            [10.7769, 106.7009, 0.60 * factor],
            [10.7540, 106.6634, 0.75 * factor],
            [10.7483, 106.6022, 0.90 * factor],
            [10.8494, 106.7583, 0.70 * factor],
            [10.8231, 106.6297, 0.65 * factor]
        ];

        hotspots.forEach(pt => heatPoints.push(pt));

        if (heatLayer && map.hasLayer(heatLayer)) {
            heatLayer.setLatLngs(heatPoints);
        } else if (typeof L.heatLayer !== 'undefined') {
            heatLayer = L.heatLayer(heatPoints, {
                radius: 55, blur: 35, maxZoom: 14, max: 1.0,
                gradient: { 0.20: '#00E400', 0.40: '#FFFF00', 0.60: '#FF7E00', 0.80: '#FF0000', 1.00: '#8F3F97' }
            }).addTo(map);
        }
    } catch (err) {
        console.warn("Tự phục hồi Heatmap sau khi Wake-up:", err);
        if (heatLayer && map) {
            try { map.removeLayer(heatLayer); } catch (e) { }
            heatLayer = null;
        }
    }
}

function initGPSFeature() {
    const btnLocate = document.getElementById("btn-locate");
    if (!btnLocate) return;

    btnLocate.addEventListener("click", e => {
        e.preventDefault();
        btnLocate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tìm...';

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;

                    if (userLocationMarker) map.removeLayer(userLocationMarker);
                    map.flyTo([lat, lng], 14, { duration: 1.5 });

                    userLocationMarker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'user-gps-marker',
                            html: '<div style="background:#ef4444;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px #ef4444;"></div>',
                            iconSize: [20, 20]
                        })
                    }).addTo(map);

                    userLocationMarker.bindPopup(`
                        <div style="font-size:13px; color:#0f172a;">
                            <b><i class="fa-solid fa-location-dot"></i> Vị trí của bạn</b><br>
                            Tọa độ: ${lat.toFixed(4)}N, ${lng.toFixed(4)}E<br>
                            <span style="display:inline-block; margin-top:5px; padding:3px 8px; background:#dcfce7; color:#166534; border-radius:4px; font-weight:600;">
                                Khuyến nghị: Đeo khẩu trang khi đi đường lớn
                            </span>
                        </div>
                    `).openPopup();

                    btnLocate.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Vị trí của tôi';
                },
                err => {
                    alert("Tự động chọn vị trí trung tâm Q.1.");
                    map.flyTo([10.7769, 106.7009], 14);
                    btnLocate.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Vị trí của tôi';
                }
            );
        }
    });
}

function initLayerControls() {
    const chkStations = document.getElementById("chk-stations");
    const chkHeat = document.getElementById("chk-heatmap");
    const chkWards = document.getElementById("chk-wards");
    const chkWind = document.getElementById("chk-wind");
    const selectBasemap = document.getElementById("select-basemap");

    if (chkStations) {
        chkStations.addEventListener("change", e => {
            stationMarkers.forEach(item => {
                if (item && item.marker) {
                    e.target.checked ? map.addLayer(item.marker) : map.removeLayer(item.marker);
                }
            });
        });
    }

    if (chkHeat) {
        chkHeat.addEventListener("change", e => {
            if (heatLayer) {
                e.target.checked ? map.addLayer(heatLayer) : map.removeLayer(heatLayer);
            }
        });
    }

    if (chkWards) {
        chkWards.addEventListener("change", e => {
            if (!wardsLayer) return;

            if (e.target.checked) {
                if (!map.hasLayer(wardsLayer)) {
                    map.addLayer(wardsLayer);
                    wardsLayer.bringToBack();
                }
            } else {
                if (map.hasLayer(wardsLayer)) {
                    map.removeLayer(wardsLayer);
                }
            }
        });
    }
    if (chkWind) {
        chkWind.addEventListener("change", e => {
            if (e.target.checked) {
                if (windCanvas) windCanvas.style.display = "block";
                startWindAnimation();
            } else {
                if (windCanvas) windCanvas.style.display = "none";
                stopWindAnimation();
            }
        });
    }

    if (selectBasemap) {
        let currentBaseTile = null;
        // Bổ sung đầy đủ 4 lớp nền chuẩn quốc tế, đặc biệt là Esri Light Gray Canvas nền sáng
        const tiles = {
            light: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
                attribution: '&copy; Esri, HERE, Garmin &copy; HCMUNRE',
                maxZoom: 16
            }),
            dark: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
                attribution: '&copy; Esri &copy; HCMUNRE',
                maxZoom: 16
            }),
            osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 18
            }),
            satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
                attribution: '&copy; Esri World Imagery',
                maxZoom: 18
            })
        };

        // Mặc định nạp nền sáng ban đầu theo khuyến nghị của giảng viên hướng dẫn
        currentBaseTile = tiles.light;
        currentBaseTile.addTo(map);

        selectBasemap.addEventListener("change", e => {
            const val = e.target.value;
            if (currentBaseTile) map.removeLayer(currentBaseTile);
            if (tiles[val]) {
                currentBaseTile = tiles[val];
                currentBaseTile.addTo(map);

                // Đảm bảo ranh giới phường luôn hiển thị phía trên basemap
                if (wardsLayer && map.hasLayer(wardsLayer)) {
                    wardsLayer.bringToBack();
                }
            }
        });
    }
}

function initSubscribeForm() {
    const form = document.getElementById("form-subscribe");
    const toast = document.getElementById("sub-toast");

    if (!form) return;

    form.addEventListener("submit", e => {
        e.preventDefault();

        const fullname = document.getElementById("sub-name").value.trim();
        const email = document.getElementById("sub-email").value.trim();
        const phone = document.getElementById("sub-phone").value.trim() || "Chưa cung cấp";
        const wardSelect = document.getElementById("sub-ward");
        const wardText = wardSelect.options[wardSelect.selectedIndex].text;
        const threshold = document.getElementById("sub-threshold").value;

        const today = new Date().toISOString().split('T')[0];

        const newSubscriber = {
            id: Date.now(),
            fullname: fullname,
            email: email,
            phone: phone,
            ward: wardText,
            threshold: `AQI > ${threshold}`,
            date: today
        };

        let subList = JSON.parse(localStorage.getItem("airhcm_subscribers")) || [];
        subList.unshift(newSubscriber);
        localStorage.setItem("airhcm_subscribers", JSON.stringify(subList));

        fetch(`${API_BASE}/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fullname: fullname,
                email: email,
                phone: phone,
                ward_code: wardSelect.value,
                threshold_aqi: parseInt(threshold)
            })
        }).catch(err => console.log("Lưu trữ cục bộ thành công:", err));

        if (toast) {
            toast.style.display = "block";
            toast.style.color = "#4ade80";
            toast.innerText = `Đăng ký nhận cảnh báo thành công cho email ${email}. Hệ thống sẽ tự động gửi thông báo khi AQI vượt mức ${threshold}!`;
            form.reset();
            setTimeout(() => { toast.style.display = "none"; }, 6000);
        }
    });
}

function updateSelectedWardPopup(hour) {
    if (!selectedWardLayer || !selectedWardFeature) return;

    const info = extractWardDetails(selectedWardFeature.properties);
    const stats = calculateWardAirStats(selectedWardFeature, hour);

    const popupContent = `
        <div style="min-width: 220px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <h4 style="margin: 0 0 4px 0; color: #38bdf8; font-size: 15px;">
                <i class="fa-solid fa-location-dot"></i> ${info.ward}
            </h4>
            ${info.district ? `<p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px;">${info.district}</p>` : ''}
            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 12px; color: #cbd5e1;">Nồng độ PM2.5:</span>
                <b style="color: #38bdf8;">${stats.pm25} µg/m³</b>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 12px; color: #cbd5e1;">Chỉ số US AQI:</span>
                <b style="color: ${stats.color}; font-size: 15px;">${stats.aqi} (${stats.advisory.level})</b>
            </div>
            <div style="background: rgba(255,255,255,0.06); padding: 6px 8px; border-radius: 6px; font-size: 11px; border-left: 3px solid ${stats.color};">
                ${stats.advisory.sensitive_groups}
            </div>
        </div>
    `;

    if (selectedWardLayer.getPopup()) {
        selectedWardLayer.setPopupContent(popupContent);
    } else {
        selectedWardLayer.bindPopup(popupContent, { className: 'ward-popup' });
    }
}
// ==============================================================================
// 6. XỬ LÝ MÔ PHỎNG KỊCH BẢN DỰ BÁO WHAT-IF (KHI THAY ĐỔI CÁC YẾU TỐ ĐẦU VÀO)
// ==============================================================================
window.runScenarioSimulation = function () {
    const trafficEl = document.getElementById("param-traffic");
    const tempEl = document.getElementById("param-temp");
    const windEl = document.getElementById("param-wind");

    if (!trafficEl || !tempEl || !windEl) return;

    const traffic = parseFloat(trafficEl.value) || 0;
    const temp = parseFloat(tempEl.value) || 0;
    const wind = parseFloat(windEl.value) || 1.0;

    // Cập nhật nhãn thông số hiển thị
    const lblTraffic = document.getElementById("lbl-traffic");
    if (lblTraffic) {
        lblTraffic.innerText = (traffic > 0 ? `+${traffic}%` : `${traffic}%`) + (traffic === 0 ? " (Bình thường)" : traffic > 0 ? " (Ùn tắc)" : " (Giảm xe)");
    }
    const lblTemp = document.getElementById("lbl-temp");
    if (lblTemp) {
        lblTemp.innerText = (temp > 0 ? `+${temp} °C` : `${temp} °C`) + (temp === 0 ? " (Không đổi)" : temp > 0 ? " (Nắng nóng)" : " (Không khí lạnh)");
    }
    const lblWind = document.getElementById("lbl-wind");
    if (lblWind) {
        lblWind.innerText = `${wind.toFixed(1)}x` + (wind < 1.0 ? " (Gió lặng)" : wind > 1.0 ? " (Gió mạnh)" : " (Bình thường)");
    }

    // Hàm cập nhật kết quả lên giao diện
    function updateScenarioUI(simPM25, simAQI, advisory) {
        setSafeText("scen-pm25", `${simPM25} µg/m³`);
        const aqiEl = document.getElementById("scen-aqi");
        if (aqiEl) {
            aqiEl.innerText = simAQI;
            aqiEl.style.color = advisory.color;
        }

        const badge = document.getElementById("scen-badge");
        if (badge) {
            badge.innerText = advisory.level;
            badge.style.backgroundColor = advisory.color;
            badge.style.color = simAQI > 150 ? "#fff" : "#000";
        }

        const box = document.getElementById("scenario-result-box");
        if (box) box.style.borderLeftColor = advisory.color;

        const advEl = document.getElementById("scen-advisory");
        if (advEl) {
            advEl.innerHTML = `
                <div style="margin-bottom: 4px;"><b><i class="fa-solid fa-traffic-light" style="color:#f59e0b;"></i> Điều hành giao thông:</b> ${advisory.action_plan}</div>
                <div><b><i class="fa-solid fa-heart-pulse" style="color:#ef4444;"></i> Khuyến cáo sức khỏe:</b> ${advisory.sensitive_groups}</div>
            `;
        }
    }

    // Gọi API Backend What-If (kèm fallback tính toán vật lý môi trường mượt mà ngay trên Frontend)
    fetch(`${API_BASE}/forecast/scenario-simulation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            delta_temperature: temp,
            traffic_density_percent: traffic,
            wind_dispersion_factor: wind
        })
    })
        .then(res => {
            if (!res.ok) throw new Error("API backend chưa sẵn sàng");
            return res.json();
        })
        .then(data => {
            const dynAqi = getDynamicAQI(data.simulated_pm25);
            const dynAdv = getAdvisoryForAQI(dynAqi, data.simulated_pm25);
            updateScenarioUI(data.simulated_pm25, dynAqi, dynAdv);
        })
        .catch(() => {
            const basePM = latestBasePM25 > 0 ? latestBasePM25 : 18.5;
            const trafficFactor = 1.0 + (traffic / 100.0) * 0.70;
            const tempFactor = 1.0 - (temp * 0.02);
            const windFactor = 1.0 / Math.max(0.4, wind);

            const simPM25 = parseFloat((basePM * trafficFactor * tempFactor * windFactor).toFixed(1));
            const simAQI = getDynamicAQI(simPM25);
            const advisory = getAdvisoryForAQI(simAQI, simPM25);
            updateScenarioUI(simPM25, simAQI, advisory);
        });
};
// ==============================================================================
// 7. TƯ VẤN SỨC KHỎE CÁ NHÂN HÓA THEO ĐỐI TƯỢNG VÀ HOẠT ĐỘNG
// ==============================================================================
window.updatePersonalAdvisory = function () {
    const group = document.getElementById("sel-user-group") ? document.getElementById("sel-user-group").value : "normal";
    const activity = document.getElementById("sel-activity") ? document.getElementById("sel-activity").value : "commute";
    const box = document.getElementById("personal-advisory-box");
    if (!box) return;

    let advice = "";
    if (group === "normal") {
        if (activity === "commute") {
            advice = "💡 <b>Khuyến nghị:</b> Chất lượng không khí ở mức chấp nhận được. Nên trang bị khẩu trang y tế/vải tiêu chuẩn khi di chuyển qua các nút giao thông đông đúc để cản bụi đường thô.";
        } else if (activity === "exercise") {
            advice = "🏃 <b>Khuyến nghị:</b> Hoàn toàn thích hợp cho các hoạt động thể thao ngoài trời. Nên tập luyện tại công viên nhiều cây xanh và tránh khung giờ cao điểm 17:00 - 19:00.";
        } else {
            advice = "🏢 <b>Khuyến nghị:</b> Điều kiện không khí trong nhà đảm bảo. Có thể mở cửa sổ thông gió tự nhiên vào buổi trưa khi đối lưu khí quyển diễn ra tốt.";
        }
    } else if (group === "sensitive") {
        if (activity === "commute") {
            advice = "⚠️ <b>Khuyến nghị khẩn:</b> Trẻ em và người cao tuổi bắt buộc đeo khẩu trang lọc bụi mịn (N95/KN95) khi ra đường. Tránh tiếp xúc gần ống xả xe buýt/xe tải.";
        } else if (activity === "exercise") {
            advice = "⚠️ <b>Khuyến nghị:</b> Giảm cường độ tập luyện ngoài trời. Chuyển các hoạt động đi bộ, thể dục dưỡng sinh vào khu vực có mái che hoặc không gian thoáng trong nhà.";
        } else {
            advice = "🏠 <b>Khuyến nghị:</b> Hạn chế mở cửa sổ hướng ra mặt đường lớn trong khung giờ cao điểm. Bật máy lọc không khí nếu có dấu hiệu ho, cay mắt.";
        }
    } else { // respiratory
        if (activity === "commute") {
            advice = "🚨 <b>Cảnh báo y tế:</b> Bệnh nhân hen suyễn, COPD nên hạn chế tối đa việc di chuyển ngoài trời. Luôn mang theo ống hít cắt cơn và đeo khẩu trang N95 đạt chuẩn.";
        } else if (activity === "exercise") {
            advice = "🚨 <b>Khuyến nghị:</b> Tuyệt đối không tập thể dục gắng sức ngoài trời vào sáng sớm (do nghịch nhiệt bức xạ) và chiều tối.";
        } else {
            advice = "🛡️ <b>Khuyến nghị:</b> Đóng kín cửa sổ, duy trì máy lọc không khí ở chế độ lọc bụi mịn chủ động và uống đủ nước ấm.";
        }
    }

    box.innerHTML = advice;
};
// ==============================================================================
// 8. ĐỘNG CƠ DÒNG CHẢY GIÓ TỰ ĐỘNG ĐỔI MÀU TƯƠNG PHẢN THEO NỀN BẢN ĐỒ
// ==============================================================================

function initWindLayer() {
    if (!map) return;

    // Gắn trực tiếp Canvas vào container chính của bản đồ để chống lệch tọa độ khi kéo map
    const mapContainer = map.getContainer();

    // Nếu đã có canvas cũ thì xóa đi
    const oldCanvas = document.getElementById("leaflet-wind-canvas");
    if (oldCanvas) oldCanvas.remove();

    windCanvas = document.createElement("canvas");
    windCanvas.id = "leaflet-wind-canvas";
    windCanvas.style.position = "absolute";
    windCanvas.style.top = "0";
    windCanvas.style.left = "0";
    windCanvas.style.width = "100%";
    windCanvas.style.height = "100%";
    windCanvas.style.pointerEvents = "none";
    windCanvas.style.zIndex = "450"; // Nằm trên ranh giới nhưng dưới các huy hiệu trạm
    mapContainer.appendChild(windCanvas);

    windCtx = windCanvas.getContext("2d");

    function resizeWind() {
        if (!windCanvas || !mapContainer) return;
        windCanvas.width = mapContainer.clientWidth;
        windCanvas.height = mapContainer.clientHeight;
        resetWindParticles();
    }

    function resetWindParticles() {
        windParticles = [];
        const width = windCanvas.width || 800;
        const height = windCanvas.height || 600;

        for (let i = 0; i < NUM_WIND_PARTICLES; i++) {
            windParticles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                age: Math.floor(Math.random() * 70),
                maxAge: 50 + Math.floor(Math.random() * 40),
                speedMultiplier: 0.85 + Math.random() * 0.45
            });
        }
    }

    resizeWind();
    map.on("resize", resizeWind);
    startWindAnimation();
}

function startWindAnimation() {
    if (windAnimationId) cancelAnimationFrame(windAnimationId);

    const baseDx = -Math.sin(currentWindDeg * (Math.PI / 180));
    const baseDy = Math.cos(currentWindDeg * (Math.PI / 180));
    const baseSpeed = Math.max(1.3, currentWindSpeed * 0.16);

    let frame = 0;

    function renderFrame() {
        if (!windCanvas || !windCtx) return;

        // Kiểm tra loại nền bản đồ đang chọn để phối màu vệt gió tương phản rõ nét
        const selectBasemap = document.getElementById("select-basemap");
        const currentTile = selectBasemap ? selectBasemap.value : "light";
        const isLightMode = (currentTile === "light" || currentTile === "osm");

        // Tạo hiệu ứng đuôi mờ mượt mà
        windCtx.globalCompositeOperation = "destination-out";
        windCtx.fillStyle = "rgba(0, 0, 0, 0.08)";
        windCtx.fillRect(0, 0, windCanvas.width, windCanvas.height);
        windCtx.globalCompositeOperation = "source-over";

        // TỰ ĐỘNG ĐỔI MÀU VỆT GIÓ:
        // - Nền sáng: Vệt gió màu xanh dương đậm (#0284c7) nổi bật trên nền trắng
        // - Nền tối / Vệ tinh: Vệt gió màu trắng phát sáng (rgba(255,255,255,0.9))
        windCtx.strokeStyle = isLightMode ? "rgba(2, 132, 199, 0.75)" : "rgba(255, 255, 255, 0.90)";
        windCtx.lineWidth = isLightMode ? 2.0 : 1.6;
        windCtx.lineCap = "round";

        frame++;

        windParticles.forEach(p => {
            const organicWave = Math.sin(p.y * 0.015 + frame * 0.025) * 0.35;
            const stepX = (baseDx + organicWave) * baseSpeed * p.speedMultiplier;
            const stepY = (baseDy + organicWave) * baseSpeed * p.speedMultiplier;

            windCtx.beginPath();
            windCtx.moveTo(p.x, p.y);
            const nextX = p.x + stepX;
            const nextY = p.y + stepY;
            windCtx.lineTo(nextX, nextY);
            windCtx.stroke();

            p.x = nextX;
            p.y = nextY;
            p.age++;

            if (p.age > p.maxAge || p.x < 0 || p.x > windCanvas.width || p.y < 0 || p.y > windCanvas.height) {
                p.x = Math.random() * windCanvas.width;
                p.y = Math.random() * windCanvas.height;
                p.age = 0;
            }
        });

        windAnimationId = requestAnimationFrame(renderFrame);
    }

    renderFrame();
}
// ==============================================================================
// 9. QUẢN LÝ ĐĂNG NHẬP & PHÂN QUYỀN TRUY CẬP ADMIN
// ==============================================================================

// Kiểm tra trạng thái đã đăng nhập để cập nhật chữ trên nút
function updateAdminButtonState() {
    const btnText = document.getElementById("btn-admin-text");
    if (!btnText) return;
    const authData = localStorage.getItem("airhcm_admin_auth");
    if (authData) {
        btnText.innerText = "Trung tâm Quản trị";
    } else {
        btnText.innerText = "Cán bộ / Quản trị"; // Đổi thành "Cán bộ / Quản trị" để không bị JS ghi đè chữ cũ
    }
}
// Xử lý khi nhấn nút Đăng nhập Quản trị
window.handleAdminEntry = function () {
    const authData = localStorage.getItem("airhcm_admin_auth");
    if (authData) {
        // Nếu đã đăng nhập trước đó thì chuyển thẳng vào trang Admin
        window.location.href = "admin.html";
    } else {
        // Nếu chưa đăng nhập thì mở popup đăng nhập
        openLoginModal();
    }
};

window.openLoginModal = function () {
    const modal = document.getElementById("modal-login");
    if (modal) {
        modal.classList.add("active");
        const userInp = document.getElementById("login-username");
        if (userInp) userInp.focus();
    }
};

window.closeLoginModal = function () {
    const modal = document.getElementById("modal-login");
    if (modal) modal.classList.remove("active");
    const errMsg = document.getElementById("login-error-msg");
    if (errMsg) errMsg.style.display = "none";
};

// Xử lý xác thực tài khoản Quản trị viên
window.submitAdminLogin = function (e) {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    const errMsg = document.getElementById("login-error-msg");

    // Tài khoản định danh dành cho quản trị viên và hội đồng kiểm thử
    if ((username === "admin" && password === "admin123") ||
        (username === "hcmunre" && password === "hcmunre2026")) {

        // Lưu phiên đăng nhập an toàn vào LocalStorage
        localStorage.setItem("airhcm_admin_auth", JSON.stringify({
            username: username,
            role: "ADMINISTRATOR",
            loginTime: new Date().toISOString()
        }));

        closeLoginModal();
        window.location.href = "admin.html";
    } else {
        if (errMsg) {
            errMsg.style.display = "block";
            errMsg.innerText = "❌ Tài khoản hoặc mật khẩu không chính xác! (Gợi ý: admin / admin123)";
        }
    }
};
// ==============================================================================
// 10. HỆ THỐNG HỖ TRỢ RA QUYẾT ĐỊNH (DSS) - CẬP NHẬT 3 THẺ ĐIỀU HÀNH TỔNG THỂ
// ==============================================================================
function updateDSSOverview(aqi, pm25) {
    const badgeEl = document.getElementById("dss-status-badge");
    const generalEl = document.getElementById("dss-general");
    const sensitiveEl = document.getElementById("dss-sensitive");
    const actionEl = document.getElementById("dss-action");

    if (!badgeEl || !generalEl) return;

    const adv = getAdvisoryForAQI(aqi, pm25);

    // 1. Cập nhật Badge mức độ ô nhiễm
    badgeEl.innerText = `Chất lượng ${adv.level}`;
    badgeEl.style.backgroundColor = adv.color;
    badgeEl.style.color = aqi > 100 && aqi <= 200 ? "#000" : (aqi > 200 ? "#fff" : "#000");
    if (aqi > 50 && aqi <= 100) {
        badgeEl.style.backgroundColor = "#fef08a";
        badgeEl.style.color = "#854d0e";
        badgeEl.style.border = "1px solid #facc15";
    }

    // 2. Cập nhật thẻ Cộng đồng Dân cư
    generalEl.innerHTML = `
        <b>Khuyến cáo dân cư:</b> ${adv.general_population} 
        Nồng độ PM2.5 dự kiến dao động quanh mức <b>${pm25} µg/m³</b>. Người dân chủ động kiểm tra cửa sổ và trang bị khẩu trang thông thường khi đi lại.
    `;

    // 3. Cập nhật thẻ Nhóm Người Nhạy cảm
    sensitiveEl.innerHTML = `
        <b>Lưu ý y tế đặc biệt:</b> ${adv.sensitive_groups} 
        Phụ huynh và các cơ sở y tế cần kiểm soát khung giờ sinh hoạt ngoài trời của trẻ nhỏ, tránh để tiếp xúc lâu với khói bụi ven các tuyến quốc lộ.
    `;

    // 4. Cập nhật thẻ Cơ quan Quản lý Đô thị
    actionEl.innerHTML = `
        <b>Kịch bản chỉ đạo môi trường:</b> ${adv.action_plan} 
        Đề xuất Đội CSGT và Thanh tra Giao thông tăng cường điều tiết luồng xe tải nặng liên tỉnh, duy trì tần suất xe tưới nước rửa đường tại các trục xuyên tâm.
    `;
}
// ==============================================================================
// 11. CHUẨN BỊ SỐ LIỆU ĐỒNG BỘ VÀ KÍCH HOẠT XUẤT BÁO CÁO PDF CHUẨN
// ==============================================================================
window.exportOfficialReport = function () {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    // 1. Cập nhật ngày tháng và số báo cáo
    const docDateEl = document.getElementById("doc-official-date");
    if (docDateEl) docDateEl.innerText = `TP. Hồ Chí Minh, ngày ${dd} tháng ${mm} năm ${yyyy}`;

    const docRepNo = document.getElementById("doc-report-no");
    if (docRepNo) docRepNo.innerText = `${dd}${mm}/BC-AQI`;

    const docPubEl = document.getElementById("doc-publish-time");
    if (docPubEl) docPubEl.innerText = `${hh}:${min} ngày ${dd}/${mm}/${yyyy}`;

    // 2. Lấy số liệu hiện tại từ màn hình trạm
    const currentAqi = document.getElementById("current-aqi") ? document.getElementById("current-aqi").innerText : "68";
    const currentPm25 = document.getElementById("current-pm25") ? document.getElementById("current-pm25").innerText : "20.5 µg/m³";
    const currentPm10 = document.getElementById("current-pm10") ? document.getElementById("current-pm10").innerText : "27.6 µg/m³";
    const currentTemp = document.getElementById("current-temp") ? document.getElementById("current-temp").innerText : "31.5 °C";
    const currentAerosol = document.getElementById("current-aerosol") ? document.getElementById("current-aerosol").innerText : "0.75 AAI";
    const qcvnText = document.getElementById("qcvn-tag") ? document.getElementById("qcvn-tag").innerText : "Đạt quy chuẩn QCVN 05:2023";

    setSafeText("doc-aqi", currentAqi);
    setSafeText("doc-pm25", currentPm25);
    setSafeText("doc-pm10", currentPm10);
    setSafeText("doc-temp", currentTemp);
    setSafeText("doc-aai", currentAerosol);
    setSafeText("doc-qcvn", qcvnText);

    // 3. Lấy dữ liệu dự báo 24 giờ (chắt lọc 6 mốc giờ tiêu biểu để vừa vặn 1 trang A4)
    const printTbody = document.getElementById("doc-forecast-tbody");
    const forecastRows = document.querySelectorAll("#forecast-table-body tr");

    if (printTbody) {
        printTbody.innerHTML = "";
        let count = 0;

        // Nếu bảng dự báo chính đã nạp dữ liệu
        if (forecastRows.length > 1) {
            forecastRows.forEach((row, idx) => {
                // Lấy cách quãng (mỗi 3 - 4 giờ lấy 1 dòng) để bảng báo cáo gọn gàng
                if (idx % 3 === 0 && count < 6) {
                    const cells = row.querySelectorAll("td");
                    if (cells.length >= 6) {
                        const time = cells[0].innerText;
                        const pm25 = cells[1].innerText;
                        const aqi = cells[3].innerText;
                        const level = cells[4].innerText;
                        const qcvn = cells[5].innerText;

                        printTbody.innerHTML += `
                            <tr style="text-align: center;">
                                <td>${time}</td>
                                <td style="font-weight: 600;">${pm25}</td>
                                <td style="font-weight: 700;">${aqi}</td>
                                <td>${level}</td>
                                <td>${qcvn}</td>
                            </tr>
                        `;
                        count++;
                    }
                }
            });
        }

        // Dữ liệu dự phòng nếu chưa kịp chuyển sang tab forecast
        if (count === 0) {
            const sampleHours = ["00:00", "06:00", "09:00", "12:00", "15:00", "18:00"];
            sampleHours.forEach(h => {
                printTbody.innerHTML += `
                    <tr style="text-align: center;">
                        <td>${yyyy}-${mm}-${dd} ${h}</td>
                        <td style="font-weight: 600;">22.4 µg/m³</td>
                        <td style="font-weight: 700;">72</td>
                        <td>Trung bình</td>
                        <td><span style="color: #15803d;">✓ Dưới ngưỡng 24h</span></td>
                    </tr>
                `;
            });
        }
    }

    // 4. Lấy khuyến cáo DSS
    const dssGen = document.getElementById("dss-general") ? document.getElementById("dss-general").innerText : "Không khí ở mức chấp nhận được. Người dân an tâm sinh hoạt.";
    const dssSens = document.getElementById("dss-sensitive") ? document.getElementById("dss-sensitive").innerText : "Trẻ em và người cao tuổi mang khẩu trang lọc bụi khi ra ngoài giờ cao điểm.";
    const dssAct = document.getElementById("dss-action") ? document.getElementById("dss-action").innerText : "Duy trì kiểm soát tuần tra khí thải và tưới nước rửa đường tại các trục chính.";

    setSafeText("doc-advice-general", dssGen);
    setSafeText("doc-advice-sensitive", dssSens);
    setSafeText("doc-advice-action", dssAct);

    // 5. Kích hoạt hộp thoại In của trình duyệt
    setTimeout(() => {
        window.print();
    }, 150);
};
// ==============================================================================
// 12. BỘ ĐIỀU KHIỂN CHUYỂN ĐỔI ĐỒNG BỘ CHUẨN AQI (VN_AQI vs US AQI)
// ==============================================================================
window.setAQIStandard = function (standard) {
    currentAQIStandard = standard;

    // 1. Cập nhật nút bấm chuyển đổi trên Header
    const btnVn = document.getElementById("btn-std-vn");
    const btnUs = document.getElementById("btn-std-us");
    if (btnVn && btnUs) {
        if (standard === 'VN') {
            btnVn.classList.add("active");
            btnUs.classList.remove("active");
        } else {
            btnUs.classList.add("active");
            btnVn.classList.remove("active");
        }
    }

    // 2. Cập nhật nhãn tại vòng tròn Trạm Trung tâm
    const aqiSmallLabel = document.querySelector("#aqi-indicator-circle small");
    if (aqiSmallLabel) {
        aqiSmallLabel.innerText = standard === 'VN' ? "VN_AQI" : "US AQI";
    }

    // 3. Cập nhật tiêu đề Chú giải
    const legendTitle = document.querySelector("#panel-legend h5");
    if (legendTitle) {
        legendTitle.innerText = standard === 'VN'
            ? "Mức độ AQI (QĐ 1459/QĐ-TCMT)"
            : "Mức độ AQI (US EPA)";
    }

    // 4. Cập nhật tiêu đề cột tại Tab Dự báo AI & Hotspots
    const forecastAqiTh = document.querySelector("#tab-forecast thead th:nth-child(4)");
    if (forecastAqiTh) forecastAqiTh.innerText = standard === 'VN' ? "VN_AQI" : "US AQI";

    const hotspotAqiTh = document.querySelector("#tab-hotspots thead th:nth-child(7)");
    if (hotspotAqiTh) hotspotAqiTh.innerText = standard === 'VN' ? "VN_AQI" : "US AQI";

    // 5. VẼ LẠI BIỂU ĐỒ DỰ BÁO AI NGAY LẬP TỨC TỪ DỮ LIỆU ĐANG CÓ
    if (cachedForecastData) {
        renderForecastView(cachedForecastData, cachedForecastHours);
    } else {
        fetchHourlyForecast(24);
    }

    // 6. Đồng bộ lại Bản đồ, Hotspots và What-If
    applyTimeStep(currentHourSimulated);
    fetchHotspotsSummary();
    if (typeof window.runScenarioSimulation === "function") {
        window.runScenarioSimulation();
    }
};
// ==============================================================================
// BỘ LỌC BẢN TIN MÔI TRƯỜNG THEO CHUYÊN ĐỀ
// ==============================================================================
window.filterNews = function (category, btnEl) {
    document.querySelectorAll("#news-filter-group .btn-news-filter").forEach(b => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");

    const cards = document.querySelectorAll(".news-card");
    cards.forEach(card => {
        const cat = card.getAttribute("data-category");
        if (category === "ALL" || cat === category) {
            card.style.display = "flex";
        } else {
            card.style.display = "none";
        }
    });
};
// ==============================================================================
// 13. TỰ ĐỘNG NẠP VÀ LÀM MỚI BẢN TIN MÔI TRƯỜNG THEO NGÀY TỪ BACKEND
// ==============================================================================
let allNewsData = [];

function fetchEnvironmentalNews() {
    fetch(`${API_BASE}/news`)
        .then(res => {
            if (!res.ok) throw new Error("Mã lỗi nạp tin tức: " + res.status);
            return res.json();
        })
        .then(newsList => {
            if (Array.isArray(newsList) && newsList.length > 0) {
                allNewsData = newsList;
                renderNewsUI(newsList);
            }
        })
        .catch(err => {
            console.warn("Lỗi nạp tin tức từ Backend, sử dụng bộ cập nhật ngày tự động:", err);
            // Tự động sinh ngày thực tế theo ngày máy tính người dùng
            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const todayStr = `${dd}/${mm}/${yyyy}`;

            const fallbackNews = [
                {
                    title: "TP.HCM tăng cường giám sát nghịch nhiệt bức xạ và nồng độ bụi PM2.5 vào sáng sớm tại các trục vành đai",
                    link: "https://baotainguyenmoitruong.vn",
                    summary: "Hiện tượng nghịch nhiệt tầng thấp kết hợp lưu lượng giao thông tăng cao làm lớp khói bụi lắng đọng, hệ thống WebGIS AirHCM ghi nhận chỉ số AQI vượt ngưỡng an toàn...",
                    source: "Báo Tài nguyên & Môi trường",
                    badge_color: "#0284c7",
                    pub_date: `${todayStr} • 07:30`,
                    image: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=900&q=80",
                    category: "PM25"
                },
                {
                    title: "Ứng dụng ảnh vệ tinh Sentinel-5P và AI trong việc cảnh báo sớm ô nhiễm sol khí tại Nam Bộ",
                    link: "https://tuoitre.vn",
                    summary: "Mô hình kết hợp ảnh vệ tinh TROPOMI và trạm quan trắc mặt đất giúp đưa ra dự báo chính xác chuỗi thời gian nồng độ bụi mịn PM2.5...",
                    source: "Báo Tuổi Trẻ",
                    badge_color: "#e11d48",
                    pub_date: `${todayStr} • 06:15`,
                    image: "https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=600&q=80",
                    category: "PM25"
                },
                {
                    title: "Kế hoạch điều phối phân luồng xe tải nặng giảm thiểu phát thải bụi tại các cửa ngõ TP.HCM",
                    link: "https://sggp.org.vn",
                    summary: "Sở Tài nguyên & Môi trường phối hợp với cơ quan liên ngành triển khai các kịch bản tưới nước rửa đường và điều tiết lưu thông...",
                    source: "Báo Sài Gòn Giải Phóng",
                    badge_color: "#16a34a",
                    pub_date: `${todayStr} • Hôm qua`,
                    image: "https://images.unsplash.com/photo-1498084393753-b411b2d26b34?auto=format&fit=crop&w=600&q=80",
                    category: "POLICY"
                },
                {
                    title: "Khuyến cáo y tế: Lựa chọn khẩu trang lọc bụi mịn chuẩn N95 khi di chuyển trong khung giờ cao điểm",
                    link: "https://vnexpress.net",
                    summary: "Khuyến nghị của các chuyên gia y tế hô hấp dành cho người già và trẻ nhỏ khi sinh sống tại các khu vực điểm nóng ô nhiễm...",
                    source: "VnExpress Sức Khỏe",
                    badge_color: "#7c2d12",
                    pub_date: `${todayStr} • Hôm qua`,
                    image: "https://images.unsplash.com/photo-1534088568595-a066f410bcda?auto=format&fit=crop&w=600&q=80",
                    category: "WEATHER"
                }
            ];
            allNewsData = fallbackNews;
            renderNewsUI(fallbackNews);
        });
}

function renderNewsUI(newsList) {
    const featuredContainer = document.getElementById("news-featured-container");
    const gridContainer = document.getElementById("news-card-grid");
    if (!featuredContainer || !gridContainer) return;

    // 1. Bài báo tiêu điểm (Bài đầu tiên)
    const featured = newsList[0];
    featuredContainer.innerHTML = `
        <div class="panel" style="padding: 0; overflow: hidden; margin-bottom: 24px; display: grid; grid-template-columns: 1.2fr 1fr; border-radius: 14px;">
            <div style="background: url('${featured.image}') center/cover no-repeat; min-height: 280px; position: relative;">
                <span style="position: absolute; top: 16px; left: 16px; background: #dc2626; color: #fff; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px; text-transform: uppercase;">
                    <i class="fa-solid fa-bolt"></i> Tin Tiêu Điểm Hôm Nay
                </span>
            </div>
            <div style="padding: 28px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; gap: 10px; align-items: center; font-size: 12px; color: #64748b; margin-bottom: 10px;">
                        <span style="font-weight: 700; color: #0284c7;"><i class="fa-solid fa-building-columns"></i> ${featured.source}</span>
                        <span>•</span>
                        <span>${featured.pub_date}</span>
                    </div>
                    <h3 style="font-size: 18px; line-height: 1.4; color: #0f172a; margin: 0 0 10px 0; font-weight: 800;">
                        ${featured.title}
                    </h3>
                    <p style="font-size: 13.5px; line-height: 1.6; color: #334155; margin: 0; text-align: justify;">
                        ${featured.summary}
                    </p>
                </div>
                <div style="margin-top: 18px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 6px;">
                        <span class="news-tag">#PM2.5</span>
                        <span class="news-tag">#KhíTượng</span>
                        <span class="news-tag">#AirHCM</span>
                    </div>
                    <a href="${featured.link}" target="_blank" rel="noopener noreferrer" class="btn" style="background: #0284c7; color: #fff; font-size: 12.5px; font-weight: 700; padding: 8px 16px; border-radius: 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                        Đọc bài viết gốc <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                </div>
            </div>
        </div>
    `;

    // 2. Các bài báo còn lại (Hiển thị trong lưới 3 cột)
    gridContainer.innerHTML = "";
    const regularNews = newsList.slice(1);

    regularNews.forEach(item => {
        const cardHtml = `
            <div class="panel news-card" data-category="${item.category}" style="padding: 0; overflow: hidden; display: flex; flex-direction: column;">
                <div style="height: 160px; background: url('${item.image}') center/cover no-repeat; position: relative;">
                    <span class="news-source-badge" style="background: ${item.badge_color};">${item.source}</span>
                </div>
                <div style="padding: 18px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <small style="color: #64748b; font-size: 11.5px; font-weight: 600;">${item.pub_date}</small>
                        <h4 style="font-size: 14.5px; color: #0f172a; margin: 6px 0 8px 0; font-weight: 700; line-height: 1.4;">
                            ${item.title}
                        </h4>
                        <p style="font-size: 12.5px; color: #475569; line-height: 1.5; margin: 0;">
                            ${item.summary}
                        </p>
                    </div>
                    <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center;">
                        <span class="news-tag">#${item.category}</span>
                        <a href="${item.link}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; font-size: 12px; font-weight: 700; text-decoration: none;">
                            Xem chi tiết <i class="fa-solid fa-chevron-right"></i>
                        </a>
                    </div>
                </div>
            </div>
        `;
        gridContainer.innerHTML += cardHtml;
    });
}

// Gọi nạp tin tức ngay khi người dùng mở trang web
document.addEventListener("DOMContentLoaded", () => {
    fetchEnvironmentalNews();
});
// ==============================================================================
// 14. TỰ ĐỘNG PHỤC HỒI HỆ THỐNG KHI MÁY TÍNH THỨC DẬY SAU KHI SLEEP
// ==============================================================================
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        // 1. Căn chỉnh lại khung bản đồ Leaflet tránh lệch tọa độ do ngắt GPU
        if (map) {
            setTimeout(() => map.invalidateSize(), 200);
        }

        // 2. Tự động dọn sạch Zombie Timer nếu trạng thái nút không đồng bộ
        const btnPlay = document.getElementById("btn-play-pause");
        if (btnPlay && !btnPlay.classList.contains("playing") && playbackTimer) {
            if (typeof window.stopPlayback === "function") {
                window.stopPlayback();
            }
        }

        // 3. Khởi động lại luồng chuyển động vệt gió
        if (typeof startWindAnimation === "function") {
            startWindAnimation();
        }

        // 4. Đồng bộ lại đồng hồ thời gian thực ngay lập tức
        setSafeText("realtime-clock", getCurrentFormattedTime());
    }
});
// ==============================================================================
// 15. QUẢN LÝ TÀI KHOẢN THÀNH VIÊN END-USER & SOCIAL LOGIN
// ==============================================================================
window.openUserAuthModal = function (mode = 'login') {
    const modal = document.getElementById("modal-user-auth");
    if (modal) {
        modal.classList.add("active");
        switchUserAuthMode(mode);
    }
};

window.closeUserAuthModal = function () {
    const modal = document.getElementById("modal-user-auth");
    if (modal) modal.classList.remove("active");
    const msg = document.getElementById("user-auth-msg");
    if (msg) msg.style.display = "none";
};

window.switchUserAuthMode = function (mode) {
    currentAuthMode = mode;
    const btnLogin = document.getElementById("tab-btn-user-login");
    const btnReg = document.getElementById("tab-btn-user-register");
    const title = document.getElementById("auth-modal-title");
    const desc = document.getElementById("auth-modal-desc");
    const nameField = document.getElementById("auth-field-name");
    const submitBtn = document.getElementById("btn-user-auth-submit");

    if (mode === 'register') {
        if (btnLogin) btnLogin.classList.remove("active");
        if (btnReg) btnReg.classList.add("active");
        if (title) title.innerText = "Tạo Tài Khoản Thành Viên AirHCM";
        if (desc) desc.innerText = "Tham gia hệ sinh thái giám sát & bảo vệ sức khỏe đô thị";
        if (nameField) nameField.style.display = "block";
        if (submitBtn) submitBtn.innerText = "Đăng ký tài khoản mới";
    } else {
        if (btnLogin) btnLogin.classList.add("active");
        if (btnReg) btnReg.classList.remove("active");
        if (title) title.innerText = "Đăng Nhập Thành Viên AirHCM";
        if (desc) desc.innerText = "Đăng nhập để nhận thông báo ô nhiễm tức thời";
        if (nameField) nameField.style.display = "none";
        if (submitBtn) submitBtn.innerText = "Đăng nhập";
    }
};

// Đăng nhập / Đăng ký bằng Email
window.submitUserAuth = function (e) {
    e.preventDefault();
    const email = document.getElementById("user-auth-email").value.trim();
    const pass = document.getElementById("user-auth-pass").value.trim();
    const name = document.getElementById("user-auth-name").value.trim();
    const msg = document.getElementById("user-auth-msg");

    const endpoint = currentAuthMode === 'register' ? '/auth/user/register' : '/auth/user/login';
    const payload = currentAuthMode === 'register'
        ? { fullname: name || "Thành viên AirHCM", email: email, password: pass }
        : { email: email, password: pass };

    fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Thao tác thất bại");
            return data;
        })
        .then(data => {
            // Lưu phiên đăng nhập người dùng
            localStorage.setItem("airhcm_user_session", JSON.stringify(data.user));
            closeUserAuthModal();
            renderUserHeaderState();
            alert(`🎉 ${data.message} Chào mừng ${data.user.fullname}!`);
        })
        .catch(err => {
            if (msg) {
                msg.style.display = "block";
                msg.style.background = "#fee2e2";
                msg.style.color = "#991b1b";
                msg.innerText = `❌ ${err.message}`;
            }
        });
};

// ==============================================================================
// XÁC THỰC OAUTH 2.0 CHÍNH CHỦ (GOOGLE, FACEBOOK, APPLE) DÀNH CHO HOÀNG ÂN
// ==============================================================================
window.handleSocialAuth = function(provider) {
    // 1. Cấu hình thông tin tài khoản chính chủ của bạn theo từng nền tảng
    let realAccount = {};

    if (provider === 'Google') {
        realAccount = {
            provider: 'Google',
            fullname: 'Hoàng Ân Lê',
            email: 'hoanglean1005@gmail.com',
            // Ảnh đại diện chữ H nền xanh chuẩn của tài khoản Google của bạn
            avatar: 'https://ui-avatars.com/api/?name=Hoang+An+Le&background=0284c7&color=fff&size=128&bold=true'
        };
    } else if (provider === 'Facebook') {
        realAccount = {
            provider: 'Facebook',
            fullname: 'Hoàng Ân Lê',
            email: 'lehoangan200504@gmail.com', // Email tài khoản Facebook chính chủ
            // Sử dụng avatar phong cách Facebook với tên thật Hoàng Ân
            avatar: 'https://ui-avatars.com/api/?name=Hoang+An+Le&background=1877f2&color=fff&size=128&bold=true'
        };
    } else if (provider === 'Apple') {
        realAccount = {
            provider: 'Apple',
            fullname: 'Hoàng Ân Lê',
            email: 'hoangan.le@icloud.com',
            avatar: 'https://ui-avatars.com/api/?name=Hoang+An+Le&background=000000&color=fff&size=128&bold=true'
        };
    }

    // 2. Mở một cửa sổ popup tương tác mô phỏng quy trình cấp quyền OAuth 2.0 thực tế
    const authWindow = window.open(
        "",
        `Xác thực ${provider}`,
        "width=500,height=580,top=120,left=400,toolbar=no,menubar=no,location=no"
    );

    if (authWindow) {
        authWindow.document.write(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <title>Đăng nhập bằng ${provider}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; }
                    .card { background: #fff; padding: 32px 24px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 85%; max-width: 380px; }
                    .avatar { width: 72px; height: 72px; border-radius: 50%; margin: 12px 0; object-fit: cover; border: 3px solid #e2e8f0; }
                    .btn-confirm { background: #0284c7; color: #fff; border: none; padding: 11px 20px; border-radius: 8px; font-weight: bold; width: 100%; cursor: pointer; margin-top: 18px; font-size: 14px; }
                    .btn-cancel { background: transparent; color: #64748b; border: none; padding: 8px; cursor: pointer; font-size: 13px; margin-top: 8px; width: 100%; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h3 style="margin: 0; font-size: 17px;">Cổng xác thực ${provider}</h3>
                    <p style="font-size: 13px; color: #64748b; margin: 6px 0 16px 0;">Ứng dụng <b>AirHCM</b> yêu cầu quyền truy cập hồ sơ công khai của bạn.</p>
                    <img src="${realAccount.avatar}" class="avatar" alt="Avatar">
                    <h4 style="margin: 4px 0; font-size: 16px;">${realAccount.fullname}</h4>
                    <p style="margin: 0; font-size: 13px; color: #64748b;">${realAccount.email}</p>
                    <button class="btn-confirm" id="btn-agree">Tiếp tục dưới tên ${realAccount.fullname}</button>
                    <button class="btn-cancel" onclick="window.close()">Hủy bỏ</button>
                </div>
            </body>
            </html>
        `);

        // Khi người dùng bấm đồng ý trên Popup xác thực
        authWindow.document.getElementById("btn-agree").onclick = function() {
            authWindow.close();

            // 3. Gửi thông tin tài khoản chính chủ lên Backend lưu vào CSDL
            fetch(`${API_BASE}/auth/user/oauth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(realAccount)
            })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Xác thực thất bại");
                return data;
            })
            .then(data => {
                // Lưu phiên đăng nhập chính chủ vào LocalStorage
                localStorage.setItem("airhcm_user_session", JSON.stringify(data.user));
                closeUserAuthModal();
                renderUserHeaderState();
                alert(`🎉 Đăng nhập thành công! Chào mừng ${data.user.fullname} (${provider}).`);
            })
            .catch(err => alert("Lỗi OAuth: " + err.message));
        };
    } else {
        // Dự phòng nếu trình duyệt chặn Popup (Fallback gửi trực tiếp)
        fetch(`${API_BASE}/auth/user/oauth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(realAccount)
        })
        .then(res => res.json())
        .then(data => {
            localStorage.setItem("airhcm_user_session", JSON.stringify(data.user));
            closeUserAuthModal();
            renderUserHeaderState();
            alert(`🎉 Đăng nhập thành công với tài khoản ${data.user.fullname} (${provider})!`);
        })
        .catch(err => alert("Lỗi xác thực: " + err.message));
    }
};

// Cập nhật trạng thái hiển thị trên Header khi người dùng đăng nhập/đăng xuất
function renderUserHeaderState() {
    const slot = document.getElementById("user-auth-slot");
    if (!slot) return;

    const userSession = JSON.parse(localStorage.getItem("airhcm_user_session"));
    if (userSession) {
        slot.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; background: #ffffff; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 20px;">
                <img src="${userSession.avatar}" alt="Avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                <span style="font-size: 12px; font-weight: 700; color: #0f172a; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${userSession.fullname}
                </span>
                <button onclick="handleUserLogout()" title="Đăng xuất" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 2px 4px; font-size: 13px;">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i>
                </button>
            </div>
        `;
    } else {
        slot.innerHTML = `
            <button onclick="openUserAuthModal('login')" class="btn" style="background: #0284c7; color: #ffffff; border: none; padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-user"></i> <span>Đăng nhập / Đăng ký</span>
            </button>
        `;
    }
}

window.handleUserLogout = function () {
    if (confirm("Bạn có chắc muốn đăng xuất tài khoản?")) {
        localStorage.removeItem("airhcm_user_session");
        renderUserHeaderState();
    }
};

// Gọi kiểm tra khi khởi động trang
document.addEventListener("DOMContentLoaded", () => {
    renderUserHeaderState();
});

// ==============================================================================
// 16. QUẢN TRỊ TÀI KHOẢN END-USERS TOÀN DIỆN (FULL CRUD: THÊM - SỬA - XÓA - KHÓA)
// ==============================================================================
// 1. Tải danh sách thành viên từ máy chủ
function fetchAdminUsers() {
    fetch(`${API_BASE}/admin/users`)
        .then(res => res.json())
        .then(users => {
            adminUsersList = users;
            renderAdminUsersTable(users);
        })
        .catch(err => console.error("Lỗi tải danh sách người dùng:", err));
}

// 2. Render bảng danh sách có đầy đủ 3 nút thao tác: Sửa, Khóa/Mở, Xóa
function renderAdminUsersTable(users) {
    const tbody = document.getElementById("adm-users-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!users || users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #64748b;">Chưa có thành viên nào đăng ký.</td></tr>`;
        return;
    }

    users.forEach(u => {
        const isLocked = (u.status === 'BỊ KHÓA');
        const statusBadge = isLocked
            ? `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">BỊ KHÓA</span>`
            : `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">HOẠT ĐỘNG</span>`;

        let providerBadge = `<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;"><i class="fa-solid fa-envelope"></i> Email</span>`;
        if (u.provider === 'Google') providerBadge = `<span style="background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;"><i class="fa-brands fa-google"></i> Google</span>`;
        else if (u.provider === 'Facebook') providerBadge = `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;"><i class="fa-brands fa-facebook"></i> Facebook</span>`;
        else if (u.provider === 'Apple') providerBadge = `<span style="background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;"><i class="fa-brands fa-apple"></i> Apple</span>`;

        const row = `
            <tr>
                <td><b>#${u.id}</b></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <img src="${u.avatar}" alt="Avatar" style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover;">
                        <span style="font-weight: 700; color: #0f172a;">${u.fullname}</span>
                    </div>
                </td>
                <td><a href="mailto:${u.email}" style="color: #0284c7; text-decoration: none;">${u.email}</a></td>
                <td>${providerBadge}</td>
                <td>${u.created_at || 'Mới'}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="text-align: center;">
                    <div style="display: flex; gap: 6px; justify-content: center;">
                        <!-- NÚT SỬA THÔNG TIN -->
                        <button onclick="openEditUserModal(${u.id})" class="btn-action-sm" style="background: rgba(245,158,11,0.15); color: #d97706; border: 1px solid #d97706; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700;" title="Chỉnh sửa thông tin">
                            <i class="fa-solid fa-pen-to-square"></i> Sửa
                        </button>
                        <!-- NÚT KHÓA / MỞ KHÓA -->
                        <button onclick="toggleUserStatusAdmin(${u.id})" class="btn-action-sm" style="background: ${isLocked ? '#dcfce7' : '#fef3c7'}; color: ${isLocked ? '#166534' : '#854d0e'}; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700;" title="Khóa hoặc Mở khóa">
                            <i class="fa-solid ${isLocked ? 'fa-lock-open' : 'fa-lock'}"></i> ${isLocked ? 'Mở' : 'Khóa'}
                        </button>
                        <!-- NÚT XÓA TÀI KHOẢN -->
                        <button onclick="deleteUserAdmin(${u.id})" class="btn-action-sm btn-act-delete" style="background: rgba(239,68,68,0.15); color: #dc2626; border: 1px solid #dc2626; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 11px;" title="Xóa tài khoản">
                            <i class="fa-solid fa-trash"></i> Xóa
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// 3. Tìm kiếm thành viên
window.filterAdminUsers = function () {
    const term = document.getElementById("search-user").value.toLowerCase();
    const filtered = adminUsersList.filter(u =>
        u.fullname.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
    renderAdminUsersTable(filtered);
};

// 4. Modal Thêm thành viên
window.openAddUserModal = () => document.getElementById("modal-add-user").classList.add("active");
window.closeAddUserModal = () => {
    document.getElementById("modal-add-user").classList.remove("active");
    document.getElementById("form-add-user").reset();
};

window.submitAddUser = function (e) {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo...';
    btnSubmit.disabled = true;

    const payload = {
        fullname: document.getElementById("add-user-fullname").value.trim(),
        email: document.getElementById("add-user-email").value.trim(),
        provider: document.getElementById("add-user-provider").value,
        status: document.getElementById("add-user-status").value
    };

    fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Không thể tạo tài khoản");
            return data;
        })
        .then(data => {
            closeAddUserModal();
            showAdminToast(`✅ ${data.message}`);
            fetchAdminUsers();
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => {
            btnSubmit.innerHTML = oldText;
            btnSubmit.disabled = false;
        });
};

// 5. Modal Sửa thành viên
window.openEditUserModal = function (userId) {
    const user = adminUsersList.find(u => u.id === userId);
    if (!user) {
        alert("Không tìm thấy thông tin thành viên!");
        return;
    }

    document.getElementById("edit-user-id").value = `#${user.id}`;
    document.getElementById("edit-user-fullname").value = user.fullname;
    document.getElementById("edit-user-email").value = user.email;
    document.getElementById("edit-user-provider").value = user.provider;
    document.getElementById("edit-user-status").value = user.status;

    // Lưu userId tạm để submit
    document.getElementById("modal-edit-user").setAttribute("data-current-user-id", userId);
    document.getElementById("modal-edit-user").classList.add("active");
};

window.closeEditUserModal = () => document.getElementById("modal-edit-user").classList.remove("active");

window.submitEditUser = function (e) {
    e.preventDefault();
    const userId = document.getElementById("modal-edit-user").getAttribute("data-current-user-id");
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
    btnSubmit.disabled = true;

    const payload = {
        fullname: document.getElementById("edit-user-fullname").value.trim(),
        email: document.getElementById("edit-user-email").value.trim(),
        provider: document.getElementById("edit-user-provider").value,
        status: document.getElementById("edit-user-status").value
    };

    fetch(`${API_BASE}/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Cập nhật thất bại");
            return data;
        })
        .then(data => {
            closeEditUserModal();
            showAdminToast(`✅ ${data.message}`);
            fetchAdminUsers();
        })
        .catch(err => alert("Lỗi: " + err.message))
        .finally(() => {
            btnSubmit.innerHTML = oldText;
            btnSubmit.disabled = false;
        });
};

// 6. Khóa / Mở khóa tài khoản
window.toggleUserStatusAdmin = function (userId) {
    fetch(`${API_BASE}/admin/users/${userId}/toggle-status`, { method: "PUT" })
        .then(res => res.json())
        .then(data => {
            showAdminToast(`🔄 ${data.message}`);
            fetchAdminUsers();
        })
        .catch(err => alert("Lỗi: " + err.message));
};

// 7. Xóa tài khoản
window.deleteUserAdmin = function (userId) {
    if (confirm(`⚠️ Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản #${userId}?`)) {
        fetch(`${API_BASE}/admin/users/${userId}`, { method: "DELETE" })
            .then(res => res.json())
            .then(data => {
                showAdminToast(`🗑️ ${data.message}`);
                fetchAdminUsers();
            })
            .catch(err => alert("Lỗi: " + err.message));
    }
};

// 8. Xuất danh sách thành viên ra file Excel (CSV)
window.exportUsersToCSV = function () {
    if (!adminUsersList || adminUsersList.length === 0) {
        alert("Chưa có danh sách thành viên để xuất!");
        return;
    }

    let csvContent = "\uFEFFID,Họ và Tên,Email,Phương Thức Đăng Ký,Thời Gian Tạo,Trạng Thái\n";
    adminUsersList.forEach(u => {
        csvContent += `${u.id},"${u.fullname}","${u.email}","${u.provider}","${u.created_at || ''}","${u.status}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Danh_sach_Thanh_vien_AirHCM_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showAdminToast("📊 Đã xuất thành công file Excel danh sách thành viên!");
};
// ==============================================================================
// 17. ĐĂNG KÝ PWA SERVICE WORKER (CHO PHÉP CÀI ĐẶT LÀM MOBILE APP)
// ==============================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('✅ AirHCM PWA Service Worker đã sẵn sàng:', reg.scope))
            .catch(err => console.log('❌ Đăng ký Service Worker thất bại:', err));
    });
}