"""
CẤU HÌNH PHÂN HỆ DỮ LIỆU KHÔNG KHÍ ĐA CHẤT (AirData)

Gồm danh mục chất ô nhiễm, nguồn dữ liệu và độ phân giải gốc, tham số của giải thuật
đồng nhất (harmonization) và đường dẫn lưu mô hình. Mọi giá trị đều có thể ghi đè bằng
biến môi trường (xem backend/.env) để không phải sửa mã nguồn.
"""
import os
from datetime import date

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_DIR = os.getenv("AIRDATA_MODEL_DIR", os.path.join(BACKEND_DIR, "saved_models", "airdata"))

# Múi giờ hiển thị/lưu trữ (TIMESTAMP WITHOUT TIME ZONE theo giờ Việt Nam, UTC+7)
TIMEZONE = "Asia/Ho_Chi_Minh"
UTC_OFFSET_HOURS = 7

# Ngày đầu có dữ liệu CAMS toàn cầu trên Open-Meteo (08/2022)
HISTORY_START = date(2022, 8, 4)

# ------------------------------------------------------------------------------
# GOOGLE EARTH ENGINE
# ------------------------------------------------------------------------------
GEE_PROJECT = os.getenv("AIRDATA_GEE_PROJECT", "master-magnet-470812-h1")
GEE_WARD_ASSET = os.getenv("AIRDATA_GEE_WARD_ASSET", "projects/master-magnet-470812-h1/assets/PhuongXa_HCM")
GEE_WARD_CODE_FIELD = os.getenv("AIRDATA_GEE_WARD_CODE_FIELD", "ma_xa")
# Tùy chọn: tài khoản dịch vụ (service account) cho máy chủ; bỏ trống -> dùng thông tin đăng nhập
# đã lưu bởi lệnh `earthengine authenticate`
GEE_SERVICE_ACCOUNT = os.getenv("AIRDATA_GEE_SERVICE_ACCOUNT", "")
GEE_KEY_FILE = os.getenv("AIRDATA_GEE_KEY_FILE", "")

# ------------------------------------------------------------------------------
# DANH MỤC CHẤT Ô NHIỄM
#   om        : tên biến trên Open-Meteo Air Quality API (CAMS toàn cầu)
#   pattern   : lớp vệ tinh dùng làm "mẫu không gian" khi hạ quy mô (None = không hạ quy mô)
#   alpha     : hệ số co (shrinkage) 0..1 của tỷ số không gian vệ tinh; phản ánh mức độ cột khí
#               vệ tinh đại diện cho nồng độ sát mặt đất (tham số hiệu chỉnh được)
#   mw        : khối lượng mol (g/mol) để đổi µg/m³ <-> ppb (25 °C, 1 atm)
#   qcvn      : giới hạn QCVN 05:2023/BTNMT (µg/Nm³) theo thời gian trung bình
#   forecast  : có huấn luyện mô hình dự báo ML hay không
# ------------------------------------------------------------------------------
POLLUTANTS = {
    "pm2_5": {
        "name": "PM2.5", "full": "Bụi mịn PM2.5", "unit": "µg/m³", "om": "pm2_5",
        "pattern": "aod", "alpha": 0.6, "mw": None, "forecast": True,
        "qcvn": {"24h": 50.0, "year": 25.0},
    },
    "pm10": {
        "name": "PM10", "full": "Bụi PM10", "unit": "µg/m³", "om": "pm10",
        "pattern": "aod", "alpha": 0.6, "mw": None, "forecast": True,
        "qcvn": {"24h": 100.0, "year": 50.0},
    },
    "co": {
        "name": "CO", "full": "Cacbon monoxit", "unit": "µg/m³", "om": "carbon_monoxide",
        "pattern": "co", "alpha": 0.5, "mw": 28.01, "forecast": True,
        "qcvn": {"1h": 30000.0, "8h": 10000.0},
    },
    "no2": {
        "name": "NO2", "full": "Nitơ đioxit", "unit": "µg/m³", "om": "nitrogen_dioxide",
        "pattern": "no2", "alpha": 0.8, "mw": 46.01, "forecast": True,
        "qcvn": {"1h": 200.0, "24h": 100.0, "year": 40.0},
    },
    "so2": {
        "name": "SO2", "full": "Lưu huỳnh đioxit", "unit": "µg/m³", "om": "sulphur_dioxide",
        "pattern": "so2", "alpha": 0.3, "mw": 64.07, "forecast": True,
        "qcvn": {"1h": 350.0, "24h": 125.0, "year": 50.0},
    },
    "o3": {
        # Cột O3 vệ tinh chủ yếu là O3 tầng bình lưu -> không dùng làm mẫu không gian sát mặt đất
        "name": "O3", "full": "Ozon", "unit": "µg/m³", "om": "ozone",
        "pattern": None, "alpha": 0.0, "mw": 48.00, "forecast": True,
        "qcvn": {"1h": 200.0, "8h": 120.0},
    },
    "co2": {
        # CAMS Greenhouse Gas Forecast (0,1°) - chỉ có từ 11/2024; không thuộc VN_AQI/US AQI
        "name": "CO2", "full": "Cacbon đioxit", "unit": "ppm", "om": "carbon_dioxide",
        "pattern": None, "alpha": 0.0, "mw": None, "forecast": False, "qcvn": {},
    },
}
AQI_POLLUTANTS = ["pm2_5", "pm10", "co", "no2", "so2", "o3"]
FORECAST_POLLUTANTS = [k for k, v in POLLUTANTS.items() if v["forecast"]]

# Biến phụ từ CAMS dùng làm đặc trưng (không hiển thị như chất ô nhiễm)
CAMS_EXTRA = {"dust": "dust", "aod": "aerosol_optical_depth"}


def qcvn_pm25_24h(day: date = None) -> float:
    """QCVN 05:2023/BTNMT: PM2.5 TB 24h = 50 µg/m³, giảm còn 45 µg/m³ từ 01/01/2026 (ghi chú (*))"""
    day = day or date.today()
    return 45.0 if day >= date(2026, 1, 1) else 50.0


def qcvn_limits(day: date = None) -> dict:
    out = {k: dict(v["qcvn"]) for k, v in POLLUTANTS.items()}
    out["pm2_5"]["24h"] = qcvn_pm25_24h(day)
    return out


# ------------------------------------------------------------------------------
# KHÍ TƯỢNG (đặc trưng đầu vào của mô hình)
# ------------------------------------------------------------------------------
WEATHER_VARS = ["temperature_2m", "dewpoint_2m", "relative_humidity", "wind_speed", "wind_dir",
                "precipitation", "surface_pressure"]

# ------------------------------------------------------------------------------
# NGUỒN DỮ LIỆU VÀ ĐỘ PHÂN GIẢI GỐC (dùng cho API /air/sources và báo cáo)
# ------------------------------------------------------------------------------
SOURCES = [
    {"id": "cams", "name": "CAMS Global Atmospheric Composition Forecasts (Open-Meteo Air Quality API)",
     "variables": "PM2.5, PM10, CO, NO2, SO2, O3, bụi, AOD", "spatial": "0,4° (~45 km)",
     "temporal": "3 giờ (nội suy theo giờ), dự báo 5 ngày, cập nhật 12 giờ/lần", "since": "08/2022"},
    {"id": "cams_ghg", "name": "CAMS Global Greenhouse Gas Forecast (Open-Meteo)",
     "variables": "CO2", "spatial": "0,1° (~11 km)", "temporal": "3 giờ, cập nhật 24 giờ/lần", "since": "11/2024"},
    {"id": "s5p", "name": "Sentinel-5P TROPOMI L3 (GEE: COPERNICUS/S5P/OFFL|NRTI)",
     "variables": "Cột NO2 tầng đối lưu, SO2, CO, O3, chỉ số sol khí hấp thụ", "spatial": "lưới 0,01° (1.113 m)",
     "temporal": "1 lần/ngày (~13:30 giờ địa phương), có khoảng trống do mây", "since": "07/2018"},
    {"id": "maiac", "name": "MODIS MAIAC AOD 550 nm (GEE: MODIS/061/MCD19A2_GRANULES)",
     "variables": "Độ dày quang học sol khí", "spatial": "1 km", "temporal": "1-2 lần/ngày, có khoảng trống do mây",
     "since": "2000"},
    {"id": "era5land", "name": "ERA5-Land Hourly (GEE: ECMWF/ERA5_LAND/HOURLY)",
     "variables": "Nhiệt độ, điểm sương, gió u/v 10 m, mưa, áp suất", "spatial": "0,1° (~11 km)",
     "temporal": "1 giờ, trễ ~5 ngày", "since": "1950"},
    {"id": "om_weather", "name": "Open-Meteo Weather Forecast API",
     "variables": "Nhiệt độ, điểm sương, độ ẩm, gió, mưa, áp suất", "spatial": "~9-11 km (mô hình tốt nhất)",
     "temporal": "1 giờ, dự báo 7-16 ngày", "since": "-"},
]
TARGET_RESOLUTION = {"spatial": "168 phường/xã (hạ quy mô trên lưới 0,01° ≈ 1,1 km)", "temporal": "1 giờ"}

# ------------------------------------------------------------------------------
# THAM SỐ GIẢI THUẬT ĐỒNG NHẤT
# ------------------------------------------------------------------------------
CAMS_GRID_STEP = 0.4            # độ - lưới CAMS toàn cầu
CAMS_GHG_GRID_STEP = 0.1        # độ - lưới CAMS khí nhà kính
SAT_SCALE_M = 1113.2            # m - lưới Sentinel-5P L3 trên GEE
SAT_CONTEXT_RADIUS_M = int(os.getenv("AIRDATA_SAT_CONTEXT_RADIUS_M", "22000"))  # ~ nửa ô CAMS 0,4°
SAT_COMPOSITE_DAYS = int(os.getenv("AIRDATA_SAT_COMPOSITE_DAYS", "30"))         # tổ hợp trượt lấp mây
RATIO_CLIP = (0.5, 2.0)         # giới hạn hệ số hạ quy mô
MAX_INTERP_GAP_H = 3            # nội suy tuyến tính khoảng trống ≤ 3 giờ
BIAS_WINDOW_H = 72              # cửa sổ chồng lấp để hiệu chỉnh độ lệch hai nguồn khí tượng

# ------------------------------------------------------------------------------
# DỰ BÁO
# ------------------------------------------------------------------------------
FORECAST_HORIZON_H = 192        # đủ phủ hết ngày thứ 7 kể từ hôm nay (hôm nay + 7 ngày)
WEATHER_FORECAST_DAYS = 9       # Open-Meteo Weather: đủ cho FORECAST_HORIZON_H
CAMS_FORECAST_DAYS = 7          # Open-Meteo Air Quality: tối đa 7 ngày (CAMS toàn cầu ~5 ngày)
MONTHLY_OUTLOOK_MONTHS = int(os.getenv("AIRDATA_MONTHLY_OUTLOOK", "3"))
LAGS_H = [0, 1, 2, 3, 6, 12, 24]
ROLL_H = [6, 24, 72, 168]
TRAIN_ISSUE_STEP_H = int(os.getenv("AIRDATA_TRAIN_ISSUE_STEP_H", "3"))
TRAIN_HORIZONS = list(range(1, 25)) + list(range(27, 73, 3)) + list(range(78, 193, 6))
SPATIAL_FACTOR_DAYS = 14        # số ngày gần nhất để ước lượng hệ số không gian phường/TP
VERIFY_MIN_PAIRS = 24 * 14      # cần ≥ 14 ngày đối chiếu mới bật trọng số kết hợp ML-CAMS


# ==============================================================================
# BỔ SUNG THEO TÀI LIỆU "HỆ THỐNG DỰ BÁO, PHÂN TÍCH XÁC SUẤT VÀ TRUY TÌM NGUỒN THẢI"
# (ngưỡng WHO, quy đổi điều kiện chuẩn, QA/QC, hoa gió, xác suất, rủi ro, truy nguồn, kịch bản)
# ==============================================================================

# Hướng dẫn chất lượng không khí WHO 2021 (AQG level, µg/m³; CO 4 mg/m³ = 4.000 µg/m³).
# Là khuyến nghị sức khỏe, KHÔNG phải quy chuẩn pháp lý; dùng song song với QCVN 05:2023.
WHO_AQG_2021 = {
    "pm2_5": {"24h": 15.0, "year": 5.0},
    "pm10": {"24h": 45.0, "year": 15.0},
    "no2": {"24h": 25.0, "year": 10.0},
    "so2": {"24h": 40.0},
    "o3": {"8h": 100.0, "peak_season": 60.0},
    "co": {"24h": 4000.0},
}

# QCVN 05:2023/BTNMT mục 1.3.10: Nm³ là m³ khí ở 25 °C và áp suất tuyệt đối 760 mmHg.
# CAMS/Open-Meteo và phần lớn mạng quan trắc cho µg/m³ ở điều kiện khí tượng thực tế ->
# quy đổi C_N = C_thực × (T_thực / 298,15 K) × (1013,25 hPa / P_thực) trước khi so với QCVN.
NORMAL_T_K = 298.15
NORMAL_P_HPA = 1013.25

# Kỳ trung bình dùng để so sánh ngưỡng theo ngày (thống kê ngày của mỗi chất)
#   mean24 = TB 24 giờ; max8 = cực đại TB trượt 8 giờ; max1 = cực đại 1 giờ
STANDARD_PERIOD = {"24h": "mean24", "8h": "max8", "1h": "max1"}

# ------------------------------------------------------------------------------
# QA/QC
# ------------------------------------------------------------------------------
QC_MIN_HOURS_24H = int(os.getenv("AIRDATA_QC_MIN_HOURS_24H", "18"))   # TB 24h hợp lệ khi đủ ≥ 18/24 giờ (75%)
QC_MIN_HOURS_8H = 6                                                   # TB 8h hợp lệ khi đủ ≥ 6/8 giờ
QC_COMPLETENESS_TARGET = 0.80                                         # tiêu chí nghiệm thu ≥ 80% giờ có dữ liệu
QC_SPIKE_WINDOW_H = 25                                                # cửa sổ Hampel (giờ, lẻ)
QC_SPIKE_K = 6.0                                                      # ngưỡng |x - trung vị| > k·1,4826·MAD
QC_FLAT_HOURS = 6                                                     # chuỗi đứng (giá trị y hệt) ≥ 6 giờ
QC_MAX_PLAUSIBLE = {"pm2_5": 1000, "pm10": 2000, "co": 60000, "no2": 2000, "so2": 2600, "o3": 1200, "co2": 2000}

# ------------------------------------------------------------------------------
# HOA GIÓ & HOA GIÓ Ô NHIỄM
# ------------------------------------------------------------------------------
CALM_WS = float(os.getenv("AIRDATA_CALM_WS", "0.5"))     # m/s: dưới ngưỡng -> lớp "lặng gió" riêng
CALM_SENSITIVITY = [0.3, 0.5, 1.0]                      # kiểm tra độ nhạy theo ngưỡng lặng gió
WIND_SPEED_BINS = [0.5, 2.0, 4.0, 6.0]                  # m/s: lớp tốc độ gió (CALM | 0,5-2 | 2-4 | 4-6 | ≥ 6)
ROSE_MIN_COUNT = 30                                     # hướng có < 30 bản ghi -> gắn cờ "ít mẫu", không kết luận
# Ngưỡng giờ mặc định cho P(C > T | hướng): giá trị "Trung bình -> Kém" của VN_AQI theo giờ (µg/m³)
ROSE_DEFAULT_T = {"pm2_5": 50.0, "pm10": 150.0, "no2": 100.0, "so2": 125.0, "co": 10000.0, "o3": 160.0}

# ------------------------------------------------------------------------------
# DỰ BÁO XÁC SUẤT
# ------------------------------------------------------------------------------
QUANTILES = [0.05, 0.50, 0.95]                          # khoảng dự báo 90%
UNCERTAINTY_FILE = os.path.join(MODEL_DIR, "uncertainty.json")
ANALYTICS_DIR = os.path.join(MODEL_DIR, "analytics")
N_RESIDUAL_SAMPLES = 400                                # số mẫu sai số (ensemble thực nghiệm) mỗi nhóm hạn

# ------------------------------------------------------------------------------
# SỨC KHỎE & KINH TẾ (chỉ dùng khi có đủ đầu vào; mọi giá trị đều phải công bố nguồn)
# ------------------------------------------------------------------------------
# WHO AQG 2021 dùng RR = 1,08 (KTC 95%: 1,06-1,09) cho mỗi 10 µg/m³ PM2.5 TB năm với tử vong
# không do tai nạn (Chen & Hoek, 2020) -> β = ln(1,08)/10. Chỉ áp dụng cho PHƠI NHIỄM DÀI HẠN (TB năm).
HEALTH_RR_PM25_PER10 = {"central": 1.08, "low": 1.06, "high": 1.09, "source": "Chen & Hoek (2020), WHO AQG 2021"}
DISCOUNT_RATE = 0.10                                    # suất chiết khấu mặc định cho NPV (người dùng đổi được)
