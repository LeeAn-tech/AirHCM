@echo off
chcp 65001 >nul
title AirHCM - WebGIS + Backend
rem Bam dup file nay de chay AirHCM: Backend FastAPI phuc vu luon WebGIS
cd /d "%~dp0backend"
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
rem Dien thoai cam cap USB: app AirHCM goi Backend qua cap (dung duoc ca khi Wi-Fi cong cong chan ket noi)
set "ADB=%LOCALAPPDATA%\Android\sdk\platform-tools\adb.exe"
if exist "%ADB%" "%ADB%" reverse tcp:8000 tcp:8000 >nul 2>&1
rem Mo trinh duyet sau khi may chu khoi dong xong (khoang 8 giay)
start "" /min cmd /c "timeout /t 8 >nul & start http://localhost:8000/"
python run.py
pause
