// js/user.js
'use strict';
import { ApiService } from './api.js';
import { initMap, drawForecastChart, calcAQI, LV, showErr, $ } from './shared.js';

let map;
let chartInstance;
let allWards = [];

document.addEventListener("DOMContentLoaded", async () => {
    map = initMap('map');
    setupTabs();
    await loadCurrentData();
    await loadWardsMap();
    await loadForecastData(24);
    await loadHotspotsTable();
});

function setupTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

            item.classList.add('active');
            const target = item.getAttribute('data-tab');
            document.getElementById(target).classList.add('active');

            if (target === 'tab-map' && map) {
                setTimeout(() => map.invalidateSize(), 200);
            }
        });
    });
}

async function loadCurrentData() {
    try {
        const data = await ApiService.getCurrentAQI();
        $('#realtime-clock').textContent = data.timestamp;
        $('#current-aqi').textContent = data.us_aqi;
        $('#current-pm25').textContent = `${data.pm2_5} µg/m³`;
        $('#current-pm10').textContent = `${data.pm10} µg/m³`;
        $('#current-temp').textContent = `${data.temperature_2m} °C`;

        const badge = $('#current-aqi-level');
        badge.textContent = data.advisory.level;
        badge.style.backgroundColor = data.advisory.color;
        badge.style.color = data.us_aqi > 150 ? '#fff' : '#000';

        $('#aqi-indicator-circle').style.borderColor = data.advisory.color;
        $('#qcvn-tag').textContent = data.advisory.qcvn_comparison;

        // Cập nhật tab DSS Khuyến nghị
        const dssBadge = $('#dss-status-badge');
        dssBadge.textContent = data.advisory.level;
        dssBadge.style.backgroundColor = data.advisory.color;
        dssBadge.style.color = data.us_aqi > 150 ? '#fff' : '#000';

        $('#dss-general').textContent = data.advisory.general_population;
        $('#dss-sensitive').textContent = data.advisory.sensitive_groups;
        $('#dss-action').textContent = data.advisory.action_plan;
    } catch (e) {
        showErr(e);
    }
}

async function loadWardsMap() {
    try {
        // Nạp trạm quan trắc
        const stations = await ApiService.getStations();
        stations.forEach(st => {
            L.circleMarker([st.lat, st.lng], {
                radius: 11,
                fillColor: '#48cae4',
                color: '#ffffff',
                weight: 3,
                fillOpacity: 0.9
            }).addTo(map).bindPopup(`<b>${st.ten_tram}</b><br>Mã: ${st.ma_tram}`);
        });

        // Nạp ranh giới GeoJSON 166 phường
        const geojson = await ApiService.getWardsGeoJSON();
        L.geoJSON(geojson, {
            style: {
                color: '#48cae4',
                weight: 1,
                opacity: 0.4,
                fillColor: '#0077b6',
                fillOpacity: 0.2
            },
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindTooltip(`<b>${p.ten_phuong_xa}</b><br>Mã: ${p.ma_phuong_xa}`);
            }
        }).addTo(map);
    } catch (e) {
        console.warn("Chưa đồng bộ ranh giới GeoJSON:", e);
    }
}

window.loadForecast = async function(hours) {
    try {
        document.querySelectorAll('.forecast-controls .btn').forEach(b => b.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');

        const forecast = await ApiService.getForecastHourly(hours);
        const canvas = $('#forecastChart');
        if (chartInstance) chartInstance.destroy();
        chartInstance = drawForecastChart(canvas, forecast);
    } catch (e) {
        showErr(e);
    }
};

async function loadHotspotsTable() {
    try {
        allWards = await ApiService.getSpatialSummary();
        renderTable(allWards);
    } catch (e) {
        showErr(e);
    }
}

function renderTable(data) {
    const tbody = $('#hotspots-table-body');
    tbody.innerHTML = '';
    data.forEach((w, idx) => {
        const { lv, aqi } = calcAQI(w.pm2_5_trung_binh);
        const c = LV[lv];
        tbody.innerHTML += `
            <tr>
                <td>${idx + 1}</td>
                <td><b>${w.ma_phuong_xa}</b></td>
                <td>${w.ten_phuong_xa}</td>
                <td>${w.dien_tich_km2}</td>
                <td><span style="background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:4px;">${w.so_luong_tram}</span></td>
                <td style="color:#48cae4;font-weight:700;">${w.pm2_5_trung_binh} µg/m³</td>
                <td><b style="color:${c.c}">${w.aqi_trung_binh}</b></td>
                <td><span style="background:${c.c};color:${lv>2?'#fff':'#000'};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">${c.n}</span></td>
            </tr>
        `;
    });
}

window.filterWards = function() {
    const term = $('#search-ward').value.toLowerCase();
    const filtered = allWards.filter(w => w.ten_phuong_xa.toLowerCase().includes(term) || w.ma_phuong_xa.includes(term));
    renderTable(filtered);
};