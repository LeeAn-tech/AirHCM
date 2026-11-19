<#
  Chuyển CSDL PostgreSQL/PostGIS từ máy Windows lên Azure Database for PostgreSQL (Flexible Server).
  Chạy trong PowerShell (máy có cài PostgreSQL):

    powershell -ExecutionPolicy Bypass -File deploy\migrate_db.ps1 `
        -AzureHost airhcm-db.postgres.database.azure.com -AzureUser airhcmadmin

  Điều kiện: đã bật PostGIS trong "Server parameters > azure.extensions" và đã thêm IP máy này
  vào "Networking > Firewall rules" của máy chủ CSDL (docs/DEPLOY_AZURE.md, Bước 4-6).
  Script hỏi mật khẩu 2 lần: mật khẩu postgres ở máy, rồi mật khẩu quản trị Azure.
#>
param(
    [Parameter(Mandatory = $true)][string]$AzureHost,
    [string]$AzureUser = "airhcmadmin",
    [string]$Db = "webgis_aqi_hcm",
    [string]$LocalUser = "postgres",
    [string]$DumpFile = (Join-Path $env:TEMP "webgis_aqi_hcm.dump")
)
$ErrorActionPreference = "Stop"

# Tìm bộ công cụ PostgreSQL mới nhất đã cài
$binDir = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int](($_.Directory.Parent.Name -replace '[^\d].*$', '')) } -Descending |
    Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
if (-not $binDir) { throw "Không tìm thấy pg_dump.exe trong C:\Program Files\PostgreSQL\<phiên bản>\bin" }
$pgDump = Join-Path $binDir "pg_dump.exe"
$pgRestore = Join-Path $binDir "pg_restore.exe"
$psql = Join-Path $binDir "psql.exe"
Write-Host "Dùng công cụ PostgreSQL tại: $binDir"

Write-Host "`n== 1. Sao lưu CSDL $Db ở máy (nhập mật khẩu postgres của máy)" -ForegroundColor Green
& $pgDump -h localhost -U $LocalUser -d $Db -Fc --no-owner --no-privileges -f $DumpFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump lỗi" }
"{0:N1} MB -> {1}" -f ((Get-Item $DumpFile).Length / 1MB), $DumpFile | Write-Host

Write-Host "`n== 2. Kết nối Azure ($AzureHost)" -ForegroundColor Green
$sec = Read-Host "Mật khẩu quản trị Azure PostgreSQL ($AzureUser)" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:PGSSLMODE = "require"
try {
    $base = "host=$AzureHost port=5432 user=$AzureUser sslmode=require"
    $exists = & $psql "$base dbname=postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$Db'"
    if ($LASTEXITCODE -ne 0) { throw "Không kết nối được Azure - kiểm tra firewall rule cho IP máy này và mật khẩu" }
    if ("$exists".Trim() -ne "1") {
        & $psql "$base dbname=postgres" -c "CREATE DATABASE $Db"
        if ($LASTEXITCODE -ne 0) { throw "Không tạo được CSDL $Db" }
    }
    & $psql "$base dbname=$Db" -c "CREATE EXTENSION IF NOT EXISTS postgis"
    if ($LASTEXITCODE -ne 0) { throw "Chưa bật được PostGIS - thêm POSTGIS vào Server parameters > azure.extensions rồi lưu" }

    Write-Host "`n== 3. Khôi phục dữ liệu lên Azure (có thể mất 10-30 phút)" -ForegroundColor Green
    # Bỏ các mục EXTENSION trong bản sao lưu (đã tạo ở trên; người dùng Azure không sửa được extension)
    $list = Join-Path $env:TEMP "webgis_aqi_hcm.list"
    $items = & $pgRestore -l $DumpFile | Where-Object { $_ -notmatch ' EXTENSION ' }
    [IO.File]::WriteAllLines($list, [string[]]$items)
    & $pgRestore --no-owner --no-privileges --no-comments -j 2 -L $list -d "$base dbname=$Db" $DumpFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "pg_restore báo một số lỗi - đọc ở trên; lỗi 'already exists' khi chạy lại là bình thường." -ForegroundColor Yellow
    }
    & $psql "$base dbname=$Db" -c "ANALYZE"

    Write-Host "`n== 4. Kiểm tra" -ForegroundColor Green
    & $psql "$base dbname=$Db" -c "SELECT postgis_version()" -c "SELECT relname AS bang, n_live_tup AS so_dong FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15"
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
Write-Host "Xong. Có thể xóa file sao lưu: $DumpFile" -ForegroundColor Green
