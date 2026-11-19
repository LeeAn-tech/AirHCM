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

Hệ thống giải quyết bài toán chuyển dịch từ **giám sát môi trường bị động** sang **dự báo chủ động và cảnh báo sớm đa kênh**, phục vụ song song cho cả **cộng đồng dân cư** và **cơ quan quản lý nhà nước (Bộ/Sở Nông Nghiệp & Môi trường)**.

---

## ✨ Tính Năng Nổi Bật (Key Features)

### 1. Bản Đồ Không Gian Thời Gian Thực (Real-time Spatio-Temporal GIS)
* **Bản đồ phân vùng 168 Phường/Xã/Đặc khu:** Tự động phân cấp màu sắc chuyên đề theo chuẩn 6 bậc US EPA & IQAir.
* **Huy hiệu trạm đo thông minh:** Hiển thị trực quan chỉ số AQI và nồng độ PM2.5 tại từng trạm quan trắc mặt đất PostGIS.
* **Trực quan hóa trường gió động học (Real-time Wind Streamlines):** Hàng trăm vệt hạt gió chuyển động liên tục phản ánh tốc độ và góc hướng gió ngoài đời thực, hỗ trợ quan sát hướng lan truyền bụi mịn.
* **Thanh trượt Playback 24h:** Mô phỏng quy luật biến thiên chất lượng không khí, nhiệt độ ERA5 và sol khí Sentinel-5P theo chu kỳ ngày đêm.

### 2. Dữ Liệu Đa Chất Đồng Nhất & Dự Báo Realtime 7 Ngày (AirData)
* **6 chất ô nhiễm + CO2:** PM2.5, PM10, CO, NO2, SO2, O3 (tính VN_AQI theo QĐ 1459/QĐ-TCMT và US AQI theo US EPA 2024) và CO2 tham khảo.
* **Giải thuật đồng nhất đa nguồn:** CAMS 0,4° (Open-Meteo) nội suy song tuyến về 168 phường/xã, hạ quy mô bằng tỷ số không gian Sentinel-5P / MODIS MAIAC AOD 1 km (Google Earth Engine), ghép khí tượng ERA5-Land với Open-Meteo đã hiệu chỉnh độ lệch -> bộ dữ liệu **168 phường × 1 giờ** lưu trong PostgreSQL.
* **Dự báo realtime:** mở ứng dụng là có ngày hiện tại, chỉ số giờ hiện tại và 8 thẻ ngày (hôm nay + 7 ngày tới) theo từng phường; mô hình học máy trực tiếp đa hạn cho từng chất (HistGradientBoosting / XGBoost), kết hợp dự báo vật lý CAMS khi đã đủ dữ liệu đối chiếu.
* **Xu hướng tháng:** ước lượng trung bình các tháng tới (khí hậu tháng + xu thế + dị thường AR(1)) kèm khoảng tin cậy 80% và kiểm chứng ngược.
* **Giải thích mô hình:** độ quan trọng hoán vị đọc trực tiếp từ kết quả huấn luyện (`saved_models/airdata/metrics.json`), không gán cứng.
* Chi tiết giải thuật và cách chạy: [`docs/AIRDATA.md`](docs/AIRDATA.md).

### 2b. Phân Tích Xác Suất, Rủi Ro Phơi Nhiễm & Truy Vết Nguồn Thải
- Ngưỡng **QCVN 05:2023 (µg/Nm³, quy đổi theo T, P)** đối chiếu **WHO 2021**; QA/QC (spike, chuỗi đứng, ≥ 18/24 giờ cho TB 24h).
- **Dự báo xác suất** q05/q50/q95 và P(vượt ngưỡng) từ ensemble thực nghiệm, kiểm chứng PICP/Brier/reliability.
- **Rủi ro phơi nhiễm** 168 phường: A_T, N_T, E[N_T], PWE theo dân số; xuất CSV.
- **Hoa gió & hoa gió ô nhiễm** (F_k, C̄_k, P_k, CBPF), **truy vết nguồn thang A-E** (dấu hiệu đa chất, quỹ đạo ngược, điểm nghi vấn có phân tích độ nhạy, PMF sẵn sàng).
- **Kịch bản can thiệp** (ΔC, người-giờ tránh được, HIA, NPV/BCR) và **tối ưu ngân sách** có ràng buộc công bằng. Chi tiết: `docs/AIRDATA.md` mục 8.

### 3. Phân Hệ Hỗ Trợ Ra Quyết Định Y Tế (Decision Support System - DSS)
* **Mô phỏng kịch bản What-If:** Cho phép người dùng tùy chỉnh tham số giả định đầu vào (Lưu lượng giao thông, Nhiệt độ, Hệ số gió) để AI tính toán diễn biến chất lượng không khí tương ứng theo thời gian thực.
* **Khung giờ vàng ra ngoài:** Tự động phân tích và khuyến nghị khung giờ không khí trong lành nhất và khung giờ ô nhiễm cao điểm cần hạn chế ra đường.
* **Tư vấn sức khỏe cá nhân hóa:** Đưa ra khuyến cáo phù hợp theo từng đối tượng (Người bình thường, Nhóm nhạy cảm, Bệnh hô hấp) và hoạt động thực tế (Đi xe máy, Tập thể thao, Ở trong nhà).
* **Đối chiếu quy chuẩn song song:** QCVN 05:2023/BTNMT (PM2.5 TB 24h $45\ \mu\text{g/m}^3$ từ 01/01/2026; các giới hạn 1h/8h/24h của CO, NO2, SO2, O3, PM10) và Khuyến nghị WHO 2021 ($15\ \mu\text{g/m}^3$).

### 4. Cổng Điều Hành & Quản Trị Trạm Không Gian (Admin Dashboard)
* **Phân quyền bảo mật 2 lớp:** Phân tách rạch ròi giữa giao diện người dùng tra cứu (Read-Only) và cổng quản trị điều hành (Full Control).
* **Quản trị CRUD Mạng lưới Trạm PostGIS:** Thêm, xem, sửa trạng thái hoạt động/bảo trì và xóa trạm quan trắc mặt đất trực tiếp trên CSDL không gian.
* **Đường ống ETL & Retrain AI:** Nạp tự động dữ liệu quan trắc mới từ Live API Open-Meteo và kích hoạt huấn luyện lại mô hình.
* **Hệ thống cảnh báo tự động qua Gmail SMTP:** Gửi thông báo ô nhiễm vượt ngưỡng đơn lẻ và phát cảnh báo khẩn cấp đồng loạt (Broadcast Alert) tới người dân đăng ký.
* **Xuất báo cáo định kỳ:** Tải xuống danh sách trạm quan trắc và danh bạ cảnh báo ra định dạng file Excel (CSV).

---

## 📊 Đặc Tả Độ Phân Giải Dữ Liệu (Spatio-Temporal Specifications)

| Nguồn | Biến | Không gian | Thời gian | Xử lý trong AirData |
| :--- | :--- | :--- | :--- | :--- |
| CAMS Global (Open-Meteo Air Quality) | PM2.5, PM10, CO, NO2, SO2, O3, bụi, AOD | 0,4° (~45 km) | 3 giờ (nội suy giờ), dự báo 5 ngày | Lấy tại nút lưới, nội suy song tuyến về phường |
| CAMS Greenhouse Gas (Open-Meteo) | CO2 | 0,1° | 3 giờ, từ 11/2024 | Nội suy song tuyến |
| Sentinel-5P TROPOMI (GEE) | Cột NO2, SO2, CO, chỉ số sol khí | lưới 0,01° (1.113 m) | 1 lần/ngày, có mây | Tổ hợp 30 ngày -> tỷ số không gian hạ quy mô |
| MODIS MAIAC AOD (GEE) | AOD 550 nm | 1 km | hằng ngày, có mây | Tỷ số không gian cho PM2.5/PM10 |
| ERA5-Land (GEE) | Nhiệt độ, điểm sương, gió, mưa, áp suất | 0,1° | 1 giờ, trễ ~5 ngày | Lấp ô ven biển bằng focal mean |
| Open-Meteo Weather | Khí tượng dự báo | ~9-11 km | 1 giờ, 9 ngày tới | Hiệu chỉnh độ lệch theo cửa sổ chồng lấp 72 giờ |
| **Đích đồng nhất** | 7 chất + khí tượng | **168 phường/xã** | **1 giờ (UTC+7)** | Bảng `kk_dongnhat_phuong_gio` |

---

## 🛠️ Hướng Dẫn Cài Đặt Nhanh (Quickstart)

### Yêu Cầu Tiên Quyết
* Python >= 3.11 (đã thử nghiệm với Python 3.14)
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
```

### 2. Cấu hình bí mật (`backend/.env` – không commit)
```ini
GEMINI_API_KEY=...            # Trợ lý AI (Gemini) + embedding cho RAG
SMTP_SENDER_EMAIL=...         # Gmail gửi email cảnh báo
SMTP_APP_PASSWORD=...         # Gmail App Password
AUTH_SECRET=...               # Khóa ký token đăng nhập (tự sinh nếu để trống)
```

### 3. Chạy hệ thống – 1 lệnh
Bấm đúp `start_airhcm.bat` (hoặc `cd backend && python run.py`). Backend FastAPI phục vụ luôn WebGIS:
* Máy tính: http://localhost:8000 · Tài liệu API: http://localhost:8000/docs
* Điện thoại cùng Wi-Fi: bấm nút **QR** trên thanh tiêu đề WebGIS rồi quét mã.

### 4. Tài khoản quản trị (RBAC)
Mật khẩu quản trị được băm PBKDF2 trên máy chủ (`backend/auth_store.json`), mọi API `/admin/*` yêu cầu token vai trò admin. Đổi mật khẩu mặc định:
```bash
cd backend && python scripts/set_admin_password.py admin
```

### 5. Trợ lý AI có RAG
Kho tri thức nằm trong `backend/knowledge/*.md` (QCVN 05:2023, VN_AQI 1459, WHO 2021, US EPA, khuyến cáo y tế…). Thêm tài liệu mới: tạo file Markdown, mỗi mục bắt đầu bằng `## `, khởi động lại Backend – embedding được tính và lưu cache tự động.

---

## 🏛️ Kiến Trúc Hệ Thống (3-Tier Architecture)

# Ghi chú phát triển WebGis và Mobile AirHCM
