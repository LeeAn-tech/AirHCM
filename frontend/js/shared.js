// js/shared.js
'use strict';
import { CONFIG } from './config.js';

export const $ = s => document.querySelector(s);
export const LV = CONFIG.AQI_LEVELS.map(l => ({ n: l.name, c: l.color, t: l.text }));
const BP = CONFIG.AQI_BREAKPOINTS;

export function calcAQI(pm) {
    if (pm === null || pm === undefined || isNaN(pm)) return { lv: 0, aqi: 0 };
    pm = Math.round(pm * 10) / 10;
    let i = BP.findIndex(b => pm <= b[1]);
    if (i < 0) i = 5;
    const [b0, b1, a0, a1] = BP[i];
    return { 
        lv: i, 
        aqi: Math.round(((a1 - a0) / (b1 - b0)) * (pm - b0) + a0) 
    };
}

export function showErr(err) {
    const el = $('#err')|| $('#gate-err');
    if (el) {
        el.hidden = false;
        el.textContent = `Lỗi hệ thống: ${err.message}`;
    }
    console.error(err);
}

export function initMap(elementId = 'map') {
    const map = L.map(elementId, { zoomControl: false }).setView(CONFIG.MAP_CENTER, 11);

    const darkMap = L.tileLayer(CONFIG.BASEMAPS.dark, { attribution: '© CartoDB & HCMUNRE', maxZoom: 18 });
    const osm = L.tileLayer(CONFIG.BASEMAPS.osm, { attribution: '© OpenStreetMap' });
    const satellite = L.tileLayer(CONFIG.BASEMAPS.satellite, { attribution: '© Esri' });

    darkMap.addTo(map);
    L.control.layers({ "Bản đồ Tối": darkMap, "Bản đồ Chuẩn": osm, "Vệ tinh": satellite }, null, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    return map;
}

export function drawForecastChart(canvas, forecastData) {
    const labels = forecastData.map(x => x.time.split(' ')[1]); // Hiển thị giờ: 05:00, 06:00...
    const pmValues = forecastData.map(x => x.pm2_5);
    const aqiValues = forecastData.map(x => x.aqi);

    return new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'PM2.5 Dự báo (µg/m³)',
                    data: pmValues,
                    borderColor: '#48cae4',
                    backgroundColor: 'rgba(72, 202, 228, 0.15)',
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true
                },
                {
                    label: 'Chỉ số US AQI',
                    data: aqiValues,
                    borderColor: '#ffb703',
                    borderWidth: 2,
                    borderDash: [5, 4],
                    tension: 0.35,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#cbd5e1', font: { size: 12 } } }
            },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}