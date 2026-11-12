"""
Xác thực & phân quyền theo vai trò (RBAC) cho AirHCM.

- Mật khẩu băm PBKDF2-SHA256 (260.000 vòng, muối ngẫu nhiên) - không lưu mật khẩu gốc.
- Token phiên ký HMAC-SHA256 (khóa AUTH_SECRET trong backend/.env), hết hạn sau 12 giờ,
  mang vai trò "admin" hoặc "user". Mọi API quản trị bắt buộc token vai trò admin (require_admin).
- Mật khẩu lưu trong backend/auth_store.json (đã nằm trong .gitignore), tách khỏi users.json
  để hồ sơ thành viên có thể đưa lên Git mà không lộ mã băm.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from typing import Optional

from fastapi import Header, HTTPException

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_FILE = os.path.join(BACKEND_DIR, ".env")
STORE_FILE = os.path.join(BACKEND_DIR, "auth_store.json")
TOKEN_TTL_SECONDS = 12 * 3600
PBKDF2_ROUNDS = 260_000

# Tài khoản quản trị cũ (trước đây kiểm tra bằng JavaScript phía trình duyệt) - chỉ dùng để
# khởi tạo lần đầu, sau đó chỉ còn mã băm. Nên đổi mật khẩu: python scripts/set_admin_password.py
_LEGACY_ADMINS = {
    "admin": ("admin123", "Quản trị viên AirHCM"),
    "hcmunre": ("hcmunre2026", "Hội đồng HCMUNRE"),
}

_lock = threading.Lock()


# ------------------------------------------------------------------------------
# KHÓA KÝ TOKEN
# ------------------------------------------------------------------------------
def _secret() -> bytes:
    value = os.getenv("AUTH_SECRET", "").strip()
    if not value:
        # Lần chạy đầu: sinh khóa ngẫu nhiên và lưu vào backend/.env để token còn hiệu lực sau khi khởi động lại
        value = secrets.token_urlsafe(48)
        try:
            with open(ENV_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n# Khóa ký token đăng nhập (tự sinh) - KHÔNG chia sẻ / commit\nAUTH_SECRET={value}\n")
        except Exception as e:
            print(f"-> [Auth] Không ghi được AUTH_SECRET vào .env: {e}")
        os.environ["AUTH_SECRET"] = value
    return value.encode("utf-8")


# ------------------------------------------------------------------------------
# BĂM MẬT KHẨU
# ------------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, expected = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(rounds))
        return hmac.compare_digest(digest.hex(), expected)
    except Exception:
        return False


# ------------------------------------------------------------------------------
# KHO MẬT KHẨU (auth_store.json)
# ------------------------------------------------------------------------------
def _load_store() -> dict:
    store = {"admins": {}, "users": {}}
    if os.path.exists(STORE_FILE):
        try:
            with open(STORE_FILE, encoding="utf-8") as f:
                data = json.load(f)
                store["admins"] = data.get("admins") or {}
                store["users"] = data.get("users") or {}
        except Exception as e:
            print(f"-> [Auth] Không đọc được auth_store.json: {e}")
    if not store["admins"]:
        for username, (password, fullname) in _LEGACY_ADMINS.items():
            store["admins"][username] = {"fullname": fullname, "password_hash": hash_password(password)}
        _save_store(store)
        print("-> [Auth] Đã khởi tạo tài khoản quản trị (mật khẩu đã băm). Nên đổi mật khẩu mặc định!")
    return store


def _save_store(store: dict):
    tmp = STORE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STORE_FILE)


def check_admin(username: str, password: str) -> Optional[dict]:
    with _lock:
        admin = _load_store()["admins"].get((username or "").strip().lower())
    if admin and verify_password(password or "", admin["password_hash"]):
        return {"username": username.strip().lower(), "fullname": admin.get("fullname") or username}
    return None


def set_admin_password(username: str, password: str, fullname: Optional[str] = None):
    with _lock:
        store = _load_store()
        entry = store["admins"].get(username, {})
        entry["password_hash"] = hash_password(password)
        entry["fullname"] = fullname or entry.get("fullname") or username
        store["admins"][username] = entry
        _save_store(store)


def user_password_hash(email: str) -> Optional[str]:
    with _lock:
        return _load_store()["users"].get((email or "").strip().lower())


def set_user_password(email: str, password: str):
    with _lock:
        store = _load_store()
        store["users"][(email or "").strip().lower()] = hash_password(password)
        _save_store(store)


def remove_user_password(email: str):
    with _lock:
        store = _load_store()
        if store["users"].pop((email or "").strip().lower(), None) is not None:
            _save_store(store)


# ------------------------------------------------------------------------------
# TOKEN PHIÊN ĐĂNG NHẬP
# ------------------------------------------------------------------------------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(subject: str, role: str, name: str = "") -> dict:
    exp = int(time.time()) + TOKEN_TTL_SECONDS
    payload = _b64(json.dumps({"sub": subject, "role": role, "name": name, "exp": exp}, ensure_ascii=False).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest())
    return {"token": f"{payload}.{signature}", "expires_at": exp}


def decode_token(token: str) -> Optional[dict]:
    try:
        payload, signature = token.split(".")
        expected = _b64(hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(_unb64(payload))
        return data if data.get("exp", 0) > time.time() else None
    except Exception:
        return None


def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    """Dependency FastAPI: chỉ cho phép token còn hạn có vai trò admin"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Cần đăng nhập tài khoản Quản trị viên.")
    data = decode_token(authorization.split(" ", 1)[1].strip())
    if not data:
        raise HTTPException(status_code=401, detail="Phiên quản trị đã hết hạn, vui lòng đăng nhập lại.")
    if data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Tài khoản không có quyền Quản trị viên.")
    return data
