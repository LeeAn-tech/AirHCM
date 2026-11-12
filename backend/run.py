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
    print("=== Khởi động AirHCM: Backend FastAPI + WebGIS ===")
    print("   WebGIS trên máy này : http://localhost:8000")
    ip = lan_ip()
    if ip:
        print(f"   Điện thoại (cùng Wi-Fi): http://{ip}:8000   (nút QR trên WebGIS)")
    print("   Tài liệu API         : http://localhost:8000/docs")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
