// js/api.js
import { CONFIG, STN } from './config.js';

const getToken = () => sessionStorage.getItem('aq_token');

async function fetchClient(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const response = await fetch(`${CONFIG.API_URL}${endpoint}`, { ...options, headers });
        if (response.status === 401 && token) {
            sessionStorage.removeItem('aq_token');
            window.location.reload();
        }
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`[API Error] ${endpoint}:`, error);
        throw error;
    }
}

// KHÔI PHỤC DỮ LIỆU ẢO (MOCK DATA)
const Mock = {
    pm(lat, lng, h) {
        const hr = new Date(Date.now() + h * 36e5).getHours();
        const core = 18 * Math.exp(-((lat - 10.78) ** 2 + (lng - 106.68) ** 2) / 0.012);
        return Math.max(5, 34 + 9 * Math.sin((hr - 9) / 24 * 2 * Math.PI) + core + 3 * Math.sin(lat * 90 + lng * 70 + h / 5));
    },
    stations(h) {
        const ph = (new Date(Date.now() + h * 36e5).getHours() - 9) / 24 * 2 * Math.PI;
        return { type: 'FeatureCollection', features: STN.map(([c, ten, la, ln]) => {
            const pm = this.pm(la, ln, h);
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [ln, la] }, properties: {
                ma: 'NEW_' + c, ten, pm2_5: +pm.toFixed(1),
                temperature_2m: +(301.6 + 3.4 * Math.sin(ph) - (la - 10.78) * 1.5).toFixed(2),
                dewpoint_temperature_2m: +(296.4 + 0.6 * Math.sin(ph)).toFixed(2),
                absorbing_aerosol_index: +(pm / 80 - 0.15 + 0.1 * Math.sin(ln * 80 + la * 40)).toFixed(2) 
            } };
        }) };
    },
    series() {
        const mk = h => { const t = new Date(Date.now() + h * 36e5); t.setMinutes(0, 0, 0); return { t: t.toISOString(), pm25: +this.pm(10.8231, 106.6297, h).toFixed(1) }; };
        return { history: Array.from({ length: 25 }, (_, i) => mk(i - 24)), forecast: Array.from({ length: 72 }, (_, i) => mk(i + 1)) };
    },
    status: () => ({ etl_last_run: new Date().toISOString(), records: 48882, model: 'XGBoost (200 cây)', horizon: 'Dự báo 1 giờ, đệ quy tới 72h', mae: 2.36, rmse: 4.31, r2: 0.927 })
};

export const ApiService = {
    getStationsData: (daysAhead) => fetchClient(`/stations?days_ahead=${daysAhead}`),
    getTimeseriesData: (stationId = '1') => fetchClient(`/predict/${stationId}?days=7`),
    getAdminStatus: () => fetchClient('/admin/status'),
    runETL: () => fetchClient('/admin/etl', { method: 'POST' }),
    login: (password) => fetchClient('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
    getGeoJson: async (fileName) => {
        const res = await fetch(`/assets/data/${fileName}`);
        if (!res.ok) throw new Error(`Không tìm thấy file: ${fileName}`);
        return await res.json();
    },
    
    // Geocoding API (Dùng OpenStreetMap Nominatim hoàn toàn miễn phí)
    searchLocation: async (query) => {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Vietnam')}&limit=1`);
        return await res.json();
    },
    
    // Mock API quản lý Users cho Admin (Thêm field group)
    getSubscribedUsers: async () => {
        return [
            { id: 1, email: 'hoangan.hcmunre@gmail.com', group: 'Bệnh hô hấp', status: 'Active' },
            { id: 2, email: 'nguyenvana@gmail.com', group: 'Người bình thường', status: 'Active' },
            { id: 3, email: 'admin.phuong@hcm.gov.vn', group: 'Người cao tuổi', status: 'Pending' }
        ];
    },
    
    // Gọi API dự báo từ AI & Engine DSS 
    getPredictionAndAlert: async (lat, lon, group, days) => {
        // Đồng bộ hóa với hàm fetchClient để dùng đúng biến CONFIG.API_URL
        return fetchClient('/predict-and-alert', {
            method: 'POST',
            body: JSON.stringify({ 
                lat: lat, 
                lon: lon, 
                user_group: group, 
                days_ahead: days 
            })
        });
    }
};