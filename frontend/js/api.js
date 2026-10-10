// js/api.js
import { CONFIG } from './config.js';

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
        console.error(`[Lỗi API] ${endpoint}:`, error);
        throw error;
    }
}

export const ApiService = {
    // 1. WebGIS: Lấy ranh giới 166 phường xã & danh sách trạm
    getWardsGeoJSON: () => fetchClient('/gis/wards-geojson'),
    getStations: () => fetchClient('/gis/stations'),

    // 2. AQI thời gian thực & Bảng tổng hợp không gian 166 phường
    getCurrentAQI: () => fetchClient('/aqi/current'),
    getSpatialSummary: () => fetchClient('/aqi/spatial-summary'),

    // 3. AI & DSS
    getForecastHourly: (hours = 24) => fetchClient(`/forecast/hourly?hours=${hours}`),
    getDSSAdvisory: () => fetchClient('/dss/recommendations'),

    // 4. Admin Auth & ETL
    login: async (password) => {
        // Giả lập xác thực mật khẩu admin nhanh tại Client/Server
        if (password === 'admin123' || password === '123456') {
            return { token: 'auth_admin_token_hcmunre' };
        }
        throw new Error("Mật khẩu không đúng");
    },
    runETL: async () => {
        // Gọi API cập nhật dữ liệu tự động
        return await fetchClient('/aqi/current');
    }
};