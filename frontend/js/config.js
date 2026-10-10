// js/config.js
export const CONFIG = {
    API_URL: 'http://localhost:8000/api/v1',
    MAP_CENTER: [10.8231, 106.6297], 
    MAP_BOUNDS: [[10.35, 106.35], [11.15, 107.05]], 
    QCVN_PM25_LIMIT: 50, 

  BASEMAPS: {
        dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    },

    AQI_BREAKPOINTS: [
        [0, 12.0, 0, 50],
        [12.1, 35.4, 51, 100],
        [35.5, 55.4, 101, 150],
        [55.5, 150.4, 151, 200],
        [150.5, 250.4, 201, 300],
        [250.5, 500.4, 301, 500]
    ],

    AQI_LEVELS: [
        { name: 'Tốt', color: '#00e400', text: '#000000' },
        { name: 'Trung bình', color: '#ffff00', text: '#000000' },
        { name: 'Kém (nhạy cảm)', color: '#ff7e00', text: '#ffffff' },
        { name: 'Xấu', color: '#ff0000', text: '#ffffff' },
        { name: 'Rất xấu', color: '#8f3f97', text: '#ffffff' },
        { name: 'Nguy hại', color: '#7e0023', text: '#ffffff' }
    ]
};