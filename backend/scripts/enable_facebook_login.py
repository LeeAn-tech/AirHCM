"""
Bật đăng nhập Facebook cho AirHCM trong Firebase Authentication (dự án "airhcm") bằng API,
thay cho thao tác Firebase Console → Authentication → Sign-in method → Facebook.

Chuẩn bị (chỉ làm 1 lần trên developers.facebook.com):
  1. Tạo app (use case "Authenticate and request data from users with Facebook Login").
  2. Facebook Login → Settings → Valid OAuth Redirect URIs:
         https://airhcm.firebaseapp.com/__/auth/handler
  3. App settings → Basic: copy App ID và App secret vào backend/.env:
         FACEBOOK_APP_ID=...
         FACEBOOK_APP_SECRET=...

Chạy (trong thư mục backend):
    python scripts/enable_facebook_login.py            # kiểm tra với Facebook rồi bật trong Firebase
    python scripts/enable_facebook_login.py --status   # chỉ xem trạng thái các phương thức đăng nhập
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(BACKEND_DIR, ".env")
CREDENTIAL_PATH = os.path.join(BACKEND_DIR, "serviceAccountKey.json")
REDIRECT_URI = "https://airhcm.firebaseapp.com/__/auth/handler"


def read_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                key, sep, val = line.strip().partition("=")
                if sep and key.strip() == name:
                    return val.strip().strip('"').strip("'")
    return ""


def firebase_session():
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIAL_PATH, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    with open(CREDENTIAL_PATH, encoding="utf-8") as f:
        project = json.load(f)["project_id"]
    return AuthorizedSession(creds), f"https://identitytoolkit.googleapis.com/admin/v2/projects/{project}", project


def show_status(session, base):
    r = session.get(f"{base}/defaultSupportedIdpConfigs", timeout=30)
    r.raise_for_status()
    configs = {c["name"].split("/")[-1]: c.get("enabled") for c in r.json().get("defaultSupportedIdpConfigs", [])}
    for idp in ("google.com", "facebook.com", "apple.com"):
        state = "ĐANG BẬT" if configs.get(idp) else ("đã cấu hình nhưng TẮT" if idp in configs else "chưa cấu hình")
        print(f"   {idp:<13} {state}")
    return configs


def check_with_facebook(app_id: str, secret: str) -> str:
    """Xin app access token: chỉ thành công khi App ID + App secret khớp nhau"""
    query = urllib.parse.urlencode({"client_id": app_id, "client_secret": secret, "grant_type": "client_credentials"})
    try:
        with urllib.request.urlopen(f"https://graph.facebook.com/oauth/access_token?{query}", timeout=20) as resp:
            token = json.loads(resp.read().decode())["access_token"]
    except urllib.error.HTTPError as e:
        detail = json.loads(e.read().decode() or "{}").get("error", {}).get("message", str(e))
        raise SystemExit(f"❌ Facebook từ chối App ID / App secret: {detail}")
    fields = urllib.parse.urlencode({"fields": "name", "access_token": token})
    try:
        with urllib.request.urlopen(f"https://graph.facebook.com/{app_id}?{fields}", timeout=20) as resp:
            return json.loads(resp.read().decode()).get("name", "")
    except Exception:
        return ""


def main():
    session, base, project = firebase_session()
    print(f"Dự án Firebase: {project}")

    if "--status" in sys.argv:
        show_status(session, base)
        return

    app_id = read_env("FACEBOOK_APP_ID")
    secret = read_env("FACEBOOK_APP_SECRET")
    if not app_id or not secret:
        raise SystemExit(f"❌ Chưa có FACEBOOK_APP_ID / FACEBOOK_APP_SECRET trong {ENV_FILE}")
    if not re.fullmatch(r"\d{10,20}", app_id):
        raise SystemExit("❌ FACEBOOK_APP_ID phải là dãy số (App settings → Basic → App ID)")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", secret):
        raise SystemExit("❌ FACEBOOK_APP_SECRET phải gồm 32 ký tự 0-9/a-f (bấm Show ở App settings → Basic)")

    name = check_with_facebook(app_id, secret)
    print(f"✅ Facebook xác nhận App ID {app_id}{f' ({name})' if name else ''} và App secret khớp nhau")

    body = {"enabled": True, "clientId": app_id, "clientSecret": secret}
    url = f"{base}/defaultSupportedIdpConfigs/facebook.com"
    exists = session.get(url, timeout=30).status_code == 200
    if exists:
        r = session.patch(url, params={"updateMask": "enabled,clientId,clientSecret"}, json=body, timeout=30)
    else:
        r = session.post(f"{base}/defaultSupportedIdpConfigs", params={"idpId": "facebook.com"}, json=body, timeout=30)
    if not r.ok:
        raise SystemExit(f"❌ Firebase không nhận cấu hình ({r.status_code}): {r.text[:300]}")
    print(f"✅ Đã {'cập nhật' if exists else 'bật'} đăng nhập Facebook trong Firebase Authentication")

    print("Trạng thái hiện tại:")
    show_status(session, base)
    print(f"\nNhớ khai báo Valid OAuth Redirect URI trong app Facebook:\n   {REDIRECT_URI}")


if __name__ == "__main__":
    main()
