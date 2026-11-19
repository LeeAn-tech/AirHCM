# Chỉ số AQI của Cơ quan Bảo vệ Môi trường Hoa Kỳ (US EPA)
Nguồn: US Environmental Protection Agency – Air Quality Index (AQI) Basics

## Thang US AQI
US AQI có 6 mức: 0–50 Good (Tốt), 51–100 Moderate (Trung bình), 101–150 Unhealthy for Sensitive Groups (Không lành mạnh cho nhóm nhạy cảm), 151–200 Unhealthy (Không lành mạnh), 201–300 Very Unhealthy (Rất không lành mạnh), 301–500 Hazardous (Nguy hại). AQI càng cao, không khí càng ô nhiễm và nguy cơ sức khỏe càng lớn.

## Bảng quy đổi PM2.5 sang US AQI trong AirHCM
AirHCM tính US AQI theo bảng ngưỡng PM2.5 sửa đổi của EPA (có hiệu lực từ 05/2024): 0–9,0 µg/m³ ứng với AQI 0–50; 9,1–35,4 ứng với 51–100; 35,5–55,4 ứng với 101–150; 55,5–125,4 ứng với 151–200; 125,5–225,4 ứng với 201–300; 225,5 trở lên ứng với 301–500. Với các khí, AirHCM quy đổi µg/m³ sang ppb/ppm ở 25 °C và dùng: O3 trung bình 8 giờ (và 1 giờ khi ≥ 0,125 ppm), CO trung bình 8 giờ, NO2 và SO2 trung bình 1 giờ; US AQI tổng hợp là giá trị lớn nhất của các chất.

## Chuyển đổi giữa VN_AQI và US AQI trên AirHCM
Người dùng có thể chuyển giữa VN_AQI (Quyết định 1459/QĐ-TCMT) và US AQI (EPA) ngay trên WebGIS và ứng dụng di động. Hai thang có cùng 6 mức màu nhưng ngưỡng nồng độ khác nhau, nên cùng một giá trị PM2.5 có thể cho hai chỉ số khác nhau. Cảnh báo tự động và ngưỡng đăng ký nhận thông báo đẩy của AirHCM dùng US AQI.
