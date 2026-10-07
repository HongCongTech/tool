---
name: personal_memory
description: >
  Truy xuất và cập nhật bộ nhớ dài hạn của người dùng từ x:/tool/data/ai_memory.
  Bao gồm hồ sơ người dùng, lịch sử chat, các quy tắc công việc và tập dữ liệu huấn luyện JSONL.
---

# Kỹ Năng Quản Lý Bộ Nhớ Cá Nhân Hóa (Personal Memory Skill)

## Mục Đích
Kỹ năng này cho phép AI truy xuất, cập nhật và đồng bộ hóa các ký ức dài hạn, thói quen và quy tắc làm việc của người dùng trong hệ thống `x:/tool`.

## Các Tệp Nguồn Dữ Liệu
- `x:/tool/data/ai_memory/personal_profile.json`: Thông tin cá nhân, phong cách và danh sách ký ức dài hạn.
- `x:/tool/data/ai_memory/chat_history.json`: Lịch sử các phiên hội thoại.
- `x:/tool/data/ai_memory/memory_train_dataset.jsonl`: Dữ liệu huấn luyện đã chuẩn hóa.
- `x:/tool/data/ai_memory/knowledge_base.json`: Kiến thức hệ sinh thái web.

## Quy Trình Xử Lý
1. Khi bắt đầu công việc phức tạp hoặc khi người dùng hỏi "Bạn nhớ gì về tôi?", đọc file `personal_profile.json` để lấy ngữ cảnh mới nhất.
2. Khi người dùng yêu cầu ghi nhớ một thói quen hoặc quy trình mới, ghi thêm vào mảng `long_term_memories` trong `personal_profile.json` và tạo một cặp hội thoại mới trong `memory_train_dataset.jsonl`.
3. Đồng bộ dữ liệu sang `x:/tool/apps/ai-assistant/data/` để giao diện web luôn đồng nhất.
