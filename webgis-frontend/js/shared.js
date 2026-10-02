'use strict';

import { CONFIG } from './config.js';

export const $ = s => document.querySelector(s);
export const LV = CONFIG.AQI_LEVELS.map(l => ({ n: l.name, c: l.color, t: l.text }));
const BP = CONFIG.AQI_BREAKPOINTS;

export function calc(pm) {
    pm = Math.round(pm * 10) / 10;
    let i = BP.findIndex(b => pm <= b[1]); if (i < 0) i = 5;
    const [b0, b1, a0, a1] = BP[i];
    return { lv: i, aqi: Math.round((a1 - a0) / (b1 - b0) * (pm - b0) + a0) };
}

export const timeLabel = d => d === 0 ? 'Hôm nay' : `+${d} ngày · ${new Date(Date.now() + d * 864e5).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
const K2C = k => k - 273.15;
const rhEst = (tk, dk) => { 
    const t = K2C(tk), d = K2C(dk); 
    return Math.min(100, 100 * Math.exp(17.625 * d / (243.04 + d)) / Math.exp(17.625 * t / (243.04 + t))); 
};

export function showErr(err) {
    const el = $('#err'); 
    if(el) { el.hidden = false; el.textContent = `Lỗi hệ thống: ${err.message}`; }
    console.error(err);
}

function popupHtml(p) {
    const { lv, aqi } = calc(p.pm2_5), L_ = LV[lv];
    return `<div class="pop"><div class="pop-h"><div><b>${p.ten}</b><small>Trạm ${p.ma}</small></div>
        <span class="badge" style="background:${L_.c};color:${L_.t}">AQI ${aqi}</span></div>
        <div class="pop-l">${L_.n}</div>
        <div class="pop-g">
            <div title="pm2_5"><span>🌫 PM2.5</span><b>${p.pm2_5.toFixed(1)}</b><small>µg/m³</small></div>
            <div title="temperature_2m"><span>🌡️ Nhiệt độ</span><b>${K2C(p.temperature_2m).toFixed(1)}</b><small>°C</small></div>
            <div title="dewpoint_temperature_2m"><span>💧 Điểm sương</span><b>${K2C(p.dewpoint_temperature_2m).toFixed(1)}</b><small>°C · ẩm ~${rhEst(p.temperature_2m, p.dewpoint_temperature_2m).toFixed(0)}%</small></div>
            <div title="absorbing_aerosol_index"><span>🛰️ Aerosol hấp thụ</span><b>${p.absorbing_aerosol_index.toFixed(2)}</b><small>UVAI</small></div>
        </div></div>`;
}

export function initMap() {
    const map = L.map('map', { minZoom: 8 }).setView(CONFIG.MAP_CENTER, 10);
    
    const osm = L.tileLayer(CONFIG.BASEMAPS.osm, { attribution: '© OSM' });
    const darkMap = L.tileLayer(CONFIG.BASEMAPS.dark, { attribution: '© Esri' });
    const satellite = L.tileLayer(CONFIG.BASEMAPS.satellite, { attribution: '© Esri' });

    darkMap.addTo(map);
    L.control.layers({ "Bản đồ tối (Dark)": darkMap, "Tiêu chuẩn (OSM)": osm, "Vệ tinh (Satellite)": satellite }, null, {position: 'topleft'}).addTo(map);

    const fit = () => map.fitBounds(CONFIG.MAP_BOUNDS, { paddingTopLeft: [10, 20], paddingBottomRight: innerWidth > 900 ? [450, 260] : [10, 10] });
    let first = true;
    new ResizeObserver(() => { map.invalidateSize(); if (first) { first = false; fit(); } }).observe(document.getElementById('map'));
    window.addEventListener('load', () => { map.invalidateSize(); fit(); });
    
    const heat = L.heatLayer([], { radius: 50, blur: 40, maxZoom: 12, gradient: { .1: '#00e400', .25: '#ffff00', .4: '#ff7e00', .6: '#ff0000', .8: '#8f3f97', 1: '#7e0023' } }).addTo(map);
    const pts = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 12 }).addTo(map);
    const districts = L.layerGroup().addTo(map);

    $('#legend').innerHTML = LV.map((l, i) => `<div><i style="background:${l.c}"></i>${l.n} <small>(${BP[i][2]}–${BP[i][3]})</small></div>`).join('');
    
    $('#l-heat').onchange = e => e.target.checked ? heat.addTo(map) : map.removeLayer(heat);
    $('#l-pts').onchange = e => e.target.checked ? pts.addTo(map) : map.removeLayer(pts);
    const distCheckbox = $('#l-dist');
    if(distCheckbox) distCheckbox.onchange = e => e.target.checked ? districts.addTo(map) : map.removeLayer(districts);

    return { map, heat, pts, districts, fit, byId: {}, onPick: null };
}

export function paintMap(M, feats) {
    M.heat.setLatLngs(feats.map(x => [x.geometry.coordinates[1], x.geometry.coordinates[0], Math.min(x.properties.pm2_5 / 150, 1)]));
    M.pts.clearLayers(); M.byId = {}; const markers = [];

    feats.forEach(x => {
        const p = x.properties, { lv, aqi } = calc(p.pm2_5), ll = [x.geometry.coordinates[1], x.geometry.coordinates[0]];
        const L_ = LV[lv];
        const icon = L.divIcon({ className: 'stn', html: `<span style="background:${L_.c};color:${L_.t}">${aqi}</span>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
        const m = L.marker(ll, { icon }).bindPopup(popupHtml(p), { minWidth: 260, maxWidth: 280 }).bindTooltip(p.ten, { direction: 'top', offset: [0, -16] });
        m.on('click', () => M.onPick && M.onPick(p.ma));
        M.byId[p.ma] = m; markers.push(m);
    });
    M.pts.addLayers(markers);
}

export function focusStation(M, ma) {
    const m = M.byId[ma]; if (!m) return;
    M.map.flyTo(m.getLatLng(), 13, { duration: .8 });
    M.map.once('moveend', () => m.openPopup());
}

export function drawChart(canvas, s, getD) {
    const all = [...s.history, ...s.forecast], n = s.history.length;
    const lab = all.map(x => {
        const d = new Date(x.t);
        // Hiển thị ngày/tháng thay vì giờ:phút
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    return new Chart(canvas, {
        type: 'line',
        data: { labels: lab, datasets: [
            { label: 'Thực đo', data: all.map((x, i) => i < n ? x.pm25 : null), borderColor: '#2563eb', pointRadius: 0, tension: .3 },
            { label: 'AI dự báo', data: all.map((x, i) => i >= n - 1 ? x.pm25 : null), borderColor: '#dc2626', borderDash: [6, 4], tension: .3, pointRadius: c => c.dataIndex === n - 1 + getD() ? 6 : 0, pointBackgroundColor: '#dc2626' },
            { label: `Ngưỡng ${CONFIG.QCVN_PM25_LIMIT} µg/m³`, data: all.map(() => CONFIG.QCVN_PM25_LIMIT), borderColor: '#f59e0b', borderWidth: 1, pointRadius: 0 }
        ] },
        options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'PM2.5 (µg/m³)' } } } }
    });
}