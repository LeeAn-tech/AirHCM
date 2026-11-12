"""
Đổi mật khẩu (hoặc tạo) tài khoản Quản trị viên AirHCM - mật khẩu được băm PBKDF2 trong backend/auth_store.json.

Cách dùng (trong thư mục backend):
    python scripts/set_admin_password.py admin
    python scripts/set_admin_password.py canbo01 --name "Cán bộ quan trắc"
"""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services.auth_service import set_admin_password  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Đổi / tạo mật khẩu tài khoản Quản trị viên AirHCM")
    parser.add_argument("username", help="Tên đăng nhập quản trị (VD: admin)")
    parser.add_argument("--name", help="Tên hiển thị", default=None)
    args = parser.parse_args()

    password = getpass.getpass("Mật khẩu mới (tối thiểu 8 ký tự): ")
    if len(password) < 8:
        sys.exit("❌ Mật khẩu quá ngắn.")
    if getpass.getpass("Nhập lại mật khẩu: ") != password:
        sys.exit("❌ Hai lần nhập không khớp.")
    set_admin_password(args.username.strip().lower(), password, args.name)
    print(f"✅ Đã cập nhật mật khẩu cho tài khoản quản trị '{args.username}'.")


if __name__ == "__main__":
    main()
