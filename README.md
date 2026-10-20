# 🍃 AirHCM — Smart Spatio-Temporal WebGIS & AI Air Quality Decision Support System

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/PostgreSQL-PostGIS-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostGIS" />
  <img src="https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=white" alt="Leaflet" />
  <img src="https://img.shields.io/badge/Scikit--Learn-F7931E?style=for-the-badge&logo=scikitlearn&logoColor=white" alt="Scikit-Learn" />
  <img src="https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white" alt="Chart.js" />
  <img src="https://img.shields.io/badge/Architecture-SPA%20PWA-0284c7?style=for-the-badge" alt="SPA PWA" />
</p>

---

## 📌 Giới Thiệu Tổng Quan

**AirHCM** là nền tảng WebGIS thông minh tích hợp Trí tuệ Nhân tạo (Machine Learning) và Động cơ Hỗ trợ Ra Quyết định (DSS Engine) nhằm giám sát, dự báo chất lượng không khí thời gian thực và tự động phát cảnh báo sức khỏe cộng đồng tại TP. Hồ Chí Minh. 

Hệ thống giải quyết bài toán chuyển dịch từ **giám sát môi trường bị động** sang **dự báo chủ động và cảnh báo sớm đa kênh**, phục vụ song song cho cả **cộng đồng dân cư** và **cơ quan quản lý nhà nước (Bộ/Sở Tài nguyên & Môi trường)**.

---

## ✨ Tính Năng Nổi Bật (Key Features)

### 1. Bản Đồ Không Gian Thời Gian Thực (Real-time Spatio-Temporal GIS)
* **Bản đồ phân vùng 166 Phường/Xã/Thị trấn:** Tự động phân cấp màu sắc chuyên đề theo chuẩn 6 bậc US EPA & IQAir.
* **Huy hiệu trạm đo thông minh:** Hiển thị trực quan chỉ số AQI và nồng độ PM2.5 tại từng trạm quan trắc mặt đất PostGIS.
* **Trực quan hóa trường gió động học (Real-time Wind Streamlines):** Hàng trăm vệt hạt gió chuyển động liên tục phản ánh tốc độ và góc hướng gió ngoài đời thực, hỗ trợ quan sát hướng lan truyền bụi mịn.
* **Thanh trượt Playback 24h:** Mô phỏng quy luật biến thiên chất lượng không khí, nhiệt độ ERA5 và sol khí Sentinel-5P theo chu kỳ ngày đêm.

### 2. Dự Báo Học Máy & Trí Tuệ Nhân Tạo Có Thể Giải Thích (AI & Explainable AI)
* **Mô hình Random Forest Regressor:** Dự báo chuỗi thời gian nồng độ bụi mịn PM2.5 và US AQI trước 24 giờ, 72 giờ và 7 ngày tới với độ chính xác cao ($R^2 = 0.879$, $RMSE = 5.71\ \mu\text{g/m}^3$).
* **Biểu đồ trục tung kép (Dual Y-Axis Chart):** Biểu diễn tách biệt thang đo US AQI (0–150) và PM2.5 (0–40 $\mu\text{g/m}^3$), bảo toàn các đỉnh cao điểm và đáy phân tán tự nhiên.
* **Phân rã đóng góp thuộc tính (Feature Importance / XAI):** Minh bạch tỷ trọng ảnh hưởng của chu kỳ nền 7 ngày (74.0%), tốc độ gió ERA5 (13.6%), biến trễ ngắn hạn (5.2%), nhiệt độ bề mặt (4.8%) và chỉ số viễn thám AAI (2.4%).

### 3. Phân Hệ Hỗ Trợ Ra Quyết Định Y Tế (Decision Support System - DSS)
* **Mô phỏng kịch bản What-If:** Cho phép người dùng tùy chỉnh tham số giả định đầu vào (Lưu lượng giao thông, Nhiệt độ, Hệ số gió) để AI tính toán diễn biến chất lượng không khí tương ứng theo thời gian thực[cite: 88, 89].
* **Khung giờ vàng ra ngoài:** Tự động phân tích và khuyến nghị khung giờ không khí trong lành nhất và khung giờ ô nhiễm cao điểm cần hạn chế ra đường.
* **Tư vấn sức khỏe cá nhân hóa:** Đưa ra khuyến cáo phù hợp theo từng đối tượng (Người bình thường, Nhóm nhạy cảm, Bệnh hô hấp) và hoạt động thực tế (Đi xe máy, Tập thể thao, Ở trong nhà)[cite: 88].
* **Đối chiếu quy chuẩn song song:** Tích hợp kiểm tra đồng thời giới hạn trung bình 24h của QCVN 05:2023/BTNMT ($50\ \mu\text{g/m}^3$) và Khuyến nghị WHO 2021 ($15\ \mu\text{g/m}^3$).

### 4. Cổng Điều Hành & Quản Trị Trạm Không Gian (Admin Dashboard)
* **Phân quyền bảo mật 2 lớp:** Phân tách rạch ròi giữa giao diện người dùng tra cứu (Read-Only) và cổng quản trị điều hành (Full Control)[cite: 88, 89].
* **Quản trị CRUD Mạng lưới Trạm PostGIS:** Thêm, xem, sửa trạng thái hoạt động/bảo trì và xóa trạm quan trắc mặt đất trực tiếp trên CSDL không gian[cite: 88, 89].
* **Đường ống ETL & Retrain AI:** Nạp tự động dữ liệu quan trắc mới từ Live API Open-Meteo và kích hoạt huấn luyện lại mô hình[cite: 88, 89].
* **Hệ thống cảnh báo tự động qua Gmail SMTP:** Gửi thông báo ô nhiễm vượt ngưỡng đơn lẻ và phát cảnh báo khẩn cấp đồng loạt (Broadcast Alert) tới người dân đăng ký[cite: 88, 89].
* **Xuất báo cáo định kỳ:** Tải xuống danh sách trạm quan trắc và danh bạ cảnh báo ra định dạng file Excel (CSV)[cite: 88].

---

## 📊 Đặc Tả Độ Phân Giải Dữ Liệu (Spatio-Temporal Specifications)

| Thành phần dữ liệu | Độ phân giải Không gian (Spatial) | Độ phân giải Thời gian (Temporal) | Phương pháp xử lý |
| :--- | :--- | :--- | :--- |
| **Mô hình Khí tượng & Khí quyển** | Lưới Grid $0.1^\circ \times 0.1^\circ$ (~$9\text{ km} \times 11\text{ km}$)[cite: 88, 89] | 1 giờ / lần (Hourly Real-time)[cite: 88, 89] | Trường nồng độ nền PM2.5, PM10, Gió 10m, Nhiệt độ 2m[cite: 88, 89] |
| **Ảnh Vệ tinh Viễn thám (Sentinel-5P)** | Lưới Grid $3.5\text{ km} \times 5.5\text{ km}$[cite: 88, 89] | 1 lần / ngày (Daily Revisit)[cite: 88, 89] | Trích xuất chỉ số Sol khí hấp thụ (AAI) qua GEE[cite: 88, 89] |
| **Mạng lưới Trạm Quan trắc PostGIS** | 8 Trạm mặt đất tiêu chuẩn[cite: 88, 89] | 1 giờ / lần (Hourly PostGIS Sync)[cite: 88, 89] | Điểm mốc kiểm chứng thực địa (Ground Truth Calibration)[cite: 88, 89] |
| **Bản đồ Phân vùng Hành chính** | 166 Phường/Xã/Thị trấn TP.HCM[cite: 88, 89] | Biến thiên 24 giờ & Dự báo 7 ngày[cite: 88, 89] | Hạ tỉ lệ không gian & Thống kê vùng (Zonal Statistics)[cite: 88, 89] |

---

## 🛠️ Hướng Dẫn Cài Đặt Nhanh (Quickstart)

### Yêu Cầu Tiên Quyết
* Python >= 3.10
* PostgreSQL >= 14 (Đã kích hoạt `postgis` extension)
* Trình duyệt web hiện đại (Chrome / Edge / Firefox)

### 1. Phục hồi Cơ sở dữ liệu PostGIS
Tạo CSDL mới trong PostgreSQL và khôi phục từ file backup có sẵn trong thư mục `database_sql/`:
```bash
# Tạo CSDL và kích hoạt PostGIS
psql -U postgres -c "CREATE DATABASE webgis_aqi_hcm;"
psql -U postgres -d webgis_aqi_hcm -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Restore dữ liệu
pg_restore -U postgres -d webgis_aqi_hcm -v "database_sql/webgis_hcm.backup"

---

## 🏛️ Kiến Trúc Hệ Thống (3-Tier Architecture)
