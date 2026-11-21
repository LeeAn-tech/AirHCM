import os
import socket

import uvicorn


def lan_ip():
    """IP máy tính trong mạng Wi-Fi/LAN (để mở AirHCM từ điện thoại)"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def port_owner(port):
    """Chương trình đang nghe ở cổng `port` trên máy này: None (cổng trống), "airhcm" hoặc tên ứng dụng khác.

    Windows cho phép một chương trình khác giữ 127.0.0.1:port trong khi AirHCM vẫn mở được 0.0.0.0:port mà
    không báo lỗi -> trình duyệt và app (adb reverse) gọi nhầm sang chương trình kia và nhận toàn lỗi 404.
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.5):
            pass
    except OSError:
        return None
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=3) as r:
            if r.status == 200:
                return "airhcm"
    except Exception:
        pass
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/openapi.json", timeout=3) as r:
            return (json.load(r).get("info") or {}).get("title") or "chương trình không rõ"
    except Exception:
        return "chương trình không rõ"


if __name__ == "__main__":
    # Máy chủ cloud chạy bằng systemd (deploy/airhcm.service), không dùng file này.
    # Có thể đặt AIRHCM_RELOAD=0 để tắt tự nạp lại khi sửa code.
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("AIRHCM_RELOAD", "1") != "0"
    owner = port_owner(port)
    if owner == "airhcm":
        print(f"AirHCM đã đang chạy ở cổng {port} (cửa sổ khác) - không mở thêm.")
        raise SystemExit(0)
    if owner:
        print(f"[LỖI] Cổng {port} đang bị chương trình KHÁC chiếm: \"{owner}\".")
        print("      App AirHCM và WebGIS sẽ gọi nhầm sang chương trình đó và nhận lỗi 404.")
        print(f"      Hãy đóng chương trình đó (cửa sổ dòng lệnh đang chạy uvicorn ... --port {port}) rồi chạy lại AirHCM.")
        raise SystemExit(1)
    print("=== Khởi động AirHCM: Backend FastAPI + WebGIS ===")
    print(f"   WebGIS trên máy này : http://localhost:{port}")
    ip = lan_ip()
    if ip:
        print(f"   Điện thoại (cùng Wi-Fi): http://{ip}:{port}   (nút QR trên WebGIS)")
    print(f"   Tài liệu API         : http://localhost:{port}/docs")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=reload)
