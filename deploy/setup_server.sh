#!/usr/bin/env bash
# =====================================================================
# Cài AirHCM lên máy ảo Ubuntu 24.04 (Azure B1s) - chạy MỘT lần.
#   cd ~/AirHCM && bash deploy/setup_server.sh <ten-mien>
# VD: bash deploy/setup_server.sh airhcm-nhom2.southeastasia.cloudapp.azure.com
# Trước khi chạy: đã có backend/.env (điền theo deploy/env.server.example),
# backend/serviceAccountKey.json, backend/gee-key.json, backend/saved_models/...
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Thiếu tên miền. Cách dùng: bash deploy/setup_server.sh <ten-mien>" >&2
  exit 1
fi
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
step() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }

step "0. Kiểm tra các file bí mật/dữ liệu đã chép lên chưa"
for f in backend/.env backend/serviceAccountKey.json backend/saved_models/airdata/pm2_5.joblib; do
  [[ -e "$APP_DIR/$f" ]] || warn "Chưa có $f (xem docs/DEPLOY_AZURE.md, Bước 7)"
done

step "1. Múi giờ Việt Nam (để 'ngày hệ thống' của dự báo đúng giờ VN)"
sudo timedatectl set-timezone Asia/Ho_Chi_Minh

step "2. Bộ nhớ ảo (swap) 2 GB - máy B1s chỉ có 1 GB RAM"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo 'vm.swappiness=20' | sudo tee /etc/sysctl.d/99-airhcm.conf >/dev/null
sudo sysctl -p /etc/sysctl.d/99-airhcm.conf >/dev/null
free -h

step "3. Gói hệ thống (Python, thư viện biên dịch, psql)"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  python3-venv python3-dev build-essential libpq-dev postgresql-client \
  git curl gnupg debian-keyring debian-archive-keyring apt-transport-https

step "4. Caddy (máy chủ web, tự cấp chứng chỉ HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

step "5. Môi trường Python ảo + thư viện (mất 5-10 phút)"
[[ -d "$APP_DIR/.venv" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/deploy/requirements-server.txt"

step "6. Kiểm tra kết nối CSDL Azure + PostGIS"
( cd "$APP_DIR/backend" && "$APP_DIR/.venv/bin/python" - <<'PY'
from sqlalchemy import text
from app.database import engine, DATABASE_URL
host = DATABASE_URL.split("@")[-1].split("/")[0]
with engine.connect() as c:
    print("   Kết nối OK:", host)
    print("   PostGIS   :", c.execute(text("SELECT postgis_full_version()")).scalar()[:60], "...")
PY
) || warn "Chưa kết nối được CSDL / chưa bật PostGIS - xem Bước 4-6 trong docs/DEPLOY_AZURE.md"

step "7. Dịch vụ systemd 'airhcm' (tự chạy lại khi lỗi / khi khởi động máy)"
sed -e "s#__USER__#$APP_USER#g" -e "s#__APP_DIR__#$APP_DIR#g" "$APP_DIR/deploy/airhcm.service" \
  | sudo tee /etc/systemd/system/airhcm.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable airhcm >/dev/null
sudo systemctl restart airhcm

step "8. Cấu hình Caddy cho $DOMAIN"
sed "s#__DOMAIN__#$DOMAIN#g" "$APP_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable caddy >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

step "9. Chờ backend khởi động (nạp mô hình, chạy ETL/AirData lần đầu)"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
if [[ $ok == 1 ]]; then
  echo "   Backend chạy OK."
  echo
  echo "   WebGIS : https://$DOMAIN/"
  echo "   API    : https://$DOMAIN/docs"
  echo "   AirData: https://$DOMAIN/api/v1/air/status"
else
  warn "Backend chưa trả lời sau 5 phút. Xem nhật ký: sudo journalctl -u airhcm -n 100 --no-pager"
fi
