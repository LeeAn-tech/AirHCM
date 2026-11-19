"""
AirData - phân hệ dữ liệu không khí đa chất của AirHCM.

  config            danh mục chất, nguồn, tham số giải thuật
  sources_openmeteo thu thập CAMS (nút lưới 0,4°) + khí tượng Open-Meteo
  sources_gee       thu thập ERA5-Land, Sentinel-5P, MODIS MAIAC qua Google Earth Engine
  harmonize         GIẢI THUẬT ĐỒNG NHẤT không gian - thời gian -> 168 phường × giờ
  store             lưu trữ PostgreSQL (bảng kk_*)
  features, train   đặc trưng & huấn luyện mô hình dự báo trực tiếp đa hạn
  seasonal          xu hướng trung bình tháng
  forecast          động cơ dự báo thời gian thực (7 ngày + tháng)
  aqi               VN_AQI (QĐ 1459/QĐ-TCMT) và US AQI (EPA 2024) đa chất
  pipeline          backfill lịch sử + cập nhật mỗi giờ
  router            API /api/v1/air/*

  Phân tích nâng cao (theo tài liệu "Hệ thống dự báo, phân tích xác suất và truy tìm nguồn thải"):
  standards         ngưỡng QCVN 05:2023 (µg/Nm³) vs WHO 2021, quy đổi điều kiện chuẩn, thống kê theo kỳ TB
  qaqc              kiểm soát chất lượng: âm, spike, chuỗi đứng, độ đầy đủ, TB 24h hợp lệ
  windrose          hoa gió, hoa gió ô nhiễm (F_k, C̄_k, P_k, CBPF), lặng gió
  uncertainty       dự báo xác suất (ensemble thực nghiệm), PICP, Brier, reliability, ECE
  evaluation        đánh giá mở rộng theo mùa, cực trị, ngưỡng
  risk              P(vượt) theo phường, A_T, N_T, E[N_T], PWE
  source_trace      truy vết nguồn thang A-E, điểm nghi vấn, quỹ đạo ngược, PMF
  scenarios         kịch bản can thiệp, HIA, NPV/BCR, tối ưu ngân sách
  sources_extra_weather  bức xạ, mây, độ cao lớp biên, gió 100 m (Open-Meteo)
  analytics, router_analytics  dịch vụ + API /api/v1/air/{catalog,qaqc,windrose,probability,risk,trace,scenarios,...}
"""
