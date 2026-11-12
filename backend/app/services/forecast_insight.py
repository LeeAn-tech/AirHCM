"""
Phân tích chuỗi dự báo AI phục vụ DSS, cảnh báo tự động và tư vấn theo vị trí.

Dùng chung cho:
  - Động cơ cảnh báo tự động (Activity Diagram: đối chiếu QCVN 05:2023 -> Warning_NhayCam)
  - API phân tích vị trí theo tọa độ (Sequence Diagram: Frontend gửi tọa độ -> Backend -> AI + PostGIS)
  - Trợ lý AI (DSS advice) để trả lời theo khung giờ dự báo thực tế
"""
from datetime import datetime, timedelta

from app.services.dss_service import DSSEngine

# Giới hạn PM2.5 trung bình 24 giờ theo QCVN 05:2023/BTNMT
QCVN_PM25_24H_LIMIT = 50.0


def _parse_time(time_str: str):
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(str(time_str), fmt)
        except ValueError:
            continue
    return None


def format_hour_label(time_str: str) -> str:
    """'2026-11-10 07:00' -> '07:00 10/11'"""
    dt = _parse_time(time_str)
    return dt.strftime("%H:%M %d/%m") if dt else str(time_str)


def _window_label(start_str: str, end_str: str) -> str:
    start, end = _parse_time(start_str), _parse_time(end_str)
    if not start or not end:
        return f"{start_str} – {end_str}"
    end = end + timedelta(hours=1)
    day = f" ({start.strftime('%d/%m')})"
    return f"{start.strftime('%H:%M')} – {end.strftime('%H:%M')}{day}"


def summarize_forecast(forecast: list, scale: float = 1.0, window: int = 3):
    """
    Tóm tắt chuỗi dự báo: đỉnh/đáy, số giờ vượt QCVN, khung giờ sạch nhất/ô nhiễm nhất.
    `scale` cho phép nội suy chuỗi dự báo cấp thành phố về một phường cụ thể.
    """
    points = []
    for item in forecast or []:
        try:
            pm = round(float(item.get("pm2_5", 0)) * scale, 1)
        except (TypeError, ValueError):
            continue
        points.append({
            "time": item.get("time"),
            "label": format_hour_label(item.get("time")),
            "pm2_5": pm,
            "aqi": DSSEngine.calculate_us_aqi(pm),
        })

    if not points:
        return None

    peak = max(points, key=lambda p: p["pm2_5"])
    low = min(points, key=lambda p: p["pm2_5"])
    exceed = [p for p in points if p["pm2_5"] > QCVN_PM25_24H_LIMIT]

    best_window = worst_window = None
    if len(points) >= window:
        averages = [
            (i, sum(p["pm2_5"] for p in points[i:i + window]) / window)
            for i in range(len(points) - window + 1)
        ]
        best_i, best_avg = min(averages, key=lambda x: x[1])
        worst_i, worst_avg = max(averages, key=lambda x: x[1])
        best_window = {
            "start": points[best_i]["time"],
            "end": points[best_i + window - 1]["time"],
            "avg_pm25": round(best_avg, 1),
            "label": _window_label(points[best_i]["time"], points[best_i + window - 1]["time"]),
        }
        worst_window = {
            "start": points[worst_i]["time"],
            "end": points[worst_i + window - 1]["time"],
            "avg_pm25": round(worst_avg, 1),
            "label": _window_label(points[worst_i]["time"], points[worst_i + window - 1]["time"]),
        }

    return {
        "threshold_pm25": QCVN_PM25_24H_LIMIT,
        "standard": "QCVN 05:2023/BTNMT",
        "hours": len(points),
        "peak": peak,
        "low": low,
        "exceed_hours": len(exceed),
        "first_exceed": exceed[0] if exceed else None,
        "last_exceed": exceed[-1] if exceed else None,
        "best_window": best_window,
        "worst_window": worst_window,
        "points": points,
    }
