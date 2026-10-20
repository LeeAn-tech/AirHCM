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