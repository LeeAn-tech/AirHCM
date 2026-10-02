'use strict';

import { CONFIG, STN } from './config.js';
import { ApiService } from './api.js';
import { $, LV, calc, initMap, paintMap, focusStation, drawChart, showErr } from './shared.js';

let currentLang = 'vi';
const I18N = {
    vi: {
        title: "Hỗ trợ ra quyết định & Dự báo PM2.5",
        about: "ℹ️ Về mô hình",
        share: "🔗 Chia sẻ",
        login: "Đăng nhập Admin",
        search: "Tìm kiếm địa chỉ, quận, huyện...",
        heat: " Bản đồ nhiệt",
        pts: " Trạm quan trắc",
        dist: " Ranh giới Khu vực",
        wind: " 💨 Hướng gió (Mô phỏng)",
        now: "Hiện tại",
        export: "⬇ Tải CSV",
        scope: "Toàn thành phố",
        viewReg: "Xem theo Khu vực",
        pick: "-- Chọn Khu vực --",
        which: "Bạn thuộc nhóm nào?",
        g1: "Người bình thường",
        g2: "Trẻ em",
        g3: "Người cao tuổi",
        g4: "Bệnh hô hấp",
        alert: "🔔 Đăng ký nhận cảnh báo AQI",
        source: "Nguồn: OpenAQ | Thuật toán AI: XGBoost Regressor",
        genLabel: "Khuyến cáo chung",
        sensLabel: "Khuyến cáo nhóm nhạy cảm",
        updatePrefix: "Cập nhật",
        locErr: "Không thể tìm thấy vị trí của bạn.",
        notFound: "Không tìm thấy địa điểm. Vui lòng thử lại!",
        windAlert: "Đang tích hợp API GFS/ECMWF. Hệ thống sẽ overlay dữ liệu vector gió thời gian thực trong bản cập nhật tới.",
        mAboutTitle: "Về Hệ Thống WebGIS AirHCM",
        mAboutP1: "Hệ thống hỗ trợ ra quyết định cảnh báo sức khỏe cộng đồng, dự báo chỉ số PM2.5/AQI bằng mô hình Học máy XGBoost và dữ liệu viễn thám.",
        mAboutP2: "Đồ án chuyên ngành Tin học Môi trường thực hiện bởi sinh viên <b>Lê Hoàng Ân</b> - Trường Đại học Tài nguyên và Môi trường TP.HCM.",
        btnClose: "Đóng thông tin",
        mAlertTitle: "Nhận cảnh báo sức khỏe",
        mAlertP: "Hệ thống sẽ gửi email tự động khi chỉ số PM2.5 tại khu vực của bạn vượt mức Kém (AQI > 100).",
        btnReg: "Đăng ký ngay",
        btnCancel: "Hủy bỏ",
        levels: ['Tốt', 'Trung bình', 'Kém (nhóm nhạy cảm)', 'Xấu', 'Rất xấu', 'Nguy hại'],
        gen: ['Không khí tốt, thoải mái hoạt động ngoài trời.', 'Chấp nhận được. Người rất nhạy cảm nên hạn chế vận động mạnh kéo dài.', 'Giảm hoạt động mạnh ngoài trời; cân nhắc đeo khẩu trang.', 'Hạn chế ra ngoài, đeo khẩu trang N95/KN95, đóng cửa sổ.', 'Ở trong nhà, dùng máy lọc không khí nếu có; tránh hoạt động ngoài trời.', 'Khẩn cấp: ở trong nhà, đóng kín cửa, theo dõi thông báo cơ quan chức năng.'],
        sens: ['Theo dõi bình thường.', 'Người có bệnh nền nên theo dõi triệu chứng và mang theo thuốc.', 'Tránh hoạt động ngoài trời; nên ở nơi có không khí sạch.', 'Ở trong nhà, hoãn mọi hoạt động ngoài trời; liên hệ y tế nếu khó thở.', 'Ở trong nhà, đóng kín cửa; liên hệ y tế ngay khi có triệu chứng.', 'Ở trong nhà, hạn chế tối đa vận động; sẵn sàng liên hệ cơ sở y tế.']
    },
    en: {
        title: "Decision Support & PM2.5 Forecast",
        about: "ℹ About Model",
        share: "🔗 Share",
        login: "Admin Login",
        search: "Search address, district...",
        heat: " Heatmap",
        pts: " Stations",
        dist: " Boundaries",
        wind: " 💨 Wind (Simulated)",
        now: "Current",
        export: "⬇ Export CSV",
        scope: "Whole City",
        viewReg: "View by Region",
        pick: "-- Select Region --",
        which: "Which group are you?",
        g1: "General",
        g2: "Children",
        g3: "Elderly",
        g4: "Respiratory",
        alert: "🔔 Subscribe to Alerts",
        source: "Source: OpenAQ | AI Model: XGBoost Regressor",
        genLabel: "General Advice",
        sensLabel: "Sensitive Advice",
        updatePrefix: "Updated",
        locErr: "Could not find your location.",
        notFound: "Location not found. Please try again!",
        windAlert: "Integrating GFS/ECMWF API. The system will overlay real-time wind vector data in the next update.",
        mAboutTitle: "About WebGIS AirHCM",
        mAboutP1: "A decision support system for public health alerts, forecasting PM2.5/AQI using XGBoost Machine Learning and remote sensing data.",
        mAboutP2: "Environmental Informatics Major Project by student <b>Le Hoang An</b> - HCMUNRE.",
        btnClose: "Close",
        mAlertTitle: "Get Health Alerts",
        mAlertP: "The system will automatically email you when PM2.5 in your area exceeds Unhealthy limits (AQI > 100).",
        btnReg: "Register Now",
        btnCancel: "Cancel",
        levels: ['Good', 'Moderate', 'Unhealthy (Sens)', 'Unhealthy', 'Very Unhealthy', 'Hazardous'],
        gen: ['Good air quality, enjoy outdoor activities.', 'Acceptable. Unusually sensitive people should reduce prolonged exertion.', 'Reduce prolonged outdoor exertion; consider wearing a mask.', 'Avoid outdoor activities, wear N95/KN95 mask, close windows.', 'Stay indoors, use air purifier if available; avoid outdoor activities.', 'Emergency: stay indoors, keep windows closed, follow official instructions.'],
        sens: ['Monitor normally.', 'People with underlying conditions should monitor symptoms and carry medication.', 'Avoid outdoor activities; stay in clean air environments.', 'Stay indoors, postpone all outdoor activities; seek medical help if breathing gets difficult.', 'Stay indoors, keep doors closed; seek medical help if symptoms appear.', 'Stay indoors, minimize physical activity; be ready to seek medical help.']
    }
};

let GEN = I18N[currentLang].gen;
let SENS = I18N[currentLang].sens;

const M = initMap();
// Đổi biến state.h thành state.d
const state = { d: 0, group: 'general', feats: [], geojson: null };
let chart;

const setLoading = (isLoading) => {
    const loader = $('#loading');
    if(loader) loader.classList.toggle('active', isLoading);
};

// TẢI DỮ LIỆU GEOJSON
async function loadDistricts() {
    try {
        const data = await ApiService.getGeoJson('boundary.geojson');
        if (!data || (data.type !== 'FeatureCollection' && data.type !== 'Feature')) {
            throw new Error("Dữ liệu không đúng chuẩn GeoJSON");
        }
        state.geojson = data;
    } catch (e) {
        console.warn("Không tải được file boundary.geojson thực tế, dùng dữ liệu đa giác mô phỏng:", e);
        state.geojson = {
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "properties": { "name": "Khu vực TPHCM" }, "geometry": { "type": "Polygon", "coordinates": [[[106.35, 10.35], [106.45, 10.75], [106.65, 11.10], [106.85, 11.00], [106.90, 10.50], [106.65, 10.30], [106.35, 10.35]]] } },
                { "type": "Feature", "properties": { "name": "Khu vực Bình Dương" }, "geometry": { "type": "Polygon", "coordinates": [[[106.65, 11.10], [106.50, 11.40], [106.80, 11.55], [107.00, 11.30], [106.85, 11.00], [106.65, 11.10]]] } },
                { "type": "Feature", "properties": { "name": "Đồng Nai & BR-VT" }, "geometry": { "type": "Polygon", "coordinates": [[[106.90, 10.50], [106.85, 11.00], [107.20, 11.20], [107.50, 10.80], [107.30, 10.40], [106.90, 10.50]]] } }
            ]
        };
    }
}

// NẠP DANH SÁCH KHU VỰC VÀO DROPDOWN
function initDistrictSelect() {
    const pick = $('#pick');
    if (!pick) return;
    
    pick.innerHTML = `<option value="">${I18N[currentLang].pick}</option>` + STN.map(s => `<option value="NEW_${s[0]}">${s[1]}</option>`).join('');
    
    pick.onchange = e => {
        const ma = e.target.value;
        if (ma) focusStation(M, ma);
    };
}

function render() {
  const f = state.feats;
  if (!f || f.length === 0) return;
  
  paintMap(M, f);
  
  const avg = f.reduce((s, x) => s + x.properties.pm2_5, 0) / f.length;
  const { lv, aqi } = calc(avg);
  
  const card = $('#aqi-card'); card.style.background = LV[lv].c; card.style.color = LV[lv].t;
  $('#lv').textContent = LV[lv].n; $('#aqi').textContent = aqi; $('#pm').textContent = avg.toFixed(1);
  
  const g = state.group === 'general';
  const lang = I18N[currentLang];
  
  $('#advice').innerHTML = `<b>${g ? lang.genLabel : lang.sensLabel}:</b> ` + (g ? GEN[lv] : SENS[lv] + ' ' + GEN[lv]);
  
  const timeLocale = currentLang === 'vi' ? 'vi-VN' : 'en-US';
  const dayText = currentLang === 'vi' ? 'ngày' : 'days';
  // Đổi từ tính giờ sang tính ngày (86400000ms = 1 ngày) và hiển thị Date thay vì Time
  $('#t-label').textContent = state.d === 0 ? lang.now : `+${state.d} ${dayText} · ${new Date(Date.now() + state.d * 864e5).toLocaleDateString(timeLocale, { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
  
if(M.districts) {
      M.districts.clearLayers();
      const distCheckbox = $('#l-dist');
      if (state.geojson && distCheckbox && distCheckbox.checked) {
          L.geoJSON(state.geojson, {
              style: function(feature) {
                  return { 
                      color: '#450a0a',        
                      weight: 2,               
                      opacity: 0.9,
                      dashArray: '5, 4, 1, 4', 
                      fillColor: 'transparent',
                      fillOpacity: 0,
                      className: 'district-polygon' 
                  };
              },
              onEachFeature: function(feature, layer) {
                  layer.on({
                      mouseover: function(e) {
                          var l = e.target;
                          l.setStyle({ weight: 3, color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.1 });
                          if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) { l.bringToFront(); }
                      },
                      mouseout: function(e) { M.districts.resetStyle(e.target); }
                  });
                  if (feature.properties && feature.properties.name) {
                      layer.bindTooltip(`<b>${feature.properties.name}</b>`, {sticky: true});
                  }
              }
          }).addTo(M.districts);
      }
  }
  const now = new Date();
  $('#last-updated').textContent = `${lang.updatePrefix}: ${now.toLocaleTimeString(timeLocale)} - ${now.toLocaleDateString(timeLocale)}`;
  if (chart) chart.update('none');
}

// =========================================================
// HÀM GỌI API BACKEND VÀ CẬP NHẬT GIAO DIỆN DSS
// =========================================================
async function triggerDSSPrediction(lat, lon) {
    try {
        setLoading(true);
        const currentGroup = state.group; 
        const daysAhead = state.d; // Đổi biến lấy số ngày      

        // Gửi tọa độ xuống FastAPI
        const data = await ApiService.getPredictionAndAlert(lat, lon, currentGroup, daysAhead);
        
        if (data.status === 'success') {
            $('#advice').innerHTML = `<b>Khuyến cáo từ AI:</b> ${data.dss_decision.end_user_advice}`;
            
            $('#aqi').textContent = data.dss_decision.aqi_index;
            $('#pm').textContent = data.dss_decision.pm25_predict;
            $('#lv').textContent = data.dss_decision.pollution_level;

            L.geoJSON(data.gis_layer, {
                pointToLayer: function (feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 12, fillColor: '#ef4444', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
                    });
                }
            }).bindPopup(`<b>Dự báo PM2.5:</b> ${data.dss_decision.pm25_predict} µg/m³`).addTo(M.map);
        }
    } catch (e) {
        console.warn("Lỗi khi kết nối đến Backend AI:", e);
    } finally {
        setLoading(false);
    }
}

// =========================================================
// LOGIC SỰ KIỆN GIAO DIỆN
// =========================================================

let timer;
$('#slider').oninput = e => {
  state.d = +e.target.value; 
  clearTimeout(timer);
  setLoading(true); 
  timer = setTimeout(() => {
      // Gửi số ngày lên server
      ApiService.getStationsData(state.d)
        .then(d => { state.feats = d.features; render(); })
        .catch(showErr)
        .finally(() => setLoading(false)); 
  }, 300); 
};

$('#chips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.group = b.dataset.g;
  document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
  render();
};

const btnLocate = $('#btn-locate');
if(btnLocate) {
    btnLocate.onclick = () => M.map.locate({setView: true, maxZoom: 14});
    M.map.on('locationfound', async function(e) {
        if(M.userMarker) M.map.removeLayer(M.userMarker);
        if(M.userCircle) M.map.removeLayer(M.userCircle);
        const radius = e.accuracy / 2;
        M.userMarker = L.marker(e.latlng).addTo(M.map)
            .bindPopup(`Bạn đang ở đây.<br><b>Đang phân tích dữ liệu AI...</b>`).openPopup();
        M.userCircle = L.circle(e.latlng, radius, {color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1}).addTo(M.map);
        
        await triggerDSSPrediction(e.latlng.lat, e.latlng.lng);
    });
    M.map.on('locationerror', function(e) { alert(I18N[currentLang].locErr); });
}

// KHỞI TẠO ỨNG DỤNG
setLoading(true);
initDistrictSelect();

Promise.all([ApiService.getStationsData(0), ApiService.getTimeseriesData(), loadDistricts()]).then(([h, s, _]) => {
  state.feats = h.features; 
  chart = drawChart($('#chart'), s, () => state.d); 
  render();
}).catch(showErr).finally(() => setLoading(false));

function applyLanguage() {
    const lang = I18N[currentLang];
    
    GEN = lang.gen;
    SENS = lang.sens;
    LV.forEach((l, i) => { l.n = lang.levels[i]; });
    
    try {
        document.querySelector('h1 small').textContent = lang.title;
        $('#btn-about').textContent = lang.about;
        $('#btn-share').textContent = lang.share;
        document.querySelector('.navbar a.btn').textContent = lang.login;
        
        $('#search-input').placeholder = lang.search;
        const ctlLabels = document.querySelectorAll('.ctl label');
        if(ctlLabels.length >= 4) {
            ctlLabels[0].lastChild.textContent = lang.heat;
            ctlLabels[1].lastChild.textContent = lang.pts;
            ctlLabels[2].lastChild.textContent = lang.dist;
            ctlLabels[3].lastChild.textContent = lang.wind;
        }
        
        const BP = [[0,9,0,50],[9.1,35.4,51,100],[35.5,55.4,101,150],[55.5,125.4,151,200],[125.5,225.4,201,300],[225.5,325.4,301,400]];
        $('#legend').innerHTML = LV.map((l, i) => `<div><i style="background:${l.c}"></i>${l.n} <small>(${BP[i][2]}–${BP[i][3]})</small></div>`).join('');
        
        $('#btn-export').textContent = lang.export;
        $('#scope').textContent = lang.scope;
        document.querySelectorAll('.meta-info div')[1].textContent = lang.source;
        
        const h2s = document.querySelectorAll('aside h2');
        if (h2s.length >= 2) {
            h2s[0].textContent = lang.viewReg;
            h2s[1].textContent = lang.which;
        }
        if ($('#pick').options.length > 0) $('#pick').options[0].textContent = lang.pick;
        
        const chips = document.querySelectorAll('#chips button');
        if (chips.length >= 4) {
            chips[0].textContent = lang.g1; chips[1].textContent = lang.g2;
            chips[2].textContent = lang.g3; chips[3].textContent = lang.g4;
        }
        $('#btn-open-alert').textContent = lang.alert;
        
        const modals = document.querySelectorAll('.modal');
        if(modals.length >= 2) {
            modals[0].querySelector('h3').textContent = lang.mAboutTitle;
            const pAbout = modals[0].querySelectorAll('p');
            pAbout[0].textContent = lang.mAboutP1;
            pAbout[1].innerHTML = lang.mAboutP2;
            modals[0].querySelector('button').textContent = lang.btnClose;

            modals[1].querySelector('h3').textContent = lang.mAlertTitle;
            modals[1].querySelector('p').textContent = lang.mAlertP;
            modals[1].querySelector('#btn-submit-alert').textContent = lang.btnReg;
            modals[1].querySelectorAll('button')[1].textContent = lang.btnCancel;
        }
        
        const alertGroup = $('#alert-group');
        if (alertGroup) {
            alertGroup.options[0].textContent = lang.g1;
            alertGroup.options[1].textContent = lang.g2;
            alertGroup.options[2].textContent = lang.g3;
            alertGroup.options[3].textContent = lang.g4;
        }

        M.map.closePopup();
        render();
        
    } catch (e) { console.warn("Lỗi render ngôn ngữ:", e); }
}

$('#btn-lang').onclick = e => {
    const btn = e.target;
    if (currentLang === 'vi') {
        currentLang = 'en';
        btn.textContent = '🇬🇧 EN';
    } else {
        currentLang = 'vi';
        btn.textContent = '🇻🇳 VN';
    }
    applyLanguage(); 
};

$('#btn-share').onclick = async () => {
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'AirHCM - Cảnh báo chất lượng không khí',
                text: `Chất lượng không khí tại TP.HCM đang ở mức ${$('#lv').textContent} (AQI: ${$('#aqi').textContent}).`,
                url: window.location.href
            });
        } catch (err) { console.warn('Hủy chia sẻ:', err); }
    } else {
        alert(currentLang === 'vi' ? 'Trình duyệt không hỗ trợ. Hãy copy link URL!' : 'Browser does not support sharing. Please copy URL!');
    }
};

$('#btn-export').onclick = () => {
    if (!state.feats || state.feats.length === 0) return;
    const rows = ['vi_do,kinh_do,pm25,aqi,muc', ...state.feats.map(x => {
        const p = x.properties.pm2_5, c = calc(p);
        return [x.geometry.coordinates[1], x.geometry.coordinates[0], p, c.aqi, `"${LV[c.lv].n}"`].join(',');
    })];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv' }));
    // Xuất file theo ngày
    a.download = `du_bao_PM25_+${state.d}ngay.csv`; 
    a.click();
};

const overlay = $('#overlay');
const toggleModal = (id, show) => {
    $(id).classList.toggle('hidden', !show);
    overlay.classList.toggle('hidden', !show);
};

$('#btn-about').onclick = () => toggleModal('#modal-about', true);
$('#btn-open-alert').onclick = () => toggleModal('#modal-alert', true);

document.querySelectorAll('.btn-close').forEach(btn => {
    btn.onclick = () => { toggleModal('#modal-about', false); toggleModal('#modal-alert', false); };
});

$('#btn-submit-alert').onclick = () => {
    const email = $('#alert-email').value;
    const groupSelect = $('#alert-group');
    const groupText = groupSelect ? groupSelect.options[groupSelect.selectedIndex].text : '';

    if(email && email.includes('@')) {
        const msg = currentLang === 'vi' 
            ? `Đăng ký thành công!\nHệ thống sẽ gửi cảnh báo sức khỏe dành cho nhóm [${groupText}] đến email: ${email}.` 
            : `Successfully registered!\nHealth alerts for [${groupText}] will be sent to: ${email}.`;
        
        alert(msg);
        toggleModal('#modal-alert', false);
    } else {
        alert(currentLang === 'vi' ? 'Vui lòng nhập một địa chỉ email hợp lệ.' : 'Please enter a valid email address.');
    }
};

$('#btn-search').onclick = async () => {
    const q = $('#search-input').value;
    if (!q) return;
    $('#btn-search').textContent = '⏳';
    try {
        const res = await ApiService.searchLocation(q);
        if (res && res.length > 0) {
            const lat = res[0].lat;
            const lon = res[0].lon;
            M.map.flyTo([lat, lon], 14, { duration: 1.5 });
            L.popup().setLatLng([lat, lon]).setContent(`<b>${currentLang === 'vi' ? 'Kết quả' : 'Result'}:</b> ${res[0].display_name}<br><i>Đang phân tích AI...</i>`).openOn(M.map);
            
            await triggerDSSPrediction(lat, lon);
        } else {
            alert(I18N[currentLang].notFound);
        }
    } catch (e) { console.error(e); }
    $('#btn-search').textContent = '🔍';
};
$('#search-input').onkeypress = (e) => { if(e.key === 'Enter') $('#btn-search').click(); };

let playInterval;
$('#btn-play').onclick = () => {
    const btn = $('#btn-play');
    const slider = $('#slider');
    if (playInterval) {
        clearInterval(playInterval); playInterval = null; btn.textContent = '▶';
    } else {
        btn.textContent = '⏸';
        // Đổi mức reset từ 72 (giờ) về 7 (ngày)
        if (slider.value >= 7) slider.value = 0;
        playInterval = setInterval(() => {
            slider.value = parseInt(slider.value) + 1;
            slider.dispatchEvent(new Event('input')); 
            // Dừng lặp khi chạm ngưỡng tối đa 7 ngày
            if (slider.value >= 7) { clearInterval(playInterval); playInterval = null; btn.textContent = '▶'; }
        }, 1200);
    }
};

$('#l-wind').onchange = e => {
    if(e.target.checked) alert(I18N[currentLang].windAlert);
};