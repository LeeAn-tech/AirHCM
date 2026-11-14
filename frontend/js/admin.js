// ==============================================================================
// AIRHCM - JAVASCRIPT QUẢN TRỊ ADMIN DASHBOARD
// Khoa CNTT - Trường Đại học Tài nguyên & Môi trường TP.HCM (HCMUNRE)
// SVTH: LÊ HOÀNG ÂN - 1250080001 | GVHD: TS. Dương Thị Thúy Nga
// ==============================================================================

// Backend phục vụ luôn WebGIS (cùng nguồn) -> dùng chính địa chỉ đang mở (LAN, tên miền, HTTPS);
// chỉ khi mở bằng server tĩnh cổng 3000 / file:// mới gọi Backend ở cổng 8000
const API_BASE = (location.port === "3000" || location.protocol === "file:")
    ? `http://${window.location.hostname || "127.0.0.1"}:8000/api/v1`
    : `${location.origin}/api/v1`;

// Họ tên / email do người dùng tự nhập hoặc lấy từ tài khoản Google, Facebook -> luôn escape khi chèn HTML
function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

// ------------------------------------------------------------------------------
// PHIÊN QUẢN TRỊ (RBAC): token vai trò admin do máy chủ cấp khi đăng nhập
// ------------------------------------------------------------------------------
function getAdminSession() {
    try {
        const auth = JSON.parse(localStorage.getItem("airhcm_admin_auth") || "null");
        if (auth && auth.token && auth.expiresAt * 1000 > Date.now()) return auth;
    } catch (e) { /* phiên lỗi định dạng */ }
    return null;
}

let adminSessionEnded = false;
function endAdminSession(message) {
    if (adminSessionEnded) return;   // Nhiều API cùng bị từ chối -> chỉ báo một lần
    adminSessionEnded = true;
    localStorage.removeItem("airhcm_admin_auth");
    if (message) alert(message);
    window.location.href = "index.html";
}

// Mọi lời gọi tới API AirHCM từ trang quản trị tự đính kèm token; máy chủ từ chối (401/403) -> đăng nhập lại
const nativeFetch = window.fetch.bind(window);
window.fetch = function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith(API_BASE)) return nativeFetch(input, init);
    const session = getAdminSession();
    const headers = new Headers(init.headers || {});
    if (session) headers.set("Authorization", `Bearer ${session.token}`);
    return nativeFetch(input, { ...init, headers }).then(res => {
        if (res.status === 401 || res.status === 403) {
            endAdminSession("🔒 Phiên quản trị đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.");
        }
        return res;
    });
};

let adminMap = null;
let currentBaseTile = null;
let adminStationMarkers = [];
let adminStationList = [];
let subscribersList = [];
let adminWardsLayer = null;
let currentBufferCircle = null;
let isPickCoordActive = false;
let tempPickMarker = null;
let bufferLayerGroup = null;

document.addEventListener("DOMContentLoaded", () => {
    renderAdminIdentity();
    initAdminTabs();
    initAdminMap();
    loadAdminWards();
    fetchAdminMetrics();
    fetchAdminStations();
    fetchAdminHotspots();
    fetchSubscribers();
    initETLEvent();
    populateAdminWardDropdown();
    fetchAlertEngineStatus();
    fetchAlertHistory();
    setInterval(() => { fetchAlertEngineStatus(); fetchAlertHistory(); }, 5 * 60 * 1000);
});

// ==============================================================================
// ĐỘNG CƠ CẢNH BÁO TỰ ĐỘNG (ACTIVITY DIAGRAM) & NHẬT KÝ VẬN HÀNH THỰC TẾ
// ==============================================================================
function formatAdminTime(str) {
    if (!str) return "--";
    const [datePart, timePart] = String(str).split(" ");
    if (!timePart) return str;
    const [y, m, d] = datePart.split("-");
    return `${timePart.slice(0, 5)} ${d}/${m}/${y}`;
}

function renderAlertEngine(alert) {
    const box = document.getElementById("adm-alert-engine");
    if (!box || !alert) return;
    const isWarning = alert.status === "WARNING";
    const isKnown = alert.status === "WARNING" || alert.status === "NORMAL";

    box.classList.toggle("is-warning", isWarning);
    box.classList.toggle("is-normal", alert.status === "NORMAL");
    box.innerHTML = `
        <span class="chip ${isWarning ? 'chip-danger' : (isKnown ? 'chip-success' : 'chip-neutral')}">
            <i class="fa-solid ${isWarning ? 'fa-triangle-exclamation' : 'fa-shield-heart'}"></i>
            ${isWarning ? 'WARNING' : (isKnown ? 'NORMAL' : 'CHƯA RÕ')}
        </span>
        <div><b>${alert.title || 'Chưa có dữ liệu dự báo'}</b><small>${alert.level ? 'Mức đỉnh: ' + alert.level : (alert.message || '')}</small></div>
    `;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText("adm-alert-peak", alert.peak_pm25 != null ? `${alert.peak_pm25} µg/m³ · ${alert.peak_label || ''}` : "--");
    setText("adm-alert-exceed", alert.exceed_hours != null ? `${alert.exceed_hours} giờ` : "--");
    setText("adm-alert-time", formatAdminTime(alert.evaluated_at));
    if (alert.push) {
        setText("adm-alert-push", alert.push.fcm_enabled
            ? `${alert.push.sent}/${alert.push.eligible} thiết bị`
            : "FCM đang tắt");
    } else {
        setText("adm-alert-push", isWarning ? "Đang trong thời gian nghỉ" : "Không cần gửi");
    }
}

function fetchAlertEngineStatus() {
    fetch(`${API_BASE}/alerts/active`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi: " + res.status);
            return res.json();
        })
        .then(renderAlertEngine)
        .catch(err => renderAlertEngine({ status: "UNKNOWN", title: "Không kết nối được DSS Engine", message: err.message }));
}

window.evaluateAlertNow = function () {
    const btn = document.getElementById("btn-evaluate-alert");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI Engine đang dự báo & đối chiếu QCVN...';
    }
    fetch(`${API_BASE}/admin/alerts/evaluate`, { method: "POST" })
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi: " + res.status);
            return res.json();
        })
        .then(alert => {
            renderAlertEngine(alert);
            fetchAlertHistory();
            showAdminToast(alert.status === "WARNING"
                ? `⚠️ Kích hoạt Warning_NhayCam: PM2.5 dự báo đạt ${alert.peak_pm25} µg/m³`
                : `✅ Không khí 24h tới trong ngưỡng QCVN (đỉnh ${alert.peak_pm25} µg/m³)`);
        })
        .catch(err => alert("Lỗi đánh giá cảnh báo: " + err.message))
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Chạy đánh giá cảnh báo ngay';
            }
        });
};

function fetchAlertHistory() {
    fetch(`${API_BASE}/alerts/history?limit=8`)
        .then(res => {
            if (!res.ok) throw new Error("Mã phản hồi: " + res.status);
            return res.json();
        })
        .then(history => {
            const list = document.getElementById("admin-audit-log-list");
            if (!list || !Array.isArray(history) || history.length === 0) return;

            const triggerLabel = { scheduler: "Lịch tự động", admin: "Quản trị viên", "on-demand": "Theo yêu cầu" };
            list.innerHTML = history.map(h => {
                const isWarning = h.status === "WARNING";
                return `
                    <div class="tl-item" style="--c: ${isWarning ? '#dc2626' : '#16a34a'};">
                        <p><b>DSS ${isWarning ? 'Warning_NhayCam' : 'Bình thường'}:</b> đỉnh PM2.5 ${h.peak_pm25} µg/m³${isWarning ? `, ${h.exceed_hours} giờ vượt QCVN` : ''}${h.push_sent ? ` · Push ${h.push_sent} thiết bị` : ''}</p>
                        <small>${formatAdminTime(h.time)} · ${triggerLabel[h.trigger] || h.trigger}</small>
                    </div>
                `;
            }).join("");
        })
        .catch(() => { /* Giữ nhật ký mẫu khi chưa có lịch sử */ });
}

// KIỂM TRA PHÂN QUYỀN TRUY CẬP (BẢO VỆ CỔNG ADMIN)
// (Giao diện chỉ là lớp ngoài: máy chủ mới là nơi kiểm tra quyền thật sự qua token)
(function enforceAdminAuth() {
    if (!getAdminSession()) {
        endAdminSession("🔒 TRUY CẬP BỊ TỪ CHỐI: Bạn cần đăng nhập tài khoản Quản trị viên để truy cập Trung tâm Điều hành DSS!");
    }
})();
// HIỂN THỊ TÊN TÀI KHOẢN QUẢN TRỊ ĐANG ĐĂNG NHẬP TRÊN THANH TIÊU ĐỀ
function renderAdminIdentity() {
    let username = "admin";
    const auth = getAdminSession();
    if (auth) username = auth.fullname || auth.username;

    const nameEl = document.getElementById("adm-username");
    const avatarEl = document.getElementById("adm-avatar");
    if (nameEl) nameEl.textContent = username;
    if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();
}

// Cấp độ 1-6 theo thang AQI (dùng cho class màu t-* trong CSS)
function getAdminAQILevel(aqi) {
    if (aqi <= 50) return 1;
    if (aqi <= 100) return 2;
    if (aqi <= 150) return 3;
    if (aqi <= 200) return 4;
    if (aqi <= 300) return 5;
    return 6;
}

// TỰ ĐỘNG NẠP VÀ HIỂN THỊ RANH GIỚI 166 PHƯỜNG/XÃ LÊN BẢN ĐỒ ADMIN
function loadAdminWards() {
    fetch('assets/data/hcm_wards.json')
        .then(res => {
            if (!res.ok) throw new Error("Không thể tải file ranh giới");
            return res.json();
        })
        .then(geojson => {
            if (adminWardsLayer && adminMap) adminMap.removeLayer(adminWardsLayer);

            adminWardsLayer = L.geoJSON(geojson, {
                style: {
                    color: "#00e5ff",          // Xanh dạ quang nổi bật trên cả nền vệ tinh lẫn nền tối/sáng
                    weight: 1.5,               // Độ dày viền rõ nét
                    opacity: 0.85,
                    fillColor: "#0284c7",
                    fillOpacity: 0.08          // Độ mờ nhẹ để vẫn thấy địa hình bên dưới
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties || {};
                    const wardName = p.ten_phuong_xa || p.NAME_3 || p.name || "Phường/Xã";
                    const distName = p.ten_quan_huyen || p.NAME_2 || "";
                    layer.bindTooltip(`<b>${wardName}</b>${distName ? ` - ${distName}` : ''}`, {
                        sticky: true,
                        direction: 'top'
                    });
                }
            });

            if (adminMap) {
                adminWardsLayer.addTo(adminMap);
                adminWardsLayer.bringToBack(); // Đưa ranh giới nằm dưới các trạm quan trắc
            }
        })
        .catch(err => console.error("Lỗi nạp ranh giới admin:", err));
}

// 1. XỬ LÝ CHUYỂN TABS TRANG ADMIN VÀ TỰ ĐỘNG LÀM MỚI DỮ LIỆU
// 1. XỬ LÝ CHUYỂN TABS TRANG ADMIN VÀ TỰ ĐỘNG LÀM MỚI DỮ LIỆU
function initAdminTabs() {
    document.querySelectorAll(".adm-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".adm-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".adm-tab-content").forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            const targetId = btn.getAttribute("data-adm-tab");
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add("active");

            // Căn chỉnh kích thước bản đồ khi về Tab Bản đồ
            if (targetId === "adm-tab-map" && adminMap) {
                setTimeout(() => adminMap.invalidateSize(), 200);
            }

            // Tải lại danh sách cảnh báo khi mở Tab 3
            if (targetId === "adm-tab-subscriptions") {
                fetchSubscribers();
            }

            // TỰ ĐỘNG TẢI DANH SÁCH TÀI KHOẢN KHI MỞ TAB 4
            if (targetId === "adm-tab-users") {
                fetchAdminUsers();
            }
        });
    });
}
// 2. KHỞI TẠO BẢN ĐỒ ADMIN VÀ CẤU HÌNH BASEMAP
function initAdminMap() {
    const mapDiv = document.getElementById("admin-map");
    if (!mapDiv) return;

    adminMap = L.map("admin-map", {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView([10.8231, 106.6297], 11);

    const tiles = {
        dark: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }),
        osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }),
        satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 })
    };

    currentBaseTile = tiles.satellite;
    currentBaseTile.addTo(adminMap);

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(adminMap);

    setTimeout(() => adminMap.invalidateSize(), 300);

    adminMap.on("mousemove", e => {
        const coordsBadge = document.getElementById("adm-coords");
        if (coordsBadge) {
            coordsBadge.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Tọa độ: <b>${e.latlng.lat.toFixed(4)}° N</b>, <b>${e.latlng.lng.toFixed(4)}° E</b> | Zoom: <b>${adminMap.getZoom()}</b>`;
        }
    });
    // Lắng nghe sự kiện click trên bản đồ khi bật chế độ bắt tọa độ
    adminMap.on("click", e => {
        if (!isPickCoordActive) return;

        const lat = parseFloat(e.latlng.lat.toFixed(6));
        const lng = parseFloat(e.latlng.lng.toFixed(6));

        // Đánh dấu marker tạm thời màu đỏ tại vị trí vừa click
        if (tempPickMarker) adminMap.removeLayer(tempPickMarker);
        tempPickMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'custom-pin',
                html: '<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 10px #ef4444;"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(adminMap);

        // Mở Modal thêm trạm và điền sẵn tọa độ bắt được
        window.openAddStationModal();
        const latInput = document.getElementById("new-st-lat");
        const lngInput = document.getElementById("new-st-lng");
        if (latInput) latInput.value = lat;
        if (lngInput) lngInput.value = lng;

        showAdminToast(`🎯 Đã chọn tọa độ: ${lat}, ${lng}`);
    });

    const selectBasemap = document.getElementById("adm-select-basemap");
    if (selectBasemap) {
        selectBasemap.addEventListener("change", e => {
            const val = e.target.value;
            if (currentBaseTile) adminMap.removeLayer(currentBaseTile);
            if (tiles[val]) {
                currentBaseTile = tiles[val];
                currentBaseTile.addTo(adminMap);

                // Giữ ranh giới phường luôn hiển thị phía trên bản đồ nền
                if (adminWardsLayer && adminMap.hasLayer(adminWardsLayer)) {
                    adminWardsLayer.bringToBack();
                }
            }
        });
    }

    const btnReset = document.getElementById("btn-adm-reset");
    if (btnReset) {
        btnReset.addEventListener("click", () => {
            adminMap.flyTo([10.8231, 106.6297], 11, { duration: 1.2 });
        });
    }
}

function fetchAdminMetrics() {
    fetch(`${API_BASE}/aqi/current`)
        .then(res => res.json())
        .then(data => {
            const pm25 = parseFloat(data.pm2_5) || 29.4;
            const usAqi = parseInt(data.us_aqi) || 106;

            // Tính toán nhanh VN_AQI theo QĐ 1459/QĐ-TCMT
            let vnAqi = 50;
            if (pm25 <= 25.0) vnAqi = Math.round((50.0 / 25.0) * pm25);
            else if (pm25 <= 50.0) vnAqi = Math.round(((100.0 - 51.0) / (50.0 - 25.1)) * (pm25 - 25.1) + 51.0);
            else if (pm25 <= 80.0) vnAqi = Math.round(((150.0 - 101.0) / (80.0 - 50.1)) * (pm25 - 50.1) + 101.0);
            else vnAqi = Math.round(((200.0 - 151.0) / (150.0 - 80.1)) * (pm25 - 80.1) + 151.0);

            document.getElementById("adm-pm25").innerText = `${pm25.toFixed(1)} µg/m³`;
            document.getElementById("adm-aqi").innerText = `VN: ${vnAqi} | US: ${usAqi}`;
            const levelEl = document.getElementById("adm-aqi-level");
            if (levelEl) levelEl.innerText = data.advisory ? data.advisory.level : "Kém (Nhóm nhạy cảm lưu ý)";
        })
        .catch(() => {
            document.getElementById("adm-pm25").innerText = "29.4 µg/m³";
            document.getElementById("adm-aqi").innerText = "VN: 59 | US: 106";
        });
}

// 3. QUẢN LÝ TRẠM POSTGIS
function fetchAdminStations() {
    fetch(`${API_BASE}/gis/stations`)
        .then(res => res.json())
        .then(stations => {
            adminStationList = stations;
            renderStationTableAndMap(stations);
        })
        .catch(err => {
            const mockStations = [
                { ma_tram: "HCM_OM_01", ten_tram: "Trạm quan trắc trung tâm TP.HCM", don_vi_quan_ly: "Open-Meteo & GEE", lat: 10.8231, lng: 106.6297, status: "HOẠT ĐỘNG" },
                { ma_tram: "HCM_GV_01", ten_tram: "Trạm Quan trắc Gò Vấp - Q.12", don_vi_quan_ly: "Trung tâm QTMT Nam Bộ", lat: 10.8350, lng: 106.6650, status: "HOẠT ĐỘNG" },
                { ma_tram: "HCM_Q1_02", ten_tram: "Trạm Quan trắc Bến Thành - Q.1", don_vi_quan_ly: "Chi cục BVMT TP.HCM", lat: 10.7769, lng: 106.7009, status: "HOẠT ĐỘNG" },
                { ma_tram: "HCM_TD_04", ten_tram: "Trạm Khu đô thị TP. Thủ Đức", don_vi_quan_ly: "Trung tâm QTMT Nam Bộ", lat: 10.8494, lng: 106.7583, status: "HOẠT ĐỘNG" },
                { ma_tram: "HCM_BT_05", ten_tram: "Trạm Cửa ngõ KCN Bình Tân", don_vi_quan_ly: "Sở TN&MT TP.HCM", lat: 10.7483, lng: 106.6022, status: "HOẠT ĐỘNG" }
            ];
            adminStationList = mockStations;
            renderStationTableAndMap(mockStations);
        });
}

function renderStationTableAndMap(stations) {
    document.getElementById("adm-total-stations").innerText = `${stations.length} Trạm`;

    const tbody = document.getElementById("adm-station-table");
    if (tbody) tbody.innerHTML = "";

    adminStationMarkers.forEach(m => adminMap.removeLayer(m));
    adminStationMarkers = [];

    stations.forEach(st => {
        const lat = parseFloat(st.lat);
        const lng = parseFloat(st.lng);

        // Trạng thái trạm cho phép click trực tiếp để chuyển đổi HOẠT ĐỘNG <-> BẢO TRÌ
        const isMaintenance = (st.status === 'BẢO TRÌ');
        const statusBadge = isMaintenance
            ? `<span class="chip chip-warning clickable" onclick="toggleStationStatus('${st.ma_tram}', '${st.status}')"
                     title="Bấm để chuyển sang HOẠT ĐỘNG"><i class="fa-solid fa-wrench"></i> BẢO TRÌ</span>`
            : `<span class="chip chip-success clickable" onclick="toggleStationStatus('${st.ma_tram}', '${st.status}')"
                     title="Bấm để chuyển sang BẢO TRÌ"><i class="fa-solid fa-circle-check"></i> HOẠT ĐỘNG</span>`;

        if (tbody) {
            const row = `
                <tr>
                    <td><span class="chip chip-neutral">${st.ma_tram}</span></td>
                    <td class="cell-strong">${st.ten_tram}</td>
                    <td>${st.don_vi_quan_ly}</td>
                    <td class="cell-muted nowrap">${lat.toFixed(4)}, ${lng.toFixed(4)}</td>
                    <td class="center nowrap">${statusBadge}</td>
                    <td class="center nowrap">
                        <div class="act-group">
                            <button onclick="zoomToStation(${lat}, ${lng})" class="btn-act act-view" title="Xem vị trí">
                                <i class="fa-solid fa-eye"></i> Xem
                            </button>
                            <button onclick="openEditStationModal('${st.ma_tram}')" class="btn-act act-edit" title="Chỉnh sửa trạm">
                                <i class="fa-solid fa-pen-to-square"></i> Sửa
                            </button>
                            <button onclick="deleteStation('${st.ma_tram}')" class="btn-act act-del" title="Xóa trạm">
                                <i class="fa-solid fa-trash"></i> Xóa
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        }

        if (adminMap) {
            const radarIcon = L.divIcon({
                className: 'custom-station-icon',
                html: `
                    <div class="station-radar-marker" title="${st.ten_tram}">
                        <div class="station-radar-wave"></div>
                        <div class="station-radar-core"></div>
                    </div>
                `,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const marker = L.marker([lat, lng], { icon: radarIcon }).addTo(adminMap);
            const stStatus = st.status || 'HOẠT ĐỘNG';
            marker.bindPopup(`
                <div class="pop-card">
                    <h4 class="pop-title"><i class="fa-solid fa-tower-broadcast"></i> ${st.ten_tram}</h4>
                    <div class="pop-sub">Mã trạm: ${st.ma_tram}</div>
                    <div class="pop-meta">
                        <span><b>Đơn vị:</b> ${st.don_vi_quan_ly}</span>
                        <span><b>Tọa độ:</b> ${lat.toFixed(4)}N, ${lng.toFixed(4)}E</span>
                    </div>
                    <span class="chip ${stStatus === 'BẢO TRÌ' ? 'chip-warning' : 'chip-success'}">${stStatus}</span>
                </div>
            `);
            adminStationMarkers.push(marker);
        }
    });
}
window.zoomToStation = function (lat, lng) {
    document.querySelector('[data-adm-tab="adm-tab-map"]').click();
    setTimeout(() => {
        if (adminMap) adminMap.flyTo([lat, lng], 14, { duration: 1.0 });
    }, 200);
};

// MODAL THÊM TRẠM
window.openAddStationModal = () => document.getElementById("modal-add-station").classList.add("active");
window.closeAddStationModal = () => document.getElementById("modal-add-station").classList.remove("active");

window.submitNewStation = function (e) {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ PostGIS...';
    btnSubmit.disabled = true;

    const newSt = {
        ma_tram: document.getElementById("new-st-id").value.trim(),
        ten_tram: document.getElementById("new-st-name").value.trim(),
        don_vi_quan_ly: document.getElementById("new-st-owner").value.trim(),
        lat: parseFloat(document.getElementById("new-st-lat").value),
        lng: parseFloat(document.getElementById("new-st-lng").value),
        status: document.getElementById("new-st-status").value
    };

    fetch(`${API_BASE}/gis/stations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSt)
    })
        .then(res => {
            if (!res.ok) throw new Error("Không thể kết nối đến máy chủ PostGIS");
            return res.json();
        })
        .then(data => {
            // Tải lại trực tiếp danh sách từ Backend để đảm bảo đồng bộ 100%
            fetchAdminStations();
            closeAddStationModal();
            document.getElementById("form-add-station").reset();
            showAdminToast(`✅ Đã thêm trạm "${newSt.ten_tram}" và đồng bộ PostGIS thành công!`);
        })
        .catch(err => {
            alert("Lỗi khi thêm trạm: " + err.message);
        })
        .finally(() => {
            btnSubmit.innerHTML = originalText;
            btnSubmit.disabled = false;
        });
};
// ==============================================================================
// XỬ LÝ CHỈNH SỬA VÀ XÓA TRẠM QUAN TRẮC POSTGIS
// ==============================================================================

// Mở Modal Chỉnh sửa và nạp thông tin trạm hiện tại vào Form
window.openEditStationModal = function (ma_tram) {
    const st = adminStationList.find(s => s.ma_tram === ma_tram);
    if (!st) {
        alert("Không tìm thấy thông tin trạm!");
        return;
    }

    document.getElementById("edit-st-id").value = st.ma_tram;
    document.getElementById("edit-st-name").value = st.ten_tram;
    document.getElementById("edit-st-owner").value = st.don_vi_quan_ly;
    document.getElementById("edit-st-lat").value = st.lat;
    document.getElementById("edit-st-lng").value = st.lng;
    document.getElementById("edit-st-status").value = st.status || "HOẠT ĐỘNG";

    document.getElementById("modal-edit-station").classList.add("active");
};

// Đóng Modal Chỉnh sửa
window.closeEditStationModal = function () {
    document.getElementById("modal-edit-station").classList.remove("active");
};

// Gửi dữ liệu cập nhật trạm lên Backend
window.submitEditStation = function (e) {
    e.preventDefault();
    const ma_tram = document.getElementById("edit-st-id").value.trim();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;

    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
    btnSubmit.disabled = true;

    const selectedStatus = document.getElementById("edit-st-status").value;

    const payload = {
        ten_tram: document.getElementById("edit-st-name").value.trim(),
        don_vi_quan_ly: document.getElementById("edit-st-owner").value.trim(),
        lat: parseFloat(document.getElementById("edit-st-lat").value),
        lng: parseFloat(document.getElementById("edit-st-lng").value),
        status: selectedStatus
    };

    fetch(`${API_BASE}/gis/stations/${encodeURIComponent(ma_tram)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(res => {
            if (!res.ok) throw new Error("Cập nhật trạm thất bại");
            return res.json();
        })
        .then(data => {
            // Cập nhật ngay trong mảng cục bộ trên giao diện
            const target = adminStationList.find(s => s.ma_tram === ma_tram);
            if (target) {
                target.ten_tram = payload.ten_tram;
                target.don_vi_quan_ly = payload.don_vi_quan_ly;
                target.lat = payload.lat;
                target.lng = payload.lng;
                target.status = selectedStatus;
            }
            renderStationTableAndMap(adminStationList);
            closeEditStationModal();
            showAdminToast(`✅ Đã cập nhật trạm "${ma_tram}" sang trạng thái: ${selectedStatus}!`);
            // Đồng bộ lại với Backend
            fetchAdminStations();
        })
        .catch(err => {
            alert("Lỗi: " + err.message);
        })
        .finally(() => {
            btnSubmit.innerHTML = oldText;
            btnSubmit.disabled = false;
        });
};

// Xử lý Xóa trạm quan trắc
window.deleteStation = function (ma_tram) {
    if (!confirm(`⚠️ XÁC NHẬN: Bạn có chắc chắn muốn xóa trạm quan trắc "${ma_tram}" khỏi CSDL PostGIS? Hành động này không thể hoàn tác!`)) {
        return;
    }

    fetch(`${API_BASE}/gis/stations/${ma_tram}`, {
        method: "DELETE"
    })
        .then(res => {
            if (!res.ok) throw new Error("Xóa trạm thất bại");
            return res.json();
        })
        .then(data => {
            fetchAdminStations(); // Làm mới lại bảng và bản đồ trạm ngay lập tức
            showAdminToast(`🗑️ ${data.message}`);
        })
        .catch(err => {
            alert("Lỗi khi xóa trạm: " + err.message);
        });
};
// ==============================================================================
// 4. QUẢN LÝ ĐĂNG KÝ CẢNH BÁO END-USERS
// ==============================================================================
function fetchSubscribers() {
    fetch(`${API_BASE}/admin/subscriptions`)
        .then(res => {
            if (!res.ok) throw new Error("Không thể nạp dữ liệu subscriptions từ API");
            return res.json();
        })
        .then(subs => {
            subscribersList = subs;
            renderSubscribersTable(subs);
        })
        .catch(err => {
            console.error("Lỗi tải subscriptions:", err);
        });
}

function renderSubscribersTable(subs) {
    const countBadge = document.getElementById("adm-subscribers");
    if (countBadge) {
        countBadge.innerText = `${subs.length} Người dân`;
    }

    const tbody = document.getElementById("adm-subscribers-table");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!subs || subs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><i class="fa-regular fa-bell-slash"></i> Chưa có người đăng ký nào.</td></tr>`;
        return;
    }

    let rowsHtml = "";
    subs.forEach((s, idx) => {
        const thresholdText = `AQI > ${s.threshold_aqi}`;
        const thresholdCls = s.threshold_aqi <= 100 ? "lvl-3" : s.threshold_aqi <= 150 ? "lvl-4" : "lvl-5";

        const stt = idx + 1;
        rowsHtml += `
            <tr>
                <td class="center"><span class="rank-badge">${stt}</span></td>
                <td class="cell-strong">${s.fullname}</td>
                <td><a href="mailto:${s.email}" class="link-mail">${s.email}</a></td>
                <td class="nowrap">${s.phone || 'N/A'}</td>
                <td>${s.ward_code}</td>
                <td><span class="aqi-pill ${thresholdCls}">${thresholdText}</span></td>
                <td class="cell-muted nowrap">${s.created_at || 'Hôm nay'}</td>
                <td class="center nowrap">
                    <div class="act-group">
                        <button class="btn-act act-send" onclick="openSendAlertModal('${s.fullname}', '${s.email}')">
                            <i class="fa-solid fa-paper-plane"></i> Gửi cảnh báo
                        </button>
                        <button class="btn-act act-del" onclick="deleteSubscriber('${s.id || s.email}')">
                            <i class="fa-solid fa-trash"></i> Xóa
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
}

window.filterSubscribers = function () {
    const term = document.getElementById("search-sub").value.toLowerCase();
    const filtered = subscribersList.filter(s =>
        s.fullname.toLowerCase().includes(term) || s.email.toLowerCase().includes(term) || s.ward_code.toLowerCase().includes(term)
    );
    renderSubscribersTable(filtered);
};

// MODAL THÊM NGƯỜI NHẬN THỦ CÔNG DÀNH CHO ADMIN
window.openAddSubscriberModal = () => document.getElementById("modal-add-sub").classList.add("active");
window.closeAddSubscriberModal = () => document.getElementById("modal-add-sub").classList.remove("active");

window.submitNewSubscriber = function (e) {
    e.preventDefault();
    const newSub = {
        fullname: document.getElementById("adm-sub-name").value.trim(),
        email: document.getElementById("adm-sub-email").value.trim(),
        phone: document.getElementById("adm-sub-phone").value.trim(),
        ward_code: document.getElementById("adm-sub-ward").value,
        threshold_aqi: parseInt(document.getElementById("adm-sub-threshold").value),
        created_at: new Date().toISOString().split('T')[0]
    };

    fetch(`${API_BASE}/admin/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSub)
    })
        .then(res => res.json())
        .then(() => {
            fetchSubscribers();
            closeAddSubscriberModal();
            document.getElementById("form-add-sub").reset();
            showAdminToast(`✅ Đã thêm người nhận cảnh báo "${newSub.fullname}"!`);
        })
        .catch(err => console.error("Lỗi thêm subscriber:", err));
};

window.deleteSubscriber = function (subId) {
    if (!subId || subId === "undefined") {
        alert("⚠️ Không tìm thấy ID hoặc Email hợp lệ để xóa!");
        return;
    }

    if (confirm("Bạn có chắc chắn muốn xóa đăng ký nhận cảnh báo này?")) {
        fetch(`${API_BASE}/admin/subscriptions/${encodeURIComponent(subId)}`, { method: "DELETE" })
            .then(res => {
                if (!res.ok) throw new Error("Máy chủ phản hồi lỗi khi xóa.");
                return res.json();
            })
            .then(() => {
                fetchSubscribers();
                showAdminToast("🗑️ Đã xóa thông tin đăng ký nhận cảnh báo.");
            })
            .catch(err => {
                console.error("Lỗi xóa subscriber:", err);
                alert("Lỗi: " + err.message);
            });
    }
};

// MODAL GỬI CẢNH BÁO TRỰC TIẾP TỚI END-USER
let currentAlertEmail = "";

window.openSendAlertModal = function (name, email) {
    currentAlertEmail = email;
    document.getElementById("alert-recipient").value = `${name} (${email})`;
    document.getElementById("modal-send-alert").classList.add("active");
};

window.closeSendAlertModal = () => document.getElementById("modal-send-alert").classList.remove("active");

window.submitSendAlert = function (e) {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;

    // Hiển thị trạng thái đang gửi email
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi mail...';
    btnSubmit.disabled = true;

    const payload = {
        recipient_email: currentAlertEmail,
        title: document.getElementById("alert-title").value,
        message: document.getElementById("alert-message").value
    };

    fetch(`${API_BASE}/admin/send-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Lỗi khi gửi email");
            return data;
        })
        .then(data => {
            closeSendAlertModal();
            showAdminToast(`📢 Đã gửi cảnh báo thành công tới hòm thư ${currentAlertEmail}!`);
        })
        .catch(err => {
            alert("Lỗi gửi mail: " + err.message);
        })
        .finally(() => {
            btnSubmit.innerHTML = oldText;
            btnSubmit.disabled = false;
        });
};

// NẠP VÀ HIỂN THỊ DANH SÁCH TOP ĐIỂM NÓNG LIÊN KẾT REAL-TIME
function fetchAdminHotspots() {
    fetch(`${API_BASE}/aqi/spatial-summary`)
        .then(res => {
            if (!res.ok) throw new Error("Không thể lấy dữ liệu điểm nóng");
            return res.json();
        })
        .then(wards => {
            renderAdminHotspots(wards);
        })
        .catch(err => {
            console.warn("Lỗi tải điểm nóng từ API, tính toán fallback động:", err);
            // Nếu mất kết nối, tự tính toán điểm nóng dựa trên nồng độ hiện tại
            const pmText = document.getElementById("adm-pm25") ? document.getElementById("adm-pm25").innerText : "35.0";
            const curPM = parseFloat(pmText) || 35.0;

            const dynamicHotspots = [
                { ten_phuong_xa: "Tân Tạo (Bình Tân)", pm2_5_trung_binh: (curPM * 1.35).toFixed(1), aqi_trung_binh: Math.round(curPM * 1.35 * 2.8) },
                { ten_phuong_xa: "Phường Bình Đông (Quận 8)", pm2_5_trung_binh: (curPM * 1.28).toFixed(1), aqi_trung_binh: Math.round(curPM * 1.28 * 2.7) },
                { ten_phuong_xa: "Phú Thọ Hòa (Tân Phú)", pm2_5_trung_binh: (curPM * 1.22).toFixed(1), aqi_trung_binh: Math.round(curPM * 1.22 * 2.6) },
                { ten_phuong_xa: "Tân Thới Hiệp (Quận 12)", pm2_5_trung_binh: (curPM * 1.15).toFixed(1), aqi_trung_binh: Math.round(curPM * 1.15 * 2.5) },
                { ten_phuong_xa: "Phường Gò Vấp", pm2_5_trung_binh: (curPM * 1.10).toFixed(1), aqi_trung_binh: Math.round(curPM * 1.10 * 2.4) }
            ];
            renderAdminHotspots(dynamicHotspots);
        });
}

function renderAdminHotspots(wards) {
    const tbody = document.getElementById("adm-hotspots-table");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Lấy đúng Top 5 điểm nóng ô nhiễm nhất
    let rowsHtml = "";
    wards.slice(0, 5).forEach((w, idx) => {
        const pm = parseFloat(w.pm2_5_trung_binh);
        const aqi = parseInt(w.aqi_trung_binh);
        const lvl = getAdminAQILevel(aqi);
        const rankCls = idx < 3 ? ` r${idx + 1}` : "";

        rowsHtml += `
            <tr>
                <td class="center"><span class="rank-badge${rankCls}">${idx + 1}</span></td>
                <td class="cell-strong">${w.ten_phuong_xa}</td>
                <td class="center cell-brand nowrap">${pm.toFixed(1)} µg/m³</td>
                <td class="center"><b class="aqi-num t-${lvl}">${aqi}</b></td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
}

function initETLEvent() {
    const btnETL = document.getElementById("btn-trigger-etl");
    const msg = document.getElementById("etl-msg");
    if (!btnETL) return;

    btnETL.addEventListener("click", () => {
        btnETL.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kết nối Open-Meteo & GEE...';
        btnETL.disabled = true;

        fetch(`${API_BASE}/admin/trigger-etl`, { method: "POST" })
            .then(res => res.json())
            .then(data => {
                // Tải lại các số liệu trên màn hình Admin ngay lập tức
                fetchAdminMetrics();
                fetchAdminHotspots();
                if (msg) {
                    msg.style.display = "block";
                    msg.innerText = `✅ ${data.message}`;
                    setTimeout(() => msg.style.display = "none", 7000);
                }
            })
            .catch(err => {
                alert("Lỗi khi chạy ETL: " + err.message);
            })
            .finally(() => {
                btnETL.innerHTML = '<i class="fa-solid fa-rotate"></i> Chạy cập nhật ETL & Retrain AI';
                btnETL.disabled = false;
            });
    });
}

let adminToastTimer = null;
function showAdminToast(msg) {
    const toast = document.getElementById("toast-admin-notification");
    if (!toast) return;
    toast.innerText = msg;
    // Khởi động lại hiệu ứng trượt vào + thanh đếm thời gian
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    clearTimeout(adminToastTimer);
    adminToastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
}
// HÀM PHÁT CẢNH BÁO KHẨN CẤP ĐỒNG LOẠT CHO TẤT CẢ USER
window.broadcastAlertToAll = function () {
    const total = subscribersList.length;
    if (total === 0) {
        alert("Hiện tại chưa có người dân nào đăng ký nhận cảnh báo!");
        return;
    }

    if (!confirm(`⚠️ XÁC NHẬN: Bạn có chắc chắn muốn gửi email cảnh báo ô nhiễm khẩn cấp tới TẤT CẢ ${total} người dân trong hệ thống?`)) {
        return;
    }

    const payload = {
        title: "⚠️ [BÁO ĐỘNG KHẨN] CHẤT LƯỢNG KHÔNG KHÍ VƯỢT NGƯỠNG AN TOÀN TẠI TP.HCM",
        message: "Hệ thống WebGIS AirHCM ghi nhận nồng độ bụi mịn PM2.5 đang ở mức Xấu trên diện rộng đô thị. Cơ quan quản lý khuyến cáo người dân hạn chế ra đường và trang bị khẩu trang N95.",
        min_threshold: 200 // Gửi cho những ai đăng ký nhận từ mức AQI này trở xuống
    };

    showAdminToast("⏳ Đang tiến hành gửi email đồng loạt, vui lòng đợi...");

    fetch(`${API_BASE}/admin/broadcast-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(data => {
            showAdminToast(`📢 ${data.message}`);
        })
        .catch(err => {
            alert("Lỗi khi phát cảnh báo: " + err.message);
        });
};
// ==============================================================================
// TÍNH NĂNG XUẤT DỮ LIỆU EXCEL / CSV CHO ADMIN (CHUẨN BÁO CÁO BỘ MÔI TRƯỜNG)
// ==============================================================================

// 1. Xuất danh sách trạm quan trắc PostGIS
window.exportStationsToCSV = function () {
    if (!adminStationList || adminStationList.length === 0) {
        alert("Chưa có dữ liệu trạm để xuất!");
        return;
    }

    let csvContent = "\uFEFFMã Trạm,Tên Trạm Quan Trắc,Đơn Vị Quản Lý,Vĩ Độ (Lat),Kinh Độ (Lng),Trạng Thái\n";
    adminStationList.forEach(st => {
        csvContent += `"${st.ma_tram}","${st.ten_tram}","${st.don_vi_quan_ly}",${st.lat},${st.lng},"${st.status || 'HOẠT ĐỘNG'}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Danh_sach_Tram_Quan_Trac_AirHCM_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showAdminToast("📊 Đã xuất thành công file Excel danh sách trạm quan trắc!");
};

// 2. Xuất danh sách người dân đăng ký cảnh báo AQI
window.exportSubscribersToCSV = function () {
    if (!subscribersList || subscribersList.length === 0) {
        alert("Chưa có danh sách người đăng ký để xuất!");
        return;
    }

    let csvContent = "\uFEFFSTT,Họ và Tên,Email,Số Điện Thoại,Khu Vực Theo Dõi,Ngưỡng AQI Kích Hoạt,Ngày Đăng Ký\n";
    subscribersList.forEach((s, idx) => {
        csvContent += `${idx + 1},"${s.fullname}","${s.email}","${s.phone || 'N/A'}","${s.ward_code}",${s.threshold_aqi},"${s.created_at || ''}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Danh_sach_Dang_Ky_Canh_Bao_AirHCM_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showAdminToast("📊 Đã xuất thành công file Excel danh sách người đăng ký cảnh báo!");
};
window.handleAdminLogout = function () {
    if (confirm("🔒 Bạn có chắc chắn muốn đăng xuất khỏi Trung tâm Điều hành Quản trị DSS?")) {
        localStorage.removeItem("airhcm_admin_auth"); // Xóa sạch phiên đăng nhập
        window.location.href = "index.html";           // Đưa về trang người dùng
    }
};
// ==============================================================================
// TỰ ĐỘNG NẠP ĐẦY ĐỦ PHƯỜNG/XÃ TP.HCM VÀO DROPDOWN THÊM NGƯỜI NHẬN TRÊN ADMIN
// ==============================================================================

// Hàm trích xuất tên Phường và Quận/Huyện từ thuộc tính GeoJSON
function extractAdminWardDetails(properties) {
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

// Đọc file GeoJSON và đổ dữ liệu vào thẻ select
function populateAdminWardDropdown() {
    const wardSelect = document.getElementById("adm-sub-ward");
    if (!wardSelect) return;

    fetch('assets/data/hcm_wards.json')
        .then(res => {
            if (!res.ok) throw new Error("Không thể tải file assets/data/hcm_wards.json");
            return res.json();
        })
        .then(geojson => {
            if (!geojson || !geojson.features) return;

            const wardList = [];
            geojson.features.forEach(f => {
                const info = extractAdminWardDetails(f.properties);
                const fullName = info.district ? `${info.ward} (${info.district})` : info.ward;
                if (fullName && !wardList.includes(fullName)) {
                    wardList.push(fullName);
                }
            });

            // Sắp xếp danh sách tên phường theo thứ tự bảng chữ cái A - Z chuẩn tiếng Việt
            wardList.sort((a, b) => a.localeCompare(b, 'vi'));

            // Đưa toàn bộ danh sách vào dropdown của modal admin
            wardSelect.innerHTML = `<option value="Tất cả TP.HCM">⭐ Tất cả khu vực TP.HCM</option>`;
            wardList.forEach(w => {
                wardSelect.innerHTML += `<option value="${w}">${w}</option>`;
            });
        })
        .catch(err => console.error("Lỗi nạp danh mục phường/xã cho admin:", err));
}
// ==============================================================================
// 1. PHÂN TÍCH VÙNG ĐỆM LAN TRUYỀN KHÔNG GIAN ĐA ĐIỂM (MULTI-POINT BUFFER GIS)
// ==============================================================================

window.setBufferRadius = function (radiusMeters, btnEl) {
    if (!adminMap) return;

    // 1. Đồng bộ trạng thái sáng đèn của nút bấm được chọn
    document.querySelectorAll(".buffer-btn-group .btn-buf").forEach(b => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");

    // 2. Xóa sạch các vùng đệm cũ trước khi vẽ lớp mới
    if (bufferLayerGroup) {
        adminMap.removeLayer(bufferLayerGroup);
        bufferLayerGroup = null;
    }

    bufferLayerGroup = L.featureGroup();

    // 3. Lấy danh sách trạm quan trắc thực tế từ PostGIS (có cơ chế fallback nếu chưa nạp xong)
    const stations = (adminStationList && adminStationList.length > 0) ? adminStationList : [
        { ma_tram: "HCM_OM_01", ten_tram: "Trạm Quan trắc Trung tâm TP.HCM", lat: 10.8231, lng: 106.6297 },
        { ma_tram: "HCM_GV_01", ten_tram: "Trạm Quan trắc Gò Vấp - Q.12", lat: 10.8350, lng: 106.6650 },
        { ma_tram: "HCM_Q1_02", ten_tram: "Trạm Quan trắc Bến Thành - Q.1", lat: 10.7769, lng: 106.7009 },
        { ma_tram: "HCM_Q8_03", ten_tram: "Trạm Quan trắc Bình Đông - Q.8", lat: 10.7328, lng: 106.6525 },
        { ma_tram: "HCM_TD_04", ten_tram: "Trạm Khu đô thị TP. Thủ Đức", lat: 10.8494, lng: 106.7583 },
        { ma_tram: "HCM_BT_05", ten_tram: "Trạm Cửa ngõ KCN Bình Tân", lat: 10.7483, lng: 106.6022 },
        { ma_tram: "HCM_TP_07", ten_tram: "Trạm Quan Trắc Sơn Kỳ - Tân Phú", lat: 10.7987, lng: 106.6300 },
        { ma_tram: "HCM_CC_06", ten_tram: "Trạm Sinh thái Ngoại ô Củ Chi", lat: 10.9731, lng: 106.4952 }
    ];

    let highRiskCount = 0;

    // 4. Quét qua từng trạm để tạo vùng đệm tương ứng trên bản đồ
    stations.forEach(st => {
        const lat = parseFloat(st.lat);
        const lng = parseFloat(st.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        // Phân loại nguy cơ: Các trạm cửa ngõ, công nghiệp mật độ xe cao hiển thị viền đỏ cảnh báo
        const nameLower = (st.ten_tram || "").toLowerCase();
        const isHighRisk = nameLower.includes("bình tân") || nameLower.includes("quận 8") ||
            nameLower.includes("tân phú") || nameLower.includes("trung tâm");

        const circleColor = isHighRisk ? "#dc2626" : "#f59e0b";
        const fillColor = isHighRisk ? "#ef4444" : "#fbbf24";
        if (isHighRisk) highRiskCount++;

        const circle = L.circle([lat, lng], {
            radius: radiusMeters,
            color: circleColor,
            fillColor: fillColor,
            fillOpacity: 0.18,
            weight: 2,
            dashArray: '5, 5'
        });

        // Popup riêng biệt cho từng trạm khi cán bộ bấm vào từng vùng đệm
        circle.bindPopup(`
            <div style="font-size: 12px; font-family: 'Plus Jakarta Sans', sans-serif; min-width: 210px;">
                <h4 style="margin: 0 0 6px 0; color: ${circleColor};">
                    <i class="fa-solid fa-triangle-exclamation"></i> Vùng ảnh hưởng: ${st.ten_tram}
                </h4>
                <p style="margin: 2px 0;"><b>Mã trạm:</b> ${st.ma_tram}</p>
                <p style="margin: 2px 0;"><b>Bán kính phân tán:</b> ${radiusMeters / 1000} km</p>
                <p style="margin: 2px 0;"><b>Đánh giá rủi ro:</b> <b style="color: ${circleColor};">${isHighRisk ? 'Nguy cơ cao (Ưu tiên xử lý)' : 'Mức kiểm soát'}</b></p>
                <hr style="margin: 6px 0; border: 0; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.4;">
                    Phạm vi cần triển khai tưới nước rửa đường, kiểm soát phát thải phương tiện và cảnh báo hạn chế hoạt động ngoài trời tại các trường học lân cận.
                </p>
            </div>
        `);

        bufferLayerGroup.addLayer(circle);
    });

    // 5. Đưa toàn bộ các vùng đệm lên bản đồ
    bufferLayerGroup.addTo(adminMap);

    // Tự động thu phóng bản đồ để hiển thị bao quát tất cả các vùng đệm trên toàn thành phố
    if (bufferLayerGroup.getLayers().length > 0) {
        adminMap.fitBounds(bufferLayerGroup.getBounds(), { padding: [40, 40] });
    }

    if (typeof showAdminToast === "function") {
        showAdminToast(`📡 Đã kích hoạt ${stations.length} vùng đệm (${radiusMeters / 1000}km) trên toàn mạng lưới trạm!`);
    }
};

window.clearBufferZone = function () {
    if (bufferLayerGroup && adminMap) {
        adminMap.removeLayer(bufferLayerGroup);
        bufferLayerGroup = null;
    }
    // Hủy trạng thái kích hoạt trên thanh công cụ
    document.querySelectorAll(".buffer-btn-group .btn-buf").forEach(b => b.classList.remove("active"));

    if (typeof showAdminToast === "function") {
        showAdminToast("🧹 Đã xóa toàn bộ vùng đệm phân tán.");
    }
};
// 2. Nút Bật/Tắt chế độ Bắt tọa độ trạm dạng Toggle Button
window.toggleCoordPickerBtn = function () {
    isPickCoordActive = !isPickCoordActive;
    const btn = document.getElementById("btn-toggle-pick");
    const mapEl = document.getElementById("admin-map");

    if (btn) {
        if (isPickCoordActive) {
            btn.classList.add("active");
            if (mapEl) mapEl.style.cursor = "crosshair";
            showAdminToast("📍 Chế độ bắt điểm: Click vào vị trí bất kỳ trên bản đồ để lấy tọa độ.");
        } else {
            btn.classList.remove("active");
            if (mapEl) mapEl.style.cursor = "";
            if (tempPickMarker && adminMap) {
                adminMap.removeLayer(tempPickMarker);
                tempPickMarker = null;
            }
        }
    }
};

// 3. Đổi nhanh trạng thái Trạm (HOẠT ĐỘNG <-> BẢO TRÌ) qua API
window.toggleStationStatus = function (ma_tram, currentStatus) {
    const newStatus = (currentStatus === 'HOẠT ĐỘNG') ? 'BẢO TRÌ' : 'HOẠT ĐỘNG';

    const targetStation = adminStationList.find(s => s.ma_tram === ma_tram);
    const payload = {
        ten_tram: targetStation ? targetStation.ten_tram : "Trạm quan trắc",
        don_vi_quan_ly: targetStation ? targetStation.don_vi_quan_ly : "Sở TN&MT TP.HCM",
        lat: targetStation ? targetStation.lat : 10.8231,
        lng: targetStation ? targetStation.lng : 106.6297,
        status: newStatus
    };

    fetch(`${API_BASE}/gis/stations/${encodeURIComponent(ma_tram)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => {
            if (!res.ok) throw new Error("Cập nhật trạng thái thất bại");
            return res.json();
        })
        .then(() => {
            showAdminToast(`🔄 Đã đổi trạm ${ma_tram} sang trạng thái: ${newStatus}`);
            fetchAdminStations(); // Làm mới danh sách trạm và bản đồ
        })
        .catch(err => alert("Lỗi: " + err.message));
};
// ==============================================================================
// 16. QUẢN TRỊ TÀI KHOẢN END-USERS DÀNH CHO ADMIN
// ==============================================================================
let adminUsersList = [];

function fetchAdminUsers() {
    fetch(`${API_BASE}/admin/users`)
        .then(res => res.json())
        .then(users => {
            adminUsersList = users;
            renderAdminUsersTable(users);
        })
        .catch(err => console.error("Lỗi tải danh sách người dùng:", err));
}

function renderAdminUsersTable(users) {
    const tbody = document.getElementById("adm-users-table-body");
    if (!tbody) return;
    if (!Array.isArray(users)) users = [];   // Máy chủ từ chối (hết phiên) -> bảng trống, đang chuyển về trang đăng nhập
    tbody.innerHTML = "";

    if (!users || users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><i class="fa-regular fa-user"></i> Chưa có thành viên nào đăng ký.</td></tr>`;
        return;
    }

    let rowsHtml = "";
    users.forEach((u, idx) => {
        const isLocked = (u.status === 'BỊ KHÓA');
        const statusBadge = isLocked
            ? `<span class="chip chip-danger"><i class="fa-solid fa-lock"></i> BỊ KHÓA</span>`
            : `<span class="chip chip-success"><i class="fa-solid fa-circle-check"></i> HOẠT ĐỘNG</span>`;

        let providerBadge = `<span class="chip chip-neutral"><i class="fa-solid fa-envelope"></i> Email</span>`;
        if (u.provider === 'Google') providerBadge = `<span class="chip chip-danger"><i class="fa-brands fa-google"></i> Google</span>`;
        else if (u.provider === 'Facebook') providerBadge = `<span class="chip chip-info"><i class="fa-brands fa-facebook"></i> Facebook</span>`;
        else if (u.provider === 'Apple') providerBadge = `<span class="chip chip-dark"><i class="fa-brands fa-apple"></i> Apple</span>`;

        // Số thứ tự hiển thị tự động tăng (ID thật vẫn dùng để gọi API)
        const stt = idx + 1;

        rowsHtml += `
            <tr>
                <td class="center"><span class="rank-badge">${stt}</span></td>
                <td>
                    <div class="avatar-cell">
                        ${avatarImg(u)}
                        <span class="cell-strong">${escapeHtml(u.fullname)}</span>
                    </div>
                </td>
                <td>${u.email ? `<a href="mailto:${escapeHtml(u.email)}" class="link-mail">${escapeHtml(u.email)}</a>` : '<span class="cell-muted">—</span>'}</td>
                <td>${providerBadge}</td>
                <td class="cell-muted nowrap">${u.created_at || 'Mới'}</td>
                <td class="center nowrap">${statusBadge}</td>
                <td class="center nowrap">
                    <div class="act-group">
                        <button onclick="toggleUserStatusAdmin(${u.id})" class="btn-act ${isLocked ? 'act-unlock' : 'act-lock'}" title="Khóa hoặc Mở khóa">
                            <i class="fa-solid ${isLocked ? 'fa-lock-open' : 'fa-lock'}"></i> ${isLocked ? 'Mở' : 'Khóa'}
                        </button>
                        <button onclick="deleteUserAdmin(${u.id})" class="btn-act act-del" title="Xóa tài khoản">
                            <i class="fa-solid fa-trash"></i> Xóa
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
}

window.filterAdminUsers = function () {
    const term = document.getElementById("search-user").value.toLowerCase();
    const filtered = adminUsersList.filter(u =>
        u.fullname.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
    renderAdminUsersTable(filtered);
};

window.toggleUserStatusAdmin = function (userId) {
    fetch(`${API_BASE}/admin/users/${userId}/toggle-status`, { method: "PUT" })
        .then(res => res.json())
        .then(data => {
            showAdminToast(`🔄 ${data.message}`);
            fetchAdminUsers();
        })
        .catch(err => alert("Lỗi: " + err.message));
};

window.deleteUserAdmin = function (userId) {
    if (confirm(`Bạn có chắc chắn muốn xóa tài khoản #${userId} này?`)) {
        fetch(`${API_BASE}/admin/users/${userId}`, { method: "DELETE" })
            .then(res => res.json())
            .then(data => {
                showAdminToast(`🗑️ ${data.message}`);
                fetchAdminUsers();
            })
            .catch(err => alert("Lỗi: " + err.message));
    }
};

// Tự động tải danh sách thành viên khi Admin chuyển sang Tab Users
document.addEventListener("DOMContentLoaded", () => {
    fetchAdminUsers();
});
// ==============================================================================
// XỬ LÝ 3 NÚT: XUẤT EXCEL - THÊM THÀNH VIÊN - LÀM MỚI DANH SÁCH USER
// ==============================================================================

// 1. NÚT LÀM MỚI DANH SÁCH (CÓ TOAST PHẢN HỒI)
window.refreshAdminUsers = function () {
    showAdminToast("🔄 Đang đồng bộ danh sách thành viên...");
    fetchAdminUsers();
};

// 2. NÚT THÊM THÀNH VIÊN (MỞ / ĐÓNG MODAL)
window.openAddUserModal = function () {
    const modal = document.getElementById("modal-add-user");
    if (modal) {
        modal.classList.add("active");
        const nameInput = document.getElementById("add-user-fullname");
        if (nameInput) nameInput.focus();
    } else {
        alert("Lỗi: Không tìm thấy modal-add-user trong HTML!");
    }
};

window.closeAddUserModal = function () {
    const modal = document.getElementById("modal-add-user");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("form-add-user");
    if (form) form.reset();
};

// Xử lý gửi Form tạo User mới lên Backend
window.submitAddUser = function (e) {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
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
            fetchAdminUsers(); // Tải lại bảng ngay lập tức
        })
        .catch(err => {
            alert("Lỗi: " + err.message);
        })
        .finally(() => {
            btnSubmit.innerHTML = oldText;
            btnSubmit.disabled = false;
        });
};

// 3. NÚT XUẤT EXCEL (CSV) CHUẨN UTF-8 BOM
window.exportUsersToCSV = function () {
    if (!adminUsersList || adminUsersList.length === 0) {
        alert("⚠️ Hiện tại chưa có dữ liệu thành viên để xuất file!");
        return;
    }

    // Đổi tiêu đề cột đầu tiên thành STT
    let csvContent = "\uFEFFSTT,Họ và Tên,Địa Chỉ Email,Phương Thức Đăng Ký,Thời Gian Tạo,Trạng Thái\n";

    adminUsersList.forEach((u, idx) => {
        csvContent += `${idx + 1},"${u.fullname}","${u.email}","${u.provider}","${u.created_at || ''}","${u.status}"\n`;
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