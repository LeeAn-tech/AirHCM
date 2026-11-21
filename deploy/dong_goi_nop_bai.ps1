<#
  ĐÓNG GÓI BÀI NỘP AirHCM -> D:\VSCODE\NopBai_AirHCM_LeHoangAn
    1_SourceCode_AirHCM.zip   mã nguồn (đã loại khóa bí mật, thư mục build, .git) + notebook DOAN
    2_Database_AirHCM.zip     bản sao lưu PostgreSQL/PostGIS (pg_dump) + lược đồ SQL + hướng dẫn khôi phục
    3_Data_CSV_AirHCM.zip     dữ liệu gốc GEE/Open-Meteo, danh mục xã/phường, bộ dữ liệu đồng nhất 168 xã/phường x giờ
    4_App_Android\AirHCM.apk  tệp cài ứng dụng Android
    5_BaoCao                  báo cáo Word + PowerPoint (lấy từ "Claude outputs\Ban nop cuoi")
    6_Video                   chép 2 video hướng dẫn vào đây

  Chạy trong PowerShell:
    powershell -ExecutionPolicy Bypass -File D:\VSCODE\AirHCM\deploy\dong_goi_nop_bai.ps1
  Tùy chọn: -BuildApk (build lại APK release bằng Flutter), -SkipDb, -SkipExport, -DbPassword 123456
#>
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$Doan = "D:\VSCODE\DOAN",
    [string]$Out = "D:\VSCODE\NopBai_AirHCM_LeHoangAn",
    [string]$Db = "webgis_aqi_hcm",
    [string]$DbUser = "postgres",
    [string]$DbPassword = "",
    [switch]$BuildApk,
    [switch]$SkipDb,
    [switch]$SkipExport
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$t0 = Get-Date
$tmp = Join-Path $Out "_tam"
$env:PYTHONIOENCODING = "utf-8"

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Green }
function Zip($src, $dst, [switch]$Store) {
    if (Test-Path $dst) { Remove-Item $dst -Force }
    $level = if ($Store) { [IO.Compression.CompressionLevel]::NoCompression } else { [IO.Compression.CompressionLevel]::Optimal }
    [IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, $level, $false, [Text.Encoding]::UTF8)
    "{0,-28} {1,8:N1} MB" -f (Split-Path $dst -Leaf), ((Get-Item $dst).Length / 1MB) | Write-Host
}

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp, (Join-Path $Out "4_App_Android"), (Join-Path $Out "5_BaoCao"), (Join-Path $Out "6_Video") | Out-Null
$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

# ---------------------------------------------------------------------------------------------
Step "1. Mã nguồn (loại khóa bí mật, dữ liệu cá nhân, thư mục build)"
$src = Join-Path $tmp "AirHCM"
$xd = @(".git", ".github", "build", ".dart_tool", ".idea", "__pycache__", "node_modules", ".venv", "venv", "avatars",
        "Claude outputs", ".gradle", "Pods", "data_export", ".pytest_cache", "ephemeral")
$xf = @(".env", ".env.server", "serviceAccountKey.json", "gee-key.json", "auth_store.json", "auth_store.json.tmp",
        "users.json", "subscribers.json", "alerts_history.json", ".embeddings_cache.json", "google-services.json",
        "GoogleService-Info.plist", "*.dump", "*.backup", "*.pem", "*.apk", "*.log", "data_AirHCM.csv", "local.properties")
robocopy $Root $src /E /NFL /NDL /NJH /NJS /NP /XD $xd /XF $xf | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy lỗi khi chép mã nguồn" }
# Notebook thu thập GEE, ETL, huấn luyện (thư mục DOAN) - dữ liệu CSV nằm ở gói 3
$nb = Join-Path $src "DOAN_notebooks"
New-Item -ItemType Directory -Force -Path $nb | Out-Null
Get-ChildItem -Path "$Doan\*" -File -Include *.ipynb, *.sql -ErrorAction SilentlyContinue | Copy-Item -Destination $nb
# Mẫu cấu hình + hướng dẫn cài đặt
$envExample = Join-Path $Root "deploy\env.example"
if (Test-Path $envExample) { Copy-Item $envExample (Join-Path $src "backend\.env.example") }
$guide = Join-Path $Root "deploy\HUONG_DAN_CAI_DAT.md"
if (Test-Path $guide) { Copy-Item $guide $src; Copy-Item $guide $Out }
# Kiểm tra lần cuối: không còn tệp bí mật
$leak = Get-ChildItem $src -Recurse -File -Force | Where-Object { $_.Name -in @(".env", "serviceAccountKey.json", "auth_store.json", "users.json", "subscribers.json", "gee-key.json") }
if ($leak) { $leak | ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "  bỏ tệp bí mật: $($_.FullName)" -ForegroundColor Yellow } }
Zip $src (Join-Path $Out "1_SourceCode_AirHCM.zip")

# ---------------------------------------------------------------------------------------------
if (-not $SkipDb) {
    Step "2. Cơ sở dữ liệu PostgreSQL/PostGIS (pg_dump)"
    $binDir = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int](($_.Directory.Parent.Name -replace '[^\d].*$', '')) } -Descending |
        Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
    if (-not $binDir) { throw "Không tìm thấy pg_dump.exe trong C:\Program Files\PostgreSQL\<phiên bản>\bin" }
    if (-not $DbPassword) {
        $sec = Read-Host "Mật khẩu tài khoản $DbUser của PostgreSQL (Enter = 123456)" -AsSecureString
        $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        if (-not $DbPassword) { $DbPassword = "123456" }
    }
    $env:PGPASSWORD = $DbPassword
    try {
        $dbDir = Join-Path $tmp "Database"
        New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
        & (Join-Path $binDir "pg_dump.exe") -h localhost -U $DbUser -d $Db -Fc -Z 6 --no-owner --no-privileges -f (Join-Path $dbDir "$Db.backup")
        if ($LASTEXITCODE -ne 0) { throw "pg_dump lỗi (sai mật khẩu hoặc PostgreSQL chưa chạy)" }
        & (Join-Path $binDir "pg_dump.exe") -h localhost -U $DbUser -d $Db --schema-only --no-owner --no-privileges -f (Join-Path $dbDir "${Db}_schema.sql")
        & (Join-Path $binDir "psql.exe") -h localhost -U $DbUser -d $Db -c "SELECT relname AS bang, n_live_tup AS so_dong FROM pg_stat_user_tables ORDER BY n_live_tup DESC" |
            Out-File -Encoding utf8 (Join-Path $dbDir "thong_ke_bang.txt")
        if (Test-Path "$Doan\webgis_hcm.sql") { Copy-Item "$Doan\webgis_hcm.sql" $dbDir }
        @"
KHÔI PHỤC CSDL AirHCM (PostgreSQL 14+ có PostGIS)

1) Tạo CSDL và bật PostGIS:
   psql -U postgres -c "CREATE DATABASE $Db;"
   psql -U postgres -d $Db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
2) Khôi phục dữ liệu (5-20 phút):
   pg_restore -U postgres -d $Db --no-owner --no-privileges -j 4 $Db.backup
   (pgAdmin: chuột phải CSDL -> Restore... -> chọn $Db.backup)
3) Kiểm tra:
   psql -U postgres -d $Db -c "SELECT COUNT(*) FROM kk_dongnhat_phuong_gio;"

Tệp kèm theo:
- $Db.backup         : bản sao lưu đầy đủ (định dạng custom của pg_dump)
- ${Db}_schema.sql   : lược đồ toàn bộ bảng, chỉ mục (tham khảo)
- webgis_hcm.sql     : tập lệnh tạo 3 bảng ban đầu (HanhChinh_HCM, TramQuanTrac, LichSu_AQI)
- thong_ke_bang.txt  : số dòng từng bảng tại thời điểm sao lưu
"@ | Out-File -Encoding utf8 (Join-Path $dbDir "HUONG_DAN_KHOI_PHUC.txt")
        Zip $dbDir (Join-Path $Out "2_Database_AirHCM.zip") -Store
    } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------------------------------------
Step "3. Dữ liệu CSV"
$csv = Join-Path $tmp "Data_CSV"
New-Item -ItemType Directory -Force -Path "$csv\1_du_lieu_goc", "$csv\2_dong_nhat_168_xa_phuong_x_gio" | Out-Null
Copy-Item "$Doan\hcm_aerosol_2022_2026.csv", "$Doan\hcm_weather_2022_2026.csv", "$Doan\tphcm-sap-nhap-phuong-xa.csv" "$csv\1_du_lieu_goc" -ErrorAction SilentlyContinue
if (Test-Path "$Root\data_AirHCM.csv") { Copy-Item "$Root\data_AirHCM.csv" "$csv\1_du_lieu_goc" }
foreach ($d in "GEE_HCM_Aerosol", "GEE_HCM_Weather") { if (Test-Path "$Doan\$d") { Copy-Item "$Doan\$d" "$csv\1_du_lieu_goc\$d" -Recurse } }
if (-not $SkipExport) {
    Push-Location (Join-Path $Root "backend")
    try {
        & $python scripts\airdata_export.py --out "$csv\2_dong_nhat_168_xa_phuong_x_gio"
        if ($LASTEXITCODE -ne 0) { Write-Host "  Xuất dữ liệu đồng nhất lỗi - kiểm tra PostgreSQL/Python" -ForegroundColor Yellow }
    } finally { Pop-Location }
}
@"
DỮ LIỆU AirHCM
1_du_lieu_goc/
  hcm_aerosol_2022_2026.csv, hcm_weather_2022_2026.csv : Sentinel-5P (AAI) và ERA5-Land trích từ Google Earth Engine theo xã/phường
  GEE_HCM_Aerosol/, GEE_HCM_Weather/                   : 55 tệp xuất theo tháng từ GEE (trước khi gộp)
  data_AirHCM.csv                                      : chuỗi PM2.5/PM10 theo giờ (Open-Meteo/CAMS) + đặc trưng, dùng huấn luyện phiên bản đầu
  tphcm-sap-nhap-phuong-xa.csv                         : danh mục 168 xã/phường sau sắp xếp 2025
2_dong_nhat_168_xa_phuong_x_gio/
  airhcm_dongnhat_phuong_gio_<năm>.csv.gz : bộ dữ liệu đồng nhất 168 xã/phường x 1 giờ (6 chất + CO2 + khí tượng, cờ co_hieu)
  airhcm_dongnhat_tp_gio.csv.gz           : chuỗi cấp thành phố dùng huấn luyện mô hình
  (Giải nén .gz bằng 7-Zip/WinRAR; tệp năm có hơn 1 triệu dòng nên đọc bằng Python pandas thay vì Excel)
"@ | Out-File -Encoding utf8 (Join-Path $csv "DOC_TOI.txt")
Zip $csv (Join-Path $Out "3_Data_CSV_AirHCM.zip")

# ---------------------------------------------------------------------------------------------
Step "4. Tệp cài ứng dụng Android"
$mob = Join-Path $Root "airhcm_mobile"
if ($BuildApk) {
    Push-Location $mob
    try { flutter build apk --release } finally { Pop-Location }
}
$apk = @("$mob\build\app\outputs\flutter-apk\app-release.apk", "$mob\build\app\outputs\flutter-apk\app-debug.apk") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if ($apk) {
    Copy-Item $apk (Join-Path $Out "4_App_Android\AirHCM.apk") -Force
    "AirHCM.apk <- {0} ({1:N1} MB)" -f $apk, ((Get-Item $apk).Length / 1MB) | Write-Host
} else { Write-Host "  Chưa có APK: chạy lại với -BuildApk" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------------------------
Step "5. Báo cáo Word + PowerPoint"
$final = Join-Path $Root "Claude outputs\Ban nop cuoi"
if (-not (Test-Path $final)) { $final = Join-Path $Root "Claude outputs" }
Get-ChildItem -Path "$final\*" -File -Include *.docx, *.pptx -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "ĐCCT*" } | Copy-Item -Destination (Join-Path $Out "5_BaoCao") -Force
Get-ChildItem (Join-Path $Out "5_BaoCao") | ForEach-Object { "  {0}" -f $_.Name | Write-Host }
"Chép video hướng dẫn cài đặt và video hướng dẫn sử dụng (.mp4) vào thư mục này." | Out-File -Encoding utf8 (Join-Path $Out "6_Video\DOC_TOI.txt")

Remove-Item $tmp -Recurse -Force
Step ("Xong sau {0:N1} phút -> {1}" -f ((Get-Date) - $t0).TotalMinutes, $Out)
Get-ChildItem $Out -Recurse -File | ForEach-Object { "{0,-60} {1,9:N1} MB" -f $_.FullName.Substring($Out.Length + 1), ($_.Length / 1MB) } | Write-Host
Write-Host "`nTải cả thư mục lên Google Drive (chia sẻ 'Bất kỳ ai có đường liên kết') rồi dán link vào email." -ForegroundColor Cyan
