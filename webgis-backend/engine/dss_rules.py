class DSSEngine:
    def __init__(self):
        self.QCVN_LIMIT = 50.0

    def calculate_aqi(self, pm25: float) -> dict:
        breakpoints = [
            (0.0, 12.0, 0, 50, "Tốt"),
            (12.1, 35.4, 51, 100, "Trung bình"),
            (35.5, 55.4, 101, 150, "Kém"),
            (55.5, 150.4, 151, 200, "Xấu"),
            (150.5, 250.4, 201, 300, "Rất xấu"),
            (250.5, 500.4, 301, 500, "Nguy hại")
        ]
        
        for c_low, c_high, i_low, i_high, level in breakpoints:
            if c_low <= pm25 <= c_high:
                aqi = ((i_high - i_low) / (c_high - c_low)) * (pm25 - c_low) + i_low
                return {"aqi": round(aqi), "level": level}
        return {"aqi": 500, "level": "Nguy hại"}

    def generate_personalized_advice(self, aqi: int, user_group: str) -> str:
        if aqi <= 50:
            return "Không khí sạch, lý tưởng cho mọi hoạt động ngoài trời."
        elif 51 <= aqi <= 100:
            if user_group in ["child", "elder", "sick"]:
                return "Cảnh báo: Nhóm nhạy cảm nên hạn chế vận động mạnh kéo dài."
            return "Chất lượng không khí chấp nhận được. Hoạt động bình thường."
        elif 101 <= aqi <= 150:
            if user_group == "sick":
                return "Nguy hiểm: Người có bệnh nền hô hấp cần ở trong nhà, dùng máy lọc không khí."
            return "Khuyến cáo: Đeo khẩu trang chống bụi mịn khi ra đường, giảm hoạt động ngoài trời."
        else:
            return "Khẩn cấp: Yêu cầu mọi đối tượng ở trong nhà, đóng kín cửa sổ và kích hoạt hệ thống lọc khí."

    def generate_admin_macro_scenarios(self, pm25: float, aqi: int) -> list[str]:
        scenarios = []
        if pm25 > self.QCVN_LIMIT:
            scenarios.append(f"[QCVN] Vượt ngưỡng chuẩn quốc gia (>{self.QCVN_LIMIT} µg/m³). Rà soát các nguồn thải cục bộ.")
        if aqi > 150:
            scenarios.append("[Giao thông] Đề xuất phân luồng, cấm xe tải trọng lớn vào nội đô.")
            scenarios.append("[Cộng đồng] Phát lệnh cảnh báo SMS/Email diện rộng.")
        if not scenarios:
            scenarios.append("Chỉ số an toàn. Tiếp tục duy trì hệ thống quan trắc.")
        return scenarios

    def process_decision(self, pm25_pred: float, user_group: str = "general") -> dict:
        aqi_data = self.calculate_aqi(pm25_pred)
        return {
            "pm25_predict": round(pm25_pred, 1),
            "aqi_index": aqi_data["aqi"],
            "pollution_level": aqi_data["level"],
            "is_exceed_qcvn": pm25_pred > self.QCVN_LIMIT,
            "end_user_advice": self.generate_personalized_advice(aqi_data["aqi"], user_group),
            "admin_scenarios": self.generate_admin_macro_scenarios(pm25_pred, aqi_data["aqi"])
        }