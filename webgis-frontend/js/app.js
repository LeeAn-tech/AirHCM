'use strict';
/* ========== CẤU HÌNH ========== */
const CFG = { API: 'http://localhost:8000/api', USE_MOCK: false, CENTER: [10.78, 106.68], ZOOM: 11, QCVN: 50 };

/* US AQI (bảng EPA cập nhật 2024) – phải trùng với logic ở backend */
const BP = [[0,9,0,50],[9.1,35.4,51,100],[35.5,55.4,101,150],[55.5,125.4,151,200],[125.5,225.4,201,300],[225.5,325.4,301,400]];
const LV = [
  { n: 'Tốt', c: '#00e400', t: '#0b3d0b' }, { n: 'Trung bình', c: '#ffff00', t: '#333' },
  { n: 'Kém (nhóm nhạy cảm)', c: '#ff7e00', t: '#fff' }, { n: 'Xấu', c: '#ff0000', t: '#fff' },
  { n: 'Rất xấu', c: '#8f3f97', t: '#fff' }, { n: 'Nguy hại', c: '#7e0023', t: '#fff' }
];
/* Thông điệp DSS tạm (khi có backend: lấy từ /api/dss thay cho bảng này) */
const GEN = ['Không khí tốt, thoải mái hoạt động ngoài trời.', 'Chấp nhận được. Người rất nhạy cảm nên hạn chế vận động mạnh kéo dài.',
  'Giảm hoạt động mạnh ngoài trời; cân nhắc đeo khẩu trang.', 'Hạn chế ra ngoài, đeo khẩu trang N95/KN95, đóng cửa sổ.',
  'Ở trong nhà, dùng máy lọc không khí nếu có; tránh hoạt động ngoài trời.', 'Khẩn cấp: ở trong nhà, đóng kín cửa, theo dõi thông báo cơ quan chức năng.'];
const SENS = ['Theo dõi bình thường.', 'Người có bệnh nền nên theo dõi triệu chứng và mang theo thuốc.',
  'Tránh hoạt động ngoài trời; nên ở nơi có không khí sạch.', 'Ở trong nhà, hoãn mọi hoạt động ngoài trời; liên hệ y tế nếu khó thở.',
  'Ở trong nhà, đóng kín cửa; liên hệ y tế ngay khi có triệu chứng.', 'Ở trong nhà, hạn chế tối đa vận động; sẵn sàng liên hệ cơ sở y tế.'];
const MACRO = ['Duy trì giám sát định kỳ.', 'Duy trì giám sát định kỳ.', 'Tăng tần suất giám sát tại các điểm nóng.',
  'Điều tiết giao thông khu vực điểm nóng, tăng rửa đường.', 'Kiểm tra nguồn thải công nghiệp/công trường; cân nhắc hạn chế xe tải giờ cao điểm.',
  'Kích hoạt kịch bản khẩn cấp; phối hợp ngành y tế và giáo dục.'];

function calc(pm) {
  pm = Math.round(pm * 10) / 10;
  let i = BP.findIndex(b => pm <= b[1]); if (i < 0) i = 5;
  const [b0, b1, a0, a1] = BP[i];
  return { lv: i, aqi: Math.round((a1 - a0) / (b1 - b0) * (pm - b0) + a0) };
}

/* ========== DỮ LIỆU: API thật ========== */
const api = p => fetch(CFG.API + p).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
const getHeat = h => CFG.USE_MOCK ? Promise.resolve(Mock.heatmap(h)) : api(`/heatmap?hours_ahead=${h}`);
const getSeries = () => CFG.USE_MOCK ? Promise.resolve(Mock.series()) : api('/predict/1?hours=72');

/* ========== BẢN ĐỒ ========== */
const $ = s => document.querySelector(s);
const state = { h: 0, group: 'general', feats: [], series: null };
const map = L.map('map').setView(CFG.CENTER, CFG.ZOOM);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
window.addEventListener('load', () => { map.invalidateSize(); map.setView(CFG.CENTER, CFG.ZOOM); });
const heat = L.heatLayer([], { radius: 48, blur: 36, maxZoom: 13, gradient: { .1: '#00e400', .25: '#ffff00', .4: '#ff7e00', .6: '#ff0000', .8: '#8f3f97', 1: '#7e0023' } }).addTo(map);
const pts = L.layerGroup().addTo(map);
$('#legend').innerHTML = LV.map((l, i) => `<div><i style="background:${l.c}"></i>${l.n} <small>(${BP[i][2]}–${BP[i][3]})</small></div>`).join('');
$('#l-heat').onchange = e => e.target.checked ? heat.addTo(map) : map.removeLayer(heat);
$('#l-pts').onchange = e => e.target.checked ? pts.addTo(map) : map.removeLayer(pts);

/* ========== BIỂU ĐỒ 24h quá khứ + 72h dự báo ========== */
let chart;
function drawChart(s) {
  const all = [...s.history, ...s.forecast], n = s.history.length;
  const lab = all.map(x => new Date(x.t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' }));
  chart = new Chart($('#chart'), {
    type: 'line',
    data: { labels: lab, datasets: [
      { label: 'Thực đo', data: all.map((x, i) => i < n ? x.pm25 : null), borderColor: '#2563eb', pointRadius: 0, tension: .3 },
      { label: 'AI dự báo', data: all.map((x, i) => i >= n - 1 ? x.pm25 : null), borderColor: '#dc2626', borderDash: [6, 4], tension: .3,
        pointRadius: c => c.dataIndex === n - 1 + state.h ? 6 : 0, pointBackgroundColor: '#dc2626' },
      { label: `Ngưỡng ${CFG.QCVN} µg/m³ (QCVN 05:2023)`, data: all.map(() => CFG.QCVN), borderColor: '#f59e0b', borderWidth: 1, pointRadius: 0 }
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'PM2.5 (µg/m³)' } } } }
  });
}

/* ========== RENDER ========== */
function render() {
  const f = state.feats;
  heat.setLatLngs(f.map(x => [x.geometry.coordinates[1], x.geometry.coordinates[0], Math.min(x.properties.pm25 / 150, 1)]));
  pts.clearLayers();
  f.forEach(x => {
    const p = x.properties.pm25, { lv, aqi } = calc(p);
    L.circleMarker([x.geometry.coordinates[1], x.geometry.coordinates[0]], { radius: 5, color: '#fff', weight: 1, fillColor: LV[lv].c, fillOpacity: .95 })
      .bindTooltip(`PM2.5 ${p} µg/m³ · AQI ${aqi} · ${LV[lv].n}`).addTo(pts);
  });
  const avg = f.reduce((s, x) => s + x.properties.pm25, 0) / f.length, { lv, aqi } = calc(avg);
  const card = $('#aqi-card'); card.style.background = LV[lv].c; card.style.color = LV[lv].t;
  $('#lv').textContent = LV[lv].n; $('#aqi').textContent = aqi; $('#pm').textContent = avg.toFixed(1);
  $('#advice').innerHTML = `<b>${state.group === 'general' ? 'Khuyến cáo chung' : 'Khuyến cáo cho nhóm nhạy cảm'}:</b> ` +
    (state.group === 'general' ? GEN[lv] : SENS[lv] + ' ' + GEN[lv]);
  const top = [...f].sort((a, b) => b.properties.pm25 - a.properties.pm25).slice(0, 5);
  $('#hot').innerHTML = top.map((x, i) => `<li data-i="${i}">Điểm ${x.geometry.coordinates[1].toFixed(2)}, ${x.geometry.coordinates[0].toFixed(2)} – <b>${x.properties.pm25}</b> µg/m³</li>`).join('');
  $('#hot').querySelectorAll('li').forEach((li, i) => li.onclick = () => map.flyTo([top[i].geometry.coordinates[1], top[i].geometry.coordinates[0]], 14));
  $('#macro').innerHTML = `<b>Gợi ý ứng phó:</b> ${MACRO[calc(top[0].properties.pm25).lv]}`;
  const t = new Date(Date.now() + state.h * 36e5);
  $('#t-label').textContent = state.h === 0 ? 'Hiện tại' : `+${state.h}h · ${t.toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
  if (chart) chart.update('none');
}

/* ========== SỰ KIỆN ========== */
let timer;
$('#slider').oninput = e => {
  state.h = +e.target.value; clearTimeout(timer);
  timer = setTimeout(() => getHeat(state.h).then(d => { state.feats = d.features; render(); }).catch(showErr), 120);
};
$('#chips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.group = b.dataset.g;
  document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
  render();
};
$('#admin').onchange = e => { $('#admin-box').hidden = !e.target.checked; };
function showErr(err) {
  const el = $('#err'); el.hidden = false;
  el.textContent = `Lỗi hệ thống (${err.message}). Vui lòng đảm bảo FastAPI backend đang được khởi chạy.`;
}

/* ========== KHỞI TẠO ========== */
Promise.all([getHeat(0), getSeries()]).then(([h, s]) => {
  state.feats = h.features; state.series = s; drawChart(s); render();
}).catch(showErr);