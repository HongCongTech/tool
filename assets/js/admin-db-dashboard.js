/**
 * ==============================================================================
 * MACOS ADMIN DATABASE DASHBOARD (admin-db-dashboard.js) - Version 1.0
 * Trung Tâm Quản Trị DB Tập Trung • SQL Runner • Backup & Restore JSON/SQL
 * Hỗ trợ các bảng: members, bills, meal_logs, notes, contacts, system_store
 * Đồng bộ thời gian thực Supabase REST & Offline-First Cache
 * ==============================================================================
 */

(function () {
  'use strict';

  // Định nghĩa Schema và Cột hiển thị của từng bảng
  const TABLE_DEFINITIONS = {
    members: {
      id: 'members',
      name: 'Thành Viên',
      icon: '👥',
      storageKey: 'sys_global_members',
      primaryKey: 'id',
      columns: [
        { key: 'id', label: 'ID', width: '70px' },
        { key: 'name', label: 'Tên', width: '130px' },
        { key: 'fullName', label: 'Họ & Tên', width: '170px' },
        { key: 'phone', label: 'Số Điện Thoại', width: '130px' },
        { key: 'balance', label: 'Số Dư', width: '120px', type: 'currency' },
        { key: 'bankId', label: 'Ngân Hàng', width: '100px' },
        { key: 'accountNo', label: 'Số TK', width: '130px' },
        { key: 'status', label: 'Trạng Thái', width: '100px', type: 'badge' }
      ]
    },
    bills: {
      id: 'bills',
      name: 'Hóa Đơn Chia Bill',
      icon: '🧾',
      storageKey: 'nhau_meals',
      primaryKey: 'id',
      columns: [
        { key: 'id', label: 'Mã Bill', width: '90px' },
        { key: 'title', label: 'Tiêu Đề / Tiệc', width: '200px' },
        { key: 'totalCost', label: 'Tổng Tiền', width: '130px', type: 'currency' },
        { key: 'paidBy', label: 'Người Trả', width: '130px' },
        { key: 'date', label: 'Ngày', width: '110px' },
        { key: 'participants', label: 'Số Người Tham Gia', width: '150px', type: 'array_length' },
        { key: 'note', label: 'Ghi Chú', width: '180px' }
      ]
    },
    meal_logs: {
      id: 'meal_logs',
      name: 'Nhật Ký Tiền Cơm',
      icon: '🍱',
      storageKey: 'p2p_logs',
      primaryKey: 'id',
      columns: [
        { key: 'id', label: 'Mã Log', width: '90px' },
        { key: 'date', label: 'Ngày', width: '110px' },
        { key: 'type', label: 'Loại', width: '120px', type: 'badge' },
        { key: 'amount', label: 'Số Tiền', width: '130px', type: 'currency' },
        { key: 'description', label: 'Nội Dung', width: '220px' },
        { key: 'payer', label: 'Người Chi', width: '120px' }
      ]
    },
    notes: {
      id: 'notes',
      name: 'Ghi Chú & Task',
      icon: '📝',
      storageKey: 'sticky_notes_data',
      primaryKey: 'id',
      columns: [
        { key: 'id', label: 'Mã', width: '80px' },
        { key: 'title', label: 'Tiêu Đề', width: '220px' },
        { key: 'content', label: 'Nội Dung', width: '300px' },
        { key: 'color', label: 'Màu Sắc', width: '100px' },
        { key: 'updated_at', label: 'Cập Nhật', width: '140px' }
      ]
    },
    contacts: {
      id: 'contacts',
      name: 'Danh Bạ',
      icon: '📇',
      storageKey: 'sys_global_members',
      primaryKey: 'id',
      columns: [
        { key: 'id', label: 'ID', width: '70px' },
        { key: 'name', label: 'Tên Gọi', width: '130px' },
        { key: 'fullName', label: 'Họ & Tên', width: '180px' },
        { key: 'phone', label: 'SĐT', width: '130px' },
        { key: 'dob', label: 'Ngày Sinh', width: '110px' },
        { key: 'note', label: 'Chức Danh / Phòng Ban', width: '200px' }
      ]
    },
    system_store: {
      id: 'system_store',
      name: 'Kho Key-Value Hệ Thống',
      icon: '⚙️',
      storageKey: '__RAW_STORE__',
      primaryKey: 'key',
      columns: [
        { key: 'key', label: 'Khóa (Storage Key)', width: '240px' },
        { key: 'size', label: 'Kích Thước', width: '100px' },
        { key: 'preview', label: 'Giá Trị Xem Trước', width: '400px' }
      ]
    }
  };

  let activeTab = 'members'; // 'members' | 'bills' | 'meal_logs' | 'notes' | 'contacts' | 'system_store' | 'sql_runner' | 'backup_restore'
  let searchQuery = '';
  let editingRecord = null;
  let currentTablePage = 1;
  const ADMIN_DB_PAGE_SIZE = 10;
  let isNewRecord = false;

  // Lấy dữ liệu một bảng từ hệ thống
  function getTableRecords(tableId) {
    if (tableId === 'system_store') {
      const records = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !['sys_is_admin', 'sys_raw_master_key', 'mac_admin_mode'].includes(k)) {
          const val = localStorage.getItem(k) || '';
          records.push({
            key: k,
            size: `${(val.length / 1024).toFixed(1)} KB`,
            preview: val.length > 90 ? val.substring(0, 90) + '...' : val,
            fullValue: val
          });
        }
      }
      return records;
    }

    const def = TABLE_DEFINITIONS[tableId];
    if (!def) return [];

    try {
      if (tableId === 'members' && window.memberService) {
        return window.memberService.getAll();
      }
      const raw = localStorage.getItem(def.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'object') return [parsed];
      }
    } catch (e) {
      console.warn(`[AdminDB] Lỗi đọc bảng ${tableId}:`, e);
    }
    return [];
  }

  // Lưu bản ghi vào bảng
  function saveTableRecord(tableId, record, isCreating) {
    if (tableId === 'system_store') {
      if (!record.key) throw new Error('Cần nhập Khóa (Key)!');
      localStorage.setItem(record.key, typeof record.value === 'string' ? record.value : JSON.stringify(record.value));
      return;
    }

    const def = TABLE_DEFINITIONS[tableId];
    if (!def) return;

    let records = getTableRecords(tableId);

    if (isCreating) {
      if (!record[def.primaryKey]) {
        record[def.primaryKey] = tableId === 'members' ? Date.now() : 'rec_' + Date.now();
      }
      record.created_at = new Date().toISOString();
      record.updated_at = new Date().toISOString();
      records.unshift(record);
    } else {
      const pKeyVal = String(record[def.primaryKey]);
      const idx = records.findIndex(r => String(r[def.primaryKey]) === pKeyVal);
      if (idx >= 0) {
        record.updated_at = new Date().toISOString();
        records[idx] = { ...records[idx], ...record };
      } else {
        records.unshift(record);
      }
    }

    // Ghi vào localStorage
    localStorage.setItem(def.storageKey, JSON.stringify(records));

    // Nếu là members -> chỉ cập nhật profile của thành viên đang tham gia nhau_members/p2p_members
    if (tableId === 'members' || tableId === 'contacts') {
      try {
        let p2p = JSON.parse(localStorage.getItem('p2p_members') || '[]');
        if (Array.isArray(p2p) && p2p.length > 0) {
          p2p = p2p.map(m => {
            const r = records.find(rec => String(rec.id) === String(m.id) || (rec.nickname && m.nickname && rec.nickname.toLowerCase() === m.nickname.toLowerCase()));
            if (r) return { ...m, ...r };
            return m;
          });
          localStorage.setItem('p2p_members', JSON.stringify(p2p));
        }
      } catch(e) {}

      try {
        let nhau = JSON.parse(localStorage.getItem('nhau_members') || '[]');
        if (Array.isArray(nhau) && nhau.length > 0) {
          nhau = nhau.map(m => {
            const r = records.find(rec => String(rec.id) === String(m.id) || (rec.nickname && m.nickname && rec.nickname.toLowerCase() === m.nickname.toLowerCase()));
            if (r) return { ...m, ...r };
            return m;
          });
          localStorage.setItem('nhau_members', JSON.stringify(nhau));
        }
      } catch(e) {}
    }

    // Gửi sự kiện cập nhật hệ thống
    window.dispatchEvent(new StorageEvent('storage', { key: def.storageKey, newValue: JSON.stringify(records) }));
    notifyAllApps(def.storageKey);
  }

  // Xóa bản ghi khỏi bảng
  function deleteTableRecord(tableId, recordId) {
    if (tableId === 'system_store') {
      localStorage.removeItem(recordId);
      return;
    }

    const def = TABLE_DEFINITIONS[tableId];
    if (!def) return;

    let records = getTableRecords(tableId);
    const pKey = def.primaryKey;
    records = records.filter(r => String(r[pKey]) !== String(recordId));

    localStorage.setItem(def.storageKey, JSON.stringify(records));

    if (tableId === 'members' || tableId === 'contacts') {
      if (window.memberService && typeof window.memberService.deleteMember === 'function') {
        window.memberService.deleteMember(recordId, { permanent: true });
      }
      localStorage.setItem('sys_global_members', JSON.stringify(records));
      if (window.dbStorage) {
        window.dbStorage.setItem('sys_global_members', JSON.stringify(records));
      }
      try {
        let p2p = JSON.parse(localStorage.getItem('p2p_members') || '[]');
        p2p = p2p.filter(m => String(m.id) !== String(recordId));
        localStorage.setItem('p2p_members', JSON.stringify(p2p));
        if (window.dbStorage) window.dbStorage.setItem('p2p_members', JSON.stringify(p2p));
      } catch(e) {}
      try {
        let nhau = JSON.parse(localStorage.getItem('nhau_members') || '[]');
        nhau = nhau.filter(m => String(m.id) !== String(recordId));
        localStorage.setItem('nhau_members', JSON.stringify(nhau));
        if (window.dbStorage) window.dbStorage.setItem('nhau_members', JSON.stringify(nhau));
      } catch(e) {}
    } else {
      if (window.dbStorage) {
        window.dbStorage.setItem(def.storageKey, JSON.stringify(records));
      }
    }

    window.dispatchEvent(new StorageEvent('storage', { key: def.storageKey, newValue: JSON.stringify(records) }));
    notifyAllApps(def.storageKey);
  }

  function notifyAllApps(key) {
    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED', key }, '*');
        ifr.contentWindow.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
        ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
        ifr.contentWindow.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
      } catch (e) {}
    });
  }

  function formatMoney(num) {
    if (num === null || num === undefined) return '0đ';
    const n = Number(num);
    if (isNaN(n)) return '0đ';
    return n.toLocaleString('vi-VN') + 'đ';
  }

  // --------------------------------------------------------------------------
  // GIAO DIỆN CHÍNH ADMIN DATABASE DASHBOARD
  // --------------------------------------------------------------------------
  function openAdminDatabaseModal(initialTab = 'members') {
    activeTab = initialTab;
    let modal = document.getElementById('admin-database-modal');
    if (!modal) {
      buildAdminDatabaseModalDOM();
      modal = document.getElementById('admin-database-modal');
    }

    modal.classList.add('show');
    if (typeof window.pushDashboardNavState === 'function') {
      window.pushDashboardNavState('modal', { modalId: 'admin-database' });
    }
    renderSidebar();
    renderContent();
  }

  function closeAdminDatabaseModal() {
    const modal = document.getElementById('admin-database-modal');
    if (modal) modal.classList.remove('show');
    closeRecordModal();
    if (typeof window.syncHistoryToHome === 'function') {
      window.syncHistoryToHome();
    }
  }

  function buildAdminDatabaseModalDOM() {
    const wrapper = document.createElement('div');
    wrapper.id = 'admin-database-modal';
    wrapper.className = 'admin-db-modal-overlay';
    wrapper.onclick = function (e) {
      if (e.target === wrapper) closeAdminDatabaseModal();
    };

    wrapper.innerHTML = `
      <div class="admin-db-window" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="admin-db-header">
          <div class="admin-db-traffic-lights">
            <button class="admin-db-traffic-btn close" onclick="window.adminDatabase.close()" title="Đóng"></button>
            <button class="admin-db-traffic-btn min" onclick="window.adminDatabase.close()" title="Thu nhỏ"></button>
            <button class="admin-db-traffic-btn max" title="Toàn màn hình"></button>
          </div>
          <div class="admin-db-title-wrap">
            <span class="admin-db-title">🗄️ Quản Trị Cơ Sở Dữ Liệu Tập Trung (Admin Database)</span>
            <span class="admin-db-badge-cloud" id="adminDbCloudStatusBadge">
              <span id="dbRealtimeStatusDot" style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span>
              Supabase PostgreSQL REST
            </span>
          </div>
          <div class="admin-db-header-actions">
            <button class="admin-db-btn-top" onclick="window.adminDatabase.refresh()">🔄 Làm mới</button>
            <button class="admin-db-btn-top" onclick="window.adminDatabase.open('backup_restore')">💾 Sao Lưu</button>
            <button class="admin-db-btn-top" onclick="window.adminDatabase.close()" style="background:#ef4444; border-color:#ef4444; color:#fff;">✕ Đóng</button>
          </div>
        </div>

        <!-- Body -->
        <div class="admin-db-body">
          <!-- Sidebar -->
          <div class="admin-db-sidebar">
            <div class="admin-db-sidebar-section-title">BẢNG DỮ LIỆU (TABLES)</div>
            <div id="adminDbNavList"></div>

            <div class="admin-db-sidebar-section-title" style="margin-top:14px;">CÔNG CỤ NÂNG CAO</div>
            <div class="admin-db-nav-item" id="nav_sql_runner" onclick="window.adminDatabase.switchTab('sql_runner')">
              <span>⚡ SQL Runner</span>
              <span class="nav-count">SQL</span>
            </div>
            <div class="admin-db-nav-item" id="nav_backup_restore" onclick="window.adminDatabase.switchTab('backup_restore')">
              <span>💾 Sao Lưu & Phục Hồi</span>
              <span class="nav-count">JSON/SQL</span>
            </div>
          </div>

          <!-- Main Content Area -->
          <div class="admin-db-content" id="adminDbMainContent"></div>
        </div>

        <!-- Form Record Edit Modal Con -->
        <div class="admin-db-record-modal" id="adminDbRecordModal">
          <div class="admin-db-record-box">
            <div class="admin-db-record-header">
              <span id="recordModalTitle">Bản Ghi</span>
              <button type="button" class="admin-db-traffic-btn close" onclick="window.adminDatabase.closeRecordModal()"></button>
            </div>
            <div class="admin-db-record-body" id="recordModalBody"></div>
            <div class="admin-db-record-footer">
              <button class="admin-db-btn admin-db-btn-secondary" onclick="window.adminDatabase.closeRecordModal()">Hủy</button>
              <button class="admin-db-btn admin-db-btn-primary" onclick="window.adminDatabase.submitRecordForm()">💾 Lưu Bản Ghi</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);
  }

  function renderSidebar() {
    const navList = document.getElementById('adminDbNavList');
    if (!navList) return;

    let html = '';
    for (const [key, def] of Object.entries(TABLE_DEFINITIONS)) {
      const records = getTableRecords(key);
      const isActive = activeTab === key ? 'active' : '';
      html += `
        <div class="admin-db-nav-item ${isActive}" onclick="window.adminDatabase.switchTab('${key}')">
          <span>${def.icon} ${def.name}</span>
          <span class="nav-count">${records.length}</span>
        </div>
      `;
    }
    navList.innerHTML = html;

    // Highlight các tab nâng cao
    const sqlNav = document.getElementById('nav_sql_runner');
    if (sqlNav) sqlNav.className = `admin-db-nav-item ${activeTab === 'sql_runner' ? 'active' : ''}`;

    const backupNav = document.getElementById('nav_backup_restore');
    if (backupNav) backupNav.className = `admin-db-nav-item ${activeTab === 'backup_restore' ? 'active' : ''}`;
  }

  function renderContent() {
    const container = document.getElementById('adminDbMainContent');
    if (!container) return;

    if (activeTab === 'sql_runner') {
      renderSqlRunnerView(container);
      return;
    }

    if (activeTab === 'backup_restore') {
      renderBackupRestoreView(container);
      return;
    }

    // Table View bình thường
    renderTableView(container);
  }

  // --------------------------------------------------------------------------
  // TABLE VIEW (Xem, Tìm kiếm, CRUD)
  // --------------------------------------------------------------------------
  function renderTableView(container) {
    const def = TABLE_DEFINITIONS[activeTab];
    if (!def) return;

    const allRecords = getTableRecords(activeTab);
    const filteredRecords = allRecords.filter(item => {
      if (!searchQuery) return true;
      const str = JSON.stringify(item).toLowerCase();
      return str.includes(searchQuery.toLowerCase());
    });

    let headerThs = def.columns.map(col => `<th style="width:${col.width || 'auto'}">${col.label}</th>`).join('');
    headerThs += `<th style="width:100px; text-align:right;">Thao Tác</th>`;

    let rowsHtml = '';
    let displayRecords = filteredRecords;
    let paginationHtml = '';

    if (filteredRecords.length > 30) {
      const totalPages = Math.ceil(filteredRecords.length / ADMIN_DB_PAGE_SIZE) || 1;
      if (currentTablePage > totalPages) currentTablePage = totalPages;
      if (currentTablePage < 1) currentTablePage = 1;

      const startIdx = (currentTablePage - 1) * ADMIN_DB_PAGE_SIZE;
      displayRecords = filteredRecords.slice(startIdx, startIdx + ADMIN_DB_PAGE_SIZE);

      paginationHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 18px; background:rgba(30, 41, 59, 0.5); border-top:1px solid rgba(255,255,255,0.06); font-size:12.5px;">
          <span style="color:#94a3b8;">Trang <b>${currentTablePage}</b> / <b>${totalPages}</b> (${filteredRecords.length} bản ghi)</span>
          <div style="display:flex; gap:6px;">
            <button class="admin-db-btn admin-db-btn-secondary" ${currentTablePage <= 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window.adminDatabase.changePage(-1)">◄ Trước</button>
            <button class="admin-db-btn admin-db-btn-secondary" ${currentTablePage >= totalPages ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window.adminDatabase.changePage(1)">Sau ►</button>
          </div>
        </div>
      `;
    }

    if (filteredRecords.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="${def.columns.length + 1}" style="text-align:center; padding:40px; color:#94a3b8;">
            <div style="font-size:36px; margin-bottom:10px;">🔍</div>
            <div>Chưa có bản ghi nào hoặc không tìm thấy kết quả phù hợp!</div>
          </td>
        </tr>
      `;
    } else {
      displayRecords.forEach((row, index) => {
        let colsHtml = def.columns.map(col => {
          let val = row[col.key];
          if (col.type === 'currency') {
            return `<td><b style="color:#38bdf8;">${formatMoney(val)}</b></td>`;
          }
          if (col.type === 'badge') {
            const isGreen = val === 'active' || val === 'Thu' || val === 'Deposit';
            const bg = isGreen ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
            const color = isGreen ? '#4ade80' : '#f87171';
            return `<td><span style="font-size:11px; padding:2px 8px; border-radius:10px; background:${bg}; color:${color}; font-weight:600;">${val || 'None'}</span></td>`;
          }
          if (col.type === 'array_length') {
            const count = Array.isArray(val) ? val.length : 0;
            return `<td><span style="font-family:monospace; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">${count} người</span></td>`;
          }
          if (val === null || val === undefined) val = '';
          return `<td>${escapeHtml(String(val))}</td>`;
        }).join('');

        const pKeyVal = row[def.primaryKey];
        colsHtml += `
          <td>
            <div class="admin-db-col-actions">
              <button class="admin-db-icon-btn" onclick="window.adminDatabase.editRecord('${activeTab}', '${pKeyVal}')" title="Sửa bản ghi">✏️</button>
              <button class="admin-db-icon-btn delete" onclick="window.adminDatabase.deleteRecordPrompt('${activeTab}', '${pKeyVal}')" title="Xóa bản ghi">🗑️</button>
            </div>
          </td>
        `;

        rowsHtml += `<tr>${colsHtml}</tr>`;
      });
    }

    container.innerHTML = `
      <!-- Toolbar -->
      <div class="admin-db-toolbar">
        <div class="admin-db-search-box">
          <span>🔍</span>
          <input type="text" class="admin-db-search-input" placeholder="Tìm kiếm trong bảng ${def.name}..." value="${escapeHtml(searchQuery)}" oninput="window.adminDatabase.setSearch(this.value)">
          ${searchQuery ? `<button style="background:none; border:none; color:#94a3b8; cursor:pointer;" onclick="window.adminDatabase.setSearch('')">✕</button>` : ''}
        </div>
        <div class="admin-db-toolbar-actions">
          <span style="font-size:12px; color:#94a3b8; margin-right:6px;">Hiển thị <b>${filteredRecords.length}/${allRecords.length}</b> bản ghi</span>
          <button class="admin-db-btn admin-db-btn-success" onclick="window.adminDatabase.createRecord('${activeTab}')">➕ Thêm Bản Ghi</button>
          <button class="admin-db-btn admin-db-btn-secondary" onclick="window.adminDatabase.exportTableJson('${activeTab}')">📥 Xuất JSON</button>
        </div>
      </div>

      <!-- Table Container -->
      <div class="admin-db-table-container" style="${filteredRecords.length > 10 && filteredRecords.length <= 30 ? 'max-height: 480px; overflow-y: auto;' : ''}">
        <table class="admin-db-table">
          <thead>
            <tr>${headerThs}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      ${paginationHtml}
    `;
  }

  // --------------------------------------------------------------------------
  // FORM THÊM / SỬA BẢN GHI (CRUD MODAL)
  // --------------------------------------------------------------------------
  function openRecordModal(tableId, recordId = null) {
    const modal = document.getElementById('adminDbRecordModal');
    const body = document.getElementById('recordModalBody');
    const titleEl = document.getElementById('recordModalTitle');
    if (!modal || !body) return;

    const def = TABLE_DEFINITIONS[tableId];
    if (!def) return;

    isNewRecord = recordId === null;
    let record = {};
    if (!isNewRecord) {
      const records = getTableRecords(tableId);
      record = records.find(r => String(r[def.primaryKey]) === String(recordId)) || {};
    }
    editingRecord = record;

    titleEl.textContent = isNewRecord ? `➕ Thêm Bản Ghi Mới (${def.name})` : `✏️ Sửa Bản Ghi (${def.name} #${recordId})`;

    let fieldsHtml = '';
    if (tableId === 'system_store') {
      fieldsHtml = `
        <div class="admin-db-field">
          <label>Khóa (Key):</label>
          <input type="text" id="recordField_key" value="${escapeHtml(record.key || '')}" ${!isNewRecord ? 'readonly style="opacity:0.7;"' : ''}>
        </div>
        <div class="admin-db-field">
          <label>Giá Trị (JSON hoặc Chuỗi):</label>
          <textarea id="recordField_value" style="height:220px; font-family:monospace; font-size:12.5px;">${escapeHtml(record.fullValue || '')}</textarea>
        </div>
      `;
    } else {
      // Form thông minh theo các cột của bảng
      def.columns.forEach(col => {
        const val = record[col.key] !== undefined ? record[col.key] : '';
        const isReadonly = !isNewRecord && col.key === def.primaryKey;

        if (col.type === 'currency' || col.key === 'balance' || col.key === 'totalCost' || col.key === 'amount') {
          fieldsHtml += `
            <div class="admin-db-field">
              <label>${col.label}:</label>
              <input type="number" id="recordField_${col.key}" value="${Number(val) || 0}">
            </div>
          `;
        } else if (col.type === 'array_length' || typeof val === 'object') {
          fieldsHtml += `
            <div class="admin-db-field">
              <label>${col.label} (Định dạng JSON Mảng/Đối tượng):</label>
              <textarea id="recordField_${col.key}" style="height:70px; font-family:monospace;">${escapeHtml(JSON.stringify(val || []))}</textarea>
            </div>
          `;
        } else if (col.key === 'content' || col.key === 'note' || col.key === 'description') {
          fieldsHtml += `
            <div class="admin-db-field">
              <label>${col.label}:</label>
              <textarea id="recordField_${col.key}" style="height:70px;">${escapeHtml(String(val))}</textarea>
            </div>
          `;
        } else {
          fieldsHtml += `
            <div class="admin-db-field">
              <label>${col.label}:</label>
              <input type="text" id="recordField_${col.key}" value="${escapeHtml(String(val))}" ${isReadonly ? 'readonly style="opacity:0.7;"' : ''}>
            </div>
          `;
        }
      });
    }

    body.innerHTML = fieldsHtml;
    modal.classList.add('show');
  }

  function closeRecordModal() {
    const modal = document.getElementById('adminDbRecordModal');
    if (modal) modal.classList.remove('show');
    editingRecord = null;
  }

  function submitRecordForm() {
    const def = TABLE_DEFINITIONS[activeTab];
    if (!def) return;

    try {
      const newObj = { ...editingRecord };
      if (activeTab === 'system_store') {
        const k = document.getElementById('recordField_key')?.value.trim();
        const v = document.getElementById('recordField_value')?.value;
        if (!k) return alert('Khóa (Key) không được để trống!');
        saveTableRecord('system_store', { key: k, value: v }, isNewRecord);
      } else {
        def.columns.forEach(col => {
          const el = document.getElementById(`recordField_${col.key}`);
          if (el) {
            let val = el.value;
            if (col.type === 'currency' || col.key === 'balance' || col.key === 'totalCost' || col.key === 'amount') {
              val = Number(val) || 0;
            } else if (col.type === 'array_length' || typeof editingRecord[col.key] === 'object') {
              try { val = JSON.parse(val); } catch (e) {}
            }
            newObj[col.key] = val;
          }
        });
        saveTableRecord(activeTab, newObj, isNewRecord);
      }

      closeRecordModal();
      renderSidebar();
      renderContent();
      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu bản ghi bảng ${def.name} thành công!`);
      }
    } catch (err) {
      alert('Lỗi lưu bản ghi: ' + err.message);
    }
  }

  function deleteRecordPrompt(tableId, recordId) {
    const def = TABLE_DEFINITIONS[tableId];
    if (!confirm(`⚠️ Bạn có chắc chắn muốn xóa bản ghi "${recordId}" khỏi bảng ${def.name} không?\nThao tác này sẽ đồng bộ xóa trên toàn bộ các app và Supabase Cloud!`)) {
      return;
    }

    try {
      deleteTableRecord(tableId, recordId);
      renderSidebar();
      renderContent();
      if (typeof window.showToast === 'function') {
        window.showToast(`🗑️ Đã xóa bản ghi khỏi bảng ${def.name}!`);
      }
    } catch (err) {
      alert('Lỗi khi xóa: ' + err.message);
    }
  }

  // --------------------------------------------------------------------------
  // SQL RUNNER (Thực thi SQL mini & Parser)
  // --------------------------------------------------------------------------
  function renderSqlRunnerView(container) {
    container.innerHTML = `
      <div class="admin-db-sql-view">
        <div>
          <div style="font-size:14px; font-weight:700; color:#f8fafc; margin-bottom:4px;">⚡ Khung Thực Thi Câu Lệnh SQL Mini (SQL Runner)</div>
          <div style="font-size:12px; color:#94a3b8;">Chạy các lệnh <code>SELECT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>INSERT</code> trực tiếp qua Supabase Cloud REST và CSDL Cục bộ.</div>
        </div>

        <div class="admin-db-sql-snippets">
          <span style="font-size:11.5px; color:#64748b; align-self:center;">Câu lệnh mẫu nhanh:</span>
          <button class="admin-db-sql-snippet-btn" onclick="window.adminDatabase.setSql('SELECT * FROM members WHERE balance > 0;')">Thành viên có dư nợ</button>
          <button class="admin-db-sql-snippet-btn" onclick="window.adminDatabase.setSql('SELECT id, title, totalCost, paidBy, date FROM bills ORDER BY date DESC;')">Danh sách Hóa đơn Chia Bill</button>
          <button class="admin-db-sql-snippet-btn" onclick="window.adminDatabase.setSql('SELECT * FROM meal_logs ORDER BY date DESC LIMIT 10;')">10 Bữa cơm gần nhất</button>
          <button class="admin-db-sql-snippet-btn" onclick="window.adminDatabase.setSql('UPDATE members SET balance = 0;')">Cân bằng số dư members về 0đ</button>
          <button class="admin-db-sql-snippet-btn" onclick="window.adminDatabase.setSql('SELECT * FROM notes;')">Tất cả ghi chú</button>
        </div>

        <div class="admin-db-sql-editor-wrap">
          <textarea id="adminDbSqlInput" class="admin-db-sql-textarea" placeholder="Nhập câu lệnh SQL tại đây (VD: SELECT * FROM members;)...">SELECT * FROM members;</textarea>
          <div class="admin-db-sql-status-bar">
            <span>💡 <i>Mẹo: Nhấn <b>Ctrl + Enter</b> để thực thi nhanh</i></span>
            <div style="display:flex; gap:8px;">
              <button class="admin-db-btn admin-db-btn-secondary" style="padding:4px 10px; font-size:11.5px;" onclick="document.getElementById('adminDbSqlInput').value = ''">Xóa Trắng</button>
              <button class="admin-db-btn admin-db-btn-primary" style="padding:5px 14px; font-size:12.5px;" onclick="window.adminDatabase.runSql()">▶️ Thực Thi SQL</button>
            </div>
          </div>
        </div>

        <!-- Khu vực kết quả truy vấn -->
        <div id="adminDbSqlResultArea" style="flex:1; min-height:220px; display:flex; flex-direction:column; overflow:hidden;">
          <div style="color:#94a3b8; font-size:12.5px; font-style:italic; padding:20px; text-align:center; border:1px dashed rgba(255,255,255,0.1); border-radius:10px;">
            Nhập câu lệnh SQL phía trên và bấm <b>Thực Thi SQL</b> để xem kết quả.
          </div>
        </div>
      </div>
    `;

    // Phím tắt Ctrl+Enter
    const textarea = document.getElementById('adminDbSqlInput');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          runSql();
        }
      });
    }
  }

  function setSql(query) {
    const input = document.getElementById('adminDbSqlInput');
    if (input) {
      input.value = query;
      input.focus();
    }
  }

  async function runSql() {
    const input = document.getElementById('adminDbSqlInput');
    const resultArea = document.getElementById('adminDbSqlResultArea');
    if (!input || !resultArea) return;

    const rawSql = input.value.trim();
    if (!rawSql) {
      alert('Vui lòng nhập câu lệnh SQL!');
      return;
    }

    resultArea.innerHTML = `<div style="padding:20px; text-align:center; color:#38bdf8;">⚡ Đang thực thi truy vấn...</div>`;
    const startTime = performance.now();

    try {
      const res = await executeSqlQuery(rawSql);
      const executionTime = (performance.now() - startTime).toFixed(2);

      let tableHtml = '';
      if (Array.isArray(res.rows) && res.rows.length > 0) {
        const sample = res.rows[0];
        const cols = Object.keys(sample);
        const ths = cols.map(c => `<th>${c}</th>`).join('');
        const trs = res.rows.map(row => {
          return `<tr>${cols.map(c => {
            const val = row[c];
            return `<td>${typeof val === 'object' ? escapeHtml(JSON.stringify(val)) : escapeHtml(String(val !== null && val !== undefined ? val : ''))}</td>`;
          }).join('')}</tr>`;
        }).join('');

        tableHtml = `
          <div class="admin-db-table-container" style="border:1px solid rgba(255,255,255,0.1); border-radius:8px;">
            <table class="admin-db-table">
              <thead><tr>${ths}</tr></thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        `;
      }

      resultArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:12.5px; color:#4ade80;">
            ✅ <b>${res.message || 'Truy vấn thành công!'}</b>
            <span style="color:#94a3b8; font-size:11.5px; margin-left:10px;">⏱️ ${executionTime}ms • 📊 ${res.rowCount || 0} dòng</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="admin-db-btn admin-db-btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="window.adminDatabase.copySqlResultJson()">📋 Copy JSON</button>
          </div>
        </div>
        ${tableHtml}
      `;

      window._lastSqlResult = res.rows || [];
    } catch (err) {
      resultArea.innerHTML = `
        <div style="padding:16px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; color:#f87171; font-size:13px; line-height:1.6;">
          <b>❌ Lỗi cú pháp hoặc thực thi SQL:</b><br>
          <code>${escapeHtml(err.message)}</code>
        </div>
      `;
    }
  }

  // Bộ thực thi & Parser SQL thông minh
  async function executeSqlQuery(sql) {
    const clean = sql.replace(/--.*$/gm, '').trim();
    const upper = clean.toUpperCase();

    // 1. Thử gọi Supabase RPC exec_sql nếu có
    const cfg = window.dbStorage ? window.dbStorage.getSupabaseConfig() : null;
    if (cfg && cfg.url && cfg.anonKey) {
      try {
        const rpcRes = await fetch(`${cfg.url}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'apikey': cfg.anonKey,
            'Authorization': `Bearer ${cfg.anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: clean })
        });
        if (rpcRes.ok) {
          const rows = await rpcRes.json();
          return { message: 'Đã thực thi trên máy chủ Supabase PostgreSQL', rowCount: rows.length, rows: rows };
        }
      } catch (e) {}
    }

    // 2. Parser SQL nội bộ cho hệ thống Offline & Local
    if (upper.startsWith('SELECT')) {
      const fromMatch = clean.match(/FROM\s+([a-zA-Z0-9_]+)/i);
      if (!fromMatch) throw new Error('Thiếu mệnh đề FROM trong câu lệnh SELECT.');
      const tableName = fromMatch[1].toLowerCase();

      let records = getTableRecords(tableName);
      if (records.length === 0 && TABLE_DEFINITIONS[tableName]) {
        records = getTableRecords(tableName);
      }

      // Lọc WHERE đơn giản (WHERE col = val hoặc WHERE col > val)
      const whereMatch = clean.match(/WHERE\s+([a-zA-Z0-9_]+)\s*([=><!]+)\s*('[^']*'|[0-9]+)/i);
      if (whereMatch) {
        const col = whereMatch[1];
        const op = whereMatch[2];
        let target = whereMatch[3].replace(/'/g, '');
        const numTarget = Number(target);

        records = records.filter(item => {
          const val = item[col];
          if (!isNaN(numTarget) && typeof val === 'number') {
            if (op === '=') return val === numTarget;
            if (op === '>') return val > numTarget;
            if (op === '<') return val < numTarget;
            if (op === '>=') return val >= numTarget;
            if (op === '<=') return val <= numTarget;
          }
          if (op === '=') return String(val).toLowerCase() === target.toLowerCase();
          if (op === '!=') return String(val).toLowerCase() !== target.toLowerCase();
          return true;
        });
      }

      // LIMIT
      const limitMatch = clean.match(/LIMIT\s+([0-9]+)/i);
      if (limitMatch) {
        const limitNum = parseInt(limitMatch[1], 10);
        records = records.slice(0, limitNum);
      }

      return {
        message: `Đã truy vấn ${records.length} dòng từ bảng ${tableName}`,
        rowCount: records.length,
        rows: records
      };
    }

    if (upper.startsWith('UPDATE')) {
      const match = clean.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+)/i);
      if (!match) throw new Error('Cú pháp UPDATE không hợp lệ! Ví dụ: UPDATE members SET balance = 0;');
      const tableName = match[1].toLowerCase();
      const col = match[2];
      let val = match[3].trim().replace(/'/g, '');
      if (!isNaN(Number(val))) val = Number(val);

      let records = getTableRecords(tableName);
      records.forEach(r => {
        r[col] = val;
        r.updated_at = new Date().toISOString();
      });

      const def = TABLE_DEFINITIONS[tableName];
      if (def) {
        localStorage.setItem(def.storageKey, JSON.stringify(records));
        notifyAllApps(def.storageKey);
      }

      return {
        message: `Đã cập nhật trường "${col}" cho ${records.length} dòng trong bảng ${tableName}!`,
        rowCount: records.length,
        rows: records
      };
    }

    if (upper.startsWith('DELETE')) {
      const match = clean.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
      if (!match) throw new Error('Cú pháp DELETE không hợp lệ!');
      const tableName = match[1].toLowerCase();
      const def = TABLE_DEFINITIONS[tableName];
      if (!def) throw new Error(`Không tìm thấy bảng ${tableName}!`);

      localStorage.setItem(def.storageKey, JSON.stringify([]));
      notifyAllApps(def.storageKey);

      return {
        message: `Đã xóa toàn bộ dữ liệu bảng ${tableName} về rỗng!`,
        rowCount: 0,
        rows: []
      };
    }

    throw new Error('Chỉ hỗ trợ các câu lệnh SELECT, UPDATE, DELETE qua SQL Runner Client.');
  }

  function copySqlResultJson() {
    if (!window._lastSqlResult) return alert('Chưa có kết quả để copy!');
    navigator.clipboard.writeText(JSON.stringify(window._lastSqlResult, null, 2))
      .then(() => alert('📋 Đã sao chép kết quả JSON vào Clipboard!'))
      .catch(e => alert('Lỗi sao chép: ' + e.message));
  }

  // --------------------------------------------------------------------------
  // BACKUP & RESTORE (Sao Lưu & Phục Hồi Toàn Diện)
  // --------------------------------------------------------------------------
  function renderBackupRestoreView(container) {
    const rawCount = localStorage.length;
    const mems = getTableRecords('members');
    const bills = getTableRecords('bills');
    const logs = getTableRecords('meal_logs');
    const notes = getTableRecords('notes');

    container.innerHTML = `
      <div class="admin-db-backup-view">
        <div>
          <div style="font-size:15px; font-weight:700; color:#f8fafc; margin-bottom:4px;">💾 Sao Lưu & Phục Hồi Dữ Liệu Toàn Hệ Thống</div>
          <div style="font-size:12.5px; color:#94a3b8;">Tải toàn bộ cơ sở dữ liệu về máy tính cá nhân để lưu trữ phòng hờ hoặc chuyển sang thiết bị khác an toàn 100%.</div>
        </div>

        <!-- Thẻ Export -->
        <div class="admin-db-card">
          <div style="font-size:14px; font-weight:700; color:#38bdf8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <span>📤 Xuất Dữ Liệu (Backup Export)</span>
          </div>
          <div style="font-size:12.5px; color:#cbd5e1; line-height:1.6; margin-bottom:14px;">
            Hệ thống hiện đang lưu giữ:
            <b>${mems.length} thành viên</b>, 
            <b>${bills.length} hóa đơn chia bill</b>, 
            <b>${logs.length} nhật ký tiền cơm</b>, 
            <b>${notes.length} ghi chú</b> và 
            <b>${rawCount} khóa hệ thống</b>.
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="admin-db-btn admin-db-btn-success" onclick="window.adminDatabase.exportFullDatabaseJson()">
              📥 Export Full Database (JSON)
            </button>
            <button class="admin-db-btn admin-db-btn-secondary" onclick="window.adminDatabase.exportFullDatabaseSql()">
              📜 Export Full Database (SQL Dump)
            </button>
          </div>
        </div>

        <!-- Thẻ Import -->
        <div class="admin-db-card">
          <div style="font-size:14px; font-weight:700; color:#4ade80; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <span>📥 Phục Hồi Dữ Liệu (Restore Database)</span>
          </div>
          <div style="font-size:12.5px; color:#cbd5e1; line-height:1.6; margin-bottom:12px;">
            Chọn file sao lưu <code>.json</code> đã tải về trước đó để khôi phục toàn bộ bảng dữ liệu.
          </div>

          <div class="admin-db-dropzone" id="adminDbDropzone" onclick="document.getElementById('adminDbFileInput').click()">
            <input type="file" id="adminDbFileInput" accept=".json" style="display:none;" onchange="window.adminDatabase.handleFileSelected(event)">
            <div style="font-size:36px; margin-bottom:8px;">📁</div>
            <div style="font-size:13.5px; font-weight:600; color:#f8fafc; margin-bottom:4px;">Nhấp để chọn file JSON hoặc Kéo & Thả file vào đây</div>
            <div style="font-size:12px; color:#94a3b8;">Hỗ trợ định dạng backup chuẩn của Hong Cong Tech Tool Hub</div>
          </div>
          <div id="adminDbRestoreStatus" style="margin-top:12px; font-size:12.5px; display:none;"></div>
        </div>
      </div>
    `;

    setupDropzone();
  }

  function setupDropzone() {
    const dropzone = document.getElementById('adminDbDropzone');
    if (!dropzone) return;

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleBackupFile(file);
    });
  }

  function handleFileSelected(e) {
    const file = e.target?.files?.[0];
    if (file) handleBackupFile(file);
  }

  function handleBackupFile(file) {
    if (!file.name.endsWith('.json')) {
      alert('Vui lòng chọn file định dạng .json!');
      return;
    }

    const reader = new FileReader();
    reader.onload = async function (evt) {
      try {
        const backupData = JSON.parse(evt.target.result);
        if (!confirm(`⚠️ Xác nhận khôi phục dữ liệu từ file "${file.name}"?\nHệ thống sẽ nạp dữ liệu và đồng bộ lên Supabase Cloud!`)) {
          return;
        }

        const res = await window.dbStorage.importFullDatabase(backupData, 'merge');
        alert(`✅ Khôi phục thành công ${res.count} bảng & khóa dữ liệu!`);
        renderSidebar();
        renderContent();
      } catch (err) {
        alert('Lỗi khôi phục: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function exportFullDatabaseJson() {
    if (!window.dbStorage || typeof window.dbStorage.exportFullDatabase !== 'function') {
      alert('Chưa tải được mô-đun sao lưu!');
      return;
    }

    const dump = window.dbStorage.exportFullDatabase();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(dump, null, 2));
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `tool_hub_database_backup_${now}.json`);
    dlAnchor.click();

    if (typeof window.showToast === 'function') {
      window.showToast('✅ Đã tải về file Full Database Backup (JSON)!');
    }
  }

  function exportFullDatabaseSql() {
    const mems = getTableRecords('members');
    const bills = getTableRecords('bills');
    const logs = getTableRecords('meal_logs');
    const notes = getTableRecords('notes');

    let sql = `-- =============================================================================\n`;
    sql += `-- HONG CONG TECH TOOL HUB - FULL DATABASE SQL DUMP\n`;
    sql += `-- Exported at: ${new Date().toISOString()}\n`;
    sql += `-- =============================================================================\n\n`;

    // 1. Members
    sql += `-- TABLE: members\n`;
    mems.forEach(m => {
      const name = (m.name || '').replace(/'/g, "''");
      const phone = (m.phone || '').replace(/'/g, "''");
      const bal = Number(m.balance) || 0;
      sql += `INSERT INTO members (id, name, phone, balance) VALUES (${m.id}, '${name}', '${phone}', ${bal}) ON CONFLICT (id) DO UPDATE SET balance = EXCLUDED.balance;\n`;
    });
    sql += `\n`;

    // 2. Bills
    sql += `-- TABLE: bills\n`;
    bills.forEach(b => {
      const title = (b.title || '').replace(/'/g, "''");
      const total = Number(b.totalCost) || 0;
      sql += `INSERT INTO bills (id, title, total_amount, date) VALUES ('${b.id}', '${title}', ${total}, '${b.date || ''}');\n`;
    });

    const dataStr = 'data:text/plain;charset=utf-8,' + encodeURIComponent(sql);
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `tool_hub_database_dump_${now}.sql`);
    dlAnchor.click();
  }

  function exportTableJson(tableName) {
    const records = getTableRecords(tableName);
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `${tableName}_table.json`);
    dlAnchor.click();
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
  // LẮNG NGHE STORAGE ĐỂ ĐỒNG BỘ REALTIME
  // --------------------------------------------------------------------------
  window.addEventListener('storage', () => {
    const modal = document.getElementById('admin-database-modal');
    if (modal && modal.classList.contains('show')) {
      renderSidebar();
      renderContent();
    }
  });

  // --------------------------------------------------------------------------
  // PUBLIC API EXPORT
  // --------------------------------------------------------------------------
  window.adminDatabase = {
    open: openAdminDatabaseModal,
    close: closeAdminDatabaseModal,
    switchTab: function (tab) {
      activeTab = tab;
      searchQuery = '';
      renderSidebar();
      renderContent();
    },
    setSearch: function (q) {
      searchQuery = q;
      renderContent();
    },
    refresh: function () {
      renderSidebar();
      renderContent();
      if (typeof window.showToast === 'function') window.showToast('🔄 Đã làm mới dữ liệu Database!');
    },
    createRecord: (tab) => openRecordModal(tab, null),
    editRecord: (tab, id) => openRecordModal(tab, id),
    deleteRecordPrompt,
    closeRecordModal,
    submitRecordForm,
    setSql,
    runSql,
    copySqlResultJson,
    handleFileSelected,
    exportFullDatabaseJson,
    exportFullDatabaseSql,
    exportTableJson
  };

  window.openAdminDatabaseModal = openAdminDatabaseModal;

  console.log('⚡ [AdminDatabase] Đã khởi tạo Module Quản Trị CSDL Tập Trung (Table View, SQL Runner, Backup/Restore).');
})();
