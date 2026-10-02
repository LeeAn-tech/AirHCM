'use strict';

import { CONFIG } from './config.js';
import { ApiService } from './api.js';
import { $, LV, calc, timeLabel, initMap, paintMap, drawChart, showErr } from './shared.js';

const M = initMap();
// Đổi biến state.h thành state.d
const state = { d: 0, feats: [] };
let chart, topList = [];

// XỬ LÝ ĐĂNG NHẬP
$('#login').onsubmit = e => {
    e.preventDefault();
    const pw = $('#pw').value;
    $('#gate-err').textContent = 'Đang xác thực...';
    
    ApiService.login(pw).then(r => { sessionStorage.setItem('aq_token', r.token); boot(); })
    .catch(() => { $('#gate-err').textContent = 'Sai mật khẩu hoặc API lỗi.'; });
};

$('#logout').onclick = () => { sessionStorage.removeItem('aq_token'); location.reload(); };

function boot() {
    $('#gate').style.display = 'none';
    
    Promise.all([
        ApiService.getStationsData(0), 
        ApiService.getTimeseriesData(), 
        ApiService.getAdminStatus(),
        ApiService.getSubscribedUsers()
    ]).then(([h, s, st, users]) => {
        state.feats = h.features; 
        chart = drawChart($('#chart'), s, () => state.d); 
        renderStatus(st); 
        renderUsers(users);
        render();
    }).catch(showErr);
}

// HIỂN THỊ
function render() {
    const f = state.feats; if(!f || f.length === 0) return;
    paintMap(M, f);
    
    const v = f.map(x => x.properties.pm2_5), avg = v.reduce((a, b) => a + b, 0) / v.length;
    $('#kpis').innerHTML = [
        ['PM2.5 trung bình', avg.toFixed(1) + ' µg/m³'], 
        ['Đỉnh ô nhiễm', Math.max(...v).toFixed(1) + ' µg/m³'],
        [`Vượt QCVN (>${CONFIG.QCVN_PM25_LIMIT})`, `${v.filter(p => p > CONFIG.QCVN_PM25_LIMIT).length} trạm`], 
        ['AQI Kém trở lên', `${v.filter(p => calc(p).aqi > 100).length} trạm`]
    ].map(([a, b]) => `<div style="flex:1; background:#f1f5f9; padding:12px; border-radius:8px;">
        <div style="font-size:12px; color:var(--mute)">${a}</div>
        <b style="font-size:20px; color:var(--brand)">${b}</b></div>`).join('');

    topList = [...f].sort((a, b) => b.properties.pm2_5 - a.properties.pm2_5).slice(0, 10);
    $('#hot').innerHTML = `<thead><tr><th>Trạm</th><th>Khu vực</th><th>PM2.5</th><th>AQI</th></tr></thead><tbody>` + 
    topList.map((x, i) => {
        const p = x.properties, c = calc(p.pm2_5);
        return `<tr style="cursor:pointer" data-id="${p.ma}">
            <td><b>#${i+1}</b> ${p.ma.replace('NEW_','')}</td>
            <td>${p.ten}</td>
            <td>${p.pm2_5.toFixed(1)}</td>
            <td><span class="dot" style="background:${LV[c.lv].c}"></span>${c.aqi}</td>
        </tr>`;
    }).join('') + `</tbody>`;
    
    $('#hot').querySelectorAll('tr[data-id]').forEach(tr => {
        tr.onclick = () => {
            const m = M.byId[tr.dataset.id];
            if(m) { M.map.flyTo(m.getLatLng(), 14); m.openPopup(); }
        }
    });
    
    $('#t-label').textContent = timeLabel(state.d);
    if (chart) chart.update('none');
}

function renderStatus(s) {
    $('#status').innerHTML = [
        ['Chạy ETL gần nhất', new Date(s.etl_last_run).toLocaleString('vi-VN')], 
        ['Tổng bản ghi CSDL', s.records.toLocaleString('vi-VN')],
        ['Thuật toán Model', s.model], 
        ['Độ trễ dự báo', s.horizon], 
        ['MAE / RMSE Model', `${s.mae} / ${s.rmse}`], 
        ['Chỉ số R²', s.r2]
    ].map(([a, b]) => `<dt style="color:var(--mute)">${a}</dt><dd style="font-weight:600; margin:0 0 4px 0">${b}</dd>`).join('');
}

function renderUsers(users) {
    $('#users-body').innerHTML = users.map(u => 
        `<tr>
            <td style="font-weight: 500;">${u.email}</td>
            <td><span style="background: var(--bg); padding: 4px 10px; border-radius: 6px; font-size: 11px; border: 1px solid var(--line); color: var(--mute); font-weight: 600;">${u.group}</span></td>
            <td><span style="color:${u.status==='Active'?'#10b981':'#f59e0b'}; font-weight: 600;">${u.status}</span></td>
            <td><button class="btn ghost" style="padding:4px 8px; font-size:11px;" onclick="alert('Tính năng xóa user đang xây dựng API')">Xóa</button></td>
        </tr>`
    ).join('');
}

// SỰ KIỆN SLIDER VÀ NÚT CHỨC NĂNG
let timer;
$('#slider').oninput = e => {
    state.d = +e.target.value; clearTimeout(timer);
    timer = setTimeout(() => ApiService.getStationsData(state.d).then(d => { state.feats = d.features; render(); }).catch(showErr), 120);
};

// UI Tương tác Tiến trình ETL gọi API Thật
$('#etl').onclick = async () => {
    const btn = $('#etl'); btn.disabled = true;
    const bar = $('#etl-bar'), log = $('#etl-log'), cont = $('#etl-container');
    cont.style.display = 'block'; log.style.display = 'block';
    
    bar.style.width = '50%';
    log.textContent = "Đang gửi tín hiệu chạy ETL Pipeline lên server...";
    
    try {
        await ApiService.runETL();
        bar.style.width = '100%';
        log.textContent = "Hoàn tất! Dữ liệu dự báo và model đã được cập nhật.";
        bar.style.background = "#10b981"; 
        
        setTimeout(() => {
            cont.style.display = 'none'; log.style.display = 'none';
            bar.style.width = '0%'; bar.style.background = 'var(--brand)';
            btn.disabled = false;
            // Reload dữ liệu thật
            ApiService.getStationsData(0).then(d => { state.feats = d.features; render(); });
        }, 3000);
    } catch (err) {
        bar.style.background = "#ef4444"; 
        log.textContent = "Lỗi ETL: " + err.message;
        setTimeout(() => {
            cont.style.display = 'none'; log.style.display = 'none';
            bar.style.width = '0%'; bar.style.background = 'var(--brand)';
            btn.disabled = false;
        }, 4000);
    }
};

$('#csv').onclick = () => {
    if(!state.feats.length) return;
    const rows = ['ma_tram,ten_tram,vi_do,kinh_do,pm25,aqi,muc_do', ...state.feats.map(x => {
        const p = x.properties, c = calc(p.pm2_5);
        return [p.ma, p.ten, x.geometry.coordinates[1], x.geometry.coordinates[0], p.pm2_5, c.aqi, `"${LV[c.lv].n}"`].join(',');
    })];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv' }));
    // Xuất file theo ngày
    a.download = `du_bao_PM25_+${state.d}ngay_export.csv`; a.click();
};

if (sessionStorage.getItem('aq_token')) boot();