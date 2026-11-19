"""
LƯU TRỮ POSTGRESQL CHO PHÂN HỆ AIRDATA

Bảng (tiền tố kk_ = không khí):
  kk_nut_cams_gio          : CAMS gốc tại nút lưới 0,4° (quan trắc + dự báo mới nhất)
  kk_vetinh_phuong_ngay    : giá trị và tỷ số không gian vệ tinh theo phường/ngày (GEE)
  kk_khituong_phuong_gio   : khí tượng gốc theo phường/giờ (era5land | openmeteo)
  kk_dongnhat_phuong_gio   : BỘ DỮ LIỆU ĐỒNG NHẤT 168 phường × giờ (kết quả giải thuật)
  kk_dongnhat_tp_gio       : chuỗi cấp thành phố (trung bình trọng số diện tích)
  kk_du_bao_phat_hanh      : nhật ký dự báo đã phát hành (đối chiếu kỹ năng dự báo trực tuyến)

Ghi dữ liệu lớn bằng COPY vào bảng tạm rồi UPSERT (INSERT ... ON CONFLICT) -> nhanh, chạy lại an toàn.
"""
import io

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.database import engine

POLL = ["pm2_5", "pm10", "co", "no2", "so2", "o3", "co2"]
EXTRA = ["dust", "aod"]
WX = ["temperature_2m", "dewpoint_2m", "relative_humidity", "wind_speed", "wind_dir", "precipitation",
      "surface_pressure"]


def _real_cols(cols):
    return ",\n    ".join(f"{c} REAL" for c in cols)


DDL = f"""
CREATE TABLE IF NOT EXISTS kk_nut_cams_gio (
    node_lat REAL NOT NULL, node_lon REAL NOT NULL, thoi_gian TIMESTAMP NOT NULL,
    {_real_cols(POLL + EXTRA)},
    la_du_bao BOOLEAN DEFAULT FALSE,
    cap_nhat_luc TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (node_lat, node_lon, thoi_gian)
);
CREATE TABLE IF NOT EXISTS kk_vetinh_phuong_ngay (
    ma_phuong_xa VARCHAR(20) NOT NULL, ngay DATE NOT NULL,
    no2_col REAL, so2_col REAL, co_col REAL, aer_ai REAL, aod REAL,
    r_no2 REAL, r_so2 REAL, r_co REAL, r_aod REAL,
    nguon VARCHAR(8),
    PRIMARY KEY (ma_phuong_xa, ngay)
);
CREATE TABLE IF NOT EXISTS kk_khituong_phuong_gio (
    ma_phuong_xa VARCHAR(20) NOT NULL, thoi_gian TIMESTAMP NOT NULL, nguon VARCHAR(10) NOT NULL,
    {_real_cols(WX)},
    PRIMARY KEY (ma_phuong_xa, thoi_gian, nguon)
);
CREATE TABLE IF NOT EXISTS kk_dongnhat_phuong_gio (
    ma_phuong_xa VARCHAR(20) NOT NULL, thoi_gian TIMESTAMP NOT NULL,
    {_real_cols(POLL + EXTRA + WX)},
    co_hieu SMALLINT DEFAULT 0,
    PRIMARY KEY (ma_phuong_xa, thoi_gian)
);
CREATE INDEX IF NOT EXISTS ix_kk_dongnhat_phuong_gio_tg ON kk_dongnhat_phuong_gio (thoi_gian);
CREATE TABLE IF NOT EXISTS kk_dongnhat_tp_gio (
    thoi_gian TIMESTAMP PRIMARY KEY,
    {_real_cols(POLL + EXTRA + WX)}
);
CREATE TABLE IF NOT EXISTS kk_du_bao_phat_hanh (
    phat_hanh_luc TIMESTAMP NOT NULL, thoi_gian_dich TIMESTAMP NOT NULL, chat VARCHAR(10) NOT NULL,
    gia_tri_ml REAL, gia_tri_cams REAL, gia_tri_ket_hop REAL,
    PRIMARY KEY (phat_hanh_luc, thoi_gian_dich, chat)
);
"""

# Bảng bổ sung theo mục 10 của tài liệu tham chiếu (stations, observations_hourly, forecast_quantiles,
# risk_ward_daily, emission_sources, source_evidence, intervention_scenarios) + khí tượng bổ sung cấp TP
DDL_EXTRA = """
CREATE TABLE IF NOT EXISTS kk_tram (
    ma_tram VARCHAR(40) PRIMARY KEY, ten_tram TEXT, lat REAL, lon REAL, ma_phuong_xa VARCHAR(20),
    nha_cung_cap TEXT, qc_class VARCHAR(20), nguon VARCHAR(20), giay_phep TEXT, cap_nhat_luc TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS kk_quantrac_tram_gio (
    ma_tram VARCHAR(40) NOT NULL, thoi_gian TIMESTAMP NOT NULL, chat VARCHAR(10) NOT NULL,
    gia_tri REAL, don_vi VARCHAR(12), qc SMALLINT DEFAULT 0, nguon VARCHAR(20),
    PRIMARY KEY (ma_tram, thoi_gian, chat)
);
CREATE TABLE IF NOT EXISTS kk_du_bao_phan_vi (
    vi_tri VARCHAR(20) NOT NULL, phat_hanh_luc TIMESTAMP NOT NULL, thoi_gian_dich TIMESTAMP NOT NULL,
    chat VARCHAR(10) NOT NULL, q05 REAL, q50 REAL, q95 REAL, model_ver VARCHAR(40),
    PRIMARY KEY (vi_tri, phat_hanh_luc, thoi_gian_dich, chat)
);
CREATE TABLE IF NOT EXISTS kk_rui_ro_phuong_ngay (
    ma_phuong_xa VARCHAR(20) NOT NULL, ngay DATE NOT NULL, chat VARCHAR(10) NOT NULL, chuan VARCHAR(8) NOT NULL,
    nguong REAL, xac_suat_vuot REAL, q05 REAL, q50 REAL, q95 REAL, dan_so INTEGER,
    dan_so_phoi_nhiem_ky_vong REAL, dien_tich_km2 REAL, phat_hanh_luc TIMESTAMP,
    PRIMARY KEY (ma_phuong_xa, ngay, chat, chuan)
);
CREATE TABLE IF NOT EXISTS kk_nguon_thai (
    source_id VARCHAR(60) PRIMARY KEY, ten TEXT, loai VARCHAR(30), lat REAL, lon REAL, dien_tich_ha REAL,
    chat_lien_quan TEXT, hoat_dong REAL, nguon_du_lieu TEXT, ngay_du_lieu DATE, da_xac_minh BOOLEAN DEFAULT FALSE,
    cap_nhat_luc TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS kk_chung_cu_nguon (
    event_id VARCHAR(40) NOT NULL, source_id VARCHAR(60) NOT NULL, phuong_phap VARCHAR(4) NOT NULL,
    diem REAL, bat_dinh REAL, ghi_chu TEXT, tao_luc TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (event_id, source_id, phuong_phap)
);
CREATE TABLE IF NOT EXISTS kk_kich_ban (
    scenario_id VARCHAR(40) PRIMARY KEY, ten TEXT, gia_dinh TEXT, chi_phi REAL, tac_dong TEXT,
    trang_thai VARCHAR(20), tao_luc TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS kk_khituong_bosung_tp_gio (
    thoi_gian TIMESTAMP PRIMARY KEY, shortwave_radiation REAL, cloud_cover REAL, boundary_layer_height REAL,
    wind_speed_100m REAL, wind_dir_100m REAL, nguon VARCHAR(20)
)
"""

KEYS = {
    "kk_tram": ["ma_tram"],
    "kk_quantrac_tram_gio": ["ma_tram", "thoi_gian", "chat"],
    "kk_du_bao_phan_vi": ["vi_tri", "phat_hanh_luc", "thoi_gian_dich", "chat"],
    "kk_rui_ro_phuong_ngay": ["ma_phuong_xa", "ngay", "chat", "chuan"],
    "kk_nguon_thai": ["source_id"],
    "kk_chung_cu_nguon": ["event_id", "source_id", "phuong_phap"],
    "kk_kich_ban": ["scenario_id"],
    "kk_khituong_bosung_tp_gio": ["thoi_gian"],
    "kk_nut_cams_gio": ["node_lat", "node_lon", "thoi_gian"],
    "kk_vetinh_phuong_ngay": ["ma_phuong_xa", "ngay"],
    "kk_khituong_phuong_gio": ["ma_phuong_xa", "thoi_gian", "nguon"],
    "kk_dongnhat_phuong_gio": ["ma_phuong_xa", "thoi_gian"],
    "kk_dongnhat_tp_gio": ["thoi_gian"],
    "kk_du_bao_phat_hanh": ["phat_hanh_luc", "thoi_gian_dich", "chat"],
}


def ensure_schema():
    with engine.begin() as conn:
        for stmt in [s.strip() for s in (DDL + ";" + DDL_EXTRA).split(";") if s.strip()]:
            conn.execute(text(stmt))


def upsert(table: str, df: pd.DataFrame, chunk: int = 500_000) -> int:
    """COPY vào bảng tạm rồi INSERT ... ON CONFLICT DO UPDATE."""
    if df is None or df.empty:
        return 0
    keys = KEYS[table]
    cols = list(df.columns)
    updates = [c for c in cols if c not in keys]
    total = 0
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        for i in range(0, len(df), chunk):
            part = df.iloc[i:i + chunk]
            tmp = f"tmp_{table}"
            cur.execute(f"CREATE TEMP TABLE IF NOT EXISTS {tmp} (LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP;")
            buf = io.StringIO()
            part.to_csv(buf, index=False, header=False, na_rep="\\N", date_format="%Y-%m-%d %H:%M:%S")
            buf.seek(0)
            cur.copy_expert(f"COPY {tmp} ({','.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", buf)
            set_clause = ", ".join(f"{c}=EXCLUDED.{c}" for c in updates) or None
            conflict = f"ON CONFLICT ({','.join(keys)}) " + (f"DO UPDATE SET {set_clause}" if set_clause else "DO NOTHING")
            cur.execute(f"INSERT INTO {table} ({','.join(cols)}) SELECT {','.join(cols)} FROM {tmp} {conflict};")
            raw.commit()
            total += len(part)
    finally:
        raw.close()
    return total


def read_sql(sql: str, params: dict = None) -> pd.DataFrame:
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params or {})


# ------------------------------------------------------------------------------
# TRUY VẤN DÙNG CHUNG
# ------------------------------------------------------------------------------
def cams_nodes(start, end) -> pd.DataFrame:
    return read_sql("SELECT * FROM kk_nut_cams_gio WHERE thoi_gian BETWEEN :a AND :b", {"a": start, "b": end})


def satellite(start_day, end_day) -> pd.DataFrame:
    return read_sql("SELECT * FROM kk_vetinh_phuong_ngay WHERE ngay BETWEEN :a AND :b",
                    {"a": start_day, "b": end_day})


def weather(start, end, source: str) -> pd.DataFrame:
    return read_sql("SELECT * FROM kk_khituong_phuong_gio WHERE nguon = :s AND thoi_gian BETWEEN :a AND :b",
                    {"s": source, "a": start, "b": end})


def city_hourly(start=None, end=None) -> pd.DataFrame:
    where, p = [], {}
    if start is not None:
        where.append("thoi_gian >= :a"); p["a"] = start
    if end is not None:
        where.append("thoi_gian <= :b"); p["b"] = end
    sql = "SELECT * FROM kk_dongnhat_tp_gio" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY thoi_gian"
    df = read_sql(sql, p)
    if not df.empty:
        df["thoi_gian"] = pd.to_datetime(df["thoi_gian"])
    return df


def ward_hourly(start, end, code: str = None) -> pd.DataFrame:
    sql = "SELECT * FROM kk_dongnhat_phuong_gio WHERE thoi_gian BETWEEN :a AND :b"
    p = {"a": start, "b": end}
    if code:
        sql += " AND ma_phuong_xa = :c"; p["c"] = str(code)
    df = read_sql(sql + " ORDER BY ma_phuong_xa, thoi_gian", p)
    if not df.empty:
        df["thoi_gian"] = pd.to_datetime(df["thoi_gian"])
    return df


def latest_observed_time():
    df = read_sql("SELECT MAX(thoi_gian) AS t FROM kk_dongnhat_tp_gio WHERE thoi_gian <= NOW()::timestamp")
    t = df["t"].iloc[0] if not df.empty else None
    return None if t is None or (isinstance(t, float) and np.isnan(t)) else pd.Timestamp(t)


def coverage_summary() -> dict:
    out = {}
    for table, col in (("kk_dongnhat_phuong_gio", "thoi_gian"), ("kk_dongnhat_tp_gio", "thoi_gian"),
                       ("kk_nut_cams_gio", "thoi_gian"), ("kk_vetinh_phuong_ngay", "ngay"),
                       ("kk_khituong_phuong_gio", "thoi_gian")):
        try:
            df = read_sql(f"SELECT COUNT(*) AS n, MIN({col}) AS a, MAX({col}) AS b FROM {table}")
            r = df.iloc[0]
            out[table] = {"rows": int(r["n"]), "from": str(r["a"]), "to": str(r["b"])}
        except Exception as e:
            out[table] = {"error": str(e)[:120]}
    return out


def table_exists(name: str) -> bool:
    try:
        df = read_sql("SELECT to_regclass(:n) IS NOT NULL AS ok", {"n": name})
        return bool(df["ok"].iloc[0])
    except Exception:
        return False


def emission_sources() -> pd.DataFrame:
    if not table_exists("kk_nguon_thai"):
        return pd.DataFrame()
    return read_sql("SELECT * FROM kk_nguon_thai")


def extra_weather(start=None, end=None) -> pd.DataFrame:
    """Khí tượng bổ sung cấp TP (bức xạ, mây, độ cao lớp biên, gió 100 m) nếu đã nạp."""
    if not table_exists("kk_khituong_bosung_tp_gio"):
        return pd.DataFrame()
    where, p = [], {}
    if start is not None:
        where.append("thoi_gian >= :a"); p["a"] = start
    if end is not None:
        where.append("thoi_gian <= :b"); p["b"] = end
    sql = "SELECT * FROM kk_khituong_bosung_tp_gio" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY thoi_gian"
    df = read_sql(sql, p)
    if not df.empty:
        df["thoi_gian"] = pd.to_datetime(df["thoi_gian"])
    return df
