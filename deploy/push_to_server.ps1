<#
  Chép các file KHÔNG có trên GitHub (bí mật, dữ liệu người dùng, mô hình) từ máy Windows lên máy chủ.
  Chạy trong PowerShell tại thư mục gốc dự án (D:\VSCODE\AirHCM):

    powershell -ExecutionPolicy Bypass -File deploy\push_to_server.ps1 `
        -Server azureuser@airhcm-nhom2.southeastasia.cloudapp.azure.com `
        -Key $HOME\.ssh\airhcm-vm_key.pem

  Cần chuẩn bị trước: backend\.env.server (điền theo deploy\env.server.example) và backend\gee-key.json.
#>
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$RemoteDir = "AirHCM"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$remoteBackend = "$RemoteDir/backend"

function Send-Item([string]$LocalPath, [string]$RemotePath, [switch]$Folder) {
    if (-not (Test-Path $LocalPath)) {
        Write-Host "  (bỏ qua, không có) $LocalPath" -ForegroundColor DarkYellow
        return
    }
    Write-Host "  -> $LocalPath"
    if ($Folder) { scp -i $Key -r $LocalPath "${Server}:$RemotePath" }
    else { scp -i $Key $LocalPath "${Server}:$RemotePath" }
    if ($LASTEXITCODE -ne 0) { throw "scp lỗi khi chép $LocalPath" }
}

Write-Host "== Kiểm tra thư mục $remoteBackend trên máy chủ" -ForegroundColor Green
ssh -i $Key $Server "mkdir -p $remoteBackend/saved_models $remoteBackend/knowledge"
if ($LASTEXITCODE -ne 0) { throw "Không SSH được vào $Server" }

Write-Host "== Cấu hình và khóa bí mật" -ForegroundColor Green
if (-not (Test-Path (Join-Path $backend ".env.server"))) {
    throw "Chưa có backend\.env.server - sao chép deploy\env.server.example thành backend\.env.server rồi điền giá trị"
}
Send-Item (Join-Path $backend ".env.server") "$remoteBackend/.env"
Send-Item (Join-Path $backend "serviceAccountKey.json") "$remoteBackend/serviceAccountKey.json"
Send-Item (Join-Path $backend "gee-key.json") "$remoteBackend/gee-key.json"

Write-Host "== Dữ liệu người dùng (tài khoản, người đăng ký, lịch sử cảnh báo, ảnh đại diện)" -ForegroundColor Green
foreach ($f in @("users.json", "subscribers.json", "auth_store.json", "alerts_history.json")) {
    Send-Item (Join-Path $backend $f) "$remoteBackend/$f"
}
Send-Item (Join-Path $backend "avatars") "$remoteBackend/" -Folder
Send-Item (Join-Path $backend "knowledge\.embeddings_cache.json") "$remoteBackend/knowledge/.embeddings_cache.json"

Write-Host "== Mô hình dự báo đã huấn luyện" -ForegroundColor Green
Get-ChildItem (Join-Path $backend "saved_models") -File | ForEach-Object {
    Send-Item $_.FullName "$remoteBackend/saved_models/$($_.Name)"
}
Send-Item (Join-Path $backend "saved_models\airdata") "$remoteBackend/saved_models/" -Folder

Write-Host "== Khóa quyền đọc các file bí mật trên máy chủ" -ForegroundColor Green
ssh -i $Key $Server "cd $remoteBackend && chmod 600 .env serviceAccountKey.json gee-key.json auth_store.json users.json subscribers.json 2>/dev/null; ls -la"
Write-Host "Xong." -ForegroundColor Green
