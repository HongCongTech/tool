# 🧠 Trung Tâm Dữ Liệu Train & Bộ Nhớ Dài Hạn Của AI (Personal AI Memory Vault)

Thư mục này nằm trực tiếp trong mã nguồn hệ thống web (`x:/tool/data/ai_memory/`), đảm bảo toàn bộ dữ liệu chat cá nhân hóa, thói quen, chỉ thị công việc và tập dữ liệu huấn luyện (Training Dataset) được lưu trữ vĩnh viễn, an toàn và dễ dàng quản lý.

---

## 📁 Cấu Trúc Các Tệp Dữ Liệu

| Tệp tin | Định dạng | Mục đích sử dụng |
| :--- | :--- | :--- |
| **`personal_profile.json`** | JSON | Hồ sơ người dùng, các nguyên tắc làm việc, phong cách giao tiếp và các ghi nhớ dài hạn (Memory Vault). |
| **`memory_train_dataset.jsonl`** | JSON-Lines | Tập dữ liệu huấn luyện chuẩn định dạng Chat/Instruction (tương thích OpenAI fine-tuning, Ollama Modelfile, Unsloth, LoRA Llama/DeepSeek/Qwen). |
| **`chat_history.json`** | JSON | Lịch sử các phiên trò chuyện của bạn và AI, có đầy đủ mốc thời gian và tin nhắn. |
| **`knowledge_base.json`** | JSON | Cơ sở tri thức về kiến trúc dự án web, các ứng dụng con và quy tắc vận hành hệ thống. |

---

## 🚀 Cách Hoạt Động & Ứng Dụng Trong Thực Tế

1. **Ghi Nhớ Tự Động Trong Web Dashboard (`apps/ai-assistant/index.html`)**:
   - Khi bạn trò chuyện với AI trong ứng dụng **Trợ Lý AI** trên Dashboard, các thông tin quan trọng bạn nhắc đến sẽ được tự động trích xuất thành **Ký ức dài hạn (Memory)**.
   - Các tin nhắn được nạp vào System Prompt của mọi phiên trò chuyện sau này, giúp AI luôn luôn nhớ: bạn là ai, bạn thích phong cách làm việc gì, dự án web đang có những gì.
   - Bạn có thể bấm nút **"Xuất Dữ Liệu Train (JSONL)"** để lưu lại hoặc huấn luyện mô hình riêng.

2. **Ghi Nhớ Trong Antigravity IDE (Pair-Programming)**:
   - File cấu hình `.agents/rules/personal_memory.md` và `AGENTS.md` tại thư mục gốc tự động đọc dữ liệu từ thư mục này.
   - Khi bạn mở dự án bằng Antigravity IDE, trợ lý AI sẽ tự động đọc hồ sơ cá nhân và các quy tắc làm việc của bạn mà bạn không cần phải nhắc lại.

---

## 🛠️ Hướng Dẫn Sử Dụng Dữ Liệu Để Fine-Tune / Train Mô Hình AI

Nếu bạn muốn dùng tệp `memory_train_dataset.jsonl` để huấn luyện một mô hình AI riêng:
1. **OpenAI Fine-Tuning**: Tải tệp `memory_train_dataset.jsonl` lên OpenAI Platform > Fine-tuning > Chọn base model `gpt-4o-mini` hoặc `gpt-3.5-turbo`.
2. **Ollama / Local LLM**: Tạo file `Modelfile` với nội dung `SYSTEM """[Dán nội dung từ personal_profile.json]"""` và chạy `ollama create my-assistant -f Modelfile`.
3. **LoRA / Unsloth**: Dùng file `memory_train_dataset.jsonl` trực tiếp làm tập dữ liệu huấn luyện cho Qwen 2.5, Llama 3 hoặc DeepSeek.
