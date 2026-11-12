// ==============================================================================
// TRỢ LÝ AI AIRHCM (AI AGENT) TRÊN WEBGIS
// - Gọi POST /api/v1/dss/advice (dùng chung với app di động): Gemini + số liệu quan trắc,
//   dự báo AI 24h, cảnh báo DSS và RAG kho tri thức (QCVN 05:2023, WHO 2021, VN_AQI, Bộ Y tế...)
// - Tư vấn theo vị trí đang xem (địa điểm tìm kiếm / phường đang chọn / GPS) và đối tượng người dùng
// - Mỗi câu trả lời kèm trích dẫn nguồn [n]
// Phụ thuộc biến toàn cục của app.js: API_BASE, escapeHtml, currentPlace, myLocation, selectedWard*
// ==============================================================================
(function () {
    "use strict";

    const SUGGESTIONS = [
        "Hôm nay tôi chạy bộ lúc mấy giờ là tốt nhất?",
        "QCVN 05:2023 quy định PM2.5 bao nhiêu?",
        "Nên dùng khẩu trang loại nào để lọc bụi mịn?",
        "Con nhỏ có nên ra ngoài chơi hôm nay không?",
        "Vì sao sáng sớm và chiều tối bụi nhiều hơn?",
    ];
    const GROUP_KEY = "airhcm_ai_group";
    const MAX_HISTORY = 6;

    const state = {
        messages: [],          // {role: 'user'|'ai', text, sources?, meta?}
        clearedKey: null,      // người dùng bấm × để tư vấn chung cho lựa chọn có key này
        busy: false,
    };

    const $ = id => document.getElementById(id);
    const esc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

    // --------------------------------------------------------------------------
    // NGỮ CẢNH VỊ TRÍ: luôn là địa điểm người dùng chọn GẦN NHẤT trên bản đồ
    // (phường vừa bấm / địa điểm vừa tìm / GPS) - app.js ghi vào window.airhcmSelection.
    // Không "nhớ" vị trí cũ: chọn phường khác thì AI tư vấn phường mới.
    // --------------------------------------------------------------------------
    function activePlace() {
        const sel = window.airhcmSelection;
        if (sel && sel.lat != null) {
            return sel.key === state.clearedKey ? null : sel;
        }
        try {
            if (typeof myLocation !== "undefined" && myLocation && myLocation.lat != null) {
                const key = "me";
                return key === state.clearedKey ? null : { kind: "me", key, lat: myLocation.lat, lng: myLocation.lng, name: "Vị trí của bạn" };
            }
        } catch (e) { /* app.js chưa sẵn sàng */ }
        return null;
    }

    function currentSelectionKey() {
        const sel = window.airhcmSelection;
        if (sel && sel.lat != null) return sel.key;
        return (typeof myLocation !== "undefined" && myLocation) ? "me" : null;
    }

    function renderContext() {
        const place = activePlace();
        $("aic-location-name").textContent = place ? place.name : "Toàn TP. Hồ Chí Minh";
        $("aic-location-clear").hidden = !place;
    }

    // --------------------------------------------------------------------------
    // HIỂN THỊ MARKDOWN AN TOÀN (escape trước rồi mới định dạng) + TRÍCH DẪN [n]
    // --------------------------------------------------------------------------
    function renderMarkdown(text, sources) {
        const lines = esc(text || "").split(/\r?\n/);
        const html = [];
        let list = null;
        const inline = s => s
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
            .replace(/\[(\d{1,2})\]/g, (m, n) => {
                const src = (sources || []).find(s => String(s.ref) === n);
                return src ? `<sup class="aic-cite" title="${esc(src.title + " – " + src.section)}">[${n}]</sup>` : m;
            });
        const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
        for (const raw of lines) {
            const line = raw.trim();
            const bullet = line.match(/^[-*•]\s+(.*)$/);
            const numbered = line.match(/^\d+[.)]\s+(.*)$/);
            if (bullet || numbered) {
                const tag = bullet ? "ul" : "ol";
                if (list !== tag) { closeList(); html.push(`<${tag}>`); list = tag; }
                html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
            } else if (!line) {
                closeList();
            } else {
                closeList();
                const heading = line.match(/^#{1,4}\s+(.*)$/);
                html.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
            }
        }
        closeList();
        return html.join("");
    }

    function renderMessages() {
        const box = $("aic-messages");
        box.innerHTML = state.messages.map(m => {
            if (m.role === "user") return `<div class="aic-msg user"><div class="aic-bubble">${esc(m.text)}</div></div>`;
            const sources = (m.sources || []).length ? `
                <div class="aic-sources">
                    <span class="aic-sources-label"><i class="fa-solid fa-book-medical"></i> Nguồn tham khảo</span>
                    ${m.sources.map(s => `<span class="aic-source" title="${esc(s.source || s.title)}"><b>[${s.ref}]</b> ${esc(s.title.split(" – ")[0])} · ${esc(s.section)}</span>`).join("")}
                </div>` : "";
            const meta = m.meta ? `<div class="aic-meta">${m.meta}</div>` : "";
            return `<div class="aic-msg ai ${m.error ? "error" : ""}"><div class="aic-bot"><i class="fa-solid fa-robot"></i></div>
                        <div class="aic-bubble">${renderMarkdown(m.text, m.sources)}${sources}${meta}</div></div>`;
        }).join("") + (state.busy ? `
            <div class="aic-msg ai"><div class="aic-bot"><i class="fa-solid fa-robot"></i></div>
                <div class="aic-bubble aic-typing"><span></span><span></span><span></span>
                <small>Đang phân tích số liệu & tra cứu tài liệu...</small></div></div>` : "");
        box.scrollTop = box.scrollHeight;
        $("aic-suggest").hidden = state.messages.some(m => m.role === "user") || state.busy;
    }

    function greet() {
        state.messages = [{
            role: "ai",
            text: "Xin chào! Tôi là **Trợ lý AI AirHCM**. Tôi trả lời dựa trên **số liệu quan trắc, dự báo AI 24 giờ** của hệ thống "
                + "và **tài liệu chuẩn** (QCVN 05:2023, WHO 2021, VN_AQI, khuyến cáo y tế), có ghi nguồn.\n\n"
                + "Hãy chọn đối tượng cần tư vấn phía trên, rồi hỏi tôi bất cứ điều gì về không khí và sức khỏe.",
        }];
    }

    // --------------------------------------------------------------------------
    // GỬI CÂU HỎI
    // --------------------------------------------------------------------------
    async function ask(question) {
        question = (question || "").trim();
        if (!question || state.busy) return;
        const history = state.messages
            .filter(m => !m.error && m.text)
            .slice(-MAX_HISTORY)
            .map(m => ({ role: m.role === "user" ? "user" : "ai", text: m.text.slice(0, 400) }));

        state.messages.push({ role: "user", text: question });
        state.busy = true;
        renderMessages();

        const place = activePlace();
        const payload = {
            user_query: question,
            user_group: $("aic-group").value,
            history,
            ...(place ? { lat: place.lat, lng: place.lng, ward: place.name } : {}),
            ...(place && place.code ? { ward_code: place.code } : {}),
            // AI nêu chỉ số theo đúng chuẩn đang hiển thị trên bản đồ (VN_AQI / US AQI)
            aqi_standard: typeof currentAQIStandard !== "undefined" ? currentAQIStandard : "VN",
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 50000);
        try {
            const res = await fetch(`${API_BASE}/dss/advice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.status !== "success") throw new Error(body.message || body.detail || `Máy chủ lỗi (${res.status})`);
            const d = body.data;
            const ctx = d.context || {};
            const engine = d.source === "gemini" ? "Gemini" : "Bộ luật DSS (dự phòng)";
            const rag = d.retrieval === "hybrid" ? "RAG ngữ nghĩa + từ khóa" : d.retrieval === "bm25" ? "RAG từ khóa" : "";
            state.messages.push({
                role: "ai",
                text: d.advice,
                sources: d.sources || [],
                meta: [
                    `<i class="fa-solid fa-microchip"></i> ${engine}`,
                    rag && (d.sources || []).length ? rag : "",
                    ctx.aqi != null ? `${ctx.aqi_label || "AQI"} ${ctx.aqi} · PM2.5 ${ctx.pm25} µg/m³${ctx.ward ? " · " + esc(ctx.ward) : ""}` : "",
                ].filter(Boolean).join(" · "),
            });
        } catch (err) {
            state.messages.push({
                role: "ai",
                error: true,
                text: err.name === "AbortError"
                    ? "Trợ lý AI phản hồi quá lâu. Vui lòng thử lại sau ít phút."
                    : `Không kết nối được Trợ lý AI: ${err.message}. Kiểm tra máy chủ Backend đang chạy.`,
            });
        } finally {
            clearTimeout(timer);
            state.busy = false;
            renderMessages();
        }
    }

    // --------------------------------------------------------------------------
    // MỞ / ĐÓNG
    // --------------------------------------------------------------------------
    window.openAirAI = function (question) {
        const panel = $("ai-chat");
        if (!panel) return;
        state.clearedKey = null;   // Mở từ một địa điểm -> tư vấn theo địa điểm đó
        panel.hidden = false;
        requestAnimationFrame(() => panel.classList.add("open"));
        document.getElementById("btn-ai-agent")?.classList.add("active");
        renderContext();
        renderMessages();
        if (question) ask(question);
        else setTimeout(() => $("aic-input").focus(), 200);
    };

    window.closeAirAI = function () {
        const panel = $("ai-chat");
        panel.classList.remove("open");
        document.getElementById("btn-ai-agent")?.classList.remove("active");
        setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 260);
    };

    // Hỏi AI về địa điểm đang mở trong bảng thông tin (tìm kiếm / GPS / chuột phải)
    window.askAirAIAboutPlace = function () {
        const p = typeof currentPlace !== "undefined" ? currentPlace : null;
        if (!p) return window.openAirAI();
        const sel = window.airhcmSelection;
        window.openAirAI(`Chất lượng không khí tại ${(sel && sel.name) || p.name} hiện thế nào? Hôm nay tôi nên ra ngoài vào khung giờ nào?`);
    };

    // Hỏi AI về phường đang mở popup (app.js đã ghi phường này vào window.airhcmSelection khi bấm)
    window.askAirAIAboutWard = function () {
        if (typeof selectedWardLayer === "undefined" || !selectedWardLayer || !selectedWardFeature) return window.openAirAI();
        const sel = window.airhcmSelection;
        const name = sel && sel.kind === "ward" ? sel.name : "phường đang chọn";
        if (typeof map !== "undefined" && map) map.closePopup();
        window.openAirAI(`Không khí ở ${name} hôm nay có an toàn không? Tôi cần lưu ý gì để bảo vệ sức khỏe?`);
    };

    // --------------------------------------------------------------------------
    // MÃ QR: MỞ WEBGIS TRÊN ĐIỆN THOẠI (cùng Wi-Fi hoặc qua tên miền công khai)
    // --------------------------------------------------------------------------
    function loadQrLib() {
        if (window.QRCode) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
            s.onload = resolve;
            s.onerror = () => reject(new Error("Không tải được thư viện QR"));
            document.head.appendChild(s);
        });
    }

    window.openPhoneQR = async function () {
        const modal = $("modal-phone-qr");
        const box = $("phone-qr-box"), link = $("phone-qr-url"), note = $("phone-qr-note");
        modal.classList.add("active");
        box.innerHTML = '<div class="qr-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        link.textContent = "";
        note.textContent = "";

        const local = ["localhost", "127.0.0.1", ""].includes(location.hostname);
        let url = location.origin + "/";
        let lan = false;
        try {
            const health = await fetch(`${API_BASE}/health`).then(r => r.json());
            // Đang mở bằng localhost hoặc cổng 3000 -> dùng địa chỉ mạng LAN của Backend (phục vụ luôn WebGIS)
            if ((local || location.port === "3000") && health.lan_url) {
                url = health.lan_url + "/";
                lan = true;
            }
        } catch (e) { /* giữ địa chỉ hiện tại */ }

        try {
            await loadQrLib();
            box.innerHTML = "";
            new QRCode(box, { text: url, width: 220, height: 220, colorDark: "#0b1b4d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        } catch (e) {
            box.innerHTML = `<p class="qr-note">${esc(e.message)}</p>`;
        }
        link.textContent = url;
        link.href = url;
        note.textContent = lan || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname)
            ? "Điện thoại cần kết nối cùng mạng Wi-Fi với máy tính đang chạy AirHCM."
            : "Quét mã bằng camera điện thoại để mở AirHCM.";
    };

    window.closePhoneQR = function () {
        $("modal-phone-qr").classList.remove("active");
    };

    // --------------------------------------------------------------------------
    // KHỞI TẠO
    // --------------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
        if (!$("ai-chat")) return;
        greet();

        try {
            const saved = localStorage.getItem(GROUP_KEY);
            if (saved) $("aic-group").value = saved;
        } catch (e) { /* bộ nhớ trình duyệt bị chặn */ }
        $("aic-group").addEventListener("change", e => {
            try { localStorage.setItem(GROUP_KEY, e.target.value); } catch (err) { /* bỏ qua */ }
        });

        $("aic-suggest").innerHTML = SUGGESTIONS.map(q => `<button type="button" class="aic-suggest-chip">${esc(q)}</button>`).join("");
        $("aic-suggest").addEventListener("click", e => {
            const chip = e.target.closest(".aic-suggest-chip");
            if (chip) ask(chip.textContent);
        });

        const input = $("aic-input");
        const autoSize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
        input.addEventListener("input", autoSize);
        input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                $("aic-form").requestSubmit();
            }
        });
        $("aic-form").addEventListener("submit", e => {
            e.preventDefault();
            const q = input.value;
            input.value = "";
            autoSize();
            ask(q);
        });

        $("aic-close").addEventListener("click", window.closeAirAI);
        $("aic-reset").addEventListener("click", () => {
            if (state.busy) return;
            greet();
            renderMessages();
        });
        $("aic-location-clear").addEventListener("click", () => {
            state.clearedKey = currentSelectionKey();   // Tư vấn chung cho TP.HCM tới khi chọn địa điểm khác
            renderContext();
        });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && $("ai-chat").classList.contains("open") && document.activeElement === input) window.closeAirAI();
        });
        $("modal-phone-qr").addEventListener("click", e => { if (e.target.id === "modal-phone-qr") window.closePhoneQR(); });

        // Khi người dùng mở địa điểm/phường khác thì cập nhật nhãn vị trí
        setInterval(() => { if ($("ai-chat").classList.contains("open")) renderContext(); }, 1500);
        renderMessages();
    });
})();
