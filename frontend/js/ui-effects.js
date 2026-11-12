// ==============================================================================
// AIRHCM - UI EFFECTS (DÙNG CHUNG CHO TRANG NGƯỜI DÙNG & TRANG QUẢN TRỊ)
// Hiệu ứng giao diện: preloader, ripple, spotlight, đếm số, thanh chỉ báo điều hướng,
// thanh trượt tô màu, chọn bản đồ nền, đóng modal bằng Esc / click nền.
// File này chỉ thêm hiệu ứng - không thay đổi logic nghiệp vụ của app.js / admin.js
// ==============================================================================
(function () {
    "use strict";

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --------------------------------------------------------------------------
    // 1. PRELOADER - ẨN MÀN HÌNH CHỜ KHI GIAO DIỆN SẴN SÀNG
    // --------------------------------------------------------------------------
    function hidePreloader() {
        const loader = document.getElementById("app-preloader");
        if (!loader || loader.classList.contains("hide")) return;
        loader.classList.add("hide");
        setTimeout(() => loader.remove(), 700);
    }
    document.addEventListener("DOMContentLoaded", () => setTimeout(hidePreloader, reduceMotion ? 0 : 650));
    setTimeout(hidePreloader, 4000); // An toàn: luôn ẩn sau 4 giây kể cả khi CDN chậm

    // --------------------------------------------------------------------------
    // 2. HIỆU ỨNG GỢN SÓNG (RIPPLE) KHI BẤM NÚT
    // --------------------------------------------------------------------------
    const RIPPLE_TARGETS = [
        ".btn", ".btn-std", ".btn-forecast", ".btn-news-filter", ".btn-gps", ".basemap-chip",
        ".btn-social", ".adm-tab-btn", ".btn-circle-play", ".btn-etl-trigger", ".btn-buf",
        ".btn-tool-pick", ".btn-act"
    ].join(",");

    document.addEventListener("pointerdown", e => {
        if (reduceMotion || e.button !== 0) return;
        const target = e.target.closest(RIPPLE_TARGETS);
        if (!target || target.disabled) return;
        const rect = target.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2.2;
        const ink = document.createElement("span");
        ink.className = "ripple-ink";
        ink.style.width = ink.style.height = `${size}px`;
        ink.style.left = `${e.clientX - rect.left - size / 2}px`;
        ink.style.top = `${e.clientY - rect.top - size / 2}px`;
        target.appendChild(ink);
        setTimeout(() => ink.remove(), 700);
    }, { passive: true });

    // --------------------------------------------------------------------------
    // 3. HIỆU ỨNG ÁNH SÁNG THEO CON TRỎ (SPOTLIGHT) TRÊN THẺ
    // --------------------------------------------------------------------------
    document.addEventListener("pointermove", e => {
        const card = e.target.closest && e.target.closest(".spotlight");
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });

    // --------------------------------------------------------------------------
    // 4. HIỆU ỨNG ĐẾM SỐ (COUNT-UP) CHO CÁC PHẦN TỬ [data-countup]
    //    Khi app.js / admin.js ghi số mới, con số sẽ chạy mượt từ giá trị cũ -> mới
    // --------------------------------------------------------------------------
    const NUM_RE = /-?\d+(?:\.\d+)?/;

    function popOnce(el) {
        el.classList.remove("num-pop");
        void el.offsetWidth; // reset animation
        el.classList.add("num-pop");
    }

    function setupCountUp(el) {
        let busy = false;
        let last = el.textContent;
        let written = "";

        const obs = new MutationObserver(() => {
            if (busy) return;
            const next = el.textContent;
            const mNext = next.match(NUM_RE);
            const mPrev = last.match(NUM_RE);
            last = next;
            if (!mNext) return;
            if (reduceMotion) { popOnce(el); return; }

            const to = parseFloat(mNext[0]);
            const from = mPrev ? parseFloat(mPrev[0]) : 0;
            popOnce(el);
            if (from === to) return;

            const decimals = (mNext[0].split(".")[1] || "").length;
            const start = performance.now();
            const duration = 700;
            busy = true;

            function frame(now) {
                // Nếu mã nghiệp vụ ghi giá trị khác trong lúc đang chạy -> dừng, giữ giá trị thật
                if (written && el.textContent !== written) {
                    busy = false;
                    obs.takeRecords();
                    last = el.textContent;
                    written = "";
                    return;
                }
                const p = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - p, 3);
                const value = from + (to - from) * eased;
                written = p < 1 ? next.replace(NUM_RE, value.toFixed(decimals)) : next;
                el.textContent = written;
                if (p < 1) {
                    requestAnimationFrame(frame);
                } else {
                    obs.takeRecords();
                    busy = false;
                    written = "";
                    last = next;
                }
            }
            requestAnimationFrame(frame);
        });
        obs.observe(el, { childList: true, characterData: true, subtree: true });
    }

    // --------------------------------------------------------------------------
    // 5. THANH CHỈ BÁO TRƯỢT (SLIDING INDICATOR) CHO MENU ĐIỀU HƯỚNG
    // --------------------------------------------------------------------------
    function bindIndicator(host, itemSelector) {
        if (!host) return;
        let indicator = host.querySelector(".nav-indicator");
        if (!indicator) {
            indicator = document.createElement(host.tagName === "UL" ? "li" : "span");
            indicator.className = "nav-indicator";
            indicator.setAttribute("aria-hidden", "true");
            host.prepend(indicator);
        }
        host.classList.add("has-indicator");

        function move() {
            const active = host.querySelector(`${itemSelector}.active`);
            if (!active || !active.offsetWidth) { indicator.style.opacity = "0"; return; }
            indicator.style.opacity = "1";
            indicator.style.width = `${active.offsetWidth}px`;
            indicator.style.height = `${active.offsetHeight}px`;
            indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        }

        new MutationObserver(move).observe(host, { subtree: true, attributes: true, attributeFilter: ["class"] });
        window.addEventListener("resize", move);
        // Lần đầu: đặt vị trí không có hiệu ứng trượt
        indicator.style.transition = "none";
        move();
        requestAnimationFrame(() => requestAnimationFrame(() => { indicator.style.transition = ""; }));
    }

    // --------------------------------------------------------------------------
    // 6. THANH TRƯỢT (RANGE) TÔ MÀU PHẦN ĐÃ CHỌN
    // --------------------------------------------------------------------------
    window.syncRangeFill = function (el) {
        if (!el) return;
        const min = parseFloat(el.min) || 0;
        const max = parseFloat(el.max) || 100;
        const val = parseFloat(el.value) || 0;
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        el.style.setProperty("--fill", `${pct}%`);
    };
    document.addEventListener("input", e => {
        if (e.target && e.target.matches && e.target.matches('input[type="range"]')) window.syncRangeFill(e.target);
    });

    // --------------------------------------------------------------------------
    // 7. ĐỒNG HỒ THỜI GIAN THỰC CHO [data-live-clock]
    // --------------------------------------------------------------------------
    function startLiveClocks() {
        const clocks = document.querySelectorAll("[data-live-clock]");
        if (!clocks.length) return;
        const tick = () => {
            const now = new Date();
            const pad = n => String(n).padStart(2, "0");
            const text = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} · ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
            clocks.forEach(c => { c.textContent = text; });
        };
        tick();
        setInterval(tick, 1000);
    }

    // --------------------------------------------------------------------------
    // 8. KHỞI TẠO SAU KHI DOM SẴN SÀNG
    // --------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
        // 8.1 Đếm số
        document.querySelectorAll("[data-countup]").forEach(setupCountUp);

        // 8.2 Thanh chỉ báo menu (trang người dùng + trang quản trị)
        bindIndicator(document.querySelector(".nav-links"), ".nav-item");
        bindIndicator(document.querySelector(".adm-nav"), ".adm-tab-btn");

        // 8.3 Thanh trượt
        document.querySelectorAll('input[type="range"]').forEach(window.syncRangeFill);

        // 8.4 Nút chọn bản đồ nền dạng thẻ ảnh -> đồng bộ với <select> gốc
        document.querySelectorAll("[data-basemap-for]").forEach(group => {
            const select = document.getElementById(group.dataset.basemapFor);
            if (!select) return;
            const chips = group.querySelectorAll("[data-basemap]");
            const syncChips = () => chips.forEach(c => c.classList.toggle("active", c.dataset.basemap === select.value));
            chips.forEach(chip => chip.addEventListener("click", () => {
                if (select.value === chip.dataset.basemap) return;
                select.value = chip.dataset.basemap;
                select.dispatchEvent(new Event("change", { bubbles: true }));
                syncChips();
            }));
            select.addEventListener("change", syncChips);
            syncChips();
        });

        // 8.5 Nút bật/tắt class cho panel (thu gọn panel trạm, mở bảng lớp trên di động)
        document.querySelectorAll("[data-toggle-target]").forEach(btn => {
            btn.addEventListener("click", e => {
                e.preventDefault();
                e.stopPropagation();
                const target = document.getElementById(btn.dataset.toggleTarget);
                if (!target) return;
                const cls = btn.dataset.toggleClass || "open";
                const on = target.classList.toggle(cls);
                btn.classList.toggle("is-on", on);
                btn.setAttribute("aria-expanded", String(on));
            });
        });

        // 8.6 Tiêu đề trang Admin tự đổi theo tab đang mở
        const pageTitle = document.getElementById("adm-page-title");
        const pageSub = document.getElementById("adm-page-sub");
        const admNav = document.querySelector(".adm-nav");
        if (pageTitle && admNav) {
            const syncTitle = () => {
                const active = admNav.querySelector(".adm-tab-btn.active");
                if (!active) return;
                pageTitle.textContent = active.dataset.title || active.textContent.trim();
                if (pageSub && active.dataset.sub) pageSub.textContent = active.dataset.sub;
            };
            new MutationObserver(syncTitle).observe(admNav, { subtree: true, attributes: true, attributeFilter: ["class"] });
            syncTitle();
        }

        // 8.7 Đóng modal bằng phím Esc hoặc click ra vùng nền mờ
        document.querySelectorAll(".modal-overlay").forEach(overlay => {
            overlay.addEventListener("mousedown", e => {
                if (e.target !== overlay) return;
                const closeBtn = overlay.querySelector(".btn-modal-close");
                if (closeBtn) closeBtn.click(); else overlay.classList.remove("active");
            });
        });
        document.addEventListener("keydown", e => {
            if (e.key !== "Escape") return;
            const open = Array.from(document.querySelectorAll(".modal-overlay.active")).pop();
            if (!open) return;
            const closeBtn = open.querySelector(".btn-modal-close");
            if (closeBtn) closeBtn.click(); else open.classList.remove("active");
        });

        // 8.8 Đồng hồ
        startLiveClocks();
    });
})();
