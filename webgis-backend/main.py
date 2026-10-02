from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from routers import api_v1
from core.database import close_db_connection

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "webgis-frontend"

app = FastAPI(
    title="AirHCM DSS Backend & Frontend",
    description="Hệ thống Nguyên khối (Monolithic) tích hợp WebGIS và AI DSS",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1.router, prefix="/api")

app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")

@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/admin.html")
async def serve_admin():
    return FileResponse(FRONTEND_DIR / "admin.html")

@app.on_event("shutdown")
async def shutdown_database_pool() -> None:
    await close_db_connection()

if __name__ == "__main__":
    import uvicorn
    # CẬP NHẬT: Buộc chạy chính xác trên localhost
    uvicorn.run("main:app", host="localhost", port=8000, reload=True)