// ==============================================================================
// HỆ THỐNG WEBGIS AIRHCM - JAVASCRIPT ĐIỀU HÀNH BẢN ĐỒ, AI & DSS
// Khoa CNTT - Trường Đại học Tài nguyên & Môi trường TP.HCM (HCMUNRE)
// SVTH: LÊ HOÀNG ÂN - 1250080001 | GVHD: TS. Dương Thị Thúy Nga
// ==============================================================================

// Tự động lấy localhost khi mở trên PC và tự động lấy IP LAN (192.168.1.X) khi mở trên Điện thoại
// Backend phục vụ luôn WebGIS (cùng nguồn) -> dùng chính địa chỉ đang mở (LAN, tên miền, HTTPS);
// chỉ khi mở bằng server tĩnh cổng 3000 / file:// mới gọi Backend ở cổng 8000
const API_BASE = (location.port === "3000" || location.protocol === "file:")
    ? `http://${window.location.hostname || "127.0.0.1"}:8000/api/v1`
    : `${location.origin}/api/v1`;

// Ảnh đại diện thành viên: ảnh Facebook được máy chủ lưu lại (đường dẫn dạng /api/v1/avatars/...)
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, "");
function initialsAvatar(name) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "U")}&background=0284c7&color=fff&bold=true`;
}
function avatarUrl(url, name) {
    if (!url) return initialsAvatar(name);
    return url.startsWith("/") ? API_ORIGIN + url : url;
}
// <img> ảnh đại diện; ảnh hỏng (link hết hạn, máy khác chưa có file) -> tự đổi sang ảnh chữ cái
function avatarImg(user, attrs = "") {
    return `<img src="${escapeHtml(avatarUrl(user.avatar, user.fullname))}" data-fallback="${escapeHtml(initialsAvatar(user.fullname))}" `
        + `onerror="this.onerror=null;this.src=this.dataset.fallback" alt="Avatar" referrerpolicy="no-referrer" ${attrs}>`;
}

let map = null;
let wardsLayer = null;
let selectedWardLayer = null;
let selectedWardFeature = null;
let stationMarkers = [];
let stationDataList = [];
let heatLayer = null;
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

// Tô màu vòng AQI trạm trung tâm (viền + hiệu ứng phát sáng theo cấp độ ô nhiễm)
function paintAQIIndicator(aqi, color) {
    const ringColor = (aqi > 50 && aqi <= 100) ? "#eab308" : color;
    const circle = document.getElementById("aqi-indicator-circle");
    if (circle) {
        circle.style.borderColor = ringColor;
        circle.style.setProperty("--aqi", ringColor);
    }
    const panel = document.getElementById("panel-station");
    if (panel) panel.style.setProperty("--aqi", ringColor);
}

// Trả về cấp độ 1-6 theo thang AQI (dùng cho class màu lvl-* / t-* trong CSS)
function getAQILevelIndex(aqi) {
    if (aqi <= 50) return 1;
    if (aqi <= 100) return 2;
    if (aqi <= 150) return 3;
    if (aqi <= 200) return 4;
    if (aqi <= 300) return 5;
    return 6;
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

// ==============================================================================
// NGUỒN SỐ LIỆU DUY NHẤT CHO PHƯỜNG & TRẠM
// PM2.5 hiện tại của từng phường lấy từ /aqi/spatial-summary (cùng nguồn với trang Điểm nóng,
// bảng phân tích địa điểm, Trợ lý AI và app di động); của từng trạm lấy từ /gis/heatmap.
// Khi xem giờ khác trên thanh mô phỏng: nhân tỉ lệ chu kỳ ngày đêm SO VỚI GIỜ HIỆN TẠI
// -> ở giờ hiện tại, số trên bản đồ trùng khớp tuyệt đối với trang Điểm nóng.
// ==============================================================================
let wardPmByCode = {};      // mã phường -> PM2.5 hiện tại (µg/m³)
let stationPmByCode = {};   // mã trạm -> PM2.5 hiện tại (µg/m³)

function diurnalRatio(hour) {
    const now = DIURNAL_FACTORS[new Date().getHours()] || 1.0;
    return (DIURNAL_FACTORS[hour] || 1.0) / now;
}

function wardCodeOf(feature) {
    const p = (feature && feature.properties) || {};
    return String(p.ma_xa || p.ma_phuong_xa || "");
}

// Tên phường đầy đủ như trên bản đồ (VD: "Phường Bình Đông")
function wardDisplayName(feature) {
    const p = (feature && feature.properties) || {};
    const ward = extractWardDetails(p).ward;
    return `${p.loai && !String(ward).startsWith(p.loai) ? p.loai + " " : ""}${ward}`;
}

function calculateWardAirStats(feature, hour) {
    const known = wardPmByCode[wardCodeOf(feature)];
    if (known !== undefined) {
        const pm25 = parseFloat((known * diurnalRatio(hour)).toFixed(1));
        const aqi = getDynamicAQI(pm25);
        return { pm25, aqi, color: getAQIColor(aqi), advisory: getAdvisoryForAQI(aqi, pm25) };
    }
    return estimateWardAirStats(feature, hour);
}

// Dự phòng khi chưa kết nối được máy chủ: ước tính theo đặc thù khu vực
function estimateWardAirStats(feature, hour) {
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

    const pm25 = parseFloat((basePM * diurnalRatio(hour) * zoneMultiplier * microVariation).toFixed(1));
    const aqi = getDynamicAQI(pm25);
    const color = getAQIColor(aqi);
    const advisory = getAdvisoryForAQI(aqi, pm25);

    return { pm25, aqi, color, advisory };
}

// Tô lại màu 166 phường + popup đang mở sau khi có số liệu mới
function refreshWardStyles() {
    if (!wardsLayer) return;
    wardsLayer.eachLayer(layer => {
        if (layer.feature && layer !== selectedWardLayer) layer.setStyle(getWardStyleByAQI(layer.feature, currentHourSimulated));
    });
    if (selectedWardLayer && selectedWardLayer.isPopupOpen && selectedWardLayer.isPopupOpen()) {
        updateSelectedWardPopup(currentHourSimulated);
    }
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
            <div class="iqair-station-badge" style="background-color: ${color}; color: ${textColor}; --c: ${color};" title="AQI: ${aqi}">
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
    const known = stationPmByCode[String(st.ma_tram)];
    // Số liệu máy chủ (= PM2.5 của phường chứa trạm); dự phòng khi mất kết nối: ước tính quanh trạm trung tâm
    const pmNow = known !== undefined
        ? known
        : (latestBasePM25 > 0 ? latestBasePM25 : 22.0) * (Math.abs(Math.sin(lat * 120 + lng * 60)) * 0.20 + 0.90);

    const pm25 = parseFloat((pmNow * diurnalRatio(hour)).toFixed(1));
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
    fetchHeatmapPoints();
    fetchActiveAlert();
    // Làm mới số liệu quan trắc, phường/trạm, cảnh báo DSS & bản đồ nhiệt mỗi 5 phút (giữ đồng bộ với máy chủ)
    setInterval(() => {
        fetchCurrentAQI();
        fetchHotspotsSummary();
        fetchActiveAlert();
        fetchHeatmapPoints();
    }, 5 * 60 * 1000);

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

            // Mức độ tính theo chuẩn đang chọn (VN_AQI / US AQI) để khớp với con số hiển thị và thẻ DSS
            const localAdvisory = getAdvisoryForAQI(aqi, pm25);
            const aqiColor = localAdvisory.color;
            const levelText = localAdvisory.level;

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

            paintAQIIndicator(aqi, aqiColor);

            const qcvnTag = document.getElementById("qcvn-tag");
            if (qcvnTag) qcvnTag.textContent = data.advisory ? data.advisory.qcvn_comparison : (pm25 <= 50 ? "Đạt quy chuẩn QCVN 05:2023" : "Vượt ngưỡng QCVN 05:2023");

            // Đồng bộ 3 thẻ khuyến nghị DSS theo số liệu thực tế
            updateDSSOverview(aqi, pm25);

            // Cập nhật thông số gió thật
            if (data.wind_speed) currentWindSpeed = parseFloat(data.wind_speed);
            if (data.wind_direction) currentWindDeg = parseFloat(data.wind_direction);
            startWindAnimation();

            // Đang xem giờ mô phỏng khác giờ hiện tại -> giữ nguyên chế độ mô phỏng với số liệu mới
            if (currentHourSimulated !== new Date().getHours()) applyTimeStep(currentHourSimulated);
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
            paintAQIIndicator(68, "#FFFF00");
            updateDSSOverview(getDynamicAQI(latestBasePM25), latestBasePM25);
        });
}

let stationFetchRetries = 0;
function fetchStations() {
    fetch(`${API_BASE}/gis/stations`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi API trạm: " + res.status);
            return res.json();
        })
        .then(stations => {
            if (!Array.isArray(stations)) throw new Error("Dữ liệu trạm không phải dạng mảng");
            stationFetchRetries = 0;
            return stations;
        })
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

                const lvl = getAQILevelIndex(stats.aqi);
                marker.bindPopup(`
                    <div class="pop-card">
                        <h4 class="pop-title"><i class="fa-solid fa-tower-broadcast"></i> ${st.ten_tram}</h4>
                        <div class="pop-sub">Mã trạm: ${st.ma_tram}</div>
                        <div class="pop-meta">
                            <span><b>Đơn vị:</b> ${st.don_vi_quan_ly}</span>
                            <span><b>Tọa độ:</b> ${lat.toFixed(4)}N, ${lng.toFixed(4)}E</span>
                        </div>
                        <div class="pop-row">
                            <span>Chỉ số ${currentAQIStandard === 'VN' ? 'VN_AQI' : 'US AQI'}</span>
                            <span class="aqi-pill lvl-${lvl}">${stats.aqi} · ${stats.advisory.level}</span>
                        </div>
                        <div class="pop-row">
                            <span>Bụi mịn PM2.5</span>
                            <b class="text-blue">${stats.pm25} µg/m³</b>
                        </div>
                    </div>
                `);

                stationMarkers.push({ marker: marker, data: st });
            });

            updateHeatmapLayer(currentHourSimulated);
        })
        .catch(err => {
            console.error("Lỗi nạp trạm từ API:", err);
            // Backend có thể chưa sẵn sàng lúc mở trang -> tự thử lại (tối đa 6 lần, cách nhau 5 giây)
            if (stationFetchRetries < 6) {
                stationFetchRetries++;
                setTimeout(fetchStations, 5000);
            }
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
                            // Vị trí Trợ lý AI tư vấn = phường vừa chọn (theo mã phường, không đoán theo tọa độ)
                            setMapSelection({
                                kind: "ward", code: wardCodeOf(feature), name: wardDisplayName(feature),
                                lat: e.latlng.lat, lng: e.latlng.lng
                            });

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
    const clicked = evt && evt.target ? evt.target.closest('.btn-forecast') : null;
    if (clicked) {
        document.querySelectorAll('.forecast-controls .btn-forecast').forEach(btn => btn.classList.remove('active'));
        clicked.classList.add('active');
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
        let rowsHtml = "";
        forecastData.forEach(item => {
            const lvl = getAQILevelIndex(parseInt(item.aqi));

            const isStandard = item.pm2_5 <= 50;
            const qcvnBadge = isStandard
                ? `<span class="chip chip-success"><i class="fa-solid fa-check"></i> Dưới ngưỡng 24h</span>`
                : `<span class="chip chip-danger"><i class="fa-solid fa-triangle-exclamation"></i> Trên ngưỡng 24h</span>`;

            rowsHtml += `
                <tr>
                    <td class="cell-strong nowrap">${item.time}</td>
                    <td class="center cell-brand nowrap">${item.pm2_5.toFixed(2)} µg/m³</td>
                    <td class="center cell-muted nowrap">${item.pm10 ? parseFloat(item.pm10).toFixed(2) : (item.pm2_5 * 1.35).toFixed(2)} µg/m³</td>
                    <td class="center"><b class="aqi-num t-${lvl}">${item.aqi}</b></td>
                    <td class="center"><span class="aqi-pill lvl-${lvl}">${item.level || 'Bình thường'}</span></td>
                    <td class="center">${qcvnBadge}</td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
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

    // Dải màu chuyển sắc cho vùng tô PM2.5 (đậm phía trên, mờ dần xuống trục hoành)
    const chartHeight = canvas.parentElement ? canvas.parentElement.clientHeight : 340;
    const pmGradient = ctx.createLinearGradient(0, 0, 0, chartHeight || 340);
    pmGradient.addColorStop(0, "rgba(6, 182, 212, 0.35)");
    pmGradient.addColorStop(0.55, "rgba(2, 132, 199, 0.10)");
    pmGradient.addColorStop(1, "rgba(2, 132, 199, 0)");

    const chartFont = { family: "'Plus Jakarta Sans', sans-serif" };

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
                    backgroundColor: pmGradient,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: hours <= 24 ? 2.5 : 0,
                    pointHoverRadius: 6,
                    pointBackgroundColor: "#ffffff",
                    pointBorderColor: "#0284c7",
                    pointBorderWidth: 2,
                    pointHoverBackgroundColor: "#0284c7",
                    pointHoverBorderColor: "#ffffff"
                },
                {
                    label: aqiDatasetLabel, // ĐỔI ĐỘNG TÊN LABEL DATASET
                    data: aqiValues,
                    yAxisID: "yAQI",
                    borderColor: "#f59e0b",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    borderDash: [6, 5],
                    tension: 0.4,
                    pointRadius: hours <= 24 ? 2.5 : 0,
                    pointHoverRadius: 6,
                    pointBackgroundColor: "#f59e0b",
                    pointBorderColor: "#ffffff",
                    pointBorderWidth: 1.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 900, easing: "easeOutQuart" },
            plugins: {
                legend: {
                    position: "top",
                    align: "end",
                    labels: {
                        color: "#334155",
                        usePointStyle: true,
                        pointStyle: "circle",
                        boxWidth: 8,
                        boxHeight: 8,
                        padding: 16,
                        font: { ...chartFont, size: 12, weight: '700' }
                    }
                },
                tooltip: {
                    backgroundColor: "rgba(15, 23, 42, 0.92)",
                    titleColor: "#67e8f9",
                    bodyColor: "#ffffff",
                    titleFont: { ...chartFont, weight: '800' },
                    bodyFont: { ...chartFont, weight: '600' },
                    padding: 12,
                    cornerRadius: 12,
                    boxPadding: 6,
                    usePointStyle: true,
                    borderWidth: 0
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#64748b",
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: hours <= 24 ? 12 : 10,
                        font: { ...chartFont, size: 11, weight: '600' }
                    },
                    grid: { display: false },
                    border: { display: false }
                },
                yAQI: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: aqiAxisTitle, // ĐỔI ĐỘNG TIÊU ĐỀ TRỤC Y BÊN TRÁI
                        color: '#d97706',
                        font: { ...chartFont, weight: '800', size: 11.5 }
                    },
                    ticks: { color: "#d97706", font: { ...chartFont, size: 11, weight: '600' } },
                    suggestedMin: 0,
                    suggestedMax: 160,
                    grid: { color: "rgba(148, 163, 184, 0.18)", drawTicks: false },
                    border: { display: false, dash: [4, 4] }
                },
                yPM: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'PM2.5 (µg/m³)', color: '#0284c7', font: { ...chartFont, weight: '800', size: 11.5 } },
                    ticks: { color: "#0284c7", font: { ...chartFont, size: 11, weight: '600' } },
                    suggestedMin: 0,
                    suggestedMax: 45,
                    grid: { drawOnChartArea: false },
                    border: { display: false }
                }
            }
        }
    });
}

function fetchHotspotsSummary() {
    fetch(`${API_BASE}/aqi/spatial-summary`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi: " + res.status);
            return res.json();
        })
        .then(wards => {
            allWardsData = wards;
            // Nguồn số liệu chung cho màu phường + popup trên bản đồ
            wardPmByCode = {};
            wards.forEach(w => { wardPmByCode[String(w.ma_phuong_xa)] = parseFloat(w.pm2_5_trung_binh); });
            refreshWardStyles();
            renderHotspotsTable(wards);
            const note = document.getElementById("hotspots-updated");
            if (note) note.textContent = `Số liệu hiện tại · cập nhật ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · trùng khớp với bản đồ ở giờ hiện tại`;
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
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><i class="fa-solid fa-magnifying-glass"></i> Không tìm thấy Phường/Xã phù hợp.</td></tr>`;
        return;
    }

    let rowsHtml = "";
    data.forEach((w, index) => {
        const pm = parseFloat(w.pm2_5_trung_binh);
        const aqi = getDynamicAQI(pm);
        const advisory = getAdvisoryForAQI(aqi, pm);
        const lvl = getAQILevelIndex(aqi);
        const rankCls = index < 3 ? ` r${index + 1}` : "";

        rowsHtml += `
            <tr>
                <td class="center"><span class="rank-badge${rankCls}">${index + 1}</span></td>
                <td><b>${w.ma_phuong_xa}</b></td>
                <td class="cell-strong">${w.ten_phuong_xa}</td>
                <td class="nowrap">${w.dien_tich_km2} km²</td>
                <td><span class="chip chip-info"><i class="fa-solid fa-tower-broadcast"></i> ${w.so_luong_tram || 1} trạm</span></td>
                <td class="cell-brand nowrap">${pm} µg/m³</td>
                <td class="center"><b class="aqi-num t-${lvl}">${aqi}</b></td>
                <td><span class="aqi-pill lvl-${lvl}">${advisory.level}</span></td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
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

    // Ở giờ hiện tại = đúng số đo trạm trung tâm; giờ khác = nhân tỉ lệ chu kỳ ngày đêm so với hiện tại
    const simPM25 = parseFloat((latestBasePM25 * diurnalRatio(hour)).toFixed(1));
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

    paintAQIIndicator(simAQI, aqiColor);

    // Tô màu phần đã chạy của thanh thời gian (khi phát tự động)
    if (typeof window.syncRangeFill === "function") {
        window.syncRangeFill(document.getElementById("time-slider"));
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

    // 5. Trường gió theo giờ mô phỏng
    if (typeof refreshWindForHour === "function") refreshWindForHour();
} // Dấu đóng ngoặc kết thúc hàm applyTimeStep


// Điểm bản đồ nhiệt lấy từ API PostGIS (/gis/heatmap): tâm 166 phường + trạm quan trắc
let heatmapApiPoints = null;

function fetchHeatmapPoints() {
    fetch(`${API_BASE}/gis/heatmap`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi heatmap: " + res.status);
            return res.json();
        })
        .then(geo => {
            // PM2.5 của từng trạm (cùng nguồn máy chủ với app di động)
            (geo.features || []).forEach(f => {
                const p = f.properties || {};
                if (p.type === "station" && p.code != null) stationPmByCode[String(p.code)] = parseFloat(p.pm2_5);
            });
            updateStationMarkersHour(currentHourSimulated);

            const pts = (geo.features || [])
                .filter(f => f.geometry && Array.isArray(f.geometry.coordinates))
                .map(f => ({
                    lat: f.geometry.coordinates[1],
                    lng: f.geometry.coordinates[0],
                    weight: Number(f.properties && f.properties.weight) || 0.3
                }));
            if (pts.length > 0) {
                heatmapApiPoints = pts;
                updateHeatmapLayer(currentHourSimulated);
            }
        })
        .catch(err => console.warn("Bản đồ nhiệt dùng dữ liệu dự phòng:", err.message));
}

function updateHeatmapLayer(hour) {
    if (!map) return;
    try {
        const factor = DIURNAL_FACTORS[hour] || 1.0;
        let heatPoints = [];
        const useApi = Array.isArray(heatmapApiPoints) && heatmapApiPoints.length > 0;

        if (useApi) {
            // Trọng số API là của giờ hiện tại -> quy đổi tương đối theo giờ đang mô phỏng
            const nowFactor = DIURNAL_FACTORS[new Date().getHours()] || 1.0;
            const relative = factor / nowFactor;
            heatPoints = heatmapApiPoints.map(p => [p.lat, p.lng, Math.min(1.0, p.weight * relative)]);
        } else {
            stationMarkers.forEach(item => {
                if (item && item.marker) {
                    const pos = item.marker.getLatLng();
                    heatPoints.push([pos.lat, pos.lng, Math.min(1.0, 0.5 * factor)]);
                }
            });
            [
                [10.7769, 106.7009, 0.60 * factor],
                [10.7540, 106.6634, 0.75 * factor],
                [10.7483, 106.6022, 0.90 * factor],
                [10.8494, 106.7583, 0.70 * factor],
                [10.8231, 106.6297, 0.65 * factor]
            ].forEach(pt => heatPoints.push(pt));
        }

        // Dữ liệu API dày đặc hơn -> bán kính nhỏ & ngưỡng bão hòa cao để không bị "đỏ rực" toàn vùng
        const heatOptions = useApi
            ? { radius: 32, blur: 24, maxZoom: 14, max: 2.2 }
            : { radius: 55, blur: 35, maxZoom: 14, max: 1.0 };

        if (heatLayer) {
            // Cập nhật dữ liệu kể cả khi lớp đang tắt (không tự bật lại lớp người dùng đã tắt)
            heatLayer.setOptions(heatOptions);
            heatLayer.setLatLngs(heatPoints);
        } else if (typeof L.heatLayer !== 'undefined') {
            const chkHeat = document.getElementById("chk-heatmap");
            heatLayer = L.heatLayer(heatPoints, {
                ...heatOptions,
                gradient: { 0.20: '#00E400', 0.40: '#FFFF00', 0.60: '#FF7E00', 0.80: '#FF0000', 1.00: '#8F3F97' }
            });
            if (!chkHeat || chkHeat.checked) heatLayer.addTo(map);
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
    if (btnLocate) {
        btnLocate.addEventListener("click", e => {
            e.preventDefault();
            locateMe({ openPanel: true });
        });
    }

    // Chuột phải (máy tính) hoặc nhấn giữ (điện thoại) lên bản đồ -> phân tích điểm đó
    if (map) {
        map.on("contextmenu", e => {
            const { lat, lng } = e.latlng;
            openPlacePanel({ lat, lng, name: "Điểm đã chọn trên bản đồ", address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, kind: "point" });
            reverseGeocode(lat, lng).then(info => {
                if (info && currentPlace && currentPlace.lat === lat && currentPlace.lng === lng) {
                    currentPlace.name = info.name;
                    currentPlace.address = info.address;
                    setSafeText("pp-name", info.name);
                    setSafeText("pp-address", info.address);
                }
            });
        });
    }

    initPlaceSearch();
}

// ==============================================================================
// TÌM KIẾM ĐỊA ĐIỂM - ĐỊNH VỊ - KHOẢNG CÁCH & ĐƯỜNG ĐI - AQI & DSS TẠI ĐIỂM
// (Sequence Diagram: Frontend gửi tọa độ -> Backend -> AI Engine + PostGIS -> JSON)
// ==============================================================================
const HCM_BBOX = { minLng: 106.0, minLat: 10.0, maxLng: 107.9, maxLat: 11.9 };
let currentPlace = null;
let myLocation = null;             // {lat, lng, accuracy}
let myLocationLayer = null;
let placeMarker = null;
let routeLayer = null;
let placeSearchTimer = null;
let placeSearchSeq = 0;
let suggestItems = [];
let suggestActive = -1;

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeVi(str) {
    return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
}

function formatDistance(m) {
    if (m == null || isNaN(m)) return "--";
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`;
}

function formatDuration(s) {
    const min = Math.max(1, Math.round(s / 60));
    if (min < 60) return `${min} phút`;
    return `${Math.floor(min / 60)} giờ ${min % 60 ? (min % 60) + " phút" : ""}`.trim();
}

function initPlaceSearch() {
    const input = document.getElementById("place-search-input");
    const clearBtn = document.getElementById("place-search-clear");
    const locateBtn = document.getElementById("place-locate-btn");
    const box = document.getElementById("place-search");
    if (!input || !box) return;

    if (typeof L !== "undefined" && L.DomEvent) {
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
    }

    input.addEventListener("input", () => {
        const q = input.value.trim();
        if (clearBtn) clearBtn.hidden = q.length === 0;
        clearTimeout(placeSearchTimer);
        if (q.length < 2) {
            hideSuggest();
            return;
        }
        // Gợi ý tức thì từ phường/xã & trạm, sau đó bổ sung địa chỉ thật (OpenStreetMap)
        renderSuggest(localPlaceSearch(q), true);
        placeSearchTimer = setTimeout(() => geocodeSearch(q), 350);
    });

    input.addEventListener("keydown", e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!suggestItems.length) return;
            suggestActive = (suggestActive + (e.key === "ArrowDown" ? 1 : -1) + suggestItems.length) % suggestItems.length;
            highlightSuggest();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (suggestItems.length) {
                selectSuggest(suggestActive >= 0 ? suggestActive : 0);
            } else if (input.value.trim().length >= 2) {
                geocodeSearch(input.value.trim(), true);
            }
        } else if (e.key === "Escape") {
            hideSuggest();
            input.blur();
        }
    });

    input.addEventListener("focus", () => {
        if (suggestItems.length) document.getElementById("place-suggest").hidden = false;
    });

    document.addEventListener("click", e => {
        if (!e.target.closest("#place-search")) hideSuggest();
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            input.value = "";
            clearBtn.hidden = true;
            hideSuggest();
            input.focus();
        });
    }

    if (locateBtn) locateBtn.addEventListener("click", () => locateMe({ openPanel: true }));
}

function localPlaceSearch(q) {
    const nq = normalizeVi(q);
    const results = [];

    if (wardsLayer) {
        wardsLayer.eachLayer(layer => {
            if (results.length >= 4 || !layer.feature) return;
            const info = extractWardDetails(layer.feature.properties);
            if (normalizeVi(info.ward).includes(nq)) {
                const c = layer.getBounds().getCenter();
                const p = layer.feature.properties || {};
                results.push({
                    kind: "ward", code: wardCodeOf(layer.feature), lat: c.lat, lng: c.lng,
                    name: `${p.loai && !String(info.ward).startsWith(p.loai) ? p.loai + " " : ""}${info.ward}`,
                    address: "Ranh giới hành chính · TP. Hồ Chí Minh",
                    bounds: layer.getBounds()
                });
            }
        });
    }

    (stationDataList || []).forEach(st => {
        if (results.length >= 6) return;
        if (normalizeVi(st.ten_tram).includes(nq) || normalizeVi(st.ma_tram).includes(nq)) {
            results.push({ kind: "station", lat: Number(st.lat), lng: Number(st.lng), name: st.ten_tram, address: `Trạm quan trắc ${st.ma_tram}` });
        }
    });
    return results;
}

function photonToPlace(f) {
    const p = f.properties || {};
    const [lng, lat] = f.geometry.coordinates;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.district || p.city || "Địa điểm";
    const address = [
        p.name && p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : null,
        p.district, p.city, p.state
    ].filter((v, i, arr) => v && v !== name && arr.indexOf(v) === i).join(", ");
    return { kind: "geo", lat, lng, name, address: address || "TP. Hồ Chí Minh", type: p.osm_value || p.type };
}

function geocodeSearch(q, pickFirst = false) {
    const seq = ++placeSearchSeq;
    const params = new URLSearchParams({
        q, limit: "8", lat: "10.80", lon: "106.70", lang: "default",
        bbox: `${HCM_BBOX.minLng},${HCM_BBOX.minLat},${HCM_BBOX.maxLng},${HCM_BBOX.maxLat}`
    });
    const box = document.getElementById("place-suggest");
    if (box && !box.hidden) box.classList.add("is-loading");

    fetch(`https://photon.komoot.io/api/?${params}`)
        .then(res => {
            if (!res.ok) throw new Error("Photon " + res.status);
            return res.json();
        })
        .then(data => (data.features || []).filter(f => f.geometry).map(photonToPlace))
        .catch(() => {
            // Dự phòng: Nominatim (chỉ gọi 1 lần khi người dùng nhấn Enter)
            if (!pickFirst) return [];
            const nParams = new URLSearchParams({
                q, format: "jsonv2", limit: "5", countrycodes: "vn", "accept-language": "vi",
                viewbox: `${HCM_BBOX.minLng},${HCM_BBOX.maxLat},${HCM_BBOX.maxLng},${HCM_BBOX.minLat}`, bounded: "1"
            });
            return fetch(`https://nominatim.openstreetmap.org/search?${nParams}`)
                .then(r => r.json())
                .then(list => list.map(it => ({
                    kind: "geo", lat: Number(it.lat), lng: Number(it.lon),
                    name: it.name || String(it.display_name).split(",")[0],
                    address: String(it.display_name).split(",").slice(1, 4).join(",").trim()
                })))
                .catch(() => []);
        })
        .then(geoResults => {
            if (seq !== placeSearchSeq) return;   // Kết quả cũ -> bỏ qua
            if (box) box.classList.remove("is-loading");
            // Gộp kết quả, bỏ trùng tên ở gần nhau (< 300 m)
            const merged = [];
            [...localPlaceSearch(q), ...geoResults].forEach(it => {
                const dup = merged.some(m => normalizeVi(m.name) === normalizeVi(it.name) && haversineMeters(m, it) < 300);
                if (!dup && merged.length < 9) merged.push(it);
            });
            renderSuggest(merged, false, q);
            if (pickFirst && merged.length) selectSuggest(0);
        });
}

function renderSuggest(items, loading, query) {
    const box = document.getElementById("place-suggest");
    if (!box) return;
    suggestItems = items;
    suggestActive = items.length ? 0 : -1;
    const icons = { ward: "fa-map", station: "fa-tower-broadcast", geo: "fa-location-dot" };
    const labels = { ward: "Phường/Xã", station: "Trạm", geo: "Địa điểm" };

    if (!items.length) {
        box.innerHTML = loading
            ? `<div class="ps-empty"><span class="loader-dots"></span> Đang tìm địa điểm...</div>`
            : `<div class="ps-empty"><i class="fa-solid fa-circle-info"></i> Không tìm thấy "${escapeHtml(query || "")}" trong khu vực TP.HCM</div>`;
    } else {
        box.innerHTML = items.map((it, i) => `
            <button type="button" class="ps-item${i === suggestActive ? " active" : ""}" data-idx="${i}">
                <span class="ps-item-icon ps-${it.kind}"><i class="fa-solid ${icons[it.kind]}"></i></span>
                <span class="ps-item-text"><b>${escapeHtml(it.name)}</b><small>${escapeHtml(it.address || "")}</small></span>
                <span class="ps-item-tag">${labels[it.kind]}</span>
            </button>
        `).join("") + (loading ? `<div class="ps-empty ps-more"><span class="loader-dots"></span> Đang tìm thêm địa chỉ...</div>` : "");
        box.querySelectorAll(".ps-item").forEach(btn => {
            btn.addEventListener("click", () => selectSuggest(Number(btn.dataset.idx)));
        });
    }
    box.hidden = false;
}

function highlightSuggest() {
    document.querySelectorAll("#place-suggest .ps-item").forEach((el, i) => el.classList.toggle("active", i === suggestActive));
}

function hideSuggest() {
    const box = document.getElementById("place-suggest");
    if (box) box.hidden = true;
}

function selectSuggest(i) {
    const item = suggestItems[i];
    if (!item) return;
    const input = document.getElementById("place-search-input");
    if (input) input.value = item.name;
    hideSuggest();
    openPlacePanel(item);
}

function reverseGeocode(lat, lng) {
    return fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=default`)
        .then(r => r.json())
        .then(d => {
            const f = (d.features || [])[0];
            return f ? photonToPlace(f) : null;
        })
        .catch(() => null);
}

// Định vị GPS của người dùng (chấm xanh + vòng sai số như bản đồ thật)
function locateMe({ openPanel = false } = {}) {
    const btns = [document.getElementById("place-locate-btn"), document.getElementById("btn-locate")].filter(Boolean);
    btns.forEach(b => b.classList.add("is-locating"));

    const done = () => btns.forEach(b => b.classList.remove("is-locating"));
    const onPosition = (lat, lng, accuracy, approximate) => {
        done();
        myLocation = { lat, lng, accuracy };
        if (myLocationLayer) map.removeLayer(myLocationLayer);
        myLocationLayer = L.layerGroup([
            L.circle([lat, lng], { radius: Math.min(accuracy || 60, 1500), color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.12, interactive: false }),
            L.marker([lat, lng], {
                icon: L.divIcon({ className: "my-location-wrapper", html: '<div class="my-location-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
                zIndexOffset: 1000
            }).bindTooltip(approximate ? "Vị trí mặc định (không lấy được GPS)" : "Vị trí của bạn", { direction: "top", offset: [0, -10] })
        ]).addTo(map);

        if (currentPlace && currentPlace.kind !== "me" && !openPanel) {
            updateRoute();
        } else if (openPanel) {
            openPlacePanel({ lat, lng, name: approximate ? "Trung tâm TP.HCM (mặc định)" : "Vị trí của bạn", address: approximate ? "Trình duyệt chưa cấp quyền vị trí" : `Sai số ±${Math.round(accuracy || 0)} m`, kind: "me" });
            reverseGeocode(lat, lng).then(info => {
                if (info && currentPlace && currentPlace.kind === "me") {
                    currentPlace.address = [info.name, info.address].filter(Boolean).join(", ");
                    setSafeText("pp-address", currentPlace.address);
                }
            });
        }
    };

    if (!navigator.geolocation) {
        onPosition(10.7769, 106.7009, 0, true);
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false),
        () => onPosition(10.7769, 106.7009, 0, true),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function placeFitPadding() {
    const mobile = window.innerWidth <= 768;
    return mobile
        ? { paddingTopLeft: [30, 90], paddingBottomRight: [30, Math.round(window.innerHeight * 0.5)] }
        : { paddingTopLeft: [430, 90], paddingBottomRight: [320, 40] };
}

// Địa điểm người dùng đang xem gần nhất (phường bấm trên bản đồ / địa điểm tìm kiếm / GPS)
// -> Trợ lý AI tư vấn đúng vị trí này. key thay đổi mỗi lần chọn mới.
window.airhcmSelection = null;
function setMapSelection(sel) {
    window.airhcmSelection = sel ? { ...sel, key: `${sel.kind}:${sel.code || ""}:${Number(sel.lat).toFixed(5)},${Number(sel.lng).toFixed(5)}` } : null;
}

function openPlacePanel(place) {
    if (!map) return;
    currentPlace = { ...place };
    setMapSelection({
        kind: place.kind, code: place.code || null, lat: place.lat, lng: place.lng,
        name: place.kind === "me" ? "Vị trí của bạn" : place.name
    });
    const tabMap = document.getElementById("tab-map");
    if (tabMap) tabMap.classList.add("place-open");

    // Ghim địa điểm (không ghim khi là vị trí của chính người dùng)
    if (placeMarker) map.removeLayer(placeMarker);
    placeMarker = null;
    if (place.kind !== "me") {
        placeMarker = L.marker([place.lat, place.lng], {
            icon: L.divIcon({ className: "insight-pin-wrapper", html: '<div class="insight-pin"><i class="fa-solid fa-location-dot"></i></div>', iconSize: [30, 38], iconAnchor: [15, 36] }),
            zIndexOffset: 900
        }).addTo(map);
    }
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }

    if (place.bounds) map.flyToBounds(place.bounds, { ...placeFitPadding(), duration: 0.9, maxZoom: 15 });
    else map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 14), { duration: 0.9 });

    renderPlacePanel(null);
    const seq = currentPlace;
    fetch(`${API_BASE}/gis/location-insight?lat=${place.lat.toFixed(6)}&lng=${place.lng.toFixed(6)}${place.code ? `&ward_code=${encodeURIComponent(place.code)}` : ""}`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi: " + res.status);
            return res.json();
        })
        .then(data => {
            if (seq !== currentPlace) return;
            currentPlace.insight = data;
            renderPlacePanel(data);
        })
        .catch(err => {
            if (seq !== currentPlace) return;
            renderPlacePanel({ error: err.message });
        });

    if (place.kind !== "me" && myLocation) updateRoute();
}

function closePlacePanel() {
    // Đóng bảng địa điểm -> Trợ lý AI quay về phường đang chọn trên bản đồ (nếu còn) hoặc tư vấn chung
    if (currentPlace && window.airhcmSelection && window.airhcmSelection.kind === currentPlace.kind
        && window.airhcmSelection.lat === currentPlace.lat && window.airhcmSelection.lng === currentPlace.lng) {
        setMapSelection(selectedWardLayer && selectedWardFeature ? {
            kind: "ward", code: wardCodeOf(selectedWardFeature), name: wardDisplayName(selectedWardFeature),
            ...selectedWardLayer.getBounds().getCenter()
        } : null);
    }
    currentPlace = null;
    const panel = document.getElementById("panel-place");
    if (panel) panel.hidden = true;
    const tabMap = document.getElementById("tab-map");
    if (tabMap) tabMap.classList.remove("place-open");
    if (placeMarker) map.removeLayer(placeMarker);
    if (routeLayer) map.removeLayer(routeLayer);
    placeMarker = null;
    routeLayer = null;
}
window.closePlacePanel = closePlacePanel;
window.locateMeForRoute = () => locateMe({ openPanel: false });

function haversineMeters(a, b) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// ==============================================================================
// CHỈ ĐƯỜNG THEO PHƯƠNG TIỆN: Ô TÔ · XE MÁY · XE ĐẠP · ĐI BỘ
// OSRM của FOSSGIS (routing.openstreetmap.de - máy chủ chỉ đường của openstreetmap.org)
// với 3 hồ sơ car / bike / foot. Không có hồ sơ xe máy nên:
//   - chọn tuyến ô tô KHÔNG đi đường cao tốc (số hiệu CT.xx / tên "cao tốc" - cấm xe máy);
//   - nếu mọi tuyến ô tô đều đi cao tốc thì dùng hình học tuyến xe đạp (vốn tránh cao tốc).
// Lỗi mạng -> ước tính theo đường chim bay.
// ==============================================================================
const OSRM_BASE = "https://routing.openstreetmap.de";
const TRAVEL_MODES = {
    car: { label: "Ô tô", icon: "fa-car-side", color: "#2563eb", kmh: 30 },
    moto: { label: "Xe máy", icon: "fa-motorcycle", color: "#ea580c", kmh: 28 },
    bike: { label: "Xe đạp", icon: "fa-bicycle", color: "#16a34a", kmh: 13 },
    foot: { label: "Đi bộ", icon: "fa-person-walking", color: "#0891b2", kmh: 4.8, dash: "1 10" },
};
const MOTO_SLOWER_FACTOR = 1.1;   // Xe máy thường chạy chậm hơn ô tô một chút trên các trục đường lớn
let travelMode = (() => {
    try {
        const saved = localStorage.getItem("airhcm_travel_mode");
        return TRAVEL_MODES[saved] ? saved : "moto";   // Mặc định xe máy - phương tiện phổ biến nhất ở TP.HCM
    } catch (_) {
        return "moto";
    }
})();

function osrmRoutes(profile, from, to, extra = "") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const url = `${OSRM_BASE}/${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson${extra}`;
    return fetch(url, { signal: ctrl.signal })
        .then(r => {
            if (!r.ok) throw new Error("OSRM " + r.status);
            return r.json();
        })
        .then(d => {
            if (d.code !== "Ok" || !d.routes || !d.routes.length) throw new Error(d.message || "Không có tuyến đường");
            return d.routes;
        })
        .finally(() => clearTimeout(timer));
}

// Đường cao tốc Việt Nam: số hiệu CT.xx hoặc tên chứa "cao tốc" (gồm cả đường dẫn cao tốc)
function usesExpressway(route) {
    return (route.legs || []).some(leg => (leg.steps || []).some(s =>
        /^CT[.\s-]?\d/i.test(s.ref || "") || /cao tốc/i.test(s.name || "")));
}

function toRoute(r, extra = {}) {
    return {
        distance: r.distance, duration: r.duration, road: true,
        coords: r.geometry.coordinates.map(c => [c[1], c[0]]),
        ...extra
    };
}

// Lấy tuyến cho cả 4 phương tiện song song (3 lời gọi OSRM), phương tiện nào xong trước hiện trước
function updateRoute() {
    if (!currentPlace || !myLocation || currentPlace.kind === "me") return;
    const from = { lat: myLocation.lat, lng: myLocation.lng };
    const to = { lat: currentPlace.lat, lng: currentPlace.lng };
    const target = currentPlace;
    const straight = haversineMeters(from, to);
    target.route = { loading: true, straight, modes: {} };
    renderRouteBlock();

    const fallback = mode => ({
        distance: straight, duration: straight / (TRAVEL_MODES[mode].kmh / 3.6), road: false,
        coords: [[from.lat, from.lng], [to.lat, to.lng]]
    });
    const car = osrmRoutes("routed-car", from, to, "&alternatives=3&steps=true");
    const bike = osrmRoutes("routed-bike", from, to);
    const foot = osrmRoutes("routed-foot", from, to);

    const motoRoute = async () => {
        try {
            const list = await car;
            const allowed = list.find(r => !usesExpressway(r));
            if (allowed) return toRoute(allowed, { duration: allowed.duration * MOTO_SLOWER_FACTOR, avoided: allowed !== list[0] });
        } catch (_) { /* thử tuyến xe đạp */ }
        const b = (await bike)[0];
        return toRoute(b, { duration: b.distance / (TRAVEL_MODES.moto.kmh / 3.6), avoided: true });
    };

    const jobs = {
        car: car.then(list => toRoute(list[0])),
        moto: motoRoute(),
        bike: bike.then(list => toRoute(list[0])),
        foot: foot.then(list => toRoute(list[0])),
    };
    Object.entries(jobs).forEach(([mode, job]) => {
        job.catch(() => fallback(mode)).then(route => {
            if (target !== currentPlace) return;
            target.route.modes[mode] = route;
            target.route.loading = Object.keys(target.route.modes).length < 4;
            if (mode === travelMode) drawRoute(route, mode);
            renderRouteBlock();
        });
    });
}

window.setTravelMode = function (mode) {
    if (!TRAVEL_MODES[mode]) return;
    travelMode = mode;
    try { localStorage.setItem("airhcm_travel_mode", mode); } catch (_) { /* bộ nhớ trình duyệt bị chặn */ }
    const route = currentPlace && currentPlace.route && currentPlace.route.modes && currentPlace.route.modes[mode];
    if (route) drawRoute(route, mode);
    renderRouteBlock();
};

function drawRoute(route, mode = travelMode) {
    if (routeLayer) map.removeLayer(routeLayer);
    const m = TRAVEL_MODES[mode];
    const casing = L.polyline(route.coords, { color: "#ffffff", weight: m.dash ? 9 : 10, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false });
    const line = L.polyline(route.coords, {
        color: m.color, weight: m.dash ? 6 : 5.5, opacity: 0.95, lineCap: "round", lineJoin: "round",
        dashArray: route.road ? (m.dash || null) : "2 10", interactive: false
    });
    const mid = route.coords[Math.floor(route.coords.length / 2)];
    const label = L.marker(mid, {
        icon: L.divIcon({
            className: "route-label-wrapper",
            html: `<div class="route-label" style="--route: ${m.color};"><i class="fa-solid ${m.icon}"></i> ${formatDistance(route.distance)} · ${formatDuration(route.duration)}</div>`,
            iconSize: null
        }),
        interactive: false
    });
    routeLayer = L.layerGroup([casing, line, label]).addTo(map);
    map.flyToBounds(L.latLngBounds(route.coords), { ...placeFitPadding(), duration: 0.9, maxZoom: 16 });
}

// Lời khuyên sức khỏe theo phương tiện (dựa trên AQI tại điểm đến & cảnh báo DSS)
function routeHealthTip(mode) {
    const insight = currentPlace && currentPlace.insight;
    const aqi = insight && insight.current ? Number(insight.current.us_aqi) : NaN;
    // Cảnh báo dự báo chỉ tính khi hiện tại nằm TRONG khung giờ vượt QCVN (không áp cho cảnh báo của ngày mai)
    const alert = insight && insight.alert;
    const toDate = s => new Date(String(s).replace(" ", "T"));
    const now = new Date();
    const inWarning = !!(alert && alert.status === "WARNING" && alert.window_start && alert.window_end
        && toDate(alert.window_start) <= now && now <= new Date(toDate(alert.window_end).getTime() + 3600 * 1000));
    const bad = (!isNaN(aqi) && aqi > 100) || inWarning;
    const tips = bad ? {
        car: "Đóng kính và bật chế độ lấy gió trong xe khi đi qua đoạn đông xe.",
        moto: "Đeo khẩu trang N95/KN95: người đi xe máy hít trực tiếp khói xe ngay tại làn đường.",
        bike: "Đạp xe làm hít thở nhiều hơn: chọn đường ít xe, tránh giờ cao điểm hoặc cân nhắc phương tiện khác.",
        foot: "Đi bộ ngoài trời lâu khi ô nhiễm: đeo khẩu trang N95, ưu tiên đường nội khu thay vì trục chính.",
    } : {
        car: "Không khí khá tốt. Khi kẹt xe nên bật chế độ lấy gió trong xe.",
        moto: "Nên đeo khẩu trang chống bụi khi đi xe máy vào giờ cao điểm.",
        bike: "Ưu tiên tuyến nhiều cây xanh, ít xe tải và xe buýt.",
        foot: "Phù hợp đi bộ: chọn vỉa hè xa làn xe, nhiều bóng cây.",
    };
    return { text: tips[mode], bad };
}

function renderRouteBlock() {
    const el = document.getElementById("pp-route");
    if (!el || !currentPlace) return;
    if (currentPlace.kind === "me") {
        el.innerHTML = "";
        return;
    }
    if (!myLocation) {
        el.innerHTML = `
            <button type="button" class="btn btn-soft btn-block pp-locate" onclick="locateMeForRoute()">
                <i class="fa-solid fa-location-crosshairs"></i> Định vị để xem khoảng cách & đường đi
            </button>`;
        return;
    }

    const r = currentPlace.route || { loading: true, straight: haversineMeters(myLocation, currentPlace), modes: {} };
    const modes = r.modes || {};
    const tabs = Object.entries(TRAVEL_MODES).map(([key, m]) => `
        <button type="button" class="pp-mode ${key === travelMode ? "active" : ""}" style="--mode: ${m.color};"
            onclick="setTravelMode('${key}')" aria-pressed="${key === travelMode}" title="Chỉ đường ${m.label.toLowerCase()}">
            <i class="fa-solid ${m.icon}"></i>
            <span>${m.label}</span>
            <small>${modes[key] ? formatDuration(modes[key].duration) : "···"}</small>
        </button>`).join("");

    const m = TRAVEL_MODES[travelMode];
    const cur = modes[travelMode];
    let card;
    if (!cur) {
        card = `<div class="pp-route-card" style="--mode: ${m.color};"><span class="loader-dots"></span> Đang tìm đường ${m.label.toLowerCase()}...
                <small>Đường chim bay ${formatDistance(r.straight)}</small></div>`;
    } else {
        const notes = [];
        if (!cur.road) notes.push("chưa lấy được tuyến đường, ước tính theo đường chim bay");
        else if (travelMode === "moto" && cur.avoided) notes.push("đã tránh đường cao tốc (cấm xe máy)");
        if (cur.road && (travelMode === "car" || travelMode === "moto")) notes.push("chưa tính ùn tắc");
        card = `
            <div class="pp-route-card" style="--mode: ${m.color};">
                <span class="pp-route-icon"><i class="fa-solid ${m.icon}"></i></span>
                <div>
                    <b>${formatDistance(cur.distance)} <span>· ${formatDuration(cur.duration)}</span></b>
                    <small>${m.label} từ vị trí của bạn · chim bay ${formatDistance(r.straight)}${notes.length ? " · " + notes.join(" · ") : ""}</small>
                </div>
            </div>`;
    }
    const tip = routeHealthTip(travelMode);
    el.innerHTML = `
        <div class="pp-modes" role="group" aria-label="Chọn phương tiện">${tabs}</div>
        ${card}
        <div class="pp-route-tip ${tip.bad ? "warn" : ""}"><i class="fa-solid ${tip.bad ? "fa-mask-face" : "fa-leaf"}"></i> <span>${tip.text}</span></div>`;
}

function renderPlacePanel(data) {
    const panel = document.getElementById("panel-place");
    if (!panel || !currentPlace) return;
    panel.hidden = false;
    const place = currentPlace;
    const kindIcon = { me: "fa-street-view", ward: "fa-map", station: "fa-tower-broadcast", geo: "fa-location-dot", point: "fa-map-pin" }[place.kind] || "fa-location-dot";

    const head = `
        <div class="pp-head">
            <span class="icon-chip"><i class="fa-solid ${kindIcon}"></i></span>
            <div class="pp-title">
                <h3 id="pp-name">${escapeHtml(place.name)}</h3>
                <p id="pp-address">${escapeHtml(place.address || "")}</p>
            </div>
            <button type="button" class="btn-modal-close" onclick="closePlacePanel()" aria-label="Đóng">&times;</button>
        </div>
        <div id="pp-route" class="pp-route"></div>`;

    if (!data) {
        panel.innerHTML = head + `
            <div class="pp-loading">
                <div class="skeleton" style="height: 92px; border-radius: 16px;"></div>
                <div class="skeleton" style="height: 64px; border-radius: 14px;"></div>
                <div class="skeleton" style="height: 120px; border-radius: 14px;"></div>
                <p><span class="loader-dots"></span> Đang truy vấn PostGIS & AI Engine...</p>
            </div>`;
        renderRouteBlock();
        return;
    }
    if (data.error) {
        panel.innerHTML = head + `<div class="pop-note" style="margin-top: 12px;">Không thể phân tích chất lượng không khí tại đây (${escapeHtml(data.error)}).</div>`;
        renderRouteBlock();
        return;
    }

    const pm = data.current ? Number(data.current.pm2_5) : latestBasePM25;
    const pm10 = data.current && data.current.pm10 ? Number(data.current.pm10) : pm * 1.35;
    const aqi = getDynamicAQI(pm);
    const lvl = getAQILevelIndex(aqi);
    const adv = getAdvisoryForAQI(aqi, pm);
    const ringColor = (aqi > 50 && aqi <= 100) ? "#eab308" : adv.color;
    const fs = data.forecast_summary || {};
    const ward = data.ward;
    const st = data.nearest_station;
    const alert = data.alert || {};
    const isWarning = alert.status === "WARNING";
    const stdLabel = currentAQIStandard === "VN" ? "VN_AQI" : "US AQI";
    const nowHour = new Date().getHours();
    const placeTemp = getTemperatureAt(place.lat, place.lng, nowHour);
    const placeWind = getWindInfoAt(place.lat, place.lng, nowHour);

    const wardLine = ward
        ? `${escapeHtml(ward.loai_don_vi || "")} ${escapeHtml(ward.ten_phuong_xa)}${ward.inside ? "" : ` (gần nhất, ${formatDistance(ward.distance_m)})`}`
        : "Ngoài ranh giới 166 phường/xã TP.HCM";

    panel.innerHTML = head + `
        <div class="pp-aqi" style="--aqi: ${ringColor};">
            <div class="pp-ring"><b>${aqi}</b><small>${stdLabel}</small></div>
            <div class="pp-aqi-info">
                <span class="aqi-pill lvl-${lvl}">${escapeHtml(adv.level)}</span>
                <div class="pp-metrics">
                    <div><span>PM2.5</span><b>${pm.toFixed(1)} <small>µg/m³</small></b></div>
                    <div><span>PM10</span><b>${pm10.toFixed(1)} <small>µg/m³</small></b></div>
                    <div><span>NHIỆT ĐỘ</span><b class="pp-temp">${placeTemp.toFixed(1)} <small>°C</small></b></div>
                </div>
                <p class="pp-wind"><i class="fa-solid fa-wind"></i> Gió ${placeWind.speed.toFixed(1)} m/s (${(placeWind.speed * 3.6).toFixed(0)} km/h) · hướng ${placeWind.dir}</p>
                <p class="pp-qcvn ${pm > 50 ? "is-bad" : ""}"><i class="fa-solid fa-scale-balanced"></i> ${pm > 50 ? "Vượt" : "Đạt"} QCVN 05:2023 (50 µg/m³)</p>
            </div>
        </div>
        <div class="pp-meta">
            <span><i class="fa-solid fa-map"></i> ${wardLine}</span>
            ${st ? `<span><i class="fa-solid fa-tower-broadcast"></i> ${escapeHtml(st.ten_tram)} · ${formatDistance(st.distance_m)}</span>` : ""}
        </div>

        <div class="pp-section-title"><i class="fa-solid fa-notes-medical"></i> Hỗ trợ ra quyết định (DSS)</div>
        ${alert.status ? `
        <div class="pp-alert ${isWarning ? "is-warning" : "is-normal"}">
            <span class="pp-alert-icon"><i class="fa-solid ${isWarning ? "fa-triangle-exclamation" : "fa-shield-heart"}"></i></span>
            <div>
                <b>${isWarning ? "Cảnh báo: PM2.5 dự báo vượt QCVN 05:2023" : "Không khí 24h tới trong ngưỡng an toàn"}</b>
                <small>${fs.peak ? `Đỉnh tại đây ${fs.peak.pm2_5} µg/m³ lúc ${fs.peak.label}` : ""}${isWarning && fs.exceed_hours ? ` · ${fs.exceed_hours} giờ vượt 50 µg/m³` : ""}</small>
            </div>
        </div>` : ""}
        ${fs.best_window && fs.worst_window ? `
        <div class="pp-windows">
            <div class="pp-win good"><span><i class="fa-solid fa-sun"></i> Nên ra ngoài</span><b>${fs.best_window.label}</b><small>PM2.5 ≈ ${fs.best_window.avg_pm25} µg/m³</small></div>
            <div class="pp-win bad"><span><i class="fa-solid fa-mask-face"></i> Nên tránh</span><b>${fs.worst_window.label}</b><small>PM2.5 ≈ ${fs.worst_window.avg_pm25} µg/m³</small></div>
        </div>` : ""}
        <div class="pp-advice">
            <div class="pp-adv"><span class="pp-adv-icon blue"><i class="fa-solid fa-users"></i></span><div><b>Cộng đồng dân cư</b><p>${escapeHtml(adv.general_population)}</p></div></div>
            <div class="pp-adv"><span class="pp-adv-icon amber"><i class="fa-solid fa-person-breastfeeding"></i></span><div><b>Nhóm nhạy cảm</b><p>${escapeHtml(adv.sensitive_groups)}</p></div></div>
            <div class="pp-adv"><span class="pp-adv-icon rose"><i class="fa-solid fa-city"></i></span><div><b>Cơ quan quản lý đô thị</b><p>${escapeHtml(adv.action_plan)}</p></div></div>
        </div>
        <button type="button" class="btn btn-ai btn-block pp-ask-ai" onclick="askAirAIAboutPlace()">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Hỏi Trợ lý AI về địa điểm này
        </button>
        <button type="button" class="btn btn-gradient btn-block" onclick="switchTab('tab-dss'); history.pushState(null, null, '#dss');">
            <i class="fa-solid fa-notes-medical"></i> Xem đầy đủ khuyến nghị y tế
        </button>
    `;
    renderRouteBlock();
}

// ==============================================================================
// CẢNH BÁO TỰ ĐỘNG TỪ DSS ENGINE (ACTIVITY DIAGRAM)
// Dự báo AI -> Đối chiếu QCVN 05:2023 -> [>50] Warning_NhayCam / [<=50] Bình thường -> Xuất bản lên WebGIS
// ==============================================================================
let latestActiveAlert = null;

function fetchActiveAlert() {
    fetch(`${API_BASE}/alerts/active`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi cảnh báo: " + res.status);
            return res.json();
        })
        .then(alert => {
            latestActiveAlert = alert;
            renderAlertBanner(alert);
            renderDssAlertCard(alert);
        })
        .catch(err => console.warn("Chưa nạp được trạng thái cảnh báo DSS:", err.message));
}

function formatEvaluatedTime(str) {
    if (!str) return "--";
    const parts = String(str).split(" ");
    if (parts.length < 2) return str;
    const [y, m, d] = parts[0].split("-");
    return `${parts[1].slice(0, 5)} ${d}/${m}/${y}`;
}

function renderAlertBanner(alert) {
    const banner = document.getElementById("aqi-alert-banner");
    if (!banner || !alert || !alert.status || alert.status === "UNKNOWN") return;

    const isWarning = alert.status === "WARNING";
    banner.classList.toggle("is-warning", isWarning);
    banner.classList.toggle("is-normal", !isWarning);
    banner.hidden = false;

    // Màn hình vừa (laptop nhỏ, máy tính bảng): mặc định thu gọn để không che các khung điều khiển
    if (!banner.dataset.ready) {
        banner.dataset.ready = "1";
        if (window.innerWidth > 768 && window.innerWidth <= 1280) banner.classList.add("collapsed");
    }

    setSafeText("ab-title", isWarning ? "Cảnh báo sức khỏe: PM2.5 dự báo vượt QCVN 05:2023" : "Không khí 24 giờ tới trong ngưỡng an toàn");
    setSafeText("ab-message", isWarning
        ? `Đỉnh ${alert.peak_pm25} µg/m³ lúc ${alert.peak_label} · ${alert.exceed_hours} giờ vượt 50 µg/m³. Nhóm nhạy cảm hạn chế ra ngoài.`
        : `Đỉnh dự báo ${alert.peak_pm25} µg/m³ lúc ${alert.peak_label} · dưới ngưỡng 50 µg/m³.`);
    setSafeText("ab-short", isWarning ? "Cảnh báo PM2.5" : "An toàn 24h");

    const icon = document.getElementById("ab-icon");
    if (icon) icon.className = isWarning ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-shield-heart";
}

function renderDssAlertCard(alert) {
    const card = document.getElementById("dss-alert-card");
    if (!card || !alert || !alert.status || alert.status === "UNKNOWN") return;

    const isWarning = alert.status === "WARNING";
    card.classList.toggle("is-warning", isWarning);
    card.classList.toggle("is-normal", !isWarning);
    card.hidden = false;

    const best = alert.best_window ? alert.best_window.label : "--";
    const worst = alert.worst_window ? alert.worst_window.label : "--";
    card.innerHTML = `
        <div class="dac-head">
            <span class="dac-icon"><i class="fa-solid ${isWarning ? 'fa-triangle-exclamation' : 'fa-shield-heart'}"></i></span>
            <div class="dac-title">
                <span class="dac-eyebrow">${isWarning ? 'Trigger Warning_NhayCam đang kích hoạt' : 'Trạng thái không khí bình thường'} · ${alert.standard || 'QCVN 05:2023/BTNMT'}</span>
                <h3>${alert.title}</h3>
            </div>
            <span class="chip ${isWarning ? 'chip-danger' : 'chip-success'}"><span class="pulse-dot"></span> ${isWarning ? 'CẢNH BÁO' : 'AN TOÀN'}</span>
        </div>
        <p class="dac-message">${alert.message}</p>
        <div class="dac-stats">
            <div><span>Đỉnh PM2.5 dự báo</span><b>${alert.peak_pm25} µg/m³</b><small>${alert.peak_label || ''}</small></div>
            <div><span>Số giờ vượt 50 µg/m³</span><b>${alert.exceed_hours} giờ</b><small>trong 24 giờ tới</small></div>
            <div><span>Khung giờ nên ra ngoài</span><b>${best}</b><small>PM2.5 thấp nhất</small></div>
            <div><span>Khung giờ nên tránh</span><b>${worst}</b><small>PM2.5 cao nhất</small></div>
        </div>
        <div class="dac-foot"><i class="fa-solid fa-robot"></i> AI Engine đánh giá lúc ${formatEvaluatedTime(alert.evaluated_at)} · tự động làm mới 30 phút/lần</div>
    `;

    // Đồng bộ khung giờ khuyến nghị bên dưới theo dự báo thật
    if (alert.best_window) setSafeText("best-hours-text", `${alert.best_window.label} (PM2.5 trung bình ≈ ${alert.best_window.avg_pm25} µg/m³ - thời điểm không khí sạch nhất)`);
    if (alert.worst_window) setSafeText("worst-hours-text", `${alert.worst_window.label} (PM2.5 trung bình ≈ ${alert.worst_window.avg_pm25} µg/m³ - nên hạn chế ra đường)`);
}

window.toggleAlertBanner = function (evt) {
    const banner = document.getElementById("aqi-alert-banner");
    if (!banner) return;
    // Trên điện thoại: chạm vào thông báo -> mở tab Khuyến nghị Y tế
    if (window.innerWidth <= 768) {
        switchTab("tab-dss");
        history.pushState(null, null, "#dss");
        return;
    }
    if (evt && evt.target.closest(".ab-close")) {
        banner.classList.add("collapsed");
    } else if (banner.classList.contains("collapsed")) {
        banner.classList.remove("collapsed");
    }
};

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
            toast.innerText = `✅ Đăng ký nhận cảnh báo thành công cho email ${email}. Hệ thống sẽ tự động gửi thông báo khi AQI vượt mức ${threshold}!`;
            form.reset();
            setTimeout(() => { toast.style.display = "none"; }, 6000);
        }
    });
}

function updateSelectedWardPopup(hour) {
    if (!selectedWardLayer || !selectedWardFeature) return;

    const info = extractWardDetails(selectedWardFeature.properties);
    const stats = calculateWardAirStats(selectedWardFeature, hour);
    const center = selectedWardLayer.getBounds().getCenter();
    const temp = getTemperatureAt(center.lat, center.lng, hour);
    const wind = getWindInfoAt(center.lat, center.lng, hour);
    const lvl = getAQILevelIndex(stats.aqi);
    const ring = (stats.aqi > 50 && stats.aqi <= 100) ? "#eab308" : stats.color;
    const stdLabel = currentAQIStandard === 'VN' ? 'VN_AQI' : 'US AQI';
    const alert = latestActiveAlert;
    const hh = `${String(hour).padStart(2, "0")}:00`;

    const popupContent = `
        <div class="wp-card">
            <div class="wp-head">
                <div class="wp-ring" style="--aqi: ${ring};"><b>${stats.aqi}</b><small>${stdLabel}</small></div>
                <div class="wp-title">
                    <h4>${escapeHtml(info.ward)}</h4>
                    <p>${info.district ? escapeHtml(info.district) + " · " : ""}lúc ${hh}${hour === new Date().getHours() ? " · hiện tại" : " · mô phỏng"}</p>
                    <span class="aqi-pill lvl-${lvl}">${stats.advisory.level}</span>
                </div>
            </div>
            <div class="wp-metrics">
                <div><i class="fa-solid fa-smog"></i><span>PM2.5</span><b>${stats.pm25}<small> µg/m³</small></b></div>
                <div><i class="fa-solid fa-temperature-half"></i><span>Nhiệt độ</span><b>${temp.toFixed(1)}<small> °C</small></b></div>
                <div><i class="fa-solid fa-wind"></i><span>Gió</span><b>${wind.speed.toFixed(1)}<small> m/s</small></b><em>${wind.dir}</em></div>
            </div>
            <div class="wp-dss">
                <div class="wp-dss-title"><i class="fa-solid fa-notes-medical"></i> Hỗ trợ ra quyết định</div>
                <p><b>Cộng đồng:</b> ${escapeHtml(stats.advisory.general_population)}</p>
                <p><b>Nhóm nhạy cảm:</b> ${escapeHtml(stats.advisory.sensitive_groups)}</p>
                ${alert && alert.status === "WARNING" && alert.best_window ? `
                <p class="wp-window"><i class="fa-solid fa-sun"></i> Nên ra ngoài: <b>${alert.best_window.label}</b></p>` : ""}
            </div>
            <div class="wp-actions">
                <button type="button" class="wp-btn" onclick="openWardDetail()">
                    <i class="fa-solid fa-route"></i> Chi tiết & chỉ đường
                </button>
                <button type="button" class="wp-btn wp-btn-ai" onclick="askAirAIAboutWard()">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Hỏi AI
                </button>
            </div>
        </div>
    `;

    if (selectedWardLayer.getPopup()) {
        selectedWardLayer.setPopupContent(popupContent);
    } else {
        selectedWardLayer.bindPopup(popupContent, {
            className: 'ward-popup', maxWidth: 320, minWidth: 290,
            // Chừa chỗ cho thanh tìm kiếm + banner cảnh báo phía trên và các khung nổi hai bên
            autoPanPaddingTopLeft: L.point(window.innerWidth <= 768 ? 10 : 380, window.innerWidth <= 768 ? 130 : 200),
            autoPanPaddingBottomRight: L.point(window.innerWidth <= 768 ? 10 : 320, 40)
        });
    }
}

// Mở bảng chi tiết (AQI, đường đi, DSS đầy đủ) cho phường đang chọn
window.openWardDetail = function () {
    if (!selectedWardLayer || !selectedWardFeature) return;
    const info = extractWardDetails(selectedWardFeature.properties);
    // Điểm đã bấm trên phường (luôn nằm trong ranh giới); dự phòng: tâm khung bao
    const sel = window.airhcmSelection;
    const c = sel && sel.code === wardCodeOf(selectedWardFeature) ? sel : selectedWardLayer.getBounds().getCenter();
    map.closePopup();
    openPlacePanel({
        kind: "ward", code: wardCodeOf(selectedWardFeature), lat: c.lat, lng: c.lng, name: wardDisplayName(selectedWardFeature),
        address: info.district || "Ranh giới hành chính · TP. Hồ Chí Minh",
        bounds: selectedWardLayer.getBounds()
    });
};

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

// Mô phỏng hạt kiểu Windy: hạt trôi theo TRƯỜNG GIÓ 10m THỰC TẾ (lưới 7x7 Open-Meteo, theo giờ),
// nội suy song tuyến tại từng vị trí, màu theo tốc độ gió, đuôi mờ dần, gắn chặt tọa độ bản đồ.
let windField = null;          // Dữ liệu /weather/wind-field
let windGrid = null;           // Lưới vận tốc theo pixel màn hình (dựng lại khi bản đồ di chuyển / đổi giờ)
let windGridTimeIndex = -1;
let windMoving = false;
const WIND_CELL = 10;          // Kích thước ô lưới màn hình (px)
const WIND_MIN_VISUAL = 1.2;   // Tốc độ hiển thị tối thiểu (m/s) khi gió lặng
const WIND_SPEED_STEPS = [1, 2, 3, 4.5, 6, 8, 10, Infinity];   // ngưỡng màu theo m/s
const WIND_COLORS_LIGHT = ["rgba(30,64,175,0.45)", "rgba(3,105,161,0.52)", "rgba(14,116,144,0.58)", "rgba(15,118,110,0.62)", "rgba(77,124,15,0.66)", "rgba(161,98,7,0.7)", "rgba(194,65,12,0.72)", "rgba(190,18,60,0.74)"];
const WIND_COLORS_DARK = ["rgba(255,255,255,0.4)", "rgba(255,255,255,0.55)", "rgba(224,242,254,0.65)", "rgba(165,243,252,0.7)", "rgba(187,247,208,0.72)", "rgba(253,230,138,0.75)", "rgba(253,186,116,0.78)", "rgba(252,165,165,0.8)"];
let windSpawnRect = null;      // Vùng màn hình có dữ liệu gió (hạt chỉ sinh ra trong vùng này)

function initWindLayer() {
    if (!map) return;
    const mapContainer = map.getContainer();

    const oldCanvas = document.getElementById("leaflet-wind-canvas");
    if (oldCanvas) oldCanvas.remove();

    // Pane riêng z-index 450: trên ranh giới phường (400), DƯỚI trạm (600), tooltip (650) & popup (700)
    const windPane = map.getPane("windPane") || map.createPane("windPane");
    windPane.style.zIndex = "450";
    windPane.style.pointerEvents = "none";

    windCanvas = document.createElement("canvas");
    windCanvas.id = "leaflet-wind-canvas";
    Object.assign(windCanvas.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
    windPane.appendChild(windCanvas);
    windCtx = windCanvas.getContext("2d");

    const pause = () => {
        windMoving = true;
        if (windCtx) windCtx.clearRect(0, 0, windCanvas.width, windCanvas.height);
    };
    const resume = () => {
        windMoving = false;
        resizeWindCanvas();
        rebuildWindGrid(true);
    };
    map.on("movestart zoomstart", pause);
    map.on("moveend resize", resume);

    resizeWindCanvas();
    fetchWindField();
    setInterval(fetchWindField, 30 * 60 * 1000);
    startWindAnimation();
}

function resizeWindCanvas() {
    if (!windCanvas || !map) return;
    const c = map.getContainer();
    if (windCanvas.width !== c.clientWidth || windCanvas.height !== c.clientHeight) {
        windCanvas.width = c.clientWidth;
        windCanvas.height = c.clientHeight;
        windCanvas.style.width = `${c.clientWidth}px`;
        windCanvas.style.height = `${c.clientHeight}px`;
    }
    // Pane di chuyển theo bản đồ -> đặt canvas trùng góc trên-trái khung nhìn
    L.DomUtil.setPosition(windCanvas, map.containerPointToLayerPoint([0, 0]));
}

function fetchWindField() {
    fetch(`${API_BASE}/weather/wind-field`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi trường gió: " + res.status);
            return res.json();
        })
        .then(data => {
            if (Array.isArray(data.times) && Array.isArray(data.u) && data.u.length) {
                windField = data;
                rebuildWindGrid(true);
            }
        })
        .catch(err => {
            console.warn("Dòng chảy gió dùng hướng gió trạm trung tâm:", err.message);
            rebuildWindGrid(true);
        });
}

// Chỉ số mốc giờ trong dữ liệu ứng với giờ đang mô phỏng (trong 24h tới tính từ hiện tại)
function windTimeIndex(hour) {
    if (!windField) return -1;
    const now = new Date();
    const target = new Date(now);
    if (hour < now.getHours()) target.setDate(target.getDate() + 1);
    const pad = n => String(n).padStart(2, "0");
    const key = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(hour)}:00`;
    let idx = windField.times.indexOf(key);
    if (idx < 0) idx = windField.times.findIndex(t => t.endsWith(`T${pad(hour)}:00`));
    return idx;
}

// Nội suy song tuyến vận tốc gió (m/s) tại một tọa độ; ngoài lưới thì lấy giá trị biên gần nhất
function sampleWind(lat, lng, t) {
    return { u: sampleField("u", lat, lng, t), v: sampleField("v", lat, lng, t) };
}

// Nội suy song tuyến trên một lưới (ngoài lưới -> lấy giá trị biên gần nhất)
function sampleGrid(g, name, lat, lng, t) {
    const arr = g && g[name];
    if (!arr || !arr[t]) return NaN;
    const clamp = (x, max) => Math.max(0, Math.min(max, x));
    const fi = clamp((lat - g.lat0) / g.dlat, g.ny - 1);
    const fj = clamp((lng - g.lng0) / g.dlng, g.nx - 1);
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(i0 + 1, g.ny - 1), j1 = Math.min(j0 + 1, g.nx - 1);
    const di = fi - i0, dj = fj - j0;
    const a = arr[t][i0 * g.nx + j0], b = arr[t][i0 * g.nx + j1];
    const c = arr[t][i1 * g.nx + j0], d = arr[t][i1 * g.nx + j1];
    if (a == null || b == null || c == null || d == null) return NaN;
    return a * (1 - di) * (1 - dj) + b * (1 - di) * dj + c * di * (1 - dj) + d * di * dj;
}

function gridBounds(g) {
    return { s: g.lat0, n: g.lat0 + (g.ny - 1) * g.dlat, w: g.lng0, e: g.lng0 + (g.nx - 1) * g.dlng };
}

// Trộn 2 lưới: chi tiết TP.HCM (0.25°) ở lõi, khu vực Nam Bộ (1°) bên ngoài,
// pha trộn tuyến tính trong dải 0.3° sát biên lưới chi tiết để không có đường nối
const WIND_BLEND_DEG = 0.3;
function sampleField(name, lat, lng, t) {
    const fine = windField;
    const region = windField && windField.regional;
    const fb = gridBounds(fine);
    const inside = Math.min(lat - fb.s, fb.n - lat, lng - fb.w, fb.e - lng);
    if (!region || inside >= WIND_BLEND_DEG) {
        return sampleGrid(fine, name, lat, lng, t);
    }
    const rv = sampleGrid(region, name, lat, lng, t);
    if (inside <= 0) return rv;
    const fv = sampleGrid(fine, name, lat, lng, t);
    if (isNaN(fv)) return rv;
    if (isNaN(rv)) return fv;
    const w = inside / WIND_BLEND_DEG;
    return fv * w + rv * (1 - w);
}

// Vùng có dữ liệu gió: lưới khu vực (nếu có) hoặc lưới TP.HCM; ngoài vùng không vẽ hạt
function windDataBounds() {
    const f = windField;
    if (!f) return { s: 10.2, n: 11.7, w: 106.2, e: 107.7 };
    const g = gridBounds(f.regional || f);
    const pad = f.regional ? 0.5 : 0.15;
    return { s: g.s - pad, n: g.n + pad, w: g.w - pad, e: g.e + pad };
}

// Nhiệt độ 2m (°C) tại một điểm theo giờ mô phỏng: lưới Open-Meteo, dự phòng chu kỳ ERA5
function getTemperatureAt(lat, lng, hour = currentHourSimulated) {
    const t = windTimeIndex(hour);
    if (windField && windField.temp && t >= 0) {
        const v = sampleField("temp", lat, lng, t);
        if (!isNaN(v)) return v;
    }
    return HOURLY_TEMP_ERA5[hour] || 28.5;
}

// Gió tại một điểm: tốc độ (m/s) & hướng
function getWindInfoAt(lat, lng, hour = currentHourSimulated) {
    const t = windTimeIndex(hour);
    let u, v;
    if (t >= 0) {
        ({ u, v } = sampleWind(lat, lng, t));
    } else {
        const sp = (currentWindSpeed || 10) / 3.6, rad = (currentWindDeg || 150) * Math.PI / 180;
        u = -sp * Math.sin(rad);
        v = -sp * Math.cos(rad);
    }
    return { speed: Math.hypot(u, v), dir: windDirectionName(u, v) };
}

function windDirectionName(u, v) {
    // Hướng khí tượng (gió thổi TỪ hướng nào)
    const from = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
    const names = ["Bắc", "Đông Bắc", "Đông", "Đông Nam", "Nam", "Tây Nam", "Tây", "Tây Bắc"];
    return names[Math.round(from / 45) % 8];
}

function rebuildWindGrid(force = false) {
    if (!windCanvas || !map) return;
    const t = windTimeIndex(currentHourSimulated);
    if (!force && windGrid && t === windGridTimeIndex) return;
    windGridTimeIndex = t;

    // Dự phòng: gió đồng nhất theo trạm trung tâm (km/h -> m/s)
    const fbSpeed = (currentWindSpeed || 10) / 3.6;
    const fbRad = (currentWindDeg || 150) * Math.PI / 180;
    const fallback = { u: -fbSpeed * Math.sin(fbRad), v: -fbSpeed * Math.cos(fbRad) };

    const cols = Math.ceil(windCanvas.width / WIND_CELL) + 1;
    const rows = Math.ceil(windCanvas.height / WIND_CELL) + 1;
    const data = new Float32Array(cols * rows * 3);
    const bb = windDataBounds();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const ll = map.containerPointToLatLng([c * WIND_CELL, r * WIND_CELL]);
            const k0 = (r * cols + c) * 3;
            if (ll.lat < bb.s || ll.lat > bb.n || ll.lng < bb.w || ll.lng > bb.e) {
                data[k0] = NaN;
                continue;
            }
            const w = t >= 0 ? sampleWind(ll.lat, ll.lng, t) : fallback;
            const speed = Math.hypot(w.u, w.v);
            // Gió gần như lặng vẫn cho hạt trôi chậm theo hướng gió để thấy được dòng chảy
            // (màu vẫn phản ánh tốc độ thật)
            let du = w.u, dv = w.v;
            if (speed < WIND_MIN_VISUAL) {
                const ref = speed > 0.02 ? { u: w.u / speed, v: w.v / speed } : { u: fallback.u / (Math.hypot(fallback.u, fallback.v) || 1), v: fallback.v / (Math.hypot(fallback.u, fallback.v) || 1) };
                du = ref.u * WIND_MIN_VISUAL;
                dv = ref.v * WIND_MIN_VISUAL;
            }
            const k = (r * cols + c) * 3;
            data[k] = du;
            data[k + 1] = -dv;                // trục y màn hình hướng xuống
            data[k + 2] = speed;
        }
    }
    windGrid = { cols, rows, data };

    // Hạt chỉ sinh trong phần màn hình có dữ liệu; mật độ vừa phải cho dễ nhìn
    const p1 = map.latLngToContainerPoint([bb.n, bb.w]), p2 = map.latLngToContainerPoint([bb.s, bb.e]);
    windSpawnRect = {
        x0: Math.max(0, p1.x), y0: Math.max(0, p1.y),
        x1: Math.min(windCanvas.width, p2.x), y1: Math.min(windCanvas.height, p2.y)
    };
    const area = Math.max(0, windSpawnRect.x1 - windSpawnRect.x0) * Math.max(0, windSpawnRect.y1 - windSpawnRect.y0);
    const count = Math.min(2200, Math.round(area / 600));
    windParticles = Array.from({ length: count }, () => spawnWindParticle(true));
    if (windCtx) windCtx.clearRect(0, 0, windCanvas.width, windCanvas.height);

    // Cập nhật chú giải gió tại trung tâm TP.HCM
    const center = t >= 0 ? sampleWind(10.80, 106.70, t) : fallback;
    const speed = Math.hypot(center.u, center.v);
    setSafeText("wind-legend-text",
        `Gió 10m: ${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(0)} km/h) · hướng ${windDirectionName(center.u, center.v)}` +
        (windField ? (windField.source === "open-meteo" ? " · Open-Meteo" : " · mô phỏng") : " · trạm trung tâm"));
}

function spawnWindParticle(randomAge) {
    const maxAge = 40 + Math.floor(Math.random() * 60);
    return {
        x: windSpawnRect ? windSpawnRect.x0 + Math.random() * (windSpawnRect.x1 - windSpawnRect.x0) : Math.random() * 800,
        y: windSpawnRect ? windSpawnRect.y0 + Math.random() * (windSpawnRect.y1 - windSpawnRect.y0) : Math.random() * 600,
        age: randomAge ? Math.floor(Math.random() * maxAge) : 0,
        maxAge
    };
}

function windVelocityAt(x, y) {
    const g = windGrid;
    const c = Math.round(x / WIND_CELL), r = Math.round(y / WIND_CELL);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null;
    const k = (r * g.cols + c) * 3;
    if (isNaN(g.data[k])) return null;
    return [g.data[k], g.data[k + 1], g.data[k + 2]];
}

// Được gọi khi đổi giờ mô phỏng: dựng lại trường gió nếu mốc giờ thay đổi
function refreshWindForHour() {
    if (windCanvas && !windMoving) rebuildWindGrid(false);
}

function stopWindAnimation() {
    if (windAnimationId) cancelAnimationFrame(windAnimationId);
    windAnimationId = null;
    if (windCtx && windCanvas) windCtx.clearRect(0, 0, windCanvas.width, windCanvas.height);
}

function startWindAnimation() {
    if (windAnimationId) cancelAnimationFrame(windAnimationId);
    const chkWind = document.getElementById("chk-wind");
    if (chkWind && !chkWind.checked) return;
    if (!windGrid) rebuildWindGrid(true);

    const buckets = WIND_SPEED_STEPS.map(() => []);

    function renderFrame() {
        windAnimationId = requestAnimationFrame(renderFrame);
        if (!windCanvas || !windCtx || !windGrid || windMoving || document.hidden) return;
        const mapTab = document.getElementById("tab-map");
        if (mapTab && !mapTab.classList.contains("active")) return;

        const basemap = document.getElementById("select-basemap");
        const isLight = !basemap || basemap.value === "light" || basemap.value === "osm";
        const colors = isLight ? WIND_COLORS_LIGHT : WIND_COLORS_DARK;
        // Tốc độ hạt trên màn hình tăng nhẹ theo mức zoom
        const scale = 0.42 * Math.pow(1.15, map.getZoom() - 10);

        // Làm mờ đuôi vệt cũ (giữ lại 93% độ đậm mỗi khung hình -> vệt dài, mượt)
        windCtx.globalCompositeOperation = "destination-in";
        windCtx.fillStyle = "rgba(0, 0, 0, 0.92)";
        windCtx.fillRect(0, 0, windCanvas.width, windCanvas.height);
        windCtx.globalCompositeOperation = "source-over";

        buckets.forEach(b => { b.length = 0; });
        for (const p of windParticles) {
            const vel = p.age < p.maxAge ? windVelocityAt(p.x, p.y) : null;
            if (!vel) {
                Object.assign(p, spawnWindParticle(false));
                continue;
            }
            const nx = p.x + vel[0] * scale;
            const ny = p.y + vel[1] * scale;
            let b = 0;
            while (vel[2] > WIND_SPEED_STEPS[b]) b++;
            buckets[b].push(p.x, p.y, nx, ny);
            p.x = nx;
            p.y = ny;
            p.age++;
        }

        // Vẽ theo nhóm màu để tối ưu hiệu năng
        windCtx.lineWidth = isLight ? 1.1 : 1.0;
        windCtx.lineCap = "round";
        buckets.forEach((seg, i) => {
            if (!seg.length) return;
            windCtx.strokeStyle = colors[i];
            windCtx.beginPath();
            for (let k = 0; k < seg.length; k += 4) {
                windCtx.moveTo(seg[k], seg[k + 1]);
                windCtx.lineTo(seg[k + 2], seg[k + 3]);
            }
            windCtx.stroke();
        });
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
    let auth = null;
    try { auth = JSON.parse(localStorage.getItem("airhcm_admin_auth") || "null"); } catch (_) { auth = null; }
    // Chỉ vào thẳng trang Admin khi còn token máy chủ cấp & chưa hết hạn
    if (auth && auth.token && auth.expiresAt * 1000 > Date.now()) {
        window.location.href = "admin.html";
    } else {
        localStorage.removeItem("airhcm_admin_auth");
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

// Xác thực Quản trị viên trên MÁY CHỦ (mật khẩu băm PBKDF2) -> nhận token vai trò admin có hạn 12 giờ.
// Mọi API quản trị kiểm tra token này (RBAC), không còn kiểm tra mật khẩu bằng JavaScript phía trình duyệt.
window.submitAdminLogin = async function (e) {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errMsg = document.getElementById("login-error-msg");
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (errMsg) errMsg.style.display = "none";
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/auth/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Đăng nhập thất bại");

        localStorage.setItem("airhcm_admin_auth", JSON.stringify({
            username: data.username,
            fullname: data.fullname,
            role: data.role,
            token: data.token,
            expiresAt: data.expires_at
        }));
        closeLoginModal();
        window.location.href = "admin.html";
    } catch (err) {
        if (errMsg) {
            errMsg.style.display = "block";
            errMsg.innerText = `❌ ${err.message === "Failed to fetch" ? "Không kết nối được máy chủ AirHCM." : err.message}`;
        }
    } finally {
        if (submitBtn) submitBtn.disabled = false;
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

    // 6. Đồng bộ lại Bản đồ, Hotspots, thẻ DSS và What-If
    applyTimeStep(currentHourSimulated);
    fetchHotspotsSummary();
    updateDSSOverview(getDynamicAQI(latestBasePM25), latestBasePM25);
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
        <div class="panel news-featured">
            <div class="nf-media">
                <div class="nf-img" style="background-image: url('${featured.image}');"></div>
                <span class="nf-flag"><i class="fa-solid fa-bolt"></i> Tin tiêu điểm hôm nay</span>
            </div>
            <div class="nf-body">
                <div>
                    <div class="news-meta">
                        <span class="news-source"><i class="fa-solid fa-building-columns"></i> ${featured.source}</span>
                        <span>•</span>
                        <span><i class="fa-regular fa-clock"></i> ${featured.pub_date}</span>
                    </div>
                    <h3>${featured.title}</h3>
                    <p>${featured.summary}</p>
                </div>
                <div class="nf-foot">
                    <div class="tag-row">
                        <span class="news-tag">#PM2.5</span>
                        <span class="news-tag">#KhíTượng</span>
                        <span class="news-tag">#AirHCM</span>
                    </div>
                    <a href="${featured.link}" target="_blank" rel="noopener noreferrer" class="btn btn-gradient">
                        Đọc bài viết gốc <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                </div>
            </div>
        </div>
    `;

    // 2. Các bài báo còn lại (Hiển thị trong lưới 3 cột)
    const regularNews = newsList.slice(1);
    let cardsHtml = "";

    regularNews.forEach(item => {
        cardsHtml += `
            <div class="panel news-card" data-category="${item.category}">
                <div class="nc-media">
                    <div class="nc-img" style="background-image: url('${item.image}');"></div>
                    <span class="news-source-badge" style="background: ${item.badge_color};">${item.source}</span>
                </div>
                <div class="nc-body">
                    <small><i class="fa-regular fa-clock"></i> ${item.pub_date}</small>
                    <h4>${item.title}</h4>
                    <p>${item.summary}</p>
                    <div class="nc-foot">
                        <span class="news-tag">#${item.category}</span>
                        <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="link-arrow">
                            Xem chi tiết <i class="fa-solid fa-arrow-right"></i>
                        </a>
                    </div>
                </div>
            </div>
        `;
    });
    gridContainer.innerHTML = cardsHtml;
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
        // Nạp sẵn thư viện đăng nhập để cửa sổ Google/Facebook/Apple mở ngay khi bấm
        loadFirebaseAuth().catch(err => console.warn("Chưa tải được Firebase Auth:", err));
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
// ĐĂNG NHẬP GOOGLE / FACEBOOK / APPLE THẬT QUA FIREBASE AUTHENTICATION
// Cửa sổ đăng nhập do chính Google / Facebook / Apple cung cấp -> người dùng chọn tài khoản
// đang đăng nhập trên trình duyệt -> Firebase ID token -> Backend xác minh rồi tạo phiên AirHCM.
// ==============================================================================
const FIREBASE_WEB_CONFIG = {
    apiKey: "AIzaSyBGuEztWXMInz52uCdZcrKaujSgtgWGo2U",
    authDomain: "airhcm.firebaseapp.com",
    projectId: "airhcm",
    messagingSenderId: "903722662342",
    appId: "1:903722662342:web:3c931d833dd03934135ac7"
};
const FIREBASE_SDK_URL = "https://www.gstatic.com/firebasejs/10.12.2";
let firebaseAuthPromise = null;

// Nạp Firebase Auth một lần (gọi sẵn khi mở hộp đăng nhập để cửa sổ popup không bị trình duyệt chặn)
function loadFirebaseAuth() {
    if (!firebaseAuthPromise) {
        firebaseAuthPromise = Promise.all([
            import(`${FIREBASE_SDK_URL}/firebase-app.js`),
            import(`${FIREBASE_SDK_URL}/firebase-auth.js`)
        ]).then(([appSdk, authSdk]) => {
            const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(FIREBASE_WEB_CONFIG);
            const auth = authSdk.getAuth(app);
            auth.languageCode = "vi";
            return { auth, sdk: authSdk };
        }).catch(err => {
            firebaseAuthPromise = null; // Cho phép thử lại khi có mạng
            throw err;
        });
    }
    return firebaseAuthPromise;
}

function buildSocialProvider(sdk, provider) {
    if (provider === "Google") {
        const p = new sdk.GoogleAuthProvider();
        // Luôn hiện trình chọn tài khoản Google đang đăng nhập trên trình duyệt
        p.setCustomParameters({ prompt: "select_account" });
        return p;
    }
    if (provider === "Facebook") {
        const p = new sdk.FacebookAuthProvider();
        p.addScope("email");
        p.addScope("public_profile");
        p.setCustomParameters({ display: "popup" });
        return p;
    }
    const p = new sdk.OAuthProvider("apple.com");
    p.addScope("email");
    p.addScope("name");
    p.setCustomParameters({ locale: "vi_VN" });
    return p;
}

// Thông báo lỗi dễ hiểu; null = người dùng tự đóng cửa sổ, không cần báo
function describeSocialError(err, provider) {
    const code = err && err.code ? err.code : "";
    switch (code) {
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
        case "auth/user-cancelled":
            return null;
        case "auth/popup-blocked":
            return "Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên (popup) cho trang này rồi thử lại.";
        case "auth/configuration-not-found":
            return `Dự án Firebase "airhcm" chưa kích hoạt Authentication. Quản trị viên cần vào Firebase Console → Authentication → Get started, rồi bật ${provider} trong Sign-in method.`;
        case "auth/operation-not-allowed":
            return `Đăng nhập bằng ${provider} chưa được bật. Quản trị viên cần bật ${provider} trong Firebase Console → Authentication → Sign-in method.`;
        case "auth/unauthorized-domain":
            return `Tên miền "${location.hostname}" chưa được phép đăng nhập. Hãy mở trang bằng http://localhost hoặc thêm tên miền vào Firebase Console → Authentication → Settings → Authorized domains.`;
        case "auth/account-exists-with-different-credential":
            return "Email của tài khoản này đã được dùng để đăng nhập bằng phương thức khác. Hãy đăng nhập bằng phương thức bạn đã dùng trước đó.";
        case "auth/network-request-failed":
            return "Không kết nối được máy chủ xác thực. Vui lòng kiểm tra mạng và thử lại.";
        case "auth/invalid-credential":
        case "auth/invalid-oauth-client-id":
        case "auth/invalid-oauth-provider":
            return `Cấu hình đăng nhập ${provider} trên Firebase chưa đúng (App ID / Secret / Service ID).`;
        default:
            return err && err.message ? err.message : `Đăng nhập bằng ${provider} thất bại.`;
    }
}

function showUserAuthMsg(text, type = "error") {
    const msg = document.getElementById("user-auth-msg");
    if (!msg) return;
    if (!text) {
        msg.style.display = "none";
        return;
    }
    msg.style.display = "block";
    msg.style.background = type === "error" ? "#fee2e2" : "#e0f2fe";
    msg.style.color = type === "error" ? "#991b1b" : "#075985";
    msg.innerText = (type === "error" ? "❌ " : "⏳ ") + text;
}

window.handleSocialAuth = async function (provider) {
    const btn = document.querySelector(`.btn-social-${provider.toLowerCase()}`);
    const busyBtns = document.querySelectorAll(".btn-social");
    busyBtns.forEach(b => (b.disabled = true));
    if (btn) btn.classList.add("is-busy");
    showUserAuthMsg(null);

    let authCtx = null;
    try {
        authCtx = await loadFirebaseAuth();
        const { auth, sdk } = authCtx;
        const result = await sdk.signInWithPopup(auth, buildSocialProvider(sdk, provider));
        showUserAuthMsg(`Đang xác minh tài khoản ${provider}...`, "info");

        const idToken = await result.user.getIdToken();
        const res = await fetch(`${API_BASE}/auth/user/social`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_token: idToken, fullname: result.user.displayName || null })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Máy chủ AirHCM từ chối xác thực.");

        // Phiên AirHCM lưu trong máy; phiên Firebase không cần giữ lại
        localStorage.setItem("airhcm_user_session", JSON.stringify(data.user));
        sdk.signOut(auth).catch(() => { });
        showUserAuthMsg(null);
        closeUserAuthModal();
        renderUserHeaderState();
        alert(`🎉 ${data.message} Chào mừng ${data.user.fullname}!`);
    } catch (err) {
        if (authCtx) authCtx.sdk.signOut(authCtx.auth).catch(() => { });
        const text = err && err.code ? describeSocialError(err, provider)
            : (err && /import|module|fetch dynamically/i.test(err.message || "")
                ? "Không tải được thư viện đăng nhập. Vui lòng kiểm tra kết nối Internet."
                : (err && err.message) || `Đăng nhập bằng ${provider} thất bại.`);
        if (text) showUserAuthMsg(text);
        console.warn(`Đăng nhập ${provider}:`, err);
    } finally {
        busyBtns.forEach(b => (b.disabled = false));
        if (btn) btn.classList.remove("is-busy");
    }
};

// Cập nhật trạng thái hiển thị trên Header khi người dùng đăng nhập/đăng xuất
function renderUserHeaderState() {
    const slot = document.getElementById("user-auth-slot");
    if (!slot) return;

    let userSession = null;
    try {
        userSession = JSON.parse(localStorage.getItem("airhcm_user_session"));
    } catch (_) {
        localStorage.removeItem("airhcm_user_session");
    }
    if (userSession) {
        // Họ tên / ảnh đến từ tài khoản Google, Facebook, Apple thật -> luôn escape khi chèn HTML
        const name = escapeHtml(userSession.fullname || "Thành viên");
        slot.innerHTML = `
            <div class="user-chip" title="${escapeHtml(userSession.email || userSession.fullname || "")}">
                ${avatarImg(userSession)}
                <span class="user-name btn-label">${name}</span>
                <button class="user-logout" onclick="handleUserLogout()" title="Đăng xuất">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i>
                </button>
            </div>
        `;
        // Ảnh đại diện lỗi (hết hạn / bị chặn) -> dùng ảnh chữ cái đầu
        const img = slot.querySelector(".user-chip img");
        if (img) img.addEventListener("error", () => { img.src = fallbackAvatar; }, { once: true });
    } else {
        slot.innerHTML = `
            <button onclick="openUserAuthModal('login')" class="btn btn-gradient" title="Đăng nhập / Đăng ký">
                <i class="fa-solid fa-user"></i> <span class="btn-label">Đăng nhập / Đăng ký</span>
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
                        ${avatarImg(u, 'style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover;"')}
                        <span style="font-weight: 700; color: #0f172a;">${escapeHtml(u.fullname)}</span>
                    </div>
                </td>
                <td><a href="mailto:${escapeHtml(u.email)}" style="color: #0284c7; text-decoration: none;">${escapeHtml(u.email)}</a></td>
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