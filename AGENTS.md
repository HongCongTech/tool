# Antigravity Workspace Guidelines - Hong Cong Tech Tool Hub

## 👤 Thông Tin & Cá Nhân Hóa Người Dùng
- **Người dùng**: Hong Cong Tech.
- **Vai trò**: Quản trị viên & Nhà phát triển hệ thống macOS Web Dashboard Tool Hub (`x:/tool`).
- **Trung tâm bộ nhớ dài hạn**: Mọi dữ liệu về tính cách, thói quen và lịch sử trò chuyện được lưu tại `x:/tool/data/ai_memory/`.
- **Yêu cầu thực thi**: Luôn đọc `personal_profile.json` để đồng bộ ngữ cảnh trước khi thực hiện các tác vụ phức tạp.

## 🛠️ Nguyên Tắc Thiết Kế & Lập Trình
1. **Toàn diện & Triệt để**: Khi người dùng yêu cầu nâng cấp hoặc làm một việc gì đó, hãy làm đầy đủ từ giao diện, logic, lưu trữ cho tới tài liệu hướng dẫn. Tuyệt đối không để dở dang.
2. **Thẩm mỹ xuất sắc**: Giao diện luôn theo phong cách macOS hiện đại (kính mờ, dark mode, font chữ Plus Jakarta Sans hoặc Inter, biểu tượng trực quan, animation mượt mà).
3. **Đồng bộ dữ liệu đa thiết bị**: Mọi thay đổi dữ liệu cần tận dụng lớp cầu nối `assets/js/db-storage.js` để tự động lưu vào localStorage và đồng bộ Supabase Cloud REST.
4. **Tự Động Đánh Version (System Version Gatekeeper)**:
   - Sau mỗi lần nâng cấp hoặc sửa đổi tính năng, AI BẮT BUỘC phải tự động nâng số version trong `assets/js/system-version.js` theo chuẩn Semantic Versioning:
     * **Major** (`X.0.0`): Thay đổi kiến trúc lớn, cấu trúc database, thay đổi breaking change.
     * **Minor** (`X.Y.0`): Bổ sung tính năng mới, module mới, nâng cấp logic nghiệp vụ.
     * **Patch** (`X.Y.Z`): Vá lỗi, sửa logic nhỏ, tinh chỉnh UI, hotfix.
   - Luôn xuất bản version mới nhất lên Supabase key `sys_latest_app_version`.
   - Hệ thống có Gatekeeper kiểm soát phiên bản khởi chạy: nếu phiên bản cũ hơn bản mới nhất trên Cloud thì hiện modal cảnh báo yêu cầu cập nhật hoặc phải nhập Master Key để tiếp tục sử dụng.
5. **Bảo Mật Thao Tác Reset & Chuẩn Hóa Nút Reload**:
   - Mọi thao tác Reset dữ liệu (trong Chia Bill hay bất kỳ ứng dụng nào) BẮT BUỘC phải yêu cầu xác thực Master Key trước khi xóa.
   - Số dư mặc định sau khi reset luôn là `0đ`, tuyệt đối không dùng số dư giả lập.
   - Nút xoay tròn `🔄` trên Header luôn luôn là nút Làm Mới / Đồng Bộ Cloud thực sự (kèm hiệu ứng xoay), không được gắn hàm reset vào nút này.
6. **Chuẩn Thiết Kế Responsive Đa Thiết Bị (Desktop - iPad - Mobile) [BẮT BUỘC KHI TẠO MỚI HOẶC SỬA ỨNG DỤNG]**:
   - Mọi ứng dụng tạo mới hoặc chỉnh sửa BẮT BUỘC phải hỗ trợ hoàn hảo 3 chế độ: **Desktop (`>= 1025px`)**, **Tablet/iPad (`768px - 1024px`)**, và **Mobile (`<= 767px`)**.
   - **Quy tắc Zero-Overlap (Không Chồng Lấn)**: Tuyệt đối không để chữ bị chèn ép thành từng ký tự, không để nút đè lên tiêu đề, không để item con trong danh sách bị cắt xén (chém đứt chiều cao).
   - **Xử Lý Chữ Dài Trên Mobile**: Nếu chữ quá dài so với màn hình nhỏ, BẮT BUỘC ẩn chữ và thay thế bằng **Icon/Logo Action Button** (kèm `title` tooltip), hoặc tổ chức thành **Layer Ngang cuộn tự do (Horizontal Scroll Pills/Chips)**.
   - **iPadOS Split View**: Trên tablet/iPad, luôn áp dụng giao diện 2 cột song song (Sidebar 280-320px + Content Panel), form 2 cột, touch target tối thiểu 44px. Không dùng Drill-down kiểu điện thoại.
   - **Mobile Drill-Down & Inset Grouped**: Trên điện thoại, dùng Inset Grouped Cards bo góc 14-16px, container dùng `display: block` hoặc `flex-shrink: 0` để không bị co dẹp, form 1 cột dọc (100% width), font input >= 16px để chống tự zoom.
   - **Tài liệu đặc tả chi tiết**: Luôn đối chiếu và tuân thủ [RESPONSIVE_UI_DESIGN_SPEC.md](file:///x:/documents/RESPONSIVE_UI_DESIGN_SPEC.md).
7. **Quy Tắc Thị Giác Ưu Tiên Nội Dung (Content-First Visual Hierarchy) [ÁP DỤNG TOÀN BỘ HỆ THỐNG]**:
   - **Trọng tâm nội dung (Content Focus)**: Trong mọi card, danh sách, khối hiển thị: Tiêu đề và Nội dung chính BẮT BUỘC là tâm điểm nổi bật nhất (font to 15-16.5px, chữ đậm 700-800, tương phản cao, đứng ở vị trí đầu tiên).
   - **Muted Badges & Sub-info**: Các thành phần bổ trợ (loại việc, mức ưu tiên, chuông báo, ngày giờ, tags) BẮT BUỘC nằm dưới nội dung chính hoặc ở subline, sử dụng phong cách pastel dịu nhẹ (`#f1f5f9`, border `#e2e8f0`, text `#64748b`), tuyệt đối không lấn át hoặc tranh chấp thị giác với tiêu đề.
   - **Smart Composer / Input Highlight**: Khu vực tạo mới / soạn thảo phải có highlight tinh tế (viền accent indigo/purple, gradient bar trên nóc, shadow mềm), bố cục tinh gọn, không rườm rà.
   - **Đồng Bộ Giao Diện Sáng (Light Theme Modern)**: Các app chức năng sử dụng tông màu sáng sang trọng (Light Theme macOS/iOS) đồng bộ với Control Panel, Tiền Cơm, Chia Bill.

