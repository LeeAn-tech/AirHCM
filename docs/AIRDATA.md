# AirData – Dữ liệu đa chất đồng nhất và dự báo realtime 7 ngày

Phân hệ `backend/app/airdata` bổ sung cho AirHCM:

1. **Đa chất ô nhiễm:** PM2.5, PM10, CO, NO2, SO2, O3 (6 thông số của VN_AQI) và CO2 tham khảo.
2. **Thu thập tự động** bằng Python: Open-Meteo (CAMS, khí tượng) và Google Earth Engine (Sentinel-5P, MODIS MAIAC, ERA5-Land), chạy ngầm trong FastAPI mỗi giờ.
3. **Giải thuật đồng nhất** các nguồn khác độ phân giải về một bộ dữ liệu **168 phường/xã × 1 giờ**.
4. **Dự báo realtime:** mở ứng dụng là có ngày hiện tại, giờ hiện tại, hôm nay + 7 ngày tới, và xu hướng các tháng tới.

> Lưu ý về chất ô nhiễm: **NO (nitơ monoxit)** không có trong Open-Meteo và Sentinel-5P nên hệ thống dùng **NO2**. CO2 là khí nhà kính, không thuộc VN_AQI/US AQI và không có giới hạn trong QCVN 05:2023, nên chỉ hiển thị để tham khảo (có từ 11/2024).

---

## 1. Nguồn dữ liệu và độ phân giải gốc

| Nguồn | Biến | Không gian | Thời gian | Có từ |
|---|---|---|---|---|
| CAMS Global Atmospheric Composition Forecasts (Open-Meteo Air Quality API) | PM2.5, PM10, CO, NO2, SO2, O3, bụi, AOD | 0,4° (~45 km) | 3 giờ (nội suy giờ), dự báo 5 ngày, cập nhật 12 giờ/lần | 08/2022 |
| CAMS Global Greenhouse Gas Forecast (Open-Meteo) | CO2 | 0,1° (~11 km) | 3 giờ | 11/2024 |
| Sentinel-5P TROPOMI L3 (GEE `COPERNICUS/S5P/OFFL|NRTI`) | cột NO2 tầng đối lưu, SO2, CO, chỉ số sol khí hấp thụ | lưới 0,01° (1.113 m) | 1 lần/ngày (~13:30), có mây | 2018 |
| MODIS MAIAC (GEE `MODIS/061/MCD19A2_GRANULES`) | AOD 550 nm | 1 km | hằng ngày, có mây | 2000 |
| ERA5-Land Hourly (GEE `ECMWF/ERA5_LAND/HOURLY`) | nhiệt độ, điểm sương, gió u/v, mưa, áp suất | 0,1° (~11 km) | 1 giờ, trễ ~5 ngày | 1950 |
| Open-Meteo Weather Forecast API | khí tượng | ~9-11 km | 1 giờ, 9 ngày tới | – |

## 2. Giải thuật đồng nhất (`harmonize.py`)

**B1 – Đồng bộ thời gian.** Mọi nguồn được đưa về giờ Việt Nam (UTC+7; ERA5 gốc là UTC), dựng lưới giờ liên tục. Khoảng trống ≤ 3 giờ nội suy tuyến tính, dài hơn để trống và gắn cờ.

**B2 – Nội suy không gian CAMS.** CAMS được lấy tại các **nút lưới 0,4°** bao quanh 168 phường (không lấy tại tâm phường, để tránh nhiều phường cùng ô 45 km có giá trị giống hệt nhau). Giá trị nền tại điểm đại diện phường:

B_w(t) = Σ_k w_k · C_k(t), với w_k là trọng số song tuyến của 4 nút bao quanh; nút thiếu giá trị thì chuẩn hóa lại trọng số trên các nút còn lại.

**B3 – Hạ quy mô bằng tỷ số vệ tinh.** Trên GEE, với mỗi ngày D:
- tạo ảnh tổ hợp trượt 30 ngày [D−29, D] (lấp khoảng trống mây; lọc `cloud_fraction < 0,3` cho NO2, SO2),
- tính tỷ số R = I / trung_bình_lân_cận(I, bán kính 22 km ≈ nửa ô CAMS),
- lấy trung bình R trong đa giác phường (`reduceRegions`, scale 1.113,2 m).

Nồng độ phường: **C_w(t) = B_w(t) · f_w,p(d)**, với f = clip(1 + α_p (R − 1), 0,5, 2,0).

| Chất | Lớp mẫu không gian | α_p |
|---|---|---|
| NO2 | cột NO2 tầng đối lưu (S5P) | 0,8 |
| PM2.5, PM10 | AOD MAIAC 1 km | 0,6 |
| CO | cột CO (S5P) | 0,5 |
| SO2 | cột SO2 (S5P, nhiễu cao) | 0,3 |
| O3 | không dùng (cột O3 chủ yếu ở tầng bình lưu) | 0 |
| CO2 | không dùng | 0 |

α_p là hệ số co (shrinkage) thể hiện mức độ cột khí vệ tinh đại diện cho nồng độ sát mặt đất; đây là **tham số hiệu chỉnh được** (`config.py`), nên được hiệu chỉnh lại nếu có số liệu trạm mặt đất. Sau đó chuẩn hóa **bảo toàn khối lượng**: trung bình có trọng số diện tích của f trên toàn thành phố bằng 1 cho từng ngày. Ngày chưa có ảnh: giữ hệ số gần nhất (≤ 45 ngày), quá hạn thì f = 1.

**B4 – Khí tượng.** Ưu tiên ERA5-Land (ô ven biển, hải đảo bị mặt nạ được lấp bằng trung bình 3 ô lân cận). Các giờ ERA5 chưa có (5 ngày gần nhất và tương lai) dùng Open-Meteo đã **hiệu chỉnh độ lệch** theo cửa sổ chồng lấp 72 giờ: cộng cho nhiệt độ, điểm sương, áp suất; nhân cho tốc độ gió (giới hạn 0,5–2). Độ ẩm tính lại từ T và Td (Magnus). Phường thiếu hẳn số liệu được nội suy IDW từ 4 phường gần nhất.

**B5 – Chuỗi cấp thành phố** = trung bình có trọng số diện tích của 168 phường (hướng gió lấy trung bình vector), dùng để huấn luyện mô hình.

**Cờ chất lượng** (`co_hieu`, bitmask): 1 CAMS được nội suy thời gian · 2 hệ số vệ tinh lấy theo ngày gần nhất/mặc định · 4 khí tượng Open-Meteo · 8 khí tượng nội suy IDW · 16 giờ tương lai (dự báo).

## 3. Mô hình dự báo (`features.py`, `train.py`)

- **Dự báo trực tiếp đa hạn** (thay cho dự báo cuốn chiếu từng giờ + hệ số ngày đêm cố định của bản cũ): mỗi mẫu là (thời điểm phát hành t0, hạn h ≤ 192 giờ), mục tiêu là log(1+y(t0+h)) − log(1+y(t0)).
- **Đặc trưng:** trễ 0–24 giờ, trung bình trượt 6–168 giờ, dị thường so với khí hậu tháng × giờ, các chất còn lại tại t0; khí tượng tại thời điểm đích (khi vận hành lấy từ dự báo thời tiết – giả định *perfect prognosis*); giờ, thứ, tháng, mùa mưa, Tết; hạn dự báo.
- **Chia dữ liệu theo thời gian:** 70% huấn luyện | 10% kiểm định (chọn mô hình) | 20% cuối kiểm thử. Mục tiêu của mẫu huấn luyện không vượt sang giai đoạn kiểm định (tránh rò rỉ).
- **Ứng viên:** HistGradientBoosting, XGBoost (tùy chọn RandomForest). Chọn theo RMSE kiểm định, huấn luyện lại trên huấn luyện + kiểm định.
- **Đánh giá:** MAE, RMSE, R², độ lệch theo nhóm hạn 1–24h, 25–72h, 73–192h; so với bền vững, bền vững theo ngày và khí hậu; sai số trung bình ngày theo số ngày dự báo (phát hành 00:00); độ quan trọng hoán vị.

## 4. Dự báo thời gian thực (`forecast.py`)

1. t0 = giờ gần nhất đã có số liệu đồng nhất.
2. Dự báo cấp thành phố cho từng giờ đến hết ngày thứ 7 kể từ hôm nay bằng mô hình ML của từng chất.
3. Kết hợp với dự báo CAMS đã đồng nhất theo trọng số nghịch đảo sai số bình phương học từ **nhật ký đối chiếu trực tuyến** (`kk_du_bao_phat_hanh`, cần ≥ 14 ngày). Chưa đủ thì dùng ML, CAMS làm tham chiếu. Chưa có mô hình thì dùng CAMS; ngoài tầm CAMS thì bền vững tắt dần về khí hậu.
4. Phân rã về phường bằng hệ số S(phường, giờ trong ngày) = trung vị tỷ số phường/TP trong 14 ngày gần nhất.
5. VN_AQI (QĐ 1459: NowCast 12h cho bụi; AQI ngày dùng TB 24h bụi, cực đại 1h/8h khí) và US AQI (EPA 2024); đối chiếu QCVN 05:2023 (PM2.5 TB 24h **45 µg/m³ từ 01/01/2026**).
6. **Xu hướng tháng** (`seasonal.py`): ŷ = khí hậu tháng + xu thế tuyến tính + φ^k · dị thường gần nhất (AR(1)), khoảng tin cậy 80%, kiểm chứng ngược 12 tháng so với khí hậu thuần.

> Giới hạn cần nêu trong báo cáo: TP.HCM chưa có chuỗi quan trắc mặt đất công khai đủ dài cho cả 6 chất, nên "giá trị đồng nhất" là trường CAMS đã hạ quy mô. Mô hình ML học động thái của trường này; sai số đối chiếu trực tuyến của CAMS sẽ thấp ở hạn ngắn vì "số liệu thực" cũng bắt nguồn từ CAMS.

## 5. Cơ sở dữ liệu PostgreSQL

| Bảng | Nội dung |
|---|---|
| `kk_nut_cams_gio` | CAMS gốc tại nút lưới (quan trắc + dự báo mới nhất) |
| `kk_vetinh_phuong_ngay` | giá trị và tỷ số không gian vệ tinh theo phường/ngày |
| `kk_khituong_phuong_gio` | khí tượng gốc theo phường/giờ (`era5land` / `openmeteo`) |
| `kk_dongnhat_phuong_gio` | **bộ dữ liệu đồng nhất 168 phường × giờ** |
| `kk_dongnhat_tp_gio` | chuỗi cấp thành phố |
| `kk_du_bao_phat_hanh` | nhật ký dự báo đã phát hành (đối chiếu trực tuyến) |

Bảng được tạo tự động lần chạy đầu (`store.ensure_schema()`).

## 6. Cách chạy

```bat
cd backend
:: 0) Đăng nhập Google Earth Engine (một lần trên máy)
earthengine authenticate

:: 1) Nạp lịch sử 04/08/2022 -> hôm nay (Open-Meteo + GEE + đồng nhất). Có thể chạy lại an toàn.
python scripts\airdata_backfill.py
::    chỉ chạy lại giải thuật đồng nhất:  python scripts\airdata_backfill.py --steps harmonize
::    bỏ qua GEE (chỉ CAMS):             python scripts\airdata_backfill.py --steps cams,harmonize

:: 2) Huấn luyện 6 mô hình + metrics.json + hình cho báo cáo
python scripts\airdata_train.py

:: 3) Khởi động hệ thống như cũ (tự cập nhật mỗi giờ, phút 05)
python run.py

:: (tùy chọn) Xuất bộ dữ liệu đồng nhất ra CSV.gz theo năm
python scripts\airdata_export.py --out ..\data_export

:: Kiểm thử bằng dữ liệu giả lập (không cần mạng/CSDL)
python tests\test_airdata_synthetic.py
```

Biến môi trường tùy chọn (`backend/.env`): `AIRDATA_GEE_PROJECT`, `AIRDATA_GEE_WARD_ASSET`, `AIRDATA_GEE_WARD_CODE_FIELD`, `AIRDATA_GEE_SERVICE_ACCOUNT` + `AIRDATA_GEE_KEY_FILE` (máy chủ), `AIRDATA_REALTIME=0` (tắt cập nhật giờ), `AIRDATA_GEE=0` (bỏ GEE trong cập nhật giờ), `AIRDATA_MONTHLY_OUTLOOK` (số tháng xu hướng, mặc định 3).

## 7. API

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/v1/air/forecast?ward_code=&lat=&lng=` | hôm nay + hiện tại + chuỗi giờ đến hết ngày thứ 7 + 8 thẻ ngày + xu hướng tháng |
| GET | `/api/v1/air/current` | số liệu hiện tại đa chất |
| GET | `/api/v1/air/spatial?pollutant=no2&time=` | giá trị 168 phường tại một giờ |
| GET | `/api/v1/air/spatial-series?pollutant=pm2_5&back=24&ahead=72&step=1` | ma trận [giờ × 168 phường] (nồng độ, VN_AQI, US AQI) cho bản đồ 3D hoạt cảnh - cùng cách tính với `/air/spatial`, lưu đệm 10 phút |
| GET | `/api/v1/air/sources` | nguồn, độ phân giải, mô tả giải thuật, độ phủ CSDL |
| GET | `/api/v1/air/model-metrics` | kết quả huấn luyện/kiểm thử |
| GET | `/api/v1/air/verification` | đối chiếu trực tuyến dự báo đã phát hành |
| GET | `/api/v1/air/status` | trạng thái cập nhật realtime |
| POST | `/api/v1/admin/air/update` | (admin) chạy ngay một lượt cập nhật |
| POST | `/api/v1/admin/air/reload-models` | (admin) nạp lại mô hình sau khi huấn luyện |

Các API cũ (`/aqi/current`, `/aqi/spatial-summary`, `/forecast/hourly`) tự động dùng dữ liệu AirData khi đã có, nên bản đồ, cảnh báo và trợ lý AI dùng chung một nguồn số liệu.

---

## 8. Phân tích nâng cao: xác suất, rủi ro, truy vết nguồn, kịch bản (bổ sung 19/11/2026)

Bổ sung theo tài liệu tham chiếu *"Hệ thống dự báo, phân tích xác suất và truy tìm nguồn thải ô nhiễm"*. Toàn bộ là module mới trong `backend/app/airdata/`, không thay đổi kết quả dự báo cũ; mô hình đã huấn luyện vẫn dùng được.

| Mục tài liệu | Module | Nội dung đã cài đặt |
|---|---|---|
| 1. Danh mục dữ liệu | `standards.data_catalog()` | Nguồn, biến, tần suất, trạng thái (đang dùng / bổ sung / chưa có) |
| 2. Ngưỡng & AQI | `standards.py`, `config.WHO_AQG_2021` | QCVN 05:2023 (µg/Nm³) song song WHO 2021; quy đổi `C_N = C·(T/298,15)·(1013,25/P)`; TB 24h chỉ hợp lệ khi ≥ 18/24 giờ; tách "vượt nồng độ" và "vượt AQI" |
| 3. QA/QC | `qaqc.py` | Âm/ngoài miền vật lý (loại), spike Hampel trên chuỗi khử chu kỳ ngày (chỉ gắn cờ), chuỗi đứng ≥ 6 giờ, đoạn thiếu dài nhất, tỷ lệ ngày TB 24h hợp lệ, tổng hợp cờ nguồn gốc `co_hieu`; tiêu chí ≥ 80% |
| 4. Gió, hoa gió | `windrose.py` | `WS = √(U²+V²)`, `WD = (atan2(−U,−V)+360) mod 360`; F_k, C̄_k, P_k, CBPF hướng × tốc độ; lớp lặng gió < 0,5 m/s; độ nhạy 0,3/0,5/1,0 m/s; cờ hướng ít mẫu (< 30) |
| 5. Dự báo từng chất | `evaluation.py`, `features.EXTRA_WX` | Đánh giá theo mùa khô/mưa, đợt cực trị (> P90), phân loại vượt ngưỡng (precision/recall/F1/PR-AUC/Brier); biến bổ sung bức xạ, mây, độ cao lớp biên, gió 100 m, hệ số thông gió |
| 6. Xác suất & rủi ro | `uncertainty.py`, `risk.py` | Ensemble thực nghiệm 400 thành viên từ sai số log trên tập kiểm thử theo nhóm hạn: `Ĉ_m = (1+ŷ)·exp(r_m) − 1`, `p̂ = (1/M)Σ1{Ĉ_m > T}`, q05/q50/q95; PICP, pinball, CRPS, Brier + skill, reliability, ECE, block bootstrap theo ngày; A_T, N_T, E[N_T], PWE, phân phối N_T, P(vượt 2 ngày liên tục) |
| 7. Truy vết nguồn | `source_trace.py` | Thang A-E; mức A (tương quan, giờ cao điểm, ngày thường/cuối tuần, PM2.5/PM10, SO2/NO2, CO/NO2); mức B (hoa gió ô nhiễm, CBPF); mức C (quỹ đạo ngược đơn giản hóa); mức D (PMF = NMF có trọng số, sẵn sàng khi có số liệu hóa học); điểm nghi vấn `Score = Σ w·x` + độ nhạy Dirichlet; nền liên vùng (P10 168 phường) |
| 8-9. Kịch bản & tối ưu | `scenarios.py` | 9 biện pháp, S0-S3 (+ S4 tùy chọn); ΔC, % giảm, PopBenef, người-giờ tránh được; HIA PM2.5 (RR 1,08/10 µg/m³); NPV/BCR; tối ưu ngân sách + ràng buộc công bằng + biên Pareto. **Tỷ phần ngành và chi phí là giả định thử nghiệm.** |
| 10. CSDL | `store.DDL_EXTRA` | `kk_tram`, `kk_quantrac_tram_gio`, `kk_du_bao_phan_vi`, `kk_rui_ro_phuong_ngay`, `kk_nguon_thai`, `kk_chung_cu_nguon`, `kk_kich_ban`, `kk_khituong_bosung_tp_gio` (tự tạo) |
| 11. Giao diện | `frontend/js/air-analysis.js` | Tab "Phân tích xác suất & Truy nguồn": bản đồ P(vượt) theo phường, dải q05-q95, bảng phơi nhiễm, xuất CSV; hoa gió SVG; thang A-E + bản đồ quỹ đạo + ứng viên nguồn; kịch bản + tối ưu; ngưỡng, danh mục dữ liệu, QA/QC, nghiệm thu |
| 13. Nghiệm thu | `analytics.acceptance_payload()` | Tự đánh giá 6 nhóm tiêu chí, nêu rõ phần chưa đạt |

### Chạy để có số liệu thật cho báo cáo

```bat
cd backend
:: (tùy chọn, ~2 phút) khí tượng bổ sung: bức xạ, mây, độ cao lớp biên, gió 100 m
python scripts\airdata_extra_weather.py
:: (tùy chọn, ~25 phút) huấn luyện 2 biến thể có/không biến bổ sung, chọn theo RMSE kiểm định
python scripts\airdata_train.py --extra-wx
:: (khuyến nghị, ~5 phút) ứng viên nguồn thải: OSM + điểm cháy FIRMS + điểm nóng vệ tinh
python scripts\airdata_import_sources.py
:: (BẮT BUỘC, 5-15 phút) hiệu chỉnh xác suất + toàn bộ số liệu/hình cho báo cáo
python scripts\airdata_analytics.py
:: (tùy chọn) kiểm chứng bằng trạm mặt đất OpenAQ - cần OPENAQ_API_KEY trong .env
python scripts\airdata_openaq.py
:: kiểm thử dữ liệu giả lập các module mới
python tests\test_airdata_analytics.py
```

Kết quả: `saved_models/airdata/uncertainty.json` (backend dùng ngay), `saved_models/airdata/analytics/*.json`, `analytics/figures/*.png` (reliability & PICP, hoa gió, hoa gió ô nhiễm, quỹ đạo ngược, bản đồ rủi ro, Pareto) và `analytics/BAO_CAO_SO_LIEU.md` (bảng số liệu đưa vào báo cáo). Mỗi giờ, sau khi làm mới dự báo, backend ghi phân vị (bảng `kk_du_bao_phan_vi`) và rủi ro phường (bảng `kk_rui_ro_phuong_ngay`); tắt bằng `AIRDATA_PERSIST_RISK=0`.

### API bổ sung

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/v1/air/catalog` | danh mục nguồn/biến/trạng thái, bảng ngưỡng QCVN vs WHO, ghi chú đơn vị |
| GET | `/api/v1/air/qaqc?days=30` | báo cáo QA/QC |
| GET | `/api/v1/air/windrose?ward_code=&pollutant=&days=&sectors=8\|16&threshold=&calm=` | hoa gió + hoa gió ô nhiễm |
| GET | `/api/v1/air/probability?ward_code=&pollutant=&standard=qcvn\|who` | q05/q50/q95 theo giờ, P(vượt) theo ngày |
| GET | `/api/v1/air/risk?pollutant=&standard=` (`/risk.csv`) | rủi ro 168 phường × 8 ngày, A_T, N_T, E[N_T], PWE |
| GET | `/api/v1/air/stats?ward_code=&pollutant=&days=&threshold=` | thống kê mô tả, chuỗi vượt dài nhất, P(2 ngày liên tục) |
| GET | `/api/v1/air/trace?ward_code=&pollutant=&days=&event_date=` | truy vết A-E, điểm nghi vấn, quỹ đạo ngược |
| GET | `/api/v1/air/emission-sources` | ứng viên nguồn thải |
| GET / POST | `/api/v1/air/scenarios`, `/scenarios/evaluate`, `/scenarios/optimize` | kịch bản can thiệp và tối ưu |
| GET | `/api/v1/air/acceptance`, `/api/v1/air/evaluation-extra` | nghiệm thu, kết quả đánh giá mở rộng |

### Giới hạn cần nêu khi bảo vệ

- Chưa có chuỗi quan trắc mặt đất công khai đủ dài cho cả 6 chất; "giá trị thực" là trường CAMS hạ quy mô, nên xác suất và sai số phản ánh khả năng dự báo trường này. OpenAQ (nếu có trạm) là kiểm chứng độc lập bổ sung.
- Xác suất được hiệu chỉnh ở cấp TP; sai số hạ quy mô phường chưa định lượng.
- Truy vết nguồn dừng ở mức A-C; mức D cần số liệu thành phần hóa học PM2.5, mức E cần mô hình CTM + kiểm kê phát thải. Điểm nghi vấn chỉ để ưu tiên kiểm tra, không phải phần trăm đóng góp. Dấu hiệu mức A-B phản ánh cả cấu trúc kiểm kê phát thải của CAMS.
- Quỹ đạo ngược dùng gió 10 m, 2D, không khuếch tán - chỉ minh họa; chuẩn là HYSPLIT.
- Kịch bản can thiệp dựa trên tỷ phần ngành và chi phí giả định; O3 không suy tuyến tính.
