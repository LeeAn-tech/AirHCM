"""
NGƯỠNG THAM CHIẾU, QUY ĐỔI ĐƠN VỊ VÀ THỐNG KÊ THEO KỲ TRUNG BÌNH

- Bảng so sánh QCVN 05:2023/BTNMT (quy chuẩn pháp lý, µg/Nm³) và WHO AQG 2021 (khuyến nghị sức khỏe, µg/m³).
- Quy đổi µg/m³ (điều kiện khí tượng thực tế) -> µg/Nm³ (25 °C, 760 mmHg theo QCVN 05:2023 mục 1.3.10):
      C_N = C · (T / 298,15) · (1013,25 / P)        (T: K, P: hPa)
- Thống kê ngày theo đúng kỳ trung bình: TB 24 giờ (chỉ hợp lệ khi đủ ≥ 18/24 giờ), cực đại TB trượt 8 giờ
  (≥ 6/8 giờ), cực đại 1 giờ. "PM2.5 vượt ngưỡng" (nồng độ, theo kỳ TB) KHÁC "AQI vượt ngưỡng" (chỉ số).
"""
from datetime import date

import numpy as np
import pandas as pd

from app.airdata import config as C

PERIOD_LABEL = {"1h": "TB 1 giờ", "8h": "TB 8 giờ", "24h": "TB 24 giờ", "year": "TB năm",
                "peak_season": "TB mùa cao điểm"}


def normal_factor(t_c, p_hpa):
    """Hệ số nhân đổi µg/m³ (thực tế) -> µg/Nm³ (25 °C, 1013,25 hPa). Thiếu T/P -> 1."""
    t = np.asarray(t_c, dtype=float) + 273.15
    p = np.asarray(p_hpa, dtype=float)
    f = (t / C.NORMAL_T_K) * (C.NORMAL_P_HPA / p)
    return np.where(np.isfinite(f) & (f > 0.8) & (f < 1.25), f, 1.0)


def to_normal(conc, t_c, p_hpa):
    return np.asarray(conc, dtype=float) * normal_factor(t_c, p_hpa)


def limits(standard: str = "qcvn", day: date = None) -> dict:
    """{chất: {kỳ: giá trị}} của QCVN 05:2023 (theo ngày áp dụng) hoặc WHO 2021."""
    if standard == "who":
        return {p: dict(v) for p, v in C.WHO_AQG_2021.items()}
    return C.qcvn_limits(day)


def threshold_table(day: date = None) -> list:
    """Bảng ngưỡng cho báo cáo và giao diện."""
    q, w = limits("qcvn", day), limits("who")
    rows = []
    for p in C.AQI_POLLUTANTS:
        meta = C.POLLUTANTS[p]
        rows.append({
            "pollutant": p, "name": meta["name"], "full": meta["full"],
            "qcvn": [{"period": k, "label": PERIOD_LABEL.get(k, k), "value": v, "unit": "µg/Nm³"} for k, v in q.get(p, {}).items()],
            "who": [{"period": k, "label": PERIOD_LABEL.get(k, k), "value": v, "unit": "µg/m³"} for k, v in w.get(p, {}).items()],
        })
    return rows


def unit_notes() -> list:
    return [
        "QCVN 05:2023 dùng µg/Nm³ (25 °C, 760 mmHg); CAMS/Open-Meteo và nhiều trạm cho µg/m³ ở điều kiện thực tế. "
        "Hệ thống quy đổi C_N = C·(T/298,15)·(1013,25/P) theo nhiệt độ, áp suất từng giờ trước khi so QCVN "
        "(ở TP.HCM, T ≈ 27-33 °C nên hệ số ≈ 1,01-1,03).",
        "WHO AQG 2021 là khuyến nghị sức khỏe (µg/m³), không phải quy chuẩn pháp lý; so sánh song song, không thay thế QCVN.",
        "Thời gian trung bình phải đúng kỳ: TB 24 giờ chỉ tính khi đủ ≥ %d/24 giờ hợp lệ; TB 8 giờ cần ≥ %d/8 giờ."
        % (C.QC_MIN_HOURS_24H, C.QC_MIN_HOURS_8H),
        "\"PM2.5 vượt ngưỡng\" (nồng độ theo kỳ TB) khác \"AQI vượt ngưỡng\" (chỉ số VN_AQI theo QĐ 1459/QĐ-TCMT, "
        "NowCast 12 giờ cho bụi); hai chỉ tiêu không dùng thay nhau.",
        "Thời gian lưu và hiển thị theo giờ Việt Nam (UTC+7); ERA5 gốc là UTC đã được đổi khi thu thập.",
    ]


def daily_stats(series: pd.Series, min_24h: int = None, min_8h: int = None) -> pd.DataFrame:
    """Thống kê ngày của một chuỗi giờ liên tục: n_valid, mean24 (NaN nếu thiếu), max8, max1."""
    min_24h = min_24h or C.QC_MIN_HOURS_24H
    min_8h = min_8h or C.QC_MIN_HOURS_8H
    s = series.astype(float).sort_index()
    if s.empty:
        return pd.DataFrame(columns=["n_valid", "mean24", "max8", "max1"])
    s = s.reindex(pd.date_range(s.index.min().normalize(), s.index.max().normalize() + pd.Timedelta(hours=23), freq="h"))
    day = s.index.normalize()
    n = s.notna().groupby(day).sum()
    mean24 = s.groupby(day).mean().where(n >= min_24h)
    r8 = s.rolling(8, min_periods=min_8h).mean()
    max8 = r8.groupby(day).max()
    max1 = s.groupby(day).max()
    out = pd.DataFrame({"n_valid": n.astype(int), "mean24": mean24, "max8": max8, "max1": max1})
    out.index.name = "date"
    return out


def stat_for_period(period: str) -> str:
    return C.STANDARD_PERIOD.get(period, "mean24")


def daily_exceedances(series: pd.Series, pollutant: str, standard: str = "qcvn", t_c=None, p_hpa=None) -> pd.DataFrame:
    """Bảng ngày × kỳ TB: giá trị thống kê, ngưỡng, có vượt không (QCVN so trên µg/Nm³ nếu có T, P)."""
    s = series.astype(float)
    if standard == "qcvn" and t_c is not None and p_hpa is not None:
        s = pd.Series(to_normal(s.to_numpy(), np.asarray(t_c), np.asarray(p_hpa)), index=s.index)
    st = daily_stats(s)
    rows = []
    for d, r in st.iterrows():
        lim = limits(standard, d.date()).get(pollutant, {})
        for period, value in lim.items():
            col = C.STANDARD_PERIOD.get(period)
            if not col:
                continue
            v = r[col]
            rows.append({"date": d, "period": period, "stat": col, "value": v, "limit": value,
                         "valid": bool(np.isfinite(v)), "exceed": bool(np.isfinite(v) and v > value)})
    return pd.DataFrame(rows)


def data_catalog() -> list:
    """Danh mục dữ liệu theo mục 1 của tài liệu tham chiếu: nguồn, biến, tần suất, trạng thái trong AirHCM."""
    return [
        {"source": "ERA5-Land Hourly (GEE ECMWF/ERA5_LAND/HOURLY)", "variables": "u10, v10, T2m, Td2m, mưa, áp suất",
         "frequency": "1 giờ, ~11 km, trễ ~5 ngày", "status": "đang dùng",
         "note": "Tái phân tích dùng cho hồi cứu/huấn luyện; vận hành tương lai dùng dự báo Open-Meteo (NWP), không dùng ERA5 tương lai."},
        {"source": "ERA5 Hourly (GEE ECMWF/ERA5/HOURLY)", "variables": "gió, khí tượng trên biển/đất",
         "frequency": "1 giờ, ~28-31 km", "status": "thay thế bằng lấp ô ven biển",
         "note": "Ô ven biển/hải đảo của ERA5-Land được lấp bằng trung bình 3 ô lân cận (Côn Đảo, Cần Giờ)."},
        {"source": "Open-Meteo Weather Forecast (NWP)", "variables": "T, Td, RH, gió, mưa, áp suất",
         "frequency": "1 giờ, ~9-11 km, 9 ngày tới", "status": "đang dùng",
         "note": "Hiệu chỉnh độ lệch so với ERA5-Land trên cửa sổ chồng lấp 72 giờ."},
        {"source": "Open-Meteo bổ sung: bức xạ, mây, độ cao lớp biên, gió 100 m", "variables": "shortwave_radiation, cloud_cover, boundary_layer_height, wind_speed_100m",
         "frequency": "1 giờ", "status": "bổ sung (scripts/airdata_extra_weather.py)",
         "note": "Biến khuếch tán/quang hóa cho PM và O3; dùng trong mô hình khi huấn luyện lại với --extra-wx."},
        {"source": "CAMS Global (Open-Meteo Air Quality)", "variables": "PM2.5, PM10, CO, NO2, SO2, O3, bụi, AOD",
         "frequency": "0,4° (~45 km), 3 giờ -> giờ, dự báo 5 ngày", "status": "đang dùng",
         "note": "Trường nền/dự báo vật lý; hạ quy mô về phường bằng tỷ số vệ tinh."},
        {"source": "CAMS Greenhouse Gas", "variables": "CO2", "frequency": "0,1°, 3 giờ, từ 11/2024",
         "status": "đang dùng (tham khảo)", "note": "CO2 không thuộc VN_AQI và không có giới hạn QCVN."},
        {"source": "Sentinel-5P TROPOMI L3 (GEE)", "variables": "cột NO2 tầng đối lưu, SO2, CO, AER_AI",
         "frequency": "1 lần/ngày ~13:30, lưới 1,1 km", "status": "đang dùng",
         "note": "Đơn vị mol/m² là CỘT khí, không phải µg/m³ sát mặt đất -> chỉ dùng làm mẫu phân bố không gian (tỷ số)."},
        {"source": "MODIS MAIAC AOD 550 nm (GEE)", "variables": "AOD", "frequency": "1 km, hằng ngày",
         "status": "đang dùng", "note": "Mẫu không gian cho PM2.5/PM10."},
        {"source": "OpenAQ API v3", "variables": "PM2.5, PM10, NO2, SO2, CO, O3 tại trạm",
         "frequency": "giờ/ngày tùy trạm", "status": "bổ sung (scripts/airdata_openaq.py, cần API key miễn phí)",
         "note": "Dùng KIỂM CHỨNG bộ dữ liệu đồng nhất bằng số đo mặt đất; kiểm tra giấy phép từng nhà cung cấp."},
        {"source": "Trạm quan trắc của cơ quan quản lý môi trường", "variables": "nồng độ theo giờ, metadata trạm",
         "frequency": "1 giờ", "status": "chưa được cấp dữ liệu",
         "note": "Nguồn ưu tiên khi được cấp phép; bảng kk_quantrac_tram_gio đã sẵn sàng tiếp nhận."},
        {"source": "Ranh giới + dân số 168 phường/xã (sau sắp xếp 2025)", "variables": "đa giác, diện tích, dân số",
         "frequency": "tĩnh", "status": "đang dùng", "note": "Dân số dùng tính A_T, N_T, E[N_T], PWE."},
        {"source": "OpenStreetMap (Overpass) + điểm cháy FIRMS (GEE)", "variables": "khu công nghiệp, cảng, nhà máy điện, bãi rác, sân bay, điểm cháy",
         "frequency": "theo ngày cập nhật OSM / hằng ngày (FIRMS)", "status": "bổ sung (scripts/airdata_import_sources.py)",
         "note": "Ứng viên nguồn thải cho truy vết; cần kiểm tra ngày dữ liệu và xác minh thực địa."},
        {"source": "Dữ liệu phòng thí nghiệm PM2.5 (OC/EC, ion, kim loại, levoglucosan)", "variables": "thành phần hóa học",
         "frequency": "theo đợt lấy mẫu", "status": "chưa có - giới hạn",
         "note": "Bắt buộc cho PMF định lượng nguồn (mức D); module pmf đã sẵn sàng khi có số liệu."},
    ]
