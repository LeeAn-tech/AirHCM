// ==============================================================================
// AIRHCM - JAVASCRIPT QUẢN TRỊ ADMIN DASHBOARD
// Khoa CNTT - Trường Đại học Tài nguyên & Môi trường TP.HCM (HCMUNRE)
// SVTH: LÊ HOÀNG ÂN - 1250080001 | GVHD: TS. Dương Thị Thúy Nga
// ==============================================================================

const API_BASE = "http://127.0.0.1:8000/api/v1";

let adminMap = null;
let currentBaseTile = null;
let adminStationMarkers = [];
let adminStationList = [];
let subscribersList = [];

document.addEventListener("DOMContentLoaded", () => {
    initAdminTabs();
    initAdminMap();
    fetchAdminMetrics();
    fetchAdminStations();
    fetchAdminHotspots();
    fetchSubscribers();
    initETLEvent();
});

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

            // Tự động căn chỉnh kích thước bản đồ khi chuyển về Tab Bản đồ
            if (targetId === "adm-tab-map" && adminMap) {
                setTimeout(() => adminMap.invalidateSize(), 200);
            }

            // TỰ ĐỘNG TẢI LẠI DANH SÁCH MỚI NHẤT KHI MỞ TAB QUẢN LÝ CẢNH BÁO
            if (targetId === "adm-tab-subscriptions") {
                fetchSubscribers();
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

    currentBaseTile = tiles.dark;
    currentBaseTile.addTo(adminMap);

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(adminMap);

    setTimeout(() => adminMap.invalidateSize(), 300);

    adminMap.on("mousemove", e => {
        const coordsBadge = document.getElementById("adm-coords");
        if (coordsBadge) {
            coordsBadge.innerText = `Tọa độ: ${e.latlng.lat.toFixed(4)} N, ${e.latlng.lng.toFixed(4)} E | Zoom: ${adminMap.getZoom()}`;
        }
    });

    const selectBasemap = document.getElementById("adm-select-basemap");
    if (selectBasemap) {
        selectBasemap.addEventListener("change", e => {
            const val = e.target.value;
            if (currentBaseTile) adminMap.removeLayer(currentBaseTile);
            if (tiles[val]) {
                currentBaseTile = tiles[val];
                currentBaseTile.addTo(adminMap);
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
            document.getElementById("adm-pm25").innerText = `${data.pm2_5} µg/m³`;
            document.getElementById("adm-aqi").innerText = `${data.us_aqi} (${data.advisory ? data.advisory.level : 'Xấu'})`;
        })
        .catch(err => {
            document.getElementById("adm-pm25").innerText = "35.2 µg/m³";
            document.getElementById("adm-aqi").innerText = "102 (Trung bình)";
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
        if (tbody) {
            const row = `
                <tr>
                    <td><b>${st.ma_tram}</b></td>
                    <td>${st.ten_tram}</td>
                    <td>${st.don_vi_quan_ly}</td>
                    <td>${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}</td>
                    <td><span style="background:rgba(74,222,128,0.2); color:#4ade80; padding:2px 8px; border-radius:4px; font-weight:600; font-size:11px;">${st.status || 'HOẠT ĐỘNG'}</span></td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="zoomToStation(${st.lat}, ${st.lng})" class="btn" style="background:#0284c7; color:#fff; border:none; padding:4px 8px; border-radius:5px; font-size:11px; cursor:pointer;" title="Xem vị trí">
                                <i class="fa-solid fa-eye"></i> Xem
                            </button>
                            <button onclick="openEditStationModal('${st.ma_tram}')" class="btn" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid #f59e0b; padding:4px 8px; border-radius:5px; font-size:11px; cursor:pointer;" title="Chỉnh sửa trạm">
                                <i class="fa-solid fa-pen-to-square"></i> Sửa
                            </button>
                            <button onclick="deleteStation('${st.ma_tram}')" class="btn" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444; padding:4px 8px; border-radius:5px; font-size:11px; cursor:pointer;" title="Xóa trạm">
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

            const marker = L.marker([st.lat, st.lng], { icon: radarIcon }).addTo(adminMap);
            marker.bindPopup(`<b>${st.ten_tram}</b><br>Mã: ${st.ma_tram}`);
            adminStationMarkers.push(marker);
        }
    });
}
window.zoomToStation = function(lat, lng) {
    document.querySelector('[data-adm-tab="adm-tab-map"]').click();
    setTimeout(() => {
        if (adminMap) adminMap.flyTo([lat, lng], 14, { duration: 1.0 });
    }, 200);
};

// MODAL THÊM TRẠM
window.openAddStationModal = () => document.getElementById("modal-add-station").classList.add("active");
window.closeAddStationModal = () => document.getElementById("modal-add-station").classList.remove("active");

window.submitNewStation = function(e) {
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
window.openEditStationModal = function(ma_tram) {
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
window.closeEditStationModal = function() {
    document.getElementById("modal-edit-station").classList.remove("active");
};

// Gửi dữ liệu cập nhật trạm lên Backend
window.submitEditStation = function(e) {
    e.preventDefault();
    const ma_tram = document.getElementById("edit-st-id").value;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const oldText = btnSubmit.innerHTML;

    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
    btnSubmit.disabled = true;

    const payload = {
        ten_tram: document.getElementById("edit-st-name").value.trim(),
        don_vi_quan_ly: document.getElementById("edit-st-owner").value.trim(),
        lat: parseFloat(document.getElementById("edit-st-lat").value),
        lng: parseFloat(document.getElementById("edit-st-lng").value),
        status: document.getElementById("edit-st-status").value
    };

    fetch(`${API_BASE}/gis/stations/${ma_tram}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error("Cập nhật trạm thất bại");
        return res.json();
    })
    .then(data => {
        fetchAdminStations(); // Tải lại danh sách trạm từ Backend
        closeEditStationModal();
        showAdminToast(`✅ ${data.message}`);
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
window.deleteStation = function(ma_tram) {
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
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: #94a3b8; padding: 20px;">Chưa có người đăng ký nào.</td></tr>`;
        return;
    }

    subs.forEach((s, idx) => {
        const thresholdText = `AQI > ${s.threshold_aqi}`;
        const thresholdColor = s.threshold_aqi <= 100 ? "#f59e0b" : s.threshold_aqi <= 150 ? "#ef4444" : "#a855f7";

        const row = `
            <tr>
                <td><b>#${s.id || idx + 1}</b></td>
                <td><b>${s.fullname}</b></td>
                <td><a href="mailto:${s.email}" style="color:#38bdf8; text-decoration:none;">${s.email}</a></td>
                <td>${s.phone || 'N/A'}</td>
                <td>${s.ward_code}</td>
                <td><span style="background:rgba(255,255,255,0.06); color:${thresholdColor}; border: 1px solid ${thresholdColor}; padding:3px 10px; border-radius:6px; font-weight:700; font-size:11px;">${thresholdText}</span></td>
                <td>${s.created_at || 'Hôm nay'}</td>
                <td>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn-action-sm btn-act-alert" style="background: rgba(56,189,248,0.15); color:#38bdf8; border:1px solid #38bdf8; padding:4px 8px; border-radius:6px; cursor:pointer;" onclick="openSendAlertModal('${s.fullname}', '${s.email}')">
                            <i class="fa-solid fa-paper-plane"></i> Gửi cảnh báo
                        </button>
                        <button class="btn-action-sm btn-act-delete" style="background: rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444; padding:4px 8px; border-radius:6px; cursor:pointer;" onclick="deleteSubscriber(${s.id})">
                            <i class="fa-solid fa-trash"></i> Xóa
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

window.filterSubscribers = function() {
    const term = document.getElementById("search-sub").value.toLowerCase();
    const filtered = subscribersList.filter(s =>
        s.fullname.toLowerCase().includes(term) || s.email.toLowerCase().includes(term) || s.ward_code.toLowerCase().includes(term)
    );
    renderSubscribersTable(filtered);
};

// MODAL THÊM NGƯỜI NHẬN THỦ CÔNG DÀNH CHO ADMIN
window.openAddSubscriberModal = () => document.getElementById("modal-add-sub").classList.add("active");
window.closeAddSubscriberModal = () => document.getElementById("modal-add-sub").classList.remove("active");

window.submitNewSubscriber = function(e) {
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

window.deleteSubscriber = function(subId) {
    if (confirm("Bạn có chắc chắn muốn xóa đăng ký nhận cảnh báo này?")) {
        fetch(`${API_BASE}/admin/subscriptions/${subId}`, { method: "DELETE" })
            .then(() => {
                fetchSubscribers();
                showAdminToast("🗑️ Đã xóa thông tin đăng ký nhận cảnh báo.");
            })
            .catch(err => console.error("Lỗi xóa subscriber:", err));
    }
};

// MODAL GỬI CẢNH BÁO TRỰC TIẾP TỚI END-USER
let currentAlertEmail = "";

window.openSendAlertModal = function(name, email) {
    currentAlertEmail = email;
    document.getElementById("alert-recipient").value = `${name} (${email})`;
    document.getElementById("modal-send-alert").classList.add("active");
};

window.closeSendAlertModal = () => document.getElementById("modal-send-alert").classList.remove("active");

window.submitSendAlert = function(e) {
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

// 5. TOP ĐIỂM NÓNG & SỰ KIỆN ETL
function fetchAdminHotspots() {
    fetch(`${API_BASE}/aqi/spatial-summary`)
        .then(res => res.json())
        .then(wards => renderAdminHotspots(wards))
        .catch(err => {
            const mockWards = [
                { ten_phuong_xa: "Bình Khánh (Thủ Đức)", pm2_5_trung_binh: 18.8, aqi_trung_binh: 65 },
                { ten_phuong_xa: "Tân Tạo (Bình Tân)", pm2_5_trung_binh: 18.8, aqi_trung_binh: 65 },
                { ten_phuong_xa: "Phú Thọ Hòa (Tân Phú)", pm2_5_trung_binh: 18.8, aqi_trung_binh: 65 }
            ];
            renderAdminHotspots(mockWards);
        });
}

function renderAdminHotspots(wards) {
    const tbody = document.getElementById("adm-hotspots-table");
    if (!tbody) return;
    tbody.innerHTML = "";
    wards.slice(0, 5).forEach((w, idx) => {
        const row = `
            <tr>
                <td><b>#${idx + 1}</b></td>
                <td>${w.ten_phuong_xa}</td>
                <td style="color:#38bdf8; font-weight:700;">${w.pm2_5_trung_binh} µg/m³</td>
                <td><b style="color:#f59e0b;">${w.aqi_trung_binh || 65}</b></td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
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

function showAdminToast(msg) {
    const toast = document.getElementById("toast-admin-notification");
    if (!toast) return;
    toast.innerText = msg;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 4000);
}
// HÀM PHÁT CẢNH BÁO KHẨN CẤP ĐỒNG LOẠT CHO TẤT CẢ USER
window.broadcastAlertToAll = function() {
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