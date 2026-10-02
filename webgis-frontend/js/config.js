// js/config.js
export const CONFIG = {
    API_URL: 'http://localhost:8000/api',
    USE_MOCK: false, 
    MAP_CENTER: [10.38, 106.68], // Kéo tâm bản đồ xích xuống phía Nam một chút
    MAP_BOUNDS: [[8.50, 106.00], [11.50, 107.80]], // Mở rộng ranh giới để thấy Côn Đảo
    QCVN_PM25_LIMIT: 50,
    
    BASEMAPS: {
        dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    },

    AQI_BREAKPOINTS: [
        [0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
        [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 400]
    ],
    
    AQI_LEVELS: [
        { name: 'Tốt', color: '#00e400', text: '#0b3d0b' },
        { name: 'Trung bình', color: '#ffff00', text: '#333333' },
        { name: 'Kém (nhóm nhạy cảm)', color: '#ff7e00', text: '#ffffff' },
        { name: 'Xấu', color: '#ff0000', text: '#ffffff' },
        { name: 'Rất xấu', color: '#8f3f97', text: '#ffffff' },
        { name: 'Nguy hại', color: '#7e0023', text: '#ffffff' }
    ]
};

export const STN = [
    // TP.HCM
    ['Q01','Quận 1',10.7769,106.7009],['Q03','Quận 3',10.7843,106.6844],['Q05','Quận 5',10.7540,106.6634],
    ['Q07','Quận 7',10.7340,106.7215],['TDU','TP. Thủ Đức',10.8494,106.7537],['CGI','Cần Giờ',10.4114,106.9544],
    ['CCH','Củ Chi',10.9733,106.4933],['NBE','Nhà Bè',10.6953,106.7370],
    // Bình Dương
    ['TDM','Thủ Dầu Một',10.9806,106.6745],['DIA','Dĩ An',10.9272,106.7725],['TAN','Thuận An',10.9238,106.6974],
    ['BCT','Bến Cát',11.1378,106.6053],['TUV','Tân Uyên',11.0315,106.8115],['BBA','Bàu Bàng',11.2612,106.6152],
    // Bà Rịa - Vũng Tàu & Côn Đảo
    ['VTA','Vũng Tàu',10.3789,107.0984],['BRA','Bà Rịa',10.5055,107.1685],['PMY','Phú Mỹ',10.5898,107.0505],
    ['CDU','Châu Đức',10.6545,107.2435],['XMO','Xuyên Mộc',10.6279,107.4527],['CDA','Côn Đảo',8.6833,106.6000]
];