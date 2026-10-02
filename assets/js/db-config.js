/**
 * ==============================================================================
 * CẤU HÌNH KẾT NỐI SUPABASE & GOOGLE GEMINI AI (db-config.js)
 * Dành cho hệ thống chạy trực tiếp trên GitHub Pages, Mobile & Localhost
 * ==============================================================================
 */
window.__SUPABASE_CONFIG__ = {
  // Đường dẫn máy chủ Supabase REST API
  url: 'https://wqzwxzwrozbpetbwbgrk.supabase.co',

  // Khóa anon public key của Supabase (Public Client Key - an toàn khi dùng ở client)
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxend4endyb3picGV0YndiZ3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MjA1MzIsImV4cCI6MjEwNjI5NjUzMn0.PMMNYG4AuIpgoSIKvSmqpft17pR53ZmQnruD--wZNiY'
};

// Cấu hình Google Gemini AI mặc định (nếu muốn cấu hình cứng không cần nhập qua giao diện)
window.__AI_CONFIG__ = {
  // Bạn có thể dán trực tiếp Google Gemini API Key vào đây hoặc nhập qua giao diện Cài đặt AI
  geminiApiKey: '',
  model: 'gemini-1.5-flash'
};
