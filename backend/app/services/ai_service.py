import joblib
import pandas as pd
import numpy as np
import datetime
from sqlalchemy import text
from app.database import engine
from app.services.dss_service import DSSEngine

class AIForecastService:
    def __init__(self, model_path="saved_models/randomforest_pm25_model.joblib"):
        try:
            self.model = joblib.load(model_path)
            print(f"-> Đã nạp thành công mô hình AI: {model_path}")
        except Exception as e:
            print(f"[CẢNH BÁO] Chưa nạp được model từ {model_path}: {e}")
            self.model = None

    def predict_future_hours(self, hours_ahead=24):
        if self.model is None:
            raise RuntimeError("Mô hình AI chưa được nạp sẵn!")

        # 1. Lấy 25 mốc giờ gần nhất từ CSDL PostGIS để tính các biến trễ lag
        query = text("""
            SELECT thoi_gian, pm2_5, pm10, temperature_2m, dewpoint_temperature_2m, absorbing_aerosol_index
            FROM lichsu_aqi
            WHERE tram_id = 1
            ORDER BY thoi_gian DESC
            LIMIT 26;
        """)
        with engine.connect() as conn:
            df_recent = pd.read_sql(query, conn).sort_values('thoi_gian').reset_index(drop=True)

        if len(df_recent) < 25:
            raise ValueError("Chưa đủ dữ liệu 25 giờ gần nhất trong CSDL để tạo lag features!")

        results = []
        temp_df = df_recent.copy()
        last_recorded_time = temp_df['thoi_gian'].iloc[-1]

        # 2. Vòng lặp dự báo cuốn chiếu từng mốc giờ kế tiếp
        for step in range(1, hours_ahead + 1):
            next_time = last_recorded_time + datetime.timedelta(hours=step)
            hour = next_time.hour
            day_of_week = next_time.weekday()
            month = next_time.month
            is_rainy_season = 1 if 5 <= month <= 11 else 0

            # Lấy các biến trễ từ chuỗi cập nhật
            lag_1h = float(temp_df['pm2_5'].iloc[-1])
            lag_2h = float(temp_df['pm2_5'].iloc[-2])
            lag_24h = float(temp_df['pm2_5'].iloc[-24])

            mean_temp = float(temp_df['temperature_2m'].tail(24).mean())
            mean_dew = float(temp_df['dewpoint_temperature_2m'].tail(24).mean())
            mean_aerosol = float(temp_df['absorbing_aerosol_index'].tail(24).mean())
            mean_pm10 = float(temp_df['pm10'].tail(24).mean())

            # Chuẩn bị vector đặc trưng khớp 100% với file huấn luyện
            feature_vector = pd.DataFrame([{
                'temperature_2m': mean_temp,
                'dewpoint_temperature_2m': mean_dew,
                'absorbing_aerosol_index': mean_aerosol,
                'pm10': mean_pm10,
                'hour': hour,
                'day_of_week': day_of_week,
                'is_rainy_season': is_rainy_season,
                'pm2_5_lag_1h': lag_1h,
                'pm2_5_lag_2h': lag_2h,
                'pm2_5_lag_24h': lag_24h
            }])

            # Dự báo PM2.5
            pred_pm25 = max(0.0, float(self.model.predict(feature_vector)[0]))
            aqi = DSSEngine.calculate_us_aqi(pred_pm25)
            advisory = DSSEngine.get_health_advisory(aqi, pred_pm25)

            results.append({
                "time": next_time.strftime("%Y-%m-%d %H:00"),
                "pm2_5": round(pred_pm25, 2),
                "pm10": round(mean_pm10, 2),
                "aqi": aqi,
                "level": advisory["level"],
                "color": advisory["color"],
                "qcvn_status": advisory["qcvn_comparison"]
            })

            # Bổ sung mốc vừa dự báo vào đuôi dữ liệu để phục vụ bước kế tiếp
            new_record = pd.DataFrame([{
                'thoi_gian': next_time,
                'pm2_5': pred_pm25,
                'pm10': mean_pm10,
                'temperature_2m': mean_temp,
                'dewpoint_temperature_2m': mean_dew,
                'absorbing_aerosol_index': mean_aerosol
            }])
            temp_df = pd.concat([temp_df, new_record], ignore_index=True)

        return results