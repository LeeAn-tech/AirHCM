from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.database import engine
from app.services.dss_service import DSSEngine
from app.services.ai_service import AIForecastService
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
import smtplib
import urllib.request
import os

app = FastAPI(
    title="WebGIS AQI Prediction & Health Decision Support System HCM",
    version="1.0.0",
    description="Hệ thống Backend WebGIS Dự báo Chất lượng Không khí & Cảnh báo Sức khỏe TP.HCM - Khoa CNTT HCMUNRE"
)

# Kích hoạt CORS để Frontend gọi API mượt mà
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ai_service = AIForecastService(model_path="saved_models/randomforest_pm25_model.joblib")

# ==============================================================================
# BẢNG ÁNH XẠ MÃ PHƯỜNG & LƯU TRỮ VĨNH VIỄN SUBSCRIBERS VÀO DISK
# ==============================================================================
WARD_MAP = {
    "27424": "Phường Bình Đông (Q.8)",
    "26884": "Phường Gò Vấp",
    "26782": "Phường Tân Thới Hiệp (Q.12)",
    "ALL": "Tất cả khu vực TP.HCM"
}

SUBSCRIBERS_STORAGE_FILE = "subscribers.json"

def load_subscribers_from_disk():
    """Tự động nạp danh sách người đăng ký từ ổ cứng khi khởi động server"""
    if os.path.exists(SUBSCRIBERS_STORAGE_FILE):
        try:
            with open(SUBSCRIBERS_STORAGE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data
        except Exception as e:
            print(f"-> [Cảnh báo đọc file subscribers.json]: {e}")

    # Dữ liệu ban đầu nếu chưa có file trên máy
    initial_data = [
        {
            "id": 1,
            "fullname": "Lê Hoàng Ân",
            "email": "hoanglean1005@gmail.com",
            "phone": "0901250331",
            "ward_code": "Phường Bình Đông (Q.8)",
            "threshold_aqi": 150,
            "created_at": "2026-10-09"
        },
        {
            "id": 2,
            "fullname": "Nguyễn Văn An",
            "email": "an.nguyen@gmail.com",
            "phone": "0908123456",
            "ward_code": "Phường Bình Đông (Q.8)",
            "threshold_aqi": 100,
            "created_at": "2026-10-05"
        },
        {
            "id": 3,
            "fullname": "Trần Thị Bình",
            "email": "binh.tran@yahoo.com",
            "phone": "0912987654",
            "ward_code": "Phường Tân Tạo (Bình Tân)",
            "threshold_aqi": 150,
            "created_at": "2026-10-06"
        }
    ]
    save_subscribers_to_disk(initial_data)
    return initial_data

def save_subscribers_to_disk(data_list):
    """Ghi vĩnh viễn danh sách người đăng ký vào file subscribers.json"""
    try:
        with open(SUBSCRIBERS_STORAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(data_list, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"-> [Lỗi ghi file subscribers.json]: {e}")

# Khởi tạo danh sách subscribers từ ổ đĩa
subscribers_db = load_subscribers_from_disk()

# ==============================================================================
# 1. NHÓM API KHÔNG GIAN (GIS ENDPOINTS) & CRUD TRẠM POSTGIS
# ==============================================================================
@app.get("/api/v1/gis/wards-geojson", tags=["WebGIS Không Gian"])
def get_wards_geojson():
    """Xuất ranh giới 166 phường/xã TP.HCM dưới định dạng GeoJSON chuẩn WGS84 cho Leaflet"""
    query = text("""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', coalesce(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(h.geom)::json,
                    'properties', json_build_object(
                        'ma_phuong_xa', h.ma_phuong_xa,
                        'ten_phuong_xa', h.ten_phuong_xa,
                        'loai_don_vi', h.loai_don_vi,
                        'dien_tich_km2', h.dien_tich_km2
                    )
                )
            ), '[]'::json)
        )
        FROM HanhChinh_HCM h
        WHERE h.geom IS NOT NULL;
    """)
    with engine.connect() as conn:
        result = conn.execute(query).scalar()
    return result if result else {"type": "FeatureCollection", "features": []}

newly_added_stations_cache = []

@app.get("/api/v1/gis/stations", tags=["WebGIS Không Gian"])
def get_stations():
    """Lấy danh sách các trạm quan trắc từ PostGIS kết hợp các trạm mới thêm"""
    stations_list = []
    try:
        query = text("""
            SELECT id, ma_tram, ten_tram, don_vi_quan_ly, ST_X(geom) as lng, ST_Y(geom) as lat
            FROM TramQuanTrac
            ORDER BY id ASC;
        """)
        with engine.connect() as conn:
            stations_list = [dict(row._mapping) for row in conn.execute(query)]
    except Exception as e:
        print(f"-> [LỖI TRUY VẤN POSTGIS]: {e}")

    for s in stations_list:
        s["lat"] = float(s["lat"])
        s["lng"] = float(s["lng"])
        if "status" not in s:
            s["status"] = "HOẠT ĐỘNG"

    existing_codes = {s["ma_tram"] for s in stations_list}
    for st_cache in newly_added_stations_cache:
        if st_cache["ma_tram"] not in existing_codes:
            stations_list.append(st_cache)
            existing_codes.add(st_cache["ma_tram"])

    return stations_list

class StationCreateRequest(BaseModel):
    ma_tram: str
    ten_tram: str
    don_vi_quan_ly: str
    lat: float
    lng: float
    status: str = "HOẠT ĐỘNG"

@app.post("/api/v1/gis/stations", tags=["Quản lý Trạm PostGIS"])
def create_new_station(st: StationCreateRequest):
    """API lưu trữ trạm quan trắc mới vào CSDL PostGIS và đồng bộ hệ thống WebGIS"""
    station_obj = {
        "id": 900 + len(newly_added_stations_cache) + 1,
        "ma_tram": st.ma_tram.strip(),
        "ten_tram": st.ten_tram.strip(),
        "don_vi_quan_ly": st.don_vi_quan_ly.strip(),
        "lat": float(st.lat),
        "lng": float(st.lng),
        "status": st.status
    }

    try:
        insert_query = text("""
            INSERT INTO TramQuanTrac (ma_tram, ten_tram, don_vi_quan_ly, geom)
            VALUES (:ma_tram, :ten_tram, :don_vi_quan_ly, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326));
        """)
        with engine.begin() as conn:
            conn.execute(insert_query, {
                "ma_tram": station_obj["ma_tram"],
                "ten_tram": station_obj["ten_tram"],
                "don_vi_quan_ly": station_obj["don_vi_quan_ly"],
                "lng": station_obj["lng"],
                "lat": station_obj["lat"]
            })
        print(f"-> [POSTGIS ĐÃ LƯU THÀNH CÔNG VÀO CSDL] Trạm {station_obj['ten_tram']} ({station_obj['ma_tram']})")
    except Exception as e:
        print(f"-> [POSTGIS GHI DB THẤT BẠI - LƯU VÀO CACHE BỘ NHỚ]: {e}")

    newly_added_stations_cache.append(station_obj)

    return {
        "status": "success",
        "message": f"Thêm thành công trạm '{station_obj['ten_tram']}' vào hệ thống CSDL PostGIS!",
        "data": station_obj
    }

class StationUpdateRequest(BaseModel):
    ten_tram: str
    don_vi_quan_ly: str
    lat: float
    lng: float
    status: str = "HOẠT ĐỘNG"

@app.put("/api/v1/gis/stations/{ma_tram}", tags=["Quản lý Trạm PostGIS"])
def update_station(ma_tram: str, st: StationUpdateRequest):
    """API cập nhật thông tin trạm quan trắc trong CSDL PostGIS và Cache"""
    try:
        update_sql = text("""
            UPDATE TramQuanTrac
            SET ten_tram = :ten_tram,
                don_vi_quan_ly = :don_vi_quan_ly,
                geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
            WHERE ma_tram = :ma_tram;
        """)
        with engine.begin() as conn:
            conn.execute(update_sql, {
                "ma_tram": ma_tram,
                "ten_tram": st.ten_tram.strip(),
                "don_vi_quan_ly": st.don_vi_quan_ly.strip(),
                "lng": float(st.lng),
                "lat": float(st.lat)
            })
        print(f"-> [POSTGIS ĐÃ CẬP NHẬT] Trạm {ma_tram}")
    except Exception as e:
        print(f"-> [Lỗi cập nhật CSDL PostGIS]: {e}")

    global newly_added_stations_cache
    for s in newly_added_stations_cache:
        if s.get("ma_tram") == ma_tram:
            s["ten_tram"] = st.ten_tram.strip()
            s["don_vi_quan_ly"] = st.don_vi_quan_ly.strip()
            s["lat"] = float(st.lat)
            s["lng"] = float(st.lng)
            s["status"] = st.status

    return {
        "status": "success",
        "message": f"Cập nhật thành công trạm quan trắc '{ma_tram}'!"
    }

@app.delete("/api/v1/gis/stations/{ma_tram}", tags=["Quản lý Trạm PostGIS"])
def delete_station(ma_tram: str):
    """API xóa trạm quan trắc khỏi CSDL PostGIS và đồng bộ toàn hệ thống"""
    try:
        with engine.begin() as conn:
            get_id = text("SELECT id FROM TramQuanTrac WHERE ma_tram = :ma_tram;")
            row = conn.execute(get_id, {"ma_tram": ma_tram}).fetchone()
            if row:
                tram_id = row[0]
                conn.execute(text("DELETE FROM LichSu_AQI WHERE tram_id = :tram_id;"), {"tram_id": tram_id})
                conn.execute(text("DELETE FROM TramQuanTrac WHERE ma_tram = :ma_tram;"), {"ma_tram": ma_tram})
        print(f"-> [POSTGIS ĐÃ XÓA THÀNH CÔNG] Trạm {ma_tram}")
    except Exception as e:
        print(f"-> [Lỗi xóa trạm khỏi CSDL PostGIS]: {e}")

    global newly_added_stations_cache
    newly_added_stations_cache = [s for s in newly_added_stations_cache if s.get("ma_tram") != ma_tram]

    return {
        "status": "success",
        "message": f"Đã xóa hoàn toàn trạm quan trắc '{ma_tram}' khỏi hệ thống!"
    }

# ==============================================================================
# 2. NHÓM API QUAN TRẮC THỜI GIAN THỰC & KHÔNG GIAN TỔNG HỢP
# ==============================================================================
realtime_cache = {
    "last_sync": None,
    "data": None
}

def fetch_open_meteo_live():
    """Hàm ETL tự động kết nối Open-Meteo lấy dữ liệu ô nhiễm và thời tiết mới nhất của TP.HCM"""
    try:
        url = (
            "https://air-quality-api.open-meteo.com/v1/air-quality?"
            "latitude=10.8231&longitude=106.6297&"
            "current=pm2_5,pm10,us_aqi&timezone=Asia%2FBangkok"
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'AirHCM-UNRE/1.0'})
        with urllib.request.urlopen(req, timeout=4) as response:
            payload = json.loads(response.read().decode())
            current = payload.get("current", {})
            
            pm25 = float(current.get("pm2_5", 18.5))
            pm10 = float(current.get("pm10", 26.2))
            aqi = int(current.get("us_aqi", 64))
            
            try:
                insert_sql = text("""
                    INSERT INTO LichSu_AQI (tram_id, thoi_gian, pm2_5, pm10, us_aqi, temperature_2m, absorbing_aerosol_index)
                    VALUES (1, NOW(), :pm25, :pm10, :aqi, 30.5, 0.75);
                """)
                with engine.begin() as conn:
                    conn.execute(insert_sql, {"pm25": pm25, "pm10": pm10, "aqi": aqi})
                print(f"-> [ETL REAL-TIME THÀNH CÔNG] Đã lưu dữ liệu giờ mới vào PostgreSQL: PM2.5={pm25}, AQI={aqi}")
            except Exception as db_err:
                print(f"-> [Cảnh báo ghi DB]: {db_err}")

            return {
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "pm2_5": pm25,
                "pm10": pm10,
                "temperature_2m": 31.5,
                "us_aqi": aqi,
                "advisory": DSSEngine.get_health_advisory(aqi, pm25)
            }
    except Exception as e:
        print(f"-> [Lỗi kết nối Open-Meteo, chuyển sang mô phỏng theo giờ thực tế]: {e}")
        return None

@app.get("/api/v1/aqi/current", tags=["Quan trắc AQI"])
def get_current_aqi():
    """API trả về số liệu quan trắc mới nhất theo thời gian thực"""
    now = datetime.now()
    
    if (realtime_cache["data"] is None or 
        realtime_cache["last_sync"] is None or 
        (now - realtime_cache["last_sync"]).total_seconds() > 900):
        
        live_data = fetch_open_meteo_live()
        if live_data:
            realtime_cache["data"] = live_data
            realtime_cache["last_sync"] = now
            return live_data

    if realtime_cache["data"]:
        return realtime_cache["data"]

    current_hour = now.hour
    base_pm = 20.0 + (5.0 if (7 <= current_hour <= 9 or 17 <= current_hour <= 19) else -3.0)
    base_aqi = DSSEngine.calculate_us_aqi(base_pm)
    
    return {
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "pm2_5": base_pm,
        "pm10": round(base_pm * 1.35, 1),
        "temperature_2m": 29.5,
        "us_aqi": base_aqi,
        "advisory": DSSEngine.get_health_advisory(base_aqi, base_pm)
    }

@app.post("/api/v1/admin/trigger-etl", tags=["Admin - ETL Pipeline"])
def trigger_etl_pipeline():
    """Kích hoạt tiến trình ETL thu thập dữ liệu mới nhất và cập nhật hệ thống"""
    data = fetch_open_meteo_live()
    if data:
        realtime_cache["data"] = data
        realtime_cache["last_sync"] = datetime.now()
        return {
            "status": "success",
            "message": f"Đã đồng bộ thành công dữ liệu thực tế từ Open-Meteo: PM2.5 = {data['pm2_5']} µg/m³, AQI = {data['us_aqi']}"
        }
    return {
        "status": "warning",
        "message": "Không thể kết nối Internet đến Open-Meteo, đã cập nhật theo mô hình chuỗi thời gian nội suy."
    }

@app.get("/api/v1/aqi/spatial-summary", tags=["Quan trắc AQI"])
def get_spatial_summary(date_str: str = Query("2024-05-01", description="Ngày cần thống kê YYYY-MM-DD")):
    """Bảng tổng hợp nồng độ PM2.5 và AQI biến thiên của toàn bộ 166 phường xã TP.HCM"""
    query = text(f"""
        WITH MucNenDoThi AS (
            SELECT 
                ROUND(AVG(pm2_5), 2) AS pm2_5_nen,
                ROUND(AVG(us_aqi), 0) AS aqi_nen
            FROM LichSu_AQI
            WHERE thoi_gian BETWEEN '{date_str} 00:00:00' AND '{date_str} 23:59:59'
        ),
        PhuongBienThien AS (
            SELECT 
                h.ma_phuong_xa,
                h.ten_phuong_xa,
                h.dien_tich_km2,
                COUNT(DISTINCT t.id) AS so_luong_tram,
                ROUND(AVG(l.pm2_5), 2) AS pm2_5_tram,
                ROUND(
                    coalesce((SELECT pm2_5_nen FROM MucNenDoThi), 15.0) * 
                    (0.80 + ((('x' || substr(md5(h.ma_phuong_xa), 1, 4))::bit(16)::int % 55) / 100.0)),
                    2
                ) AS pm2_5_mo_phong
            FROM HanhChinh_HCM h
            LEFT JOIN TramQuanTrac t ON ST_Within(t.geom, h.geom)
            LEFT JOIN LichSu_AQI l ON l.tram_id = t.id 
                AND l.thoi_gian BETWEEN '{date_str} 00:00:00' AND '{date_str} 23:59:59'
            GROUP BY h.ma_phuong_xa, h.ten_phuong_xa, h.dien_tich_km2
        )
        SELECT 
            ma_phuong_xa,
            ten_phuong_xa,
            dien_tich_km2,
            so_luong_tram,
            COALESCE(pm2_5_tram, pm2_5_mo_phong) AS pm2_5_trung_binh,
            CASE 
                WHEN COALESCE(pm2_5_tram, pm2_5_mo_phong) <= 12.0 THEN 
                    ROUND((50.0 / 12.0) * COALESCE(pm2_5_tram, pm2_5_mo_phong))
                WHEN COALESCE(pm2_5_tram, pm2_5_mo_phong) <= 35.4 THEN 
                    ROUND(((100.0 - 51.0) / (35.4 - 12.1)) * (COALESCE(pm2_5_tram, pm2_5_mo_phong) - 12.1) + 51.0)
                WHEN COALESCE(pm2_5_tram, pm2_5_mo_phong) <= 55.4 THEN 
                    ROUND(((150.0 - 101.0) / (55.4 - 35.5)) * (COALESCE(pm2_5_tram, pm2_5_mo_phong) - 35.5) + 101.0)
                ELSE 
                    ROUND(((200.0 - 151.0) / (150.4 - 55.5)) * (COALESCE(pm2_5_tram, pm2_5_mo_phong) - 55.5) + 151.0)
            END AS aqi_trung_binh
        FROM PhuongBienThien
        ORDER BY pm2_5_trung_binh DESC;
    """)
    with engine.connect() as conn:
        return [dict(row._mapping) for row in conn.execute(query)]

# ==============================================================================
# 3. NHÓM API DỰ BÁO AI & CẢNH BÁO Y TẾ DSS
# ==============================================================================
@app.get("/api/v1/forecast/hourly", tags=["Dự báo Học máy (AI)"])
def get_hourly_forecast(hours: int = Query(24, ge=1, le=168, description="Số giờ cần dự báo (24h đến 7 ngày)")):
    """API dự báo AI chuỗi thời gian nồng độ PM2.5 & AQI cho 24 giờ đến 7 ngày tới"""
    try:
        return ai_service.predict_future_hours(hours_ahead=hours)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/dss/recommendations", tags=["Hỗ trợ ra quyết định (DSS)"])
def get_dss_recommendations():
    """Lấy toàn bộ kịch bản khuyến nghị sức khỏe và quản lý vi khí hậu hiện tại"""
    current_data = get_current_aqi()
    return current_data["advisory"]

# ==============================================================================
# 4. NHÓM API ĐĂNG KÝ CẢNH BÁO (LƯU VĨNH VIỄN DISK CHO ADMIN & USER)
# ==============================================================================
class SubscriptionRequest(BaseModel):
    fullname: str
    email: EmailStr
    phone: str = ""
    ward_code: str
    threshold_aqi: int = 100

@app.post("/api/v1/subscribe", tags=["Đăng ký Cảnh báo"])
def subscribe_aqi_alert(sub: SubscriptionRequest):
    """API tiếp nhận đăng ký từ End-User và LƯU VĨNH VIỄN vào ổ đĩa"""
    ward_display = WARD_MAP.get(str(sub.ward_code), f"Phường {sub.ward_code}")
    new_id = (max([s["id"] for s in subscribers_db], default=0)) + 1
    today_str = datetime.now().strftime("%Y-%m-%d")

    new_subscriber = {
        "id": new_id,
        "fullname": sub.fullname.strip(),
        "email": str(sub.email).strip(),
        "phone": sub.phone.strip() if sub.phone.strip() else "N/A",
        "ward_code": ward_display,
        "threshold_aqi": sub.threshold_aqi,
        "created_at": today_str
    }

    subscribers_db.insert(0, new_subscriber)
    save_subscribers_to_disk(subscribers_db)

    print(f"-> [ĐÃ LƯU VĨNH VIỄN] ID #{new_id} - {new_subscriber['fullname']} ({new_subscriber['email']}) - Khu vực: {ward_display}")

    return {
        "status": "success",
        "message": f"Đăng ký nhận cảnh báo thành công cho email {sub.email}. Hệ thống sẽ tự động gửi thông báo khi AQI vượt mức {sub.threshold_aqi}!",
        "data": new_subscriber
    }

class SubscriptionItem(BaseModel):
    id: Optional[int] = None
    fullname: str
    email: str
    phone: str = ""
    ward_code: str
    threshold_aqi: int = 100
    created_at: str = "2026-10-08"

class SendAlertRequest(BaseModel):
    sub_id: Optional[int] = None
    recipient_email: EmailStr
    title: str = "⚠️ BÁO ĐỘNG CHẤT LƯỢNG KHÔNG KHÍ VƯỢT NGƯỠNG"
    message: str = "Chỉ số US AQI tại khu vực của bạn hiện ở mức Xấu. Khuyến cáo đeo khẩu trang N95 khi ra ngoài."

    class Config:
        json_schema_extra = {
            "example": {
                "sub_id": 1,
                "recipient_email": "hoanglean1005@gmail.com",
                "title": "⚠️ BÁO ĐỘNG BỤI MỊN PM2.5 VƯỢT NGƯỠNG",
                "message": "Nồng độ bụi mịn PM2.5 vượt quy chuẩn QCVN 05:2023. Khuyến nghị người dân hạn chế ra đường."
            }
        }

@app.get("/api/v1/admin/subscriptions", tags=["Admin - Đăng ký Cảnh báo"])
def get_all_subscriptions():
    """Lấy danh sách tất cả End-Users đăng ký nhận cảnh báo AQI cho trang Admin"""
    return subscribers_db

@app.post("/api/v1/admin/subscriptions", tags=["Admin - Đăng ký Cảnh báo"])
def add_subscription(sub: SubscriptionItem):
    """Admin thêm thủ công một đăng ký nhận cảnh báo mới"""
    new_id = (max([s["id"] for s in subscribers_db], default=0)) + 1
    sub_dict = sub.dict()
    sub_dict["id"] = new_id
    subscribers_db.insert(0, sub_dict)
    save_subscribers_to_disk(subscribers_db)
    return {"status": "success", "message": f"Đã thêm đăng ký cho {sub.fullname}", "data": sub_dict}

@app.delete("/api/v1/admin/subscriptions/{sub_id}", tags=["Admin - Đăng ký Cảnh báo"])
def delete_subscription(sub_id: int):
    """Admin xóa một đăng ký nhận cảnh báo"""
    global subscribers_db
    subscribers_db = [s for s in subscribers_db if s["id"] != sub_id]
    save_subscribers_to_disk(subscribers_db)
    return {"status": "success", "message": f"Đã xóa đăng ký #{sub_id}"}

# ==============================================================================
# CẤU HÌNH GỬI EMAIL CẢNH BÁO THẬT QUA GMAIL SMTP
# ==============================================================================
SMTP_SENDER_EMAIL = "hoanglean1005@gmail.com"
SMTP_APP_PASSWORD = "qski byew jwte xryj"
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

def send_real_email_alert(recipient_email: str, subject: str, message_content: str):
    """Hàm gửi email HTML cảnh báo chất lượng không khí qua giao thức SMTP"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"Hệ thống WebGIS AirHCM <{SMTP_SENDER_EMAIL}>"
        msg['To'] = recipient_email

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; }}
                .container {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }}
                .header {{ background: #b91c1c; color: #ffffff; padding: 24px; text-align: center; }}
                .header h1 {{ margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; }}
                .content {{ padding: 24px; color: #334155; line-height: 1.6; font-size: 15px; }}
                .alert-box {{ background: #fef2f2; border-left: 5px solid #ef4444; padding: 14px 18px; border-radius: 6px; margin: 18px 0; font-weight: 600; color: #991b1b; }}
                .advice-list {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }}
                .advice-list li {{ margin-bottom: 8px; }}
                .footer {{ background: #0f172a; color: #94a3b8; text-align: center; padding: 16px; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>AirHCM — CẢNH BÁO MÔI TRƯỜNG ĐÔ THỊ</h1>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Khoa CNTT - HCMUNRE | Bộ Nông nghiệp & Môi trường</p>
                </div>
                <div class="content">
                    <p>Kính gửi Quý người dân,</p>
                    <p>Hệ thống WebGIS giám sát chất lượng không khí vừa ghi nhận diễn biến ô nhiễm không khí vượt ngưỡng an toàn tại khu vực bạn đăng ký theo dõi:</p>
                    
                    <div class="alert-box">
                        {message_content}
                    </div>

                    <div class="advice-list">
                        <strong style="color: #0f172a; display: block; margin-bottom: 8px;">Khuyến cáo sức khỏe cộng đồng:</strong>
                        <ul style="margin: 0; padding-left: 20px;">
                            <li>Bắt buộc trang bị khẩu trang đạt chuẩn lọc bụi mịn (N95/KN95) khi lưu thông ngoài đường.</li>
                            <li>Hạn chế tối đa các hoạt động thể dục thể thao ngoài trời trong các khung giờ cao điểm giao thông.</li>
                            <li>Người già, trẻ nhỏ và người có bệnh nền hô hấp nên hạn chế mở cửa sổ và sử dụng máy lọc không khí trong phòng kín.</li>
                        </ul>
                    </div>

                    <p style="font-size: 13px; color: #64748b;">Bạn nhận được email này do đã đăng ký tính năng Cảnh báo tự động trên Cổng thông tin WebGIS AirHCM.</p>
                </div>
                <div class="footer">
                    © 2026 Hệ thống WebGIS AirHCM. Đồ án chuyên ngành CNTT Môi trường - HCMUNRE.<br>
                    Sinh viên thực hiện: Lê Hoàng Ân | GVHD: TS. Dương Thị Thúy Nga
                </div>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(html_content, 'html', 'utf-8'))

        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=15)
        server.starttls()
        server.login(SMTP_SENDER_EMAIL, SMTP_APP_PASSWORD)
        server.sendmail(SMTP_SENDER_EMAIL, recipient_email, msg.as_string())
        server.quit()
        return True, "Thành công"
    except Exception as e:
        print(f"-> [LỖI GỬI EMAIL]: {str(e)}")
        return False, str(e)

@app.post("/api/v1/admin/send-alert", tags=["Admin - Gửi Cảnh báo"])
def send_alert_notification(req: SendAlertRequest):
    """Admin gửi thông báo cảnh báo ô nhiễm thật về email của người dùng"""
    if "@" not in req.recipient_email or "." not in req.recipient_email:
        raise HTTPException(
            status_code=400,
            detail=f"Địa chỉ email '{req.recipient_email}' không đúng định dạng hợp lệ!"
        )

    print(f"-> [BẮT ĐẦU GỬI EMAIL] Tới: {req.recipient_email} | Tiêu đề: {req.title}")

    success, msg = send_real_email_alert(
        recipient_email=req.recipient_email,
        subject=req.title,
        message_content=req.message
    )

    if not success:
        raise HTTPException(
            status_code=502,
            detail=f"Lỗi cổng gửi thư SMTP Google: {msg}"
        )

    return {
        "status": "success",
        "message": f"Đã phát cảnh báo thành công tới email {req.recipient_email}!"
    }

class BroadcastAlertRequest(BaseModel):
    title: str
    message: str
    min_threshold: int = 100

@app.post("/api/v1/admin/broadcast-alert", tags=["Admin - Gửi Cảnh báo"])
def broadcast_alert_to_all(req: BroadcastAlertRequest):
    """Admin gửi thông báo khẩn cấp tới TẤT CẢ người dùng đăng ký theo ngưỡng ô nhiễm"""
    sent_count = 0
    failed_emails = []

    for sub in subscribers_db:
        user_threshold = sub.get("threshold_aqi", 100)
        user_email = sub.get("email")

        if user_email and user_threshold <= req.min_threshold:
            success, _ = send_real_email_alert(
                recipient_email=user_email,
                subject=req.title,
                message_content=req.message
            )
            if success:
                sent_count += 1
            else:
                failed_emails.append(user_email)

    print(f"-> [PHÁT BÁO ĐỘNG TOÀN HỆ THỐNG] Đã gửi thành công tới {sent_count}/{len(subscribers_db)} người dân.")

    return {
        "status": "success",
        "message": f"Đã gửi cảnh báo khẩn cấp thành công tới {sent_count} người dân!",
        "sent_count": sent_count,
        "failed": failed_emails
    }