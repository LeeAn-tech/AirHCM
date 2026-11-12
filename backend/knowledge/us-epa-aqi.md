# Chỉ số AQI của Cơ quan Bảo vệ Môi trường Hoa Kỳ (US EPA)
Nguồn: US Environmental Protection Agency – Air Quality Index (AQI) Basics

## Thang US AQI
US AQI có 6 mức: 0–50 Good (Tốt), 51–100 Moderate (Trung bình), 101–150 Unhealthy for Sensitive Groups (Không lành mạnh cho nhóm nhạy cảm), 151–200 Unhealthy (Không lành mạnh), 201–300 Very Unhealthy (Rất không lành mạnh), 301–500 Hazardous (Nguy hại). AQI càng cao, không khí càng ô nhiễm và nguy cơ sức khỏe càng lớn.

## Bảng quy đổi PM2.5 sang US AQI trong AirHCM
AirHCM tính US AQI theo bảng ngưỡng PM2.5 truyền thống của EPA: 0–12,0 µg/m³ ứng với AQI 0–50; 12,1–35,4 ứng với 51–100; 35,5–55,4 ứng với 101–150; 55,5–150,4 ứng với 151–200; 150,5–250,4 ứng với 201–300; trên 250,5 ứng với 301–500. Năm 2024 EPA đã siết ngưỡng mức Tốt của PM2.5 xuống 0–9,0 µg/m³, nên cùng một nồng độ thấp, bảng mới có thể cho AQI cao hơn một chút.

## Chuyển đổi giữa VN_AQI và US AQI trên AirHCM
Người dùng có thể chuyển giữa VN_AQI (Quyết định 1459/QĐ-TCMT) và US AQI (EPA) ngay trên WebGIS và ứng dụng di động. Hai thang có cùng 6 mức màu nhưng ngưỡng nồng độ khác nhau, nên cùng một giá trị PM2.5 có thể cho hai chỉ số khác nhau. Cảnh báo tự động và ngưỡng đăng ký nhận thông báo đẩy của AirHCM dùng US AQI.
