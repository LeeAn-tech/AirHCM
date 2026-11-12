import google.generativeai as genai
import os
import re
from datetime import datetime
from dotenv import load_dotenv

class DSSEngine:
    @staticmethod
    def calculate_us_aqi(pm25: float) -> int:
        """Thuật toán tính US AQI chuẩn EPA, triệt tiêu hoàn toàn lỗi khe hở ranh giới"""
        try:
            cp = float(pm25)
        except (ValueError, TypeError):
            return 0

        if cp < 0:
            return 0
        elif cp <= 12.0:
            c_low, c_high, i_low, i_high = 0.0, 12.0, 0, 50
        elif cp <= 35.4:
            c_low, c_high, i_low, i_high = 12.0, 35.4, 51, 100
        elif cp <= 55.4:
            c_low, c_high, i_low, i_high = 35.4, 55.4, 101, 150
        elif cp <= 150.4:
            c_low, c_high, i_low, i_high = 55.4, 150.4, 151, 200
        elif cp <= 250.4:
            c_low, c_high, i_low, i_high = 150.4, 250.4, 201, 300
        elif cp <= 350.4:
            c_low, c_high, i_low, i_high = 250.4, 350.4, 301, 400
        elif cp <= 500.4:
            c_low, c_high, i_low, i_high = 350.4, 500.4, 401, 500
        else:
            return 500  

        aqi = ((i_high - i_low) / (c_high - c_low)) * (cp - c_low) + i_low
        return int(round(aqi))

    @staticmethod
    def calculate_vn_aqi(pm25: float) -> int:
        """VN_AQI theo Quyết định 1459/QĐ-TCMT - trùng công thức với WebGIS (calculateVN_AQI) và Mobile"""
        try:
            pm = float(pm25)
        except (ValueError, TypeError):
            return 0
        if pm < 0:
            return 0
        bands = [
            (25.0, 0.0, 0, 50), (50.0, 25.1, 51, 100), (80.0, 50.1, 101, 150),
            (150.0, 80.1, 151, 200), (250.0, 150.1, 201, 300), (500.0, 250.1, 301, 500),
        ]
        for c_high, c_low, i_low, i_high in bands:
            if pm <= c_high:
                if c_low == 0.0:
                    return int(round((50.0 / 25.0) * pm))
                return int(round(((i_high - i_low) / (c_high - c_low)) * (pm - c_low) + i_low))
        return 500

    @staticmethod
    def get_health_advisory(aqi: int, pm25: float) -> dict:
        """Động cơ DSS: Xuất bản kịch bản khuyến cáo y tế và chỉ đạo môi trường"""
        # Giới hạn 24h trung bình theo QCVN 05:2023/BTNMT là 50 ug/m3
        qcvn_status = "Đạt quy chuẩn QCVN 05:2023" if pm25 <= 50.0 else "Vượt ngưỡng QCVN 05:2023"

        if aqi <= 50:
            return {
                "level": "Tốt",
                "color": "#00E400",
                "qcvn_comparison": qcvn_status,
                "general_population": "Không khí trong lành. Hoạt động bình thường ngoài trời.",
                "sensitive_groups": "Hoàn toàn an toàn cho người già, trẻ nhỏ và bệnh nhân hô hấp.",
                "action_plan": "Duy trì bảo dưỡng và giám sát môi trường nền đô thị."
            }
        elif aqi <= 100:
            return {
                "level": "Trung bình",
                "color": "#FFFF00",
                "qcvn_comparison": qcvn_status,
                "general_population": "Chất lượng không khí ở mức chấp nhận được.",
                "sensitive_groups": "Người cực kỳ nhạy cảm nên giảm vận động thể lực kéo dài ngoài trời.",
                "action_plan": "Kiểm tra lưu lượng giao thông tại các trục đường cửa ngõ."
            }
        elif aqi <= 150:
            return {
                "level": "Kém (Không lành mạnh cho nhóm nhạy cảm)",
                "color": "#FF7E00",
                "qcvn_comparison": qcvn_status,
                "general_population": "Người dân nên giảm thời gian tập thể dục gắng sức cạnh đường lớn.",
                "sensitive_groups": "Trẻ em, người già, người hen suyễn nên đeo khẩu trang N95 khi ra ngoài.",
                "action_plan": "Khuyến nghị các phương tiện vận tải che chắn bụi cẩn thận."
            }
        elif aqi <= 200:
            return {
                "level": "Xấu (Không lành mạnh)",
                "color": "#FF0000",
                "qcvn_comparison": qcvn_status,
                "general_population": "Mọi người nên hạn chế hoạt động ngoài trời, đóng kín cửa sổ.",
                "sensitive_groups": "Tránh hoàn toàn các hoạt động gắng sức ngoài trời; bật máy lọc không khí.",
                "action_plan": "Kích hoạt kế hoạch phun nước dập bụi đường phố tại các nút giao trọng điểm."
            }
        elif aqi <= 300:
            return {
                "level": "Rất xấu",
                "color": "#8F3F97",
                "qcvn_comparison": qcvn_status,
                "general_population": "Cảnh báo khẩn cấp: Hạn chế tối đa ra đường nếu không thực sự cần thiết.",
                "sensitive_groups": "Ở trong phòng kín; bệnh nhân tim/phổi cần chuẩn bị thuốc xịt cắt cơn dự phòng.",
                "action_plan": "Khuyến nghị điều tiết luồng giao thông, tạm dừng công trình xả bụi mịn lớn."
            }
        else:
            return {
                "level": "Nguy hại",
                "color": "#7E0023",
                "qcvn_comparison": qcvn_status,
                "general_population": "Báo động đỏ nguy hại: Tất cả người dân không nên ra ngoài.",
                "sensitive_groups": "Nguy cơ kích phát suy hô hấp cấp tính nghiêm trọng.",
                "action_plan": "Kích hoạt kịch bản khẩn cấp bảo vệ sức khỏe môi trường cấp thành phố."
            }

# Tải API Key từ file .env (đường dẫn tuyệt đối để không phụ thuộc thư mục chạy)
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# gemini-3.5-flash-lite phản hồi ~6 giây; các mô hình 3.5/3.8-flash thường quá 20 giây
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "models/gemini-3.5-flash-lite")
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "15"))

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY, transport="rest")
else:
    print("CẢNH BÁO: Chưa tìm thấy GEMINI_API_KEY. Trợ lý AI sẽ dùng bộ luật DSS nội bộ.")

USER_GROUP_LABELS = {
    "normal": "Người khỏe mạnh bình thường",
    "sensitive": "Nhóm nhạy cảm (trẻ em, người cao tuổi, phụ nữ mang thai)",
    "respiratory": "Người có bệnh nền hô hấp / tim mạch",
}


class AIConsultant:
    """Trợ lý AI tư vấn sức khỏe - đồng bộ số liệu quan trắc, dự báo AI và cảnh báo DSS của WebGIS"""

    @staticmethod
    def _context_lines(aqi: int, pm25: float, env: dict, context: dict) -> list:
        now = datetime.now()
        weekdays = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]
        lines = [
            f"- Thời điểm hiện tại: {now:%H:%M} {weekdays[now.weekday()]} {now:%d/%m/%Y} "
            "(chỉ gợi ý các khung giờ chưa qua; sáng < 12h, chiều 12-18h, tối > 18h)",
            f"- PM2.5 hiện tại: {pm25} µg/m³; {context.get('aqi_label') or 'US AQI'}: {aqi} (mức: {env['level']}); {env['qcvn_comparison']}",
        ]
        label = context.get("aqi_label")
        if label:
            other = f"US AQI {context.get('us_aqi')}" if label == "VN_AQI" else f"VN_AQI {context.get('vn_aqi')}"
            lines.append(f"- Người dùng đang xem bản đồ theo chuẩn {label}: khi nêu chỉ số AQI hiện tại PHẢI dùng "
                         f"{label} {aqi} và mức \"{env['level']}\" (có thể ghi thêm {other} trong ngoặc). "
                         "Ngưỡng cảnh báo / đăng ký nhận cảnh báo của hệ thống tính theo US AQI.")
        if context.get("ward"):
            lines.append(f"- Vị trí người dùng: {context['ward']}")
        fc = context.get("forecast") or {}
        if fc.get("peak"):
            lines.append(f"- Dự báo AI 24h: đỉnh {fc['peak']['pm2_5']} µg/m³ lúc {fc['peak']['label']}; "
                         f"thấp nhất {fc['low']['pm2_5']} µg/m³ lúc {fc['low']['label']}; "
                         f"{fc.get('exceed_hours', 0)} giờ vượt QCVN 50 µg/m³")
        if fc.get("best_window"):
            lines.append(f"- Khung giờ sạch nhất: {fc['best_window']['label']} (TB {fc['best_window']['avg_pm25']} µg/m³)")
        if fc.get("worst_window"):
            lines.append(f"- Khung giờ ô nhiễm nhất: {fc['worst_window']['label']} (TB {fc['worst_window']['avg_pm25']} µg/m³)")
        alert = context.get("alert") or {}
        if alert.get("status") == "WARNING":
            lines.append(f"- ĐANG CÓ CẢNH BÁO Warning_NhayCam: {alert.get('message', '')}")
        group = USER_GROUP_LABELS.get(context.get("user_group") or "normal")
        lines.append(f"- Đối tượng người hỏi: {group}")
        return lines

    @staticmethod
    def rule_based_advice(aqi: int, pm25: float, user_query: str, context: dict = None) -> str:
        """Câu trả lời từ bộ luật DSS khi mô hình ngôn ngữ không phản hồi"""
        context = context or {}
        env = DSSEngine.get_health_advisory(aqi, pm25)
        group = context.get("user_group") or "normal"
        q = (user_query or "").lower()

        label = context.get("aqi_label") or "AQI"
        parts = [f"**Đánh giá hiện tại:** {label} **{aqi}** – mức **{env['level']}**, PM2.5 {pm25} µg/m³ ({env['qcvn_comparison']})."]
        if context.get("ward"):
            parts[0] = f"**Tại {context['ward']}:** {label} **{aqi}** – mức **{env['level']}**, PM2.5 {pm25} µg/m³ ({env['qcvn_comparison']})."

        advice = env["sensitive_groups"] if group in ("sensitive", "respiratory") else env["general_population"]
        parts.append(f"**Lời khuyên cho {USER_GROUP_LABELS.get(group, 'bạn').lower()}:** {advice}")

        if any(k in q for k in ["chạy", "tập", "thể dục", "đạp xe", "thể thao", "đi bộ"]):
            if aqi > 100:
                parts.append("**Vận động:** Nên chuyển sang tập trong nhà hoặc giảm cường độ, tránh các trục đường lớn.")
            else:
                parts.append("**Vận động:** Có thể tập ngoài trời, ưu tiên công viên nhiều cây xanh và tránh giờ cao điểm giao thông.")
        if any(k in q for k in ["khẩu trang", "mask", "n95"]):
            parts.append("**Khẩu trang:** Khẩu trang vải không lọc được PM2.5; nên dùng loại N95/KN95 khi AQI trên 100.")
        if any(k in q for k in ["trẻ", "con", "em bé", "người già", "ông bà", "bầu"]):
            parts.append("**Người nhạy cảm:** Hạn chế cho trẻ nhỏ, người cao tuổi ra ngoài vào khung giờ ô nhiễm; đóng cửa sổ hướng ra đường lớn.")

        fc = context.get("forecast") or {}
        if fc.get("best_window") and fc.get("worst_window"):
            parts.append(f"**Khung giờ nên ra ngoài:** {fc['best_window']['label']} (PM2.5 ≈ {fc['best_window']['avg_pm25']} µg/m³). "
                         f"**Nên tránh:** {fc['worst_window']['label']}.")
        alert = context.get("alert") or {}
        if alert.get("status") == "WARNING":
            parts.append(f"⚠️ **Cảnh báo:** {alert.get('message', '')}")

        # RAG: trích đoạn tài liệu liên quan nhất trong kho tri thức
        knowledge = context.get("knowledge") or []
        if knowledge:
            top = knowledge[0]
            sentences = re.split(r"(?<=[.!?])\s+", top["text"])
            parts.append(f"📚 **Theo tài liệu [{top['ref']}] ({top['section']}):** {' '.join(sentences[:2])}")
        return "\n\n".join(parts)

    @staticmethod
    def _knowledge_lines(knowledge: list) -> list:
        return [f"[{p['ref']}] {p['title']} – {p['section']}: {p['text']}" for p in knowledge]

    @staticmethod
    def get_ai_advice(aqi: int, pm25: float, user_query: str, context: dict = None, history: list = None) -> dict:
        """Trả về {'advice', 'source', 'model'}; luôn có câu trả lời (Gemini hoặc bộ luật DSS)"""
        context = context or {}
        env = DSSEngine.get_health_advisory(aqi, pm25)
        knowledge = context.get("knowledge") or []

        if GEMINI_API_KEY:
            try:
                convo = ""
                for turn in (history or [])[-6:]:
                    role = "Người dùng" if turn.get("role") == "user" else "AirHCM"
                    convo += f"{role}: {str(turn.get('text', ''))[:400]}\n"

                prompt = (
                    "Bạn là Trợ lý AI y tế - môi trường của hệ thống WebGIS AirHCM (TP. Hồ Chí Minh).\n"
                    "DỮ LIỆU THỰC TẾ TỪ HỆ THỐNG (chỉ dựa vào số liệu này, không bịa số):\n"
                    + "\n".join(AIConsultant._context_lines(aqi, pm25, env, context))
                    + ("\n\nTÀI LIỆU THAM KHẢO TỪ KHO TRI THỨC AIRHCM (quy chuẩn, khuyến cáo y tế):\n"
                       + "\n".join(AIConsultant._knowledge_lines(knowledge)) if knowledge else "")
                    + (f"\n\nHỘI THOẠI TRƯỚC ĐÓ:\n{convo}" if convo else "")
                    + f"\n\nNGƯỜI DÙNG HỎI: \"{user_query}\"\n\n"
                    "YÊU CẦU: Trả lời bằng tiếng Việt dưới 170 chữ, xưng \"tôi\" gọi \"bạn\". "
                    "Nếu câu hỏi liên quan thời gian ra ngoài thì dùng khung giờ dự báo ở trên. "
                    + ("Khi dùng thông tin từ tài liệu tham khảo, ghi số nguồn dạng [1], [2] ngay sau câu đó; "
                       "chỉ dùng tài liệu liên quan tới câu hỏi, không bịa quy chuẩn hay con số ngoài tài liệu; "
                       "KHÔNG liệt kê lại danh sách nguồn ở cuối câu trả lời (giao diện đã tự hiển thị). "
                       if knowledge else "")
                    + "Nếu câu hỏi không liên quan không khí, môi trường hay sức khỏe thì lịch sự từ chối ngắn gọn. "
                    "Dùng Markdown, in đậm các ý chính."
                )
                model = genai.GenerativeModel(GEMINI_MODEL)
                response = model.generate_content(
                    prompt,
                    generation_config=genai.types.GenerationConfig(max_output_tokens=1024, temperature=0.4),
                    request_options={"timeout": GEMINI_TIMEOUT_SECONDS},
                )
                text = (response.text or "").strip()
                if text:
                    return {"advice": text, "source": "gemini", "model": GEMINI_MODEL}
            except Exception as e:
                print(f"-> [Trợ lý AI] Gemini không phản hồi ({type(e).__name__}), dùng bộ luật DSS.")

        return {
            "advice": AIConsultant.rule_based_advice(aqi, pm25, user_query, context),
            "source": "dss-rules",
            "model": None,
        }