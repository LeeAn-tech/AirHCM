from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base

class HanhChinhHCM(Base):
    __tablename__ = "hanhchinh_hcm"

    id = Column(Integer, primary_key=True, index=True)
    ma_phuong_xa = Column(String(20), unique=True, nullable=False, index=True)
    ten_phuong_xa = Column(String(100), nullable=False)
    loai_don_vi = Column(String(20))
    dien_tich_km2 = Column(Numeric(10, 2))
    # Cột geom dạng PostGIS Geometry (MultiPolygon, 4326)

class TramQuanTrac(Base):
    __tablename__ = "tramquantrac"

    id = Column(Integer, primary_key=True, index=True)
    ma_tram = Column(String(50), unique=True, nullable=False)
    ten_tram = Column(String(255), nullable=False)
    don_vi_quan_ly = Column(String(255))
    # Cột geom dạng PostGIS Geometry (Point, 4326)

    lichsu_records = relationship("LichSuAQI", back_populates="tram", cascade="all, delete-orphan")

class LichSuAQI(Base):
    __tablename__ = "lichsu_aqi"

    id = Column(Integer, primary_key=True, index=True)
    tram_id = Column(Integer, ForeignKey("tramquantrac.id", ondelete="CASCADE"), nullable=False)
    thoi_gian = Column(DateTime, nullable=False, index=True)
    pm2_5 = Column(Numeric(7, 2))
    pm10 = Column(Numeric(7, 2))
    us_aqi = Column(Integer)
    temperature_2m = Column(Numeric(7, 2))
    dewpoint_temperature_2m = Column(Numeric(7, 2))
    absorbing_aerosol_index = Column(Numeric(10, 4))

    tram = relationship("TramQuanTrac", back_populates="lichsu_records")

    __table_args__ = (
        UniqueConstraint('tram_id', 'thoi_gian', name='uq_lichsu_tram_thoigian'),
    )