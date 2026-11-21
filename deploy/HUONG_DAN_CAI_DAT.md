# HƯỚNG DẪN CÀI ĐẶT HỆ THỐNG AirHCM

Đề tài: Xây dựng hệ thống WebGIS dự báo chất lượng không khí (PM2.5/AQI) bằng học máy và hỗ trợ ra quyết định cảnh báo sức khỏe cộng đồng tại TP.HCM
SVTH: Lê Hoàng Ân – 12_ĐH_THMT · GVHD: TS. Dương Thị Thúy Nga

## Bộ nộp bài gồm

| Tệp | Nội dung |
|---|---|
| `1_SourceCode_AirHCM.zip` | Mã nguồn: `backend` (FastAPI + mô hình đã huấn luyện), `frontend` (WebGIS), `airhcm_mobile` (Flutter), `deploy`, `docs`, `DOAN_notebooks` (thu thập GEE, ETL, huấn luyện) |
| `2_Database_AirHCM.zip` | `webgis_aqi_hcm.backup` (bản sao lưu PostgreSQL/PostGIS), `webgis_aqi_hcm_schema.sql`, `webgis_hcm.sql`, hướng dẫn khôi phục |
| `3_Data_CSV_AirHCM.zip` | Dữ liệu gốc (GEE ERA5-Land, Sentinel-5P, Open-Meteo), danh mục 168 xã/phường, bộ dữ liệu đồng nhất 168 xã/phường × giờ (`.csv.gz` theo năm), chuỗi cấp thành phố |
| `4_App_Android/AirHCM.apk` | Tệp cài ứng dụng di động Android |
| `5_BaoCao` | Báo cáo tổng kết (Word) và bài trình chiếu (PowerPoint) |
| `6_Video` | Video hướng dẫn cài đặt, video hướng dẫn sử dụng |

## 1. Yêu cầu phần mềm (Windows 10/11)

1. **Python 3.11 trở lên** (đã chạy thử với Python 3.14) – khi cài, tick **Add python.exe to PATH**.
2. **PostgreSQL 16 hoặc 17** – trong bước cuối của bộ cài, mở **Stack Builder** → *Spatial Extensions* → cài **PostGIS**. Ghi nhớ mật khẩu tài khoản `postgres`.
3. Trình duyệt Chrome hoặc Edge.
4. (Chỉ khi muốn tự build lại ứng dụng di động) Flutter SDK + Android Studio. Nếu chỉ cài ứng dụng thì dùng sẵn tệp `AirHCM.apk`.

## 2. Giải nén mã nguồn

Giải nén `1_SourceCode_AirHCM.zip` vào thư mục không dấu, không khoảng trắng, ví dụ `D:\AirHCM`.

## 3. Khôi phục cơ sở dữ liệu

Giải nén `2_Database_AirHCM.zip`, mở **Command Prompt** tại thư mục vừa giải nén (thay `17` bằng phiên bản PostgreSQL đã cài):

```bat
set PATH=%PATH%;C:\Program Files\PostgreSQL\17\bin
psql -U postgres -c "CREATE DATABASE webgis_aqi_hcm;"
psql -U postgres -d webgis_aqi_hcm -c "CREATE EXTENSION IF NOT EXISTS postgis;"
pg_restore -U postgres -d webgis_aqi_hcm --no-owner --no-privileges -j 4 webgis_aqi_hcm.backup
psql -U postgres -d webgis_aqi_hcm -c "SELECT COUNT(*) FROM kk_dongnhat_phuong_gio;"
```

Cách khác bằng pgAdmin: chuột phải **Databases → Create → Database** (`webgis_aqi_hcm`), mở **Query Tool** chạy `CREATE EXTENSION postgis;`, rồi chuột phải CSDL → **Restore…** → chọn tệp `webgis_aqi_hcm.backup`.

## 4. Cài thư viện Python

```bat
cd /d D:\AirHCM\backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Nếu `requirements.txt` báo lỗi phiên bản: `pip install -r ..\deploy\requirements-server.txt matplotlib geopandas`.

## 5. Cấu hình

1. Sao chép `backend\.env.example` thành `backend\.env`, sửa dòng `DATABASE_URL` theo mật khẩu `postgres` của máy:
   `DATABASE_URL=postgresql://postgres:MAT_KHAU@localhost:5432/webgis_aqi_hcm`
2. Các khóa không bắt buộc (bỏ trống thì chức năng tương ứng tạm tắt, hệ thống vẫn chạy): `GEMINI_API_KEY` (trợ lý AI), `SMTP_SENDER_EMAIL` + `SMTP_APP_PASSWORD` (email cảnh báo). Khóa Firebase và Google Earth Engine của tác giả **không** đi kèm vì lý do bảo mật: thông báo đẩy và lấy ảnh vệ tinh mới sẽ tạm tắt (đặt `AIRDATA_GEE=0`); dự báo vẫn cập nhật mỗi giờ từ Open-Meteo.
3. Đặt mật khẩu tài khoản quản trị: `python scripts\set_admin_password.py admin`

## 6. Chạy hệ thống

Bấm đúp **`start_airhcm.bat`** ở thư mục gốc (hoặc `cd backend` → `python run.py`). Sau khoảng 10 giây trình duyệt mở **http://localhost:8000**:

- WebGIS: bản đồ 168 xã/phường (cả đặc khu Côn Đảo), Dự báo AI (ngày giờ hệ thống, hôm nay + 7 ngày, xu hướng tháng), Phân tích xác suất & Truy nguồn, Khuyến nghị y tế, Điểm nóng, Trợ lý AI.
- Tài liệu API: http://localhost:8000/docs · Cổng quản trị: nút khiên trên thanh tiêu đề.
- Lần đầu Windows hỏi tường lửa cho Python: chọn **Allow access** (mạng Private) để điện thoại truy cập được.

## 7. Cài ứng dụng Android

1. Chép `AirHCM.apk` sang điện thoại (cáp USB, Zalo/Drive gửi cho chính mình…).
2. Mở tệp trên điện thoại (ứng dụng **Tệp/Files → Tải xuống**), cho phép **Cài ứng dụng không rõ nguồn** khi được hỏi → **Cài đặt** → **Mở**.
3. Điện thoại và máy tính chạy Backend dùng **cùng mạng Wi-Fi**: ứng dụng tự dò máy chủ trong mạng. Nếu thanh cam *"Chưa kết nối máy chủ"* vẫn hiện, bấm **Cài đặt** trên thanh đó và nhập `http://<IP máy tính>:8000` (xem IP bằng lệnh `ipconfig`, dòng *IPv4 Address* của card Wi-Fi).
4. Hoặc cắm cáp USB (bật Gỡ lỗi USB) – `start_airhcm.bat` tự chạy `adb reverse tcp:8000 tcp:8000` nếu máy có Android SDK.

## 8. Lệnh nâng cao (không bắt buộc)

```bat
cd backend
earthengine authenticate                     :: đăng nhập Google Earth Engine (cần tài khoản GEE)
python scripts\airdata_backfill.py           :: nạp lại lịch sử từ 04/08/2022 và đồng nhất dữ liệu
python scripts\airdata_train.py              :: huấn luyện lại 6 mô hình dự báo đa hạn
python scripts\airdata_analytics.py          :: hiệu chỉnh xác suất + số liệu phân tích cho báo cáo
python scripts\airdata_export.py --out ..\data_export   :: xuất bộ dữ liệu đồng nhất ra CSV
python tests\test_airdata_synthetic.py       :: kiểm thử bằng dữ liệu giả lập
```

Chi tiết giải thuật: `docs\AIRDATA.md`. Triển khai đám mây: `docs\DEPLOY_AZURE.md`.
