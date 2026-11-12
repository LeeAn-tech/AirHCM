"""
Xác minh đăng nhập Google / Facebook / Apple của End-User qua Firebase Authentication.

Luồng: WebGIS mở cửa sổ đăng nhập THẬT của nhà cung cấp (Firebase signInWithPopup)
-> nhận Firebase ID token -> gửi lên Backend -> Backend xác minh chữ ký token bằng
Firebase Admin SDK (serviceAccountKey.json, project "airhcm") và chỉ tin thông tin
(email, họ tên, ảnh đại diện, nhà cung cấp) nằm trong token đã xác minh.
"""
import os

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

    provider_id = (decoded.get("firebase") or {}).get("sign_in_provider")
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise SocialAuthError(f"Phương thức đăng nhập '{provider_id}' không được hỗ trợ.", status_code=400)

    return {
        "uid": decoded["uid"],
        "provider": provider,
        "email": (decoded.get("email") or "").strip().lower(),
        "email_verified": bool(decoded.get("email_verified")),
        "name": (decoded.get("name") or "").strip(),
        "picture": decoded.get("picture") or "",
    }
