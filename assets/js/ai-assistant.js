/**
 * ==============================================================================
 * Apple Intelligence & Siri Trợ Lý AI (ai-assistant.js) - Version 2.0
 * Hỗ trợ Hội Thoại Đa Lượt (Conversational Chatbot) + Bán Trong Suốt Glassmorphism
 * Tích hợp Google Gemini 1.5 Flash & Bộ Phân Tích Ngôn Ngữ Tự Nhiên Thông Minh Offline
 * - Ghi nhận Tiền Cơm, Chia Bill kèm Thẻ xác nhận tương tác trực tiếp trong luồng chat
 * - Đặt lịch nhắc nhở (Reminders), tra cứu công nợ, sinh nhật, âm lịch & tính nhẩm
 * ==============================================================================
 */

(function () {
  'use strict';

  const AI_CONFIG_KEY = 'sys_ai_config';
  const CHAT_HISTORY_KEY = 'sys_ai_chat_history_v2';
  const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';

  // State
  let isListening = false;
  let speechRecognizer = null;
  let chatHistory = [];
  let isThinking = false;
  let activeConfirmationData = {}; // Lưu dữ liệu xác nhận theo message id

  // --------------------------------------------------------------------------
  // 1. CẤU HÌNH & THÀNH VIÊN HỆ THỐNG
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
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
  }

  function getCurrentTimeStr() {
    const d = new Date();
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  // --------------------------------------------------------------------------
  // 2. QUẢN LÝ LỊCH SỬ HỘI THOẠI (CHAT THREAD)
  // --------------------------------------------------------------------------
  function loadChatHistory() {
    try {
      const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
      if (raw) {
        chatHistory = JSON.parse(raw);
      }
    } catch (e) {}

    if (!Array.isArray(chatHistory) || !chatHistory.length) {
      chatHistory = [
        {
          id: 'welcome_' + Date.now(),
          role: 'assistant',
          text: '👋 **Xin chào! Tôi là Trợ lý AI Apple Intelligence**.\nTôi có thể trò chuyện cùng bạn, ghi chép tiền cơm văn phòng, lên lịch nhắc nhở công việc, tra cứu công nợ hay mở ứng dụng.\nBạn cần tôi hỗ trợ việc gì hôm nay?',
          time: getCurrentTimeStr()
        }
      ];
    }
  }

  function saveChatHistory() {
    try {
      sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-30)));
    } catch (e) {}
  }

  function clearAiChat() {
    chatHistory = [
      {
        id: 'welcome_' + Date.now(),
        role: 'assistant',
        text: '🧹 Cuộc trò chuyện đã được làm mới. Tôi sẵn sàng hỗ trợ các câu hỏi và yêu cầu tiếp theo của bạn!',
        time: getCurrentTimeStr()
      }
    ];
    activeConfirmationData = {};
    saveChatHistory();
    renderChatThread();
    if (typeof window.showToast === 'function') {
      window.showToast('🧹 Đã xóa lịch sử trò chuyện!');
    }
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
              <div>${formattedText}</div>
              <div class="ai-msg-time">${msg.time || ''}</div>
            </div>
          </div>
        `;
      } else {
        let cardHtml = '';
        if (msg.card) {
          if (msg.card.type === 'MEAL_CONFIRM') {
            cardHtml = renderMealConfirmationCardHtml(msg.card.data, msg.id);
          } else if (msg.card.type === 'REMINDER') {
            cardHtml = renderReminderCardHtml(msg.card.data);
          } else if (msg.card.type === 'DEBTS') {
            cardHtml = renderDebtsCardHtml();
          } else if (msg.card.type === 'BIRTHDAYS') {
            cardHtml = renderBirthdaysCardHtml();
          } else if (msg.card.type === 'SUCCESS') {
            cardHtml = renderSuccessCardHtml(msg.card.data);
          }
        }

        html += `
          <div class="ai-msg-row assistant" id="${msg.id}">
            <div class="ai-avatar"><span style="font-size:12px;">✨</span></div>
            <div class="ai-msg-bubble assistant">
              <div>${formattedText}</div>
              ${cardHtml}
              <div class="ai-msg-time">${msg.time || ''}</div>
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

    // Markdown bold **text**
    out = out.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Markdown italic *text*
    out = out.replace(/\*(.*?)\*/g, '<i>$1</i>');
    // Markdown code `code`
    out = out.replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.15); padding:1px 5px; border-radius:4px; font-size:12px;">$1</code>');
    // Line breaks
    out = out.replace(/\n/g, '<br>');
    return out;
  }

  // --------------------------------------------------------------------------
  // 3. THẺ XÁC NHẬN & TƯƠNG TÁC (CONFIRMATION CARDS)
  // --------------------------------------------------------------------------
  function renderMealConfirmationCardHtml(data, msgId) {
    const allMembers = getSystemMembers();
    const currentPayerName = data.payerName || 'Công';
    const amountPerPerson = data.amountPerPerson || 40000;
    const initialEaters = Array.isArray(data.eaters) && data.eaters.length > 0 ? data.eaters : allMembers.map(m => m.nickname || m.name);
    const dateStr = data.date || new Date().toISOString().split('T')[0];

    // Store state in activeConfirmationData
    if (!activeConfirmationData[msgId]) {
      activeConfirmationData[msgId] = {
        payerName: currentPayerName,
        amountPerPerson: amountPerPerson,
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
          <div class="ai-confirm-sub">Kiểm tra thông tin trước khi ghi nhận vào sổ:</div>
        </div>

        <div class="ai-form-grid">
          <!-- Người trả -->
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

          <!-- Đơn giá mỗi người -->
          <div class="ai-form-group">
            <label class="ai-form-label">💰 Giá mỗi người:</label>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" class="ai-form-input" id="aiAmountInput_${msgId}" value="${state.amountPerPerson}" step="5000" oninput="aiUpdateAmount('${msgId}', this.value)">
              <span style="font-size:11.5px; color:#94a3b8; font-weight:600;">VNĐ</span>
            </div>
          </div>

          <!-- Ngày ghi nhận -->
          <div class="ai-form-group">
            <label class="ai-form-label">📅 Ngày diễn ra:</label>
            <input type="date" class="ai-form-input" id="aiDateInput_${msgId}" value="${state.date}" onchange="aiUpdateDate('${msgId}', this.value)">
          </div>

          <!-- Tổng tiền tự động tính -->
          <div class="ai-form-group">
            <label class="ai-form-label">💵 Tổng cộng:</label>
            <div class="ai-total-highlight" id="aiTotalDisplay_${msgId}">${formatMoney(totalAmount)}</div>
          </div>
        </div>

        <!-- Danh sách người ăn dạng Chip tương tác -->
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

        <!-- Ghi chú -->
        <div style="margin-top:8px;">
          <label class="ai-form-label">📝 Ghi chú bữa ăn:</label>
          <input type="text" class="ai-form-input" id="aiNoteInput_${msgId}" value="${escapeHtml(state.note)}" oninput="aiUpdateNote('${msgId}', this.value)">
        </div>

        <!-- Nút hành động xác nhận -->
        <div class="ai-confirm-actions">
          <button type="button" class="ai-btn-cancel" onclick="aiDismissConfirmCard('${msgId}')">✕ Bỏ qua</button>
          <button type="button" class="ai-btn-execute" onclick="aiExecuteAddMeal('${msgId}')">
            <span>✅ Xác nhận & Nhập ngay</span>
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
          <button type="button" class="ai-mini-btn-action" onclick="openAppById('ghi-chu')">📝 Xem Sticky Notes</button>
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

  // Tương tác Card trên window
  window.aiUpdatePayer = function (msgId, val) {
    if (activeConfirmationData[msgId]) activeConfirmationData[msgId].payerName = val;
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
    const cardEl = document.getElementById(`mealConfirmCard_${msgId}`);
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
          dishName: 'Cơm trưa',
          amount: data.amountPerPerson
        });
      });

      localStorage.setItem('p2p_members', JSON.stringify(p2pMembers));
      if (window.dbStorage) window.dbStorage.set('p2p_members', JSON.stringify(p2pMembers));

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

      localStorage.setItem('p2p_logs', JSON.stringify(logs));
      if (window.dbStorage) window.dbStorage.set('p2p_logs', JSON.stringify(logs));

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2p_logs',
        newValue: JSON.stringify(logs)
      }));

      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'P2P_LOGS_UPDATED', newLog }, '*');
        } catch (e) {}
      });

      // Update message card inline to Success card
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
  // 4. PARSER LỊCH NHẮC NHỞ (SMART REMINDERS)
  // --------------------------------------------------------------------------
  function parseReminder(rawText) {
    const norm = normalizeVietnamese(rawText);

    const isReminder = /^(nhac|hen|dat gio|luu lich|nho nhac|nhac nho|remind)/i.test(norm) ||
                       norm.includes('nhac toi') || norm.includes('hen gio') || norm.includes('nhac nho');

    if (!isReminder) return null;

    // Extract task text
    let task = rawText
      .replace(/^(nhắc tôi|nhắc nhở|nhớ nhắc|hẹn giờ|lên lịch|nhắc|remind me|remind)\s*/i, '')
      .replace(/\b(ngày mai|mai|hôm nay|nay|ngày kia|mốt)\b/gi, '')
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

    // Lưu vào sys_reminders và p2p_notes
    try {
      let reminders = [];
      try { reminders = JSON.parse(localStorage.getItem('sys_reminders')) || []; } catch (e) {}
      const remItem = {
        id: 'rem_' + Date.now(),
        task,
        timeStr,
        dateStr,
        displayFormatted,
        timestamp: targetDate.getTime(),
        completed: false
      };
      reminders.unshift(remItem);
      localStorage.setItem('sys_reminders', JSON.stringify(reminders));
      if (window.dbStorage) window.dbStorage.set('sys_reminders', JSON.stringify(reminders));

      // Thêm Sticky Note
      let notes = [];
      try { notes = JSON.parse(localStorage.getItem('p2p_notes')) || []; } catch (e) {}
      notes.unshift({
        id: 'note_' + Date.now(),
        title: `⏰ Nhắc nhở: ${displayFormatted}`,
        content: task,
        color: '#fbbf24',
        date: new Date().toLocaleDateString('vi-VN')
      });
      localStorage.setItem('p2p_notes', JSON.stringify(notes));
      if (window.dbStorage) window.dbStorage.set('p2p_notes', JSON.stringify(notes));

      // Push system notification
      if (typeof window.pushSystemNotification === 'function') {
        window.pushSystemNotification({
          title: '⏰ Đã Lên Lịch Nhắc Nhở',
          message: `${task} vào lúc ${displayFormatted}`,
          icon: '⏰',
          tag: 'Nhắc Nhở',
          appUrl: 'apps/ghi-chu/index.html'
        });
      }
    } catch (e) {
      console.warn('Lỗi lưu reminder:', e);
    }

    return {
      task,
      timeStr,
      dateStr,
      displayFormatted
    };
  }

  // --------------------------------------------------------------------------
  // 5. BỘ TRÍ TUỆ NHÂN TẠO OFFLINE (SMART OFFLINE NLP & CHAT ENGINE)
  // --------------------------------------------------------------------------
  function processOfflineConversation(userText) {
    const raw = userText.trim();
    const lower = raw.toLowerCase();
    const norm = normalizeVietnamese(lower);
    const members = getSystemMembers();
    const today = new Date().toISOString().split('T')[0];

    // 1. Nhận diện Đặt Lịch Nhắc Nhở (VD: "nhắc tôi mua cơm ngày mai 9h")
    const reminderData = parseReminder(raw);
    if (reminderData) {
      return {
        replyText: `Dạ vâng! Tôi đã đặt lịch nhắc nhở cho bạn: ⏰ **"${reminderData.task}"** vào lúc **${reminderData.displayFormatted}**.\nThông tin này đã được lưu vào hệ thống Ghi Chú & Thông Báo để bạn không bị bỏ lỡ nhé!`,
        card: {
          type: 'REMINDER',
          data: reminderData
        }
      };
    }

    // 2. Nhận diện Ghi chép Tiền Cơm (VD: "Hôm nay Công trả tiền cơm mỗi người 40k")
    const isMealRelated = norm.includes('tien com') || norm.includes('bua com') || norm.includes('an trua') || norm.includes('an toi') || (norm.includes('com') && (norm.includes('tra') || norm.includes('chi')));
    const isPaymentAction = norm.includes('tra') || norm.includes('chi') || norm.includes('bao') || norm.includes('ung') || norm.includes('thanh toan');

    if (isMealRelated && isPaymentAction) {
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
        replyText: `Tôi đã soạn sẵn phiếu ghi nhận tiền cơm theo yêu cầu của bạn. Người chi trả là **${payerName}** với mức **${formatMoney(amount)}/người**.\nBạn vui lòng kiểm tra lại các thông tin bên dưới và bấm nút **Xác nhận & Nhập ngay** nhé!`,
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

    // 3. Tra cứu công nợ tiền cơm (VD: "ai nợ tiền cơm nhiều nhất")
    if (norm.includes('no tien') || norm.includes('no com') || norm.includes('ai no') || norm.includes('du tien') || norm.includes('am tien')) {
      return {
        replyText: `Dưới đây là tình hình đối soát công nợ tiền cơm hiện tại của các thành viên trong văn phòng:`,
        card: { type: 'DEBTS' }
      };
    }

    // 4. Tra cứu sinh nhật (VD: "tháng này sinh nhật ai")
    if (norm.includes('sinh nhat') || norm.includes('sn') || norm.includes('birthday')) {
      return {
        replyText: `Dưới đây là danh sách sinh nhật các thành viên trong tháng này. Hãy gửi lời chúc ấm áp nhé! 🎂`,
        card: { type: 'BIRTHDAYS' }
      };
    }

    // 5. Mở ứng dụng hệ thống
    if (norm.includes('mo tien com') || norm.includes('vao tien com')) { openAppById('tien-com'); return { replyText: `Đang mở ứng dụng **Tiền Cơm** cho bạn ngay đây! 🥘` }; }
    if (norm.includes('mo danh ba') || norm.includes('vao danh ba')) { openAppById('danh-ba'); return { replyText: `Đang mở ứng dụng **Danh Bạ** cho bạn ngay đây! 👥` }; }
    if (norm.includes('mo ghi chu') || norm.includes('vao ghi chu')) { openAppById('ghi-chu'); return { replyText: `Đang mở ứng dụng **Sticky Notes** cho bạn ngay đây! 📝` }; }
    if (norm.includes('mo chia bill') || norm.includes('vao chia bill')) { openAppById('chia-bill'); return { replyText: `Đang mở ứng dụng **Chia Bill** cho bạn ngay đây! 🧾` }; }
    if (norm.includes('mo cai dat') || norm.includes('control panel')) { openControlPanelAi(); return { replyText: `Đang mở **Bảng điều khiển hệ thống** cho bạn! ⚙️` }; }

    // 6. Ngày giờ & Âm lịch
    if (norm.includes('may gio') || norm.includes('ngay may') || norm.includes('thu may') || norm.includes('am lich') || norm.includes('ngay am')) {
      const d = new Date();
      const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      const dayName = weekdays[d.getDay()];
      const solarStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      return {
        replyText: `Hôm nay là **${dayName}, ngày ${solarStr}**.\nBây giờ là **${timeStr}** ⏰. Chúc bạn làm việc hiệu quả và nhiều niềm vui!`
      };
    }

    // 7. Tính nhẩm nhanh (VD: "500k / 3", "120 * 4", "1500k chia 5")
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

    // 8. Chào hỏi & Trò chuyện xã giao
    if (norm.includes('chao') || norm.includes('hello') || norm.includes('hi') || norm.includes('alo')) {
      return {
        replyText: `Xin chào! Rất vui được gặp bạn hôm nay. Chúc bạn một ngày làm việc thật năng suất! 🌟\nTôi có thể giúp bạn ghi nhận tiền cơm, lên lịch nhắc nhở hay hỗ trợ việc gì không?`
      };
    }

    if (norm.includes('ban la ai') || norm.includes('la gi') || norm.includes('gioi thieu')) {
      return {
        replyText: `Tôi là **Apple Intelligence • Trợ lý AI**, được tích hợp trực tiếp trên macOS Web Dashboard. Tôi có thể:\n• 🥘 Tự động bóc tách & tạo phiếu ghi nhận tiền cơm\n• ⏰ Đặt lịch nhắc nhở thông minh\n• 📊 Tra cứu công nợ & số dư đối soát\n• 🎂 Thông báo sinh nhật các thành viên\n• 💬 Trò chuyện & giải đáp các thắc mắc văn phòng!`
      };
    }

    if (norm.includes('cam on') || norm.includes('thank')) {
      return {
        replyText: `Không có chi! Luôn sẵn sàng hỗ trợ bạn bất kỳ lúc nào. Hãy gọi tôi khi cần nhé! 😊`
      };
    }

    if (norm.includes('cuoi') || norm.includes('hai huoc') || norm.includes('joke')) {
      return {
        replyText: `Một dev bước vào quán cà phê gọi: 1 ly cà phê, 2 ly cà phê, 0 ly cà phê, 99999 ly cà phê và 1 con ếch. Tất cả đều pass test! Khách hàng thật bước vào hỏi nhà vệ sinh ở đâu, quán cà phê liền bốc cháy! 😂`
      };
    }

    // Fallback thông minh
    return {
      replyText: `Tôi đã hiểu câu nói của bạn: *"${raw}"*.\nBạn có thể thử các câu lệnh mẫu nhanh như:\n• "Hôm nay Công trả tiền cơm mỗi người 40k"\n• "Nhắc tôi mua cơm ngày mai 9h"\n• "Ai đang nợ tiền cơm nhiều nhất?"\n• "Tháng này sinh nhật những ai?"\n• Hoặc bấm **⚙️ Cấu hình Gemini AI** bên dưới để kích hoạt mô hình Google Gemini 1.5 Flash trò chuyện siêu thông minh nhé!`
    };
  }

  // --------------------------------------------------------------------------
  // 6. TÍCH HỢP GOOGLE GEMINI 1.5 MULTI-TURN CONVERSATION
  // --------------------------------------------------------------------------
  async function callGeminiApi(userPrompt, apiKey, model) {
    const today = new Date().toISOString().split('T')[0];
    const members = getSystemMembers();
    const membersSummary = members.map(m => `"${m.nickname || m.name}" (${m.fullName || m.name})`).join(', ');

    const systemPrompt = `Bạn là Trợ lý AI Apple Intelligence cho Hệ thống macOS Dashboard Văn Phòng.
Ngày hôm nay: ${today}.
Danh sách thành viên: [${membersSummary}].

Nhiệm vụ: Trò chuyện tự nhiên, thân thiện, thông minh bằng Tiếng Việt.
Nếu người dùng yêu cầu:
1. Ghi nhận tiền cơm / bữa ăn: hãy trò chuyện lịch sự và BẮT BUỘC chèn khối thẻ sau vào cuối câu trả lời:
<ACTION_MEAL_LOG>{"payerName":"Công","amountPerPerson":40000,"eaters":["Công","Đạt","Đô","Hạnh","Quyền","Duy"],"date":"${today}","note":"Ghi chú"}</ACTION_MEAL_LOG>

2. Đặt lịch nhắc nhở: hãy xác nhận lịch nhắc và BẮT BUỘC chèn khối thẻ sau:
<ACTION_REMINDER>{"task":"Mua cơm","timeStr":"09:00","dateStr":"${today}","displayFormatted":"09:00 ngày mai"}</ACTION_REMINDER>

3. Mở ứng dụng: chèn:
<ACTION_OPEN_APP>{"appId":"tien-com"}</ACTION_OPEN_APP>

Đối với các câu hỏi trò chuyện, tính toán, văn phòng khác: hãy trả lời tự nhiên, hóm hỉnh và hữu ích!`;

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Dạ tôi đã hiểu! Tôi sẽ trò chuyện tự nhiên và chèn đúng thẻ Action khi người dùng yêu cầu thao tác.' }] }
    ];

    // Gửi kèm tối đa 6 lượt chat gần nhất để hiểu ngữ cảnh
    const recentMessages = chatHistory.slice(-6);
    recentMessages.forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });

    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
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

    return candidateText;
  }

  // --------------------------------------------------------------------------
  // 7. XỬ LÝ LỆNH NGƯỜI DÙNG & ĐIỀU PHỐI (MAIN DISPATCHER)
  // --------------------------------------------------------------------------
  async function processUserInput(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return;
    const query = userPrompt.trim();

    // 1. Thêm tin nhắn của User vào luồng hội thoại
    const userMsgId = 'msg_' + Date.now();
    chatHistory.push({
      id: userMsgId,
      role: 'user',
      text: query,
      time: getCurrentTimeStr()
    });

    isThinking = true;
    saveChatHistory();
    renderChatThread();
    setAiStatus('Trí tuệ nhân tạo đang suy nghĩ... ✨', 'loading');

    const cfg = getAiConfig();
    let replyText = '';
    let card = null;
    let modelUsed = 'Apple Intelligence Offline Engine';

    try {
      if (cfg.apiKey && cfg.apiKey.trim()) {
        modelUsed = `Google ${cfg.model || DEFAULT_GEMINI_MODEL}`;
        const geminiRaw = await callGeminiApi(query, cfg.apiKey.trim(), cfg.model);

        // Kiểm tra xem Gemini có nhúng các thẻ Action không
        let cleanedText = geminiRaw;

        const mealMatch = geminiRaw.match(/<ACTION_MEAL_LOG>([\s\S]*?)<\/ACTION_MEAL_LOG>/i);
        if (mealMatch) {
          try {
            const parsed = JSON.parse(mealMatch[1]);
            card = { type: 'MEAL_CONFIRM', data: parsed };
            cleanedText = cleanedText.replace(mealMatch[0], '').trim();
          } catch (e) {}
        }

        const reminderMatch = geminiRaw.match(/<ACTION_REMINDER>([\s\S]*?)<\/ACTION_REMINDER>/i);
        if (reminderMatch) {
          try {
            const parsed = JSON.parse(reminderMatch[1]);
            card = { type: 'REMINDER', data: parsed };
            cleanedText = cleanedText.replace(reminderMatch[0], '').trim();
          } catch (e) {}
        }

        const openAppMatch = geminiRaw.match(/<ACTION_OPEN_APP>([\s\S]*?)<\/ACTION_OPEN_APP>/i);
        if (openAppMatch) {
          try {
            const parsed = JSON.parse(openAppMatch[1]);
            openAppById(parsed.appId);
            cleanedText = cleanedText.replace(openAppMatch[0], '').trim();
          } catch (e) {}
        }

        replyText = cleanedText || 'Tôi đã xử lý yêu cầu của bạn!';
      } else {
        // Chế độ Offline NLP siêu mượt
        const offRes = processOfflineConversation(query);
        replyText = offRes.replyText;
        card = offRes.card || null;
      }
    } catch (err) {
      console.warn('[AI Assistant] Lỗi Gemini, chuyển sang bộ xử lý thông minh Offline:', err);
      modelUsed = 'Apple Intelligence Offline (Fallback)';
      const offRes = processOfflineConversation(query);
      replyText = offRes.replyText;
      card = offRes.card || null;
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

    saveChatHistory();
    renderChatThread();
    setAiStatus(`Đã phân tích bởi ${modelUsed}`, 'success');
  }

  // --------------------------------------------------------------------------
  // 8. WEB SPEECH RECOGNITION (GIỌNG NÓI TIẾNG VIỆT)
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
      console.warn('[AI Assistant] Lỗi giọng nói:', event.error);
      stopVoiceListening();
      if (event.error === 'not-allowed') {
        setAiStatus('Microphone bị chặn. Vui lòng cấp quyền micro trong trình duyệt!', 'error');
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
      alert('Trình duyệt của bạn chưa hỗ trợ nhận diện giọng nói Web Speech. Hãy dùng Google Chrome, Safari hoặc Edge!');
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
    if (btn) btn.classList.toggle('active-listening', listening);
    if (orb) orb.classList.toggle('siri-listening', listening);
  }

  // --------------------------------------------------------------------------
  // 9. HIỂN THỊ, ĐÓNG MỞ & TIỆN ÍCH MODAL
  // --------------------------------------------------------------------------
  function showAiAssistantModal() {
    const modal = document.getElementById('aiAssistantModal');
    if (modal) {
      modal.classList.add('show');
      if (!chatHistory || !chatHistory.length) {
        loadChatHistory();
      }
      renderChatThread();
      const input = document.getElementById('aiAssistantInput');
      if (input) setTimeout(() => input.focus(), 120);
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

  function setAiStatus(text) {
    const el = document.getElementById('aiStatusText');
    if (el) el.innerText = text;
  }

  function submitAiPrompt(promptText) {
    const input = document.getElementById('aiAssistantInput');
    const query = promptText || (input ? input.value : '');
    if (!query || !query.trim()) return;

    if (input) input.value = '';
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
  // 10. KHỞI TẠO & PHÍM TẮT
  // --------------------------------------------------------------------------
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      toggleAiAssistant();
    }
    if (e.key === 'Escape') {
      const modal = document.getElementById('aiAssistantModal');
      if (modal && modal.classList.contains('show')) {
        closeAiAssistant();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    loadChatHistory();
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
    submitAiPrompt,
    clearAiChat
  };

  window.toggleAiAssistant = toggleAiAssistant;
  window.closeAiAssistant = closeAiAssistant;
  window.toggleVoiceListening = toggleVoiceListening;
  window.submitAiPrompt = submitAiPrompt;
  window.clearAiChat = clearAiChat;

})();
