"""
ĐỘNG CƠ CẢNH BÁO SỨC KHỎE TỰ ĐỘNG (HIỆN THỰC ACTIVITY DIAGRAM)

  [Bắt đầu]
     -> Nhận kết quả dự báo PM2.5 từ AI Engine (24 giờ tới)
     -> Đối chiếu quy chuẩn QCVN 05:2023/BTNMT (PM2.5 TB 24h = 50 µg/m³)
        [PM2.5_Predict > 50]  -> Kích hoạt Trigger Warning_NhayCam
                              -> Xuất bản thông điệp khuyến cáo sức khỏe lên WebGIS (+ Push FCM tới Mobile)
        [PM2.5_Predict <= 50] -> Hiển thị trạng thái không khí bình thường
  [Kết thúc]

Bộ lập lịch (APScheduler) chạy ngầm:
  - Đánh giá cảnh báo định kỳ (mặc định 30 phút / lần)
  - Luồng ETL thu thập dữ liệu từ hệ thống ngoài (Open-Meteo) định kỳ (mặc định 30 phút / lần)
"""
import json
import os
import threading
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.dss_service import DSSEngine
from app.services.forecast_insight import (
    QCVN_PM25_24H_LIMIT,
    format_hour_label,
    summarize_forecast,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CREDENTIAL_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")
SUBSCRIBERS_FILE = os.path.join(BASE_DIR, "subscribers.json")
HISTORY_FILE = os.path.join(BASE_DIR, "alerts_history.json")

ALERT_INTERVAL_MINUTES = int(os.getenv("ALERT_INTERVAL_MINUTES", "30"))
ETL_INTERVAL_MINUTES = int(os.getenv("ETL_INTERVAL_MINUTES", "30"))
# Không gửi Push lặp lại trong khoảng thời gian này nếu cảnh báo vẫn đang tiếp diễn
PUSH_COOLDOWN_HOURS = float(os.getenv("ALERT_PUSH_COOLDOWN_HOURS", "3"))
FCM_ALERT_CHANNEL_ID = "airhcm_aqi_alert_v1"  # Trùng AlarmService.channelId trong airhcm_mobile
HISTORY_LIMIT = 200

# ------------------------------------------------------------------------------
# 1. FIREBASE CLOUD MESSAGING (TÙY CHỌN - THIẾU KHÓA THÌ VẪN CHẠY, CHỈ BỎ QUA PUSH)
# ------------------------------------------------------------------------------
_firebase_ready = False
try:
    import firebase_admin
    from firebase_admin import credentials, messaging

    if os.getenv("FCM_ENABLED", "1").strip().lower() in ("0", "false", "no"):
        print("-> [FCM] Đã tắt gửi Push theo biến môi trường FCM_ENABLED=0.")
    elif os.path.exists(CREDENTIAL_PATH):
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(CREDENTIAL_PATH))
        _firebase_ready = True
    else:
        print(f"-> [FCM] Không tìm thấy {CREDENTIAL_PATH}, tạm tắt gửi Push Notification.")
except Exception as fb_err:
    print(f"-> [FCM] Không khởi tạo được Firebase Admin: {fb_err}")


def send_fcm_alert(token: str, title: str, body: str, data: dict = None) -> bool:
    """Bắn Push Notification xuống ứng dụng di động AirHCM"""
    if not _firebase_ready or not token:
        return False
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            # Kênh "Cảnh báo AQI" của app mobile phát tiếng còi res/raw/aqi_alarm khi app chạy nền
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id=FCM_ALERT_CHANNEL_ID,
                    sound="aqi_alarm",
                    icon="ic_stat_aqi",
                    color="#DC2626",
                    priority="max",
                ),
            ),
            apns=messaging.APNSConfig(payload=messaging.APNSPayload(aps=messaging.Aps(sound="default"))),
            token=token,
        )
        messaging.send(message)
        return True
    except Exception as e:
        print(f"[{datetime.now():%H:%M:%S}] Lỗi gửi FCM tới ...{token[-8:]}: {e}")
        return False


# ------------------------------------------------------------------------------
# 2. TRẠNG THÁI CẢNH BÁO & NHẬT KÝ
# ------------------------------------------------------------------------------
_lock = threading.Lock()
_forecast_provider = None          # Hàm trả về chuỗi dự báo 24h của AI Engine
_active_alert = None               # Kết quả đánh giá gần nhất
_last_push = {"status": None, "time": None}


def _load_history() -> list:
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
    except Exception as e:
        print(f"-> [Cảnh báo đọc alerts_history.json]: {e}")
    return []


def _append_history(entry: dict):
    history = _load_history()
    history.insert(0, entry)
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history[:HISTORY_LIMIT], f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"-> [Lỗi ghi alerts_history.json]: {e}")


def _load_subscribers() -> list:
    try:
        with open(SUBSCRIBERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _push_to_subscribers(title: str, body: str, peak_aqi: int, data: dict) -> dict:
    """Gửi Push tới các thiết bị đã đăng ký có ngưỡng AQI <= AQI đỉnh dự báo"""
    recipients = [
        s for s in _load_subscribers()
        if s.get("fcm_token") and int(s.get("threshold_aqi") or 100) <= peak_aqi
    ]
    sent = sum(1 for s in recipients if send_fcm_alert(s["fcm_token"], title, body, data))
    return {"eligible": len(recipients), "sent": sent, "fcm_enabled": _firebase_ready}


# ------------------------------------------------------------------------------
# 3. ĐÁNH GIÁ DỰ BÁO & KÍCH HOẠT CẢNH BÁO (ACTIVITY DIAGRAM)
# ------------------------------------------------------------------------------
def evaluate_forecast_and_alert(trigger: str = "scheduler") -> dict:
    """Chạy toàn bộ luồng Activity Diagram và trả về trạng thái cảnh báo hiện hành"""
    global _active_alert

    if _forecast_provider is None:
        return {"status": "UNKNOWN", "message": "AI Engine chưa sẵn sàng."}

    with _lock:
        now = datetime.now()

        # BƯỚC 1: Nhận kết quả dự báo PM2.5 từ AI Engine
        try:
            forecast = _forecast_provider() or []
        except Exception as e:
            print(f"-> [Cảnh báo] Không lấy được dự báo AI: {e}")
            forecast = []

        summary = summarize_forecast(forecast)
        if not summary:
            _active_alert = {
                "status": "UNKNOWN",
                "title": "Chưa có dữ liệu dự báo",
                "message": "AI Engine chưa trả về chuỗi dự báo để đối chiếu quy chuẩn.",
                "evaluated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                "trigger": trigger,
            }
            return _active_alert

        peak = summary["peak"]
        peak_pm, peak_aqi = peak["pm2_5"], peak["aqi"]
        advisory = DSSEngine.get_health_advisory(peak_aqi, peak_pm)

        # BƯỚC 2: Đối chiếu quy chuẩn QCVN 05:2023/BTNMT
        is_warning = peak_pm > QCVN_PM25_24H_LIMIT

        if is_warning:
            # BƯỚC 3A: Kích hoạt Trigger Warning_NhayCam
            first, last = summary["first_exceed"], summary["last_exceed"]
            title = "⚠️ Cảnh báo bụi mịn PM2.5 vượt QCVN 05:2023"
            message = (
                f"AI dự báo PM2.5 đạt đỉnh {peak_pm} µg/m³ lúc {peak['label']}, vượt ngưỡng "
                f"{QCVN_PM25_24H_LIMIT:.0f} µg/m³ trong {summary['exceed_hours']} giờ "
                f"({first['label']} → {last['label']}). {advisory['sensitive_groups']}"
            )
        else:
            # BƯỚC 3B: Trạng thái không khí bình thường
            title = "✅ Chất lượng không khí trong ngưỡng an toàn"
            message = (
                f"Dự báo 24 giờ tới PM2.5 cao nhất {peak_pm} µg/m³ lúc {peak['label']}, "
                f"dưới ngưỡng QCVN 05:2023 ({QCVN_PM25_24H_LIMIT:.0f} µg/m³). {advisory['general_population']}"
            )

        result = {
            "status": "WARNING" if is_warning else "NORMAL",
            "trigger_name": "Warning_NhayCam" if is_warning else None,
            "title": title,
            "message": message,
            "level": advisory["level"],
            "color": advisory["color"],
            "peak_pm25": peak_pm,
            "peak_aqi": peak_aqi,
            "peak_time": peak["time"],
            "peak_label": peak["label"],
            "exceed_hours": summary["exceed_hours"],
            "window_start": summary["first_exceed"]["time"] if is_warning else None,
            "window_end": summary["last_exceed"]["time"] if is_warning else None,
            "best_window": summary["best_window"],
            "worst_window": summary["worst_window"],
            "threshold_pm25": QCVN_PM25_24H_LIMIT,
            "standard": "QCVN 05:2023/BTNMT",
            "advisory": advisory,
            "evaluated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            "trigger": trigger,
            "push": None,
        }

        # BƯỚC 4: Xuất bản thông điệp (Push FCM có chống spam theo thời gian nghỉ)
        previous_status = _active_alert.get("status") if _active_alert else None
        if _last_push["time"] is None:
            # Vừa khởi động lại: khôi phục lần Push gần nhất từ nhật ký để không gửi lặp mỗi lần restart
            for h in _load_history():
                if h.get("push_sent"):
                    try:
                        _last_push.update({"status": "WARNING", "time": datetime.strptime(h["time"], "%Y-%m-%d %H:%M:%S")})
                    except (KeyError, ValueError):
                        pass
                    break
        should_push = is_warning and (
            _last_push["status"] != "WARNING"
            or _last_push["time"] is None
            or now - _last_push["time"] >= timedelta(hours=PUSH_COOLDOWN_HOURS)
        )
        if should_push:
            result["push"] = _push_to_subscribers(
                title,
                f"PM2.5 dự báo đạt {peak_pm} µg/m³ ({format_hour_label(peak['time'])}). Mở AirHCM để xem khuyến cáo.",
                peak_aqi,
                {"type": "AQI_WARNING", "peak_pm25": peak_pm, "peak_time": peak["time"]},
            )
            _last_push.update({"status": "WARNING", "time": now})
        elif not is_warning:
            _last_push.update({"status": "NORMAL", "time": None})

        _active_alert = result

        # Ghi nhật ký khi trạng thái thay đổi, có gửi Push, hoặc quản trị viên chủ động đánh giá
        if previous_status != result["status"] or should_push or trigger != "scheduler":
            _append_history({
                "time": result["evaluated_at"],
                "status": result["status"],
                "title": title,
                "peak_pm25": peak_pm,
                "peak_aqi": peak_aqi,
                "peak_time": peak["time"],
                "exceed_hours": summary["exceed_hours"],
                "trigger": trigger,
                "push_sent": (result["push"] or {}).get("sent", 0),
            })

        print(f"[{now:%H:%M:%S}] DSS đánh giá cảnh báo: {result['status']} | đỉnh PM2.5 {peak_pm} µg/m³ ({trigger})")
        return result


def get_active_alert() -> dict:
    """Trạng thái cảnh báo hiện hành (tự đánh giá lần đầu nếu chưa có)"""
    if _active_alert is None:
        return evaluate_forecast_and_alert(trigger="on-demand")
    return _active_alert


def get_alert_history(limit: int = 20) -> list:
    return _load_history()[:max(1, limit)]


# ------------------------------------------------------------------------------
# 4. BỘ LẬP LỊCH CHẠY NGẦM
# ------------------------------------------------------------------------------
scheduler = BackgroundScheduler()


def start_scheduler(forecast_provider=None, etl_job=None):
    """Khởi động lịch đánh giá cảnh báo DSS và luồng ETL định kỳ"""
    global _forecast_provider
    if forecast_provider is not None:
        _forecast_provider = forecast_provider

    if scheduler.running:
        return

    first_run = datetime.now() + timedelta(seconds=15)
    scheduler.add_job(
        evaluate_forecast_and_alert, "interval", minutes=ALERT_INTERVAL_MINUTES,
        next_run_time=first_run, id="dss_alert_evaluation", replace_existing=True,
    )
    if etl_job is not None:
        # Thu thập dữ liệu ngay khi khởi động (máy chủ có thể đã tắt nhiều giờ -> số liệu cũ),
        # trước lượt đánh giá cảnh báo đầu tiên. Đặt ETL_ON_STARTUP=0 để tắt (VD: khi chạy thử).
        etl_first = datetime.now() + timedelta(seconds=5) if os.getenv("ETL_ON_STARTUP", "1") != "0" else None
        scheduler.add_job(
            etl_job, "interval", minutes=ETL_INTERVAL_MINUTES,
            id="etl_open_meteo", replace_existing=True,
            **({"next_run_time": etl_first} if etl_first else {}),
        )
    scheduler.start()
    print(
        f"🚀 Đã khởi động DSS: đánh giá cảnh báo mỗi {ALERT_INTERVAL_MINUTES} phút, "
        f"ETL mỗi {ETL_INTERVAL_MINUTES} phút, FCM {'BẬT' if _firebase_ready else 'TẮT'}."
    )
