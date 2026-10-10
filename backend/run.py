import uvicorn

if __name__ == "__main__":
    print("=== Khởi động Backend FastAPI WebGIS AQI TP.HCM ===")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)