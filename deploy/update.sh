#!/usr/bin/env bash
# Cập nhật code mới lên máy chủ: cd ~/AirHCM && bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
"$APP_DIR/.venv/bin/pip" install -q -r deploy/requirements-server.txt
sudo systemctl restart airhcm
sleep 10
systemctl --no-pager --lines=0 status airhcm || true
curl -fsS http://127.0.0.1:8000/api/v1/health && echo && echo "Cập nhật xong."
