# macOS Web Dashboard Workspace

Dashboard web tĩnh chạy trực tiếp trên GitHub Pages. Dữ liệu được đồng bộ qua Supabase REST và luồng OTP khôi phục Admin sử dụng Supabase Auth, không cần chạy Node.js server.

---

## 📁 Cấu Trúc Thư Mục Chuẩn (Project Architecture)

```text
website/
├── assets/                     # Tài nguyên dùng chung của Portal Dashboard
│   ├── css/
│   │   └── dashboard.css       # Toàn bộ CSS giao diện macOS (Top bar, Dock, Window, Spotlight, Modal)
│   ├── js/
│   │   └── dashboard.js        # Controller điều khiển chính, Spotlight Search, State & Backup/Restore
│   └── images/                 # Hình ảnh nền, favicon, icons dùng chung
│
├── apps/                       # Thư mục chứa các ứng dụng độc lập (Sub-Applications)
│   ├── chia-bill/              # 🍻 Ứng dụng Chia Bill & Quản lý quỹ nhóm
│   │   └── index.html
│   ├── tien-com/               # 🍚 Quản lý Tính tiền cơm đồng nghiệp (VietQR + Preset + Báo cáo Zalo)
│   │   └── index.html
│   ├── lai-suat/               # 💵 Tiện ích Tính lãi suất ngân hàng & Lịch trả nợ vay (Chart.js)
│   │   └── index.html
│   └── ghi-chu/                # 📝 Bảng Ghi chú & Đếm ngược (Tìm kiếm tức thì + Bộ lọc danh mục)
│       └── index.html
│
├── legacy/                     # Kho lưu trữ các phiên bản cũ (Archive)
│   └── tiencom-v1.html         # Bản tiền cơm v1 cũ (giữ an toàn dữ liệu lịch sử)
│
├── index.html                  # Entry point chính - Shell giao diện macOS Dashboard
├── manifest.json               # Cấu hình PWA Web App Manifest (Cài đặt làm ứng dụng)
├── service-worker.js           # Bộ nhớ đệm ngoại tuyến (Offline Caching)
├── assets/js/db-config.js      # Supabase URL và anon public key
├── assets/js/db-storage.js     # Đồng bộ trực tiếp với Supabase REST
├── .editorconfig               # Chuẩn hóa format mã nguồn (UTF-8, 2 spaces, CRLF/LF)
├── .gitignore                  # Loại trừ file rác hệ điều hành (.DS_Store, Thumbs.db)
└── README.md                   # Tài liệu kiến trúc và hướng dẫn vận hành
```

---

## 🌟 Các Tính Năng Cao Cấp Đã Được Tích Hợp

### 1. Hệ Điều Hành & Giao Diện macOS (Portal Dashboard)
* **Spotlight Search (`Ctrl + K` hoặc `Cmd + K`)**:
  - Tìm kiếm ứng dụng siêu tốc bằng bàn phím (hỗ trợ phím Mũi tên Lên/Xuống + Enter).
  - Tích hợp **máy tính nhẩm tức thì**: Gõ biểu thức toán học (VD: `500000 / 3`, `120000 * 15`) sẽ ra ngay kết quả và nhấn Enter để sao chép vào bộ nhớ tạm.
* **Menu Apple  Tương Tác**:
  - **Sao lưu toàn bộ dữ liệu (Export JSON)**: Tải về một file JSON duy nhất chứa toàn bộ dữ liệu của tất cả 4 ứng dụng (dữ liệu tiền cơm, ghi chú, chia bill, hình nền).
  - **Khôi phục dữ liệu (Import JSON)**: Tải lên file sao lưu để khôi phục toàn bộ dữ liệu tức thì.
  - **Bộ sưu tập hình nền (Wallpapers Gallery)**: Đổi giữa các hình nền macOS Sonoma, Sequoia, Cyberpunk neon, Mountains hoặc nhập link hình nền tùy ý.
  - **Bật/Tắt chế độ toàn màn hình (`F11`)**.
* **Chỉ Báo Pin Thiết Bị Thực Tế**: Tự động nhận diện % pin và trạng thái sạc (`⚡ 85%`) thông qua Web Battery API.
* **Widget Lịch & Đồng Hồ**: Bấm vào đồng hồ để xem lịch tháng trực quan với ngày hiện tại được đánh dấu nổi bật.
* **Thanh Dock Chuẩn macOS**:
  - Đặt ngang ở đáy màn hình với hiệu ứng phóng to mượt mà (*Magnification*).
  - Chấm sáng hiển thị ứng dụng đang mở (*Active app indicator dot*).
  - Hỗ trợ ghim các app yêu thích và nút chuyển đổi chế độ chỉnh sửa/sắp xếp icon.
* **Cửa Sổ Iframe Nâng Cấp**:
  - Nút đỏ (Đóng), Vàng (Thu nhỏ về Desktop), Xanh (Phóng to tối đa cửa sổ / Toàn màn hình).
  - Tiêu đề cửa sổ hiển thị icon và tên ứng dụng đang chạy.

### 2. Các Ứng Dụng Con Độc Lập (Sub-Apps)
* **Tiện Ích Tính Lãi Suất ([apps/lai-suat/](file:///y:/website/apps/lai-suat/index.html))**:
  - Bổ sung tab **"Lãi Vay Trả Góp"** (vay mua nhà/xe) theo cả 2 phương thức: *Dư nợ giảm dần* và *Dư nợ cố định*.
  - Tích hợp biểu đồ trực quan **Chart.js** (Biểu đồ tròn so sánh Gốc vs Lãi, Biểu đồ cột tăng trưởng lãi kép qua từng năm).
  - Bảng phân kỳ dòng tiền chi tiết từng kỳ trả nợ (*Amortization Schedule*).
* **Quản Lý Tiền Cơm ([apps/tien-com/](file:///y:/website/apps/tien-com/index.html))**:
  - Tích hợp **VietQR động**: Bấm vào nút `📲 QR` cạnh người nợ sẽ tự sinh mã QR ngân hàng thanh toán chuẩn xác số tiền và nội dung chuyển khoản.
  - Cấu hình số tài khoản và ngân hàng nhận tiền tiện lợi.
  - **Nút điền nhanh tiền cơm**: Chọn 1 chạm (30k, 35k, 40k, 45k, 50k) thay vì gõ tay từng dòng.
  - **Nút Copy Báo Cáo Zalo**: Tự tạo và sao chép văn bản công nợ đẹp mắt kèm icon để gửi nhanh vào nhóm chat.
* **Bảng Ghi Chú & Đếm Ngược ([apps/ghi-chu/](file:///y:/website/apps/ghi-chu/index.html))**:
  - Thanh tìm kiếm ghi chú theo từ khóa tức thì (*Real-time search*).
  - 4 tab lọc trạng thái nhanh: *Tất cả, Cần làm, Khẩn cấp, Hoàn thành*.
  - Âm thanh chuông báo tinh tế (*Web Audio API*) khi hết giờ đếm ngược.
* **Hỗ Trợ PWA (Progressive Web App)**:
  - Tích hợp `manifest.json` và `service-worker.js` cho phép cài đặt website thành app độc lập trên Windows/Mac/Android/iOS và chạy ngoại tuyến 100%.

---

## Triển khai GitHub Pages

1. Push các file tĩnh lên repository GitHub.
2. Vào `Settings > Pages`.
3. Chọn `Deploy from a branch`, branch `main`, thư mục `/ (root)`.
4. Mở địa chỉ Pages sau khi quá trình deploy hoàn tất.

Không đưa database password, `service_role` key hoặc Gmail App Password vào repository. `SUPABASE_URL` và anon/publishable key trong `assets/js/db-config.js` là thông tin dành cho client; bảo mật dữ liệu phải được thực thi bằng Supabase Row Level Security.

## Cấu hình OTP Admin

1. Trong Supabase Dashboard, mở `Authentication > Providers > Email` và bật Email Auth.
2. Mở `Authentication > Email Templates > Magic Link` và dùng `{{ .Token }}` trong nội dung email để Supabase gửi mã OTP thay vì chỉ gửi magic link.
3. Trong `Authentication > SMTP Settings`, cấu hình SMTP của nhà cung cấp email. Gmail cần dùng App Password, không dùng mật khẩu đăng nhập Gmail.
4. Đặt thời hạn OTP trong phần cấu hình Email Auth. Giao diện áp dụng thời gian chờ gửi lại 60 giây theo giới hạn mặc định của Supabase.
5. Trong Dashboard web, lưu đúng email cứu hộ Admin. Lần gửi OTP đầu tiên sẽ tạo Supabase Auth user cho email này nếu chưa tồn tại.

Mẫu tối thiểu cho email template:

```html
<h2>Mã OTP khôi phục Admin</h2>
<p>Mã xác minh của bạn:</p>
<p style="font-size: 28px; font-weight: 700;">{{ .Token }}</p>
<p>Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p>
```

Supabase Auth gửi và xác minh OTP. Sau khi mã hợp lệ, access token của phiên xác thực mới được dùng để cập nhật hash mật khẩu Admin trong `system_store`.
