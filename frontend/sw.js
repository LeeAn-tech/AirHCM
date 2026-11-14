// sw.js - Service Worker hỗ trợ vận hành PWA Offline/Cache cho AirHCM
// v3: Luôn kiểm tra bản mới với máy chủ cho file cùng nguồn (tránh hiển thị giao diện cũ sau khi cập nhật)
const CACHE_NAME = 'airhcm-cache-v14';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './admin.html',
    './assets/css/style.css',
    './js/ui-effects.js',
    './js/app.js',
    './js/admin.js',
    './js/ai-agent.js',
    './assets/data/hcm_wards.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

// Network First có xác thực lại (cache: 'no-cache'): máy chủ trả 304 nếu file không đổi,
// trả bản mới nếu đã cập nhật. Chỉ dùng bản lưu trong cache khi mất mạng.
// Các yêu cầu khác nguồn (API :8000, CDN, ô bản đồ) để trình duyệt tự xử lý.
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // API (cùng nguồn khi Backend phục vụ WebGIS) luôn lấy số liệu mới, không lưu cache
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }))
    );
});
