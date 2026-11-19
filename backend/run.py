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


if __name__ == "__main__":
    # Máy chủ cloud chạy bằng systemd (deploy/airhcm.service), không dùng file này.
    # Có thể đặt AIRHCM_RELOAD=0 để tắt tự nạp lại khi sửa code.
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("AIRHCM_RELOAD", "1") != "0"
    print("=== Khởi động AirHCM: Backend FastAPI + WebGIS ===")
    print(f"   WebGIS trên máy này : http://localhost:{port}")
    ip = lan_ip()
    if ip:
        print(f"   Điện thoại (cùng Wi-Fi): http://{ip}:{port}   (nút QR trên WebGIS)")
    print(f"   Tài liệu API         : http://localhost:{port}/docs")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=reload)
