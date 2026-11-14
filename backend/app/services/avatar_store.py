"""
Ảnh đại diện thành viên lưu trên máy chủ AirHCM (thư mục backend/avatars/).

Vì sao không dùng thẳng link ảnh trong Firebase ID token:
- Facebook: link https://graph.facebook.com/<id>/picture KHÔNG kèm access token chỉ trả về
  ảnh bóng người mặc định (Facebook đổi chính sách từ 10/2020). Backend dùng app access token
  (FACEBOOK_APP_ID|FACEBOOK_APP_SECRET trong .env) để lấy ảnh thật.
- Link ảnh trên CDN của Facebook có hạn dùng vài tuần -> tải ảnh về lưu thành file và phục vụ
  qua GET /api/v1/avatars/<file>, để trang quản trị / WebGIS / app mobile luôn hiển thị được.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AVATAR_DIR = os.path.join(BASE_DIR, "avatars")
URL_PREFIX = "/api/v1/avatars/"
GRAPH_API = "https://graph.facebook.com/v21.0"
MAX_BYTES = 2 * 1024 * 1024
REFRESH_AFTER = 24 * 3600  # Cập nhật lại ảnh (người dùng có thể đổi ảnh Facebook) tối đa 1 lần/ngày

_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_NAME_RE = re.compile(r"^u\d{1,9}\.(jpg|png|webp)$")
_MEDIA = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def _app_token():
    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    secret = os.getenv("FACEBOOK_APP_SECRET", "").strip()
    return f"{app_id}|{secret}" if app_id.isdigit() and secret else None


def _open(url: str, timeout: float):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "AirHCM/1.0"}), timeout=timeout)


def _download(url: str):
    with _open(url, 10) as res:
        ext = _TYPES.get((res.headers.get_content_type() or "").lower())
        body = res.read(MAX_BYTES + 1)
    if not ext or not 100 <= len(body) <= MAX_BYTES:
        return None
    return body, ext


def is_placeholder(url: str) -> bool:
    """Link ảnh Facebook không kèm token -> luôn là ảnh bóng người mặc định"""
    return "graph.facebook.com/" in (url or "") and "access_token=" not in url


def is_local(url: str) -> bool:
    return (url or "").startswith(URL_PREFIX)


def facebook_id_from_url(url: str):
    """Lấy ID người dùng Facebook từ link dạng https://graph.facebook.com/<id>/picture"""
    m = re.search(r"graph\.facebook\.com/(?:v[\d.]+/)?(\d+)/picture", url or "")
    return m.group(1) if m else None


def facebook_picture(facebook_user_id: str, size: int = 320):
    """Ảnh đại diện thật của tài khoản Facebook -> (bytes, đuôi file) hoặc None"""
    token = _app_token()
    if not token or not str(facebook_user_id or "").isdigit():
        return None
    query = urllib.parse.urlencode({"redirect": "false", "width": size, "height": size, "access_token": token})
    try:
        with _open(f"{GRAPH_API}/{facebook_user_id}/picture?{query}", 8) as res:
            data = (json.load(res) or {}).get("data") or {}
        if data.get("is_silhouette") or not data.get("url"):
            return None  # Tài khoản chưa đặt ảnh đại diện
        return _download(data["url"])
    except urllib.error.HTTPError as e:  # Không in URL: trong URL có app access token
        print(f"-> [Ảnh đại diện] Facebook từ chối yêu cầu lấy ảnh (HTTP {e.code})")
    except Exception as e:
        print(f"-> [Ảnh đại diện] Không tải được ảnh Facebook: {type(e).__name__}")
    return None


def _path(user_id: int, ext: str) -> str:
    return os.path.join(AVATAR_DIR, f"u{int(user_id)}.{ext}")


def is_fresh(user_id: int, url: str) -> bool:
    """Ảnh đã lưu cho thành viên còn file và mới cập nhật trong REFRESH_AFTER giây"""
    if not is_local(url):
        return False
    for ext in _MEDIA:
        p = _path(user_id, ext)
        if os.path.isfile(p):
            return time.time() - os.path.getmtime(p) < REFRESH_AFTER
    return False


def save(user_id: int, image) -> str:
    """Lưu ảnh của thành viên, trả về đường dẫn tương đối dùng trong users.json"""
    body, ext = image
    os.makedirs(AVATAR_DIR, exist_ok=True)
    target = _path(user_id, ext)
    with open(target + ".tmp", "wb") as f:
        f.write(body)
    os.replace(target + ".tmp", target)
    for other in _MEDIA:  # Xóa ảnh cũ khác định dạng
        if other != ext:
            remove_file(_path(user_id, other))
    # ?v= đổi mỗi lần cập nhật để trình duyệt / app không dùng ảnh cũ trong bộ nhớ đệm
    return f"{URL_PREFIX}u{int(user_id)}.{ext}?v={int(time.time())}"


def remove_file(path: str):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def remove(user_id: int):
    for ext in _MEDIA:
        remove_file(_path(user_id, ext))


def file_for(name: str):
    """(đường dẫn file, media type) của ảnh hợp lệ, hoặc None"""
    if not _NAME_RE.match(name or ""):
        return None
    path = os.path.join(AVATAR_DIR, name)
    if not os.path.isfile(path):
        return None
    return path, _MEDIA[name.rsplit(".", 1)[1]]


def social_avatar(user_id: int, info: dict, current: str = "") -> str:
    """Ảnh đại diện nên dùng cho thành viên đăng nhập Google / Facebook / Apple.

    Trả về "" nếu không có ảnh thật (để gọi hàm dùng ảnh chữ cái viết tắt)."""
    current = "" if is_placeholder(current) else (current or "")
    if info.get("provider") == "Facebook":
        if is_fresh(user_id, current):
            return current
        fb_id = info.get("provider_uid") or facebook_id_from_url(info.get("picture", ""))
        image = facebook_picture(fb_id) if fb_id else None
        return save(user_id, image) if image else current
    picture = info.get("picture") or ""
    return picture if picture and not is_placeholder(picture) else current
