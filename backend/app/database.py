import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Nạp backend/.env sớm nhất (database.py được import đầu tiên trong main.py)
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

# Máy cá nhân: dùng mặc định bên dưới.
# Máy chủ cloud: đặt DATABASE_URL trong backend/.env, ví dụ (Azure PostgreSQL bắt buộc SSL):
#   DATABASE_URL=postgresql://airhcmadmin:MatKhau@airhcm-db.postgres.database.azure.com:5432/webgis_aqi_hcm?sslmode=require
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:123456@localhost:5432/webgis_aqi_hcm")

engine = create_engine(
    DATABASE_URL,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    pool_pre_ping=True,
    pool_recycle=1800,  # dịch vụ cloud hay cắt kết nối rỗi lâu
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
