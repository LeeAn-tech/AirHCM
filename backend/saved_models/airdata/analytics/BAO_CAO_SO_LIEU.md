# SỐ LIỆU PHÂN TÍCH NÂNG CAO CHO BÁO CÁO (tự sinh bởi scripts/airdata_analytics.py)

Thời điểm chạy: 2026-11-21T20:44:09

## 1. Dự báo xác suất - kiểm chứng độc lập

| Chất | PICP90 giờ (ngày 1) | PICP90 giờ (ngày 8) | PICP90 TB ngày (ngày 2) | Brier QCVN (ngày 2) | Brier WHO (ngày 2) | Brier skill WHO |
|---|---|---|---|---|---|---|
| PM2.5 | 0.8338 | 0.8043 | 0.7532 | 0.0162 | 0.1398 | 0.2893 |
| PM10 | 0.8243 | 0.768 | 0.7405 | 0.0 | 0.031 | 0.0103 |
| CO | 0.8544 | 0.8547 | 0.8608 | None | 0.0 | None |
| NO2 | 0.8641 | 0.8679 | 0.8481 | 0.0 | 0.0559 | -0.0221 |
| SO2 | 0.9385 | 0.9434 | 0.9494 | 0.0 | 0.0 | None |
| O3 | 0.7468 | 0.7655 | 0.7152 | 0.1513 | 0.167 | 0.4134 |

Hiệu chỉnh: ['2026-01-08 01:00:00', '2026-06-15 19:00:00']; kiểm chứng: ['2026-06-16 01:00:00', '2026-11-21 19:00:00'].

## 2. RMSE theo mùa (hạn 1-24h / 73-192h)

| Chất | Mùa khô | Mùa mưa |
|---|---|---|
| PM2.5 | 4.635 / 5.802 | 6.813 / 7.419 |
| PM10 | 4.901 / 6.054 | 7.381 / 8.142 |
| CO | 46.525 / 60.213 | 127.608 / 150.165 |
| NO2 | 3.219 / 3.953 | 4.727 / 5.251 |
| SO2 | 1.795 / 2.139 | 3.65 / 4.33 |
| O3 | 9.837 / 12.239 | 13.929 / 16.097 |

## 3. QA/QC chuỗi cấp TP

| Biến | Độ đầy đủ | Giờ thiếu | Đoạn thiếu dài nhất (h) | Spike | Chuỗi đứng (h) | Tỷ lệ ngày TB24h hợp lệ |
|---|---|---|---|---|---|---|
| pm2_5 | 1.0 | 0 | 0 | 229 | 0 | 0.9994 |
| pm10 | 1.0 | 0 | 0 | 190 | 0 | 0.9994 |
| co | 1.0 | 0 | 0 | 272 | 5 | 0.9994 |
| no2 | 1.0 | 0 | 0 | 169 | 0 | 0.9994 |
| so2 | 1.0 | 0 | 0 | 186 | 6 | 0.9994 |
| o3 | 1.0 | 0 | 0 | 173 | 0 | 0.9994 |
| co2 | 0.4817 | 19536 | 19536 | 0 | 0 | 0.4812 |
| temperature_2m | 1.0 | 0 | 0 | 0 | 0 | 0.9994 |
| wind_speed | 1.0 | 0 | 0 | 19 | 0 | 0.9994 |
| wind_dir | 1.0 | 0 | 0 | 0 | 0 | 0.9994 |
| precipitation | 1.0 | 0 | 0 | 0 | 0 | 0.9994 |

Nghiệm thu: {'criterion': '≥ 80% giờ có dữ liệu cho chuỗi đầu vào trọng yếu', 'series': {'pm2_5': 1.0, 'pm10': 1.0, 'no2': 1.0, 'o3': 1.0, 'temperature_2m': 1.0, 'wind_speed': 1.0}, 'pass': True}

## 4. Hoa gió

- toan_ky: lặng gió 0.15%; hướng gió trội {'name': 'TN', 'freq_pct': 21.62}; hướng ô nhiễm PM2.5 trội {'name': 'TN', 'p_exceed': 0.0259, 'n': 8149} (ngưỡng 50.0 µg/m³)
- mua_kho: lặng gió 0.03%; hướng gió trội {'name': 'ĐN', 'freq_pct': 37.51}; hướng ô nhiễm PM2.5 trội {'name': 'TN', 'p_exceed': 0.0151, 'n': 265} (ngưỡng 50.0 µg/m³)
- mua_mua: lặng gió 0.22%; hướng gió trội {'name': 'TN', 'freq_pct': 34.02}; hướng ô nhiễm PM2.5 trội {'name': 'TN', 'p_exceed': 0.0263, 'n': 7884} (ngưỡng 50.0 µg/m³)

## 5. Truy vết nguồn

Sự kiện (TB 24h > WHO 15): [{'date': '2026-09-16', 'mean24': 53.9, 'threshold': 15.0, 'max1': 71.1}, {'date': '2026-09-15', 'mean24': 45.1, 'threshold': 15.0, 'max1': 58.6}, {'date': '2026-06-22', 'mean24': 45.0, 'threshold': 15.0, 'max1': 75.4}, {'date': '2026-06-13', 'mean24': 44.4, 'threshold': 15.0, 'max1': 75.9}, {'date': '2026-06-01', 'mean24': 44.0, 'threshold': 15.0, 'max1': 67.2}, {'date': '2026-05-27', 'mean24': 42.7, 'threshold': 15.0, 'max1': 74.2}, {'date': '2026-06-15', 'mean24': 41.9, 'threshold': 15.0, 'max1': 70.1}, {'date': '2026-06-14', 'mean24': 41.7, 'threshold': 15.0, 'max1': 62.6}, {'date': '2026-06-10', 'mean24': 41.5, 'threshold': 15.0, 'max1': 58.6}, {'date': '2026-06-02', 'mean24': 41.3, 'threshold': 15.0, 'max1': 63.6}]

Sự kiện phân tích: 2026-09-16; nền liên vùng: {'background_p10': 46.23, 'city_mean': 62.07, 'urban_increment_share': 0.255}

- PM2.5/PM10 trung vị = 0.90 (≥ 0,6) -> Bụi mịn chiếm ưu thế: quá trình đốt (giao thông, công nghiệp, sinh khối) hoặc bụi thứ cấp.
- SO2/NO2 trung vị = 0.69 (≥ 0,5) -> Dấu hiệu đốt nhiên liệu chứa lưu huỳnh: công nghiệp, nhiệt điện, tàu biển.

| Ứng viên | Loại | Khoảng cách (km) | Điểm nghi vấn | P(top-5) |
|---|---|---|---|---|
| Điểm nóng SO2 vệ tinh - Bình Thạnh | Điểm nóng theo vệ tinh (S5P/MAIAC) | 3.9 | 0.858 | 1.0 |
| Điểm nóng SO2 vệ tinh - Bình Lợi Trung | Điểm nóng theo vệ tinh (S5P/MAIAC) | 5.04 | 0.794 | 0.93 |
| Điểm nóng PM2.5 vệ tinh - Gò Vấp | Điểm nóng theo vệ tinh (S5P/MAIAC) | 7.48 | 0.778 | 0.728 |
| Điểm nóng PM2.5 vệ tinh - Thông Tây Hội | Điểm nóng theo vệ tinh (S5P/MAIAC) | 8.75 | 0.778 | 0.85 |
| Điểm nóng PM2.5 vệ tinh - An Hội Đông | Điểm nóng theo vệ tinh (S5P/MAIAC) | 8.94 | 0.776 | 0.654 |
| Điểm nóng NO2 vệ tinh - Tân Bình | Điểm nóng theo vệ tinh (S5P/MAIAC) | 6.83 | 0.767 | 0.444 |
| Điểm nóng PM2.5 vệ tinh - Phú Thọ | Điểm nóng theo vệ tinh (S5P/MAIAC) | 5.1 | 0.754 | 0.284 |
| Điểm nóng PM2.5 vệ tinh - An Hội Tây | Điểm nóng theo vệ tinh (S5P/MAIAC) | 10.26 | 0.741 | 0.082 |

## 6. Rủi ro phơi nhiễm PM2.5

### QCVN (ngưỡng 45.0 µg/Nm³, dân số 14,668,098)

| Ngày | A_T (km²) | N_T theo q50 | E[N_T] | N_T q05-q95 | PWE |
|---|---|---|---|---|---|
| 2026-11-21 | 437.94 | 6,619,241 | 6,596,853 | 5,982,070-6,821,818 | 41.37 |
| 2026-11-22 | 53.75 | 1,484,937 | 2,220,009 | 0-7,332,722 | 34.05 |
| 2026-11-23 | 132.9 | 3,238,613 | 3,827,968 | 0-9,012,059 | 37.02 |
| 2026-11-24 | 354.42 | 5,995,867 | 5,342,480 | 0-11,393,814 | 40.03 |
| 2026-11-25 | 405.34 | 7,022,819 | 6,186,946 | 0-11,662,435 | 42.09 |
| 2026-11-26 | 405.34 | 7,022,819 | 6,089,433 | 0-12,237,411 | 42.04 |
| 2026-11-27 | 262.02 | 5,071,300 | 4,903,940 | 0-11,183,952 | 39.35 |
| 2026-11-28 | 383.76 | 6,572,061 | 5,665,975 | 0-11,655,311 | 41.1 |

### WHO (ngưỡng 15.0 µg/m³, dân số 14,668,098)

| Ngày | A_T (km²) | N_T theo q50 | E[N_T] | N_T q05-q95 | PWE |
|---|---|---|---|---|---|
| 2026-11-21 | 5286.06 | 14,099,241 | 14,086,968 | 13,990,092-14,099,241 | 40.94 |
| 2026-11-22 | 4892.27 | 13,732,948 | 13,733,758 | 12,982,655-14,395,571 | 33.65 |
| 2026-11-23 | 5298.83 | 14,061,273 | 13,989,591 | 13,203,519-14,643,402 | 36.58 |
| 2026-11-24 | 5515.16 | 14,167,071 | 14,147,727 | 13,443,605-14,668,098 | 39.62 |
| 2026-11-25 | 5742.76 | 14,290,570 | 14,253,875 | 13,583,563-14,668,098 | 41.58 |
| 2026-11-26 | 5999.81 | 14,395,571 | 14,282,147 | 13,583,563-14,668,098 | 41.99 |
| 2026-11-27 | 5515.16 | 14,167,071 | 14,156,769 | 13,582,501-14,668,098 | 39.35 |
| 2026-11-28 | 5742.76 | 14,290,570 | 14,242,797 | 13,581,274-14,668,098 | 41.1 |

## 7. Kịch bản can thiệp (GIẢ ĐỊNH THỬ NGHIỆM)

| Kịch bản | Chi phí | PWE cơ sở | PWE kịch bản | Giảm (%) | Dân hưởng lợi | Người-giờ vượt tránh được (%) |
|---|---|---|---|---|---|---|
| S0: Không can thiệp | 0.0 | 25.47 | 25.47 | 0.0 | 0 | 0.0 |
| S1: Kiểm soát bụi công trường | 4.0 | 25.47 | 24.68 | 3.09 | 12,925,999 | 13.28 |
| S2: Giảm phát thải giao thông | 18.0 | 25.47 | 23.79 | 6.56 | 14,136,346 | 26.66 |
| S3: Công nghiệp + giao thông | 26.0 | 25.47 | 22.57 | 11.36 | 14,668,098 | 41.87 |

S2: Giảm phát thải giao thông: ΔPWE khi áp dụng đồng thời = 1.671 µg/m³, tổng ΔPWE từng biện pháp riêng lẻ = 1.81 µg/m³ -> các biện pháp cùng ngành kết hợp theo tích, không cộng giản đơn. Tương tác hóa học - khí quyển giữa các ngành (thứ cấp, O3) chưa được mô hình hóa.

Tối ưu (ngân sách 15, công bằng ≥ 5%): {'measures': ['M2', 'M4', 'M6', 'M8'], 'cost': 15.0, 'objective': 328525922.9070244, 'vulnerable_reduction_pct': 12.05, 'pwe': np.float64(22.397), 'reduction_pct': 12.05, 'measure_names': ['Kiểm định khí thải xe máy, ô tô', 'Che chắn, rửa bánh xe, tưới ẩm công trường', 'CEMS, lọc bụi túi/ESP, khử SO2/NOx lò hơi', 'Ngăn đốt lộ thiên, giám sát điểm cháy'], 'person_hours_avoided': 203204030}
