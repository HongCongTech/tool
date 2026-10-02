/**
 * ==============================================================================
 * Apple Intelligence & Siri Trợ Lý AI (ai-assistant.js) - Version 1.0
 * Tích hợp Google Gemini 1.5 Flash & Nhận diện Giọng Nói Tiếng Việt (Web Speech API)
 * - Tự động nhận diện ý định (Intent Extraction) & Entity Parsing
 * - Thẻ xác nhận thông minh (Smart Confirmation Card) trước khi nhập dữ liệu
 * - Tự động ghi dữ liệu vào Tiền Cơm, Chia Bill, Ghi Chú, Danh Bạ & Supabase
 * - Chế độ Offline NLP Fallback: Hoạt động ngay cả khi chưa nhập API Key!
 * ==============================================================================
 */

(function () {
  'use strict';

  const AI_CONFIG_KEY = 'sys_ai_config';
  const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';

  // State
  let isListening = false;
  let speechRecognizer = null;
  let pendingActionData = null; // Dữ liệu đang chờ người dùng bấm [Xác nhận]

  // --------------------------------------------------------------------------
  // 1. CẤU HÌNH & LẤY THÔNG TIN THÀNH VIÊN HỆ THỐNG
  // --------------------------------------------------------------------------
  function getAiConfig() {
    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      apiKey: '',
      model: DEFAULT_GEMINI_MODEL,
      enabled: true
    };
  }

  function saveAiConfig(cfg) {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
    if (window.dbStorage) window.dbStorage.set(AI_CONFIG_KEY, JSON.stringify(cfg));
  }

  function getSystemMembers() {
    let list = [];
    try {
      const raw = localStorage.getItem('sys_global_members');
      if (raw) list = JSON.parse(raw);
    } catch (e) {}

    if (!Array.isArray(list) || !list.length) {
      try {
        const rawP2p = localStorage.getItem('p2p_members');
        if (rawP2p) list = JSON.parse(rawP2p);
      } catch (e) {}
    }

    if (!Array.isArray(list) || !list.length) {
      list = [
        { id: '1', name: 'Đô', nickname: 'Đô', fullName: 'Nguyễn Văn Đô' },
        { id: '2', name: 'Đạt', nickname: 'Đạt Còi', fullName: 'Trần Thành Đạt' },
        { id: '3', name: 'Công', nickname: 'Công', fullName: 'Lê Thành Công' },
        { id: '4', name: 'Hạnh', nickname: 'Hạnh', fullName: 'Phạm Mỹ Hạnh' },
        { id: '5', name: 'Quyền', nickname: 'Quyền', fullName: 'Vũ Đình Quyền' },
        { id: '6', name: 'Duy', nickname: 'Duy', fullName: 'Hoàng Đức Duy' }
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
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  }

  // --------------------------------------------------------------------------
  // 2. WEB SPEECH RECOGNITION (GIỌNG NÓI TIẾNG VIỆT)
  // --------------------------------------------------------------------------
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return null;
    }

    const recognizer = new SpeechRecognition();
    recognizer.lang = 'vi-VN';
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = function () {
      isListening = true;
      updateVoiceUI(true);
      setAiStatus('Đang lắng nghe bạn nói... 🎙️', 'listening');
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
        stopVoiceListening();
        submitAiPrompt(finalTranscript);
      }
    };

    recognizer.onerror = function (event) {
      console.warn('[AI Assistant] Speech error:', event.error);
      stopVoiceListening();
      if (event.error === 'not-allowed') {
        setAiStatus('Microphone bị chặn. Vui lòng cấp quyền truy cập micro trong trình duyệt!', 'error');
      } else if (event.error === 'no-speech') {
        setAiStatus('Không nhận diện được âm thanh. Hãy thử nói lại!', 'idle');
      }
    };

    recognizer.onend = function () {
      isListening = false;
      updateVoiceUI(false);
    };

    return recognizer;
  }

  function toggleVoiceListening() {
    if (!speechRecognizer) {
      speechRecognizer = initSpeechRecognition();
    }
    if (!speechRecognizer) {
      alert('Trình duyệt hiện tại của bạn không hỗ trợ nhận diện giọng nói Web Speech. Hãy sử dụng Google Chrome, Edge hoặc Safari!');
      return;
    }

    if (isListening) {
      stopVoiceListening();
    } else {
      try {
        speechRecognizer.start();
      } catch (e) {
        console.warn('Speech start error:', e);
      }
    }
  }

  function stopVoiceListening() {
    if (speechRecognizer && isListening) {
      speechRecognizer.stop();
      isListening = false;
      updateVoiceUI(false);
    }
  }

  function updateVoiceUI(listening) {
    const btn = document.getElementById('aiAssistantMicBtn');
    const orb = document.getElementById('aiSiriOrb');
    if (btn) {
      btn.classList.toggle('active-listening', listening);
    }
    if (orb) {
      orb.classList.toggle('siri-listening', listening);
    }
  }

  // --------------------------------------------------------------------------
  // 3. PARSER NGÔN NGỮ TỰ NHIÊN (HYBRID: GEMINI API + OFFLINE RULE ENGINE)
  // --------------------------------------------------------------------------
  async function parseIntentWithGemini(promptText, apiKey, model) {
    const today = new Date().toISOString().split('T')[0];
    const members = getSystemMembers();
    const membersSummary = members.map(m => `"${m.nickname || m.name}" (Tên đầy đủ: ${m.fullName || m.name})`).join(', ');

    const systemPrompt = `Bạn là Trợ lý AI Thông Minh (Apple Intelligence / Siri Web) cho Hệ thống macOS Dashboard Văn Phòng.
Ngày hôm nay: ${today}.
Danh sách các thành viên trong công ty: [${membersSummary}].

Nhiệm vụ: Phân tích câu nói của người dùng và trích xuất ý định (Intent) dưới dạng JSON chuẩn.
Quy tắc:
1. Nếu là ghi nhận Tiền Cơm / Bữa Ăn:
{
  "action": "ADD_MEAL_LOG",
  "payerName": "Tên người trả tiền (khớp chính xác với một trong các thành viên trong danh sách)",
  "amountPerPerson": 40000 (đơn vị VNĐ, số tiền mỗi người, nếu người dùng nói 'mỗi người 40k' -> 40000; nếu người dùng nói 'tổng 240k cho 6 người' -> 40000),
  "totalAmount": 0 (để 0 nếu tính theo amountPerPerson * số người ăn),
  "eaters": ["Công", "Huy", "Tuấn"] (danh sách tên những người tham gia ăn. Nếu người dùng nói 'cho cả nhóm' hoặc không nêu cụ thể ai ăn, hãy trả về danh sách toàn bộ các thành viên công ty: [${members.map(m => `"${m.nickname || m.name}"`).join(', ')}]),
  "date": "${today}",
  "note": "Ghi chú ngắn gọn, ví dụ: Bữa cơm trưa"
}

2. Nếu là Hỏi đáp / Tra cứu dữ liệu (ví dụ: ai đang nợ tiền cơm, tháng này sinh nhật ai):
{
  "action": "QUERY",
  "topic": "DEBTS" hoặc "BIRTHDAYS" hoặc "GENERAL",
  "reply": "Câu trả lời trực tiếp hoặc thông báo"
}

3. Nếu là Tạo ghi chú:
{
  "action": "ADD_STICKY_NOTE",
  "title": "Tiêu đề ghi chú",
  "content": "Nội dung ghi chú"
}

4. Nếu là Mở ứng dụng:
{
  "action": "OPEN_APP",
  "appId": "tien-com" hoặc "chia-bill" hoặc "danh-ba" hoặc "ghi-chu" hoặc "lai-suat" hoặc "control-panel"
}

Chỉ trả về chuỗi JSON thuần túy, tuyệt đối KHÔNG bọc trong markdown \`\`\`json.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: `Câu người dùng nói: "${promptText}"` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Lỗi Gemini API HTTP ${res.status}`);
    }

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) throw new Error('Gemini không trả về nội dung');

    const cleanJson = candidateText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  }

  // Smart Offline Parser (Hoạt động offline hoặc khi chưa có API Key)
  function parseIntentOffline(text) {
    const raw = text.trim();
    const lower = text.toLowerCase();
    const norm = normalizeVietnamese(lower);
    const members = getSystemMembers();
    const today = new Date().toISOString().split('T')[0];

    // 1. Kiểm tra ý định mở ứng dụng
    if (norm.includes('mo tien com') || norm.includes('vao tien com')) return { action: 'OPEN_APP', appId: 'tien-com' };
    if (norm.includes('mo danh ba') || norm.includes('vao danh ba')) return { action: 'OPEN_APP', appId: 'danh-ba' };
    if (norm.includes('mo ghi chu') || norm.includes('vao ghi chu')) return { action: 'OPEN_APP', appId: 'ghi-chu' };
    if (norm.includes('mo chia bill') || norm.includes('vao chia bill')) return { action: 'OPEN_APP', appId: 'chia-bill' };

    // 2. Tra cứu sinh nhật
    if (norm.includes('sinh nhat')) {
      return { action: 'QUERY', topic: 'BIRTHDAYS' };
    }

    // 3. Tra cứu công nợ tiền cơm
    if (norm.includes('no tien com') || norm.includes('am tien com') || norm.includes('du tien com')) {
      return { action: 'QUERY', topic: 'DEBTS' };
    }

    // 4. Nhận diện Ghi chép Tiền Cơm (Ví dụ: "Hôm nay Công trả tiền cơm mỗi người 40k")
    const isMealRelated = norm.includes('tien com') || norm.includes('com') || norm.includes('an trua') || norm.includes('an toi');
    const isPaymentAction = norm.includes('tra') || norm.includes('chi') || norm.includes('bao') || norm.includes('ung') || norm.includes('thanh toan');

    if (isMealRelated && isPaymentAction) {
      // Tìm người trả (Payer)
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

      // Tìm số tiền
      let amount = 0;
      // Trích xuất số kèm k, nghìn, ngàn, tr, triệu
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
        if (num < 1000) amount = num * 1000; // ví dụ "40" -> 40000
        else amount = num;
      } else {
        amount = 40000; // Mặc định 40k nếu không nghe rõ
      }

      // Danh sách người ăn: Mặc định tất cả thành viên nếu không chỉ định cụ thể
      const eaters = members.map(m => m.nickname || m.name);

      return {
        action: 'ADD_MEAL_LOG',
        payerName: matchedPayer ? (matchedPayer.nickname || matchedPayer.name) : 'Công',
        amountPerPerson: amount,
        totalAmount: 0,
        eaters: eaters,
        date: today,
        note: `${matchedPayer ? (matchedPayer.nickname || matchedPayer.name) : 'Thành viên'} thanh toán tiền cơm`
      };
    }

    // 5. Ghi chú nhanh
    if (norm.startsWith('ghi chu') || norm.startsWith('nhac toi') || norm.startsWith('note')) {
      const content = raw.replace(/^(ghi chú|nhắc tôi|note)[:\s]*/i, '').trim();
      return {
        action: 'ADD_STICKY_NOTE',
        title: 'Ghi chú nhanh',
        content: content || raw
      };
    }

    return {
      action: 'GENERAL_QUERY',
      text: raw
    };
  }

  // --------------------------------------------------------------------------
  // 4. THỰC THI Ý ĐỊNH & HIỂN THỊ THẺ XÁC NHẬN (CONFIRMATION CARD)
  // --------------------------------------------------------------------------
  async function processUserInput(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return;

    setAiStatus('Trí tuệ nhân tạo đang phân tích ngữ cảnh... ✨', 'loading');
    showAiAssistantModal();

    const cfg = getAiConfig();
    let result = null;
    let usedModel = 'Offline Rule Parser';

    try {
      if (cfg.apiKey && cfg.apiKey.trim()) {
        usedModel = `Google ${cfg.model || DEFAULT_GEMINI_MODEL}`;
        result = await parseIntentWithGemini(userPrompt, cfg.apiKey.trim(), cfg.model);
      } else {
        result = parseIntentOffline(userPrompt);
      }
    } catch (err) {
      console.warn('[AI Assistant] Gemini error, fallback to offline parser:', err);
      result = parseIntentOffline(userPrompt);
      usedModel = 'Offline Fallback (Gemini API lỗi hoặc chưa cấu hình)';
    }

    handleParsedIntent(result, userPrompt, usedModel);
  }

  function handleParsedIntent(intent, originalPrompt, modelUsed) {
    const container = document.getElementById('aiAssistantResults');
    if (!container) return;

    setAiStatus(`Đã phân tích bởi ${modelUsed}`, 'success');

    // 1. Ý định Ghi nhận Tiền Cơm -> HIỂN THỊ THẺ XÁC NHẬN THÔNG MINH
    if (intent.action === 'ADD_MEAL_LOG') {
      renderMealConfirmationCard(intent, originalPrompt);
      return;
    }

    // 2. Ý định Mở Ứng Dụng
    if (intent.action === 'OPEN_APP') {
      const appName = intent.appId;
      container.innerHTML = `
        <div class="ai-card-bubble">
          <div style="font-weight:700; color:#38bdf8; margin-bottom:6px;">🚀 Mở ứng dụng hệ thống</div>
          <div style="font-size:13px; color:#cbd5e1; margin-bottom:12px;">Đang mở ứng dụng <b>${escapeHtml(appName)}</b> theo yêu cầu của bạn...</div>
          <button type="button" class="ai-confirm-btn" onclick="openAppById('${intent.appId}')">Mở ngay</button>
        </div>
      `;
      openAppById(intent.appId);
      return;
    }

    // 3. Ý định Tra cứu Công nợ Tiền Cơm
    if (intent.action === 'QUERY' && intent.topic === 'DEBTS') {
      renderDebtsQueryCard();
      return;
    }

    // 4. Ý định Tra cứu Sinh nhật
    if (intent.action === 'QUERY' && intent.topic === 'BIRTHDAYS') {
      renderBirthdaysQueryCard();
      return;
    }

    // 5. Ý định Tạo Ghi Chú
    if (intent.action === 'ADD_STICKY_NOTE') {
      renderStickyNoteCard(intent);
      return;
    }

    // 6. Trả lời chung từ Gemini
    if (intent.reply) {
      container.innerHTML = `
        <div class="ai-card-bubble">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="font-size:18px;">✨</span>
            <span style="font-weight:700; color:#f8fafc;">Câu trả lời từ Gemini:</span>
          </div>
          <div style="font-size:13.5px; color:#cbd5e1; line-height:1.6; white-space:pre-wrap;">${escapeHtml(intent.reply)}</div>
        </div>
      `;
      return;
    }

    // Fallback thông báo
    container.innerHTML = `
      <div class="ai-card-bubble">
        <div style="font-weight:600; color:#94a3b8; font-size:13px;">“${escapeHtml(originalPrompt)}”</div>
        <div style="margin-top:8px; font-size:13px; color:#e2e8f0;">
          💡 Bạn có thể thử các câu lệnh mẫu như:
          <ul style="margin:6px 0 0 16px; padding:0; line-height:1.6; color:#38bdf8;">
            <li>"Hôm nay Công trả tiền cơm mỗi người 40k"</li>
            <li>"Ai đang nợ tiền cơm nhiều nhất?"</li>
            <li>"Tháng này sinh nhật những ai?"</li>
            <li>"Mở danh bạ" hoặc "Mở tiền cơm"</li>
          </ul>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 5. THẺ XÁC NHẬN TIỀN CƠM THÔNG MINH (CONFIRMATION CARD)
  // --------------------------------------------------------------------------
  function renderMealConfirmationCard(data, originalPrompt) {
    const container = document.getElementById('aiAssistantResults');
    if (!container) return;

    const allMembers = getSystemMembers();
    const currentPayerName = data.payerName || 'Công';
    const amountPerPerson = data.amountPerPerson || 40000;
    const initialEaters = Array.isArray(data.eaters) && data.eaters.length > 0 ? data.eaters : allMembers.map(m => m.nickname || m.name);
    const dateStr = data.date || new Date().toISOString().split('T')[0];

    // Lưu vào biến pendingActionData để khi bấm xác nhận sẽ lấy dữ liệu chuẩn nhất
    pendingActionData = {
      payerName: currentPayerName,
      amountPerPerson: amountPerPerson,
      eaters: [...initialEaters],
      date: dateStr,
      note: data.note || `${currentPayerName} trả tiền cơm`
    };

    function recalculateTotal() {
      return pendingActionData.amountPerPerson * pendingActionData.eaters.length;
    }

    const totalAmount = recalculateTotal();

    container.innerHTML = `
      <div class="ai-confirm-card" id="mealConfirmCard">
        <div class="ai-confirm-header">
          <div class="ai-confirm-tag">🥘 TIỀN CƠM VĂN PHÒNG</div>
          <div class="ai-confirm-title">Xác Nhận Nhập Dữ Liệu Bữa Ăn</div>
          <div class="ai-confirm-sub">Được AI nhận diện từ: <i>“${escapeHtml(originalPrompt)}”</i></div>
        </div>

        <div class="ai-form-grid">
          <!-- Người trả -->
          <div class="ai-form-group">
            <label class="ai-form-label">👤 Người chi trả:</label>
            <select class="ai-form-select" id="aiPayerSelect" onchange="aiUpdatePayer(this.value)">
              ${allMembers.map(m => {
                const name = m.nickname || m.name;
                const isSelected = name.toLowerCase() === currentPayerName.toLowerCase() || (m.fullName && m.fullName.toLowerCase().includes(currentPayerName.toLowerCase()));
                return `<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)} ${m.fullName ? `(${escapeHtml(m.fullName)})` : ''}</option>`;
              }).join('')}
            </select>
          </div>

          <!-- Đơn giá mỗi người -->
          <div class="ai-form-group">
            <label class="ai-form-label">💰 Giá mỗi người:</label>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" class="ai-form-input" id="aiAmountInput" value="${amountPerPerson}" step="5000" oninput="aiUpdateAmount(this.value)">
              <span style="font-size:12px; color:#94a3b8; font-weight:600;">VNĐ</span>
            </div>
          </div>

          <!-- Ngày ghi nhận -->
          <div class="ai-form-group">
            <label class="ai-form-label">📅 Ngày diễn ra:</label>
            <input type="date" class="ai-form-input" id="aiDateInput" value="${dateStr}" onchange="aiUpdateDate(this.value)">
          </div>

          <!-- Tổng tiền tự động tính -->
          <div class="ai-form-group">
            <label class="ai-form-label">💵 Tổng số tiền:</label>
            <div class="ai-total-highlight" id="aiTotalDisplay">${formatMoney(totalAmount)}</div>
          </div>
        </div>

        <!-- Danh sách người ăn dạng Chip tương tác -->
        <div style="margin-top:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label class="ai-form-label" style="margin:0;">👥 Thành viên tham gia ăn (<span id="aiEatersCount">${pendingActionData.eaters.length}</span> người):</label>
            <button type="button" class="ai-mini-btn" onclick="aiToggleAllEaters()">Chọn tất cả</button>
          </div>
          <div class="ai-chips-list" id="aiEatersChipsContainer">
            ${allMembers.map(m => {
              const name = m.nickname || m.name;
              const isChecked = pendingActionData.eaters.some(e => e.toLowerCase() === name.toLowerCase());
              return `
                <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleEater('${escapeHtml(name)}')">
                  <span class="chip-check">${isChecked ? '✓' : '+'}</span>
                  <span>${escapeHtml(name)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Ghi chú -->
        <div style="margin-top:10px;">
          <label class="ai-form-label">📝 Ghi chú bữa ăn:</label>
          <input type="text" class="ai-form-input" id="aiNoteInput" value="${escapeHtml(pendingActionData.note)}" oninput="aiUpdateNote(this.value)">
        </div>

        <!-- Nút hành động xác nhận -->
        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard()">✕ Hủy bỏ</button>
          <button type="button" class="ai-btn-execute" onclick="aiExecuteAddMeal()">
            <span>✅ Xác nhận & Nhập ngay</span>
          </button>
        </div>
      </div>
    `;
  }

  // Tương tác trên thẻ xác nhận
  window.aiUpdatePayer = function (val) {
    if (pendingActionData) pendingActionData.payerName = val;
  };

  window.aiUpdateAmount = function (val) {
    if (!pendingActionData) return;
    const num = parseFloat(val) || 0;
    pendingActionData.amountPerPerson = num;
    updateAiTotalDisplay();
  };

  window.aiUpdateDate = function (val) {
    if (pendingActionData) pendingActionData.date = val;
  };

  window.aiUpdateNote = function (val) {
    if (pendingActionData) pendingActionData.note = val;
  };

  window.aiToggleEater = function (name) {
    if (!pendingActionData) return;
    const idx = pendingActionData.eaters.findIndex(e => e.toLowerCase() === name.toLowerCase());
    if (idx !== -1) {
      if (pendingActionData.eaters.length <= 1) {
        alert('Phải có ít nhất 1 người tham gia ăn bữa cơm!');
        return;
      }
      pendingActionData.eaters.splice(idx, 1);
    } else {
      pendingActionData.eaters.push(name);
    }
    updateAiChipsUI();
    updateAiTotalDisplay();
  };

  window.aiToggleAllEaters = function () {
    if (!pendingActionData) return;
    const all = getSystemMembers().map(m => m.nickname || m.name);
    if (pendingActionData.eaters.length === all.length) {
      pendingActionData.eaters = [pendingActionData.payerName || all[0]];
    } else {
      pendingActionData.eaters = [...all];
    }
    updateAiChipsUI();
    updateAiTotalDisplay();
  };

  function updateAiChipsUI() {
    const container = document.getElementById('aiEatersChipsContainer');
    const countEl = document.getElementById('aiEatersCount');
    if (!container || !pendingActionData) return;

    if (countEl) countEl.innerText = pendingActionData.eaters.length;
    const allMembers = getSystemMembers();
    container.innerHTML = allMembers.map(m => {
      const name = m.nickname || m.name;
      const isChecked = pendingActionData.eaters.some(e => e.toLowerCase() === name.toLowerCase());
      return `
        <button type="button" class="ai-member-chip ${isChecked ? 'selected' : ''}" onclick="aiToggleEater('${escapeHtml(name)}')">
          <span class="chip-check">${isChecked ? '✓' : '+'}</span>
          <span>${escapeHtml(name)}</span>
        </button>
      `;
    }).join('');
  }

  function updateAiTotalDisplay() {
    const totalEl = document.getElementById('aiTotalDisplay');
    if (totalEl && pendingActionData) {
      const total = pendingActionData.amountPerPerson * pendingActionData.eaters.length;
      totalEl.innerText = formatMoney(total);
    }
  }

  window.aiDismissConfirmCard = function () {
    pendingActionData = null;
    const container = document.getElementById('aiAssistantResults');
    if (container) {
      container.innerHTML = `
        <div class="ai-card-bubble" style="text-align:center; color:#94a3b8; font-size:13px; padding:16px;">
          ❌ Đã hủy thao tác nhập dữ liệu. Bạn có thể nói hoặc gõ câu lệnh khác bất kỳ lúc nào!
        </div>
      `;
    }
  };

  // ==========================================================================
  // 6. GHI CHÍNH THỨC VÀO CƠ SỞ DỮ LIỆU TIỀN CƠM & ĐỒNG BỘ CLOUD
  // ==========================================================================
  window.aiExecuteAddMeal = function () {
    if (!pendingActionData) return;
    const data = pendingActionData;

    try {
      // 1. Tải danh sách thành viên hiện tại trong app Tiền Cơm
      let p2pMembers = [];
      try {
        const rawM = localStorage.getItem('p2p_members');
        if (rawM) p2pMembers = JSON.parse(rawM);
      } catch (e) {}

      if (!Array.isArray(p2pMembers) || !p2pMembers.length) {
        p2pMembers = getSystemMembers();
      }

      // Tìm người trả tiền trong members
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

      // Xây dựng danh sách items (chi tiết từng người ăn)
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
          dishName: 'Cơm trưa',
          amount: data.amountPerPerson
        });
      });

      // Lưu lại danh sách members nếu có thành viên mới
      localStorage.setItem('p2p_members', JSON.stringify(p2pMembers));
      if (window.dbStorage) window.dbStorage.set('p2p_members', JSON.stringify(p2pMembers));

      // 2. Tải danh sách logs hiện tại của Tiền Cơm
      let logs = [];
      try {
        const rawL = localStorage.getItem('p2p_logs');
        if (rawL) logs = JSON.parse(rawL);
      } catch (e) {}

      const totalAmount = data.amountPerPerson * items.length;
      const payerDisplayName = payer.nickname || payer.name;
      const desc = `${payerDisplayName} thanh toán tổng: ${formatMoney(totalAmount)} (` +
        items.map(i => `${i.colleagueName}: ${formatMoney(i.amount)}`).join(', ') + ')';

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

      // Lưu vào localStorage và Supabase Cloud
      localStorage.setItem('p2p_logs', JSON.stringify(logs));
      if (window.dbStorage) window.dbStorage.set('p2p_logs', JSON.stringify(logs));

      // 3. Bắn tín hiệu PostMessage & Storage Event để iframe Tiền Cơm cập nhật tức thì
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2p_logs',
        newValue: JSON.stringify(logs)
      }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'P2P_LOGS_UPDATED', newLog }, '*');
        } catch (e) {}
      });

      // 4. Hiển thị thông báo hoàn tất thành công
      pendingActionData = null;
      const container = document.getElementById('aiAssistantResults');
      if (container) {
        container.innerHTML = `
          <div class="ai-success-card">
            <div style="font-size:32px; margin-bottom:8px;">🎉</div>
            <div style="font-size:16px; font-weight:800; color:#34d399; margin-bottom:4px;">ĐÃ NHẬP DỮ LIỆU THÀNH CÔNG!</div>
            <div style="font-size:13px; color:#cbd5e1; line-height:1.6; margin-bottom:12px;">
              Đã ghi nhận bữa cơm <b>${formatMoney(totalAmount)}</b> ngày <b>${data.date}</b>.<br>
              Người chi trả: <b style="color:#fbbf24;">${escapeHtml(payerDisplayName)}</b> • Số người ăn: <b>${items.length} người</b> (${formatMoney(data.amountPerPerson)}/người).
            </div>
            <div style="display:flex; justify-content:center; gap:8px;">
              <button type="button" class="ai-confirm-btn" onclick="openAppById('tien-com')">📱 Xem Bảng Tiền Cơm</button>
              <button type="button" class="ai-btn-cancel" onclick="closeAiAssistant()">Đóng</button>
            </div>
          </div>
        `;
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã ghi nhận bữa cơm ${formatMoney(totalAmount)} do ${payerDisplayName} trả!`);
      }
    } catch (err) {
      console.error('[AI Assistant] Lỗi lưu tiền cơm:', err);
      alert('Đã xảy ra lỗi khi lưu vào cơ sở dữ liệu: ' + err.message);
    }
  };

  // --------------------------------------------------------------------------
  // 7. TRẢ LỜI CÁC CÂU HỎI THƯỜNG GẶP (CÔNG NỢ, SINH NHẬT)
  // --------------------------------------------------------------------------
  function renderDebtsQueryCard() {
    const container = document.getElementById('aiAssistantResults');
    if (!container) return;

    let members = getSystemMembers();
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem('p2p_logs')) || []; } catch (e) {}

    // Tính nợ ròng
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

    const debtors = netList.filter(x => x.net < 0);
    const creditors = netList.filter(x => x.net > 0);

    container.innerHTML = `
      <div class="ai-card-bubble">
        <div style="font-weight:700; color:#38bdf8; font-size:14px; margin-bottom:8px;">📊 Báo Cáo Công Nợ Tiền Cơm Hệ Thống</div>
        <div style="font-size:12.5px; color:#cbd5e1; margin-bottom:10px;">Dưới đây là tình hình số dư đối soát tiền cơm hiện tại:</div>
        
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${netList.map(x => {
            const isNegative = x.net < 0;
            const isPositive = x.net > 0;
            const color = isNegative ? '#f87171' : (isPositive ? '#34d399' : '#94a3b8');
            const statusText = isNegative ? `Đang nợ: ${formatMoney(Math.abs(x.net))}` : (isPositive ? `Được nhận: +${formatMoney(x.net)}` : 'Đã cân bằng (0đ)');
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:6px 10px; border-radius:8px;">
                <span style="font-weight:600; color:#f8fafc;">${escapeHtml(x.member.nickname || x.member.name)}</span>
                <span style="font-weight:700; color:${color}; font-size:12px;">${statusText}</span>
              </div>
            `;
          }).join('')}
        </div>

        <div style="margin-top:12px; display:flex; justify-content:flex-end;">
          <button type="button" class="ai-confirm-btn" style="font-size:12px;" onclick="openAppById('tien-com')">Mở bảng Tiền Cơm chi tiết</button>
        </div>
      </div>
    `;
  }

  function renderBirthdaysQueryCard() {
    const container = document.getElementById('aiAssistantResults');
    if (!container) return;

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

    container.innerHTML = `
      <div class="ai-card-bubble">
        <div style="font-weight:700; color:#fbbf24; font-size:14px; margin-bottom:8px;">🎂 Danh Sách Sinh Nhật Trong Tháng ${currentMonth}</div>
        ${thisMonthBirthdays.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${thisMonthBirthdays.map(x => `
              <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:6px 10px; border-radius:8px;">
                <span style="font-weight:600; color:#f8fafc;">${escapeHtml(x.member.nickname || x.member.name)}</span>
                <span style="color:#fbbf24; font-weight:700; font-size:12px;">Ngày ${x.day}/${currentMonth}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="color:#94a3b8; font-size:13px; text-align:center; padding:10px;">Tháng ${currentMonth} không có sinh nhật nào trong danh sách.</div>
        `}
        <div style="margin-top:12px; display:flex; justify-content:flex-end;">
          <button type="button" class="ai-confirm-btn" style="font-size:12px;" onclick="openAppById('danh-ba')">Xem Danh Bạ</button>
        </div>
      </div>
    `;
  }

  function renderStickyNoteCard(intent) {
    const container = document.getElementById('aiAssistantResults');
    if (!container) return;

    let notes = [];
    try { notes = JSON.parse(localStorage.getItem('p2p_notes')) || []; } catch(e) {}

    const newNote = {
      id: Date.now().toString(),
      title: intent.title || 'Ghi chú AI',
      content: intent.content || '',
      color: '#fbbf24',
      date: new Date().toLocaleDateString('vi-VN')
    };

    notes.unshift(newNote);
    localStorage.setItem('p2p_notes', JSON.stringify(notes));
    if (window.dbStorage) window.dbStorage.set('p2p_notes', JSON.stringify(notes));

    container.innerHTML = `
      <div class="ai-card-bubble">
        <div style="font-weight:700; color:#34d399; font-size:14px; margin-bottom:6px;">📝 Đã tạo Sticky Note thành công!</div>
        <div style="background:rgba(251,191,36,0.15); border:1px solid #fbbf24; padding:8px 12px; border-radius:8px; color:#fef08a; font-size:13px; margin-bottom:10px;">
          “${escapeHtml(newNote.content)}”
        </div>
        <button type="button" class="ai-confirm-btn" onclick="openAppById('ghi-chu')">Mở Ghi Chú</button>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 8. ĐIỀU KHIỂN GIAO DIỆN MODAL AI ASSISTANT (POPUP & SHORTCUTS)
  // --------------------------------------------------------------------------
  function showAiAssistantModal() {
    const modal = document.getElementById('aiAssistantModal');
    if (modal) {
      modal.classList.add('show');
      const input = document.getElementById('aiAssistantInput');
      if (input) setTimeout(() => input.focus(), 100);
    }
  }

  function closeAiAssistant() {
    const modal = document.getElementById('aiAssistantModal');
    if (modal) {
      modal.classList.remove('show');
    }
    stopVoiceListening();
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

  function setAiStatus(text, state = 'idle') {
    const el = document.getElementById('aiStatusText');
    if (el) el.innerText = text;
  }

  function submitAiPrompt(promptText) {
    const input = document.getElementById('aiAssistantInput');
    const query = promptText || (input ? input.value : '');
    if (!query || !query.trim()) return;

    if (input) input.value = query;
    processUserInput(query);
  }

  function openAppById(appId) {
    closeAiAssistant();
    if (typeof window.openApp === 'function') {
      const targetApp = (window.appsList || []).find(a => a.id === appId || (a.url && a.url.includes(appId))) || {
        id: appId,
        title: appId,
        url: `apps/${appId}/index.html`
      };
      window.openApp(targetApp);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --------------------------------------------------------------------------
  // 9. LẮNG NGHE PHÍM TẮT & SỰ KIỆN KHỞI CHẠY
  // --------------------------------------------------------------------------
  window.addEventListener('keydown', function (e) {
    // Phím tắt Ctrl + Space hoặc Cmd + Space mở Trợ lý AI
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      toggleAiAssistant();
    }
    // Phím Esc đóng Trợ lý AI
    if (e.key === 'Escape') {
      const modal = document.getElementById('aiAssistantModal');
      if (modal && modal.classList.contains('show')) {
        closeAiAssistant();
      }
    }
  });

  // Export ra toàn cục window
  window.aiAssistant = {
    getAiConfig,
    saveAiConfig,
    processUserInput,
    toggleVoiceListening,
    toggleAiAssistant,
    showAiAssistantModal,
    closeAiAssistant,
    submitAiPrompt
  };

  window.toggleAiAssistant = toggleAiAssistant;
  window.closeAiAssistant = closeAiAssistant;
  window.toggleVoiceListening = toggleVoiceListening;
  window.submitAiPrompt = submitAiPrompt;

})();
