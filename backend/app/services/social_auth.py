"""
Xác minh đăng nhập Google / Facebook / Apple của End-User qua Firebase Authentication.

Luồng: WebGIS mở cửa sổ đăng nhập THẬT của nhà cung cấp (Firebase signInWithPopup)
-> nhận Firebase ID token -> gửi lên Backend -> Backend xác minh chữ ký token bằng
Firebase Admin SDK (serviceAccountKey.json, project "airhcm") và chỉ tin thông tin
(email, họ tên, ảnh đại diện, nhà cung cấp) nằm trong token đã xác minh.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CREDENTIAL_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")

# sign_in_provider trong token -> tên hiển thị dùng trong users.json / trang quản trị
PROVIDERS = {"google.com": "Google", "facebook.com": "Facebook", "apple.com": "Apple"}


class SocialAuthError(Exception):
    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.status_code = status_code


def _firebase_app():
    """Dùng chung app Firebase với dịch vụ Push (nếu đã khởi tạo), nếu chưa thì tự khởi tạo"""
    if firebase_admin._apps:
        return firebase_admin.get_app()
    if os.path.exists(CREDENTIAL_PATH):
        return firebase_admin.initialize_app(credentials.Certificate(CREDENTIAL_PATH))
    # Không có khóa dịch vụ: vẫn xác minh được chữ ký ID token nếu biết Project ID
    return firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "airhcm")})


def verify_social_token(id_token: str) -> dict:
    """Trả về thông tin người dùng đã được nhà cung cấp xác thực, hoặc ném SocialAuthError"""
    if not id_token or len(id_token) < 100:
        raise SocialAuthError("Thiếu mã xác thực từ nhà cung cấp đăng nhập.")
    try:
        decoded = firebase_auth.verify_id_token(id_token, app=_firebase_app(), clock_skew_seconds=10)
    except firebase_auth.ExpiredIdTokenError:
        raise SocialAuthError("Phiên xác thực đã hết hạn, vui lòng đăng nhập lại.")
    except (firebase_auth.InvalidIdTokenError, ValueError) as e:
        print(f"-> [Đăng nhập MXH] Token không hợp lệ: {str(e)[:160]}")
        raise SocialAuthError("Mã xác thực không hợp lệ, vui lòng đăng nhập lại.")
    except Exception as e:  # Lỗi mạng khi tải khóa công khai của Google, cấu hình Firebase...
        print(f"-> [Đăng nhập MXH] Không xác minh được token: {e}")
        raise SocialAuthError("Máy chủ chưa xác minh được đăng nhập, vui lòng thử lại sau ít phút.", status_code=503)

    firebase_claims = decoded.get("firebase") or {}
    provider_id = firebase_claims.get("sign_in_provider")
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise SocialAuthError(f"Phương thức đăng nhập '{provider_id}' không được hỗ trợ.", status_code=400)

    identities = (firebase_claims.get("identities") or {}).get(provider_id) or []
    email = (decoded.get("email") or "").strip().lower()
    name = (decoded.get("name") or "").strip()
    # Một số tài khoản (Facebook; Google Workspace / email trường học chưa xác minh với Google) không có email
    # hoặc tên trong token -> đọc hồ sơ nhà cung cấp mà Firebase lưu (provider_data) bằng Admin SDK
    profile = _provider_profile(decoded["uid"], provider_id) if not (email and name) else {}
    return {
        "uid": decoded["uid"],
        "provider": provider,
        # ID tài khoản bên nhà cung cấp (Facebook: app-scoped user ID) - dùng để lấy ảnh đại diện thật
        "provider_uid": str(identities[0]) if identities else "",
        "email": email,
        "email_verified": bool(decoded.get("email_verified")),
        # Facebook: Firebase không đưa email vào token (chưa coi là đã xác minh) nhưng vẫn lưu trong hồ sơ
        "provider_email": "" if email else profile.get("email", ""),
        "name": name or profile.get("name", ""),
        "picture": decoded.get("picture") or "",
    }


def provider_names(uids) -> list:
    """Tên các phương thức (Google / Facebook / Apple) của các danh tính Firebase đã liên kết - đọc bằng Admin SDK"""
    names = []
    for uid in uids or []:
        try:
            record = firebase_auth.get_user(uid, app=_firebase_app())
        except Exception as e:
            print(f"-> [Đăng nhập MXH] Không đọc được hồ sơ Firebase: {type(e).__name__}")
            continue
        for p in record.provider_data:
            name = PROVIDERS.get(p.provider_id)
            if name and name not in names:
                names.append(name)
    return names


def latest_provider(uids) -> str:
    """Phương thức của lần đăng nhập gần nhất trong các danh tính Firebase đã liên kết (theo last_sign_in của Firebase)"""
    best_name, best_ts = "", -1
    for uid in uids or []:
        try:
            record = firebase_auth.get_user(uid, app=_firebase_app())
        except Exception as e:
            print(f"-> [Đăng nhập MXH] Không đọc được hồ sơ Firebase: {type(e).__name__}")
            continue
        ts = (record.user_metadata.last_sign_in_timestamp or 0) if record.user_metadata else 0
        for p in record.provider_data:
            name = PROVIDERS.get(p.provider_id)
            if name and ts > best_ts:
                best_name, best_ts = name, ts
    return best_name


def _provider_profile(uid: str, provider_id: str) -> dict:
    """Email & tên hiển thị mà nhà cung cấp trả về, đọc từ hồ sơ Firebase bằng Admin SDK (cần serviceAccountKey.json)"""
    try:
        record = firebase_auth.get_user(uid, app=_firebase_app())
    except Exception as e:
        print(f"-> [Đăng nhập MXH] Không đọc được hồ sơ Firebase: {type(e).__name__}")
        return {}
    out = {"email": "", "name": (record.display_name or "").strip()}
    for p in record.provider_data:
        if p.provider_id != provider_id:
            continue
        if p.email and not out["email"]:
            out["email"] = p.email.strip().lower()
        if p.display_name and not out["name"]:
            out["name"] = p.display_name.strip()
    return out


# ------------------------------------------------------------------------------
# TRẠNG THÁI ỨNG DỤNG FACEBOOK (Meta có thể tạm khóa ứng dụng: "Ứng dụng không hoạt động")
# Hỏi Graph API bằng app access token; kết quả lưu 10 phút. Lỗi mạng tạm thời KHÔNG coi là bị khóa.
# ------------------------------------------------------------------------------
_FB_TTL_SECONDS = 600
_fb_status = {"checked": 0.0, "available": True, "reason": ""}
_fb_lock = threading.Lock()


def facebook_status() -> dict:
    with _fb_lock:
        if time.time() - _fb_status["checked"] < _FB_TTL_SECONDS:
            return {"available": _fb_status["available"], "reason": _fb_status["reason"]}
        app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
        secret = os.getenv("FACEBOOK_APP_SECRET", "").strip()
        available, reason = True, ""
        if not app_id or not secret:
            available, reason = False, "Máy chủ chưa cấu hình ứng dụng Facebook."
        else:
            url = f"https://graph.facebook.com/v21.0/{app_id}?" + urllib.parse.urlencode(
                {"fields": "id", "access_token": f"{app_id}|{secret}"})
            try:
                urllib.request.urlopen(url, timeout=6).read()
            except urllib.error.HTTPError as e:
                try:
                    err = json.loads(e.read()).get("error", {})
                except Exception:
                    err = {}
                # 200 = ứng dụng bị Meta chặn/hạn chế; 190/101 = App ID / App Secret sai hoặc ứng dụng đã xóa
                if err.get("code") in (200, 190, 101, 803):
                    available = False
                    reason = ("Meta (Facebook) đang tạm khóa ứng dụng đăng nhập của AirHCM. "
                              "Vui lòng đăng nhập bằng Google hoặc Email.")
                    print(f"-> [Đăng nhập MXH] Ứng dụng Facebook không khả dụng: {err.get('message')} "
                          f"(code {err.get('code')}, subcode {err.get('error_subcode')})")
            except Exception:
                pass  # Mất mạng tạm thời: vẫn cho thử, không ẩn nút
        _fb_status.update({"checked": time.time(), "available": available, "reason": reason})
        return {"available": available, "reason": reason}

