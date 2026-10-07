# 📱💻 BỘ QUY TẮC THIẾT KẾ GIAO DIỆN ĐA THIẾT BỊ (RESPONSIVE UI DESIGN SPECIFICATION)
### HỆ THỐNG macOS WEB DASHBOARD TOOL HUB — HONG CONG TECH
*Phiên bản: 1.0.0 (Áp dụng từ System Version 2.6.0)*
*Trạng thái: QUY TẮC BẮT BUỘC TOÀN HỆ THỐNG (Mọi ứng dụng tạo mới phải tuân thủ 100%)*

---

## 🎯 1. TRIẾT LÝ THIẾT KẾ CỐT LÕI (DESIGN PHILOSOPHY)
Mọi ứng dụng trong hệ sinh thái Hong Cong Tech Tool Hub phải tái hiện hoàn hảo trải nghiệm sinh thái Apple:
1. **Desktop / Laptop**: Chuẩn **macOS Sonoma** (Kính mờ Glassmorphism, Window Management, Multi-column Dashboard, Floating Dock).
2. **iPad / Tablet**: Chuẩn **iPadOS Split View** (Hai cột độc lập, chạm vuốt linh hoạt, tối ưu diện tích màn hình 10-13 inch).
3. **Mobile Smartphone**: Chuẩn **iOS 18 Inset Grouped** (Điều hướng Drill-Down hoặc Bottom Navigation, bo góc card tròn mềm mại, danh mục nhóm sạch sẽ, tối ưu thao tác 1 tay).
4. **Nguyên tắc Vàng**: **ZERO-OVERFLOW & ZERO-OVERLAP** (Tuyệt đối không chồng lấn, không vỡ layout, không cụt chữ, không kẹt thanh cuộn trên mọi kích thước màn hình).

---

## 📐 2. HỆ THỐNG BREAKPOINTS CHUẨN TOÀN HỆ THỐNG

| Thiết Bị | Breakpoint CSS | Định Hướng Bố Cục | Triết Lý Trải Nghiệm |
| :--- | :--- | :--- | :--- |
| **Mobile** (iPhone, Galaxy) | `max-width: 767px` | 1 Cột dọc (Single Column), Drill-Down | Thao tác 1 tay, Inset Cards, Icon Action |
| **Tablet / iPad** (iPad, Surface) | `min-width: 768px` và `max-width: 1024px` | Split View 2 Cột (280px + Flex Content) | Cảm ứng 2 tay, form 2 cột, không drill-down |
| **Desktop / Laptop** (MacBook, PC) | `min-width: 1025px` | Multi-Column Dashboard, Windowed View | Đa nhiệm chuột/phím, không gian rộng rãi |

---

## 📱 3. QUY TẮC THIẾT KẾ DÀNH RIÊNG CHO MOBILE (`<= 767px`)

### 3.1. Header Tinh Gọn (Zero-Overlap Header)
- **Chiều cao cố định**: `52px` (hoặc `48px - 56px`), `position: sticky; top: 0; z-index: 100;`.
- **Cụm Action bên phải (Right Actions)**:
  - Nếu text quá dài (ví dụ: *"Quản trị viên (Toàn quyền)"*, *"Đăng Xuất"*, *"Thêm Mới"*): **BẮT BUỘC ẨN CHỮ VÀ CHUYỂN SANG ICON BUTTONS**.
  - Kích thước Touch Target: Nút tối thiểu `34px x 34px` (touch target ảo `44px x 44px`).
  - Sử dụng các icon trực quan: `fa-shield-halved`, `fa-arrow-right-from-bracket`, `fa-key`, `fa-xmark`.
  - Luôn thêm thuộc tính `title="..."` và `aria-label="..."` cho accessibility.
- **Tiêu đề (Brand & Title)**:
  - Tiêu đề bắt buộc có thuộc tính: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;`.
  - Tuyệt đối không để chữ bị ép co cụm thành từng chữ cái 1 dòng.
  - Trên màn hình danh sách: Tiêu đề ngắn gọn (ví dụ: `Cài Đặt`).
  - Khi xem chi tiết (Drill-Down): Hiện nút Back góc trái `< Quay lại`, tiêu đề là tên tính năng chi tiết.

### 3.2. Cấu Trúc Menu Inset Grouped (Apple iOS Style)
- **Container Sidebar**: Bắt buộc dùng `display: block !important;` với `overflow-y: auto; -webkit-overflow-scrolling: touch;`.
- **Khắc phục lỗi Flex Shrink**: Mọi container nhóm (`.nav-group`, `.card`) bên trong flex container PHẢI CÓ `flex-shrink: 0; height: auto; min-height: auto;`. Tuyệt đối không để `overflow: hidden` kết hợp với `flex-shrink: 1` làm browser chém cụt chiều cao nhóm!
- **Item trong nhóm**:
  - `min-height: 48px;` (chuẩn Apple Touch Target).
  - Phân cách giữa các item bằng đường viền mờ `border-bottom: 1px solid rgba(226, 232, 240, 0.7);`, item cuối cùng `border-bottom: none;`.
  - Hiển thị Chevron `>` mờ ở cạnh phải (`fa-chevron-right`) báo hiệu có thể chạm để mở.
  - Phản hồi xúc giác trực quan: Khi chạm `:active`, nền đổi sang màu xám mờ `#f1f5f9`.

### 3.3. Layer Ngang (Horizontal Scroll Pills / Chips)
- Khi có danh mục nhiều tab hoặc bộ lọc ngang:
  - Không bẻ nhiều hàng làm chiếm diện tích màn hình.
  - Bố cục theo dạng hàng ngang trượt tự do:
    ```css
    .pill-scroll-bar {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        white-space: nowrap;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 6px;
    }
    .pill-scroll-bar::-webkit-scrollbar { display: none; }
    ```

### 3.4. Form Nhập Liệu & Bảng Dữ Liệu
- **Form Layout**: Luôn luôn là 1 cột dọc (`grid-template-columns: 1fr;` hoặc `width: 100%;`).
- **Font-size của Input**: Tối thiểu `16px` (để ngăn trình duyệt iOS Safari tự động phóng to giao diện khi người dùng chạm vào ô nhập).
- **Table Responsive**: Mọi thẻ `<table>` bắt buộc phải được bọc trong một container `.table-responsive` có `overflow-x: auto; -webkit-overflow-scrolling: touch;` để người dùng có thể cuộn ngang mượt mà, không vỡ layout ngoài.

---

## 📟 4. QUY TẮC THIẾT KẾ CHO IPAD / TABLET (`768px - 1024px`)

### 4.1. Kiến Trúc iPadOS Split View
- Không áp dụng Drill-down một cột như điện thoại.
- Bố cục 2 cột song song (Two-Pane Layout):
  - **Cột trái (Sidebar / Master List)**: Chiều rộng cố định `280px - 320px`, cuộn riêng biệt.
  - **Cột phải (Detail Panel)**: Chiếm toàn bộ không gian còn lại `flex: 1`, cuộn riêng biệt.
- Ẩn nút Mobile Back Button vì cả hai cột đều hiển thị cùng lúc.

### 4.2. Tương Tác & Bố Cục
- Form chia 2 cột đều đặn: `grid-template-columns: repeat(2, 1fr); gap: 16px;`.
- Thẻ thống kê (Metric Cards): Lưới 2 hoặc 3 cột `repeat(auto-fit, minmax(200px, 1fr))`.
- Touch target vẫn giữ tối thiểu `44px` để thuận tiện điều khiển bằng ngón tay hoặc Apple Pencil.

---

## 🖥️ 5. QUY TẮC THIẾT KẾ CHO DESKTOP / LAPTOP (`>= 1025px`)

### 5.1. Kiến Trúc macOS Cửa Sổ & Dashboard
- Sidebar cố định `280px - 300px`, phong cách Sidebar mờ đục macOS.
- Vùng nội dung chi tiết: Padding rộng rãi `28px - 40px`, max-width nội dung `960px - 1200px` để mắt đọc không bị mỏi.
- Form nhập liệu: Lưới 2-3 cột linh hoạt.
- Bảng dữ liệu hiển thị đầy đủ các cột nghiệp vụ, phân trang, lọc nâng cao.

---

## 🎨 6. BỘ CSS UTILITY RESPONSIVE MẪU (SẴN SÀNG TÁI SỬ DỤNG)

Khi xây dựng ứng dụng mới trong `apps/`, hãy đưa hoặc tham chiếu đoạn CSS Utility này:

```css
/* --- ZERO-OVERLAP RESPONSIVE HELPER UTILITIES --- */

/* Text Truncation An Toàn */
.text-truncate-safe {
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    min-width: 0 !important;
}

/* Ẩn Text Trên Mobile, Chỉ Hiện Trên Desktop/Tablet */
@media (max-width: 767px) {
    .hide-on-mobile { display: none !important; }
    .show-on-mobile { display: block !important; }
    .flex-mobile { display: flex !important; }
    
    /* Chuyển Text Button thành Icon Button */
    .btn-responsive-icon span:not(.badge-dot) {
        display: none !important;
    }
    .btn-responsive-icon {
        width: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 10px !important;
    }

    /* Bảng cuộn an toàn */
    .table-responsive {
        width: 100% !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        border-radius: 12px;
    }

    /* Form 1 cột */
    .responsive-form-grid {
        grid-template-columns: 1fr !important;
        gap: 12px !important;
    }
}

@media (min-width: 768px) {
    .hide-on-desktop { display: none !important; }
    .show-on-desktop { display: block !important; }
    .responsive-form-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 16px !important;
    }
}
```

---

## ✅ 7. CHECKLIST KIỂM TRA TRƯỚC KHI BÀN GIAO MỌI ỨNG DỤNG MỚI

Trước khi thông báo hoàn thành bất kỳ giao diện nào cho anh Công, AI phải tự kiểm tra danh sách này:

- [ ] **Mobile 375px**: Header không bị rớt dòng, chữ không bị bóp cụt, cụm nút action thu gọn thành icon 34px.
- [ ] **Mobile Grouped List**: Mọi nhóm card hiển thị 100% các item con, không item nào bị chém đứt hoặc ẩn mất một phần icon.
- [ ] **Mobile Drill-Down**: Nhấp vào item chuyển sang màn hình con mượt mà, có nút `< Quay lại` rõ ràng.
- [ ] **iPad 820px**: Bố cục 2 cột Split View song song, không drill-down, form 2 cột cân đối.
- [ ] **Desktop 1440px**: Trải nghiệm macOS mượt mà, typography sắc nét, bo góc chuẩn mực.
- [ ] **Thao tác Reset / Xóa**: Luôn yêu cầu xác thực Master Key bảo mật.
- [ ] **Đánh Version**: Đã cập nhật `assets/js/system-version.js` đúng Semantic Versioning.
- [ ] **Content-First Hierarchy**: Tiêu đề và nội dung chính của card/mục luôn là tâm điểm nổi bật nhất; badges, chuông, tags chỉ là phụ trợ dịu mắt.

---

## 🌟 8. NGUYÊN TẮC THỊ GIÁC ƯU TIÊN NỘI DUNG (CONTENT-FIRST VISUAL HIERARCHY) [ÁP DỤNG TOÀN HỆ THỐNG]

### 8.1. Quy Tắc Trọng Tâm Thẻ & Danh Sách (Card & List Item Focus)
- **Nội dung quan trọng nhất phải nổi bật nhất**:
  * **Tiêu đề (Title)**: BẮT BUỘC nằm ở vị trí đầu tiên của khối nội dung. Font size lớn (15px - 16.5px), nét đậm (`font-weight: 700 - 800`), màu sắc đen đậm tương phản cao (`#0f172a` trong Light Theme).
  * **Nội dung / Chi tiết (Details / Note)**: Font size 13px - 13.5px, màu `#334155` rõ nét, đặt ngay dưới tiêu đề.
- **Thành phần kỹ thuật phụ trợ (Badges, Tags, Chuông, Icons)**:
  * **Vị trí**: Đặt DƯỚI nội dung chính hoặc ở Footer/Subline. Tuyệt đối không đặt một hàng dài badges sặc sỡ đè lên trên tiêu đề khiến người dùng bị phân tán thị giác trước khi đọc nội dung.
  * **Màu sắc Muted Pastel**: Dùng nền xám nhạt `#f1f5f9`, viền `#e2e8f0`, chữ `#64748b`. Chỉ dùng màu nổi bật (đỏ/cam) khi thật sự khẩn cấp hoặc quá hạn chót.
  * **Kích thước nhỏ gọn**: Badge pill cao 20-22px, font 10.5px - 11px.

### 8.2. Khung Soạn Thảo / Nhập Mới (Smart Input / Composer Card)
- **Highlight dễ nhận biết**: Viền màu nhấn thanh lịch (ví dụ Indigo/Purple `#c7d2fe` hoặc `#818cf8`), kết hợp dải gradient accent mảnh (3-4px) trên nóc hoặc đổ bóng mềm (`box-shadow: 0 4px 20px -2px rgba(99, 102, 241, 0.12)`).
- **Gọn gàng & Không rườm rà**: 
  * Chiều cao vừa vặn, không chiếm dụng quá nhiều không gian làm đẩy danh sách xuống sâu.
  * Ô nhập tiêu đề và chi tiết tối giản viền trong suốt, liền mạch trong thẻ.
  * Các tùy chọn meta (Hạn chót, Mức độ ưu tiên, Chuông báo, Lặp lại, Tags) tổ chức thành các chip nhỏ gọn, trên mobile xếp lưới 2 cột ngăn nắp.
  * Nút hành động chính (Thêm Mới / Lưu) có gradient nổi bật, kích thước vừa tay.
