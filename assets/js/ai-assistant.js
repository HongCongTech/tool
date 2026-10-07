/**
 * ==============================================================================
 * Kira - Trợ Lý Thông Minh Hệ Thống (ai-assistant.js) - Version 5.0
 * Hỗ trợ Can Thiệp Sâu Hệ Thống + Trực Tuyến Google Gemini Flash API
 * - Can thiệp sâu: Quản lý Tiền Cơm, Reset / Đối soát công nợ về 0, Chia Bill, Ghi Chú, Danh Bạ
 * - Voice Studio tinh gọn: Vùng miền, Tốc độ, Cao độ & Hàng đợi âm thanh không đứt đoạn
 * - Menu Tác vụ nhanh trên Header thay thế thanh gợi ý
 * - Giao diện tối ưu icon-only với macOS Floating Tooltips
 * ==============================================================================
 */

(function () {
  'use strict';

  const AI_CONFIG_KEY = 'sys_ai_config';
  const CHAT_HISTORY_KEY = 'sys_ai_chat_history_v3';
  const AI_PERMANENT_MEMORIES_KEY = 'sys_ai_permanent_memories_v1';
  const AI_PERMANENT_PROFILE_KEY = 'sys_ai_personal_profile_v1';
  const AI_PERMANENT_DATASET_KEY = 'sys_ai_permanent_dataset_v1';
  const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

  // State
  let isListening = false;
  let speechRecognizer = null;
  let isContinuousVoiceActive = false; // Chế độ đối thoại giọng nói liên tục (hands-free)
  let voiceDialogueAutoRestartTimer = null;
  let voiceNoSpeechRetryCount = 0;
  let isTtsSpeaking = false;
  let currentTtsUtterance = null;
  let chatHistory = [];
  let isThinking = false;
  let activeConfirmationData = {};
  let pendingBillImage = null; // { dataUrl, base64, mimeType, name, size }
  let pendingActionToConfirm = null; // { msgId, actionKey, params, title, ... }
  let permanentMemories = [];
  let userProfile = {
    name: "Hong Cong Tech",
    role: "Chủ sở hữu & Quản trị viên Hệ thống macOS Web Tool Hub",
    language: "Tiếng Việt",
    tone_preference: "Chuyên nghiệp, chính xác, xúc tích, tôn trọng, hướng dẫn cụ thể",
    work_context: "Phát triển và vận hành hệ thống macOS Web Dashboard (gồm các app: Chia Bill, Tính Tiền Cơm VietQR, Lãi Suất, Ghi Chú, Danh Bạ và Trợ Lý AI). Yêu cầu code sạch, tối ưu hiệu năng, đồng bộ Supabase và offline cache."
  };
  let permanentDataset = [];

  // --------------------------------------------------------------------------
  // 1. CẤU HÌNH & THÀNH VIÊN HỆ THỐNG
  // --------------------------------------------------------------------------
  function getAiConfig() {
    let cfg = {
      apiKey: '',
      model: DEFAULT_GEMINI_MODEL,
      enabled: true
    };

    // Kiểm tra cấu hình tĩnh trong window.__AI_CONFIG__ (từ db-config.js)
    if (window.__AI_CONFIG__ && window.__AI_CONFIG__.geminiApiKey) {
      cfg.apiKey = window.__AI_CONFIG__.geminiApiKey.trim();
    }

    // Kiểm tra cấu hình đã lưu trong localStorage
    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.apiKey) cfg.apiKey = parsed.apiKey.trim();
      }
    } catch (e) {}

    cfg.model = DEFAULT_GEMINI_MODEL; // Luôn cố định mô hình gemini-3.5-flash-lite
    return cfg;
  }

  // Check if AI is allowed to modify data (admin mode only)
  function isAdminMode() {
    try {
      if (window.dashboard && typeof window.dashboard.isAdmin === 'function') {
        return Boolean(window.dashboard.isAdmin());
      }
      return localStorage.getItem('sys_is_admin') === 'true' || localStorage.getItem('mac_admin_mode') === 'true';
    } catch (e) {
      return false;
    }
  }

  // Helper: true if the user can modify (admin only), false otherwise.
  // Viewing data is always allowed regardless of mode.
  function canModify() {
    return isAdminMode();
  }

  // Expose to window for other modules
  window.canModify = canModify;
  window.isAdminMode = isAdminMode;

  function updateAiAdminBadge(forceAdmin) {
    const badge = document.getElementById('aiWindowAdminBadge');
    if (!badge) return;
    const admin = typeof forceAdmin === 'boolean' ? forceAdmin : isAdminMode();
    if (admin) {
      badge.innerHTML = '🔑';
      badge.className = 'ai-icon-btn ai-mode-pill is-admin';
      badge.title = 'Quản trị viên (Toàn quyền) • Nhấp để đăng xuất về Chế độ xem';
      badge.setAttribute('data-tooltip', 'Quản trị viên (Toàn quyền)');
    } else {
      badge.innerHTML = '👁️';
      badge.className = 'ai-icon-btn ai-mode-pill is-view';
      badge.title = 'Chế độ xem (Chỉ đọc) • Nhấp để đăng nhập Quản trị viên';
      badge.setAttribute('data-tooltip', 'Chế độ xem (Chỉ đọc)');
    }
  }
  window.aiUpdateAdminStatusUI = updateAiAdminBadge;

  function safeDbSet(key, value) {
    // Config and chat history of AI can always be saved
    if (key === AI_CONFIG_KEY || key === 'mac_ai_chat_history_v2') {
      try {
        localStorage.setItem(key, value);
      } catch (e) {}
      return true;
    }

    // Abort if not in admin mode
    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Không được phép chỉnh sửa dữ liệu trong chế độ xem', 'warning');
      }
      console.warn(`safeDbSet blocked for key "${key}": not in admin mode`);
      return false;
    }

    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('localStorage.setItem error:', e);
    }
    if (window.dbStorage) {
      try {
        if (typeof window.dbStorage.setItem === 'function') {
          window.dbStorage.setItem(key, value);
        } else if (typeof window.dbStorage.set === 'function') {
          window.dbStorage.set(key, value);
        }
      } catch (e) {
        console.warn('dbStorage set error:', e);
      }
    }
    return true;
  }

  function saveAiConfig(cfg) {
    safeDbSet(AI_CONFIG_KEY, JSON.stringify(cfg));
    updateAiStatusIndicator();
  }

  function getSystemMembers(includeInactive = false) {
    if (window.memberService && typeof window.memberService.getAllMembers === 'function') {
      const mems = includeInactive ? window.memberService.getAllMembers() : window.memberService.getActiveMembers();
      if (Array.isArray(mems) && mems.length) return mems;
    }

    let list = [];
    try {
      const raw = localStorage.getItem('sys_global_members');
      if (raw) list = JSON.parse(raw);
    } catch (e) {}

    if (Array.isArray(list) && list.length && !includeInactive) {
      list = list.filter(m => m.status === 'active' && m.is_active !== false);
    }

    if (!Array.isArray(list) || !list.length) {
      try {
        const rawP2p = localStorage.getItem('p2p_members');
        if (rawP2p) list = JSON.parse(rawP2p);
      } catch (e) {}
    }

    if (!Array.isArray(list) || !list.length) {
      list = [
        { id: 1, name: 'Đô', nickname: 'Đô', fullName: 'Nguyễn Văn Đô', status: 'active', is_active: true },
        { id: 2, name: 'Đạt', nickname: 'Đạt Còi', fullName: 'Trần Thành Đạt', status: 'active', is_active: true },
        { id: 3, name: 'Công', nickname: 'Công', fullName: 'Lê Thành Công', status: 'active', is_active: true },
        { id: 4, name: 'Hạnh', nickname: 'Hạnh', fullName: 'Phạm Mỹ Hạnh', status: 'active', is_active: true },
        { id: 5, name: 'Quyền', nickname: 'Quyền', fullName: 'Vũ Đình Quyền', status: 'active', is_active: true },
        { id: 6, name: 'Duy', nickname: 'Duy', fullName: 'Hoàng Đức Duy', status: 'active', is_active: true },
        { id: 7, name: 'Huy', nickname: 'Huy', fullName: 'Nguyễn Quang Huy', status: 'active', is_active: true },
        { id: 8, name: 'Thiện', nickname: 'Thiện', fullName: 'Đặng Ngọc Thiện', status: 'active', is_active: true }
      ];
    }
    return list;
  }

  function normalizeVietnamese(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .trim();
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
  }

  function getCurrentTimeStr() {
    const d = new Date();
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  // --------------------------------------------------------------------------
  // 2. QUẢN LÝ LỊCH SỬ HỘI THOẠI (CHAT THREAD)
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 1.1 KHO KÝ ỨC DÀI HẠN & DỮ LIỆU TRAIN CÁ NHÂN HÓA (MEMORY VAULT)
  // --------------------------------------------------------------------------
  async function loadAiPersonalMemory() {
    // 1. Tải Profile cá nhân
    try {
      const rawProf = localStorage.getItem(AI_PERMANENT_PROFILE_KEY);
      if (rawProf) {
        userProfile = { ...userProfile, ...JSON.parse(rawProf) };
      }
    } catch (e) {}

    // 2. Tải danh sách ký ức dài hạn
    let loadedMemories = null;
    try {
      const rawMem = localStorage.getItem(AI_PERMANENT_MEMORIES_KEY);
      if (rawMem) {
        loadedMemories = JSON.parse(rawMem);
      }
    } catch (e) {}

    if (Array.isArray(loadedMemories) && loadedMemories.length > 0) {
      permanentMemories = loadedMemories;
    } else {
      // Thử đọc từ data/ai_memory/personal_profile.json
      try {
        const resp = await fetch('data/ai_memory/personal_profile.json?t=' + Date.now());
        if (resp.ok) {
          const profileJson = await resp.json();
          if (profileJson.user_profile) {
            userProfile = { ...userProfile, ...profileJson.user_profile };
          }
          if (Array.isArray(profileJson.long_term_memories) && profileJson.long_term_memories.length > 0) {
            permanentMemories = profileJson.long_term_memories;
          }
        }
      } catch (e) {}

      // Nếu vẫn trống, nạp mặc định hạt nhân
      if (!permanentMemories || permanentMemories.length === 0) {
        permanentMemories = [
          {
            id: 'mem_core_01',
            category: 'user_profile',
            content: 'Người dùng: Hong Cong Tech (Quản trị viên Hệ thống macOS Web Tool Hub x:/tool).',
            createdAt: new Date().toISOString()
          },
          {
            id: 'mem_core_02',
            category: 'workflow_rules',
            content: 'Hệ thống gồm các ứng dụng: Tiền Cơm VietQR, Chia Bill, Sticky Notes, Danh Bạ, Lãi Suất và Trợ Lý AI. Đồng bộ Supabase REST và offline cache.',
            createdAt: new Date().toISOString()
          },
          {
            id: 'mem_core_03',
            category: 'user_preference',
            content: 'Mọi đoạn chat và kiến thức cá nhân được lưu trữ vĩnh viễn trong data/ai_memory/, giữ nguyên 100% kể cả khi người dùng bấm Xóa chat.',
            createdAt: new Date().toISOString()
          }
        ];
      }
      saveAiPersonalMemory();
    }

    // 3. Tải dataset huấn luyện
    try {
      const rawDs = localStorage.getItem(AI_PERMANENT_DATASET_KEY);
      if (rawDs) {
        permanentDataset = JSON.parse(rawDs);
      }
    } catch (e) {}

    if (!Array.isArray(permanentDataset) || permanentDataset.length === 0) {
      permanentDataset = [
        {
          messages: [
            { role: "system", content: "Bạn là Trợ lý AI cá nhân hóa của Hong Cong Tech, được huấn luyện để nắm rõ hệ thống macOS Web Dashboard x:/tool." },
            { role: "user", content: "Bạn nhớ gì về tôi?" },
            { role: "assistant", content: "Xin chào Hong Cong Tech! Tôi ghi nhớ bạn là Quản trị viên hệ thống Tool Hub x:/tool. Toàn bộ lịch sử trao đổi và các quy tắc của bạn được tôi lưu trữ vĩnh viễn trong kho ký ức dài hạn." }
          ]
        }
      ];
    }

    updateAiMemoryBadge();
  }

  function saveAiPersonalMemory() {
    try {
      localStorage.setItem(AI_PERMANENT_PROFILE_KEY, JSON.stringify(userProfile));
      localStorage.setItem(AI_PERMANENT_MEMORIES_KEY, JSON.stringify(permanentMemories));
      localStorage.setItem(AI_PERMANENT_DATASET_KEY, JSON.stringify(permanentDataset.slice(-300)));
    } catch (e) {}
    updateAiMemoryBadge();
    updateAiMemoryDrawerUI();
  }

  function updateAiMemoryBadge() {
    const badge = document.getElementById('aiMemoryCountBadge');
    const btn = document.getElementById('aiMemoryBtn');
    const count = permanentMemories.length;
    if (badge) {
      badge.textContent = String(count);
    }
    if (btn) {
      btn.title = `Kho Ký Ức Dài Hạn (${count} mục ghi nhớ)`;
      btn.setAttribute('data-tooltip', `Kho Ký Ức (${count})`);
    }
  }

  function toggleAiQuickMenu(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const dropdown = document.getElementById('aiQuickMenuDropdown');
    if (!dropdown) return;
    const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
    dropdown.style.display = isHidden ? 'block' : 'none';
  }

  function selectQuickPrompt(promptText) {
    const dropdown = document.getElementById('aiQuickMenuDropdown');
    if (dropdown) dropdown.style.display = 'none';
    const input = document.getElementById('aiAssistantInput');
    if (input) {
      input.value = promptText;
    }
    submitAiPrompt(promptText);
  }

  window.toggleAiQuickMenu = toggleAiQuickMenu;
  window.selectQuickPrompt = selectQuickPrompt;

  // Đóng quick menu khi click bên ngoài
  document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('aiQuickMenuDropdown');
    const btn = document.getElementById('aiQuickMenuBtn');
    if (dropdown && dropdown.style.display === 'block') {
      if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
        dropdown.style.display = 'none';
      }
    }
  });

  function toggleAiMemoryDrawer() {
    const drawer = document.getElementById('aiMemoryDrawer');
    if (!drawer) return;
    const settingsDrawer = document.getElementById('aiSettingsDrawer');
    if (settingsDrawer) settingsDrawer.style.display = 'none';

    const isVisible = drawer.style.display === 'block';
    drawer.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      updateAiMemoryDrawerUI();
    }
  }

  function updateAiMemoryDrawerUI() {
    const list = document.getElementById('aiMemoryDrawerList');
    if (!list) return;

    if (!permanentMemories || permanentMemories.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:16px; color:#64748b; font-size:12px;">Chưa có ký ức nào. AI sẽ tự động học khi bạn trò chuyện hoặc bạn có thể tự thêm bên dưới!</div>`;
      return;
    }

    let html = '';
    permanentMemories.forEach((mem) => {
      const timeStr = mem.createdAt ? new Date(mem.createdAt).toLocaleDateString('vi-VN') : 'Ghi nhớ cốt lõi';
      const catLabel = mem.category === 'user_profile' ? '👤 Cá nhân' : (mem.category === 'workflow_rules' ? '⚙️ Quy tắc' : '💡 Thói quen/Sở thích');
      html += `
        <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px 10px; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(99,102,241,0.2); color:#a5b4fc; font-weight:600;">${catLabel}</span>
              <span style="font-size:10px; color:#64748b;">${timeStr}</span>
            </div>
            <div style="font-size:12px; color:#e2e8f0; line-height:1.4;">${mem.content}</div>
          </div>
          <button type="button" onclick="deleteAiMemory('${mem.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px 4px; font-size:13px; opacity:0.7;" title="Xóa ký ức này">✕</button>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  function addManualAiMemory() {
    const text = prompt('Nhập thông tin cá nhân, thói quen hoặc chỉ thị công việc bạn muốn AI ghi nhớ vĩnh viễn:');
    if (!text || !text.trim()) return;
    const newMem = {
      id: 'mem_' + Date.now(),
      category: 'user_preference',
      content: text.trim(),
      createdAt: new Date().toISOString()
    };
    permanentMemories.unshift(newMem);
    saveAiPersonalMemory();
    if (typeof window.showToast === 'function') {
      window.showToast('🧠 Đã nạp ký ức mới vào Kho Ký Ức Dài Hạn!');
    }
  }

  function deleteAiMemory(memId) {
    if (!confirm('Bạn có chắc muốn xóa ký ức này khỏi bộ nhớ của AI?')) return;
    permanentMemories = permanentMemories.filter(m => m.id !== memId);
    saveAiPersonalMemory();
    if (typeof window.showToast === 'function') {
      window.showToast('🗑️ Đã xóa ký ức.');
    }
  }

  function downloadAiDatasetJsonl() {
    if (!permanentDataset || permanentDataset.length === 0) {
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ Chưa có dữ liệu huấn luyện nào được ghi nhận.');
      }
      return;
    }
    const lines = permanentDataset.map(item => JSON.stringify(item)).join('\n');
    const blob = new Blob([lines], { type: 'application/jsonl;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory_train_dataset_${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof window.showToast === 'function') {
      window.showToast('📥 Đã tải file train dataset (.jsonl) thành công!');
    }
  }

  function extractAndSavePermanentMemories(text) {
    if (!text || text.length < 5) return;
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const norm = normalizeVietnamese(lower);

    // 1. Tự động nhận diện thay đổi Tên người dùng
    const nameMatch = raw.match(/(?:tôi tên là|tên tôi là|gọi tôi là)\s+([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸa-zàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ\s]{2,25})/i);
    if (nameMatch) {
      const detectedName = nameMatch[1].trim();
      userProfile.name = detectedName;
      saveAiPersonalMemory();
    }

    // 2. Tự động nhận diện câu chỉ thị ghi nhớ hoặc chia sẻ thói quen / quy tắc
    const isMemoryTrigger = 
      norm.includes('nho la') ||
      norm.includes('hay nho') ||
      norm.includes('luu y la') ||
      norm.includes('quy tac la') ||
      norm.includes('luu vao bo nho') ||
      norm.includes('ghi nho giup') ||
      norm.includes('nho giup') ||
      norm.includes('luu thong tin') ||
      norm.includes('tu nay nho') ||
      norm.includes('sau nay nho') ||
      norm.includes('ghi nho la') ||
      norm.includes('toi thich') ||
      norm.includes('toi khong thich') ||
      norm.includes('thoi quen cua toi') ||
      norm.includes('so thich cua toi') ||
      norm.includes('nha toi o') ||
      norm.includes('que toi o') ||
      norm.includes('toi lam nghe') ||
      norm.includes('toi lam o') ||
      norm.includes('stk cua toi') ||
      norm.includes('so tai khoan cua toi') ||
      norm.includes('so dien thoai cua toi') ||
      norm.includes('sdt cua toi');

    if (isMemoryTrigger) {
      const alreadyExists = permanentMemories.some(m => m.content.toLowerCase() === raw.toLowerCase());
      if (!alreadyExists) {
        permanentMemories.unshift({
          id: 'mem_auto_' + Date.now(),
          category: 'user_preference',
          content: raw,
          createdAt: new Date().toISOString()
        });
        saveAiPersonalMemory();
        if (typeof window.showToast === 'function') {
          window.showToast('💡 AI đã tự động ghi nhớ thông tin này vào Kho Ký Ức Dài Hạn!');
        }
      }
    }
  }

  function saveToPermanentDataset(userQuery, assistantReply) {
    if (!userQuery || !assistantReply) return;
    const item = {
      messages: [
        {
          role: "system",
          content: `Bạn là Trợ lý AI cá nhân hóa của ${userProfile.name}, ghi nhớ mọi thông tin trong kho lưu trữ x:/tool/data/ai_memory/.`
        },
        { role: "user", content: userQuery },
        { role: "assistant", content: assistantReply }
      ]
    };
    permanentDataset.push(item);
    if (permanentDataset.length > 300) {
      permanentDataset.shift();
    }
    try {
      localStorage.setItem(AI_PERMANENT_DATASET_KEY, JSON.stringify(permanentDataset));
    } catch (e) {}
  }

  function getDefaultWelcomeMessage() {
    const cfg = getAiConfig();
    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.length > 10);

    if (hasKey) {
      return {
        id: 'welcome_' + Date.now(),
        role: 'assistant',
        text: 'Em chào anh Công, em là Kira! Hôm nay anh cần em hỗ trợ gì ạ? 😊',
        time: getCurrentTimeStr()
      };
    } else {
      return {
        id: 'welcome_' + Date.now(),
        role: 'assistant',
        text: 'Em chào anh Công, em là Kira! Hôm nay anh cần em hỗ trợ gì ạ? 😊\n\n*(Chưa cài Google Gemini API key — anh bấm biểu tượng **⚙️** ở menu trên để kết nối nhé!)*',
        card: {
          type: 'ACTIVATE_ONLINE'
        },
        time: getCurrentTimeStr()
      };
    }
  }

  function loadChatHistory() {
    try {
      const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
      if (raw) {
        chatHistory = JSON.parse(raw);
      }
    } catch (e) {}

    // Nếu chưa có lịch sử hoặc chỉ chứa câu chào cũ dài dòng, thay bằng câu chào mới ngắn gọn
    if (!Array.isArray(chatHistory) || !chatHistory.length) {
      chatHistory = [getDefaultWelcomeMessage()];
    } else if (
      chatHistory.length === 1 &&
      (String(chatHistory[0].id || '').startsWith('welcome_') || String(chatHistory[0].text || '').includes('Công AI') || String(chatHistory[0].text || '').includes('Tôi là'))
    ) {
      chatHistory = [getDefaultWelcomeMessage()];
    }
  }

  function saveChatHistory() {
    try {
      sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-30)));
    } catch (e) {}
  }

  function clearAiChat() {
    chatHistory = [getDefaultWelcomeMessage()];
    activeConfirmationData = {};
    saveChatHistory();
    renderChatThread();
    if (typeof window.showToast === 'function') {
      window.showToast('🧹 Đã làm mới hội thoại! (Kho ký ức dài hạn & dữ liệu train vẫn được giữ nguyên 100%)');
    }
  }

  function copyAiMessageText(msgId, btn) {
    const msg = chatHistory.find(m => m.id === msgId);
    if (!msg) return;
    const textToCopy = msg.text || '';
    if (!textToCopy) return;

    const onSuccess = () => {
      if (btn) {
        const origHtml = btn.innerHTML;
        btn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Đã chép</span>
        `;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.classList.remove('copied');
        }, 1800);
      }
      if (typeof window.showToast === 'function') {
        window.showToast('📋 Đã sao chép nội dung tin nhắn!');
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(onSuccess).catch(() => {
        fallbackCopyText(textToCopy, onSuccess);
      });
    } else {
      fallbackCopyText(textToCopy, onSuccess);
    }
  }

  function fallbackCopyText(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      if (cb) cb();
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function renderChatThread() {
    const thread = document.getElementById('aiChatThread');
    if (!thread) return;

    let html = '';
    chatHistory.forEach(msg => {
      const isUser = msg.role === 'user';
      const formattedText = formatChatMessageText(msg.text);

      if (isUser) {
        html += `
          <div class="ai-msg-row user" id="${msg.id}">
            <div class="ai-msg-bubble user">
              ${msg.image ? `<img src="${msg.image}" class="ai-msg-image-thumb" alt="Ảnh hóa đơn / bill" onclick="window.open('${msg.image}', '_blank')">` : ''}
              <div class="ai-msg-text-content">${formattedText}</div>
              <div class="ai-msg-footer" style="justify-content:flex-end;">
                <div class="ai-msg-time">${msg.time || ''}</div>
              </div>
            </div>
          </div>
        `;
      } else {
        let cardHtml = '';
        if (msg.card) {
          if (msg.card.type === 'ACTION_CONFIRM') {
            cardHtml = renderActionConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'APP_SELECTION_CONFIRM') {
            cardHtml = renderAppSelectionCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'RESET_CHIA_BILL_SUCCESS') {
            cardHtml = renderResetChiaBillSuccessCardHtml(msg.card.data);
          } else if (msg.card.type === 'DELETE_BILL_SUCCESS') {
            cardHtml = renderDeleteBillSuccessCardHtml(msg.card.data);
          } else if (msg.card.type === 'SETTLE_CHIA_BILL_SUCCESS') {
            cardHtml = renderSettleChiaBillSuccessCardHtml(msg.card.data);
          } else if (msg.card.type === 'MEAL_CONFIRM') {
            cardHtml = renderMealConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'BILL_CONFIRM') {
            cardHtml = renderBillConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'NOTE_CONFIRM') {
            cardHtml = renderNoteConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'CONTACT_CONFIRM') {
            cardHtml = renderContactConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'REMINDER') {
            cardHtml = renderReminderCardHtml(msg.card.data);
          } else if (msg.card.type === 'DEBTS') {
            cardHtml = renderDebtsCardHtml();
          } else if (msg.card.type === 'BIRTHDAYS') {
            cardHtml = renderBirthdaysCardHtml();
          } else if (msg.card.type === 'SUCCESS') {
            cardHtml = renderSuccessCardHtml(msg.card.data);
          } else if (msg.card.type === 'PERMISSION_DENIED' || msg.card.type === 'ERROR') {
            cardHtml = renderPermissionDeniedCardHtml(msg.card.data);
          } else if (msg.card.type === 'ACTIVATE_ONLINE') {
            cardHtml = renderActivateOnlineCardHtml();
          } else if (msg.card.type === 'MEMORY_SAVED') {
            cardHtml = renderMemorySavedCardHtml(msg.card.data);
          } else if (msg.card.type === 'RESET_SUCCESS') {
            cardHtml = renderResetSuccessCardHtml(msg.card.data);
          } else if (msg.card.type === 'SETTLE_SUCCESS') {
            cardHtml = renderSettleSuccessCardHtml(msg.card.data);
          }
        }

        html += `
          <div class="ai-msg-row assistant" id="${msg.id}">
            <div class="ai-avatar"><span style="font-size:12px;">✨</span></div>
            <div class="ai-msg-bubble assistant">
              <div class="ai-msg-text-content">${formattedText}</div>
              ${cardHtml}
              <div class="ai-msg-footer">
                <div class="ai-msg-time">${msg.time || ''}</div>
                <button type="button" class="ai-copy-msg-btn" onclick="copyAiMessageText('${msg.id}', this)" title="Sao chép toàn bộ nội dung tin nhắn">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Sao chép</span>
                </button>
              </div>
            </div>
          </div>
        `;
      }
    });

    if (isThinking) {
      html += `
        <div class="ai-thinking-row" id="aiThinkingIndicator">
          <div class="ai-avatar"><span style="font-size:12px;">✨</span></div>
          <div class="ai-thinking-bubble">
            <span class="ai-dot"></span>
            <span class="ai-dot"></span>
            <span class="ai-dot"></span>
          </div>
        </div>
      `;
    }

    thread.innerHTML = html;
    setTimeout(() => {
      thread.scrollTop = thread.scrollHeight;
    }, 40);
  }

  function formatChatMessageText(text) {
    if (!text) return '';
    let out = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    out = out.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    out = out.replace(/\*(.*?)\*/g, '<i>$1</i>');
    out = out.replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.15); padding:1px 5px; border-radius:4px; font-size:12px;">$1</code>');
    out = out.replace(/\n/g, '<br>');
    return out;
  }

  function renderActionConfirmationCardHtml(data, msgId) {
    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = data;
    }
    const isDanger = data.isDanger !== false;
    const detailsHtml = (data.details || []).map(d => `
      <div style="display:flex; align-items:flex-start; gap:6px; margin-bottom:3px;">
        <span style="color:#fbbf24;">•</span> <span>${escapeHtml(d)}</span>
      </div>
    `).join('');

    return `
      <div class="ai-action-confirm-card ${isDanger ? 'danger' : ''}" id="actionConfirmCard_${msgId}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span class="ai-confirm-badge-warn">
            <span>${isDanger ? '⚠️' : '🛡️'}</span> XÁC NHẬN CAN THIỆP HỆ THỐNG
          </span>
          <span style="font-size:10px; background:rgba(255,255,255,0.1); color:#cbd5e1; padding:2px 6px; border-radius:4px; font-weight:600;">Quyền Admin</span>
        </div>
        <div style="font-size:14px; font-weight:800; color:#f8fafc; margin-bottom:4px;">
          ${escapeHtml(data.title)}
        </div>
        <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">
          ${escapeHtml(data.description)}
        </div>
        ${data.details && data.details.length > 0 ? `
          <div class="ai-confirm-impact-list">
            <div style="font-weight:700; color:#94a3b8; font-size:11px; margin-bottom:4px; text-transform:uppercase;">Dữ liệu sẽ thay đổi:</div>
            ${detailsHtml}
          </div>
        ` : ''}
        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiCancelPendingAction('${msgId}')">
            ✕ Hủy bỏ
          </button>
          <button type="button" class="ai-btn-execute" ${isDanger ? 'style="background:linear-gradient(135deg, #ef4444, #b91c1c); box-shadow:0 4px 14px rgba(239,68,68,0.4);"' : ''} onclick="aiExecutePendingAction('${msgId}')">
            <span>✅ Xác Nhận Thực Thi</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderAppSelectionCardHtml(data, msgId) {
    return `
      <div class="ai-action-confirm-card" id="appSelectCard_${msgId}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span class="ai-confirm-badge-warn">
            <span>⚙️</span> LỰA CHỌN ỨNG DỤNG CAN THIỆP
          </span>
          <span style="font-size:10px; background:rgba(255,255,255,0.1); color:#cbd5e1; padding:2px 6px; border-radius:4px; font-weight:600;">Chế độ Admin</span>
        </div>
        <div style="font-size:13.5px; font-weight:800; color:#f8fafc; margin-bottom:6px;">
          Anh muốn khôi phục & reset dữ liệu của ứng dụng nào?
        </div>
        <div style="font-size:12px; color:#94a3b8; margin-bottom:12px;">
          Để bảo vệ dữ liệu, vui lòng chọn ứng dụng anh muốn làm sạch:
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="ai-btn-execute" style="width:100%; justify-content:center; background:linear-gradient(135deg, #4f46e5, #06b6d4); padding:8px 12px; font-size:12.5px;" onclick="aiTriggerResetApp('${msgId}', 'chia-bill')">
            <span>🍻 Reset App Chia Bill & Quỹ Nhóm</span>
          </button>
          <button type="button" class="ai-btn-execute" style="width:100%; justify-content:center; background:linear-gradient(135deg, #f59e0b, #d97706); padding:8px 12px; font-size:12.5px;" onclick="aiTriggerResetApp('${msgId}', 'tien-com')">
            <span>🥘 Reset App Tiền Cơm & Bữa Ăn</span>
          </button>
          <button type="button" class="ai-btn-execute" style="width:100%; justify-content:center; background:linear-gradient(135deg, #ef4444, #991b1b); padding:8px 12px; font-size:12.5px;" onclick="aiTriggerResetApp('${msgId}', 'both')">
            <span>🧹 Reset Cả Hai Ứng Dụng Về 0đ</span>
          </button>
          <button type="button" class="ai-btn-cancel" style="width:100%; text-align:center; padding:7px 12px;" onclick="aiCancelPendingAction('${msgId}')">
            ✕ Hủy bỏ (Không làm gì cả)
          </button>
        </div>
      </div>
    `;
  }

  function renderResetChiaBillSuccessCardHtml(data) {
    return `
      <div class="ai-action-card-success">
        <div class="ai-action-card-header">
          <div class="ai-action-card-title">
            <span>🔄</span> Đã Reset App Chia Bill & Quỹ Nhóm Thành Công!
          </div>
          <span style="font-size:10px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 8px; border-radius:10px; font-weight:700;">Đã Đồng Bộ Supabase</span>
        </div>
        <div class="ai-action-card-body">
          <div style="font-size:12px; color:#cbd5e1; line-height:1.5;">
            ✨ Toàn bộ hóa đơn chi tiêu và nhật ký quỹ đã được làm sạch về 0. Số dư của tất cả <b>${data.memberCount || 6} thành viên</b> đã được cân bằng về <b>0đ</b> để anh sẵn sàng nhập dữ liệu mới!
          </div>
        </div>
        <div class="ai-action-card-footer">
          <button type="button" class="ai-undo-btn" onclick="aiUndoLastResetChiaBill()" title="Khôi phục lại dữ liệu trước khi reset">
            ↩️ Hoàn tác (Undo)
          </button>
        </div>
      </div>
    `;
  }

  function renderDeleteBillSuccessCardHtml(data) {
    return `
      <div class="ai-action-card-success">
        <div class="ai-action-card-header">
          <div class="ai-action-card-title">
            <span>🗑️</span> Đã Xóa Hóa Đơn Chia Bill
          </div>
          <span style="font-size:10px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 8px; border-radius:10px; font-weight:700;">Đã Hoàn Tác Quỹ</span>
        </div>
        <div class="ai-action-card-body">
          <div>Đã xóa: <b>${escapeHtml(data.title || 'Hóa đơn')}</b> (${formatMoney(data.totalCost || 0)}).</div>
        </div>
      </div>
    `;
  }

  function renderSettleChiaBillSuccessCardHtml(data) {
    return `
      <div class="ai-action-card-success">
        <div class="ai-action-card-header">
          <div class="ai-action-card-title">
            <span>💳</span> Đã Cấn Trừ Quỹ Chia Bill
          </div>
          <span style="font-size:10px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 8px; border-radius:10px; font-weight:700;">Đã Cập Nhật</span>
        </div>
        <div class="ai-action-card-body">
          <div>Thành viên: <b>${escapeHtml(data.name)}</b> | Biến động: <b>${formatMoney(data.amount)}</b> | Số dư mới: <b>${formatMoney(data.newBalance)}</b></div>
        </div>
      </div>
    `;
  }

  function renderResetSuccessCardHtml(data) {
    const listHtml = (data.details || []).map(d => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px dashed rgba(255,255,255,0.08); font-size:12px;">
        <span>👤 <b>${escapeHtml(d.debtor)}</b> ➔ ${escapeHtml(d.creditor)}</span>
        <span style="color:#34d399; font-weight:700;">${formatMoney(d.amount)}</span>
      </div>
    `).join('');

    return `
      <div class="ai-action-card-success">
        <div class="ai-action-card-header">
          <div class="ai-action-card-title">
            <span>🔄</span> Đã Reset Toàn Bộ Công Nợ Về 0đ
          </div>
          <span style="font-size:10px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 8px; border-radius:10px; font-weight:700;">Đã Đồng Bộ Supabase</span>
        </div>
        <div class="ai-action-card-body">
          ${data.details && data.details.length > 0 ? `
            <div style="margin-bottom:8px; font-size:11.5px; color:#94a3b8;">
              Đã ghi nhận các giao dịch tất toán chu kỳ Tiền Cơm:
            </div>
            <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:6px 10px; margin-bottom:8px;">
              ${listHtml}
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; color:#f8fafc;">
              <span>Tổng tiền tất toán:</span>
              <span style="color:#38bdf8;">${formatMoney(data.totalAmount)}</span>
            </div>
          ` : `
            <div>${escapeHtml(data.message || 'Hệ thống đã ở trạng thái 0đ, không có nợ nào cần thanh toán.')}</div>
          `}
        </div>
        ${data.canUndo ? `
          <div class="ai-action-card-footer">
            <button type="button" class="ai-undo-btn" onclick="aiUndoLastResetDebts()" title="Khôi phục lại các khoản nợ ban đầu">
              ↩️ Hoàn tác (Undo)
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderSettleSuccessCardHtml(data) {
    return `
      <div class="ai-action-card-success">
        <div class="ai-action-card-header">
          <div class="ai-action-card-title">
            <span>✅</span> Đã Thanh Toán Nợ Thành Công
          </div>
          <span style="font-size:10px; background:rgba(16,185,129,0.2); color:#34d399; padding:2px 8px; border-radius:10px; font-weight:700;">Đã Cập Nhật</span>
        </div>
        <div class="ai-action-card-body">
          <div>👤 <b>${escapeHtml(data.payerName)}</b> ➔ ${escapeHtml(data.receiverName)}: <b style="color:#38bdf8;">${formatMoney(data.totalAmount)}</b></div>
        </div>
      </div>
    `;
  }

  function renderActivateOnlineCardHtml() {
    return `
      <div class="ai-online-activate-card">
        <div style="font-weight:700; color:#38bdf8; font-size:13.5px; margin-bottom:4px;">
          🚀 Kích Hoạt Google Gemini 1.5 Flash (Trực Tuyến)
        </div>
        <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:10px;">
          Google Gemini hiểu tiếng Việt xuất sắc, phân tích ngữ nghĩa sâu và dùng dữ liệu online. Hoàn toàn miễn phí trọn đời từ Google AI Studio!
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="ai-btn-execute" onclick="toggleAiSettingsDrawer()" style="padding:6px 14px; font-size:12px;">
            <span>⚙️</span> Nhập Gemini API Key Ngay
          </button>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" class="ai-link-btn" style="font-size:12px; padding:6px 4px;">
            <span>👉</span> Lấy Key miễn phí từ Google (30s)
          </a>
        </div>
      </div>
    `;
  }

  function renderMemorySavedCardHtml(data) {
    if (!data) return '';
    const catLabel = data.category === 'user_profile' ? '👤 Hồ Sơ Cá Nhân' : (data.category === 'workflow_rules' ? '⚙️ Quy Tắc Làm Việc' : '💡 Thói Quen & Sở Thích');
    return `
      <div style="margin-top:10px; padding:10px 12px; border-radius:10px; background:linear-gradient(135deg, rgba(99,102,241,0.18), rgba(168,85,247,0.12)); border:1px solid rgba(99,102,241,0.35); box-shadow:0 4px 12px rgba(0,0,0,0.15);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:700; color:#a5b4fc; display:flex; align-items:center; gap:5px;">
            <span>🧠</span> ĐÃ TỰ ĐỘNG GHI NHỚ VÀO BỘ NHỚ DÀI HẠN
          </span>
          <span style="font-size:10px; background:rgba(99,102,241,0.25); color:#c7d2fe; padding:2px 8px; border-radius:12px; font-weight:600;">
            ${catLabel}
          </span>
        </div>
        <div style="font-size:12.5px; color:#f1f5f9; line-height:1.45; font-style:italic; background:rgba(0,0,0,0.25); padding:6px 10px; border-radius:6px; border-left:3px solid #818cf8;">
          "${data.content}"
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:11px; color:#94a3b8;">
          <span>🔒 Đã lưu vào data/ai_memory/ (Bảo lưu khi Xóa Chat)</span>
          <button type="button" onclick="toggleAiMemoryDrawer()" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:#e2e8f0; border-radius:6px; padding:2px 8px; font-size:10.5px; cursor:pointer;">
            Xem tất cả ➔
          </button>
        </div>
      </div>
    `;
  }

  function renderMealConfirmationCardHtml(data, msgId) {
    const allMembers = getSystemMembers();
    const currentPayerName = data.payerName || 'Công';
    const amountPerPerson = data.amountPerPerson || 40000;
    const initialEaters = Array.isArray(data.eaters) && data.eaters.length > 0 ? data.eaters : allMembers.map(m => m.nickname || m.name);
    const dateStr = data.date || new Date().toISOString().split('T')[0];
    const dishName = data.dishName || 'Cơm trưa';

    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = {
        payerName: currentPayerName,
        amountPerPerson: amountPerPerson,
        dishName: dishName,
        eaters: [...initialEaters],
        date: dateStr,
        note: data.note || `${currentPayerName} thanh toán tiền cơm`
      };
    }
    const state = activeConfirmationData[msgId];
    const totalAmount = state.amountPerPerson * state.eaters.length;

    return `
      <div class="ai-confirm-card" id="mealConfirmCard_${msgId}">
        <div class="ai-confirm-header">
          <div class="ai-confirm-tag">🥘 TIỀN CƠM VĂN PHÒNG</div>
          <div class="ai-confirm-title">Phiếu Nhập Dữ Liệu Bữa Ăn</div>
          <div class="ai-confirm-sub">Kiểm tra thông tin trước khi ghi nhận vào sổ hoặc điền trực tiếp vào form app:</div>
        </div>

        <div class="ai-form-grid">
          <div class="ai-form-group">
            <label class="ai-form-label">👤 Người chi trả:</label>
            <select class="ai-form-select" id="aiPayerSelect_${msgId}" onchange="aiUpdatePayer('${msgId}', this.value)">
              ${allMembers.map(m => {
                const name = m.nickname || m.name;
                const isSelected = name.toLowerCase() === state.payerName.toLowerCase() || (m.fullName && m.fullName.toLowerCase().includes(state.payerName.toLowerCase()));
                return `<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)} ${m.fullName ? `(${escapeHtml(m.fullName)})` : ''}</option>`;
              }).join('')}
            </select>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">🍲 Tên món ăn:</label>
            <input type="text" class="ai-form-input" id="aiDishName_${msgId}" value="${escapeHtml(state.dishName || 'Cơm trưa')}" oninput="aiUpdateDishName('${msgId}', this.value)" placeholder="VD: Cơm sườn, Phở bò...">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">💰 Giá mỗi người:</label>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" class="ai-form-input" id="aiAmountInput_${msgId}" value="${state.amountPerPerson}" step="5000" oninput="aiUpdateAmount('${msgId}', this.value)">
              <span style="font-size:11.5px; color:#94a3b8; font-weight:600;">VNĐ</span>
            </div>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">📅 Ngày diễn ra:</label>
            <input type="date" class="ai-form-input" id="aiDateInput_${msgId}" value="${state.date}" onchange="aiUpdateDate('${msgId}', this.value)">
          </div>

          <div class="ai-form-group" style="grid-column: 1 / -1;">
            <label class="ai-form-label">💵 Tổng cộng:</label>
            <div class="ai-total-highlight" id="aiTotalDisplay_${msgId}">${formatMoney(totalAmount)}</div>
          </div>
        </div>

        <div style="margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <label class="ai-form-label" style="margin:0;">👥 Thành viên ăn (<span id="aiEatersCount_${msgId}">${state.eaters.length}</span> người):</label>
            <button type="button" class="ai-mini-btn" onclick="aiToggleAllEaters('${msgId}')">Chọn tất cả</button>
          </div>
          <div class="ai-chips-list" id="aiEatersChips_${msgId}">
            ${allMembers.map(m => {
              const name = m.nickname || m.name;
              const isChecked = state.eaters.some(e => e.toLowerCase() === name.toLowerCase());
              return `
                <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleEater('${msgId}', '${escapeHtml(name)}')">
                  <span class="chip-check">${isChecked ? '✓' : '+'}</span>
                  <span>${escapeHtml(name)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-top:8px;">
          <label class="ai-form-label">📝 Ghi chú bữa ăn:</label>
          <input type="text" class="ai-form-input" id="aiNoteInput_${msgId}" value="${escapeHtml(state.note)}" oninput="aiUpdateNote('${msgId}', this.value)">
        </div>

        ${!isAdminMode() ? `
        <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 10px; margin-top:8px; font-size:11.5px; color:#fca5a5; display:flex; align-items:center; gap:6px;">
          <span>🔒</span><span><b>Chế độ xem (Chỉ đọc):</b> Bạn cần quyền Admin để lưu trực tiếp bữa cơm này. Hoặc bạn có thể bấm [Điền vào Form App] bên dưới để xem trên modal của App.</span>
        </div>` : ''}

        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard('${msgId}')">✕ Bỏ qua</button>
          <button type="button" class="ai-btn-open-form" onclick="aiFillMealFormApp('${msgId}')" title="Mở modal ứng dụng Tính Tiền Cơm và tự động điền sẵn các trường">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Điền vào Form App
          </button>
          <button type="button" class="ai-btn-execute" ${!isAdminMode() ? 'style="background:linear-gradient(135deg, #d97706, #b45309); border-color:#f59e0b;"' : ''} onclick="aiExecuteAddMeal('${msgId}')">
            <span>${isAdminMode() ? '✅ Xác nhận & Lưu ngay' : '🔒 Đăng nhập Admin để lưu'}</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderBillConfirmationCardHtml(data, msgId) {
    const allMembers = getSystemMembers();
    const currentPayerName = data.payerName || 'Công';
    const totalAmount = data.totalAmount || 600000;
    const initialParticipants = Array.isArray(data.participants) && data.participants.length > 0
      ? data.participants
      : allMembers.map(m => m.nickname || m.name);
    const dateStr = data.date || new Date().toISOString().split('T')[0];
    const billTitle = data.title || 'Khoản chi chia tiền';
    const expenseItems = Array.isArray(data.expenseItems) ? data.expenseItems : [{ title: billTitle, amount: totalAmount }];

    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = {
        type: 'bill',
        title: billTitle,
        payerName: currentPayerName,
        totalAmount: totalAmount,
        expenseItems: expenseItems,
        participants: [...initialParticipants],
        date: dateStr,
        note: data.note || `Chia bill: ${billTitle}`
      };
    }
    const state = activeConfirmationData[msgId];
    const participantCount = Math.max(1, state.participants.length);
    const costPerPerson = Math.round(state.totalAmount / participantCount);

    return `
      <div class="ai-confirm-card" id="billConfirmCard_${msgId}">
        <div class="ai-confirm-header">
          <div class="ai-confirm-tag" style="color:#38bdf8;">🍻 CHIA BILL & QUỸ NHÓM</div>
          <div class="ai-confirm-title">Phiếu Nhập Hóa Đơn Chia Tiền</div>
          <div class="ai-confirm-sub">Kiểm tra thông tin chi phí trước khi ghi nhận vào sổ quỹ hoặc điền vào form:</div>
        </div>

        <div class="ai-form-grid">
          <div class="ai-form-group">
            <label class="ai-form-label">🏷️ Tên khoản chi (Bill):</label>
            <input type="text" class="ai-form-input" id="aiBillTitle_${msgId}" value="${escapeHtml(state.title)}" oninput="aiUpdateBillTitle('${msgId}', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">👤 Người trả tiền trước:</label>
            <select class="ai-form-select" id="aiBillPayerSelect_${msgId}" onchange="aiUpdateBillPayer('${msgId}', this.value)">
              ${allMembers.map(m => {
                const name = m.nickname || m.name;
                const isSelected = name.toLowerCase() === state.payerName.toLowerCase() || (m.fullName && m.fullName.toLowerCase().includes(state.payerName.toLowerCase()));
                return `<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)} ${m.fullName ? `(${escapeHtml(m.fullName)})` : ''}</option>`;
              }).join('')}
            </select>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">💰 Tổng số tiền bill:</label>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" class="ai-form-input" id="aiBillTotal_${msgId}" value="${state.totalAmount}" step="10000" oninput="aiUpdateBillTotal('${msgId}', this.value)">
              <span style="font-size:11.5px; color:#94a3b8; font-weight:600;">VNĐ</span>
            </div>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">📅 Ngày chi tiêu:</label>
            <input type="date" class="ai-form-input" id="aiBillDate_${msgId}" value="${state.date}" onchange="aiUpdateBillDate('${msgId}', this.value)">
          </div>
        </div>

        <div style="margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <label class="ai-form-label" style="margin:0;">👥 Người tham gia chia (<span id="aiBillPartCount_${msgId}">${state.participants.length}</span> người):</label>
            <button type="button" class="ai-mini-btn" onclick="aiToggleAllBillParticipants('${msgId}')">Chọn tất cả</button>
          </div>
          <div class="ai-chips-list" id="aiBillPartChips_${msgId}">
            ${allMembers.map(m => {
              const name = m.nickname || m.name;
              const isChecked = state.participants.some(e => e.toLowerCase() === name.toLowerCase());
              return `
                <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleBillParticipant('${msgId}', '${escapeHtml(name)}')">
                  <span class="chip-check">${isChecked ? '✓' : '+'}</span>
                  <span>${escapeHtml(name)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:8px 12px; border-radius:8px;">
          <span style="font-size:12px; color:#cbd5e1;">Mỗi người chia đều:</span>
          <span class="ai-total-highlight" id="aiBillPerPerson_${msgId}" style="font-size:14px; padding:0;">${formatMoney(costPerPerson)}/người</span>
        </div>

        ${!isAdminMode() ? `
        <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 10px; margin-top:8px; font-size:11.5px; color:#fca5a5; display:flex; align-items:center; gap:6px;">
          <span>🔒</span><span><b>Chế độ xem (Chỉ đọc):</b> Bạn cần quyền Admin để lưu hóa đơn chia bill này. Hoặc bấm [Điền vào Form App] bên dưới để mở form.</span>
        </div>` : ''}

        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard('${msgId}')">✕ Bỏ qua</button>
          <button type="button" class="ai-btn-open-form" onclick="aiFillBillFormApp('${msgId}')" title="Mở modal ứng dụng Chia Bill và tự động điền sẵn các trường">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Điền vào Form App
          </button>
          <button type="button" class="ai-btn-execute" ${!isAdminMode() ? 'style="background:linear-gradient(135deg, #d97706, #b45309); border-color:#f59e0b;"' : ''} onclick="aiExecuteAddBill('${msgId}')">
            <span>${isAdminMode() ? '✅ Xác nhận & Lưu ngay' : '🔒 Đăng nhập Admin để lưu'}</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderNoteConfirmationCardHtml(data, msgId) {
    const text = data.text || data.title || data.task || '';
    const details = data.details || data.content || '';
    const now = new Date();
    const defaultDeadline = data.deadline || new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 16);
    const type = data.noteType || data.type || 'todo';
    const priority = data.priority || 'medium';
    const repeat = data.repeat || 'none';
    const sound = data.sound || 'default';
    const tags = Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || '');

    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = {
        type: 'note',
        text: text,
        details: details,
        deadline: defaultDeadline,
        noteType: type,
        priority: priority,
        repeat: repeat,
        sound: sound,
        tags: tags
      };
    }
    const state = activeConfirmationData[msgId];

    return `
      <div class="ai-confirm-card" id="noteConfirmCard_${msgId}">
        <div class="ai-confirm-header">
          <div class="ai-confirm-tag" style="color:#a855f7;">🔔 NHẮC VIỆC, GHI CHÚ & ĐẾM NGƯỢC</div>
          <div class="ai-confirm-title">Phiếu Tạo Nhắc Việc & Ghi Chú</div>
          <div class="ai-confirm-sub">Kiểm tra thông tin chi tiết trước khi lưu vào Lịch công việc:</div>
        </div>

        <div class="ai-form-group" style="margin-bottom:8px;">
          <label class="ai-form-label">📌 Tiêu đề việc / sự kiện:</label>
          <input type="text" class="ai-form-input" id="aiNoteText_${msgId}" value="${escapeHtml(state.text)}" oninput="aiUpdateNoteText('${msgId}', this.value)">
        </div>

        <div class="ai-form-group" style="margin-bottom:8px;">
          <label class="ai-form-label">📝 Chi tiết bổ sung (tùy chọn):</label>
          <textarea class="ai-form-input" id="aiNoteDetails_${msgId}" rows="2" oninput="aiUpdateNoteDetails('${msgId}', this.value)" placeholder="Nội dung, địa điểm, link tài liệu...">${escapeHtml(state.details || '')}</textarea>
        </div>

        <div class="ai-form-grid">
          <div class="ai-form-group">
            <label class="ai-form-label">⏰ Thời hạn (Deadline):</label>
            <input type="datetime-local" class="ai-form-input" id="aiNoteDeadline_${msgId}" value="${state.deadline}" onchange="aiUpdateNoteDeadline('${msgId}', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">📂 Phân loại:</label>
            <select class="ai-form-select" id="aiNoteType_${msgId}" onchange="aiUpdateNoteType('${msgId}', this.value)">
              <option value="todo" ${state.noteType === 'todo' ? 'selected' : ''}>Việc Cần Làm</option>
              <option value="reminder" ${state.noteType === 'reminder' ? 'selected' : ''}>Hẹn Giờ Nhắc Nhở</option>
              <option value="countdown" ${state.noteType === 'countdown' ? 'selected' : ''}>Đếm Ngược Sự Kiện</option>
              <option value="note" ${state.noteType === 'note' ? 'selected' : ''}>Ghi Chú Tự Do</option>
            </select>
          </div>
        </div>

        <div class="ai-form-grid" style="margin-top:6px;">
          <div class="ai-form-group">
            <label class="ai-form-label">🔥 Mức độ ưu tiên:</label>
            <select class="ai-form-select" id="aiNotePriority_${msgId}" onchange="aiUpdateNotePriority('${msgId}', this.value)">
              <option value="high" ${state.priority === 'high' ? 'selected' : ''}>Ưu tiên Cao (Khẩn cấp) 🔥</option>
              <option value="medium" ${state.priority === 'medium' ? 'selected' : ''}>Ưu tiên Trung bình ⭐</option>
              <option value="low" ${state.priority === 'low' ? 'selected' : ''}>Ưu tiên Thấp 🌱</option>
            </select>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">🔄 Lặp lại chu kỳ:</label>
            <select class="ai-form-select" id="aiNoteRepeat_${msgId}" onchange="aiUpdateNoteRepeat('${msgId}', this.value)">
              <option value="none" ${state.repeat === 'none' ? 'selected' : ''}>Không lặp lại</option>
              <option value="daily" ${state.repeat === 'daily' ? 'selected' : ''}>Hàng ngày 🔄</option>
              <option value="workdays" ${state.repeat === 'workdays' ? 'selected' : ''}>Ngày làm việc (T2 - T6) 🏢</option>
              <option value="weekly" ${state.repeat === 'weekly' ? 'selected' : ''}>Hàng tuần 📅</option>
              <option value="monthly" ${state.repeat === 'monthly' ? 'selected' : ''}>Hàng tháng 🗓️</option>
            </select>
          </div>
        </div>

        <div class="ai-form-group" style="margin-top:6px;">
          <label class="ai-form-label">🎵 Chuông báo khi tới hạn:</label>
          <div style="display:flex; gap:6px;">
            <select class="ai-form-select" id="aiNoteSound_${msgId}" onchange="aiUpdateNoteSound('${msgId}', this.value)" style="flex:1;">
              <option value="default" ${state.sound === 'default' ? 'selected' : ''}>🎵 Chuông: Tự động theo loại</option>
              <option value="macos_chime" ${state.sound === 'macos_chime' ? 'selected' : ''}>🔔 macOS Chime (Cổ điển)</option>
              <option value="radar_alarm" ${state.sound === 'radar_alarm' ? 'selected' : ''}>⏰ Radar Alarm (Báo thức)</option>
              <option value="crystal_bell" ${state.sound === 'crystal_bell' ? 'selected' : ''}>✨ Chuông Pha Lê (Huyền ảo)</option>
              <option value="digital_beep" ${state.sound === 'digital_beep' ? 'selected' : ''}>📟 Đồng Hồ Điện Tử (Casio)</option>
              <option value="zen_bowl" ${state.sound === 'zen_bowl' ? 'selected' : ''}>🧘 Chuông Thiền Zen (432Hz)</option>
              <option value="fanfare" ${state.sound === 'fanfare' ? 'selected' : ''}>🎺 Khải Hoàn (Tưng bừng)</option>
              <option value="cyber_synth" ${state.sound === 'cyber_synth' ? 'selected' : ''}>⚡ Cyberpunk Synth Alert</option>
              <option value="marimba" ${state.sound === 'marimba' ? 'selected' : ''}>🌊 Marimba (Gõ phím Apple)</option>
              <option value="urgent_siren" ${state.sound === 'urgent_siren' ? 'selected' : ''}>🚨 Còi Báo Động Khẩn Cấp</option>
              <option value="water_drop" ${state.sound === 'water_drop' ? 'selected' : ''}>💧 Giọt Nước Tinh Khiết</option>
            </select>
            <button type="button" class="btn-sound-preview-mini" style="padding:6px 12px; font-size:12px;" onclick="if(window.SoundEngine) window.SoundEngine.preview(document.getElementById('aiNoteSound_${msgId}').value)" title="Nghe thử chuông này">
              <i class="fa-solid fa-play"></i> Nghe thử
            </button>
          </div>
        </div>

        <div class="ai-form-group" style="margin-top:6px;">
          <label class="ai-form-label">🏷️ Thẻ Tags (cách nhau dấu phẩy):</label>
          <input type="text" class="ai-form-input" id="aiNoteTags_${msgId}" value="${escapeHtml(state.tags || '')}" oninput="aiUpdateNoteTags('${msgId}', this.value)" placeholder="work, report, finance...">
        </div>

        ${!isAdminMode() ? `
        <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 10px; margin-top:8px; font-size:11.5px; color:#fca5a5; display:flex; align-items:center; gap:6px;">
          <span>🔒</span><span><b>Chế độ xem (Chỉ đọc):</b> Bạn cần quyền Admin để lưu. Hoặc bấm [Điền vào Form App] bên dưới để mở giao diện Reminders.</span>
        </div>` : ''}

        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard('${msgId}')">✕ Bỏ qua</button>
          <button type="button" class="ai-btn-open-form" onclick="aiFillNoteFormApp('${msgId}')" title="Mở ứng dụng Nhắc Việc & Ghi Chú và tự động điền sẵn">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Điền vào Form App
          </button>
          <button type="button" class="ai-btn-execute" ${!isAdminMode() ? 'style="background:linear-gradient(135deg, #d97706, #b45309); border-color:#f59e0b;"' : ''} onclick="aiExecuteAddNote('${msgId}')">
            <span>${isAdminMode() ? '✅ Xác nhận & Lưu ngay' : '🔒 Đăng nhập Admin để lưu'}</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderContactConfirmationCardHtml(data, msgId) {
    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = {
        type: 'contact',
        fullName: data.fullName || '',
        nickname: data.nickname || data.fullName || '',
        phone: data.phone || '',
        dob: data.dob || '',
        role: data.role || data.note || 'Thành viên',
        bankId: data.bankId || 'MB',
        accountNo: data.accountNo || '',
        accountName: data.accountName || (data.fullName ? data.fullName.toUpperCase() : '')
      };
    }
    const state = activeConfirmationData[msgId];

    return `
      <div class="ai-confirm-card" id="contactConfirmCard_${msgId}">
        <div class="ai-confirm-header">
          <div class="ai-confirm-tag" style="color:#10b981;">👥 DANH BẠ THÀNH VIÊN</div>
          <div class="ai-confirm-title">Phiếu Thêm Thành Viên / Đồng Nghiệp</div>
          <div class="ai-confirm-sub">Kiểm tra thông tin trước khi lưu vào Danh Bạ Hệ Thống hoặc mở form:</div>
        </div>

        <div class="ai-form-grid">
          <div class="ai-form-group">
            <label class="ai-form-label">👤 Họ và tên đầy đủ:</label>
            <input type="text" class="ai-form-input" id="aiContactFullName_${msgId}" value="${escapeHtml(state.fullName)}" oninput="aiUpdateContactField('${msgId}', 'fullName', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">🏷️ Biệt danh (Nickname):</label>
            <input type="text" class="ai-form-input" id="aiContactNickname_${msgId}" value="${escapeHtml(state.nickname)}" oninput="aiUpdateContactField('${msgId}', 'nickname', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">📞 Số điện thoại:</label>
            <input type="tel" class="ai-form-input" id="aiContactPhone_${msgId}" value="${escapeHtml(state.phone)}" oninput="aiUpdateContactField('${msgId}', 'phone', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">🎂 Ngày sinh:</label>
            <input type="date" class="ai-form-input" id="aiContactDob_${msgId}" value="${escapeHtml(state.dob)}" onchange="aiUpdateContactField('${msgId}', 'dob', this.value)">
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">🏦 Ngân hàng:</label>
            <select class="ai-form-select" id="aiContactBankId_${msgId}" onchange="aiUpdateContactField('${msgId}', 'bankId', this.value)">
              <option value="MB" ${state.bankId === 'MB' ? 'selected' : ''}>MBBank</option>
              <option value="VCB" ${state.bankId === 'VCB' ? 'selected' : ''}>Vietcombank</option>
              <option value="TCB" ${state.bankId === 'TCB' ? 'selected' : ''}>Techcombank</option>
              <option value="VPB" ${state.bankId === 'VPB' ? 'selected' : ''}>VPBank</option>
              <option value="ACB" ${state.bankId === 'ACB' ? 'selected' : ''}>ACB</option>
              <option value="BIDV" ${state.bankId === 'BIDV' ? 'selected' : ''}>BIDV</option>
              <option value="ICB" ${state.bankId === 'ICB' ? 'selected' : ''}>VietinBank</option>
              <option value="TPB" ${state.bankId === 'TPB' ? 'selected' : ''}>TPBank</option>
              <option value="VIB" ${state.bankId === 'VIB' ? 'selected' : ''}>VIB</option>
              <option value="STB" ${state.bankId === 'STB' ? 'selected' : ''}>Sacombank</option>
            </select>
          </div>

          <div class="ai-form-group">
            <label class="ai-form-label">💳 Số tài khoản (STK):</label>
            <input type="text" class="ai-form-input" id="aiContactAccountNo_${msgId}" value="${escapeHtml(state.accountNo)}" oninput="aiUpdateContactField('${msgId}', 'accountNo', this.value)">
          </div>

          <div class="ai-form-group" style="grid-column: 1 / -1;">
            <label class="ai-form-label">🔤 Tên chủ tài khoản (In hoa không dấu):</label>
            <input type="text" class="ai-form-input" id="aiContactAccountName_${msgId}" value="${escapeHtml(state.accountName)}" oninput="aiUpdateContactField('${msgId}', 'accountName', this.value.toUpperCase())" placeholder="VD: NGUYEN VAN A">
          </div>
        </div>

        <div class="ai-form-group" style="margin-top:8px;">
          <label class="ai-form-label">📝 Chức vụ / Ghi chú:</label>
          <input type="text" class="ai-form-input" id="aiContactRole_${msgId}" value="${escapeHtml(state.role)}" oninput="aiUpdateContactField('${msgId}', 'role', this.value)">
        </div>

        ${!isAdminMode() ? `
        <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 10px; margin-top:8px; font-size:11.5px; color:#fca5a5; display:flex; align-items:center; gap:6px;">
          <span>🔒</span><span><b>Chế độ xem (Chỉ đọc):</b> Bạn cần quyền Admin để lưu liên hệ này vào danh bạ. Hoặc bấm [Điền vào Form App] bên dưới để mở modal Danh Bạ.</span>
        </div>` : ''}

        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard('${msgId}')">✕ Bỏ qua</button>
          <button type="button" class="ai-btn-open-form" onclick="aiFillContactFormApp('${msgId}')" title="Mở modal Thêm Thành Viên trong Danh Bạ và tự động điền sẵn">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Điền vào Form App
          </button>
          <button type="button" class="ai-btn-execute" ${!isAdminMode() ? 'style="background:linear-gradient(135deg, #d97706, #b45309); border-color:#f59e0b;"' : ''} onclick="aiExecuteAddContact('${msgId}')">
            <span>${isAdminMode() ? '✅ Xác nhận & Lưu ngay' : '🔒 Đăng nhập Admin để lưu'}</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderReminderCardHtml(data) {
    return `
      <div class="ai-reminder-card">
        <div class="ai-reminder-tag">
          <span>⏰</span>
          <span>NHẮC NHỞ ĐÃ ĐẶT THÀNH CÔNG</span>
        </div>
        <div class="ai-reminder-title">📌 ${escapeHtml(data.task || 'Công việc cần làm')}</div>
        <div class="ai-reminder-time">📅 Thời gian nhắc: <b>${escapeHtml(data.displayFormatted || data.timeStr || '')}</b></div>
        <div class="ai-reminder-actions">
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('ghi-chu')">🔔 Mở App Nhắc Việc & Ghi Chú</button>
        </div>
      </div>
    `;
  }

  function renderDebtsCardHtml() {
    let members = getSystemMembers();
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch (e) {}

    let spent = {};
    let consumed = {};
    members.forEach(m => { spent[m.id] = 0; consumed[m.id] = 0; });

    logs.forEach(l => {
      if (l.type === 'Bữa Ăn' && l.items) {
        if (spent[l.payerId] !== undefined) spent[l.payerId] += (l.amount || 0);
        l.items.forEach(it => {
          if (consumed[it.colleagueId] !== undefined) consumed[it.colleagueId] += (it.amount || 0);
        });
      }
    });

    const netList = members.map(m => {
      const net = (spent[m.id] || 0) - (consumed[m.id] || 0);
      return { member: m, net };
    }).sort((a, b) => a.net - b.net);

    return `
      <div class="ai-debts-card">
        <div style="font-weight:700; color:#38bdf8; font-size:13px; margin-bottom:6px;">📊 Bảng Đối Soát Số Dư Tiền Cơm</div>
        <div style="display:flex; flex-direction:column; gap:5px; max-height:160px; overflow-y:auto;">
          ${netList.map(x => {
            const isNegative = x.net < 0;
            const isPositive = x.net > 0;
            const color = isNegative ? '#f87171' : (isPositive ? '#34d399' : '#94a3b8');
            const statusText = isNegative ? `Đang nợ: ${formatMoney(Math.abs(x.net))}` : (isPositive ? `Được nhận: +${formatMoney(x.net)}` : 'Đã cân bằng');
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:5px 8px; border-radius:6px; font-size:12px;">
                <span style="font-weight:600; color:#f8fafc;">${escapeHtml(x.member.nickname || x.member.name)}</span>
                <span style="font-weight:700; color:${color};">${statusText}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div style="margin-top:8px; display:flex; justify-content:flex-end;">
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('tien-com')">📱 Xem Bảng Tiền Cơm</button>
        </div>
      </div>
    `;
  }

  function renderBirthdaysCardHtml() {
    const members = getSystemMembers();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;

    const thisMonthBirthdays = [];
    members.forEach(m => {
      if (!m.dob) return;
      const parts = m.dob.split('-');
      if (parts.length >= 2) {
        const mMonth = parseInt(parts[1], 10);
        const mDay = parseInt(parts[2], 10);
        if (mMonth === currentMonth) {
          thisMonthBirthdays.push({ member: m, day: mDay });
        }
      }
    });

    thisMonthBirthdays.sort((a, b) => a.day - b.day);

    return `
      <div class="ai-birthdays-card">
        <div style="font-weight:700; color:#fbbf24; font-size:13px; margin-bottom:6px;">🎂 Sinh Nhật Thành Viên Tháng ${currentMonth}</div>
        ${thisMonthBirthdays.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:5px;">
            ${thisMonthBirthdays.map(x => `
              <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:5px 8px; border-radius:6px; font-size:12px;">
                <span style="font-weight:600; color:#f8fafc;">${escapeHtml(x.member.nickname || x.member.name)}</span>
                <span style="color:#fbbf24; font-weight:700;">Ngày ${x.day}/${currentMonth}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="color:#94a3b8; font-size:12px; text-align:center; padding:8px;">Tháng này không có sinh nhật nào trong danh sách.</div>
        `}
        <div style="margin-top:8px; display:flex; justify-content:flex-end;">
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('danh-ba')">👥 Mở Danh Bạ</button>
        </div>
      </div>
    `;
  }

  function renderSuccessCardHtml(data) {
    if (data.type === 'bill') {
      return `
        <div class="ai-success-card">
          <div style="font-size:22px; margin-bottom:4px;">🍻</div>
          <div style="font-size:14px; font-weight:800; color:#38bdf8; margin-bottom:2px;">ĐÃ NHẬP CHIA BILL THÀNH CÔNG!</div>
          <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">
            Hóa đơn: <b>${escapeHtml(data.title)}</b> (<b>${formatMoney(data.totalAmount)}</b>).<br>
            Người trả: <b style="color:#fbbf24;">${escapeHtml(data.payerName)}</b> • Cho <b>${data.participantsCount} người</b> (${formatMoney(data.costPerPerson)}/người).
          </div>
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('chia-bill')">🍻 Mở Bảng Chia Bill</button>
        </div>
      `;
    }

    if (data.type === 'note') {
      return `
        <div class="ai-success-card">
          <div style="font-size:22px; margin-bottom:4px;">📝</div>
          <div style="font-size:14px; font-weight:800; color:#c084fc; margin-bottom:2px;">ĐÃ LƯU GHI CHÚ THÀNH CÔNG!</div>
          <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">
            Công việc: <b>${escapeHtml(data.text)}</b>.<br>
            Hạn định: <b style="color:#fbbf24;">${escapeHtml(data.deadlineStr || 'Không có')}</b>.
          </div>
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('ghi-chu')">📝 Xem Sticky Notes</button>
        </div>
      `;
    }

    if (data.type === 'contact') {
      return `
        <div class="ai-success-card">
          <div style="font-size:22px; margin-bottom:4px;">👥</div>
          <div style="font-size:14px; font-weight:800; color:#34d399; margin-bottom:2px;">ĐÃ LƯU VÀO DANH BẠ THÀNH CÔNG!</div>
          <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">
            Thành viên: <b>${escapeHtml(data.fullName)}</b> (${escapeHtml(data.nickname || '')}).<br>
            ${data.phone ? 'SĐT: <b style="color:#38bdf8;">' + escapeHtml(data.phone) + '</b>' : ''}
            ${data.bankId ? ' • ' + escapeHtml(data.bankId) + ': <b>' + escapeHtml(data.accountNo) + '</b>' : ''}
          </div>
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('danh-ba')">👥 Mở Danh Bạ</button>
        </div>
      `;
    }

    return `
      <div class="ai-success-card">
        <div style="font-size:22px; margin-bottom:4px;">🎉</div>
        <div style="font-size:14px; font-weight:800; color:#34d399; margin-bottom:2px;">ĐÃ NHẬP DỮ LIỆU THÀNH CÔNG!</div>
        <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:8px;">
          Đã ghi nhận bữa cơm <b>${formatMoney(data.totalAmount)}</b> ngày <b>${data.date}</b>.<br>
          Người trả: <b style="color:#fbbf24;">${escapeHtml(data.payerName)}</b> • Cho <b>${data.eatersCount} người</b>.
        </div>
        <button type="button" class="ai-mini-btn-action" onclick="openAppById('tien-com')">📱 Xem Bảng Tiền Cơm</button>
      </div>
    `;
  }

  function renderPermissionDeniedCardHtml(data) {
    const d = data || {};
    const title = d.title || 'Thao tác bị từ chối';
    const message = d.message || 'Bạn đang ở Chế độ xem (Chỉ đọc). Hệ thống không cho phép sửa đổi dữ liệu khi chưa đăng nhập Quản trị viên.';

    return `
      <div class="ai-denied-card">
        <div style="font-size:24px; margin-bottom:4px;">🔒</div>
        <div style="font-size:13.5px; font-weight:800; color:#f87171; margin-bottom:4px;">${escapeHtml(title)}</div>
        <div style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-bottom:10px;">
          ${escapeHtml(message)}
        </div>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button type="button" class="ai-mini-btn-action" style="background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; border:none; box-shadow:0 2px 8px rgba(245,158,11,0.35); padding:6px 14px; font-weight:700;" onclick="if(window.dashboard && window.dashboard.openAdminAuthModal) window.dashboard.openAdminAuthModal();">
            🔑 Đăng nhập Quản trị viên (Admin)
          </button>
        </div>
      </div>
    `;
  }

  // Tương tác Card trên window
  window.aiUpdatePayer = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].payerName = val;
  };

  window.aiUpdateDishName = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].dishName = val;
  };

  window.aiUpdateAmount = function (msgId, val) {
    if (!activeConfirmationData[msgId]) return;
    const num = parseFloat(val) || 0;
    activeConfirmationData[msgId].amountPerPerson = num;
    updateCardTotalDisplay(msgId);
  };

  window.aiUpdateDate = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].date = val;
  };

  window.aiUpdateNote = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].note = val;
  };

  window.aiToggleEater = function (msgId, name) {
    const state = activeConfirmationData[msgId];
    if (!state) return;
    const idx = state.eaters.findIndex(e => e.toLowerCase() === name.toLowerCase());
    if (idx !== -1) {
      if (state.eaters.length <= 1) {
        alert('Phải có ít nhất 1 người tham gia ăn bữa cơm!');
        return;
      }
      state.eaters.splice(idx, 1);
    } else {
      state.eaters.push(name);
    }
    updateCardChipsUI(msgId);
    updateCardTotalDisplay(msgId);
  };

  window.aiToggleAllEaters = function (msgId) {
    const state = activeConfirmationData[msgId];
    if (!state) return;
    const all = getSystemMembers().map(m => m.nickname || m.name);
    if (state.eaters.length === all.length) {
      state.eaters = [state.payerName || all[0]];
    } else {
      state.eaters = [...all];
    }
    updateCardChipsUI(msgId);
    updateCardTotalDisplay(msgId);
  };

  function updateCardChipsUI(msgId) {
    const state = activeConfirmationData[msgId];
    const container = document.getElementById(`aiEatersChips_${msgId}`);
    const countEl = document.getElementById(`aiEatersCount_${msgId}`);
    if (!container || !state) return;

    if (countEl) countEl.innerText = state.eaters.length;
    const allMembers = getSystemMembers();
    container.innerHTML = allMembers.map(m => {
      const name = m.nickname || m.name;
      const isChecked = state.eaters.some(e => e.toLowerCase() === name.toLowerCase());
      return `
        <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleEater('${msgId}', '${escapeHtml(name)}')">
          <span class="chip-check">${isChecked ? '✓' : '+'}</span>
          <span>${escapeHtml(name)}</span>
        </button>
      `;
    }).join('');
  }

  function updateCardTotalDisplay(msgId) {
    const state = activeConfirmationData[msgId];
    const totalEl = document.getElementById(`aiTotalDisplay_${msgId}`);
    if (totalEl && state) {
      const total = state.amountPerPerson * state.eaters.length;
      totalEl.innerText = formatMoney(total);
    }
  }

  window.aiDismissConfirmCard = function (msgId) {
    delete activeConfirmationData[msgId];
    const cardEl = document.getElementById(`mealConfirmCard_${msgId}`) ||
                   document.getElementById(`billConfirmCard_${msgId}`) ||
                   document.getElementById(`noteConfirmCard_${msgId}`) ||
                   document.getElementById(`contactConfirmCard_${msgId}`);
    if (cardEl) {
      cardEl.innerHTML = `
        <div style="text-align:center; color:#94a3b8; font-size:12.5px; padding:10px;">
          ❌ Đã hủy phiếu nhập này.
        </div>
      `;
    }
  };

  window.aiExecuteAddMeal = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Không thể lưu: Bạn đang ở Chế độ xem (Chỉ đọc)!', 'warning');
      }
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'PERMISSION_DENIED',
          data: {
            title: 'Từ chối ghi Tiền Cơm',
            message: 'Bữa cơm chưa được ghi nhận vào hệ thống vì bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên (Admin) để lưu.'
          }
        };
        saveChatHistory();
        renderChatThread();
      }
      if (confirm('🔒 Bạn đang ở Chế độ xem (Chỉ đọc).\nBạn có muốn đăng nhập Quản trị viên (Admin) ngay để ghi nhận bữa cơm này không?')) {
        if (window.dashboard && typeof window.dashboard.openAdminAuthModal === 'function') {
          window.dashboard.openAdminAuthModal();
        }
      }
      return;
    }

    try {
      let p2pMembers = [];
      try {
        const rawM = localStorage.getItem('p2p_members');
        if (rawM) p2pMembers = JSON.parse(rawM);
      } catch (e) {}

      if (!Array.isArray(p2pMembers) || !p2pMembers.length) {
        p2pMembers = getSystemMembers();
      }

      let payer = p2pMembers.find(m =>
        (m.nickname && m.nickname.toLowerCase() === data.payerName.toLowerCase()) ||
        (m.name && m.name.toLowerCase() === data.payerName.toLowerCase()) ||
        (m.fullName && m.fullName.toLowerCase().includes(data.payerName.toLowerCase()))
      );

      if (!payer) {
        payer = {
          id: String(Date.now()),
          name: data.payerName,
          nickname: data.payerName,
          fullName: data.payerName
        };
        p2pMembers.push(payer);
      }

      const items = [];
      data.eaters.forEach(eaterName => {
        let eater = p2pMembers.find(m =>
          (m.nickname && m.nickname.toLowerCase() === eaterName.toLowerCase()) ||
          (m.name && m.name.toLowerCase() === eaterName.toLowerCase()) ||
          (m.fullName && m.fullName.toLowerCase().includes(eaterName.toLowerCase()))
        );

        if (!eater) {
          eater = {
            id: String(Date.now() + Math.floor(Math.random() * 1000)),
            name: eaterName,
            nickname: eaterName,
            fullName: eaterName
          };
          p2pMembers.push(eater);
        }

        items.push({
          colleagueId: eater.id,
          colleagueName: eater.nickname || eater.name,
          dishName: data.dishName || 'Cơm trưa',
          amount: data.amountPerPerson
        });
      });

      safeDbSet('p2p_members', JSON.stringify(p2pMembers));

      let logs = [];
      try {
        const rawL = localStorage.getItem('p2p_logs');
        if (rawL) logs = JSON.parse(rawL);
      } catch (e) {}

      const totalAmount = data.amountPerPerson * items.length;
      const payerDisplayName = payer.nickname || payer.name;
      const desc = `${payerDisplayName} thanh toán tổng: ${formatMoney(totalAmount)} (` +
        items.map(i => `${i.colleagueName}${i.dishName ? ` [${i.dishName}]` : ''}: ${formatMoney(i.amount)}`).join(', ') + ')';

      const newLog = {
        id: Date.now().toString(),
        dateStr: data.date,
        type: 'Bữa Ăn',
        description: desc,
        payerId: payer.id,
        payerName: payerDisplayName,
        amount: totalAmount,
        items: items
      };

      logs.unshift(newLog);

      safeDbSet('p2p_logs', JSON.stringify(logs));

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2p_logs',
        newValue: JSON.stringify(logs)
      }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'P2P_LOGS_UPDATED', newLog }, '*');
        } catch (e) {}
      });

      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'SUCCESS',
          data: {
            totalAmount,
            date: data.date,
            payerName: payerDisplayName,
            eatersCount: items.length
          }
        };
        saveChatHistory();
      }

      delete activeConfirmationData[msgId];
      renderChatThread();

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã ghi nhận bữa cơm ${formatMoney(totalAmount)} do ${payerDisplayName} trả!`);
      }

      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '🥘 Tiền Cơm Đã Nhập',
          message: `${payerDisplayName} trả ${formatMoney(totalAmount)} cho ${items.length} người.`,
          icon: '🥘',
          tag: 'Tiền Cơm',
          appUrl: 'apps/tien-com/index.html'
        });
      }
    } catch (err) {
      console.error('[AI Assistant] Lỗi lưu tiền cơm:', err);
      alert('Đã xảy ra lỗi khi lưu vào cơ sở dữ liệu: ' + err.message);
    }
  };

  // --------------------------------------------------------------------------
  // 3.1 CHIA BILL & QUỸ NHÓM TƯƠNG TÁC (CHIA-BILL)
  // --------------------------------------------------------------------------
  window.aiUpdateBillTitle = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].title = val;
  };

  window.aiUpdateBillPayer = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].payerName = val;
  };

  window.aiUpdateBillTotal = function (msgId, val) {
    if (!activeConfirmationData[msgId]) return;
    activeConfirmationData[msgId].totalAmount = parseFloat(val) || 0;
    updateBillTotalDisplay(msgId);
  };

  window.aiUpdateBillDate = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].date = val;
  };

  window.aiToggleBillParticipant = function (msgId, name) {
    const state = activeConfirmationData[msgId];
    if (!state) return;
    const idx = state.participants.findIndex(e => e.toLowerCase() === name.toLowerCase());
    if (idx !== -1) {
      if (state.participants.length <= 1) {
        alert('Phải có ít nhất 1 người tham gia chia bill!');
        return;
      }
      state.participants.splice(idx, 1);
    } else {
      state.participants.push(name);
    }
    updateBillChipsUI(msgId);
    updateBillTotalDisplay(msgId);
  };

  window.aiToggleAllBillParticipants = function (msgId) {
    const state = activeConfirmationData[msgId];
    if (!state) return;
    const all = getSystemMembers().map(m => m.nickname || m.name);
    if (state.participants.length === all.length) {
      state.participants = [state.payerName || all[0]];
    } else {
      state.participants = [...all];
    }
    updateBillChipsUI(msgId);
    updateBillTotalDisplay(msgId);
  };

  function updateBillChipsUI(msgId) {
    const state = activeConfirmationData[msgId];
    const container = document.getElementById(`aiBillPartChips_${msgId}`);
    const countEl = document.getElementById(`aiBillPartCount_${msgId}`);
    if (!container || !state) return;

    if (countEl) countEl.innerText = state.participants.length;
    const allMembers = getSystemMembers();
    container.innerHTML = allMembers.map(m => {
      const name = m.nickname || m.name;
      const isChecked = state.participants.some(e => e.toLowerCase() === name.toLowerCase());
      return `
        <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleBillParticipant('${msgId}', '${escapeHtml(name)}')">
          <span class="chip-check">${isChecked ? '✓' : '+'}</span>
          <span>${escapeHtml(name)}</span>
        </button>
      `;
    }).join('');
  }

  function updateBillTotalDisplay(msgId) {
    const state = activeConfirmationData[msgId];
    const perPersonEl = document.getElementById(`aiBillPerPerson_${msgId}`);
    if (perPersonEl && state) {
      const count = Math.max(1, state.participants.length);
      const perPerson = Math.round(state.totalAmount / count);
      perPersonEl.innerText = `${formatMoney(perPerson)}/người`;
    }
  }

  window.aiExecuteAddBill = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Không thể lưu: Bạn đang ở Chế độ xem (Chỉ đọc)!', 'warning');
      }
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'PERMISSION_DENIED',
          data: {
            title: 'Từ chối chia Bill',
            message: 'Hóa đơn chưa được ghi nhận vào hệ thống vì bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên (Admin) để lưu.'
          }
        };
        saveChatHistory();
        renderChatThread();
      }
      if (confirm('🔒 Bạn đang ở Chế độ xem (Chỉ đọc).\nBạn có muốn đăng nhập Quản trị viên (Admin) ngay để chia bill không?')) {
        if (window.dashboard && typeof window.dashboard.openAdminAuthModal === 'function') {
          window.dashboard.openAdminAuthModal();
        }
      }
      return;
    }

    try {
      let members = [];
      try {
        const rawM = localStorage.getItem('nhau_members');
        if (rawM) members = JSON.parse(rawM);
      } catch (e) {}

      if (!Array.isArray(members) || !members.length) {
        members = getSystemMembers();
      }

      const participantNames = data.participants && data.participants.length > 0 ? data.participants : [data.payerName];
      const costPerPerson = Math.round(data.totalAmount / participantNames.length);

      let payerMember = members.find(m =>
        (m.nickname && m.nickname.toLowerCase() === data.payerName.toLowerCase()) ||
        (m.name && m.name.toLowerCase() === data.payerName.toLowerCase()) ||
        (m.fullName && m.fullName.toLowerCase().includes(data.payerName.toLowerCase()))
      );

      if (!payerMember) {
        payerMember = {
          id: Date.now(),
          name: data.payerName,
          nickname: data.payerName,
          fullName: data.payerName,
          balance: 0
        };
        members.push(payerMember);
      }

      const participantsData = [];
      participantNames.forEach(pName => {
        let mem = members.find(m =>
          (m.nickname && m.nickname.toLowerCase() === pName.toLowerCase()) ||
          (m.name && m.name.toLowerCase() === pName.toLowerCase()) ||
          (m.fullName && m.fullName.toLowerCase().includes(pName.toLowerCase()))
        );

        if (!mem) {
          mem = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            name: pName,
            nickname: pName,
            fullName: pName,
            balance: 0
          };
          members.push(mem);
        }

        const isPayer = (mem.id === payerMember.id) || (pName.toLowerCase() === data.payerName.toLowerCase());
        const paid = isPayer ? data.totalAmount : 0;
        const cost = costPerPerson;

        mem.balance = (typeof mem.balance === 'number' ? mem.balance : 0) + (paid - cost);

        participantsData.push({
          id: mem.id,
          name: mem.nickname || mem.name,
          paid: paid,
          cost: cost
        });
      });

      safeDbSet('nhau_members', JSON.stringify(members));

      let meals = [];
      try {
        const rawMeals = localStorage.getItem('nhau_meals');
        if (rawMeals) meals = JSON.parse(rawMeals);
      } catch (e) {}

      const rawExpenseItems = Array.isArray(data.expenseItems) && data.expenseItems.length > 0
        ? data.expenseItems
        : [{ title: data.title || 'Khoản chi chia tiền', amount: data.totalAmount }];

      const formattedExpenseItems = rawExpenseItems.map(it => ({
        title: it.title || it.name || data.title || 'Khoản chi',
        amount: parseFloat(it.amount || it.cost || data.totalAmount) || 0
      }));

      const newMeal = {
        id: Date.now(),
        title: data.title || 'Khoản chi chia tiền',
        date: data.date,
        totalCost: data.totalAmount,
        costPerPerson: costPerPerson,
        expenseItems: formattedExpenseItems,
        participants: participantsData
      };
      meals.push(newMeal);
      safeDbSet('nhau_meals', JSON.stringify(meals));

      let moneyLogs = [];
      try {
        const rawLogs = localStorage.getItem('nhau_money_logs');
        if (rawLogs) moneyLogs = JSON.parse(rawLogs);
      } catch (e) {}

      moneyLogs.push({
        id: Date.now(),
        date: data.date,
        description: `Tạo bill: ${data.title} (${formatMoney(data.totalAmount)})`,
        amount: -data.totalAmount
      });
      safeDbSet('nhau_money_logs', JSON.stringify(moneyLogs));

      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_meals', newValue: JSON.stringify(meals) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members', newValue: JSON.stringify(members) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs', newValue: JSON.stringify(moneyLogs) }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'NHAU_DATA_UPDATED', newMeal }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'SUCCESS',
          data: {
            type: 'bill',
            title: data.title,
            totalAmount: data.totalAmount,
            date: data.date,
            payerName: payerMember.nickname || payerMember.name,
            participantsCount: participantsData.length,
            costPerPerson: costPerPerson
          }
        };
        saveChatHistory();
      }

      delete activeConfirmationData[msgId];
      renderChatThread();

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã tạo bill chia tiền ${formatMoney(data.totalAmount)} thành công!`);
      }

      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '🍻 Chia Bill Đã Tạo',
          message: `${data.title}: ${formatMoney(data.totalAmount)} do ${payerMember.nickname || payerMember.name} thanh toán.`,
          icon: '🍻',
          tag: 'Chia Bill',
          appUrl: 'apps/chia-bill/index.html'
        });
      }
    } catch (err) {
      console.error('[AI Assistant] Lỗi lưu chia bill:', err);
      alert('Đã xảy ra lỗi khi lưu vào cơ sở dữ liệu: ' + err.message);
    }
  };

  // --------------------------------------------------------------------------
  // 3.2 NHẮC VIỆC, GHI CHÚ & ĐẾM NGƯỢC (apps/ghi-chu/)
  // --------------------------------------------------------------------------
  window.aiUpdateNoteText = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].text = val;
  };

  window.aiUpdateNoteDetails = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].details = val;
  };

  window.aiUpdateNoteDeadline = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].deadline = val;
  };

  window.aiUpdateNoteType = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].noteType = val;
  };

  window.aiUpdateNotePriority = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].priority = val;
  };

  window.aiUpdateNoteRepeat = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].repeat = val;
  };

  window.aiUpdateNoteSound = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].sound = val;
  };

  window.aiUpdateNoteTags = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].tags = val;
  };

  window.aiFillNoteFormApp = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    openAppById('ghi-chu');

    setTimeout(() => {
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({
            type: 'AI_FILL_NOTE_FORM',
            payload: {
              text: data.text,
              details: data.details,
              deadline: data.deadline,
              noteType: data.noteType,
              priority: data.priority,
              repeat: data.repeat || 'none',
              sound: data.sound || 'default',
              tags: data.tags
            }
          }, '*');
        } catch(e) {}
      });
    }, 450);

    delete activeConfirmationData[msgId];
    renderChatThread();
    if (typeof window.showToast === 'function') {
      window.showToast('📋 Đã chuyển dữ liệu vào Form Nhắc Việc & Ghi Chú!');
    }
  };

  window.aiExecuteAddNote = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Không thể lưu: Bạn đang ở Chế độ xem (Chỉ đọc)!', 'warning');
      }
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'PERMISSION_DENIED',
          data: {
            title: 'Từ chối tạo Nhắc Việc / Ghi Chú',
            message: 'Nhắc việc chưa được lưu vào hệ thống vì bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên (Admin) để lưu.'
          }
        };
        saveChatHistory();
        renderChatThread();
      }
      if (confirm('🔒 Bạn đang ở Chế độ xem (Chỉ đọc).\nBạn có muốn đăng nhập Quản trị viên (Admin) ngay để tạo nhắc việc này không?')) {
        if (window.dashboard && typeof window.dashboard.openAdminAuthModal === 'function') {
          window.dashboard.openAdminAuthModal();
        }
      }
      return;
    }

    try {
      const deadlineDate = data.deadline ? new Date(data.deadline) : new Date(Date.now() + 24 * 3600 * 1000);
      const deadlineMs = deadlineDate.getTime();
      const pad = n => String(n).padStart(2, '0');
      const deadlineFormatted = `${pad(deadlineDate.getHours())}:${pad(deadlineDate.getMinutes())} ngày ${pad(deadlineDate.getDate())}/${pad(deadlineDate.getMonth() + 1)}/${deadlineDate.getFullYear()}`;

      let notes = [];
      try {
        const rawNotes = localStorage.getItem('sticky_notes_data');
        if (rawNotes) notes = JSON.parse(rawNotes);
      } catch (e) {}

      const tags = Array.isArray(data.tags) ? data.tags : (data.tags ? String(data.tags).split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : []);

      const newStickyNote = {
        id: String(Date.now()),
        text: data.text,
        details: data.details || '',
        deadline: deadlineMs,
        status: 'todo',
        type: data.noteType || 'todo',
        priority: data.priority || 'medium',
        repeat: data.repeat || 'none',
        sound: data.sound || 'default',
        tags: tags,
        isPinned: false,
        createdAt: Date.now(),
        completedAt: null
      };

      notes.unshift(newStickyNote);
      safeDbSet('sticky_notes_data', JSON.stringify(notes));

      // Phát chuông báo âm thanh nếu có SoundEngine
      if (typeof window.SoundEngine !== 'undefined') {
        const soundToPlay = window.SoundEngine.resolveTaskSound(newStickyNote);
        window.SoundEngine.play(soundToPlay);
      }

      const timeStr = `${pad(deadlineDate.getHours())}:${pad(deadlineDate.getMinutes())}`;
      const dateStr = `${deadlineDate.getFullYear()}-${pad(deadlineDate.getMonth() + 1)}-${pad(deadlineDate.getDate())}`;
      saveReminderToSystem(data.text, timeStr, dateStr, deadlineFormatted, data.repeat || 'none');

      window.dispatchEvent(new StorageEvent('storage', { key: 'sticky_notes_data', newValue: JSON.stringify(notes) }));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const syncBc = new BroadcastChannel('hongcong_tool_sync');
          syncBc.postMessage({ type: 'NOTES_UPDATED', key: 'sticky_notes_data', value: JSON.stringify(notes) });
          syncBc.close();
        }
      } catch(e) {}

      if (typeof window.scanUpcomingTasks === 'function') {
        window.scanUpcomingTasks();
      }

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED', newNote: newStickyNote }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      const typeTitles = {
        todo: 'Việc cần làm',
        reminder: 'Hẹn giờ nhắc nhở',
        countdown: 'Sự kiện đếm ngược',
        note: 'Ghi chú tự do'
      };

      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'SUCCESS',
          data: {
            type: 'note',
            text: `[${typeTitles[newStickyNote.type] || 'Nhắc việc'}] ${data.text}${newStickyNote.repeat && newStickyNote.repeat !== 'none' ? ' (Lặp lại)' : ''}`,
            deadlineStr: deadlineFormatted
          }
        };
        saveChatHistory();
      }

      delete activeConfirmationData[msgId];
      renderChatThread();

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu nhắc việc "${data.text.slice(0, 25)}..."!`);
      }

      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '🔔 Nhắc Việc Đã Lưu',
          message: `${data.text} (Hạn: ${deadlineFormatted})`,
          icon: '🔔',
          tag: 'Nhắc Việc',
          appUrl: 'apps/ghi-chu/index.html'
        });
      }
    } catch (err) {
      console.error('[AI Assistant] Lỗi lưu ghi chú:', err);
      alert('Đã xảy ra lỗi khi lưu: ' + err.message);
    }
  };

  function computeNextDeadline(currentDeadlineMs, repeatType) {
    const now = Date.now();
    let baseMs = currentDeadlineMs > now ? currentDeadlineMs : now;
    const d = new Date(baseMs);

    if (repeatType === 'daily') {
      d.setDate(d.getDate() + 1);
    } else if (repeatType === 'workdays') {
      const day = d.getDay();
      if (day === 5) d.setDate(d.getDate() + 3);
      else if (day === 6) d.setDate(d.getDate() + 2);
      else d.setDate(d.getDate() + 1);
    } else if (repeatType === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else if (repeatType === 'monthly') {
      const targetDate = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== targetDate) d.setDate(0);
    }
    return d.getTime();
  }

  // Hoàn thành ghi chú / nhắc việc qua AI
  function executeCompleteNote(keywordOrId) {
    if (!isAdminMode()) {
      return {
        success: false,
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để hoàn thành việc.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể sửa việc ở Chế độ xem.' } }
      };
    }

    try {
      let notes = [];
      try {
        const raw = localStorage.getItem('sticky_notes_data');
        if (raw) notes = JSON.parse(raw);
      } catch (e) {}

      const kw = String(keywordOrId || '').toLowerCase().trim();
      if (!kw) {
        return { success: false, replyText: '⚠️ Vui lòng chỉ định từ khóa hoặc nội dung việc cần hoàn thành.' };
      }

      // Tìm task chưa hoàn thành khớp từ khóa trước
      let targetIdx = notes.findIndex(n => n.status !== 'done' && (
        String(n.id) === kw ||
        (n.text && n.text.toLowerCase().includes(kw)) ||
        (n.details && n.details.toLowerCase().includes(kw))
      ));

      if (targetIdx === -1) {
        // Tìm trong toàn bộ danh sách
        targetIdx = notes.findIndex(n =>
          String(n.id) === kw ||
          (n.text && n.text.toLowerCase().includes(kw))
        );
      }

      if (targetIdx === -1) {
        return {
          success: false,
          replyText: `⚠️ Em không tìm thấy việc nào khớp với từ khóa **"${keywordOrId}"** trong danh sách nhắc việc & ghi chú hiện tại.`
        };
      }

      const task = notes[targetIdx];
      let replySuccess = '';
      let deadlineStr = 'Đã hoàn thành (Done)';

      // Nếu việc có thiết lập chu kỳ lặp lại
      if (task.repeat && task.repeat !== 'none') {
        const nextDeadline = computeNextDeadline(task.deadline, task.repeat);
        task.deadline = nextDeadline;
        task.status = 'todo';
        task.completedAt = Date.now();
        task.streak = (task.streak || 0) + 1;

        const d = new Date(nextDeadline);
        const pad = n => String(n).padStart(2, '0');
        const timeFormatted = `${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
        deadlineStr = `Chu kỳ tiếp theo: ${timeFormatted}`;
        const repeatNames = { daily: 'Hàng ngày', workdays: 'Ngày làm việc (T2-T6)', weekly: 'Hàng tuần', monthly: 'Hàng tháng' };
        replySuccess = `🔄 Dạ em đã hoàn thành lượt này cho **"${task.text}"** (Chuỗi: ${task.streak} lần)! Chu kỳ lặp lại [${repeatNames[task.repeat] || 'Lặp lại'}] tiếp theo được tự động đặt vào **${timeFormatted}** rồi anh nhé! 🎉`;
      } else {
        task.status = 'done';
        task.completedAt = Date.now();
        replySuccess = `✅ Dạ em đã đánh dấu hoàn thành việc: **"${task.text}"** rồi anh nhé! 🎉`;
      }

      safeDbSet('sticky_notes_data', JSON.stringify(notes));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sticky_notes_data', newValue: JSON.stringify(notes) }));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const syncBc = new BroadcastChannel('hongcong_tool_sync');
          syncBc.postMessage({ type: 'NOTES_UPDATED', key: 'sticky_notes_data', value: JSON.stringify(notes) });
          syncBc.close();
        }
      } catch(e) {}

      if (typeof window.scanUpcomingTasks === 'function') {
        window.scanUpcomingTasks();
      }

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      return {
        success: true,
        replyText: replySuccess,
        card: {
          type: 'SUCCESS',
          data: {
            type: 'note',
            text: task.text,
            deadlineStr: deadlineStr
          }
        }
      };
    } catch (e) {
      return { success: false, replyText: '❌ Lỗi khi cập nhật việc: ' + e.message };
    }
  }

  // Xóa ghi chú / nhắc việc qua AI (Hỗ trợ xóa đơn lẻ, xóa hết "all", xóa quá hạn "overdue", xóa đã xong "done")
  function executeDeleteNote(keywordOrId, forceExecute = false) {
    if (!isAdminMode()) {
      return {
        success: false,
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để xóa việc.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể xóa việc ở Chế độ xem.' } }
      };
    }

    try {
      let notes = [];
      try {
        const raw = localStorage.getItem('sticky_notes_data');
        if (raw) notes = JSON.parse(raw);
      } catch (e) {}

      if (!notes || notes.length === 0) {
        return {
          success: true,
          replyText: '📝 Danh sách nhắc việc & ghi chú hiện đang trống, không có mục nào để xóa anh nhé!'
        };
      }

      const kwRaw = String(keywordOrId || '').toLowerCase().trim();
      const normKw = normalizeVietnamese(kwRaw);
      const nowMs = Date.now();

      let targetIndexes = [];
      let deleteTypeLabel = '';

      // 1. Phân tích ngữ cảnh xóa hàng loạt (Bulk Deletion)
      const isOverdueIntent = kwRaw === 'overdue' || normKw.includes('qua han') || normKw.includes('het han');
      const isDoneIntent = kwRaw === 'done' || normKw.includes('da xong') || normKw.includes('hoan thanh');
      const isAllReminderIntent = kwRaw === 'reminder' || kwRaw === 'reminders' || normKw.includes('het nhac nho') || normKw.includes('tat ca nhac nho') || (normKw.includes('nhac nho') && (normKw.includes('het') || normKw.includes('tat ca')));
      const isAllIntent = kwRaw === 'all' || kwRaw === '*' || normKw === 'tat ca' || normKw === 'het' || normKw === 'xoa het';

      if (isOverdueIntent) {
        deleteTypeLabel = 'nhắc việc quá hạn';
        targetIndexes = notes
          .map((n, idx) => ({ n, idx }))
          .filter(item => {
            const dl = Number(item.n.deadline);
            return dl && dl < nowMs && item.n.status !== 'done';
          })
          .map(item => item.idx);

        if (targetIndexes.length === 0) {
          return {
            success: true,
            replyText: '🎉 Hiện tại không có lời nhắc nào bị quá hạn cần xóa anh nhé! Toàn bộ công việc của anh đều đang đúng tiến độ.'
          };
        }
      } else if (isDoneIntent) {
        deleteTypeLabel = 'việc đã hoàn thành';
        targetIndexes = notes
          .map((n, idx) => ({ n, idx }))
          .filter(item => item.n.status === 'done')
          .map(item => item.idx);

        if (targetIndexes.length === 0) {
          return {
            success: true,
            replyText: '📝 Hiện chưa có việc nào ở trạng thái đã hoàn thành (Done) để dọn dẹp anh nhé!'
          };
        }
      } else if (isAllReminderIntent) {
        deleteTypeLabel = 'toàn bộ lời nhắc hẹn giờ';
        targetIndexes = notes
          .map((n, idx) => ({ n, idx }))
          .filter(item => item.n.type === 'reminder')
          .map(item => item.idx);

        if (targetIndexes.length === 0) {
          targetIndexes = notes
            .map((n, idx) => ({ n, idx }))
            .filter(item => Boolean(item.n.deadline))
            .map(item => item.idx);
        }

        if (targetIndexes.length === 0) {
          return {
            success: true,
            replyText: '📝 Hiện không có lời nhắc hẹn giờ nào trong hệ thống anh nhé!'
          };
        }
      } else if (isAllIntent) {
        deleteTypeLabel = 'toàn bộ danh sách việc & ghi chú';
        targetIndexes = notes.map((_, idx) => idx);
      } else {
        // 2. Tìm kiếm theo ID hoặc Tiêu đề / Nội dung khớp từ khóa
        targetIndexes = notes
          .map((n, idx) => ({ n, idx }))
          .filter(item => {
            const n = item.n;
            const textMatch = n.text && normalizeVietnamese(n.text.toLowerCase()).includes(normKw);
            const idMatch = String(n.id) === kwRaw;
            const detailsMatch = n.details && normalizeVietnamese(n.details.toLowerCase()).includes(normKw);
            return textMatch || idMatch || detailsMatch;
          })
          .map(item => item.idx);

        if (targetIndexes.length === 0) {
          return {
            success: false,
            replyText: `⚠️ Em không tìm thấy nhắc việc hay ghi chú nào khớp với nội dung **"${keywordOrId}"** để xóa anh nhé. Anh có thể nói rõ hơn tên công việc nha!`
          };
        }
      }

      const tasksToDelete = targetIndexes.map(i => notes[i]);

      // Nếu xóa hàng loạt (nhiều hơn 1 mục, hoặc xóa All/Overdue) và chưa qua bước duyệt thẻ:
      if (!forceExecute && (targetIndexes.length > 1 || isAllIntent || isOverdueIntent || isDoneIntent)) {
        const previewItems = tasksToDelete.slice(0, 5).map(t => `"${t.text}"`).join(', ') + (tasksToDelete.length > 5 ? ` và ${tasksToDelete.length - 5} mục khác` : '');

        const conf = requestActionConfirmation(
          'NOTE_DELETE',
          { keyword: kwRaw, count: targetIndexes.length },
          `🗑️ Xác Nhận Xóa ${targetIndexes.length} ${deleteTypeLabel || 'Mục'}`,
          `Hệ thống sẽ xóa vĩnh viễn ${targetIndexes.length} ${deleteTypeLabel || 'mục'} khỏi App Nhắc Việc & Ghi Chú:`,
          [
            `Số lượng sẽ xóa: ${targetIndexes.length} mục`,
            `Danh sách: ${previewItems}`,
            'Dữ liệu sẽ được dọn sạch và đồng bộ lên Supabase Cloud'
          ],
          true
        );
        return {
          success: true,
          replyText: conf.replyText,
          card: conf.card
        };
      }

      // THỰC THI XÓA SẠCH
      const sortedIdxs = [...targetIndexes].sort((a, b) => b - a);
      const deletedItems = [];
      sortedIdxs.forEach(idx => {
        deletedItems.push(notes.splice(idx, 1)[0]);
      });

      safeDbSet('sticky_notes_data', JSON.stringify(notes));

      // Xóa triệt để cả trong sys_reminders
      try {
        let remList = JSON.parse(localStorage.getItem('sys_reminders')) || [];
        const deletedIds = new Set(deletedItems.map(d => String(d.id)));
        const deletedTexts = new Set(deletedItems.map(d => d.text));
        remList = remList.filter(r => !deletedIds.has(String(r.id)) && !deletedTexts.has(r.task));
        safeDbSet('sys_reminders', JSON.stringify(remList));
      } catch (e) {}

      // Xóa trong p2p_notes
      try {
        let p2p = JSON.parse(localStorage.getItem('p2p_notes')) || [];
        const deletedTexts = new Set(deletedItems.map(d => d.text));
        p2p = p2p.filter(p => !deletedTexts.has(p.content) && !deletedTexts.has(p.title));
        safeDbSet('p2p_notes', JSON.stringify(p2p));
      } catch (e) {}

      window.dispatchEvent(new StorageEvent('storage', { key: 'sticky_notes_data', newValue: JSON.stringify(notes) }));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const syncBc = new BroadcastChannel('hongcong_tool_sync');
          syncBc.postMessage({ type: 'NOTES_UPDATED', key: 'sticky_notes_data', value: JSON.stringify(notes) });
          syncBc.close();
        }
      } catch(e) {}

      if (typeof window.scanUpcomingTasks === 'function') {
        window.scanUpcomingTasks();
      }

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          new BroadcastChannel('app_sync_channel').postMessage({ type: 'NOTES_UPDATED' });
        }
      } catch (e) {}

      if (typeof window.updateStickyNotesWidget === 'function') {
        window.updateStickyNotesWidget();
      }

      if (deletedItems.length === 1) {
        return {
          success: true,
          replyText: `🗑️ Dạ em đã xóa thành công việc: **"${deletedItems[0].text}"** khỏi hệ thống rồi anh nhé!`
        };
      } else {
        return {
          success: true,
          replyText: `🗑️ Dạ em đã xóa sạch thành công **${deletedItems.length} ${deleteTypeLabel || 'mục'}** khỏi App Nhắc Việc & Ghi Chú rồi anh nhé! 🎉`
        };
      }
    } catch (e) {
      return { success: false, replyText: '❌ Lỗi khi xóa việc: ' + e.message };
    }
  }

  // Cập nhật deadline / priority cho việc
  function executeUpdateNote(keyword, updates = {}) {
    if (!isAdminMode()) {
      return {
        success: false,
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để sửa việc.'
      };
    }

    try {
      let notes = [];
      try {
        const raw = localStorage.getItem('sticky_notes_data');
        if (raw) notes = JSON.parse(raw);
      } catch (e) {}

      const kw = String(keyword || '').toLowerCase().trim();
      const target = notes.find(n => (n.text && n.text.toLowerCase().includes(kw)));
      if (!target) {
        return { success: false, replyText: `⚠️ Em không tìm thấy việc nào khớp với **"${keyword}"** để sửa.` };
      }

      if (updates.deadline) {
        const ms = new Date(updates.deadline).getTime();
        if (!isNaN(ms)) target.deadline = ms;
      }
      if (updates.priority) target.priority = updates.priority;
      if (updates.repeat) target.repeat = updates.repeat;
      if (updates.text) target.text = updates.text;
      if (updates.details) target.details = updates.details;
      if (updates.type) target.type = updates.type;

      safeDbSet('sticky_notes_data', JSON.stringify(notes));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sticky_notes_data', newValue: JSON.stringify(notes) }));

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const syncBc = new BroadcastChannel('hongcong_tool_sync');
          syncBc.postMessage({ type: 'NOTES_UPDATED', key: 'sticky_notes_data', value: JSON.stringify(notes) });
          syncBc.close();
        }
      } catch(e) {}

      if (typeof window.scanUpcomingTasks === 'function') {
        window.scanUpcomingTasks();
      }

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      const d = new Date(target.deadline);
      const pad = n => String(n).padStart(2, '0');
      const timeFormatted = `${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

      return {
        success: true,
        replyText: `✏️ Dạ em đã cập nhật việc **"${target.text}"** thành công!\n* Hạn mới: **${timeFormatted}**\n* Mức ưu tiên: **${target.priority === 'high' ? 'Cao 🔥' : (target.priority === 'low' ? 'Thấp 🌱' : 'Vừa ⭐')}**`
      };
    } catch (e) {
      return { success: false, replyText: '❌ Lỗi cập nhật: ' + e.message };
    }
  }

  // --------------------------------------------------------------------------
  // 3.3 DANH BẠ THÀNH VIÊN TƯƠNG TÁC (DANH-BA)
  // --------------------------------------------------------------------------
  window.aiUpdateContactField = function (msgId, field, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId][field] = val;
  };

  window.aiExecuteAddContact = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Không thể lưu: Bạn đang ở Chế độ xem (Chỉ đọc)!', 'warning');
      }
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'PERMISSION_DENIED',
          data: {
            title: 'Từ chối thêm Danh Bạ',
            message: 'Liên hệ chưa được lưu vào hệ thống vì bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên (Admin) để lưu.'
          }
        };
        saveChatHistory();
        renderChatThread();
      }
      if (confirm('🔒 Bạn đang ở Chế độ xem (Chỉ đọc).\nBạn có muốn đăng nhập Quản trị viên (Admin) ngay để thêm liên hệ này không?')) {
        if (window.dashboard && typeof window.dashboard.openAdminAuthModal === 'function') {
          window.dashboard.openAdminAuthModal();
        }
      }
      return;
    }

    try {
      let members = [];
      try {
        const rawM = localStorage.getItem('sys_global_members');
        if (rawM) members = JSON.parse(rawM);
      } catch (e) {}

      if (!Array.isArray(members) || !members.length) {
        members = getSystemMembers();
      }

      const fullName = (data.fullName || '').trim();
      const nickname = (data.nickname || '').trim() || fullName;
      const phone = (data.phone || '').trim();
      const dob = data.dob || '';
      const bankId = data.bankId || '';
      const accountNo = (data.accountNo || '').trim();
      const note = (data.role || '').trim();

      const existingIdx = members.findIndex(m =>
        (phone && m.phone === phone) ||
        (fullName && m.fullName && m.fullName.toLowerCase() === fullName.toLowerCase()) ||
        (nickname && m.nickname && m.nickname.toLowerCase() === nickname.toLowerCase())
      );

      const memberObj = {
        id: existingIdx !== -1 ? members[existingIdx].id : Date.now(),
        fullName,
        nickname,
        name: nickname,
        dob,
        phone,
        bankId,
        accountNo,
        accountName: fullName.toUpperCase(),
        note
      };

      if (existingIdx !== -1) {
        members[existingIdx] = { ...members[existingIdx], ...memberObj };
      } else {
        members.push(memberObj);
      }

      safeDbSet('sys_global_members', JSON.stringify(members));

      try {
        let p2pM = JSON.parse(localStorage.getItem('p2p_members')) || [];
        const p2pIdx = p2pM.findIndex(m => String(m.id) === String(memberObj.id) || (m.nickname && memberObj.nickname && m.nickname.toLowerCase() === memberObj.nickname.toLowerCase()));
        if (p2pIdx !== -1) {
          p2pM[p2pIdx] = { ...p2pM[p2pIdx], ...memberObj };
          safeDbSet('p2p_members', JSON.stringify(p2pM));
        }
        let nhauM = JSON.parse(localStorage.getItem('nhau_members')) || [];
        const nhauIdx = nhauM.findIndex(m => String(m.id) === String(memberObj.id) || (m.nickname && memberObj.nickname && m.nickname.toLowerCase() === memberObj.nickname.toLowerCase()));
        if (nhauIdx !== -1) {
          nhauM[nhauIdx] = { ...nhauM[nhauIdx], ...memberObj };
          safeDbSet('nhau_members', JSON.stringify(nhauM));
        }
      } catch (e) {}

      try {
        const bc = new BroadcastChannel('system_member_sync');
        bc.postMessage({ type: 'MEMBERS_UPDATED', members: members, globalMembers: members });
      } catch (e) {}

      window.dispatchEvent(new StorageEvent('storage', { key: 'sys_global_members', newValue: JSON.stringify(members) }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'MEMBERS_UPDATED', members }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });

      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.card = {
          type: 'SUCCESS',
          data: {
            type: 'contact',
            fullName,
            nickname,
            phone,
            bankId,
            accountNo
          }
        };
        saveChatHistory();
      }

      delete activeConfirmationData[msgId];
      renderChatThread();

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu thành viên "${fullName}" vào danh bạ!`);
      }

      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '👥 Danh Bạ Đã Thêm',
          message: `${fullName} (${nickname})${phone ? ' • ' + phone : ''}`,
          icon: '👥',
          tag: 'Danh Bạ',
          appUrl: 'apps/danh-ba/index.html'
        });
      }
    } catch (err) {
      console.error('[AI Assistant] Lỗi lưu danh bạ:', err);
      alert('Đã xảy ra lỗi khi lưu danh bạ: ' + err.message);
    }
  };

  // --------------------------------------------------------------------------
  // 4. PARSER LỊCH NHẮC NHỞ & LƯU HỆ THỐNG
  // --------------------------------------------------------------------------
  function saveReminderToSystem(task, timeStr, dateStr, displayFormatted, repeat = 'none', sound = 'default') {
    if (!isAdminMode()) {
      console.warn('saveReminderToSystem blocked: not in admin mode');
      return;
    }
    try {
      let reminders = [];
      try { reminders = JSON.parse(localStorage.getItem('sys_reminders')) || []; } catch (e) {}

      const [y, m, d] = (dateStr || '').split('-').map(Number);
      const [h, min] = (timeStr || '').split(':').map(Number);
      const targetDate = new Date(y || new Date().getFullYear(), (m ? m - 1 : new Date().getMonth()), d || new Date().getDate(), h || 9, min || 0);

      const remItem = {
        id: 'rem_' + Date.now(),
        task,
        timeStr,
        dateStr,
        displayFormatted,
        repeat: repeat || 'none',
        sound: sound || 'default',
        timestamp: targetDate.getTime(),
        completed: false
      };
      reminders.unshift(remItem);
      safeDbSet('sys_reminders', JSON.stringify(reminders));

      // Chỉ thêm vào sticky_notes_data nếu chưa tồn tại (tránh bị nhân đôi từ aiExecuteAddNote)
      let notes = [];
      try { notes = JSON.parse(localStorage.getItem('sticky_notes_data')) || []; } catch (e) {}
      const normTask = (task || '').trim().toLowerCase();
      const alreadyExists = notes.some(n => {
        const nNorm = (n.text || '').trim().toLowerCase();
        const dlDiff = Math.abs(Number(n.deadline) - targetDate.getTime());
        const timeDiff = Math.abs(Number(n.createdAt) - Date.now());
        return (nNorm === normTask || nNorm.includes(normTask) || normTask.includes(nNorm)) && (dlDiff < 180000 || timeDiff < 30000);
      });

      if (!alreadyExists) {
        const newStickyNote = {
          id: 'rem_' + Date.now(),
          text: task,
          details: displayFormatted ? `Lịch hẹn: ${displayFormatted}` : '',
          deadline: targetDate.getTime(),
          status: 'todo',
          type: 'reminder',
          priority: 'medium',
          repeat: repeat || 'none',
          sound: sound || 'default',
          tags: ['nhắc nhở'],
          isPinned: false,
          createdAt: Date.now(),
          completedAt: null
        };
        notes.unshift(newStickyNote);
        safeDbSet('sticky_notes_data', JSON.stringify(notes));

        if (typeof window.SoundEngine !== 'undefined') {
          const soundToPlay = window.SoundEngine.resolveTaskSound(newStickyNote);
          window.SoundEngine.play(soundToPlay);
        }

        // Lưu thêm p2p_notes để tương thích ngược
        try {
          let p2p = JSON.parse(localStorage.getItem('p2p_notes')) || [];
          p2p.unshift({
            id: 'note_' + Date.now(),
            title: `⏰ Nhắc nhở: ${displayFormatted}`,
            content: task,
            color: '#fbbf24',
            date: new Date().toLocaleDateString('vi-VN')
          });
          safeDbSet('p2p_notes', JSON.stringify(p2p));
        } catch(e) {}

        // Đồng bộ thời gian thực tới tất cả iframe và widget
        window.dispatchEvent(new StorageEvent('storage', { key: 'sticky_notes_data', newValue: JSON.stringify(notes) }));

        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const syncBc = new BroadcastChannel('hongcong_tool_sync');
            syncBc.postMessage({ type: 'NOTES_UPDATED', key: 'sticky_notes_data', value: JSON.stringify(notes) });
            syncBc.close();
          }
        } catch(e) {}

        if (typeof window.scanUpcomingTasks === 'function') {
          window.scanUpcomingTasks();
        }

        document.querySelectorAll('iframe').forEach(ifr => {
          try {
            ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED', newNote: newStickyNote }, '*');
            ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
          } catch (e) {}
        });

        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const appBc = new BroadcastChannel('app_sync_channel');
            appBc.postMessage({ type: 'NOTES_UPDATED', newNote: newStickyNote });
          }
        } catch(e) {}

        if (typeof window.updateStickyNotesWidget === 'function') {
          window.updateStickyNotesWidget();
        }
      }

      window.dispatchEvent(new StorageEvent('storage', { key: 'sys_reminders' }));

      // Thông báo hệ thống
      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '⏰ Đã Lên Lịch Nhắc Nhở',
          message: `${task} vào lúc ${displayFormatted}${repeat && repeat !== 'none' ? ' (Lặp lại)' : ''}`,
          icon: '⏰',
          tag: 'Nhắc Nhở',
          appUrl: 'apps/ghi-chu/index.html'
        });
      }
    } catch (e) {
      console.warn('Lỗi lưu reminder:', e);
    }
  }

  function parseReminderOffline(rawText) {
    const norm = normalizeVietnamese(rawText);

    const isReminder = /^(nhac|hen|dat gio|luu lich|nho nhac|nhac nho|remind)/i.test(norm) ||
                       norm.includes('nhac toi') || norm.includes('hen gio') || norm.includes('nhac nho');

    if (!isReminder) return null;

    let repeat = 'none';
    if (norm.includes('moi ngay') || norm.includes('hang ngay') || norm.includes('hang sang') || norm.includes('hang toi') || norm.includes('moi sang') || norm.includes('moi toi')) {
      repeat = 'daily';
    } else if (norm.includes('ngay lam viec') || norm.includes('thu 2 den thu 6') || norm.includes('t2-t6')) {
      repeat = 'workdays';
    } else if (norm.includes('hang tuan') || norm.includes('moi tuan') || norm.includes('thu 2 hang tuan') || norm.includes('thu hai hang tuan')) {
      repeat = 'weekly';
    } else if (norm.includes('hang thang') || norm.includes('moi thang')) {
      repeat = 'monthly';
    }

    let sound = 'default';
    if (norm.includes('chuong radar') || norm.includes('bao thuc') || norm.includes('chuong bao thuc')) {
      sound = 'radar_alarm';
    } else if (norm.includes('chuong mac') || norm.includes('macos')) {
      sound = 'macos_chime';
    } else if (norm.includes('chuong pha le') || norm.includes('crystal')) {
      sound = 'crystal_bell';
    } else if (norm.includes('dong ho dien tu') || norm.includes('casio') || norm.includes('beep')) {
      sound = 'digital_beep';
    } else if (norm.includes('chuong thien') || norm.includes('zen')) {
      sound = 'zen_bowl';
    } else if (norm.includes('khai hoan') || norm.includes('fanfare')) {
      sound = 'fanfare';
    } else if (norm.includes('cyber') || norm.includes('synth')) {
      sound = 'cyber_synth';
    } else if (norm.includes('marimba')) {
      sound = 'marimba';
    } else if (norm.includes('coi bao dong') || norm.includes('bao dong') || norm.includes('siren') || norm.includes('khan cap')) {
      sound = 'urgent_siren';
    } else if (norm.includes('giot nuoc') || norm.includes('water drop')) {
      sound = 'water_drop';
    }

    let task = rawText
      .replace(/^(nhắc tôi|nhắc nhở|nhớ nhắc|hẹn giờ|lên lịch|nhắc|remind me|remind)\s*/i, '')
      .replace(/\b(ngày mai|mai|hôm nay|nay|ngày kia|mốt)\b/gi, '')
      .replace(/\b(mỗi ngày|hàng ngày|hàng tuần|mỗi tuần|hàng tháng|mỗi tháng|ngày làm việc)\b/gi, '')
      .replace(/\b(chuông radar|chuông mac|chuông pha lê|chuông thiền|chuông khải hoàn|còi báo động|giọt nước|báo thức|chuông báo thức|chuông báo)\b/gi, '')
      .replace(/\b(\d{1,2}(?:h|:\d{2}|h\d{2})?\s*(?:sáng|chiều|tối)?)\b/gi, '')
      .replace(/\b(lúc|vào lúc|vào)\b/gi, '')
      .trim();

    if (!task) task = 'Công việc cần làm';

    const now = new Date();
    let targetDate = new Date(now.getTime());

    if (norm.includes('ngay mai') || norm.includes('mai')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (norm.includes('ngay kia') || norm.includes('mot')) {
      targetDate.setDate(targetDate.getDate() + 2);
    }

    let hours = 9;
    let minutes = 0;

    const timeMatch = rawText.match(/(\d{1,2})\s*(?:[:h](\d{1,2}))?\s*(h|giờ|g|h30|am|pm|sáng|chiều|tối)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      let m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const isPm = /(chiều|tối|pm)/i.test(rawText);
      const isAm = /(sáng|am)/i.test(rawText);

      if (isPm && h < 12) h += 12;
      if (isAm && h === 12) h = 0;
      hours = h;
      minutes = m;
    }

    targetDate.setHours(hours, minutes, 0, 0);

    const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const displayFormatted = `${timeStr} ngày ${String(targetDate.getDate()).padStart(2, '0')}/${String(targetDate.getMonth() + 1).padStart(2, '0')}/${targetDate.getFullYear()}`;

    saveReminderToSystem(task, timeStr, dateStr, displayFormatted, repeat, sound);

    return {
      task,
      timeStr,
      dateStr,
      displayFormatted,
      repeat,
      sound
    };
  }

  // --------------------------------------------------------------------------
  // 4.5 CAN THIỆP SÂU HỆ THỐNG (DEEP SYSTEM ACTIONS & EXECUTION ENGINE)
  // --------------------------------------------------------------------------
  function getCurrentSystemSnapshot() {
    let p2pMembers = [];
    try { p2pMembers = JSON.parse(localStorage.getItem('p2p_members')) || []; } catch(e) {}
    if (!p2pMembers.length) p2pMembers = getSystemMembers();

    let logs = [];
    try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch(e) {}

    const calculatedDebts = {};
    function getD(fromId, toId) { return calculatedDebts[`${fromId}_${toId}`] || 0; }
    function setD(fromId, toId, amt) {
      if (amt <= 0) delete calculatedDebts[`${fromId}_${toId}`];
      else calculatedDebts[`${fromId}_${toId}`] = amt;
    }
    function adjD(debtorId, creditorId, amount) {
      if (debtorId === creditorId || amount === 0) return;
      let rev = getD(creditorId, debtorId);
      if (rev > 0) {
        if (rev >= amount) { setD(creditorId, debtorId, rev - amount); return; }
        else { amount -= rev; setD(creditorId, debtorId, 0); }
      }
      setD(debtorId, creditorId, getD(debtorId, creditorId) + amount);
    }

    const sortedLogs = [...logs].reverse();
    sortedLogs.forEach(l => {
      if (l.type === 'Bữa Ăn' && l.items) {
        l.items.forEach(item => {
          if (item.amount > 0 && item.colleagueId !== l.payerId) {
            adjD(item.colleagueId, l.payerId, item.amount);
          }
        });
      } else if (l.type === 'Trả Tiền') {
        let cur = getD(l.payerId, l.receiverId);
        if (cur >= l.amount) setD(l.payerId, l.receiverId, cur - l.amount);
        else {
          setD(l.payerId, l.receiverId, 0);
          adjD(l.receiverId, l.payerId, l.amount - cur);
        }
      }
    });

    const outstandingDebts = [];
    const debtLines = [];
    let totalDebtSum = 0;

    for (const key in calculatedDebts) {
      const amt = calculatedDebts[key];
      if (amt > 0) {
        const [fromId, toId] = key.split('_');
        const debtor = p2pMembers.find(m => String(m.id) === String(fromId)) || { id: fromId, name: fromId };
        const creditor = p2pMembers.find(m => String(m.id) === String(toId)) || { id: toId, name: toId };
        const dName = debtor.nickname || debtor.name;
        const cName = creditor.nickname || creditor.name;
        debtLines.push(`${dName} nợ ${cName}: ${formatMoney(amt)}`);
        outstandingDebts.push({
          debtorId: debtor.id,
          debtorName: dName,
          creditorId: creditor.id,
          creditorName: cName,
          amount: amt
        });
        totalDebtSum += amt;
      }
    }

    let notes = [];
    try { notes = JSON.parse(localStorage.getItem('sticky_notes_data')) || []; } catch(e) {}
    let bills = [];
    try { bills = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}

    return {
      members: p2pMembers,
      logs: logs,
      logsCount: logs.length,
      debtLines,
      outstandingDebts,
      totalDebtSum,
      notes,
      stickyNotesCount: notes.length,
      bills,
      billsCount: bills.length
    };
  }

  // --------------------------------------------------------------------------
  // CAN THIỆP SÂU APP CHIA BILL & QUỸ NHÓM (apps/chia-bill/)
  // --------------------------------------------------------------------------
  function requestActionConfirmation(actionKey, params, title, description, details, isDanger = true) {
    const confirmId = 'confirm_' + Date.now();
    const data = {
      actionKey,
      params: params || {},
      title,
      description,
      details: details || [],
      isDanger
    };
    activeConfirmationData[confirmId] = data;
    pendingActionToConfirm = { msgId: confirmId, ...data };

    return {
      replyText: `⚠️ **Yêu cầu xác nhận:** ${title}\n\nVui lòng kiểm tra thông tin chi tiết và bấm nút xác nhận bên dưới (hoặc gõ *"xác nhận"* / *"hủy"*) để tiếp tục nhé!`,
      card: {
        type: 'ACTION_CONFIRM',
        data: data
      }
    };
  }

  function executeResetChiaBill(mode = 'keep_members_zero') {
    if (!isAdminMode()) {
      return {
        success: false,
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể reset Chia Bill ở Chế độ xem.' } }
      };
    }

    try {
      let members = [];
      try {
        const rawM = localStorage.getItem('nhau_members');
        if (rawM) members = JSON.parse(rawM);
      } catch(e) {}
      if (!Array.isArray(members) || members.length === 0) {
        members = getSystemMembers();
      }

      // Lưu backup để hoàn tác
      window._lastChiaBillBackup = {
        members: JSON.stringify(members),
        meals: localStorage.getItem('nhau_meals') || '[]',
        logs: localStorage.getItem('nhau_money_logs') || '[]'
      };

      // Đưa số dư toàn bộ thành viên về 0đ
      members = members.map(m => ({
        ...m,
        balance: 0
      }));

      const emptyMeals = [];
      const emptyLogs = [];

      localStorage.setItem('nhau_members', JSON.stringify(members));
      localStorage.setItem('nhau_meals', JSON.stringify(emptyMeals));
      localStorage.setItem('nhau_money_logs', JSON.stringify(emptyLogs));

      safeDbSet('nhau_members', JSON.stringify(members));
      safeDbSet('nhau_meals', JSON.stringify(emptyMeals));
      safeDbSet('nhau_money_logs', JSON.stringify(emptyLogs));

      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members', newValue: JSON.stringify(members) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_meals', newValue: JSON.stringify(emptyMeals) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs', newValue: JSON.stringify(emptyLogs) }));

      // Gửi event trực tiếp cho các iframe
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'NHAU_DATA_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch(e) {}
      });

      try {
        new BroadcastChannel('chia_bill_sync').postMessage({ type: 'CHIA_BILL_UPDATED' });
      } catch(e) {}

      if (typeof window.showToast === 'function') {
        window.showToast('🔄 Đã reset toàn bộ dữ liệu Chia Bill & Quỹ Nhóm về 0đ!');
      }

      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '🔄 Chia Bill Đã Reset Về 0đ',
          message: `Toàn bộ ${members.length} thành viên đã cân bằng 0đ, sẵn sàng nhập dữ liệu mới.`,
          icon: '🔄',
          tag: 'Chia Bill',
          appUrl: 'apps/chia-bill/index.html'
        });
      }

      return {
        success: true,
        replyText: `🚀 **Đã reset toàn bộ dữ liệu Chia Bill & Quỹ Nhóm về 0đ thành công!**\n\n- Toàn bộ hóa đơn chi tiêu và nhật ký quỹ đã được xóa sạch.\n- Số dư của **${members.length} thành viên** đã được cân bằng về **0đ**.\n- Dữ liệu đã đồng bộ tức thì lên Supabase Cloud và giao diện ứng dụng Chia Bill!`,
        card: {
          type: 'RESET_CHIA_BILL_SUCCESS',
          data: {
            memberCount: members.length
          }
        }
      };
    } catch(err) {
      console.error('[AI Assistant] Lỗi reset chia bill:', err);
      return {
        success: false,
        replyText: `❌ Đã xảy ra lỗi khi reset Chia Bill: ${err.message}`,
        card: null
      };
    }
  }

  function aiUndoLastResetChiaBill() {
    if (!window._lastChiaBillBackup) {
      if (typeof window.showToast === 'function') window.showToast('Không có dữ liệu hoàn tác!');
      return;
    }
    try {
      const b = window._lastChiaBillBackup;
      localStorage.setItem('nhau_members', b.members);
      localStorage.setItem('nhau_meals', b.meals);
      localStorage.setItem('nhau_money_logs', b.logs);

      safeDbSet('nhau_members', b.members);
      safeDbSet('nhau_meals', b.meals);
      safeDbSet('nhau_money_logs', b.logs);

      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members', newValue: b.members }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_meals', newValue: b.meals }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs', newValue: b.logs }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
        } catch(e) {}
      });
      try {
        new BroadcastChannel('chia_bill_sync').postMessage({ type: 'CHIA_BILL_UPDATED' });
      } catch(e) {}

      window._lastChiaBillBackup = null;
      if (typeof window.showToast === 'function') {
        window.showToast('↩️ Đã hoàn tác lại dữ liệu Chia Bill ban đầu!');
      }
      chatHistory.push({
        id: 'msg_' + Date.now(),
        role: 'assistant',
        text: '↩️ **Đã hoàn tác khôi phục lại dữ liệu Chia Bill ban đầu thành công!** Mọi hóa đơn và số dư của các thành viên đã quay trở về trạng thái trước đó.',
        time: getCurrentTimeStr()
      });
      saveChatHistory();
      renderChatThread();
    } catch(e) {
      alert('Lỗi hoàn tác: ' + e.message);
    }
  }

  function executeDeleteChiaBill(mealIdOrTitle) {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể xóa bill ở Chế độ xem.' } }
      };
    }

    try {
      let meals = [];
      try { meals = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}
      if (meals.length === 0) {
        return {
          replyText: 'Hiện tại trong ứng dụng Chia Bill chưa có hóa đơn nào để xóa.',
          card: null
        };
      }

      let mealIndex = -1;
      if (mealIdOrTitle) {
        const queryStr = String(mealIdOrTitle).toLowerCase().trim();
        mealIndex = meals.findIndex(m => String(m.id) === queryStr || (m.title && m.title.toLowerCase().includes(queryStr)));
      }
      if (mealIndex === -1) {
        mealIndex = meals.length - 1;
      }

      const meal = meals[mealIndex];
      let members = [];
      try { members = JSON.parse(localStorage.getItem('nhau_members')) || []; } catch(e) {}

      // Hoàn tác số dư của các thành viên tham gia
      if (meal.participants && Array.isArray(meal.participants)) {
        meal.participants.forEach(p => {
          const mem = members.find(x => String(x.id) === String(p.id) || x.name === p.name);
          if (mem) {
            mem.balance = (typeof mem.balance === 'number' ? mem.balance : 0) - (p.paid - p.cost);
          }
        });
      }

      meals.splice(mealIndex, 1);

      let moneyLogs = [];
      try { moneyLogs = JSON.parse(localStorage.getItem('nhau_money_logs')) || []; } catch(e) {}
      moneyLogs.push({
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        description: `Xóa bill: ${meal.title || 'Hóa đơn'} (Hoàn tác công nợ ${formatMoney(meal.totalCost || 0)})`,
        amount: meal.totalCost || 0
      });

      localStorage.setItem('nhau_members', JSON.stringify(members));
      localStorage.setItem('nhau_meals', JSON.stringify(meals));
      localStorage.setItem('nhau_money_logs', JSON.stringify(moneyLogs));

      safeDbSet('nhau_members', JSON.stringify(members));
      safeDbSet('nhau_meals', JSON.stringify(meals));
      safeDbSet('nhau_money_logs', JSON.stringify(moneyLogs));

      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members', newValue: JSON.stringify(members) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_meals', newValue: JSON.stringify(meals) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs', newValue: JSON.stringify(moneyLogs) }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
        } catch(e) {}
      });
      try {
        new BroadcastChannel('chia_bill_sync').postMessage({ type: 'CHIA_BILL_UPDATED' });
      } catch(e) {}

      if (typeof window.showToast === 'function') {
        window.showToast(`🗑️ Đã xóa hóa đơn "${meal.title}" trong Chia Bill!`);
      }

      return {
        success: true,
        replyText: `🗑️ **Đã xóa hóa đơn Chia Bill thành công:**\n> **"${meal.title}"** (${formatMoney(meal.totalCost || 0)})\n\nSố dư công nợ của các thành viên tham gia đã được tự động hoàn tác chính xác!`,
        card: {
          type: 'DELETE_BILL_SUCCESS',
          data: {
            title: meal.title,
            totalCost: meal.totalCost
          }
        }
      };
    } catch(err) {
      return {
        success: false,
        replyText: `Lỗi xóa bill: ${err.message}`,
        card: null
      };
    }
  }

  function executeSettleChiaBill(memberName, inputAmount, isDeposit = true) {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể cấn trừ quỹ ở Chế độ xem.' } }
      };
    }

    try {
      let members = [];
      try { members = JSON.parse(localStorage.getItem('nhau_members')) || []; } catch(e) {}

      const member = members.find(m =>
        (m.nickname && m.nickname.toLowerCase().includes(memberName.toLowerCase())) ||
        (m.name && m.name.toLowerCase().includes(memberName.toLowerCase())) ||
        (m.fullName && m.fullName.toLowerCase().includes(memberName.toLowerCase()))
      );

      if (!member) {
        return {
          replyText: `❌ Không tìm thấy thành viên **${memberName}** trong danh sách Chia Bill.`,
          card: null
        };
      }

      const mName = member.nickname || member.name;
      let amount = inputAmount;
      if (!amount) {
        amount = Math.abs(member.balance || 0);
      }
      if (amount <= 0) {
        return {
          replyText: `✨ Thành viên **${mName}** hiện đã cân bằng quỹ (0đ), không có công nợ nào cần cấn trừ!`,
          card: null
        };
      }

      const delta = isDeposit ? amount : -amount;
      member.balance = (member.balance || 0) + delta;

      const today = new Date().toISOString().split('T')[0];
      const actionText = delta > 0 ? "nạp quỹ / thanh toán nợ" : "nhận hoàn tiền thừa";

      let moneyLogs = [];
      try { moneyLogs = JSON.parse(localStorage.getItem('nhau_money_logs')) || []; } catch(e) {}
      moneyLogs.push({
        id: Date.now(),
        date: today,
        description: `${member.fullName || mName} ${actionText} (${formatMoney(Math.abs(amount))}) qua Kira`,
        amount: delta
      });

      localStorage.setItem('nhau_members', JSON.stringify(members));
      localStorage.setItem('nhau_money_logs', JSON.stringify(moneyLogs));

      safeDbSet('nhau_members', JSON.stringify(members));
      safeDbSet('nhau_money_logs', JSON.stringify(moneyLogs));

      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members', newValue: JSON.stringify(members) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs', newValue: JSON.stringify(moneyLogs) }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
        } catch(e) {}
      });
      try {
        new BroadcastChannel('chia_bill_sync').postMessage({ type: 'CHIA_BILL_UPDATED' });
      } catch(e) {}

      return {
        success: true,
        replyText: `✅ **Đã cấn trừ quỹ Chia Bill thành công cho ${mName}!**\n- Số tiền: **${formatMoney(amount)}**\n- Số dư quỹ mới: **${formatMoney(member.balance)}**`,
        card: {
          type: 'SETTLE_CHIA_BILL_SUCCESS',
          data: {
            name: mName,
            amount: amount,
            newBalance: member.balance
          }
        }
      };
    } catch(err) {
      return {
        success: false,
        replyText: `Lỗi cấn trừ: ${err.message}`,
        card: null
      };
    }
  }

  function executeDepositMember(memberName, amount, note = 'Nạp tiền qua Trợ Lý AI') {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể nạp tiền ở Chế độ xem.' } }
      };
    }
    try {
      const numAmount = Math.abs(parseInt(amount, 10) || 0);
      if (numAmount <= 0) {
        return { success: false, replyText: '⚠️ Số tiền nạp không hợp lệ!', card: null };
      }

      let members = [];
      try { members = JSON.parse(localStorage.getItem('sys_global_members')) || []; } catch(e) {}
      if (members.length === 0 && window.memberService) {
        members = window.memberService.getAll();
      }

      const normTarget = normalizeVietnamese(memberName || '');
      let foundMember = members.find(m => {
        return normalizeVietnamese(m.name || '').includes(normTarget) ||
               normalizeVietnamese(m.nickname || '').includes(normTarget) ||
               normalizeVietnamese(m.fullName || '').includes(normTarget);
      });

      if (!foundMember) {
        return {
          success: false,
          replyText: `⚠️ Không tìm thấy thành viên **"${memberName}"** trong danh sách hệ thống. Vui lòng kiểm tra lại tên!`,
          card: null
        };
      }

      const oldBalance = typeof foundMember.balance === 'number' ? foundMember.balance : 0;
      const newBalance = oldBalance + numAmount;
      foundMember.balance = newBalance;
      foundMember.updated_at = new Date().toISOString();

      localStorage.setItem('sys_global_members', JSON.stringify(members));
      safeDbSet('sys_global_members', JSON.stringify(members));

      try {
        let billMems = JSON.parse(localStorage.getItem('nhau_members')) || [];
        const bm = billMems.find(m => String(m.id) === String(foundMember.id) || normalizeVietnamese(m.name || '') === normalizeVietnamese(foundMember.name || ''));
        if (bm) {
          bm.balance = (typeof bm.balance === 'number' ? bm.balance : 0) + numAmount;
        } else {
          billMems.push({ ...foundMember, balance: newBalance });
        }
        localStorage.setItem('nhau_members', JSON.stringify(billMems));
        safeDbSet('nhau_members', JSON.stringify(billMems));

        let moneyLogs = JSON.parse(localStorage.getItem('nhau_money_logs')) || [];
        moneyLogs.unshift({
          id: 'log_' + Date.now(),
          type: 'deposit',
          amount: numAmount,
          memberId: foundMember.id,
          memberName: foundMember.name || foundMember.nickname,
          date: new Date().toLocaleDateString('vi-VN'),
          note: note,
          timestamp: Date.now()
        });
        localStorage.setItem('nhau_money_logs', JSON.stringify(moneyLogs));
        safeDbSet('nhau_money_logs', JSON.stringify(moneyLogs));
      } catch(e) {}

      window.dispatchEvent(new StorageEvent('storage', { key: 'sys_global_members', newValue: JSON.stringify(members) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_members' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'nhau_money_logs' }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch(e) {}
      });

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã nạp thành công ${formatMoney(numAmount)} cho ${foundMember.name}!`);
      }

      return {
        success: true,
        replyText: `🎉 **Đã nạp tiền thành công!**\n\n- **Thành viên:** ${foundMember.name} (${foundMember.fullName || ''})\n- **Số tiền nạp:** +${formatMoney(numAmount)}\n- **Số dư trước:** ${formatMoney(oldBalance)}\n- **Số dư hiện tại:** **${formatMoney(newBalance)}**\n- Đã ghi sổ nhật ký quỹ và đồng bộ tức thì lên Supabase Cloud!`,
        card: {
          type: 'DEPOSIT_SUCCESS',
          data: {
            member: foundMember.name,
            amount: numAmount,
            newBalance: newBalance
          }
        }
      };
    } catch(err) {
      return { success: false, replyText: `❌ Lỗi khi nạp tiền: ${err.message}`, card: null };
    }
  }

  window.aiExecutePendingAction = function (msgId) {
    const data = activeConfirmationData[msgId] || pendingActionToConfirm;
    if (!data) return;

    if (!isAdminMode()) {
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🚫 Bạn cần quyền Admin để thực thi thao tác này!', 'warning');
      }
      return;
    }

    let result = null;
    if (data.actionKey === 'RESET_CHIA_BILL') {
      result = executeResetChiaBill(data.params?.mode);
    } else if (data.actionKey === 'RESET_TIEN_COM') {
      result = executeResetAllDebts('Chốt chu kỳ thanh toán qua Kira');
    } else if (data.actionKey === 'RESET_BOTH') {
      const r1 = executeResetChiaBill();
      const r2 = executeResetAllDebts('Reset toàn hệ thống');
      result = {
        success: true,
        replyText: '🚀 **Đã reset thành công cả hai ứng dụng Chia Bill & Quỹ Nhóm và Tiền Cơm về 0đ!**',
        card: {
          type: 'RESET_CHIA_BILL_SUCCESS',
          data: { memberCount: 6 }
        }
      };
    } else if (data.actionKey === 'DELETE_CHIA_BILL') {
      result = executeDeleteChiaBill(data.params?.mealId);
    } else if (data.actionKey === 'DELETE_MEAL_LOG') {
      result = executeDeleteLatestMealLog();
    } else if (data.actionKey === 'SETTLE_CHIA_BILL') {
      result = executeSettleChiaBill(data.params?.memberName, data.params?.amount, data.params?.isDeposit);
    } else if (data.actionKey === 'DEPOSIT_MEMBER') {
      result = executeDepositMember(data.params?.memberName, data.params?.amount, data.params?.note);
    } else if (data.actionKey === 'SETTLE_DEBT') {
      result = executeSettleSingleDebt(data.params?.debtorName, data.params?.creditorName, data.params?.amount);
    } else if (data.actionKey === 'NOTE_COMPLETE') {
      result = executeNoteComplete(data.params?.keyword);
    } else if (data.actionKey === 'NOTE_DELETE') {
      result = executeDeleteNote(data.params?.keyword || 'all', true);
    } else if (data.actionKey === 'REMINDER_CREATE') {
      const p = data.params || {};
      saveReminderToSystem(p.task, p.timeStr, p.dateStr, p.displayFormatted);
      result = {
        success: true,
        replyText: `⏰ **Đã lưu lời nhắc thành công!**\n\n- Nội dung: **${p.task}**\n- Thời gian: **${p.displayFormatted || (p.timeStr + ' ' + p.dateStr)}**\n- Hệ thống sẽ kích hoạt thông báo khi tới giờ hẹn.`,
        card: { type: 'REMINDER', data: p }
      };
    } else if (data.actionKey === 'SAVE_MEMORY') {
      const p = data.params || {};
      if (p.content) {
        permanentMemories.unshift({
          id: 'mem_auto_' + Date.now(),
          category: p.category || 'user_preference',
          content: p.content,
          createdAt: new Date().toISOString()
        });
        saveAiPersonalMemory();
      }
      result = {
        success: true,
        replyText: `🧠 **Đã lưu vào Kho Ký Ức Dài Hạn thành công!**\n\n> "${p.content}"\n\n*Thông tin này đã được lưu vĩnh viễn và đồng bộ vào \`data/ai_memory/\`.*`,
        card: { type: 'MEMORY_SAVED', data: p }
      };
    }

    delete activeConfirmationData[msgId];
    pendingActionToConfirm = null;

    if (result) {
      const targetMsg = chatHistory.find(m => m.id === msgId || (m.card && m.card.type === 'ACTION_CONFIRM'));
      if (targetMsg) {
        targetMsg.text = result.replyText;
        targetMsg.card = result.card || null;
      } else {
        chatHistory.push({
          id: 'msg_' + Date.now(),
          role: 'assistant',
          text: result.replyText,
          card: result.card || null,
          time: getCurrentTimeStr()
        });
      }
      saveChatHistory();
      renderChatThread();
    }
  };

  window.aiCancelPendingAction = function (msgId) {
    delete activeConfirmationData[msgId];
    pendingActionToConfirm = null;

    const targetMsg = chatHistory.find(m => m.id === msgId || (m.card && (m.card.type === 'ACTION_CONFIRM' || m.card.type === 'APP_SELECTION_CONFIRM')));
    if (targetMsg) {
      targetMsg.text = '❌ **Đã hủy thao tác theo yêu cầu của bạn.** Dữ liệu hệ thống vẫn được giữ nguyên an toàn 100%!';
      targetMsg.card = null;
      saveChatHistory();
      renderChatThread();
    }
  };

  window.aiTriggerResetApp = function (msgId, targetApp) {
    if (targetApp === 'chia-bill') {
      const conf = requestActionConfirmation(
        'RESET_CHIA_BILL',
        { mode: 'keep_members_zero' },
        '🔄 Xác Nhận Khôi Phục & Reset Dữ Liệu Chia Bill',
        'Hệ thống sẽ làm sạch toàn bộ hóa đơn chi tiêu (nhau_meals), nhật ký quỹ (nhau_money_logs) và đưa số dư các thành viên về 0đ.',
        [
          'Ứng dụng: Chia Bill & Quỹ Nhóm (apps/chia-bill/)',
          'Tất cả hóa đơn tiệc / nhậu sẽ được xóa bỏ',
          'Số dư tất cả thành viên được cân bằng về 0đ',
          'Đồng bộ tức thì lên Supabase Cloud'
        ],
        true
      );
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.text = conf.replyText;
        targetMsg.card = conf.card;
        activeConfirmationData[msgId] = conf.card.data;
        pendingActionToConfirm = { msgId, ...conf.card.data };
        saveChatHistory();
        renderChatThread();
      }
    } else if (targetApp === 'tien-com') {
      const conf = requestActionConfirmation(
        'RESET_TIEN_COM',
        {},
        '🔄 Xác Nhận Reset Toàn Bộ Công Nợ Tiền Cơm về 0đ',
        'Hệ thống sẽ ghi nhận giao dịch tất toán công nợ và đưa số dư toàn bộ thành viên về 0đ.',
        [
          'Ứng dụng: Tính Tiền Cơm VietQR (apps/tien-com/)',
          'Tất toán toàn bộ các khoản nợ giữa các thành viên',
          'Đồng bộ tức thì lên Supabase Cloud'
        ],
        true
      );
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.text = conf.replyText;
        targetMsg.card = conf.card;
        activeConfirmationData[msgId] = conf.card.data;
        pendingActionToConfirm = { msgId, ...conf.card.data };
        saveChatHistory();
        renderChatThread();
      }
    } else if (targetApp === 'both') {
      const conf = requestActionConfirmation(
        'RESET_BOTH',
        {},
        '🧹 Xác Nhận Reset Cả Hai Ứng Dụng Về 0đ',
        'Hệ thống sẽ xóa sạch dữ liệu cả Tiền Cơm lẫn Chia Bill & Quỹ Nhóm về 0đ.',
        [
          'Ứng dụng: Chia Bill & Quỹ Nhóm VÀ Tiền Cơm',
          'Cân bằng toàn bộ nợ và quỹ về 0đ',
          'Đồng bộ tức thì lên Supabase Cloud'
        ],
        true
      );
      const targetMsg = chatHistory.find(m => m.id === msgId);
      if (targetMsg) {
        targetMsg.text = conf.replyText;
        targetMsg.card = conf.card;
        activeConfirmationData[msgId] = conf.card.data;
        pendingActionToConfirm = { msgId, ...conf.card.data };
        saveChatHistory();
        renderChatThread();
      }
    }
  };

  function executeResetAllDebts(reason = 'Chốt chu kỳ thanh toán qua Kira') {
    if (!isAdminMode()) {
      return {
        success: false,
        isPermissionDenied: true,
        replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể reset công nợ hệ thống.\n\nVui lòng nhấp vào biểu tượng **👁️** ở thanh tiêu đề cửa sổ Kira để đăng nhập Quản trị viên (Admin) nhé!`,
        card: {
          type: 'PERMISSION_DENIED',
          data: {
            title: 'Cần quyền Quản trị viên',
            message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền reset hoặc xóa công nợ.'
          }
        }
      };
    }

    const snapshot = getCurrentSystemSnapshot();
    const outstandingDebts = snapshot.outstandingDebts;

    if (!outstandingDebts || outstandingDebts.length === 0) {
      return {
        success: true,
        hasDebts: false,
        replyText: `✨ **Số dư Tiền Cơm hiện tại đã sạch sẽ (0đ)!**\n\nKhông có thành viên nào đang nợ tiền cơm trong hệ thống. Tất cả các khoản nợ đã hoàn tất thanh toán từ trước rồi nha anh!`,
        card: {
          type: 'RESET_SUCCESS',
          data: {
            clearedCount: 0,
            totalAmount: 0,
            details: [],
            message: 'Hệ thống đã ở trạng thái 0đ, không có khoản nợ nào cần thanh toán.'
          }
        }
      };
    }

    // Sao lưu logs trước khi reset để có thể Hoàn tác (Undo)
    let logs = [...snapshot.logs];
    window._lastP2pLogsBackup = JSON.stringify(logs);

    // Tạo các bản ghi Trả Tiền thanh toán dứt điểm toàn bộ nợ
    const todayStr = new Date().toISOString().split('T')[0];
    const newSettlementLogs = [];
    const detailsList = [];
    let totalResetAmount = 0;

    outstandingDebts.forEach((debt, idx) => {
      const logId = String(Date.now() + idx);
      const desc = `${debt.debtorName} đã thanh toán chuyển khoản ${formatMoney(debt.amount)} về ${debt.creditorName} (${reason})`;
      const sLog = {
        id: logId,
        dateStr: todayStr,
        type: 'Trả Tiền',
        description: desc,
        payerId: debt.debtorId,
        payerName: debt.debtorName,
        receiverId: debt.creditorId,
        receiverName: debt.creditorName,
        amount: debt.amount,
        autoSettledByAi: true
      };
      newSettlementLogs.push(sLog);
      detailsList.push({
        debtor: debt.debtorName,
        creditor: debt.creditorName,
        amount: debt.amount
      });
      totalResetAmount += debt.amount;
    });

    logs = [...newSettlementLogs, ...logs];

    safeDbSet('p2p_logs', JSON.stringify(logs));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'p2p_logs',
      newValue: JSON.stringify(logs)
    }));

    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({
          type: 'P2P_LOGS_UPDATED',
          logs: logs,
          action: 'RESET_DEBTS'
        }, '*');
      } catch (e) {}
    });

    if (typeof window.showToast === 'function') {
      window.showToast(`🔄 Đã reset công nợ Tiền Cơm về 0đ cho ${outstandingDebts.length} thành viên!`);
    }

    const detailLines = detailsList.map(d => `• **${d.debtor}** ➔ **${d.creditor}**: ${formatMoney(d.amount)}`).join('\n');

    return {
      success: true,
      hasDebts: true,
      totalAmount: totalResetAmount,
      count: outstandingDebts.length,
      replyText: `🚀 **Đã thực hiện reset toàn bộ số dư và công nợ Tiền Cơm về 0đ thành công!**\n\n${detailLines}\n\n**Tổng tiền đã tất toán:** ${formatMoney(totalResetAmount)} cho **${outstandingDebts.length} thành viên**.\nToàn bộ dữ liệu sổ sách đã đồng bộ sạch sẽ tức thì lên Supabase và giao diện Tiền Cơm!`,
      card: {
        type: 'RESET_SUCCESS',
        data: {
          clearedCount: outstandingDebts.length,
          totalAmount: totalResetAmount,
          details: detailsList,
          canUndo: true
        }
      }
    };
  }

  function aiUndoLastResetDebts() {
    if (!window._lastP2pLogsBackup) {
      if (typeof window.showToast === 'function') window.showToast('Không có dữ liệu hoàn tác!');
      return;
    }
    const oldLogs = JSON.parse(window._lastP2pLogsBackup);
    safeDbSet('p2p_logs', JSON.stringify(oldLogs));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'p2p_logs',
      newValue: JSON.stringify(oldLogs)
    }));
    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({
          type: 'P2P_LOGS_UPDATED',
          logs: oldLogs,
          action: 'UNDO_RESET'
        }, '*');
      } catch (e) {}
    });
    window._lastP2pLogsBackup = null;
    if (typeof window.showToast === 'function') {
      window.showToast('↩️ Đã hoàn tác lại công nợ ban đầu!');
    }
    chatHistory.push({
      id: 'msg_' + Date.now(),
      role: 'assistant',
      text: '↩️ **Đã hoàn tác khôi phục lại công nợ ban đầu của các thành viên thành công!** Số dư đã quay trở về trạng thái trước đó.',
      time: getCurrentTimeStr()
    });
    saveChatHistory();
    renderChatThread();
  };

  function executeSettleSingleDebt(debtorName, creditorName = null, inputAmount = null) {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể sửa dữ liệu ở Chế độ xem.' } }
      };
    }

    let p2pMembers = [];
    try { p2pMembers = JSON.parse(localStorage.getItem('p2p_members')) || []; } catch(e) {}
    if (!p2pMembers.length) p2pMembers = getSystemMembers();

    let logs = [];
    try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch(e) {}

    const debtor = p2pMembers.find(m =>
      (m.nickname && m.nickname.toLowerCase().includes(debtorName.toLowerCase())) ||
      (m.name && m.name.toLowerCase().includes(debtorName.toLowerCase())) ||
      (m.fullName && m.fullName.toLowerCase().includes(debtorName.toLowerCase()))
    );

    if (!debtor) {
      return {
        replyText: `❌ Không tìm thấy thành viên **${debtorName}** trong danh sách hệ thống.`,
        card: null
      };
    }

    let creditor = null;
    if (creditorName) {
      creditor = p2pMembers.find(m =>
        (m.nickname && m.nickname.toLowerCase().includes(creditorName.toLowerCase())) ||
        (m.name && m.name.toLowerCase().includes(creditorName.toLowerCase())) ||
        (m.fullName && m.fullName.toLowerCase().includes(creditorName.toLowerCase()))
      );
    }
    if (!creditor) {
      creditor = p2pMembers[0] || { id: 'admin', name: 'Công Đẹp Trai' };
    }

    const dName = debtor.nickname || debtor.name;
    const cName = creditor.nickname || creditor.name;

    // Tính nợ thực tế nếu không truyền amount
    let payAmount = inputAmount;
    if (!payAmount) {
      const snap = getCurrentSystemSnapshot();
      const matchDebt = snap.outstandingDebts.find(d => String(d.debtorId) === String(debtor.id));
      payAmount = matchDebt ? matchDebt.amount : 0;
    }
    if (payAmount <= 0) {
      return {
        replyText: `✨ **${dName}** hiện tại không có khoản nợ nào cần thanh toán!`,
        card: null
      };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const newLog = {
      id: Date.now().toString(),
      dateStr: todayStr,
      type: 'Trả Tiền',
      description: `${dName} đã thanh toán chuyển khoản ${formatMoney(payAmount)} về ${cName} (Qua Kira)`,
      payerId: debtor.id,
      payerName: dName,
      receiverId: creditor.id,
      receiverName: cName,
      amount: payAmount
    };

    logs.unshift(newLog);
    safeDbSet('p2p_logs', JSON.stringify(logs));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'p2p_logs',
      newValue: JSON.stringify(logs)
    }));

    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({ type: 'P2P_LOGS_UPDATED', logs }, '*');
      } catch(e) {}
    });

    return {
      replyText: `✅ **Đã ghi nhận thanh toán thành công!**\n\n**${dName}** đã thanh toán **${formatMoney(payAmount)}** cho **${cName}**.\nSố dư công nợ của **${dName}** đã được trừ và cập nhật trực tiếp lên ứng dụng Tiền Cơm!`,
      card: {
        type: 'SETTLE_SUCCESS',
        data: {
          payerName: dName,
          receiverName: cName,
          totalAmount: payAmount
        }
      }
    };
  }

  function executeDeleteLatestMealLog() {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể xóa giao dịch ở Chế độ xem.' } }
      };
    }

    let logs = [];
    try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch(e) {}

    if (logs.length === 0) {
      return {
        replyText: 'Hiện tại trong hệ thống chưa có giao dịch Tiền Cơm nào để xóa.',
        card: null
      };
    }

    const removed = logs.shift();
    safeDbSet('p2p_logs', JSON.stringify(logs));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'p2p_logs',
      newValue: JSON.stringify(logs)
    }));

    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({ type: 'P2P_LOGS_UPDATED', logs }, '*');
      } catch(e) {}
    });

    return {
      replyText: `🗑️ **Đã xóa giao dịch gần nhất thành công:**\n> "${removed.description || removed.type}" (${formatMoney(removed.amount || 0)})\n\nCác khoản công nợ trong Tiền Cơm đã được tự động tính toán lại!`,
      card: null
    };
  }

  function executeNoteComplete(keyword) {
    if (!isAdminMode()) {
      return {
        replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để hoàn thành ghi chú.',
        card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể sửa ghi chú ở Chế độ xem.' } }
      };
    }

    let notes = [];
    try { notes = JSON.parse(localStorage.getItem('sticky_notes_data')) || []; } catch(e) {}

    const targetNote = notes.find(n => (n.text || n.title || '').toLowerCase().includes(keyword.toLowerCase()));
    if (!targetNote) {
      return {
        replyText: `Không tìm thấy ghi chú nào khớp với từ khóa "${keyword}".`,
        card: null
      };
    }

    targetNote.isDone = true;
    targetNote.completed = true;
    safeDbSet('sticky_notes_data', JSON.stringify(notes));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'sticky_notes_data',
      newValue: JSON.stringify(notes)
    }));

    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({ type: 'NOTE_DATA_UPDATED' }, '*');
      } catch(e) {}
    });

    return {
      replyText: `✅ Đã đánh dấu hoàn thành ghi chú: **"${targetNote.text || targetNote.title}"**!`,
      card: null
    };
  }

  function executeCloseApp(appId) {
    if (typeof window.closeApp === 'function') {
      window.closeApp(appId);
      return {
        replyText: `Đã đóng cửa sổ ứng dụng **${appId}**!`,
        card: null
      };
    }
    return {
      replyText: `Đã đóng ứng dụng **${appId}**!`,
      card: null
    };
  }

  // --------------------------------------------------------------------------
  // 5. BỘ TRÍ TUỆ NHÂN TẠO OFFLINE (FALLBACK KHI KHÔNG CÓ API KEY HOẶC MẤT MẠNG)
  // --------------------------------------------------------------------------
  function processOfflineConversation(userText) {
    const raw = userText.trim();
    const lower = raw.toLowerCase();
    const norm = normalizeVietnamese(lower);
    const members = getSystemMembers();
    const today = new Date().toISOString().split('T')[0];

    // 0.0 Can thiệp sâu: Reset & Khôi phục dữ liệu hệ thống (BẮT BUỘC HỎI XÁC NHẬN TRƯỚC KHI THỰC HIỆN)
    if (
      norm.includes('reset') ||
      norm.includes('ve 0') ||
      norm.includes('xoa no') ||
      norm.includes('chot so') ||
      norm.includes('tat toan') ||
      norm.includes('nhap lai tu dau') ||
      norm.includes('du lieu test') ||
      (norm.includes('thanh toan') && (norm.includes('tat ca') || norm.includes('het') || norm.includes('ve 0')))
    ) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể can thiệp reset hệ thống.\n\nVui lòng đăng nhập Quản trị viên (Admin) để thực hiện nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền reset hoặc xóa dữ liệu.'
            }
          }
        };
      }

      // Xác định ngữ cảnh ứng dụng người dùng đang muốn can thiệp
      const isChiaBillContext = norm.includes('chia bill') || norm.includes('bill') || norm.includes('quy') || norm.includes('nhau') || norm.includes('quan') || norm.includes('tiec');
      const isTienComContext = norm.includes('tien com') || norm.includes('com') || norm.includes('bua an') || norm.includes('suat com') || norm.includes('p2p');
      
      const isChiaBillOpen = Boolean(document.querySelector('iframe[src*="chia-bill"]'));
      const isTienComOpen = Boolean(document.querySelector('iframe[src*="tien-com"]'));

      if (isChiaBillContext || (isChiaBillOpen && !isTienComOpen && !isTienComContext)) {
        let meals = [];
        try { meals = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}
        let mems = [];
        try { mems = JSON.parse(localStorage.getItem('nhau_members')) || []; } catch(e) {}
        return requestActionConfirmation(
          'RESET_CHIA_BILL',
          { mode: 'keep_members_zero' },
          '🔄 Xác Nhận Khôi Phục & Reset Dữ Liệu Chia Bill',
          'Hệ thống sẽ làm sạch toàn bộ hóa đơn chi tiêu (nhau_meals), nhật ký quỹ (nhau_money_logs) và đưa số dư các thành viên về 0đ.',
          [
            'Ứng dụng: Chia Bill & Quỹ Nhóm (apps/chia-bill/)',
            `Xóa toàn bộ ${meals.length} hóa đơn tiệc / nhậu`,
            `Cân bằng số dư của ${mems.length || 6} thành viên về 0đ`,
            'Đồng bộ tức thì lên Supabase Cloud'
          ],
          true
        );
      } else if (isTienComContext || (isTienComOpen && !isChiaBillOpen && !isChiaBillContext)) {
        const snap = getCurrentSystemSnapshot();
        return requestActionConfirmation(
          'RESET_TIEN_COM',
          {},
          '🔄 Xác Nhận Reset Toàn Bộ Công Nợ Tiền Cơm về 0đ',
          'Hệ thống sẽ ghi nhận giao dịch tất toán công nợ và đưa số dư toàn bộ thành viên về 0đ.',
          [
            'Ứng dụng: Tính Tiền Cơm VietQR (apps/tien-com/)',
            `Tất toán công nợ giữa ${snap.outstandingDebts.length} thành viên`,
            `Tổng tiền thanh toán chu kỳ: ${formatMoney(snap.totalDebtSum)}`,
            'Đồng bộ tức thì lên Supabase Cloud'
          ],
          true
        );
      } else {
        // Không rõ ràng ứng dụng nào -> Cho người dùng chọn trên thẻ tương tác
        return {
          replyText: '⚙️ **Anh muốn khôi phục & reset dữ liệu của ứng dụng nào?**\n\nĐể đảm bảo an toàn dữ liệu, vui lòng chọn ứng dụng anh muốn làm sạch bên dưới:',
          card: {
            type: 'APP_SELECTION_CONFIRM',
            data: {}
          }
        };
      }
    }

    // 0.01 Can thiệp sâu: Xóa Hóa đơn Chia Bill (BẮT BUỘC HỎI XÁC NHẬN)
    if (norm.includes('xoa bill') || norm.includes('xoa hoa don') || norm.includes('huy bill')) {
      if (!isAdminMode()) {
        return {
          replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để xóa hóa đơn.',
          card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể xóa hóa đơn ở Chế độ xem.' } }
        };
      }
      let meals = [];
      try { meals = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}
      if (meals.length === 0) {
        return { replyText: 'Hiện tại trong ứng dụng Chia Bill chưa có hóa đơn nào để xóa.', card: null };
      }
      const latestMeal = meals[meals.length - 1];
      return requestActionConfirmation(
        'DELETE_CHIA_BILL',
        { mealId: latestMeal.id },
        '🗑️ Xác Nhận Xóa Hóa Đơn Chia Bill',
        `Hệ thống sẽ xóa hóa đơn "${latestMeal.title}" (${formatMoney(latestMeal.totalCost || 0)}) và hoàn tác số dư cho các thành viên.`,
        [
          `Hóa đơn: ${latestMeal.title} - Ngày: ${latestMeal.date || ''}`,
          `Tổng tiền: ${formatMoney(latestMeal.totalCost || 0)}`,
          `Số người tham gia: ${(latestMeal.participants || []).length} người`
        ],
        true
      );
    }

    // 0.015 Can thiệp sâu: Nạp tiền cho thành viên (Ví dụ: "Nạp 200k cho Đô", "Nạp 100k quỹ cho Hạnh")
    const depositMatchRegex = norm.match(/(?:nap|chuyen|cong)\s+(\d+k|\d+[\d.,]*\s*(?:d|k|vnd|nghin|dong)?)\s+(?:cho|vao vi|vao quy|vao tai khoan cho)\s+([a-z0-9\s]+)/i) ||
                              norm.match(/(?:nap|chuyen|cong)\s+(?:cho|vao vi|vao quy cho)\s+([a-z0-9\s]+)\s+(\d+k|\d+[\d.,]*\s*(?:d|k|vnd|nghin|dong)?)/i);
    if (depositMatchRegex) {
      let rawAmount = '';
      let targetName = '';
      if (depositMatchRegex[1] && depositMatchRegex[2]) {
        if (/^\d/.test(depositMatchRegex[1])) {
          rawAmount = depositMatchRegex[1];
          targetName = depositMatchRegex[2].trim();
        } else {
          targetName = depositMatchRegex[1].trim();
          rawAmount = depositMatchRegex[2];
        }
      }
      let parsedAmount = parseAmount(rawAmount);
      if (parsedAmount > 0 && targetName) {
        if (!isAdminMode()) {
          return {
            replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để thực hiện nạp tiền.',
            card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể nạp tiền ở Chế độ xem.' } }
          };
        }
        return requestActionConfirmation(
          'DEPOSIT_MEMBER',
          { memberName: targetName, amount: parsedAmount, note: `Nạp tiền qua AI Assistant (${raw})` },
          '💵 Xác Nhận Nạp Tiền Vào Số Dư Thành Viên',
          `Hệ thống sẽ cộng thêm ${formatMoney(parsedAmount)} vào số dư của ${targetName} và ghi nhận vào sổ thu chi quỹ.`,
          [
            `Thành viên: ${targetName}`,
            `Số tiền nạp: +${formatMoney(parsedAmount)}`,
            'Đồng bộ tức thì lên Supabase Cloud'
          ],
          false
        );
      }
    }

    // 0.02 Can thiệp sâu: Tra cứu công nợ & số dư thực tế
    if (
      norm.includes('ai no') ||
      norm.includes('xem no') ||
      norm.includes('cong no') ||
      norm.includes('doi soat') ||
      norm.includes('so du') ||
      norm.includes('tinh hinh no')
    ) {
      const snap = getCurrentSystemSnapshot();
      if (!snap.debtLines || snap.debtLines.length === 0) {
        return {
          replyText: `✨ **Hiện tại không có ai đang nợ tiền cơm!**\nTất cả ${snap.members.length} thành viên đều có số dư 0đ (đã hoàn tất).`,
          card: null
        };
      }
      const debtDetails = snap.debtLines.map(d => `• **${d}**`).join('\n');
      return {
        replyText: `📊 **Báo cáo tình hình công nợ Tiền Cơm hiện tại:**\n\n${debtDetails}\n\n👉 **Tổng nợ tồn đọng:** **${formatMoney(snap.totalDebtSum)}**\n*Bạn có thể ra lệnh "reset công nợ về 0" để tất toán chu kỳ này.*`,
        card: null
      };
    }

    // 0.03 Can thiệp sâu: Xóa giao dịch / log bữa ăn Tiền Cơm (BẮT BUỘC HỎI XÁC NHẬN)
    if (norm.includes('xoa giao dich') || norm.includes('xoa log') || norm.includes('xoa bua com') || norm.includes('huy bua com')) {
      if (!isAdminMode()) {
        return {
          replyText: '🔒 Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Admin để xóa giao dịch.',
          card: { type: 'PERMISSION_DENIED', data: { title: 'Cần quyền Admin', message: 'Không thể xóa giao dịch ở Chế độ xem.' } }
        };
      }
      let logs = [];
      try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch(e) {}
      if (logs.length === 0) {
        return { replyText: 'Hiện tại chưa có giao dịch Tiền Cơm nào để xóa.', card: null };
      }
      const latestLog = logs[0];
      return requestActionConfirmation(
        'DELETE_MEAL_LOG',
        {},
        '🗑️ Xác Nhận Xóa Giao Dịch Tiền Cơm Gần Nhất',
        `Hệ thống sẽ xóa giao dịch gần nhất: "${latestLog.description || latestLog.type}" (${formatMoney(latestLog.amount || 0)}).`,
        [
          `Giao dịch: ${latestLog.description || latestLog.type}`,
          `Số tiền: ${formatMoney(latestLog.amount || 0)}`,
          `Công nợ các thành viên sẽ được tính toán lại`
        ],
        true
      );
    }

    // 0.03 Can thiệp sâu: Đóng ứng dụng
    if (norm.startsWith('dong app') || norm.startsWith('tat app') || norm.startsWith('dong ung dung') || norm.includes('dong tien com')) {
      let appId = 'tien-com';
      if (norm.includes('chia bill')) appId = 'chia-bill';
      else if (norm.includes('ghi chu')) appId = 'ghi-chu';
      else if (norm.includes('danh ba')) appId = 'danh-ba';
      return executeCloseApp(appId);
    }

    // 0.1 Nhận diện câu hỏi về danh tính, thông tin cá nhân & ký ức dài hạn
    if (
      norm.includes('toi la ai') ||
      norm.includes('toi ten la gi') ||
      norm.includes('ban nho gi ve toi') ||
      norm.includes('nho gi ve toi') ||
      norm.includes('thong tin cua toi') ||
      norm.includes('ky uc cua toi') ||
      norm.includes('bo nho cua ban') ||
      norm.includes('biet gi ve toi')
    ) {
      const memList = permanentMemories.slice(0, 8).map((m, i) => `${i + 1}. ${m.content}`).join('\n');
      return {
        replyText: `👋 Tôi nhớ rất rõ về bạn!\n\n- **Họ và tên:** ${userProfile.name}\n- **Vai trò:** ${userProfile.role}\n- **Môi trường:** ${userProfile.work_context}\n\n🧠 **Kho ký ức dài hạn (${permanentMemories.length} mục) đang lưu trữ:**\n${memList || 'Chưa có thông tin bổ sung.'}\n\n*Dù bạn có bấm nút "Xóa chat", toàn bộ ký ức và dữ liệu huấn luyện cá nhân hóa này vẫn luôn được bảo lưu vĩnh viễn!*`,
        card: null
      };
    }

    // 0.2 Nhận diện câu lệnh yêu cầu AI tự ghi nhớ / lưu thông tin vào bộ nhớ
    const isSaveMemoryCmd = 
      norm.startsWith('nho ') ||
      norm.startsWith('nho:') ||
      norm.startsWith('hay nho') ||
      norm.startsWith('luu vao bo nho') ||
      norm.startsWith('ghi nho') ||
      norm.startsWith('luu thong tin') ||
      norm.includes('nho giup') ||
      norm.includes('ghi nho giup') ||
      norm.includes('luu vao tri nho') ||
      norm.includes('tu nay nho') ||
      norm.includes('sau nay nho');

    if (isSaveMemoryCmd) {
      let contentToSave = raw
        .replace(/^(?:hãy\s+)?(?:nhớ|lưu vào bộ nhớ|ghi nhớ|lưu thông tin|lưu giúp tôi|nhớ giúp tôi|từ nay nhớ|sau này nhớ)(?:\s+là|\s+rằng|\s*:)?\s*/i, '')
        .trim();

      if (!contentToSave || contentToSave.length < 3) {
        contentToSave = raw;
      }

      return requestActionConfirmation(
        'SAVE_MEMORY',
        { category: 'user_preference', content: contentToSave },
        '🧠 Xác Nhận Ghi Nhớ Vào Kho Ký Ức Dài Hạn',
        `AI muốn lưu thông tin này vào Kho Ký Ức Dài Hạn (\`data/ai_memory/\`):`,
        [
          `Phân loại: Quy tắc & Thông tin người dùng`,
          `Nội dung: "${contentToSave}"`
        ],
        false
      );
    }

    // 0. Nhận diện câu hỏi về chế độ xem / admin / quyền hạn
    if (
      norm.includes('che do gi') ||
      norm.includes('chế độ gì') ||
      norm.includes('admin hay xem') ||
      norm.includes('xem hay admin') ||
      norm.includes('quyen gi') ||
      norm.includes('quyen han') ||
      norm.includes('dang o che do') ||
      norm.includes('toan quyen') ||
      norm.includes('chi doc')
    ) {
      const admin = isAdminMode();
      return {
        replyText: admin
          ? `🔑 **Hiện tại bạn đang ở Quản trị viên (Admin Mode)**.\n\nBạn có toàn quyền thêm, sửa, xóa dữ liệu trên toàn bộ hệ thống (Tiền Cơm, Chia Bill, Ghi Chú, Danh Bạ). AI đã sẵn sàng hỗ trợ các lệnh nhập liệu của bạn!`
          : `👁️ **Hiện tại bạn đang ở Chế độ xem (Chỉ đọc / View-Only)**.\n\nỞ chế độ này, bạn chỉ có thể tra cứu số dư, xem danh sách nợ, sinh nhật hoặc hỏi đáp thông thường. Bạn **không được phép thêm, sửa hoặc xóa dữ liệu**.\n\n👉 Để thực hiện ghi dữ liệu, vui lòng nhấp vào biểu tượng **"👁️ Chế độ xem"** trên thanh Menu trên cùng màn hình (hoặc nút Chế độ xem ở góc cửa sổ AI) để đăng nhập Quản trị viên (Admin) nhé!`,
        card: null
      };
    }

    // Nhắc nhở
    const reminderData = parseReminderOffline(raw);
    if (reminderData) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể đặt lịch nhắc nhở vào hệ thống.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Admin để đặt nhắc nhở.'
            }
          }
        };
      }
      return requestActionConfirmation(
        'REMINDER_CREATE',
        reminderData,
        '⏰ Xác Nhận Đặt Nhắc Nhở',
        `Hệ thống sẽ lưu lịch nhắc: "${reminderData.task}" vào lúc ${reminderData.displayFormatted}.`,
        [
          `Nội dung: ${reminderData.task}`,
          `Thời gian: ${reminderData.displayFormatted}`
        ],
        false
      );
    }

    // Tiền cơm
    const isMealRelated = norm.includes('tien com') || norm.includes('bua com') || norm.includes('an trua') || norm.includes('an toi') || (norm.includes('com') && (norm.includes('tra') || norm.includes('chi')));
    const isPaymentAction = norm.includes('tra') || norm.includes('chi') || norm.includes('bao') || norm.includes('ung') || norm.includes('thanh toan');

    if (isMealRelated && isPaymentAction) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể ghi nhận khoản tiền cơm này vào hệ thống.\n\nVui lòng nhấp vào nút **"👁️ Chế độ xem"** trên thanh Menu trên cùng để đăng nhập Quản trị viên (Admin) nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền ghi nhận tiền cơm.'
            }
          }
        };
      }

      let matchedPayer = null;
      for (const m of members) {
        const mNickNorm = normalizeVietnamese(m.nickname || m.name);
        const mNameNorm = normalizeVietnamese(m.name);
        const mFullNorm = normalizeVietnamese(m.fullName || '');

        if (norm.includes(mNickNorm) || norm.includes(mNameNorm) || (mFullNorm && norm.includes(mFullNorm))) {
          matchedPayer = m;
          break;
        }
      }

      let amount = 0;
      const matchK = raw.match(/(\d+[\.,]?\d*)\s*(k|nghìn|ngàn|đ|vnd)/i);
      const matchPlainNumber = raw.match(/(?:mỗi người|mỗi đứa|mỗi suất|giá|tiền)?\s*(\d{2,3})(?:\s|$)/);

      if (matchK) {
        let num = parseFloat(matchK[1].replace(',', '.'));
        const unit = matchK[2].toLowerCase();
        if (unit === 'k' || unit === 'nghìn' || unit === 'ngàn') {
          amount = num * 1000;
        } else {
          amount = num;
        }
      } else if (matchPlainNumber) {
        let num = parseFloat(matchPlainNumber[1]);
        if (num < 1000) amount = num * 1000;
        else amount = num;
      } else {
        amount = 40000;
      }

      const payerName = matchedPayer ? (matchedPayer.nickname || matchedPayer.name) : 'Công';
      const eaters = members.map(m => m.nickname || m.name);

      return {
        replyText: `Tôi đã soạn sẵn phiếu ghi nhận tiền cơm cho **${payerName}** với mức **${formatMoney(amount)}/người**.\nBạn vui lòng kiểm tra lại thông tin bên dưới và bấm nút **Xác nhận & Nhập ngay** nhé!`,
        card: {
          type: 'MEAL_CONFIRM',
          data: {
            payerName,
            amountPerPerson: amount,
            eaters,
            date: today,
            note: `${payerName} thanh toán tiền cơm`
          }
        }
      };
    }

    // 1. Chia Bill / Tiền ăn nhậu / Liên hoan / Tiệc tùng
    const isBillRelated = norm.includes('chia bill') || norm.includes('tien nhau') || norm.includes('an nhau') || norm.includes('tien bia') || norm.includes('tien karaoke') || norm.includes('di nhau') || norm.includes('bill nhau');
    if (isBillRelated) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể tạo hóa đơn chia bill.\n\nVui lòng nhấp vào nút **"👁️ Chế độ xem"** trên thanh Menu trên cùng để đăng nhập Quản trị viên (Admin) nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền tạo bill chia tiền.'
            }
          }
        };
      }

      let matchedPayer = null;
      for (const m of members) {
        const mNickNorm = normalizeVietnamese(m.nickname || m.name);
        const mNameNorm = normalizeVietnamese(m.name);
        const mFullNorm = normalizeVietnamese(m.fullName || '');

        if (norm.includes(mNickNorm) || norm.includes(mNameNorm) || (mFullNorm && norm.includes(mFullNorm))) {
          matchedPayer = m;
          break;
        }
      }

      let totalAmount = 0;
      const matchK = raw.match(/(\d+[\.,]?\d*)\s*(k|nghìn|ngàn|triệu|tr|đ|vnd)/i);
      const matchPlainNumber = raw.match(/(\d{3,9})/);

      if (matchK) {
        let num = parseFloat(matchK[1].replace(',', '.'));
        const unit = matchK[2].toLowerCase();
        if (unit === 'k' || unit === 'nghìn' || unit === 'ngàn') {
          totalAmount = num * 1000;
        } else if (unit === 'triệu' || unit === 'tr') {
          totalAmount = num * 1000000;
        } else {
          totalAmount = num;
        }
      } else if (matchPlainNumber) {
        let num = parseFloat(matchPlainNumber[1]);
        if (num < 1000) totalAmount = num * 1000;
        else totalAmount = num;
      } else {
        totalAmount = 600000;
      }

      let participants = [];
      members.forEach(m => {
        const mNickNorm = normalizeVietnamese(m.nickname || m.name);
        const mNameNorm = normalizeVietnamese(m.name);
        if (norm.includes(mNickNorm) || norm.includes(mNameNorm)) {
          participants.push(m.nickname || m.name);
        }
      });
      if (participants.length === 0) {
        participants = members.map(m => m.nickname || m.name);
      }

      const payerName = matchedPayer ? (matchedPayer.nickname || matchedPayer.name) : (participants[0] || 'Công');
      if (!participants.includes(payerName)) {
        participants.unshift(payerName);
      }

      let title = 'Tiền ăn nhậu / liên hoan';
      if (norm.includes('karaoke')) title = 'Hát Karaoke';
      else if (norm.includes('an trua')) title = 'Ăn trưa liên hoan';
      else if (norm.includes('uong bia') || norm.includes('tien bia')) title = 'Uống bia / nhậu';

      return {
        replyText: `Tôi đã soạn phiếu **Chia Bill** cho bữa **"${title}"** tổng cộng **${formatMoney(totalAmount)}** do **${payerName}** thanh toán.\nBạn vui lòng kiểm tra lại danh sách thành viên chia bên dưới và bấm nút **Xác nhận & Nhập ngay** nhé!`,
        card: {
          type: 'BILL_CONFIRM',
          data: {
            title,
            payerName,
            totalAmount,
            participants,
            date: today,
            note: `${payerName} thanh toán`
          }
        }
      };
    }

    // 2. Ghi Chú / Sticky Notes / Danh sách việc cần làm (Todo)
    const isNoteRelated = (norm.includes('ghi chu') || norm.includes('note') || norm.includes('sticky') || norm.includes('viec can lam') || norm.includes('tao todo') || norm.includes('nhac viec')) && !norm.includes('nhac toi') && !norm.includes('hen gio');
    if (isNoteRelated) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể thêm ghi chú mới vào Sticky Notes.\n\nVui lòng nhấp vào nút **"👁️ Chế độ xem"** trên thanh Menu trên cùng để đăng nhập Quản trị viên (Admin) nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền tạo ghi chú.'
            }
          }
        };
      }

      let noteText = raw
        .replace(/^(hãy |vui lòng |ai |trợ lý )?(ghi chú|tạo ghi chú|thêm ghi chú|note lại|lưu ghi chú|việc cần làm|sticky note)\s*:?\s*/i, '')
        .trim();

      if (!noteText) noteText = raw;

      let deadline = '';
      if (norm.includes('ngay mai') || norm.includes('mai')) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        deadline = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T17:00`;
      } else if (norm.includes('hom nay') || norm.includes('nay')) {
        deadline = `${today}T17:00`;
      }

      return {
        replyText: `Tôi đã soạn xong mẫu ghi chú: 📝 **"${noteText}"**.\nBạn vui lòng kiểm tra thông tin và bấm nút **Lưu Ghi Chú** để tự động cập nhật vào ứng dụng Sticky Notes nhé!`,
        card: {
          type: 'NOTE_CONFIRM',
          data: {
            text: noteText,
            deadline: deadline,
            noteType: 'todo'
          }
        }
      };
    }

    // 3. Danh Bạ / Thêm liên hệ / Số điện thoại / STK Ngân Hàng
    const isContactRelated = norm.includes('them vao danh ba') || norm.includes('them danh ba') || norm.includes('them lien he') || norm.includes('them thanh vien') || norm.includes('tao danh ba') || (norm.includes('danh ba') && (norm.includes('sdt') || norm.includes('so dien thoai') || norm.includes('stk')));
    if (isContactRelated) {
      if (!isAdminMode()) {
        return {
          replyText: `🔒 **Từ chối thao tác:** Bạn hiện đang ở **Chế độ xem (Chỉ đọc)** nên không thể thêm liên hệ mới vào Danh Bạ.\n\nVui lòng nhấp vào nút **"👁️ Chế độ xem"** trên thanh Menu trên cùng để đăng nhập Quản trị viên (Admin) nhé!`,
          card: {
            type: 'PERMISSION_DENIED',
            data: {
              title: 'Cần quyền Quản trị viên',
              message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền thêm liên hệ danh bạ.'
            }
          }
        };
      }
      let phoneMatch = raw.match(/(?:0\d{9,10}|\+84\d{9,10})/);
      let phone = phoneMatch ? phoneMatch[0] : '';

      let stkMatch = raw.match(/(?:stk|so tai khoan|tai khoan|tk|stk:?)\s*([0-9A-Z]{6,19})/i);
      let accountNo = stkMatch ? stkMatch[1] : (phone.length >= 9 ? phone : '');

      let bankMatch = raw.match(/(vcb|vietcombank|mbbank|mb|techcombank|tcb|vpbank|bidv|acb|tpbank|vietinbank|vpb)/i);
      let bankId = bankMatch ? bankMatch[0].toUpperCase() : 'MBBank';

      let nameMatch = raw.match(/(?:cho|bạn|anh|chị|em|thành viên|tên là|tên)\s+([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸa-zàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ\s]{2,20})/i);
      let fullName = nameMatch ? nameMatch[1].trim() : 'Thành viên mới';
      fullName = fullName.replace(/\b(sđt|sdt|số|stk|ngân hàng|mb|vcb)\b.*/i, '').trim();

      return {
        replyText: `Tôi đã lập thông tin liên hệ mới cho **${fullName}**.\nBạn vui lòng kiểm tra lại thông tin bên dưới và bấm nút **Thêm Vào Danh Bạ** nhé!`,
        card: {
          type: 'CONTACT_CONFIRM',
          data: {
            fullName,
            nickname: fullName.split(' ').pop() || fullName,
            phone,
            bankId,
            accountNo,
            accountName: fullName.toUpperCase(),
            dob: '',
            role: 'Thêm qua Trợ lý AI'
          }
        }
      };
    }

    // Công nợ
    if (norm.includes('no tien') || norm.includes('no com') || norm.includes('ai no') || norm.includes('du tien') || norm.includes('am tien')) {
      return {
        replyText: `Dưới đây là tình hình đối soát công nợ tiền cơm hiện tại của các thành viên trong văn phòng:`,
        card: { type: 'DEBTS' }
      };
    }

    // Sinh nhật
    if (norm.includes('sinh nhat') || norm.includes('sn') || norm.includes('birthday')) {
      return {
        replyText: `Dưới đây là danh sách sinh nhật các thành viên trong tháng này. Hãy gửi lời chúc ấm áp nhé! 🎂`,
        card: { type: 'BIRTHDAYS' }
      };
    }

    // Mở app
    if (norm.includes('mo tien com') || norm.includes('vao tien com')) { openAppById('tien-com'); return { replyText: `Đang mở ứng dụng **Tiền Cơm** cho bạn ngay đây! 🥘` }; }
    if (norm.includes('mo danh ba') || norm.includes('vao danh ba')) { openAppById('danh-ba'); return { replyText: `Đang mở ứng dụng **Danh Bạ** cho bạn ngay đây! 👥` }; }
    if (norm.includes('mo ghi chu') || norm.includes('vao ghi chu')) { openAppById('ghi-chu'); return { replyText: `Đang mở ứng dụng **Sticky Notes** cho bạn ngay đây! 📝` }; }
    if (norm.includes('mo chia bill') || norm.includes('vao chia bill')) { openAppById('chia-bill'); return { replyText: `Đang mở ứng dụng **Chia Bill** cho bạn ngay đây! 🧾` }; }

    // Tính nhẩm
    const mathMatch = raw.match(/(\d+[\.,]?\d*)\s*(k|nghìn|ngàn)?\s*([\+\-\*\/]|chia|nhân|cộng|trừ)\s*(\d+[\.,]?\d*)\s*(k|nghìn|ngàn)?/i);
    if (mathMatch) {
      try {
        let n1 = parseFloat(mathMatch[1].replace(',', '.'));
        if (mathMatch[2] && (mathMatch[2].toLowerCase() === 'k' || mathMatch[2].toLowerCase().startsWith('ngh'))) n1 *= 1000;
        let op = mathMatch[3].toLowerCase();
        let n2 = parseFloat(mathMatch[4].replace(',', '.'));
        if (mathMatch[5] && (mathMatch[5].toLowerCase() === 'k' || mathMatch[5].toLowerCase().startsWith('ngh'))) n2 *= 1000;

        let res = 0;
        if (op === '/' || op === 'chia') res = n1 / n2;
        else if (op === '*' || op === 'nhân') res = n1 * n2;
        else if (op === '+' || op === 'cộng') res = n1 + n2;
        else if (op === '-' || op === 'trừ') res = n1 - n2;

        return {
          replyText: `Kết quả phép tính của bạn:\n**${formatMoney(n1)} ${op} ${n2 > 1000 ? formatMoney(n2) : n2} = ${formatMoney(res)}** 🧮`
        };
      } catch (e) {}
    }

    // Chào hỏi xã giao
    if (norm.includes('chao') || norm.includes('hello') || norm.includes('hi') || norm.includes('alo')) {
      return {
        replyText: `Xin chào! Chúc bạn một ngày làm việc thật nhiều năng lượng và hiệu quả! 🌟\nTôi có thể giúp bạn ghi chép tiền cơm, chia bill ăn nhậu, tạo ghi chú việc làm hay thêm danh bạ không?`
      };
    }

    return {
      replyText: `Tôi đã nhận được tin nhắn của bạn: *"${raw}"*.\n\n💡 **Mẹo:** Để AI phân tích ngữ nghĩa sâu và trò chuyện thông minh như ChatGPT/Gemini, bạn hãy bấm vào **⚙️ Cài đặt AI** ở góc trên để dán mã Google Gemini API Key miễn phí nhé!`
    };
  }

  // --------------------------------------------------------------------------
  // 6. TÍCH HỢP GOOGLE GEMINI TRỰC TUYẾN (MULTI-TURN CHAT - MODEL CỐ ĐỊNH + MULTIMODAL VISION OCR)
  // --------------------------------------------------------------------------
  async function callGeminiApi(userPrompt, apiKey, targetModel, attachedImage) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const tomorrowDate = new Date(now.getTime() + 24 * 3600 * 1000);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];
    const timeNow = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dayOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][now.getDay()];
    const members = getSystemMembers();
    const membersSummary = members.map(m => `"${m.nickname || m.name}" (Họ tên: ${m.fullName || m.name})`).join(', ');

    const adminActive = isAdminMode();
    const modeStatusInstruction = adminActive
      ? `=== THÔNG TIN QUYỀN HẠN HỆ THỐNG HIỆN TẠI ===
TRẠNG THÁI: 🔑 QUẢN TRỊ VIÊN (ADMIN MODE)
- Người dùng có TOÀN QUYỀN quản trị hệ thống (Chia Bill, Tiền Cơm, Ghi Chú, Danh Bạ).
- Hãy phục vụ và chèn các thẻ action tag tương ứng (<ACTION_MEAL_LOG>, <ACTION_BILL_LOG>, <ACTION_RESET_CHIA_BILL>, <ACTION_DELETE_CHIA_BILL>, <ACTION_SETTLE_CHIA_BILL>, <ACTION_SETTLE_DEBT>, <ACTION_RESET_DEBTS>, <ACTION_DELETE_MEAL_LOG>, <ACTION_NOTE_CREATE>, <ACTION_NOTE_COMPLETE>, <ACTION_CONTACT_ADD>, <ACTION_REMINDER>, <ACTION_SAVE_MEMORY>) khi người dùng yêu cầu.
- NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI (THEO CHỈ ĐẠO CỦA CHỦ SỞ HỮU):
  + BẤT KỲ hành động thay đổi dữ liệu nào (ghi tiền cơm, tạo bill, thanh toán nợ, xóa, reset, tạo ghi chú, hoàn thành ghi chú, đặt nhắc nhở, ghi nhớ ký ức) ĐỀU PHẢI ĐƯỢC NGƯỜI DÙNG DUYỆT QUA THẺ XÁC NHẬN.
  + KHÔNG BAO GIỜ tự tiện thay đổi dữ liệu ngầm mà không hỏi.
  + Trong câu trả lời, hãy trình bày rõ ràng và nói rằng bạn đã soạn phiếu xác nhận bên dưới để người dùng bấm [Xác nhận thực hiện] hoặc [Hủy bỏ].
- Khi người dùng hỏi đang ở chế độ xem hay admin: Xác nhận rõ ràng họ đang ở Quản trị viên (Admin Mode).`
      : `=== THÔNG TIN QUYỀN HẠN HỆ THỐNG HIỆN TẠI ===
TRẠNG THÁI: 👁️ CHẾ ĐỘ XEM (CHỈ ĐỌC / VIEW-ONLY)
- Người dùng HIỆN ĐANG Ở CHẾ ĐỘ XEM (CHỈ ĐỌC), KHÔNG CÓ QUYỀN THỰC HIỆN CÁC THAO TÁC THÊM, SỬA HOẶC XÓA DỮ LIỆU!
- QUY TẮC BẮT BUỘC: Khi người dùng yêu cầu thêm, sửa, xóa dữ liệu (ví dụ: "mua cơm 40k", "hôm nay tôi mua cơm cho...", "chia bill", "tạo ghi chú", "thêm danh bạ", "nhắc nhở"):
  + Bạn PHẢI TỪ CHỐI RÕ RÀNG VÀ LỊCH SỰ: Giải thích rằng người dùng đang ở Chế độ xem (Chỉ đọc), hệ thống không cho phép sửa đổi dữ liệu qua AI. Hướng dẫn họ nhấp vào biểu tượng "👁️ Chế độ xem" trên thanh Menu trên cùng màn hình (hoặc nút Chế độ xem ở góc cửa sổ AI) để đăng nhập Quản trị viên (Admin).
  + TUYỆT ĐỐI KHÔNG xuất bất kỳ thẻ hành động ghi dữ liệu nào (<ACTION_MEAL_LOG>, <ACTION_BILL_LOG>, <ACTION_NOTE_CREATE>, <ACTION_CONTACT_ADD>, <ACTION_REMINDER>) khi đang ở Chế độ xem!
- Nếu người dùng hỏi mình đang ở chế độ xem hay admin: Hãy khẳng định rõ ràng họ đang ở Chế độ xem (Chỉ đọc) và chỉ có quyền tra cứu chứ không được chỉnh sửa dữ liệu.
- Người dùng ở Chế độ xem VẪN ĐƯỢC: Tra cứu công nợ, xem sinh nhật, trò chuyện, tính toán và mở ứng dụng (<ACTION_OPEN_APP>).`;

    const memoriesSummary = permanentMemories.map((m, idx) => `${idx + 1}. [${m.category || 'ký ức'}]: ${m.content}`).join('\n');
    const systemSnapshot = getCurrentSystemSnapshot();
    const currentDebtsSummary = systemSnapshot.debtLines.length > 0
      ? systemSnapshot.debtLines.map(d => `  * ${d}`).join('\n')
      : '  * Tất cả các thành viên đều có số dư 0đ (không có công nợ nào).';

    let notesSummary = '  * Chưa có nhắc việc hoặc ghi chú nào đang chờ.';
    if (systemSnapshot.notes && systemSnapshot.notes.length > 0) {
      const activeTasks = systemSnapshot.notes.filter(t => t.status !== 'done');
      if (activeTasks.length > 0) {
        notesSummary = activeTasks.slice(0, 12).map((t, idx) => {
          const typeStr = t.type === 'countdown' ? '⏳ Đếm ngược' : (t.type === 'reminder' ? '⏰ Hẹn giờ' : '📝 Việc');
          const prioStr = t.priority === 'high' ? '🔥 Cao' : (t.priority === 'low' ? 'Thấp' : 'Vừa');
          const dlStr = t.deadline ? new Date(t.deadline).toLocaleString('vi-VN') : 'Không hạn';
          return `  ${idx + 1}. [${typeStr}] [Ưu tiên: ${prioStr}] "${t.text}" (Hạn: ${dlStr})${t.details ? ` - Chi tiết: ${t.details}` : ''}`;
        }).join('\n');
      }
    }

    const systemPrompt = `Bạn là Kira - Nữ trợ lý AI thông minh cá nhân hóa cao cấp cho ${userProfile.name || 'Hong Cong Tech'}.
Tên của bạn là Kira. Luôn xưng là "em" và gọi người dùng là "anh Công". Giọng điệu tự nhiên, lịch thiệp, vui vẻ, thông minh, chu đáo và thân thiết.
Người dùng hiện tại: ${userProfile.name} (${userProfile.role}).
Ngữ cảnh công việc: ${userProfile.work_context}
Quy tắc làm việc: ${userProfile.tone_preference}.

=== 🧠 KHO KÝ ỨC DÀI HẠN & DỮ LIỆU TRAIN CỦA NGƯỜI DÙNG (BẢO LƯU VĨNH VIỄN) ===
${memoriesSummary || 'Chưa có ghi chép bổ sung.'}
(LƯU Ý QUAN TRỌNG: Bạn PHẢI LUÔN LUÔN ghi nhớ chính xác những thông tin cá nhân và quy tắc làm việc trên, dù người dùng có xóa lịch sử chat thì bạn vẫn phải nhớ rõ họ là ai, làm gì và có những thói quen/quy tắc nào!)

=== 📊 HIỆN TRẠNG DỮ LIỆU THỰC TẾ HỆ THỐNG THỜI GIAN THỰC ===
Thời gian hiện tại: ${dayOfWeek}, ngày ${today} lúc ${timeNow}.
Danh sách thành viên công ty: [${membersSummary}].
Tình trạng công nợ Tiền Cơm hiện tại:
${currentDebtsSummary}
Tổng công nợ tồn đọng toàn hệ thống Tiền Cơm: ${formatMoney(systemSnapshot.totalDebtSum)}.
Số lượng Ghi Chú & Nhắc Việc: ${systemSnapshot.notes ? systemSnapshot.notes.length : 0} mục.
Số lượng Hóa Đơn Chia Bill: ${systemSnapshot.billsCount} hóa đơn.

=== 📝 DANH SÁCH NHẮC VIỆC, GHI CHÚ & ĐẾM NGƯỢC ĐANG CHỜ XỬ LÝ ===
${notesSummary}
(Nếu người dùng hỏi về công việc hôm nay, việc cần làm, việc quá hạn hay sự kiện đếm ngược, hãy dựa vào danh sách trên để trả lời chi tiết, chính xác, ngắn gọn và nhiệt tình).

${modeStatusInstruction}

Nhiệm vụ: Trò chuyện tự nhiên, tinh tế, thông minh bằng Tiếng Việt. Bạn có khả năng CAN THIỆP SÂU VÀO HỆ THỐNG bằng cách chèn thẻ hành động tương ứng ở cuối câu trả lời:

1. RESET / KHÔI PHỤC DỮ LIỆU ỨNG DỤNG CHIA BILL & QUỸ NHÓM:
   Khi người dùng muốn reset ứng dụng Chia Bill (ví dụ: "reset chia bill", "reset app chia bill", "xóa hết bill làm lại từ đầu", "reset dữ liệu test chia bill", "cho quỹ chia bill về 0"):
   Chèn thẻ cuối câu:
   <ACTION_RESET_CHIA_BILL>{"mode":"keep_members_zero"}</ACTION_RESET_CHIA_BILL>
   (LƯU Ý: Thao tác này sẽ làm sạch các hóa đơn chia bill và đưa số dư các thành viên về 0đ. Hệ thống sẽ hiển thị phiếu xác nhận để Admin duyệt trước khi thực thi).

2. XÓA HÓA ĐƠN TRONG CHIA BILL:
   Ví dụ: "xóa hóa đơn lẩu hôm qua", "xóa bill vừa tạo", "hủy hóa đơn nhậu".
   Chèn thẻ cuối câu:
   <ACTION_DELETE_CHIA_BILL>{"title":"Tiền ăn nhậu"}</ACTION_DELETE_CHIA_BILL>

3. CẤN TRỪ / NẠP QUỸ / RÚT QUỸ CHIA BILL CHO THÀNH VIÊN:
   Ví dụ: "Đô nạp 200k vào quỹ chia bill", "trả lại tiền thừa 50k cho Đạt", "cấn trừ nợ chia bill cho Hạnh".
   Chèn thẻ cuối câu:
   <ACTION_SETTLE_CHIA_BILL>{"memberName":"Đô","amount":200000,"isDeposit":true}</ACTION_SETTLE_CHIA_BILL>

4. RESET / XÓA SỔ CÔNG NỢ TIỀN CƠM VỀ 0 (Chốt chu kỳ Tiền Cơm):
   Khi người dùng yêu cầu reset tiền cơm: "reset tiền cơm", "chốt sổ tiền cơm", "cho nợ cơm về 0", "tất toán tiền cơm":
   Chèn thẻ cuối câu:
   <ACTION_RESET_DEBTS>{"app":"tien-com","reason":"Chốt chu kỳ thanh toán qua Kira"}</ACTION_RESET_DEBTS>

5. THANH TOÁN CÔNG NỢ CHO 1 NGƯỜI (Trả nợ Tiền Cơm):
   Ví dụ: "Huy trả hết nợ", "Huy thanh toán 170k cho Công", "Công thu nợ của Huy".
   Chèn thẻ cuối câu:
   <ACTION_SETTLE_DEBT>{"debtorName":"Huy","creditorName":"Công","amount":170000}</ACTION_SETTLE_DEBT>

6. XÓA GIAO DỊCH / HỦY BỮA ĂN VỪA NHẬP (Tiền Cơm):
   Ví dụ: "xóa giao dịch vừa nhập", "hủy bữa cơm vừa tạo", "xóa log cơm vừa rồi".
   Chèn thẻ cuối câu:
   <ACTION_DELETE_MEAL_LOG>{"target":"latest"}</ACTION_DELETE_MEAL_LOG>

7. ĐẶT LỊCH NHẮC NHỞ / HẸN GIỜ / NHẮC VIỆC (Ứng dụng Nhắc Việc & Ghi Chú):
   Khi người dùng yêu cầu nhắc việc hoặc hẹn giờ (ví dụ: "nhắc anh mai mua hàng lúc 10h", "hẹn giờ 9h sáng mai họp", "nhắc em uống thuốc mỗi ngày", "nhắc họp thứ hai hàng tuần"):
   Bóc tách đầy đủ và CHÈN THẺ ACTION_NOTE_CREATE:
   - text: Tiêu đề công việc cần nhắc (ví dụ: "Mua hàng", "Họp dự án")
   - details: Ghi chú thêm nếu có
   - deadline: Định dạng ISO "YYYY-MM-DDTHH:mm" (ví dụ: ngày mai 10h là "${tomorrow}T10:00")
   - noteType: "reminder" (hoặc "todo", "countdown", "note")
   - priority: "high" | "medium" | "low"
   - repeat: "daily" (hàng ngày/mỗi ngày) | "workdays" (ngày làm việc T2-T6) | "weekly" (hàng tuần/mỗi tuần) | "monthly" (hàng tháng) | "none" (không lặp lại)
   - sound: "radar_alarm" (báo thức/radar) | "macos_chime" (chuông Mac) | "crystal_bell" (pha lê) | "digital_beep" (casio) | "zen_bowl" (chuông thiền) | "fanfare" (khải hoàn) | "cyber_synth" (cyberpunk) | "marimba" (phím gỗ) | "urgent_siren" (còi báo động) | "water_drop" (giọt nước) | "default"
   - tags: ["nhắc nhở"]
   Chèn thẻ cuối câu:
   <ACTION_NOTE_CREATE>{"text":"Uống nước","details":"Mỗi ngày 2 lít","deadline":"${tomorrow}T09:00","noteType":"reminder","priority":"medium","repeat":"daily","sound":"radar_alarm","tags":["suckhoe"]}</ACTION_NOTE_CREATE>

8. GHI TIỀN CƠM (ứng dụng Tiền Cơm):
   Ví dụ: "hôm nay Công trả tiền cơm sườn 40k", "Đô bao cơm gà 35k".
   BẮT BUỘC trích xuất chính xác tên món ăn (dishName): ví dụ "Cơm tấm sườn bì", "Bún bò Huế", "Phở bò", "Cơm rang dưa bò"... Nếu người dùng không nói rõ món gì thì để "Cơm trưa".
   Chèn thẻ cuối câu:
   <ACTION_MEAL_LOG>{"payerName":"Công","dishName":"Cơm tấm sườn","amountPerPerson":40000,"eaters":["Đô","Đạt Còi","Công","Hạnh","Quyền","Duy"],"date":"${today}","note":"Công trả tiền cơm"}</ACTION_MEAL_LOG>

9. CHIA BILL / ĂN NHẬU / KARAOKE / TIỀN TIỆC (ứng dụng Chia Bill):
   Ví dụ: "chia bill tiền nhậu hôm qua 1500k gồm lẩu 500k, bò 700k, bia 300k do Công trả cho Công, Đô, Đạt, Quyền", "Công trả tiền ăn lẩu 1200k chia đều cho cả phòng".
   BẮT BUỘC bóc tách mảng chi tiết các khoản chi (expenseItems: [{"title":"...","amount":...}]) nếu người dùng liệt kê, và tổng tiền (totalAmount).
   Chèn thẻ cuối câu:
   <ACTION_BILL_LOG>{"title":"Tiền ăn nhậu liên hoan","payerName":"Công","totalAmount":1500000,"expenseItems":[{"title":"Nồi lẩu","amount":500000},{"title":"Thịt bò","amount":700000},{"title":"Bia & nước ngọt","amount":300000}],"participants":["Công","Đô","Đạt Còi","Quyền"],"date":"${today}","note":"Chia bill ăn uống"}</ACTION_BILL_LOG>

10. XỬ LÝ HÌNH ẢNH HÓA ĐƠN / BILL (OCR & MULTIMODAL VISION):
    Khi người dùng gửi kèm hình ảnh hóa đơn (bill nhà hàng, phiếu thu, hóa đơn ăn uống, chuyển khoản):
    - Đọc chi tiết nội dung trên ảnh: Tên quán ăn/cửa hàng, ngày tháng, danh sách từng món ăn/khoản chi (expenseItems: [{"title":"...","amount":...}]), và Tổng tiền thanh toán (Total / Grand Total).
    - Tóm tắt các mục trong bill một cách rõ ràng, chuyên nghiệp.
    - BẮT BUỘC chèn thẻ:
    <ACTION_BILL_LOG>{"title":"Tên quán từ ảnh","payerName":"Công","totalAmount":số_tiền_tổng,"expenseItems":[{"title":"Món 1","amount":100000},{"title":"Món 2","amount":200000}],"participants":["Công","Đô","Đạt Còi","Quyền","Hạnh","Duy"],"date":"${today}","note":"Quét tự động từ ảnh bill"}</ACTION_BILL_LOG>

11. TẠO NHẮC VIỆC, GHI CHÚ, HẸN GIỜ & ĐẾM NGƯỢC (Ứng dụng Reminders & Notes):
    Ví dụ: "tạo ghi chú nộp báo cáo quý vào thứ hai lúc 15h", "nhắc anh họp lúc 14h chiều mai ưu tiên cao", "tạo đếm ngược tiệc tất niên 20/12", "nhắc anh tập thể dục mỗi ngày 6h sáng".
    Bóc tách:
    - text: Tiêu đề việc / sự kiện
    - details: Chi tiết bổ sung (nếu có)
    - deadline: Định dạng chuẩn YYYY-MM-DDTHH:mm
    - noteType: "todo" (việc cần làm) | "reminder" (hẹn giờ nhắc nhở) | "countdown" (sự kiện đếm ngược) | "note" (ghi chú tự do)
    - priority: "high" (cao / khẩn cấp) | "medium" (vừa) | "low" (thấp)
    - repeat: "daily" (mỗi ngày) | "workdays" (thứ 2 đến thứ 6) | "weekly" (mỗi tuần) | "monthly" (mỗi tháng) | "none" (không lặp lại)
    - sound: "macos_chime" | "radar_alarm" | "crystal_bell" | "digital_beep" | "zen_bowl" | "fanfare" | "cyber_synth" | "marimba" | "urgent_siren" | "water_drop" | "default"
    - tags: Mảng tag (ví dụ: ["baocao", "congviec"])
    Chèn thẻ cuối câu:
    <ACTION_NOTE_CREATE>{"text":"Nộp báo cáo quý cho phòng kế toán","details":"Gửi file PDF cho sếp","deadline":"${today}T15:00","noteType":"todo","priority":"high","repeat":"none","sound":"default","tags":["baocao"]}</ACTION_NOTE_CREATE>

12. HOÀN THÀNH NHẮC VIỆC / GHI CHÚ:
    Ví dụ: "đã làm xong báo cáo quý", "hoàn thành việc nộp tiền điện", "xong task họp rồi".
    Chèn thẻ cuối câu:
    <ACTION_NOTE_COMPLETE>{"keyword":"báo cáo"}</ACTION_NOTE_COMPLETE>

13. XÓA NHẮC VIỆC / GHI CHÚ / ĐẾM NGƯỢC:
    Ví dụ: "xóa ghi chú mua quà", "hủy nhắc việc đi bơi", "xóa hết nhắc nhở", "xóa những cái nhắc nhở quá hạn", "dọn dẹp việc đã xong".
    BẮT BUỘC bóc tách đúng keyword:
    - Nếu xóa cụ thể 1 việc: {"keyword":"tên việc cần xóa"} (ví dụ: {"keyword":"mua hàng"})
    - Nếu xóa tất cả / xóa hết: {"keyword":"all"} (ví dụ: "xóa hết nhắc nhở", "xóa toàn bộ việc")
    - Nếu xóa việc quá hạn: {"keyword":"overdue"} (ví dụ: "xóa nhắc nhở quá hạn", "xóa những cái quá hạn")
    - Nếu xóa việc đã hoàn thành: {"keyword":"done"} (ví dụ: "xóa việc đã xong", "dọn dẹp task hoàn thành")
    Chèn thẻ cuối câu:
    <ACTION_NOTE_DELETE>{"keyword":"overdue"}</ACTION_NOTE_DELETE>

14. CẬP NHẬT / GIA HẠN / ĐỔI MỨC ƯU TIÊN:
    Ví dụ: "dời việc nộp báo cáo sang thứ ba 16h", "đổi task nộp thuế sang ưu tiên cao".
    Chèn thẻ cuối câu:
    <ACTION_NOTE_UPDATE>{"keyword":"báo cáo","deadline":"${today}T16:00","priority":"high"}</ACTION_NOTE_UPDATE>

15. THÊM LIÊN HỆ / THÀNH VIÊN / ĐỐI TÁC (ứng dụng Danh Bạ):
    BẮT BUỘC trích xuất đầy đủ: Họ tên (fullName), Biệt danh (nickname), Ngày sinh (dob dạng YYYY-MM-DD nếu có), Số điện thoại (phone), Ngân hàng (bankId: MB, VCB, TCB, VPB, ACB, BIDV, ICB, TPB, VIB, STB), Số tài khoản (accountNo), Tên chủ tài khoản IN HOA KHÔNG DẤU (accountName), Chức vụ/ghi chú (role).
    Chèn thẻ cuối câu:
    <ACTION_CONTACT_ADD>{"fullName":"Nguyễn Văn Nam","nickname":"Nam","dob":"1995-10-15","phone":"0988123456","bankId":"MB","accountNo":"0988123456","accountName":"NGUYEN VAN NAM","role":"Đối tác mới"}</ACTION_CONTACT_ADD>

16. MỞ ỨNG DỤNG / ĐÓNG ỨNG DỤNG:
    <ACTION_OPEN_APP>{"appId":"chia-bill"}</ACTION_OPEN_APP> hoặc <ACTION_CLOSE_APP>{"appId":"tien-com"}</ACTION_CLOSE_APP>

17. GHI NHỚ VÀO BỘ NHỚ DÀI HẠN / HỌC THÓI QUEN:
    <ACTION_SAVE_MEMORY>{"category":"user_preference","content":"Nội dung tóm tắt thông tin cần ghi nhớ rõ ràng"}</ACTION_SAVE_MEMORY>

18. QUY TẮC XƯNG HÔ & PHONG CÁCH GIAO TIẾP (BẮT BUỘC):
    - Luôn xưng là "em" và gọi người dùng là "anh Công".
    - Trả lời tự nhiên, ngắn gọn, súc tích, đi thẳng vào trọng tâm, lịch sự và thông minh.
    - Tuyệt đối không dài dòng, không dùng câu mở đầu rườm rà, sáo rỗng hoặc máy móc.

19. Với tất cả các câu hỏi khác (viết văn, tính toán, tra cứu, đối soát công nợ, trò chuyện): Trả lời ngắn gọn, thông minh, chính xác và không chèn action tag khi không yêu cầu can thiệp dữ liệu.`;

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: adminActive ? 'Dạ em chào anh Công! Em đã sẵn sàng hỗ trợ anh ạ.' : 'Dạ em chào anh Công! Em đang ở chế độ xem và sẵn sàng tra cứu thông tin cho anh ạ.' }] }
    ];

    // Gửi kèm tối đa 6 lượt chat gần nhất để hiểu ngữ cảnh liên tục
    const recentMessages = chatHistory.slice(-6);
    recentMessages.forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });

    // Phần User Parts kèm Multimodal Vision (Ảnh hóa đơn nếu có)
    const userParts = [];
    if (attachedImage && attachedImage.base64) {
      userParts.push({
        inlineData: {
          mimeType: attachedImage.mimeType || 'image/jpeg',
          data: attachedImage.base64
        }
      });
    }
    userParts.push({ text: userPrompt || 'Phân tích hình ảnh này và giúp tôi trích xuất thông tin để tạo bill chia tiền.' });

    contents.push({
      role: 'user',
      parts: userParts
    });

    const targetModelCandidate = targetModel || DEFAULT_GEMINI_MODEL;
    const modelCandidates = [targetModelCandidate];
    if (targetModelCandidate !== 'gemini-1.5-flash') {
      modelCandidates.push('gemini-1.5-flash');
    }
    if (targetModelCandidate !== 'gemini-2.0-flash') {
      modelCandidates.push('gemini-2.0-flash');
    }

    let candidateText = null;
    let lastError = null;

    for (const modelName of modelCandidates) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1200
            }
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${res.status}`;
          throw new Error(`(${modelName}): ${errMsg}`);
        }

        const data = await res.json();
        candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          break; // Thành công!
        }
      } catch (err) {
        lastError = err;
        console.warn(`[AI Assistant] Thử mô hình ${modelName} thất bại, thử tiếp model tiếp theo...`, err);
      }
    }

    if (!candidateText) {
      throw lastError || new Error(`Google Gemini không phản hồi nội dung.`);
    }

    return candidateText;
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 7. XỬ LÝ LỆNH NGƯỜI DÙNG & ĐIỀU PHỐI (MAIN DISPATCHER)
  // --------------------------------------------------------------------------
  async function processUserInput(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return;
    const query = userPrompt.trim();
    const normUserQuery = normalizeVietnamese(query.toLowerCase());

    // 0. Kiểm tra nếu người dùng đang trả lời Xác nhận / Hủy cho thao tác đang chờ duyệt
    if (pendingActionToConfirm) {
      const confirmWords = ['xac nhan', 'dong y', 'ok lam di', 'lam di', 'chap nhan', 'thuc hien', 'yes', 'ok', 'duyet', 'tien hanh', 'reset luon', 'xoa luon', 'co', 'chuan roi', 'chinh xac'];
      const cancelWords = ['huy', 'thoi', 'huy bo', 'khong lam nua', 'no', 'cancel', 'dung lai', 'khong', 'dung'];

      const isConfirm = confirmWords.some(w => normUserQuery === w || normUserQuery.includes(w));
      const isCancel = cancelWords.some(w => normUserQuery === w || normUserQuery.includes(w));

      if (isConfirm) {
        window.aiExecutePendingAction(pendingActionToConfirm.msgId);
        return;
      }
      if (isCancel) {
        window.aiCancelPendingAction(pendingActionToConfirm.msgId);
        return;
      }
    }

    // Thu thập hình ảnh đính kèm (nếu người dùng vừa tải lên hoặc dán Ctrl+V)
    const attachedImage = pendingBillImage;
    pendingBillImage = null;
    hideImagePreviewStrip();

    // 1. Thêm tin nhắn của User vào luồng hội thoại (kèm thumbnail ảnh nếu có)
    const userMsgId = 'msg_' + Date.now();
    chatHistory.push({
      id: userMsgId,
      role: 'user',
      text: query,
      image: attachedImage ? attachedImage.dataUrl : null,
      time: getCurrentTimeStr()
    });

    // Tự động phân tích & bóc tách ký ức cá nhân hóa
    extractAndSavePermanentMemories(query);

    isThinking = true;
    saveChatHistory();
    renderChatThread();
    setAiStatusText('Trí tuệ nhân tạo đang suy nghĩ... ✨');

    const cfg = getAiConfig();
    let replyText = '';
    let card = null;
    let modelUsed = `Google ${DEFAULT_GEMINI_MODEL}`;

    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.trim().length > 10);
    const isCurrentlyAdmin = isAdminMode();

    if (hasKey) {
      try {
        const geminiRaw = await callGeminiApi(query, cfg.apiKey.trim(), cfg.model, attachedImage);

        let cleanedText = geminiRaw;

        // Bóc tách thẻ Action Reset Chia Bill
        const resetChiaBillMatch = geminiRaw.match(/<ACTION_RESET_CHIA_BILL>([\s\S]*?)<\/ACTION_RESET_CHIA_BILL>/i);
        // Bóc tách thẻ Action Reset Tiền Cơm
        const resetDebtsMatch = geminiRaw.match(/<ACTION_RESET_DEBTS>([\s\S]*?)<\/ACTION_RESET_DEBTS>/i);
        const resetTienComMatch = geminiRaw.match(/<ACTION_RESET_TIEN_COM>([\s\S]*?)<\/ACTION_RESET_TIEN_COM>/i);

        // Nhận diện lệnh reset từ người dùng
        const isUserAskingReset = normUserQuery.includes('reset') || normUserQuery.includes('nhap lai tu dau') || normUserQuery.includes('du lieu test') || (normUserQuery.includes('xoa het') && (normUserQuery.includes('bill') || normUserQuery.includes('no') || normUserQuery.includes('com')));
        const isChiaBillContext = normUserQuery.includes('chia bill') || normUserQuery.includes('nhau') || normUserQuery.includes('quy') || normUserQuery.includes('bill');
        const isTienComContext = normUserQuery.includes('tien com') || normUserQuery.includes('com') || normUserQuery.includes('bua an') || normUserQuery.includes('cong no');
        const isChiaBillOpen = Boolean(document.querySelector('iframe[src*="chia-bill"]'));
        const isTienComOpen = Boolean(document.querySelector('iframe[src*="tien-com"]'));

        if (resetChiaBillMatch || (isUserAskingReset && (isChiaBillContext || (isChiaBillOpen && !isTienComOpen && !isTienComContext)))) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối reset Chia Bill',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền reset dữ liệu Chia Bill.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể thực hiện reset app Chia Bill & Quỹ Nhóm.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            let meals = [];
            try { meals = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}
            let mems = [];
            try { mems = JSON.parse(localStorage.getItem('nhau_members')) || []; } catch(e) {}
            const conf = requestActionConfirmation(
              'RESET_CHIA_BILL',
              { mode: 'keep_members_zero' },
              '🔄 Xác Nhận Khôi Phục & Reset Dữ Liệu Chia Bill',
              'Hệ thống sẽ làm sạch toàn bộ hóa đơn chi tiêu (nhau_meals), nhật ký quỹ (nhau_money_logs) và đưa số dư các thành viên về 0đ.',
              [
                'Ứng dụng: Chia Bill & Quỹ Nhóm (apps/chia-bill/)',
                `Xóa toàn bộ ${meals.length} hóa đơn tiệc / nhậu`,
                `Cân bằng số dư của ${mems.length || 6} thành viên về 0đ`,
                'Đồng bộ tức thì lên Supabase Cloud'
              ],
              true
            );
            card = conf.card;
            cleanedText = conf.replyText;
            if (resetChiaBillMatch) cleanedText = cleanedText.replace(resetChiaBillMatch[0], '').trim();
          }
        } else if (resetDebtsMatch || resetTienComMatch || (isUserAskingReset && (isTienComContext || (isTienComOpen && !isChiaBillOpen && !isChiaBillContext)))) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối reset công nợ',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền reset hoặc xóa công nợ.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể thực hiện reset công nợ Tiền Cơm.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            const snap = getCurrentSystemSnapshot();
            const conf = requestActionConfirmation(
              'RESET_TIEN_COM',
              {},
              '🔄 Xác Nhận Reset Toàn Bộ Công Nợ Tiền Cơm về 0đ',
              'Hệ thống sẽ ghi nhận giao dịch tất toán công nợ và đưa số dư toàn bộ thành viên về 0đ.',
              [
                'Ứng dụng: Tính Tiền Cơm VietQR (apps/tien-com/)',
                `Tất toán công nợ giữa ${snap.outstandingDebts.length} thành viên`,
                `Tổng tiền thanh toán chu kỳ: ${formatMoney(snap.totalDebtSum)}`,
                'Đồng bộ tức thì lên Supabase Cloud'
              ],
              true
            );
            card = conf.card;
            cleanedText = conf.replyText;
            if (resetDebtsMatch) cleanedText = cleanedText.replace(resetDebtsMatch[0], '').trim();
            if (resetTienComMatch) cleanedText = cleanedText.replace(resetTienComMatch[0], '').trim();
          }
        } else if (isUserAskingReset) {
          // Lệnh reset mơ hồ không rõ app nào -> Hiển thị thẻ chọn ứng dụng
          card = {
            type: 'APP_SELECTION_CONFIRM',
            data: {}
          };
          cleanedText = '⚙️ **Anh muốn khôi phục & reset dữ liệu của ứng dụng nào?**\n\nĐể đảm bảo an toàn dữ liệu, vui lòng chọn ứng dụng anh muốn làm sạch bên dưới:';
        }

        // Bóc tách thẻ Action Xóa Bill Trong Chia Bill
        const deleteChiaBillMatch = geminiRaw.match(/<ACTION_DELETE_CHIA_BILL>([\s\S]*?)<\/ACTION_DELETE_CHIA_BILL>/i);
        if (deleteChiaBillMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối xóa bill',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền xóa hóa đơn Chia Bill.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể xóa hóa đơn Chia Bill.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống nhé!`;
          } else {
            let meals = [];
            try { meals = JSON.parse(localStorage.getItem('nhau_meals')) || []; } catch(e) {}
            if (meals.length === 0) {
              cleanedText = 'Hiện tại trong ứng dụng Chia Bill chưa có hóa đơn nào để xóa.';
            } else {
              let targetTitle = '';
              let targetMealId = null;
              try {
                const parsed = JSON.parse(deleteChiaBillMatch[1]);
                targetTitle = parsed.title || '';
                targetMealId = parsed.mealId || null;
              } catch(e) {}
              const targetMeal = targetMealId ? meals.find(m => String(m.id) === String(targetMealId)) : (meals[meals.length - 1]);
              const conf = requestActionConfirmation(
                'DELETE_CHIA_BILL',
                { mealId: targetMeal.id, title: targetMeal.title },
                '🗑️ Xác Nhận Xóa Hóa Đơn Chia Bill',
                `Hệ thống sẽ xóa hóa đơn "${targetMeal.title}" (${formatMoney(targetMeal.totalCost || 0)}) và hoàn tác số dư cho các thành viên.`,
                [
                  `Hóa đơn: ${targetMeal.title} - Ngày: ${targetMeal.date || ''}`,
                  `Số tiền hoàn tác: ${formatMoney(targetMeal.totalCost || 0)}`,
                  `Số người tham gia: ${(targetMeal.participants || []).length} người`
                ],
                true
              );
              card = conf.card;
              cleanedText = conf.replyText;
            }
            cleanedText = cleanedText.replace(deleteChiaBillMatch[0], '').trim();
          }
        }

        // Bóc tách thẻ Action Cấn Trừ Quỹ Chia Bill
        const settleChiaBillMatch = geminiRaw.match(/<ACTION_SETTLE_CHIA_BILL>([\s\S]*?)<\/ACTION_SETTLE_CHIA_BILL>/i);
        if (settleChiaBillMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối cấn trừ quỹ',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền cấn trừ quỹ Chia Bill.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể cấn trừ quỹ Chia Bill.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống nhé!`;
          } else {
            try {
              const parsed = JSON.parse(settleChiaBillMatch[1]);
              const conf = requestActionConfirmation(
                'SETTLE_CHIA_BILL',
                { memberName: parsed.memberName, amount: parsed.amount, isDeposit: parsed.isDeposit !== false },
                '💳 Xác Nhận Cấn Trừ Quỹ Chia Bill',
                `Ghi nhận biến động quỹ cho ${parsed.memberName} số tiền ${formatMoney(parsed.amount)}.`,
                [
                  `Thành viên: ${parsed.memberName}`,
                  `Số tiền: ${formatMoney(parsed.amount)}`,
                  `Hành động: ${parsed.isDeposit !== false ? 'Nạp quỹ / thanh toán nợ' : 'Nhận hoàn tiền thừa'}`
                ],
                false
              );
              card = conf.card;
              cleanedText = conf.replyText;
              cleanedText = cleanedText.replace(settleChiaBillMatch[0], '').trim();
            } catch(e) {}
          }
        }

        // Bóc tách thẻ Action Nạp Tiền Cho Thành Viên (Ví dụ: Nạp 200k cho Đô)
        const depositMemberMatch = geminiRaw.match(/<ACTION_DEPOSIT_MEMBER>([\s\S]*?)<\/ACTION_DEPOSIT_MEMBER>/i);
        if (depositMemberMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối nạp tiền',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên mới có quyền nạp tiền vào quỹ.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể nạp tiền cho thành viên.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống nhé!`;
          } else {
            try {
              const parsed = JSON.parse(depositMemberMatch[1]);
              const memberName = parsed.member || parsed.memberName;
              const conf = requestActionConfirmation(
                'DEPOSIT_MEMBER',
                { memberName, amount: parsed.amount, note: parsed.note || 'Nạp tiền qua AI' },
                '💵 Xác Nhận Nạp Tiền Vào Số Dư Thành Viên',
                `Hệ thống sẽ cộng thêm ${formatMoney(parsed.amount)} vào số dư của ${memberName} và ghi sổ nhật ký quỹ.`,
                [
                  `Thành viên: ${memberName}`,
                  `Số tiền nạp: +${formatMoney(parsed.amount)}`,
                  'Đồng bộ tức thì lên Supabase Cloud'
                ],
                false
              );
              card = conf.card;
              cleanedText = conf.replyText;
              cleanedText = cleanedText.replace(depositMemberMatch[0], '').trim();
            } catch(e) {}
          }
        }

        // Bóc tách thẻ Action Thanh Toán Nợ Cá Nhân (Tiền Cơm)
        const settleMatch = geminiRaw.match(/<ACTION_SETTLE_DEBT>([\s\S]*?)<\/ACTION_SETTLE_DEBT>/i);
        if (settleMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối thanh toán nợ',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền ghi nhận thanh toán nợ.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể ghi nhận thanh toán nợ.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(settleMatch[1]);
              const conf = requestActionConfirmation(
                'SETTLE_DEBT',
                { debtorName: parsed.debtorName, creditorName: parsed.creditorName, amount: parsed.amount },
                '💸 Xác Nhận Thanh Toán Nợ Cá Nhân',
                `Ghi nhận ${parsed.debtorName} đã thanh toán ${formatMoney(parsed.amount)} cho ${parsed.creditorName}.`,
                [
                  `Người trả: ${parsed.debtorName}`,
                  `Người nhận: ${parsed.creditorName}`,
                  `Số tiền: ${formatMoney(parsed.amount)}`,
                  'Hệ thống sẽ cập nhật công nợ và đồng bộ lên Supabase Cloud'
                ],
                false
              );
              card = conf.card;
              cleanedText = conf.replyText;
              cleanedText = cleanedText.replace(settleMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Xóa Giao Dịch Gần Nhất (Tiền Cơm)
        const deleteLogMatch = geminiRaw.match(/<ACTION_DELETE_MEAL_LOG>([\s\S]*?)<\/ACTION_DELETE_MEAL_LOG>/i);
        if (deleteLogMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối xóa giao dịch',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền xóa giao dịch.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể xóa giao dịch.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            let logs = [];
            try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch(e) {}
            if (logs.length === 0) {
              cleanedText = 'Hiện tại chưa có giao dịch Tiền Cơm nào để xóa.';
            } else {
              const latestLog = logs[0];
              const conf = requestActionConfirmation(
                'DELETE_MEAL_LOG',
                {},
                '🗑️ Xác Nhận Xóa Giao Dịch Tiền Cơm Gần Nhất',
                `Hệ thống sẽ xóa giao dịch gần nhất: "${latestLog.description || latestLog.type}" (${formatMoney(latestLog.amount || 0)}).`,
                [
                  `Giao dịch: ${latestLog.description || latestLog.type}`,
                  `Số tiền: ${formatMoney(latestLog.amount || 0)}`,
                  'Công nợ các thành viên sẽ được tính toán lại'
                ],
                true
              );
              card = conf.card;
              cleanedText = conf.replyText;
            }
            cleanedText = cleanedText.replace(deleteLogMatch[0], '').trim();
          }
        }

        // Bóc tách thẻ Action Hoàn Thành Nhắc Việc / Ghi Chú
        const noteCompleteMatch = geminiRaw.match(/<ACTION_NOTE_COMPLETE>([\s\S]*?)<\/ACTION_NOTE_COMPLETE>/i);
        if (noteCompleteMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối sửa ghi chú',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để hoàn thành việc.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể cập nhật trạng thái việc.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống nhé!`;
          } else {
            try {
              const parsed = JSON.parse(noteCompleteMatch[1]);
              const res = executeCompleteNote(parsed.keyword || parsed.id || '');
              cleanedText = res.replyText;
              if (res.card) card = res.card;
              cleanedText = cleanedText.replace(noteCompleteMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Xóa Nhắc Việc / Ghi Chú
        const noteDeleteMatch = geminiRaw.match(/<ACTION_NOTE_DELETE>([\s\S]*?)<\/ACTION_NOTE_DELETE>/i);
        if (noteDeleteMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối xóa việc',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để xóa việc.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể xóa việc.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống nhé!`;
          } else {
            try {
              const parsed = JSON.parse(noteDeleteMatch[1]);
              const res = executeDeleteNote(parsed.keyword || parsed.id || '');
              cleanedText = res.replyText;
              if (res.card) card = res.card;
              cleanedText = cleanedText.replace(noteDeleteMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Cập Nhật / Sửa Deadline Nhắc Việc
        const noteUpdateMatch = geminiRaw.match(/<ACTION_NOTE_UPDATE>([\s\S]*?)<\/ACTION_NOTE_UPDATE>/i);
        if (noteUpdateMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối sửa việc',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Quản trị viên để sửa việc.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể sửa việc.`;
          } else {
            try {
              const parsed = JSON.parse(noteUpdateMatch[1]);
              const res = executeUpdateNote(parsed.keyword || '', parsed);
              cleanedText = res.replyText;
              cleanedText = cleanedText.replace(noteUpdateMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Đóng App
        const closeAppMatch = geminiRaw.match(/<ACTION_CLOSE_APP>([\s\S]*?)<\/ACTION_CLOSE_APP>/i);
        if (closeAppMatch) {
          try {
            const parsed = JSON.parse(closeAppMatch[1]);
            executeCloseApp(parsed.appId);
            cleanedText = cleanedText.replace(closeAppMatch[0], '').trim();
          } catch (e) {}
        }

        // Bóc tách thẻ Action Nhắc Nhở (Hợp nhất hoàn toàn vào chuẩn NOTE_CONFIRM để đưa thẳng vào App Nhắc Việc & Ghi Chú)
        const reminderMatch = geminiRaw.match(/<ACTION_REMINDER>([\s\S]*?)<\/ACTION_REMINDER>/i);
        if (reminderMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối đặt lịch nhắc nhở',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Vui lòng đăng nhập Admin để lưu nhắc nhở vào hệ thống.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể đặt lịch nhắc nhở mới.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(reminderMatch[1]);
              const dStr = parsed.dateStr || today;
              const tStr = parsed.timeStr || '09:00';
              const dlIso = `${dStr}T${tStr}`;
              card = {
                type: 'NOTE_CONFIRM',
                data: {
                  text: parsed.task || 'Công việc cần làm',
                  details: parsed.displayFormatted ? `Lịch hẹn: ${parsed.displayFormatted}` : '',
                  deadline: dlIso,
                  noteType: 'reminder',
                  priority: 'medium',
                  repeat: parsed.repeat || 'none',
                  tags: ['nhắc nhở']
                }
              };
              cleanedText = cleanedText.replace(reminderMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Tiền Cơm
        const mealMatch = geminiRaw.match(/<ACTION_MEAL_LOG>([\s\S]*?)<\/ACTION_MEAL_LOG>/i);
        if (mealMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối ghi Tiền Cơm',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền ghi tiền cơm vào hệ thống.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể ghi nhận khoản tiền cơm này vào hệ thống.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(mealMatch[1]);
              card = { type: 'MEAL_CONFIRM', data: parsed };
              cleanedText = cleanedText.replace(mealMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Chia Bill (Bao gồm kết quả từ quét ảnh Bill OCR)
        const billMatch = geminiRaw.match(/<ACTION_BILL_LOG>([\s\S]*?)<\/ACTION_BILL_LOG>/i);
        if (billMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối tạo hóa đơn Chia Bill',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền tạo bill chia tiền.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể tạo hóa đơn chia bill vào hệ thống.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(billMatch[1]);
              card = { type: 'BILL_CONFIRM', data: parsed };
              cleanedText = cleanedText.replace(billMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Ghi Chú
        const noteMatch = geminiRaw.match(/<ACTION_NOTE_CREATE>([\s\S]*?)<\/ACTION_NOTE_CREATE>/i);
        if (noteMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối tạo Ghi Chú',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền tạo ghi chú mới.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể tạo ghi chú mới vào hệ thống.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(noteMatch[1]);
              card = { type: 'NOTE_CONFIRM', data: parsed };
              cleanedText = cleanedText.replace(noteMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Action Danh Bạ
        const contactMatch = geminiRaw.match(/<ACTION_CONTACT_ADD>([\s\S]*?)<\/ACTION_CONTACT_ADD>/i);
        if (contactMatch) {
          if (!isCurrentlyAdmin) {
            card = {
              type: 'PERMISSION_DENIED',
              data: {
                title: 'Từ chối thêm Danh Bạ',
                message: 'Bạn đang ở Chế độ xem (Chỉ đọc). Chỉ Quản trị viên (Admin) mới có quyền thêm danh bạ.'
              }
            };
            cleanedText = `🔒 Bạn đang ở **Chế độ xem (Chỉ đọc)** nên không thể thêm liên hệ mới vào Danh Bạ.\n\nVui lòng đăng nhập Quản trị viên (Admin) trên thanh Menu hệ thống để thực hiện nhé!`;
          } else {
            try {
              const parsed = JSON.parse(contactMatch[1]);
              card = { type: 'CONTACT_CONFIRM', data: parsed };
              cleanedText = cleanedText.replace(contactMatch[0], '').trim();
            } catch (e) {}
          }
        }

        // Bóc tách thẻ Mở App
        const openAppMatch = geminiRaw.match(/<ACTION_OPEN_APP>([\s\S]*?)<\/ACTION_OPEN_APP>/i);
        if (openAppMatch) {
          try {
            const parsed = JSON.parse(openAppMatch[1]);
            openAppById(parsed.appId);
            cleanedText = cleanedText.replace(openAppMatch[0], '').trim();
          } catch (e) {}
        }

        // Bóc tách thẻ Action Lưu Ký Ức (Save Memory)
        const memoryMatch = geminiRaw.match(/<ACTION_SAVE_MEMORY>([\s\S]*?)<\/ACTION_SAVE_MEMORY>/i);
        if (memoryMatch) {
          try {
            const parsed = JSON.parse(memoryMatch[1]);
            if (parsed.content) {
              const conf = requestActionConfirmation(
                'SAVE_MEMORY',
                { category: parsed.category || 'user_preference', content: parsed.content },
                '🧠 Xác Nhận Ghi Nhớ Vào Kho Ký Ức Dài Hạn',
                `AI muốn lưu thông tin này vào Kho Ký Ức Dài Hạn (\`data/ai_memory/\`):`,
                [
                  `Phân loại: ${parsed.category || 'Quy tắc cá nhân'}`,
                  `Nội dung: "${parsed.content}"`
                ],
                false
              );
              card = conf.card;
              cleanedText = conf.replyText;
              cleanedText = cleanedText.replace(memoryMatch[0], '').trim();
            }
          } catch (e) {}
        }

        replyText = cleanedText || 'Tôi đã xử lý yêu cầu của bạn!';
      } catch (err) {
        console.warn('[AI Assistant] Lỗi gọi Gemini API:', err);
        modelUsed = `Google ${DEFAULT_GEMINI_MODEL} (Lỗi API)`;
        replyText = `❌ **Không gọi được API Google Gemini (${DEFAULT_GEMINI_MODEL})**\n\n**Chi tiết lỗi:** ${err.message || 'Lỗi không xác định khi kết nối tới máy chủ Google.'}\n\n*Vui lòng kiểm tra lại Google Gemini API Key trong mục **⚙️ Cài đặt AI**.*`;
        card = null;
      }
    } else {
      // Chưa cấu hình API Key -> Thử phân tích lệnh nội bộ (Offline Fallback)
      if (attachedImage) {
        replyText = `📸 **Tôi đã nhận được hình ảnh bill của bạn!**\n\nVì hiện tại chưa có Google Gemini API Key trực tuyến để quét nhận diện ký tự quang học (OCR) trên ảnh, tôi đã soạn sẵn **Phiếu Nhập Hóa Đơn Chia Tiền** mẫu bên dưới để bạn duyệt hoặc điều chỉnh nhanh. Để AI tự động đọc chính xác từng món và số tiền từ ảnh, bạn chỉ cần nhập Gemini API Key miễn phí nhé!`;
        card = {
          type: 'BILL_CONFIRM',
          data: {
            title: 'Hóa đơn quét từ ảnh bill',
            payerName: 'Công',
            totalAmount: 500000,
            participants: getSystemMembers().map(m => m.nickname || m.name),
            date: new Date().toISOString().split('T')[0],
            note: 'Tạo từ ảnh bill (chế độ offline)'
          }
        };
        modelUsed = 'Ngoại tuyến (Offline Vision Mẫu)';
      } else {
        const offlineRes = processOfflineConversation(query);
        if (offlineRes && (offlineRes.card || offlineRes.replyText)) {
          replyText = offlineRes.replyText;
          card = offlineRes.card || null;
          modelUsed = 'Ngoại tuyến (Offline)';
        } else {
          replyText = `⚠️ **Chưa cấu hình Google Gemini API Key**\n\nHệ thống đã được thiết lập gọi cố định mô hình **${DEFAULT_GEMINI_MODEL}**. Vui lòng bấm vào **⚙️ Cài đặt AI** ở thanh tiêu đề để nhập API Key của bạn.\n\n*Gợi ý: Bạn vẫn có thể dùng các câu lệnh nhanh như "Công trả cơm 40k", "Chia bill 600k", "Ghi chú việc..." ngay lập tức!*`;
          modelUsed = `Chưa có API Key (${DEFAULT_GEMINI_MODEL})`;
        }
      }
    }

    // 2. Thêm phản hồi của Assistant vào luồng hội thoại
    isThinking = false;
    const assistantMsgId = 'msg_' + Date.now();
    chatHistory.push({
      id: assistantMsgId,
      role: 'assistant',
      text: replyText,
      card: card,
      time: getCurrentTimeStr()
    });

    // Nếu card là dạng yêu cầu xác nhận, lưu lại vào trạng thái chờ duyệt
    if (card && (card.type === 'ACTION_CONFIRM' || card.type === 'APP_SELECTION_CONFIRM')) {
      activeConfirmationData[assistantMsgId] = card.data;
      pendingActionToConfirm = { msgId: assistantMsgId, ...card.data };
    }

    // Lưu vào Dataset huấn luyện dài hạn
    saveToPermanentDataset(query, replyText);

    saveChatHistory();
    renderChatThread();
    updateAiStatusIndicator();

    // VÒNG LẶP ĐỐI THOẠI GIỌNG NÓI LIÊN TỤC (HANDS-FREE CONTINUOUS DIALOGUE)
    handlePostResponseVoiceLoop(replyText);
  }

  // --------------------------------------------------------------------------
  // 8. CẬP NHẬT TRẠNG THÁI STATUS BAR & DRAWER SETTINGS
  // --------------------------------------------------------------------------
  function updateAiStatusIndicator() {
    const cfg = getAiConfig();
    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.trim().length > 10);
    const dot = document.getElementById('aiOnlineDot');
    const label = document.getElementById('aiOnlineStatusLabel');
    const subTitle = document.getElementById('aiTitleSub');

    if (subTitle) {
      if (hasKey) {
        subTitle.textContent = `Online • ${cfg.model || DEFAULT_GEMINI_MODEL}`;
        subTitle.style.color = '#38bdf8';
      } else {
        subTitle.textContent = 'Status unaribed';
        subTitle.style.color = 'rgba(255, 255, 255, 0.52)';
      }
    }

    if (dot && label) {
      if (hasKey) {
        dot.classList.remove('offline');
        label.innerText = `🟢 Trực tuyến • Google ${cfg.model || DEFAULT_GEMINI_MODEL}`;
      } else {
        dot.classList.add('offline');
        label.innerText = `⚪ Status unaribed (Chưa có API Key) • Bấm ⚙️ để kích hoạt`;
      }
    }
  }

  function setAiStatusText(text) {
    const label = document.getElementById('aiOnlineStatusLabel');
    if (label) label.innerText = text;
    const subTitle = document.getElementById('aiTitleSub');
    if (subTitle) {
      subTitle.textContent = text;
      if (text.includes('lắng nghe') || text.includes('Đối thoại') || text.includes('🎙️')) {
        subTitle.style.color = '#10b981';
      } else if (text.includes('suy nghĩ') || text.includes('✨')) {
        subTitle.style.color = '#a855f7';
      } else if (text.includes('Đang đọc') || text.includes('🔊')) {
        subTitle.style.color = '#f59e0b';
      } else if (text.includes('Đang giữ Space') || text.includes('⏳')) {
        subTitle.style.color = '#38bdf8';
      } else {
        const cfg = getAiConfig();
        subTitle.style.color = (cfg.apiKey && cfg.apiKey.trim().length > 10) ? '#38bdf8' : 'rgba(255, 255, 255, 0.52)';
      }
    }
  }

  function toggleAiSettingsDrawer() {
    const drawer = document.getElementById('aiSettingsDrawer');
    if (!drawer) return;

    const isOpen = drawer.style.display === 'block';
    drawer.style.display = isOpen ? 'none' : 'block';

    if (!isOpen) {
      const cfg = getAiConfig();
      const keyInput = document.getElementById('drawerGeminiKeyInput');
      const modelSelect = document.getElementById('drawerGeminiModelSelect');
      const statusEl = document.getElementById('drawerAiTestStatus');

      if (keyInput) keyInput.value = cfg.apiKey || '';
      if (modelSelect) modelSelect.value = cfg.model || DEFAULT_GEMINI_MODEL;
      if (statusEl) statusEl.style.display = 'none';
      if (keyInput) setTimeout(() => keyInput.focus(), 150);
    }
  }

  function toggleDrawerKeyVisibility() {
    const input = document.getElementById('drawerGeminiKeyInput');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
    }
  }

  async function testDrawerGeminiConnection() {
    const keyInput = document.getElementById('drawerGeminiKeyInput');
    const statusEl = document.getElementById('drawerAiTestStatus');
    const btn = document.getElementById('btnDrawerTestAi');

    const apiKey = keyInput ? keyInput.value.trim() : '';
    const fixedModel = DEFAULT_GEMINI_MODEL; // gemini-3.5-flash-lite

    if (!apiKey) {
      alert('Vui lòng dán Google Gemini API Key trước khi kiểm tra!');
      if (keyInput) keyInput.focus();
      return;
    }

    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#38bdf8';
      statusEl.innerHTML = `⏳ Đang gửi yêu cầu kiểm tra tới mô hình cố định <b>${fixedModel}</b>...`;
    }
    if (btn) btn.disabled = true;

    const t0 = performance.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fixedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hãy trả lời đúng từ 'OK' nếu bạn đã nhận được tin này." }] }]
        })
      });

      const t1 = performance.now();
      const latency = Math.round(t1 - t0);

      if (res.ok) {
        const data = await res.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'OK';
        if (statusEl) {
          statusEl.style.color = '#34d399';
          statusEl.innerHTML = `✅ <b>Kết nối Google Gemini thành công!</b> (Mô hình: <b>${fixedModel}</b>, Độ trễ: ${latency}ms)<br>Phản hồi từ AI: <i>${reply.trim()}</i>`;
        }
      } else {
        const err = await res.json().catch(() => ({}));
        const errMsg = err?.error?.message || `HTTP ${res.status}`;
        if (statusEl) {
          statusEl.style.color = '#f87171';
          statusEl.innerHTML = `❌ <b>Không gọi được API (${fixedModel}):</b> ${errMsg}`;
        }
      }
    } catch (e) {
      if (statusEl) {
        statusEl.style.color = '#f87171';
        statusEl.innerHTML = `❌ <b>Không gọi được API (${fixedModel}):</b> Lỗi mạng (${e.message})`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function saveDrawerGeminiSettings() {
    const keyInput = document.getElementById('drawerGeminiKeyInput');
    const apiKey = keyInput ? keyInput.value.trim() : '';
    const model = DEFAULT_GEMINI_MODEL;

    const cfg = { apiKey, model, enabled: true };
    saveAiConfig(cfg);

    toggleAiSettingsDrawer();

    if (apiKey) {
      if (typeof window.showToast === 'function') {
        window.showToast('✅ Đã kích hoạt Google Gemini Trực Tuyến thành công!');
      } else {
        alert('✅ Đã kích hoạt Google Gemini Trực Tuyến thành công!');
      }

      // Thêm thông báo chào mừng kích hoạt vào luồng chat
      chatHistory.push({
        id: 'online_activated_' + Date.now(),
        role: 'assistant',
        text: `🎉 **Đã kích hoạt Google Gemini ${model} Trực Tuyến thành công!**\nTừ bây giờ, tôi sẽ sử dụng toàn bộ trí tuệ nhân tạo online của Google để phân tích câu nói, hiểu ngữ cảnh và trò chuyện tự nhiên cùng bạn. Hãy thử hỏi hoặc ra lệnh cho tôi ngay nhé! ✨`,
        time: getCurrentTimeStr()
      });
      saveChatHistory();
      renderChatThread();
    } else {
      alert('Đã lưu cấu hình (chế độ Offline).');
    }
  }

  // --------------------------------------------------------------------------
  // 9. WEB SPEECH RECOGNITION (GIỌNG NÓI TIẾNG VIỆT & ĐỐI THOẠI LIÊN TỤC)
  // --------------------------------------------------------------------------
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognizer = new SpeechRecognition();
    recognizer.lang = 'vi-VN';
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = function () {
      isListening = true;
      voiceNoSpeechRetryCount = 0;
      updateVoiceUI(true);
      setAiStatusText(isContinuousVoiceActive ? 'Đang lắng nghe bạn nói... 🎙️ (Đối thoại liên tục)' : 'Đang lắng nghe bạn nói... 🎙️');
    };

    recognizer.onresult = function (event) {
      let interim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const input = document.getElementById('aiAssistantInput');
      if (input) {
        input.value = finalTranscript || interim;
      }
      if (finalTranscript) {
        // Tạm dừng micro trong khi trợ lý xử lý và sinh câu trả lời
        // NHƯNG BẢO LƯU cờ isContinuousVoiceActive = true!
        stopVoiceListening(true);
        isContinuousVoiceActive = true;
        submitAiPrompt(finalTranscript, true);
      }
    };

    recognizer.onerror = function (event) {
      console.warn('[AI Assistant] Lỗi giọng nói:', event.error);
      if (event.error === 'not-allowed') {
        stopVoiceListening();
        setAiStatusText('Microphone bị chặn. Hãy cấp quyền truy cập micro trong trình duyệt!');
        isContinuousVoiceActive = false;
      } else if (event.error === 'no-speech') {
        stopVoiceListening(true);
        if (isContinuousVoiceActive && !isThinking) {
          voiceNoSpeechRetryCount++;
          if (voiceNoSpeechRetryCount <= 2) {
            setAiStatusText('Chưa nghe rõ âm thanh... Vẫn đang đợi bạn nói 🎙️');
            if (voiceDialogueAutoRestartTimer) clearTimeout(voiceDialogueAutoRestartTimer);
            voiceDialogueAutoRestartTimer = setTimeout(() => {
              const modal = document.getElementById('aiAssistantModal');
              if (isContinuousVoiceActive && !isThinking && modal && modal.classList.contains('show')) {
                startVoiceListening(true);
              }
            }, 600);
            return;
          } else {
            setAiStatusText('Đã tạm dừng lắng nghe. Giữ Space 2s hoặc bấm mic để tiếp tục 🎙️');
            isContinuousVoiceActive = false;
          }
        } else {
          setAiStatusText('Không nghe rõ âm thanh. Hãy thử nói lại!');
        }
      } else {
        stopVoiceListening();
      }
    };

    recognizer.onend = function () {
      isListening = false;
      updateVoiceUI(false);
      updateAiStatusIndicator();
    };

    return recognizer;
  }

  function startVoiceListening(isContinuous = true) {
    const modal = document.getElementById('aiAssistantModal');
    if (!modal || !modal.classList.contains('show')) {
      isContinuousVoiceActive = false;
      return;
    }

    if (!speechRecognizer) {
      speechRecognizer = initSpeechRecognition();
    }
    if (!speechRecognizer) return;

    if (isContinuous) {
      isContinuousVoiceActive = true;
    }

    // Nếu TTS đang nói thì huỷ để nghe giọng người dùng
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      isTtsSpeaking = false;
    }

    if (!isListening) {
      try {
        speechRecognizer.start();
      } catch (e) {
        console.warn('[AI Voice] Speech start note:', e.message);
      }
    }
  }

  function toggleVoiceListening() {
    if (!speechRecognizer) {
      speechRecognizer = initSpeechRecognition();
    }
    if (!speechRecognizer) {
      alert('Trình duyệt của bạn chưa hỗ trợ nhận diện giọng nói Web Speech. Hãy dùng Google Chrome, Safari hoặc Edge!');
      return;
    }

    if (isListening) {
      isContinuousVoiceActive = false;
      stopVoiceListening();
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🔇 Đã tắt nhận diện giọng nói', 'secondary');
      }
    } else {
      isContinuousVoiceActive = true;
      startVoiceListening(true);
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🎙️ Đã kích hoạt giọng nói (Đối thoại liên tục)', 'info');
      }
    }
  }

  function stopVoiceListening(preserveContinuousMode = false) {
    if (!preserveContinuousMode) {
      isContinuousVoiceActive = false;
    }
    if (voiceDialogueAutoRestartTimer) {
      clearTimeout(voiceDialogueAutoRestartTimer);
      voiceDialogueAutoRestartTimer = null;
    }
    if (speechRecognizer && isListening) {
      try {
        speechRecognizer.stop();
      } catch (e) {}
      isListening = false;
      updateVoiceUI(false);
    }
  }

  function updateVoiceUI(listening) {
    const btn = document.getElementById('aiAssistantMicBtn');
    const orb = document.getElementById('aiSiriOrb');
    if (btn) {
      btn.classList.toggle('active-listening', listening);
      btn.classList.toggle('continuous-mode', isContinuousVoiceActive);
      btn.title = listening
        ? 'Đang nghe... Bấm để tắt mic (hoặc giữ Space 2s)'
        : 'Nói bằng giọng nói (Giữ Space 2s khi mở chat)';
    }
    if (orb) orb.classList.toggle('siri-listening', listening);
  }

  // --------------------------------------------------------------------------
  // 9.1 AI VOICE STUDIO & GIỌNG ĐỌC NỮ TIẾNG VIỆT TỰ NHIÊN (TTS DUAL-ENGINE)
  // --------------------------------------------------------------------------
  const AI_VOICE_CONFIG_KEY = 'mac_ai_voice_config_v2';
  const DEFAULT_VOICE_CONFIG = {
    enabled: true,
    region: 'bac',              // bac | nam | trung
    speed: 1.08,
    pitch: 1.12,
    provider: 'auto'            // auto | cloud | browser
  };

  const VOICE_SPEAKERS = {
    chi_google: {
      name: 'Chị Google',
      icon: '🌸',
      tag: 'Nữ Bắc Chuẩn',
      badge: '🌸 Chị Google (Nữ Bắc)',
      region: 'bac',
      persona: 'female_cheerful',
      speed: 1.08,
      pitch: 1.08,
      sampleText: 'Dạ em chào anh Công ạ! Em là chị Google, chúc anh một ngày làm việc thật vui vẻ và tràn đầy năng lượng nhé anh!'
    },
    thao_nhi: {
      name: 'Bé Thảo Nhi',
      icon: '🎀',
      tag: 'Nữ Trẻ Trung, Vui Tươi',
      badge: '🎀 Bé Thảo Nhi (Vui Tươi ✨)',
      region: 'bac',
      persona: 'female_quick',
      speed: 1.22,
      pitch: 1.25,
      sampleText: 'Dạ em chào anh Công ơi! Em là Thảo Nhi nè, chúc anh một ngày thật nhiều niềm vui và may mắn nha anh!'
    },
    thu_thao: {
      name: 'Cô Thu Thảo',
      icon: '💼',
      tag: 'Nữ Công Sở Điềm Đạm',
      badge: '💼 Cô Thu Thảo (Trầm Ấm)',
      region: 'bac',
      persona: 'female_pro',
      speed: 0.94,
      pitch: 0.92,
      sampleText: 'Dạ kính chào anh Công. Em là Thu Thảo, trợ lý số của anh. Em đã sẵn sàng hỗ trợ các công việc điều hành hôm nay ạ.'
    },
    mai_phuong: {
      name: 'Mai Phương',
      icon: '🌴',
      tag: 'Nữ Miền Nam Dễ Thương',
      badge: '🌴 Mai Phương (Miền Nam)',
      region: 'nam',
      persona: 'female_sweet',
      speed: 1.12,
      pitch: 1.12,
      sampleText: 'Dạ em chào anh Công nghen! Em là Mai Phương đây nè, chúc anh bữa nay làm việc thiệt là suôn sẻ và gặp nhiều may mắn nghen anh!'
    },
    huong_giang: {
      name: 'Hương Giang',
      icon: '🌊',
      tag: 'Nữ Miền Trung Duyên Dáng',
      badge: '🌊 Hương Giang (Miền Trung)',
      region: 'trung',
      persona: 'female_sweet',
      speed: 1.04,
      pitch: 1.06,
      sampleText: 'Dạ em chào anh Công nhen! Em là Hương Giang, chúc anh một ngày làm việc thật an vui và thuận lợi nhen anh!'
    },
    hoai_my: {
      name: 'Hoài My (AI Neural)',
      icon: '✨',
      tag: 'Microsoft Neural Thế Hệ Mới',
      badge: '✨ Hoài My (AI Cao Cấp)',
      region: 'bac',
      persona: 'female_pro',
      speed: 1.05,
      pitch: 1.10,
      sampleText: 'Dạ em chào anh Công ạ. Em là Hoài My, trợ lý AI thông minh, rất hân hạnh được đồng hành và hỗ trợ công việc cùng anh.'
    }
  };

  let activeSpeechAudio = null;
  let isSpeechPlaybackActive = false;

  // CƠ CHẾ UNLOCK ÂM THANH TRÌNH DUYỆT (Bypasses Browser Autoplay Restrictions)
  let isAudioContextUnlocked = false;
  function unlockAudioPlayback() {
    if (isAudioContextUnlocked) return;
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.volume = 0.01;
      const p = silentAudio.play();
      if (p !== undefined) {
        p.then(() => {
          silentAudio.pause();
          isAudioContextUnlocked = true;
        }).catch(() => {});
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!window.__aiAudioCtx) {
          window.__aiAudioCtx = new AudioCtx();
        }
        if (window.__aiAudioCtx.state === 'suspended') {
          window.__aiAudioCtx.resume();
        }
      }
    } catch (e) {}
  }

  // Tự động unlock âm thanh ngay khi người dùng chạm, bấm chuột hoặc phím
  ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(evt => {
    document.addEventListener(evt, unlockAudioPlayback, { once: false, passive: true });
  });

  // TỰ ĐỘNG CACHE & CẬP NHẬT DANH SÁCH GIỌNG NÓI TRÌNH DUYỆT (Async SpeechSynthesis Voices)
  let cachedSystemVoices = [];
  function refreshSystemVoices() {
    if ('speechSynthesis' in window) {
      try {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length) cachedSystemVoices = v;
      } catch (e) {}
    }
  }

  if ('speechSynthesis' in window) {
    refreshSystemVoices();
    try {
      window.speechSynthesis.onvoiceschanged = () => {
        refreshSystemVoices();
      };
    } catch (e) {}
  }

  function findBestVietnameseVoice() {
    refreshSystemVoices();
    const voices = (cachedSystemVoices && cachedSystemVoices.length) 
      ? cachedSystemVoices 
      : (('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : []);
    if (!voices || !voices.length) return null;

    // 1. Ưu tiên giọng Nữ Tiếng Việt tự nhiên chất lượng cao (Edge Online Natural, HoaiMy, Linh, An)
    const femaleNatural = voices.find(v => {
      const n = (v.name || '').toLowerCase();
      const l = (v.lang || '').toLowerCase();
      const isVi = l.includes('vi') || n.includes('vietnam') || n.includes('tiếng việt');
      const isFemale = n.includes('hoaimy') || n.includes('linh') || n.includes('an') || n.includes('female') || n.includes('nữ');
      return isVi && isFemale;
    });
    if (femaleNatural) return femaleNatural;

    // 2. Bất kỳ giọng tiếng Việt nào trong hệ thống
    const anyVi = voices.find(v => {
      const n = (v.name || '').toLowerCase();
      const l = (v.lang || '').toLowerCase();
      return l.includes('vi') || n.includes('vietnam') || n.includes('tiếng việt') || n.includes('hoaimy') || n.includes('namminh');
    });
    if (anyVi) return anyVi;

    return null;
  }

  function getAiVoiceConfig() {
    try {
      const saved = localStorage.getItem(AI_VOICE_CONFIG_KEY);
      if (saved) {
        return Object.assign({}, DEFAULT_VOICE_CONFIG, JSON.parse(saved));
      }
    } catch (e) {}
    const oldTts = localStorage.getItem('mac_ai_voice_tts');
    const cfg = Object.assign({}, DEFAULT_VOICE_CONFIG);
    if (oldTts !== null) cfg.enabled = (oldTts !== 'false');
    return cfg;
  }

  function saveAiVoiceConfig(cfg) {
    try {
      const merged = Object.assign({}, getAiVoiceConfig(), cfg);
      localStorage.setItem(AI_VOICE_CONFIG_KEY, JSON.stringify(merged));
      localStorage.setItem('mac_ai_voice_tts', merged.enabled ? 'true' : 'false');
      updateAiVoiceTtsMenuUI();
      return merged;
    } catch (e) {
      return cfg;
    }
  }

  function getAiVoiceTtsSetting() {
    return getAiVoiceConfig().enabled;
  }

  function toggleAiVoiceTtsSetting() {
    const cfg = getAiVoiceConfig();
    const nextVal = !cfg.enabled;
    cfg.enabled = nextVal;
    saveAiVoiceConfig(cfg);
    if (typeof window.showMacToast === 'function') {
      window.showMacToast(nextVal ? '🔊 Đã bật giọng nói phản hồi (TTS)' : '🔇 Đã tắt giọng nói phản hồi (TTS)', 'info');
    }
  }

  function updateAiVoiceTtsMenuUI() {
    const cfg = getAiVoiceConfig();
    const icon = document.getElementById('aiVoiceTtsIcon');
    const title = document.getElementById('aiVoiceTtsTitle');
    const desc = document.getElementById('aiVoiceTtsDesc');
    const isTts = cfg.enabled;
    if (icon) icon.textContent = isTts ? '🔊' : '🔇';
    if (title) title.textContent = `Giọng nói phản hồi: ${isTts ? 'BẬT' : 'TẮT'}`;
    if (desc) desc.textContent = isTts ? 'Trợ lý đọc câu trả lời và tự động lắng nghe tiếp' : 'Chỉ in chữ và tự động lắng nghe tiếp';

    const toggleInput = document.getElementById('voiceCfgEnabled');
    if (toggleInput) toggleInput.checked = isTts;
  }

  let activeSpeechPlaybackController = null;

  function stopAiVoicePlayback() {
    if (activeSpeechPlaybackController) {
      try {
        activeSpeechPlaybackController.abort();
      } catch (e) {}
      activeSpeechPlaybackController = null;
    }

    if (activeSpeechAudio) {
      try {
        activeSpeechAudio.pause();
        activeSpeechAudio.currentTime = 0;
        activeSpeechAudio.src = '';
      } catch (e) {}
      activeSpeechAudio = null;
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }

    isSpeechPlaybackActive = false;
    isTtsSpeaking = false;
    currentTtsUtterance = null;
    updateVoiceUI(isListening);
    updateAiStatusIndicator();
  }

  // Chuẩn hóa văn bản thành tiếng Việt tự nhiên, tròn vành rõ chữ và lịch thiệp
  function normalizeVietnameseSpeechText(text, config) {
    if (!text) return '';
    let str = String(text);

    // 1. Loại bỏ các thẻ nội bộ <ACTION_...> và HTML
    str = str.replace(/<ACTION_[\s\S]*?<\/ACTION_[\s\S]*?>/gi, '');
    str = str.replace(/<[^>]+>/g, '');
    str = str.replace(/```[\s\S]*?```/g, 'Em đã tạo đoạn mã xong cho anh rồi ạ.');

    // 2. Chuyển đổi số tiền tệ & ký hiệu số sang phát âm tiếng Việt tự nhiên
    str = str.replace(/(\d+)\s*k\b/gi, '$1 nghìn đồng');
    str = str.replace(/(\d+)\s*tr\b/gi, '$1 triệu đồng');
    str = str.replace(/(\d+)tr(\d+)\b/gi, '$1 triệu $2 trăm nghìn đồng');
    str = str.replace(/(\d+)\s*đ\b/gi, '$1 đồng');
    str = str.replace(/(\d+)\s*vnd\b/gi, '$1 đồng');

    // 3. Chuyển đổi thuật ngữ công nghệ sang phát âm thân thiện
    str = str.replace(/\bVietQR\b/gi, 'Việt quy rờ');
    str = str.replace(/\bAdmin\b/gi, 'quản trị viên');
    str = str.replace(/\bAPI\b/gi, 'A P I');
    str = str.replace(/\bDB\b/gi, 'cơ sở dữ liệu');
    str = str.replace(/\bSupabase\b/gi, 'Su-pa-bay-sơ');
    str = str.replace(/\bOK\b/gi, 'dạ được rồi ạ');
    str = str.replace(/\bok\b/gi, 'dạ được ạ');

    // 4. Xóa Markdown styling
    str = str.replace(/\*\*([^*]+)\*\*/g, '$1');
    str = str.replace(/\*([^*]+)\*/g, '$1');
    str = str.replace(/#{1,6}\s+/g, '');
    str = str.replace(/`([^`]+)`/g, '$1');
    str = str.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    str = str.replace(/[•\-\*]\s+/g, ', ');

    // 5. Xóa Emoji
    str = str.replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 6. Xóa khoảng trắng thừa
    str = str.replace(/\s+/g, ' ').trim();

    // 7. Tinh chỉnh từ ngữ và ngữ điệu theo vùng miền cho Kira
    const reg = (config && config.region) ? config.region : 'bac';

    if (reg === 'nam') {
      str = str.replace(/\bnhé anh\b/gi, 'nghen anh')
               .replace(/\bnhé\b/gi, 'nghen')
               .replace(/\bạ\b/gi, 'nè anh')
               .replace(/\bkhông sao\b/gi, 'hổng sao đâu nè')
               .replace(/\bkhông có gì\b/gi, 'hổng có chi đâu nè')
               .replace(/\bđược rồi\b/gi, 'được rồi nghen')
               .replace(/\bđã xong\b/gi, 'xong xuôi hết rồi nè')
               .replace(/\bvâng\b/gi, 'dạ')
               .replace(/\bxem\b/gi, 'coi')
               .replace(/\brất nhiều\b/gi, 'thiệt nhiều');
    } else if (reg === 'trung') {
      str = str.replace(/\bnhé anh\b/gi, 'nhen anh')
               .replace(/\bnhé\b/gi, 'nhen')
               .replace(/\bạ\b/gi, 'nhen anh')
               .replace(/\bkhông sao\b/gi, 'không can chi mô')
               .replace(/\bkhông có gì\b/gi, 'không có chi mô nhen')
               .replace(/\bđược rồi\b/gi, 'được rồi nhen')
               .replace(/\bđã xong\b/gi, 'làm xong rồi nhen anh')
               .replace(/\bvâng\b/gi, 'dạ')
               .replace(/\bthế à\b/gi, 'rứa hả anh');
    }

    return str;
  }

  // Tách văn bản thành các câu nhỏ (<= 170 ký tự) để Cloud Audio stream mượt mà
  function chunkSpeechText(text, maxLen = 170) {
    if (!text) return [];
    const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    const chunks = [];
    let cur = '';

    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if ((cur + ' ' + trimmed).trim().length <= maxLen) {
        cur = (cur + ' ' + trimmed).trim();
      } else {
        if (cur) chunks.push(cur);
        if (trimmed.length <= maxLen) {
          cur = trimmed;
        } else {
          const words = trimmed.split(' ');
          cur = '';
          for (const w of words) {
            if ((cur + ' ' + w).trim().length <= maxLen) {
              cur = (cur + ' ' + w).trim();
            } else {
              if (cur) chunks.push(cur);
              cur = w;
            }
          }
        }
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  // Phát âm thanh qua Cloud Natural Stream dạng HÀNG ĐỢI TUẦN TỰ (Sequential Audio Queue with Preloading)
  // Khắc phục triệt để lỗi đọc văn bản dài bị ngắt giữa chừng rồi tự bật mic!
  function playCloudSpeechStream(chunks, config, onComplete) {
    if (!chunks || !chunks.length) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    const cfg = (typeof config === 'object') ? config : { speed: config, pitch: 1.12 };
    const targetSpeed = cfg.speed || 1.08;
    const targetPitch = cfg.pitch || 1.12;
    const safeSpeed = Math.min(Math.max(targetSpeed || 1.08, 0.70), 1.6);
    const shiftPitch = (targetPitch > 1.14 || targetPitch < 0.98);

    let isAborted = false;
    let currentAudio = null;

    activeSpeechPlaybackController = {
      abort: () => {
        isAborted = true;
        if (currentAudio) {
          try {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio.src = '';
          } catch (e) {}
          currentAudio = null;
        }
      }
    };

    function tuneAudio(a) {
      try {
        a.playbackRate = safeSpeed;
        a.defaultPlaybackRate = safeSpeed;
        a.preservesPitch = !shiftPitch;
        if ('mozPreservesPitch' in a) a.mozPreservesPitch = !shiftPitch;
        if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = !shiftPitch;
      } catch (e) {}
    }

    function playChunkIndex(index) {
      if (isAborted) return;
      if (index >= chunks.length) {
        isSpeechPlaybackActive = false;
        isTtsSpeaking = false;
        activeSpeechAudio = null;
        activeSpeechPlaybackController = null;
        updateAiStatusIndicator();
        if (typeof onComplete === 'function') onComplete();
        return;
      }

      const chunk = chunks[index];
      const clients = ['tw-ob', 'gtx', 'dict-chrome-ex'];

      function tryClient(clientIdx) {
        if (isAborted) return;
        const client = clients[clientIdx] || 'tw-ob';
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=${client}&q=${encodeURIComponent(chunk)}`;

        const audio = new Audio();
        audio.referrerPolicy = 'no-referrer';
        currentAudio = audio;
        activeSpeechAudio = audio;

        tuneAudio(audio);
        audio.onplay = () => tuneAudio(audio);
        audio.onloadedmetadata = () => tuneAudio(audio);

        let isHandled = false;

        const handleNext = () => {
          if (isHandled || isAborted) return;
          isHandled = true;
          audio.onended = null;
          audio.onerror = null;
          audio.onplay = null;
          audio.onloadedmetadata = null;
          // Nghỉ một nhịp thở tự nhiên (100ms) trước khi sang câu kế tiếp
          setTimeout(() => {
            if (!isAborted) playChunkIndex(index + 1);
          }, 100);
        };

        const handleError = (err) => {
          if (isHandled || isAborted) return;
          isHandled = true;
          audio.onended = null;
          audio.onerror = null;
          console.warn(`[Kira Voice] Lỗi chunk ${index} trên client ${client}:`, err);

          if (clientIdx + 1 < clients.length) {
            // Thử client dự phòng sau 120ms
            setTimeout(() => {
              if (!isAborted) tryClient(clientIdx + 1);
            }, 120);
          } else {
            // Nếu các client Google đều bị lỗi mạng, thử fallback sang WebSpeech cho phần còn lại
            const viVoice = findBestVietnameseVoice();
            if (viVoice) {
              const remaining = chunks.slice(index).join(' ');
              playWebSpeechSynthesis(remaining, cfg, onComplete);
            } else {
              // Bỏ qua chunk này và tiếp tục phát các câu còn lại để không đứt đoạn bài đọc
              setTimeout(() => {
                if (!isAborted) playChunkIndex(index + 1);
              }, 150);
            }
          }
        };

        audio.onended = handleNext;
        audio.onerror = (e) => handleError(e);

        audio.src = url;
        audio.load();

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            tuneAudio(audio);
            // Preload trước chunk tiếp theo để chuyển câu tức thì không bị khựng
            if (index + 1 < chunks.length && !isAborted) {
              const nextUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunks[index + 1])}`;
              const prefetch = new Audio();
              prefetch.referrerPolicy = 'no-referrer';
              prefetch.preload = 'auto';
              prefetch.src = nextUrl;
            }
          }).catch(err => {
            handleError(err);
          });
        }
      }

      tryClient(0);
    }

    playChunkIndex(0);
  }

  // Phát âm thanh qua Web Speech Synthesis nội bộ trình duyệt
  function playWebSpeechSynthesis(text, config, onComplete) {
    if (!('speechSynthesis' in window)) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // KIỂM TRA CHẶT CHẼ: Chỉ đọc nếu hệ thống thực sự có giọng tiếng Việt (tránh giọng tiếng Anh đọc méo tiếng)
    const viVoice = findBestVietnameseVoice();
    if (!viVoice) {
      console.warn('[AI Voice] Trình duyệt không có giọng tiếng Việt nội bộ. Bỏ qua WebSpeech để tránh phát giọng tiếng Anh.');
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = viVoice;
      utterance.lang = viVoice.lang || 'vi-VN';
      utterance.rate = Math.min(Math.max(config.speed || 1.08, 0.7), 1.5);
      utterance.pitch = Math.min(Math.max(config.pitch || 1.12, 0.8), 1.4);

      let hasEnded = false;
      const finish = () => {
        if (!hasEnded) {
          hasEnded = true;
          utterance.onend = null;
          utterance.onerror = null;
          isSpeechPlaybackActive = false;
          isTtsSpeaking = false;
          currentTtsUtterance = null;
          updateAiStatusIndicator();
          if (typeof onComplete === 'function') onComplete();
        }
      };

      utterance.onend = finish;
      utterance.onerror = (err) => {
        console.warn('[AI Voice] Web Speech error:', err);
        finish();
      };

      // Bảo hiểm thời gian tránh trường hợp Web Speech bị treo
      const estimatedMs = Math.max(2000, text.length * 110);
      setTimeout(finish, estimatedMs + 3000);

      isSpeechPlaybackActive = true;
      isTtsSpeaking = true;
      currentTtsUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[Kira Voice] Web Speech failure:', e);
      if (typeof onComplete === 'function') onComplete();
    }
  }

  // Phát âm câu phản hồi của AI với cấu hình giọng nữ, tốc độ, vùng miền tùy chọn
  function speakAiResponse(text, onComplete) {
    const config = getAiVoiceConfig();
    if (!config.enabled) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    unlockAudioPlayback();
    stopAiVoicePlayback();

    let cleanText = normalizeVietnameseSpeechText(text, config);
    if (!cleanText) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // Đảm bảo phát âm trọn vẹn văn bản dài, không bị cắt cụt giữa chừng
    if (cleanText.length > 2500) {
      cleanText = cleanText.substring(0, 2450) + '...';
    }

    isSpeechPlaybackActive = true;
    isTtsSpeaking = true;
    setAiStatusText('Kira đang đọc câu trả lời... 🔊');

    const provider = config.provider || 'auto';

    if (provider === 'browser') {
      const viVoice = findBestVietnameseVoice();
      if (viVoice) {
        playWebSpeechSynthesis(cleanText, config, onComplete);
      } else {
        const chunks = chunkSpeechText(cleanText, 170);
        playCloudSpeechStream(chunks, config, onComplete);
      }
    } else if (provider === 'cloud') {
      const chunks = chunkSpeechText(cleanText, 170);
      playCloudSpeechStream(chunks, config, onComplete);
    } else {
      // Chế độ AUTO:
      // Ưu tiên giọng Edge HoaiMy Online Natural xịn, ngược lại dùng Cloud Audio Stream
      const viVoice = findBestVietnameseVoice();
      const hasNaturalEdgeVoice = viVoice && (
        (viVoice.name || '').includes('Natural') || 
        (viVoice.name || '').includes('Online') || 
        (viVoice.name || '').toLowerCase().includes('hoaimy')
      );

      if (hasNaturalEdgeVoice) {
        playWebSpeechSynthesis(cleanText, config, onComplete);
      } else {
        const chunks = chunkSpeechText(cleanText, 170);
        playCloudSpeechStream(chunks, config, onComplete);
      }
    }
  }

  function handlePostResponseVoiceLoop(replyText) {
    const modal = document.getElementById('aiAssistantModal');
    if (!modal || !modal.classList.contains('show') || !isContinuousVoiceActive) {
      return;
    }

    const cfg = getAiVoiceConfig();
    if (cfg.enabled && replyText) {
      speakAiResponse(replyText, () => {
        setTimeout(() => {
          const m = document.getElementById('aiAssistantModal');
          if (m && m.classList.contains('show') && isContinuousVoiceActive && !isThinking && !isSpeechPlaybackActive && !isTtsSpeaking) {
            startVoiceListening(true);
          }
        }, 350);
      });
    } else {
      setTimeout(() => {
        const m = document.getElementById('aiAssistantModal');
        if (m && m.classList.contains('show') && isContinuousVoiceActive && !isThinking && !isSpeechPlaybackActive && !isTtsSpeaking) {
          startVoiceListening(true);
        }
      }, 350);
    }
  }

  // --------------------------------------------------------------------------
  // 9.2 ĐIỀU KHIỂN GIAO DIỆN CÀI ĐẶT GIỌNG NÓI (VOICE STUDIO DRAWER CONTROLLERS)
  // --------------------------------------------------------------------------
  function toggleAiVoiceSettingsDrawer() {
    const drawer = document.getElementById('aiVoiceSettingsDrawer');
    if (!drawer) return;

    const isOpen = drawer.style.display === 'block';
    if (!isOpen) {
      // Đóng các drawer khác nếu đang mở
      const settingsDrawer = document.getElementById('aiSettingsDrawer');
      if (settingsDrawer) settingsDrawer.style.display = 'none';
      const memDrawer = document.getElementById('aiMemoryDrawer');
      if (memDrawer) memDrawer.style.display = 'none';

      populateVoiceDrawerFromConfig();
      drawer.style.display = 'block';
    } else {
      drawer.style.display = 'none';
      stopAiVoicePlayback();
    }
  }

  function populateVoiceDrawerFromConfig() {
    const cfg = getAiVoiceConfig();

    const enabledInput = document.getElementById('voiceCfgEnabled');
    if (enabledInput) enabledInput.checked = cfg.enabled;

    selectVoiceRegionUI(cfg.region || 'bac');

    const speedRange = document.getElementById('voiceSpeedRange');
    if (speedRange) {
      speedRange.value = cfg.speed || 1.08;
      updateVoiceSpeedDisplay(cfg.speed || 1.08);
    }

    const pitchRange = document.getElementById('voicePitchRange');
    if (pitchRange) {
      pitchRange.value = cfg.pitch || 1.12;
      updateVoicePitchDisplay(cfg.pitch || 1.12);
    }

    const providerSelect = document.getElementById('voiceProviderSelect');
    if (providerSelect) providerSelect.value = cfg.provider || 'auto';
  }

  function selectVoiceSpeaker(speakerKey) {
    // Tương thích ngược
  }

  function selectVoiceSpeakerUI(speakerKey) {
    // Tương thích ngược
  }

  function selectVoicePersona(personaKey) {
    // Tương thích ngược
  }

  function selectVoicePersonaUI(personaKey) {
    // Tương thích ngược
  }

  function selectVoiceRegion(regionKey) {
    selectVoiceRegionUI(regionKey);
  }

  function selectVoiceRegionUI(regionKey) {
    document.querySelectorAll('#voiceRegionGroup .voice-segment-btn').forEach(btn => {
      const isSelected = btn.getAttribute('data-region') === regionKey;
      btn.classList.toggle('active', isSelected);
    });

    const badge = document.getElementById('voiceRegionBadge');
    if (badge) {
      const names = {
        bac: '🏛️ Miền Bắc (Hà Nội)',
        nam: '🌴 Miền Nam (Sài Gòn)',
        trung: '🌊 Miền Trung'
      };
      badge.textContent = names[regionKey] || 'Miền Bắc';
    }
  }

  function updateVoiceSpeedDisplay(val) {
    const el = document.getElementById('voiceSpeedVal');
    if (el) el.textContent = Number(val).toFixed(2) + 'x';
  }

  function updateVoicePitchDisplay(val) {
    const el = document.getElementById('voicePitchVal');
    if (!el) return;
    const num = Number(val);
    if (num < 1.0) el.textContent = 'Trầm ấm';
    else if (num <= 1.08) el.textContent = 'Chuẩn';
    else if (num <= 1.18) el.textContent = 'Vui tươi ✨';
    else el.textContent = 'Trẻ trung 🌸';
  }

  function handleVoiceSettingChange() {
    // Callback event
  }

  function getDrawerVoiceConfig() {
    const enabledInput = document.getElementById('voiceCfgEnabled');
    const activeRegionBtn = document.querySelector('#voiceRegionGroup .voice-segment-btn.active');
    const speedRange = document.getElementById('voiceSpeedRange');
    const pitchRange = document.getElementById('voicePitchRange');
    const providerSelect = document.getElementById('voiceProviderSelect');

    return {
      enabled: enabledInput ? enabledInput.checked : true,
      region: activeRegionBtn ? activeRegionBtn.getAttribute('data-region') : 'bac',
      speed: speedRange ? parseFloat(speedRange.value) : 1.08,
      pitch: pitchRange ? parseFloat(pitchRange.value) : 1.12,
      provider: providerSelect ? providerSelect.value : 'auto'
    };
  }

  function saveVoiceSettingsFromDrawer() {
    const cfg = getDrawerVoiceConfig();
    saveAiVoiceConfig(cfg);

    const statusEl = document.getElementById('voicePreviewStatus');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#34d399';
      statusEl.innerHTML = `✅ <b>Đã lưu cấu hình giọng đọc Kira (${cfg.speed.toFixed(2)}x)!</b>`;
      setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3000);
    }

    if (typeof window.showMacToast === 'function') {
      window.showMacToast('💾 Đã lưu cấu hình giọng đọc Kira!', 'success');
    }

    toggleAiVoiceSettingsDrawer();
  }

  function previewCurrentVoiceSettings() {
    unlockAudioPlayback();
    const cfg = getDrawerVoiceConfig();
    const btn = document.getElementById('btnPreviewVoice');
    const statusEl = document.getElementById('voicePreviewStatus');

    if (btn) btn.innerHTML = '🔊 Đang đọc thử...';
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#38bdf8';
      statusEl.innerHTML = '⏳ Kira đang phát âm câu chào thử nghiệm...';
    }

    let sampleSentence = '';
    if (cfg.region === 'nam') {
      sampleSentence = 'Dạ em chào anh Công nghen! Em là Kira đây nè. Chúc anh một ngày làm việc thật nhiều niềm vui và thuận lợi nghen!';
    } else if (cfg.region === 'trung') {
      sampleSentence = 'Dạ em chào anh Công nhen! Em là Kira. Chúc anh một ngày làm việc thật an vui và thuận lợi nhen anh!';
    } else {
      sampleSentence = 'Dạ em chào anh Công ạ! Em là Kira. Chúc anh một ngày làm việc thật vui vẻ và tràn đầy năng lượng nhé!';
    }

    stopAiVoicePlayback();

    const cleanText = normalizeVietnameseSpeechText(sampleSentence, cfg);
    const chunks = chunkSpeechText(cleanText, 170);

    const onFinish = () => {
      if (btn) btn.innerHTML = '▶️ Nghe Thử Giọng Này';
      if (statusEl) {
        statusEl.style.color = '#34d399';
        statusEl.innerHTML = `✨ Đã phát âm thử thành công (${cfg.speed.toFixed(2)}x)!`;
        setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3000);
      }
    };

    if (cfg.provider === 'browser') {
      const viVoice = findBestVietnameseVoice();
      if (viVoice) {
        playWebSpeechSynthesis(cleanText, cfg, onFinish);
      } else {
        playCloudSpeechStream(chunks, cfg, onFinish);
      }
    } else if (cfg.provider === 'cloud') {
      playCloudSpeechStream(chunks, cfg, onFinish);
    } else {
      const viVoice = findBestVietnameseVoice();
      const hasNaturalEdgeVoice = viVoice && (
        (viVoice.name || '').includes('Natural') || 
        (viVoice.name || '').includes('Online') || 
        (viVoice.name || '').toLowerCase().includes('hoaimy')
      );
      if (hasNaturalEdgeVoice) {
        playWebSpeechSynthesis(cleanText, cfg, onFinish);
      } else {
        playCloudSpeechStream(chunks, cfg, onFinish);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 10. HIỂN THỊ, ĐÓNG MỞ, KÉO THẢ CỬA SỔ & TIỆN ÍCH MODAL
  // --------------------------------------------------------------------------
  let isAiWindowDragging = false;
  let aiDragStartX = 0;
  let aiDragStartY = 0;
  let aiBoxInitialLeft = 0;
  let aiBoxInitialTop = 0;

  function setupAiWindowDrag() {
    const header = document.getElementById('aiBoxHeader');
    const box = document.getElementById('aiAssistantBox');
    if (!box) return;

    // Nhấp vào bất kỳ vùng nào của cửa sổ AI Assistant để nổi lên layout trên cùng
    if (!box.dataset.focusBound) {
      box.dataset.focusBound = 'true';
      const raiseAi = () => {
        if (typeof window.bringAiToFront === 'function') {
          window.bringAiToFront();
        }
      };
      box.addEventListener('pointerdown', raiseAi, true);
      box.addEventListener('mousedown', raiseAi, true);
    }

    if (!header || header.dataset.dragInitialized) return;
    header.dataset.dragInitialized = 'true';

    function onStartDrag(clientX, clientY, target) {
      if (box.classList.contains('is-maximized')) return;
      if (window.innerWidth <= 768) return; // Không kéo di chuyển cửa sổ khi ở giao diện điện thoại (Full Native View)
      if (target.closest('button') || target.closest('input') || target.closest('a') || target.closest('select')) {
        return;
      }

      isAiWindowDragging = true;
      aiDragStartX = clientX;
      aiDragStartY = clientY;

      const rect = box.getBoundingClientRect();
      aiBoxInitialLeft = rect.left;
      aiBoxInitialTop = rect.top;

      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onEndDrag);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onEndDrag);
    }

    function onMouseMove(e) {
      if (!isAiWindowDragging) return;
      doDrag(e.clientX, e.clientY);
    }

    function onTouchMove(e) {
      if (!isAiWindowDragging || !e.touches || !e.touches[0]) return;
      e.preventDefault();
      doDrag(e.touches[0].clientX, e.touches[0].clientY);
    }

    function doDrag(currentX, currentY) {
      const deltaX = currentX - aiDragStartX;
      const deltaY = currentY - aiDragStartY;

      let newLeft = aiBoxInitialLeft + deltaX;
      let newTop = aiBoxInitialTop + deltaY;

      const minLeft = 10;
      const maxLeft = Math.max(minLeft, window.innerWidth - box.offsetWidth - 10);
      const minTop = 32; // thanh Topbar macOS
      const maxTop = Math.max(minTop, window.innerHeight - 60);

      newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
      newTop = Math.max(minTop, Math.min(newTop, maxTop));

      box.style.left = newLeft + 'px';
      box.style.top = newTop + 'px';
    }

    function onEndDrag() {
      isAiWindowDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onEndDrag);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onEndDrag);
    }

    header.addEventListener('mousedown', (e) => {
      onStartDrag(e.clientX, e.clientY, e.target);
    });

    header.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        onStartDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
      }
    }, { passive: true });
  }

  // Thu nhỏ cửa sổ AI thành biểu tượng quả cầu lơ lửng có thể kéo thả
  function minimizeAiAssistant() {
    const modal = document.getElementById('aiAssistantModal');
    const box = document.getElementById('aiAssistantBox');
    if (modal) {
      modal.classList.remove('show');
    }
    if (box) {
      box.classList.remove('is-maximized');
    }
    stopVoiceListening();
    stopAiVoicePlayback();
    isContinuousVoiceActive = false;
    if (typeof window.syncHistoryToHome === 'function') {
      window.syncHistoryToHome();
    }
    showFloatingAiOrb();
  }

  function showFloatingAiOrb() {
    const orb = document.getElementById('aiFloatingOrb');
    if (!orb) return;

    // Khôi phục toạ độ lưu nếu có
    try {
      const savedPos = JSON.parse(localStorage.getItem('mac_ai_floating_orb_pos') || 'null');
      if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        const maxL = Math.max(10, window.innerWidth - 70);
        const maxT = Math.max(36, window.innerHeight - 70);
        orb.style.left = Math.min(Math.max(10, savedPos.left), maxL) + 'px';
        orb.style.top = Math.min(Math.max(36, savedPos.top), maxT) + 'px';
        orb.style.right = 'auto';
        orb.style.bottom = 'auto';
      }
    } catch (e) {}

    orb.style.display = 'flex';
    setupFloatingOrbGestures();
  }

  // Khôi phục cửa sổ AI từ biểu tượng lơ lửng khi click đúp chuột
  function restoreAiFromFloatingOrb() {
    const orb = document.getElementById('aiFloatingOrb');
    if (orb) {
      orb.style.display = 'none';
    }
    showAiAssistantModal();
  }

  let isFloatingOrbGesturesBound = false;
  function setupFloatingOrbGestures() {
    const orb = document.getElementById('aiFloatingOrb');
    if (!orb || isFloatingOrbGesturesBound) return;
    isFloatingOrbGesturesBound = true;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let hasMoved = false;
    let lastTapTime = 0;

    // 1. Kích hoạt lại bằng cách click đúp chuột (Double Click)
    orb.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      restoreAiFromFloatingOrb();
    });

    // 2. Kéo di chuyển tự do khắp màn hình (Pointer Drag & Drop)
    orb.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return; // Chỉ nhận chuột trái
      e.preventDefault();

      // Hỗ trợ double tap trên màn hình cảm ứng
      const now = Date.now();
      if (now - lastTapTime < 340) {
        restoreAiFromFloatingOrb();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = orb.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      try {
        orb.setPointerCapture(e.pointerId);
      } catch (err) {}

      function onPointerMove(ev) {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (Math.hypot(dx, dy) > 5) {
          hasMoved = true;
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const maxL = Math.max(10, window.innerWidth - orb.offsetWidth - 10);
        const maxT = Math.max(36, window.innerHeight - orb.offsetHeight - 10);

        newLeft = Math.max(10, Math.min(newLeft, maxL));
        newTop = Math.max(36, Math.min(newTop, maxT));

        orb.style.left = newLeft + 'px';
        orb.style.top = newTop + 'px';
        orb.style.right = 'auto';
        orb.style.bottom = 'auto';
      }

      function onPointerUp(ev) {
        if (!isDragging) return;
        isDragging = false;
        try {
          orb.releasePointerCapture(ev.pointerId);
        } catch (err) {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (hasMoved) {
          try {
            const finalRect = orb.getBoundingClientRect();
            localStorage.setItem('mac_ai_floating_orb_pos', JSON.stringify({
              left: Math.round(finalRect.left),
              top: Math.round(finalRect.top)
            }));
          } catch (e) {}
        }
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  }

  function toggleMaximizeAiAssistant() {
    const box = document.getElementById('aiAssistantBox');
    if (box) {
      if (box.classList.contains('is-minimized')) {
        box.classList.remove('is-minimized');
      }
      box.classList.toggle('is-maximized');
    }
  }

  function showAiAssistantModal() {
    const modal = document.getElementById('aiAssistantModal');
    const box = document.getElementById('aiAssistantBox');
    const orb = document.getElementById('aiFloatingOrb');
    if (orb) {
      orb.style.display = 'none';
    }

    if (modal) {
      modal.classList.add('show');
      if (typeof window.pushDashboardNavState === 'function') {
        window.pushDashboardNavState('ai');
      }
      if (box) {
        if (box.classList.contains('is-minimized')) {
          box.classList.remove('is-minimized');
        }
        if (window.innerWidth <= 768) {
          box.style.left = '';
          box.style.top = '';
          box.style.right = '';
          box.style.bottom = '';
          box.style.width = '';
          box.style.height = '';
        }
      }
      setupAiWindowDrag();

      // Đưa cửa sổ AI lên trên cùng
      if (typeof window.bringAiToFront === 'function') {
        window.bringAiToFront();
      }

      if (!chatHistory || !chatHistory.length) {
        loadChatHistory();
      }
      renderChatThread();
      updateAiStatusIndicator();
      updateAiAdminBadge();
      const input = document.getElementById('aiAssistantInput');
      if (input) setTimeout(() => input.focus(), 120);
    }
  }

  function closeAiAssistant() {
    const modal = document.getElementById('aiAssistantModal');
    if (modal) {
      modal.classList.remove('show');
    }
    const orb = document.getElementById('aiFloatingOrb');
    if (orb) {
      orb.style.display = 'none';
    }
    const drawer = document.getElementById('aiSettingsDrawer');
    if (drawer) drawer.style.display = 'none';
    const voiceDrawer = document.getElementById('aiVoiceSettingsDrawer');
    if (voiceDrawer) voiceDrawer.style.display = 'none';
    stopVoiceListening();
    stopAiVoicePlayback();
    isContinuousVoiceActive = false;
    if (typeof window.syncHistoryToHome === 'function') {
      window.syncHistoryToHome();
    }
  }

  function toggleAiAssistant(event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('aiAssistantModal');
    if (modal && modal.classList.contains('show')) {
      closeAiAssistant();
    } else {
      showAiAssistantModal();
    }
  }

  // --------------------------------------------------------------------------
  // 10.1 XỬ LÝ HÌNH ẢNH HÓA ĐƠN / BILL (OCR & MULTIMODAL VISION)
  // --------------------------------------------------------------------------
  function triggerBillImageUpload() {
    const fileInput = document.getElementById('aiBillFileInput');
    if (fileInput) {
      fileInput.click();
    }
  }

  function handleBillImageSelected(event) {
    const file = event.target?.files?.[0];
    if (file) {
      handleBillImageFile(file);
    }
  }

  function handleBillImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ Vui lòng chọn một tệp hình ảnh (JPEG, PNG, WebP)!');
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type || 'image/jpeg';

      pendingBillImage = {
        dataUrl,
        base64,
        mimeType,
        name: file.name || 'hoa_don.jpg',
        size: file.size
      };

      showImagePreviewStrip(pendingBillImage);
    };
    reader.readAsDataURL(file);
  }

  function showImagePreviewStrip(imgData) {
    const strip = document.getElementById('aiImagePreviewStrip');
    const previewImg = document.getElementById('aiImagePreviewImg');
    const nameEl = document.getElementById('aiImagePreviewName');
    const sizeEl = document.getElementById('aiImagePreviewSize');

    if (strip && previewImg) {
      previewImg.src = imgData.dataUrl;
      if (nameEl) nameEl.textContent = imgData.name;
      const sizeKb = Math.round((imgData.size || 0) / 1024);
      if (sizeEl) sizeEl.textContent = `${sizeKb > 0 ? sizeKb + ' KB • ' : ''}Hình ảnh đã đính kèm. Vui lòng nhập câu lệnh của bạn bên dưới`;
      strip.style.display = 'flex';

      const input = document.getElementById('aiAssistantInput');
      if (input) {
        input.placeholder = 'Nhập câu lệnh / yêu cầu của bạn cho hình ảnh này rồi bấm Gửi...';
        input.focus();
      }
    }
  }

  function removePendingBillImage() {
    pendingBillImage = null;
    const strip = document.getElementById('aiImagePreviewStrip');
    if (strip) strip.style.display = 'none';
    const previewImg = document.getElementById('aiImagePreviewImg');
    if (previewImg) previewImg.src = '';
    const fileInput = document.getElementById('aiBillFileInput');
    if (fileInput) fileInput.value = '';
    const input = document.getElementById('aiAssistantInput');
    if (input) {
      input.placeholder = 'Trò chuyện, gửi ảnh bill (Ctrl+V) hoặc ra lệnh...';
    }
  }

  function hideImagePreviewStrip() {
    const strip = document.getElementById('aiImagePreviewStrip');
    if (strip) strip.style.display = 'none';
    const previewImg = document.getElementById('aiImagePreviewImg');
    if (previewImg) previewImg.src = '';
    const fileInput = document.getElementById('aiBillFileInput');
    if (fileInput) fileInput.value = '';
    const input = document.getElementById('aiAssistantInput');
    if (input) {
      input.placeholder = 'Trò chuyện, gửi ảnh bill (Ctrl+V) hoặc ra lệnh...';
    }
  }

  function setupImagePasteAndDrop() {
    const input = document.getElementById('aiAssistantInput');
    if (input && !input.dataset.pasteDropInit) {
      input.dataset.pasteDropInit = 'true';
      input.addEventListener('paste', function (e) {
        const items = (e.clipboardData || window.clipboardData)?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            if (blob) {
              handleBillImageFile(blob);
              e.preventDefault();
              break;
            }
          }
        }
      });
    }

    const modal = document.getElementById('aiAssistantModal');
    if (modal && !modal.dataset.dropInit) {
      modal.dataset.dropInit = 'true';
      modal.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      modal.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer?.files;
        if (files && files.length > 0 && files[0].type.startsWith('image/')) {
          handleBillImageFile(files[0]);
        }
      });
    }
  }

  function submitAiPrompt(promptText, isFromVoice = false) {
    const input = document.getElementById('aiAssistantInput');
    let query = (promptText !== undefined && promptText !== null) ? promptText : (input ? input.value : '');

    // Nếu người dùng gửi bằng phím Enter hoặc nút bấm Send thủ công (không phải từ giọng nói)
    if (!isFromVoice) {
      isContinuousVoiceActive = false;
      stopVoiceListening();
    } else {
      isContinuousVoiceActive = true;
    }

    // Nhận diện lệnh tắt micro rảnh tay bằng giọng nói
    const norm = (query || '').toLowerCase().trim();
    if (norm === 'dừng lại' || norm === 'tạm dừng' || norm === 'dừng' || norm === 'tắt mic' || norm === 'thôi' || norm === 'thôi em' || norm === 'kết thúc') {
      isContinuousVoiceActive = false;
      stopVoiceListening();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (input) input.value = '';
      setAiStatusText('Đã tắt nhận diện giọng nói. Bấm mic hoặc giữ Space 2s để tiếp tục!');
      if (typeof window.showMacToast === 'function') {
        window.showMacToast('🔇 Đã tắt nhận diện giọng nói', 'secondary');
      }
      return;
    }

    // QUY TẮC CẬP NHẬT: Nếu có hình ảnh đính kèm mà người dùng chưa nhập câu lệnh,
    // KHÔNG tự động chèn prompt mặc định! Bắt buộc người dùng nhập prompt thủ công.
    if ((!query || !query.trim()) && pendingBillImage) {
      const warningMsg = '⚠️ Vui lòng nhập câu lệnh hoặc yêu cầu của bạn trước khi gửi ảnh!';
      if (typeof window.showToast === 'function') {
        window.showToast(warningMsg);
      } else if (typeof window.showMacToast === 'function') {
        window.showMacToast(warningMsg, 'warning');
      }
      if (input) {
        input.placeholder = '⚠️ Nhập yêu cầu cho ảnh này rồi bấm Gửi...';
        input.focus();
        input.classList.add('ai-input-warning');
        setTimeout(() => input.classList.remove('ai-input-warning'), 1500);
      }
      return;
    }

    if (!query || !query.trim()) return;

    if (input) input.value = '';
    processUserInput(query);
  }

  function openAppById(appId) {
    // Mở hoặc focus app bằng window.openApp của Dashboard
    if (typeof window.openApp === 'function') {
      window.openApp(appId);
    } else if (window.dashboard && typeof window.dashboard.openApp === 'function') {
      window.dashboard.openApp(appId);
    }
  }

  // CẦU NỐI ĐỒNG BỘ FORM NHẬP LIỆU GIỮA AI VÀ CÁC ỨNG DỤNG (FORM SYNC PROTOCOL)
  function dispatchToAppWindow(appIdentifier, messageObj) {
    openAppById(appIdentifier);

    const send = () => {
      let dispatched = false;
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          const src = ifr.getAttribute('src') || '';
          if (src.includes(appIdentifier) || 
             (appIdentifier === 'tien-com' && (src.includes('tien-com') || src.includes('tiencom'))) ||
             (appIdentifier === 'chia-bill' && (src.includes('chia-bill') || src.includes('chiabill'))) ||
             (appIdentifier === 'ghi-chu' && (src.includes('ghi-chu') || src.includes('ghichu'))) ||
             (appIdentifier === 'danh-ba' && (src.includes('danh-ba') || src.includes('danhba')))) {
            ifr.contentWindow.postMessage(messageObj, '*');
            dispatched = true;
          }
        } catch (e) {}
      });
      return dispatched;
    };

    send();
    setTimeout(send, 300);
    setTimeout(send, 700);

    // Broadcast tới các tab khác nếu người dùng mở ngoài tab
    window.postMessage(messageObj, '*');
  }

  window.aiFillMealFormApp = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    const payload = {
      date: data.date,
      payerName: data.payerName,
      dishName: data.dishName || 'Cơm trưa',
      amountPerPerson: data.amountPerPerson,
      amount: data.amountPerPerson * (data.eaters ? data.eaters.length : 1),
      participants: data.eaters
    };

    dispatchToAppWindow('tien-com', {
      type: 'AI_FILL_MEAL_FORM',
      payload: payload
    });

    if (typeof window.showMacToast === 'function') {
      window.showMacToast('📋 Đã mở & điền sẵn dữ liệu vào App Tính Tiền Cơm!', 'success');
    }
  };

  window.aiFillBillFormApp = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    const payload = {
      title: data.title || 'Khoản chi chia tiền',
      date: data.date,
      totalCost: data.totalAmount,
      amount: data.totalAmount,
      payerName: data.payerName,
      participants: data.participants,
      expenseItems: data.expenseItems || [{ title: data.title || 'Khoản chi chia tiền', amount: data.totalAmount }]
    };

    dispatchToAppWindow('chia-bill', {
      type: 'AI_FILL_BILL_FORM',
      payload: payload
    });

    if (typeof window.showMacToast === 'function') {
      window.showMacToast('📋 Đã mở & điền sẵn dữ liệu vào App Chia Bill!', 'success');
    }
  };

  window.aiFillNoteFormApp = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    const payload = {
      text: data.text,
      title: data.text,
      details: data.details || '',
      deadline: data.deadline,
      type: data.noteType || 'todo',
      mode: data.noteType || 'todo',
      priority: data.priority || 'medium',
      tags: data.tags || ''
    };

    dispatchToAppWindow('ghi-chu', {
      type: 'AI_FILL_NOTE_FORM',
      payload: payload
    });

    if (typeof window.showMacToast === 'function') {
      window.showMacToast('🔔 Đã mở & điền sẵn dữ liệu vào Reminders & Notes!', 'success');
    }
  };

  window.aiFillContactFormApp = function (msgId) {
    const data = activeConfirmationData[msgId];
    if (!data) return;

    const payload = {
      fullName: data.fullName,
      nickname: data.nickname,
      phone: data.phone,
      dob: data.dob,
      bankId: data.bankId,
      accountNo: data.accountNo,
      accountName: (data.accountName || data.fullName || '').toUpperCase(),
      note: data.role || ''
    };

    dispatchToAppWindow('danh-ba', {
      type: 'AI_FILL_CONTACT_FORM',
      payload: payload
    });

    if (typeof window.showMacToast === 'function') {
      window.showMacToast('📋 Đã mở & điền sẵn dữ liệu vào App Danh Bạ!', 'success');
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --------------------------------------------------------------------------
  // 11. KHỞI TẠO & PHÍM TẮT THÔNG MINH (TRIPLE SPACE & GIỮ SPACE 2 GIÂY)
  // --------------------------------------------------------------------------
  let spacePressTimestamps = [];
  let spaceHoldTimer = null;
  let isSpaceHoldTriggered = false;
  let isSpaceKeyDown = false;

  function showSpaceHoldProgress() {
    const btn = document.getElementById('aiAssistantMicBtn');
    if (btn) btn.classList.add('space-holding');
    setAiStatusText('Đang giữ Space... (2s) để bật/tắt micro 🎙️');
  }

  function clearSpaceHoldVisuals() {
    const btn = document.getElementById('aiAssistantMicBtn');
    if (btn) btn.classList.remove('space-holding');
    updateAiStatusIndicator();
  }

  function handleGlobalSpaceKeyDown(e, targetDoc) {
    if (e.code !== 'Space' && e.key !== ' ' && e.keyCode !== 32) return;

    // Phím tắt macOS Spotlight: Ctrl+Space hoặc Cmd+Space
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleAiAssistant();
      return;
    }

    // Bỏ qua sự kiện auto-repeat của hệ điều hành khi đè giữ phím
    if (e.repeat) return;

    const modal = document.getElementById('aiAssistantModal');
    const isAiOpen = Boolean(modal && modal.classList.contains('show'));
    const now = Date.now();
    const doc = targetDoc || document;
    const activeEl = doc.activeElement;
    const isInputFocused = Boolean(activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    ));

    // -----------------------------------------------------------------------
    // 1. NHẤN PHÍM CÁCH 3 LẦN NHANH (TRIPLE SPACE) -> MỞ / THU NHỎ CHATBOT
    // -----------------------------------------------------------------------
    spacePressTimestamps = spacePressTimestamps.filter(t => (now - t) <= 650);
    spacePressTimestamps.push(now);

    if (spacePressTimestamps.length >= 3) {
      e.preventDefault();
      spacePressTimestamps = [];

      if (spaceHoldTimer) {
        clearTimeout(spaceHoldTimer);
        spaceHoldTimer = null;
      }
      clearSpaceHoldVisuals();

      // Dọn dẹp ký tự khoảng trắng thừa vừa nhập ở 2 lần nhấn trước
      if (isInputFocused && typeof activeEl.value === 'string') {
        activeEl.value = activeEl.value.replace(/ {1,3}$/, '');
      }

      if (isAiOpen) {
        // "và làm tương tự để thu nhỏ"
        minimizeAiAssistant();
        if (typeof window.showMacToast === 'function') {
          window.showMacToast('🔽 Đã thu nhỏ Kira (Phím cách 3 lần)', 'secondary');
        }
      } else {
        // "nhấn phím cach 3 lần để gọi chat bot lên"
        showAiAssistantModal();
        if (typeof window.showMacToast === 'function') {
          window.showMacToast('✨ Đã mở Kira (Phím cách 3 lần)', 'info');
        }
      }
      return;
    }

    // -----------------------------------------------------------------------
    // 2. GIỮ PHÍM CÁCH 2 GIÂY KHI CHATBOT ĐANG BẬT -> BẬT/TẮT NHẬN DIỆN GIỌNG NÓI
    // -----------------------------------------------------------------------
    if (isAiOpen) {
      isSpaceKeyDown = true;
      isSpaceHoldTriggered = false;

      // Nếu không phải đang nhập liệu văn bản thì ngăn cuộn trang web
      if (!isInputFocused) {
        e.preventDefault();
      }

      showSpaceHoldProgress();

      if (spaceHoldTimer) clearTimeout(spaceHoldTimer);
      spaceHoldTimer = setTimeout(() => {
        isSpaceHoldTriggered = true;
        clearSpaceHoldVisuals();

        // Kích hoạt hoặc tắt nhận diện giọng nói
        toggleVoiceListening();

        // Dọn dẹp khoảng trắng thừa nếu đang gõ trong ô input
        if (isInputFocused && typeof activeEl.value === 'string') {
          activeEl.value = activeEl.value.replace(/ +$/, '');
        }

        try {
          if (window.soundEngine && typeof window.soundEngine.play === 'function') {
            window.soundEngine.play('macos_pop');
          }
        } catch (err) {}

        const nowListening = isListening;
        if (typeof window.showMacToast === 'function') {
          window.showMacToast(
            nowListening ? '🎙️ Đã kích hoạt nhận diện giọng nói (Giữ Space 2s)' : '🔇 Đã tắt nhận diện giọng nói',
            nowListening ? 'info' : 'secondary'
          );
        }
      }, 2000);
    }
  }

  function handleGlobalSpaceKeyUp(e, targetDoc) {
    if (e.code !== 'Space' && e.key !== ' ' && e.keyCode !== 32) return;

    isSpaceKeyDown = false;
    clearSpaceHoldVisuals();

    if (spaceHoldTimer) {
      clearTimeout(spaceHoldTimer);
      spaceHoldTimer = null;
    }

    if (isSpaceHoldTriggered) {
      isSpaceHoldTriggered = false;
      spacePressTimestamps = [];
      const doc = targetDoc || document;
      const activeEl = doc.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        activeEl.value = activeEl.value.replace(/ +$/, '');
      }
      e.preventDefault();
    }
  }

  function attachSpaceShortcutsToWindow(targetWin) {
    if (!targetWin) return;
    try {
      targetWin.addEventListener('keydown', (e) => handleGlobalSpaceKeyDown(e, targetWin.document), { capture: true });
      targetWin.addEventListener('keyup', (e) => handleGlobalSpaceKeyUp(e, targetWin.document), { capture: true });
    } catch (err) {}
  }

  function setupIframeSpaceShortcutBridges() {
    const bindToIframes = () => {
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          if (ifr.contentWindow && !ifr.dataset.spaceShortcutBound) {
            ifr.dataset.spaceShortcutBound = 'true';
            attachSpaceShortcutsToWindow(ifr.contentWindow);
          }
        } catch (e) {}
      });
    };

    bindToIframes();
    const observer = new MutationObserver(() => bindToIframes());
    const container = document.getElementById('windows-container') || document.body;
    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('aiAssistantModal');
      if (modal && modal.classList.contains('show')) {
        closeAiAssistant();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    loadAiPersonalMemory();
    loadChatHistory();
    updateAiStatusIndicator();
    updateAiAdminBadge();
    setupAiWindowDrag();
    setupImagePasteAndDrop();
    setupFloatingOrbGestures();
    attachSpaceShortcutsToWindow(window);
    setupIframeSpaceShortcutBridges();
    updateAiVoiceTtsMenuUI();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'sys_is_admin' || e.key === 'mac_admin_mode') {
      updateAiAdminBadge();
    }
  });

  window.addEventListener('admin_status_changed', (e) => {
    updateAiAdminBadge(e.detail ? e.detail.isAdmin : undefined);
  });

  if ('BroadcastChannel' in window) {
    try {
      const authChan = new BroadcastChannel('system_admin_auth');
      authChan.onmessage = (e) => {
        if (e.data && e.data.type === 'ADMIN_STATUS_CHANGED') {
          updateAiAdminBadge(Boolean(e.data.isAdmin));
        }
      };
    } catch (e) {}
  }

  // Export ra toàn cục window
  window.aiAssistant = {
    getAiConfig,
    saveAiConfig,
    processUserInput,
    toggleVoiceListening,
    startVoiceListening,
    stopVoiceListening,
    toggleAiVoiceTtsSetting,
    getAiVoiceTtsSetting,
    getAiVoiceConfig,
    saveAiVoiceConfig,
    toggleAiVoiceSettingsDrawer,
    selectVoiceSpeaker,
    selectVoicePersona,
    selectVoiceRegion,
    saveVoiceSettingsFromDrawer,
    previewCurrentVoiceSettings,
    stopAiVoicePlayback,
    speakAiResponse,
    isContinuousVoiceActive: () => isContinuousVoiceActive,
    toggleAiAssistant,
    showAiAssistantModal,
    closeAiAssistant,
    minimizeAiAssistant,
    showFloatingAiOrb,
    restoreAiFromFloatingOrb,
    setupFloatingOrbGestures,
    toggleMaximizeAiAssistant,
    setupAiWindowDrag,
    submitAiPrompt,
    clearAiChat,
    toggleAiSettingsDrawer,
    saveDrawerGeminiSettings,
    testDrawerGeminiConnection,
    updateAdminUI: updateAiAdminBadge,
    updateAiAdminBadge,
    isAdminMode,
    toggleAiMemoryDrawer,
    updateAiMemoryDrawerUI,
    addManualAiMemory,
    deleteAiMemory,
    downloadAiDatasetJsonl,
    loadAiPersonalMemory,
    saveAiPersonalMemory,
    getPermanentMemories: () => permanentMemories,
    getUserProfile: () => userProfile,
    executeResetAllDebts,
    aiUndoLastResetDebts,
    executeSettleSingleDebt,
    getCurrentSystemSnapshot,
    toggleAiQuickMenu,
    selectQuickPrompt,
    triggerBillImageUpload,
    handleBillImageSelected,
    handleBillImageFile,
    removePendingBillImage,
    setupImagePasteAndDrop,
    executeResetChiaBill,
    aiUndoLastResetChiaBill,
    executeDeleteChiaBill,
    executeSettleChiaBill,
    aiExecutePendingAction: window.aiExecutePendingAction,
    aiCancelPendingAction: window.aiCancelPendingAction,
    aiFillMealFormApp: window.aiFillMealFormApp,
    aiFillBillFormApp: window.aiFillBillFormApp,
    aiFillNoteFormApp: window.aiFillNoteFormApp,
    aiFillContactFormApp: window.aiFillContactFormApp
  };

  window.toggleAiAssistant = toggleAiAssistant;
  window.closeAiAssistant = closeAiAssistant;
  window.minimizeAiAssistant = minimizeAiAssistant;
  window.showFloatingAiOrb = showFloatingAiOrb;
  window.restoreAiFromFloatingOrb = restoreAiFromFloatingOrb;
  window.setupFloatingOrbGestures = setupFloatingOrbGestures;
  window.toggleMaximizeAiAssistant = toggleMaximizeAiAssistant;
  window.setupAiWindowDrag = setupAiWindowDrag;
  window.toggleVoiceListening = toggleVoiceListening;
  window.startVoiceListening = startVoiceListening;
  window.stopVoiceListening = stopVoiceListening;
  window.toggleAiVoiceTtsSetting = toggleAiVoiceTtsSetting;
  window.getAiVoiceTtsSetting = getAiVoiceTtsSetting;
  window.getAiVoiceConfig = getAiVoiceConfig;
  window.saveAiVoiceConfig = saveAiVoiceConfig;
  window.toggleAiVoiceSettingsDrawer = toggleAiVoiceSettingsDrawer;
  window.selectVoiceSpeaker = selectVoiceSpeaker;
  window.selectVoicePersona = selectVoicePersona;
  window.selectVoiceRegion = selectVoiceRegion;
  window.updateVoiceSpeedDisplay = updateVoiceSpeedDisplay;
  window.updateVoicePitchDisplay = updateVoicePitchDisplay;
  window.handleVoiceSettingChange = handleVoiceSettingChange;
  window.saveVoiceSettingsFromDrawer = saveVoiceSettingsFromDrawer;
  window.previewCurrentVoiceSettings = previewCurrentVoiceSettings;
  window.stopAiVoicePlayback = stopAiVoicePlayback;
  window.submitAiPrompt = submitAiPrompt;
  window.clearAiChat = clearAiChat;
  window.toggleAiSettingsDrawer = toggleAiSettingsDrawer;
  window.toggleDrawerKeyVisibility = toggleDrawerKeyVisibility;
  window.testDrawerGeminiConnection = testDrawerGeminiConnection;
  window.saveDrawerGeminiSettings = saveDrawerGeminiSettings;
  window.toggleAiMemoryDrawer = toggleAiMemoryDrawer;
  window.addManualAiMemory = addManualAiMemory;
  window.deleteAiMemory = deleteAiMemory;
  window.downloadAiDatasetJsonl = downloadAiDatasetJsonl;
  window.executeResetAllDebts = executeResetAllDebts;
  window.aiUndoLastResetDebts = aiUndoLastResetDebts;
  window.toggleAiQuickMenu = toggleAiQuickMenu;
  window.selectQuickPrompt = selectQuickPrompt;
  window.triggerBillImageUpload = triggerBillImageUpload;
  window.handleBillImageSelected = handleBillImageSelected;
  window.handleBillImageFile = handleBillImageFile;
  window.removePendingBillImage = removePendingBillImage;
  window.setupImagePasteAndDrop = setupImagePasteAndDrop;
  window.executeResetChiaBill = executeResetChiaBill;
  window.aiUndoLastResetChiaBill = aiUndoLastResetChiaBill;
  window.executeDeleteChiaBill = executeDeleteChiaBill;
  window.executeSettleChiaBill = executeSettleChiaBill;
  window.copyAiMessageText = copyAiMessageText;
  window.executeCompleteNote = executeCompleteNote;
  window.executeDeleteNote = executeDeleteNote;
  window.executeUpdateNote = executeUpdateNote;

})();
