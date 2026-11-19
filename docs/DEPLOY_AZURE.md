# Triển khai AirHCM lên cloud Azure (link HTTPS ổn định, chạy 24/7)

Kết quả sau khi làm xong:

- WebGIS: `https://<ten-cua-ban>.southeastasia.cloudapp.azure.com/`
- API và tài liệu API: `https://<ten-cua-ban>.southeastasia.cloudapp.azure.com/docs`
- App Android (APK) gọi thẳng vào link trên, dùng được ở mọi nơi có Internet (4G, Wi-Fi bất kỳ).
- Dự báo realtime chạy trên máy chủ: AirData mỗi giờ (phút 05), cảnh báo và ETL mỗi 30 phút, kể cả khi máy tính của bạn tắt.

Thời gian làm lần đầu: khoảng 2–3 giờ. Mọi lệnh trong tài liệu đều chép–dán được; chỗ nào có `<...>` là chỗ bạn thay bằng giá trị của mình.

---

## 0. Kiến trúc và chi phí

```
 Điện thoại / Trình duyệt
          │  HTTPS (443)
          ▼
 ┌──────────────────────── Azure VM (Ubuntu 24.04, 1 GB RAM + 2 GB swap) ───────────────────┐
 │  Caddy (tự cấp chứng chỉ HTTPS)  ──►  Uvicorn/FastAPI 127.0.0.1:8000 (1 tiến trình)     │
 │                                        ├─ WebGIS tĩnh (frontend/)                       │
 │                                        ├─ API /api/v1/...                                │
 │                                        └─ APScheduler: AirData mỗi giờ, cảnh báo/ETL 30' │
 └──────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                │ SSL (5432)
                                                ▼
                         Azure Database for PostgreSQL – Flexible Server (B1MS, PostGIS)

 FastAPI gọi ra ngoài: Google Earth Engine, Open-Meteo, Firebase (đăng nhập + thông báo đẩy), Gemini, Gmail SMTP
```

| Thành phần | Dịch vụ Azure | Cấu hình chọn | Chi phí |
|---|---|---|---|
| Máy chủ ứng dụng | Virtual Machine Linux | `Standard_B2ats_v2` (2 vCPU AMD, 1 GB RAM), nếu không có thì `Standard_B1s` | Miễn phí 750 giờ/tháng trong 12 tháng |
| Ổ đĩa máy ảo | Managed Disk | Premium SSD 64 GB (P6) | Miễn phí (2 ổ P6) |
| Cơ sở dữ liệu | Azure Database for PostgreSQL – Flexible Server | Burstable `B1MS`, 32 GB lưu trữ | Miễn phí 750 giờ/tháng + 32 GB + 32 GB sao lưu, 12 tháng |
| Địa chỉ IP công cộng tĩnh | Public IP (Standard) | 1 IP | Vài USD/tháng, trừ vào credit 100 USD |
| HTTPS | Caddy + Let's Encrypt | – | Miễn phí |

Lưu ý quan trọng:

- 750 giờ ≈ một máy chạy liên tục cả tháng (tháng dài nhất 744 giờ) ⇒ **chỉ tạo 1 máy ảo và 1 máy chủ CSDL**.
- Tạo **tất cả trong cùng một vùng (region)**, ưu tiên `Southeast Asia` (Singapore, gần Việt Nam nhất).
- Vì sao không dùng Render/Railway miễn phí: dịch vụ web miễn phí của Render ngủ sau 15 phút không có truy cập và chỉ có 512 MB RAM, CSDL miễn phí hết hạn sau 30 ngày ⇒ bộ lập lịch dự báo realtime sẽ dừng. Máy ảo Azure chạy 24/7 nên đáp ứng yêu cầu “mở app là có dự báo mới”.
- Khi hết credit hoặc hết 12 tháng mà không gia hạn, Azure for Students **tắt dịch vụ chứ không trừ tiền** của bạn.

---

## 1. Chuẩn bị trên máy Windows

1. Kéo bản code mới nhất về và commit các file vừa thêm (`deploy/`, `docs/DEPLOY_AZURE.md`, thay đổi ở `backend/app/database.py`, `backend/run.py`, `airhcm_mobile/...`), rồi push lên GitHub (repo để **private** cũng được):
   ```powershell
   cd D:\VSCODE\AirHCM
   git add -A
   git status        # kiểm tra KHÔNG có .env, serviceAccountKey.json, gee-key.json, *.pem trong danh sách
   git commit -m "Them cau hinh trien khai Azure"
   git push
   ```
2. Kiểm tra Windows có sẵn `ssh` và `scp` (Windows 10/11 có OpenSSH sẵn):
   ```powershell
   ssh -V
   ```
3. Xem phiên bản PostgreSQL đang dùng ở máy (để chọn đúng phiên bản trên Azure) và các extension đang bật:
   ```powershell
   & "C:\Program Files\PostgreSQL\<so-phien-ban>\bin\psql.exe" -U postgres -d webgis_aqi_hcm -c "SELECT version();" -c "\dx"
   ```
   Ghi lại số phiên bản chính (VD `16` hoặc `17`) và tên các extension (thường chỉ có `postgis`, `plpgsql`).

---

## 2. Kích hoạt Azure for Students

1. Vào `https://azure.microsoft.com/free/students` → **Start free** → đăng nhập bằng **email trường** (`...@...edu.vn`) → xác minh sinh viên. Không cần thẻ tín dụng, nhận 100 USD credit dùng trong 12 tháng.
2. Vào `https://portal.azure.com` → gõ **Subscriptions** ở ô tìm kiếm → thấy gói **Azure for Students**.
3. Đặt cảnh báo chi tiêu (để biết sớm nếu có gì tốn tiền): **Cost Management** → **Budgets** → **Add** → Amount `5` (USD) → Alert conditions `50%` và `100%` → nhập email → **Create**.

---

## 3. Tạo Resource group

**Resource groups** → **Create**:

- Subscription: `Azure for Students`
- Resource group: `rg-airhcm`
- Region: `(Asia Pacific) Southeast Asia`

→ **Review + create** → **Create**.

> Gói sinh viên đôi khi chỉ cho phép một số vùng. Nếu ở các bước sau báo lỗi kiểu *“RequestDisallowedByAzure”* / *“location is restricted”*, hãy chọn vùng khác gần Việt Nam (`East Asia`, `Japan East`, `Korea Central`, `Central India`) và **dùng cùng vùng đó cho cả máy ảo lẫn CSDL**. Khi đó tên miền ở Bước 7 sẽ có dạng `<ten>.<vung>.cloudapp.azure.com`.

---

## 4. Tạo máy chủ CSDL PostgreSQL (Flexible Server)

Ô tìm kiếm → **Azure Database for PostgreSQL flexible servers** → **Create** (hoặc ô tìm kiếm → **Free services** → thẻ *Azure Database for PostgreSQL* → **Create**).

**Thẻ Basics**

| Mục | Giá trị |
|---|---|
| Resource group | `rg-airhcm` |
| Server name | `airhcm-db-<ten-nhom>` (phải duy nhất toàn cầu, chữ thường) → địa chỉ máy chủ sẽ là `airhcm-db-<ten-nhom>.postgres.database.azure.com` |
| Region | Cùng vùng ở Bước 3 |
| PostgreSQL version | **Bằng phiên bản chính ở máy** (Bước 1.3). Nếu không có thì chọn bản cao hơn gần nhất |
| Workload type | `Development` |
| Compute + storage | Bấm **Configure server** → Compute tier `Burstable`, Compute size `Standard_B1ms (1 vCore, 2 GiB)`, Storage size `32 GiB`, Storage autogrow **tắt**, High availability **Disabled**, Backup retention `7 days`, Geo-redundant backup **Disabled** → **Save** |
| Authentication method | `PostgreSQL authentication only` |
| Admin username | `airhcmadmin` (Azure không cho dùng `postgres`, `admin`, `root`...) |
| Password | Mật khẩu mạnh, **chỉ chữ hoa, chữ thường và số** (≥ 12 ký tự) để dán thẳng vào chuỗi kết nối không cần mã hóa. Ghi lại cẩn thận |

> Trang tạo vẫn hiện “Estimated cost per month” – đó là giá tham khảo; trong hạn mức miễn phí (B1MS, 32 GB) bạn không bị trừ tiền.

**Thẻ Networking**

- Connectivity method: `Public access (allowed IP addresses)`
- Firewall rules: bấm **+ Add current client IP address** (IP máy Windows của bạn – để chuyển dữ liệu ở Bước 6).
- **Không** tích “Allow public access from any Azure service within Azure” (IP của máy ảo sẽ được thêm riêng ở Bước 7.3, an toàn hơn).

→ **Review + create** → **Create**. Chờ khoảng 5–10 phút.

---

## 5. Bật PostGIS trên Azure

Azure bắt buộc khai báo (allowlist) extension trước khi `CREATE EXTENSION`:

1. Mở máy chủ CSDL vừa tạo → menu trái **Settings → Server parameters**.
2. Ô tìm kiếm gõ `azure.extensions` → mở danh sách giá trị → tích **POSTGIS** (và các extension khác thấy ở Bước 1.3, trừ `plpgsql`).
3. Bấm **Save** ở trên cùng, chờ thông báo thành công.

(Lệnh `CREATE DATABASE` và `CREATE EXTENSION postgis` sẽ do script ở Bước 6 tự chạy.)

---

## 6. Chuyển dữ liệu từ máy lên Azure

Chạy trong PowerShell tại `D:\VSCODE\AirHCM`:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\migrate_db.ps1 `
    -AzureHost airhcm-db-<ten-nhom>.postgres.database.azure.com `
    -AzureUser airhcmadmin
```

Script sẽ:

1. Tự tìm `pg_dump`/`pg_restore` trong `C:\Program Files\PostgreSQL\<phiên bản>\bin`.
2. Sao lưu CSDL `webgis_aqi_hcm` ở máy (hỏi **mật khẩu postgres của máy**) ra file `%TEMP%\webgis_aqi_hcm.dump`.
3. Hỏi **mật khẩu airhcmadmin của Azure**, tạo CSDL `webgis_aqi_hcm`, bật `postgis`.
4. Khôi phục toàn bộ bảng + dữ liệu (bảng gốc của WebGIS và các bảng AirData `kk_*`), chạy `ANALYZE`.
5. In ra phiên bản PostGIS và 15 bảng có nhiều dòng nhất để bạn đối chiếu với máy.

Mất khoảng 10–30 phút tùy dung lượng và mạng. Nếu lỡ chạy lại, các lỗi “already exists” là bình thường.

---

## 7. Tạo máy ảo (VM)

Ô tìm kiếm → **Virtual machines** → **Create → Azure virtual machine** (hoặc **Free services** → *Linux Virtual Machine* → **Create**).

**Thẻ Basics**

| Mục | Giá trị |
|---|---|
| Resource group | `rg-airhcm` |
| Virtual machine name | `airhcm-vm` |
| Region | Cùng vùng với CSDL |
| Availability options | `No infrastructure redundancy required` |
| Security type | `Standard` (hoặc để mặc định Trusted launch) |
| Image | `Ubuntu Server 24.04 LTS - x64 Gen2` |
| Size | **See all sizes** → chọn `Standard_B2ats_v2` (có nhãn *Free services eligible*). Nếu không có thì `Standard_B1s`. **Không** chọn `B2pts v2` (chip ARM) |
| Authentication type | `SSH public key` |
| Username | `azureuser` |
| SSH public key source | `Generate new key pair`, Key pair name `airhcm-vm_key` |
| Public inbound ports | `Allow selected ports` → tích `SSH (22)`, `HTTP (80)`, `HTTPS (443)` |

**Thẻ Disks**: OS disk size `64 GiB (P6)`, OS disk type `Premium SSD (locally-redundant storage)`, tích *Delete with VM*.

**Thẻ Networking**: để mặc định (tạo VNet mới, Public IP mới loại Standard), tích *Delete public IP and NIC when VM is deleted*.

**Thẻ Management**: **Auto-shutdown: tắt** (máy chủ phải chạy 24/7).

→ **Review + create** → **Create** → hộp thoại *Generate new key pair* → **Download private key and create resource**. Lưu file vào `C:\Users\<ten-ban>\.ssh\airhcm-vm_key.pem` (tạo thư mục `.ssh` nếu chưa có). **Mất file này là không SSH được vào máy nữa.**

### 7.1. Đặt tên miền cho máy ảo

VM `airhcm-vm` → **Overview** → dòng **DNS name: Not configured** → bấm vào → **DNS name label**: `airhcm-<ten-nhom>` → **Save**.

Tên miền của bạn: `airhcm-<ten-nhom>.southeastasia.cloudapp.azure.com` (gọi tắt là `<TEN_MIEN>` ở phần sau). Cũng ở trang này kiểm tra **Assignment = Static** để IP không đổi.

### 7.2. Khóa quyền file khóa SSH (Windows bắt buộc)

```powershell
$key = "$HOME\.ssh\airhcm-vm_key.pem"
icacls $key /inheritance:r
icacls $key /grant:r "$($env:USERNAME):(R)"
```

### 7.3. Cho máy ảo truy cập CSDL

VM → **Overview** → chép **Public IP address**. Mở máy chủ CSDL → **Settings → Networking** → **+ Add a firewall rule**: Name `airhcm-vm`, Start IP và End IP = IP vừa chép → **Save**.

### 7.4. Thử đăng nhập SSH

```powershell
ssh -i $HOME\.ssh\airhcm-vm_key.pem azureuser@<TEN_MIEN>
```

Lần đầu gõ `yes`. Thấy dấu nhắc `azureuser@airhcm-vm:~$` là thành công. (Gõ `exit` để thoát.)

> Tăng bảo mật (khuyên làm): VM → **Networking** → luật cổng 22 → đổi *Source* thành `My IP address`. Khi đổi mạng (về nhà/lên trường) thì cập nhật lại.

---

## 8. Đưa mã nguồn lên máy ảo

### Cách A – Clone từ GitHub (khuyên dùng, cập nhật về sau chỉ cần 1 lệnh)

Trên máy ảo (sau khi `ssh` vào):

```bash
ssh-keygen -t ed25519 -C airhcm-vm -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

Chép dòng `ssh-ed25519 ...` vừa in → GitHub, mở repo AirHCM → **Settings → Deploy keys → Add deploy key** → Title `airhcm-vm`, dán khóa, **không** tích *Allow write access* → **Add key**. Rồi:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
git clone git@github.com:<tai-khoan-github>/<ten-repo>.git ~/AirHCM
ls ~/AirHCM      # thấy backend, frontend, deploy, docs...
```

(Repo public thì chỉ cần `git clone https://github.com/<tai-khoan-github>/<ten-repo>.git ~/AirHCM`.)

### Cách B – Không dùng GitHub

Trên Windows (chỉ đóng gói các file đã commit nên không lẫn file bí mật):

```powershell
cd D:\VSCODE\AirHCM
git archive --format=zip -o $env:TEMP\airhcm.zip HEAD
scp -i $HOME\.ssh\airhcm-vm_key.pem $env:TEMP\airhcm.zip azureuser@<TEN_MIEN>:
```

Trên máy ảo:

```bash
sudo apt-get install -y unzip && unzip -o ~/airhcm.zip -d ~/AirHCM
```

---

## 9. Tài khoản dịch vụ Google Earth Engine cho máy chủ

Ở máy bạn, Earth Engine đăng nhập bằng tài khoản Google cá nhân (`earthengine authenticate`). Máy chủ không có trình duyệt nên dùng **service account**:

1. `https://console.cloud.google.com` → chọn project **master-magnet-470812-h1**.
2. **IAM & Admin → Service Accounts → + Create service account**: tên `airhcm-server` → **Create and continue**.
3. Gán 2 vai trò: **Earth Engine Resource Viewer** và **Service Usage Consumer** → **Done**.
4. Bấm vào service account vừa tạo → **Keys → Add key → Create new key → JSON** → tải về, **đổi tên thành `gee-key.json`** và đặt vào `D:\VSCODE\AirHCM\backend\` (đã nằm trong `.gitignore`).
5. Ghi lại email của service account, dạng `airhcm-server@master-magnet-470812-h1.iam.gserviceaccount.com`.

> Asset ranh giới phường `projects/master-magnet-470812-h1/assets/PhuongXa_HCM` nằm trong cùng project nên service account đọc được nhờ vai trò ở bước 3.
>
> Nếu chưa tạo được service account, vẫn triển khai được: đặt `AIRDATA_GEE=0` trong `.env` máy chủ. Hệ thống dùng Open-Meteo CAMS + hệ số hiệu chỉnh vệ tinh đã có trong CSDL; bật lại GEE sau.

---

## 10. File `.env` cho máy chủ và chép các file bí mật

1. Trên Windows, sao chép `deploy\env.server.example` thành `backend\.env.server` (đã có trong `.gitignore`) và điền:
   - `DATABASE_URL=postgresql://airhcmadmin:<MAT_KHAU_AZURE>@airhcm-db-<ten-nhom>.postgres.database.azure.com:5432/webgis_aqi_hcm?sslmode=require`
   - Các dòng `SMTP_...`, `AUTH_SECRET`, `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `FACEBOOK_...`: **chép nguyên giá trị đang có trong `backend\.env` ở máy** (giữ nguyên `AUTH_SECRET` để người dùng không bị đăng xuất).
   - `AIRDATA_GEE_SERVICE_ACCOUNT=` email service account ở Bước 9.
2. Chép file lên máy ảo bằng script (chạy ở `D:\VSCODE\AirHCM`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\push_to_server.ps1 `
       -Server azureuser@<TEN_MIEN> `
       -Key $HOME\.ssh\airhcm-vm_key.pem
   ```
   Script chép: `.env.server` → `backend/.env`, `serviceAccountKey.json` (Firebase), `gee-key.json`, `users.json`, `subscribers.json`, `auth_store.json`, `alerts_history.json`, thư mục `avatars/`, bộ nhớ đệm embedding của trợ lý AI, toàn bộ `saved_models/` (mô hình RF cũ và 6 mô hình AirData XGBoost), rồi `chmod 600` các file bí mật.

---

## 11. Cài đặt tự động trên máy ảo

```bash
ssh -i $HOME\.ssh\airhcm-vm_key.pem azureuser@<TEN_MIEN>     # (gõ trên PowerShell)
cd ~/AirHCM
bash deploy/setup_server.sh <TEN_MIEN>
```

Script `deploy/setup_server.sh` chạy khoảng 10–15 phút và tự làm:

| Bước | Việc |
|---|---|
| 0 | Báo thiếu nếu chưa có `.env`, `serviceAccountKey.json`, mô hình |
| 1 | Đặt múi giờ `Asia/Ho_Chi_Minh` (ngày giờ hệ thống của dự báo đúng giờ Việt Nam) |
| 2 | Tạo 2 GB swap (máy 1 GB RAM cần thêm bộ nhớ ảo khi nạp pandas/XGBoost) |
| 3 | Cài Python venv, công cụ biên dịch, `psql` |
| 4 | Cài Caddy |
| 5 | Tạo `~/AirHCM/.venv`, cài thư viện theo `deploy/requirements-server.txt` (đúng phiên bản scikit-learn/XGBoost đã dùng để huấn luyện) |
| 6 | Thử kết nối CSDL Azure và in phiên bản PostGIS |
| 7 | Cài dịch vụ systemd `airhcm` (tự khởi động lại khi lỗi hoặc khi máy khởi động lại) |
| 8 | Cấu hình Caddy cho `<TEN_MIEN>` – Caddy tự xin chứng chỉ HTTPS |
| 9 | Chờ backend trả lời `/api/v1/health` rồi in các link |

Kết thúc thấy dòng `Backend chạy OK.` và 3 link là xong.

---

## 12. Cho phép đăng nhập Google/Facebook trên tên miền mới

- **Firebase**: `https://console.firebase.google.com` → project AirHCM → **Authentication → Settings → Authorized domains → Add domain** → nhập `<TEN_MIEN>` (không có `https://`).
- **Facebook** (nếu dùng): `https://developers.facebook.com` → ứng dụng → **App settings → Basic** → *App domains* thêm `<TEN_MIEN>`; mục *Website → Site URL* = `https://<TEN_MIEN>/` → **Save changes**.

---

## 13. Kiểm tra

Trên trình duyệt (máy tính và điện thoại dùng 4G):

| Link | Mong đợi |
|---|---|
| `https://<TEN_MIEN>/` | WebGIS mở, có ổ khóa HTTPS, ngày hiện tại đúng, bản đồ 168 phường/xã, dự báo 7 ngày + các tháng tới |
| `https://<TEN_MIEN>/api/v1/health` | JSON có `"AirHCM"` |
| `https://<TEN_MIEN>/api/v1/air/status` | Thời điểm chạy AirData gần nhất (≤ 1 giờ trước) và lần chạy kế tiếp |
| `https://<TEN_MIEN>/docs` | Trang Swagger của API |

Trên máy ảo:

```bash
sudo systemctl status airhcm           # active (running)
sudo journalctl -u airhcm -f           # xem nhật ký realtime (Ctrl+C để thoát)
sudo journalctl -u caddy -n 50         # nhật ký HTTPS
free -h                                # RAM + swap
```

---

## 14. Build APK trỏ về máy chủ cloud

Trên Windows:

```powershell
cd D:\VSCODE\AirHCM\airhcm_mobile
flutter clean
flutter build apk --release --dart-define=AIRHCM_SERVER=https://<TEN_MIEN>
```

File cài đặt: `airhcm_mobile\build\app\outputs\flutter-apk\app-release.apk` → đổi tên thành `AirHCM.apk` để gửi cô. Tên ứng dụng trên điện thoại giờ là **AirHCM**.

- Máy đã cài bản cũ (đang nhớ IP Wi-Fi `192.168.x.x`): khi IP cũ không trả lời, app tự chuyển sang máy chủ cloud và ghi nhớ.
- Muốn đổi máy chủ thủ công: trong app, mục cài đặt máy chủ, nhập `https://<TEN_MIEN>`.
- Đăng nhập Google trên Android dựa vào mã SHA-1 của khóa ký. Bản release hiện ký bằng khóa debug giống bản đang chạy nên không cần làm gì; nếu sau này tạo keystore riêng thì thêm SHA-1 mới vào Firebase (**Project settings → Android app → Add fingerprint**).

---

## 15. Vận hành hằng ngày

**Cập nhật code** (sau khi sửa và push lên GitHub):

```bash
cd ~/AirHCM && bash deploy/update.sh
```

**Huấn luyện lại mô hình bằng dữ liệu mới trên cloud** (huấn luyện ở máy Windows vì máy ảo chỉ 1 GB RAM; IP máy bạn phải có trong firewall CSDL):

```powershell
cd D:\VSCODE\AirHCM\backend
$env:DATABASE_URL = "postgresql://airhcmadmin:<MAT_KHAU_AZURE>@airhcm-db-<ten-nhom>.postgres.database.azure.com:5432/webgis_aqi_hcm?sslmode=require"
python scripts\airdata_train.py
Remove-Item Env:DATABASE_URL
scp -i $HOME\.ssh\airhcm-vm_key.pem -r saved_models\airdata azureuser@<TEN_MIEN>:AirHCM/backend/saved_models/
ssh -i $HOME\.ssh\airhcm-vm_key.pem azureuser@<TEN_MIEN> "sudo systemctl restart airhcm"
```

(Biến môi trường đặt trong cửa sổ PowerShell được ưu tiên hơn `backend\.env`, nên máy bạn vẫn dùng CSDL cục bộ ở các lần chạy khác.)

**Sao lưu**: Azure tự sao lưu CSDL 7 ngày gần nhất (khôi phục theo thời điểm: máy chủ CSDL → **Overview → Restore**). Trước khi nộp bài nên tự xuất thêm một bản (dùng `pg_dump` cùng phiên bản hoặc mới hơn máy chủ Azure):

```powershell
& "C:\Program Files\PostgreSQL\<so-phien-ban>\bin\pg_dump.exe" -Fc --no-owner --no-privileges `
  -d "host=airhcm-db-<ten-nhom>.postgres.database.azure.com user=airhcmadmin dbname=webgis_aqi_hcm sslmode=require" `
  -f D:\webgis_aqi_hcm_cloud.dump
```

**Theo dõi credit**: ô tìm kiếm → **Education** (Azure Education Hub) hoặc **Cost Management → Cost analysis**.

**Tạm dừng khi không dùng** (không bắt buộc): VM → **Stop**; CSDL → **Stop** (Azure tự bật lại CSDL sau 7 ngày). Khi bật lại VM, dịch vụ `airhcm` và Caddy tự chạy.

---

## 16. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Trình duyệt báo **502 Bad Gateway** | Backend đang khởi động (nạp mô hình, chạy AirData lần đầu, 1–3 phút) hoặc bị lỗi: `sudo journalctl -u airhcm -n 100 --no-pager` |
| Không vào được `https://`, Caddy báo lỗi chứng chỉ | Chưa mở cổng 80/443 (VM → **Networking**), hoặc DNS name label sai. `sudo journalctl -u caddy -n 50`, sửa xong chạy `sudo systemctl restart caddy` (Caddy tự xin lại chứng chỉ) |
| `connection timed out` khi kết nối CSDL | Thiếu firewall rule cho IP máy ảo (Bước 7.3) hoặc IP máy Windows (Bước 4) |
| `SSL connection is required` | Thiếu `?sslmode=require` cuối `DATABASE_URL` |
| `extension "postgis" is not allow-listed` | Chưa làm Bước 5 hoặc chưa bấm **Save** |
| `password authentication failed` | Sai mật khẩu/tên người dùng; mật khẩu có ký tự đặc biệt thì đổi sang chỉ chữ + số (CSDL → **Reset password**) |
| Nhật ký có `Killed` / máy rất chậm | Hết RAM: kiểm tra `free -h` có swap 2 GB; giảm `AIRDATA_MONTHLY_OUTLOOK`; hoặc đổi VM sang `Standard_B2als_v2` (4 GB, trả phí từ credit) |
| Lỗi Earth Engine (`not registered`, `permission denied`) | Kiểm tra 2 vai trò của service account, đường dẫn `AIRDATA_GEE_KEY_FILE`; tạm đặt `AIRDATA_GEE=0` rồi `sudo systemctl restart airhcm` |
| Giờ dự báo lệch 7 tiếng | `timedatectl` phải là `Asia/Ho_Chi_Minh`; chạy lại `sudo timedatectl set-timezone Asia/Ho_Chi_Minh` |
| Không gửi được email cảnh báo | Azure chặn cổng 25; Gmail dùng 465/587 vẫn được. Kiểm tra `SMTP_APP_PASSWORD` |
| App Android “không kết nối được máy chủ” | Mở `https://<TEN_MIEN>/api/v1/health` bằng trình duyệt điện thoại; kiểm tra APK đã build với `--dart-define=AIRHCM_SERVER=...` |
| `pg_restore` lỗi phiên bản | Phiên bản PostgreSQL trên Azure thấp hơn máy: tạo lại máy chủ CSDL với phiên bản bằng hoặc cao hơn |
| Vùng bị từ chối khi tạo tài nguyên | Xem ghi chú ở Bước 3 |

---

## 17. Phần cần ghi vào email/báo cáo gửi GVHD

- **Link phần mềm (WebGIS)**: `https://<TEN_MIEN>/`
- **Tài liệu API**: `https://<TEN_MIEN>/docs`
- **File cài đặt Android**: `AirHCM.apk` (build ở Bước 14)
- **Mô hình triển khai**: Azure VM Ubuntu 24.04 (Caddy HTTPS + FastAPI/Uvicorn + APScheduler) và Azure Database for PostgreSQL Flexible Server (PostGIS); dữ liệu cập nhật realtime mỗi giờ từ GEE + Open-Meteo, dự báo 192 giờ (7–8 ngày) và triển vọng 3 tháng.

Các file liên quan trong mã nguồn: `deploy/setup_server.sh`, `deploy/airhcm.service`, `deploy/Caddyfile`, `deploy/requirements-server.txt`, `deploy/env.server.example`, `deploy/migrate_db.ps1`, `deploy/push_to_server.ps1`, `deploy/update.sh`.
