/**
 * ==============================================================================
 * MEMBER SERVICE & SUPABASE REST BRIDGE (member-service.js) - Version 1.0
 * Quản lý Thành Viên Động • Supabase Cloud REST • Offline Cache & Queue
 * Hỗ trợ: Thêm, Sửa, Xóa, Bật/Tắt (Active/Inactive), Thêm nhanh 1-Click
 * Đồng bộ tức thì tới Tiền Cơm, Chia Bill, Danh Bạ và Control Panel
 * ==============================================================================
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'sys_global_members';
  const OFFLINE_QUEUE_KEY = 'sys_members_offline_queue';
  const DELETED_MEMBERS_KEY = 'sys_deleted_members';
  const DEFAULT_SUPABASE_URL = 'https://wqzwxzwrozbpetbwbgrk.supabase.co';

  // Danh sách mẫu phòng làm việc mặc định (đầy đủ anh em trong phòng)
  const ROOM_PRESET_MEMBERS = [
    { id: 1, name: 'Đô', nickname: 'Đô', fullName: 'Nguyễn Văn Đô', phone: '0981234561', bankId: 'MB', accountNo: '0981234561', accountName: 'NGUYEN VAN DO', note: 'Thủ quỹ phòng', status: 'active', is_active: true },
    { id: 2, name: 'Đạt', nickname: 'Đạt Còi', fullName: 'Trần Thành Đạt', phone: '0972345672', bankId: 'VCB', accountNo: '1012345672', accountName: 'TRAN THANH DAT', note: 'Kỹ thuật', status: 'active', is_active: true },
    { id: 3, name: 'Công', nickname: 'Công', fullName: 'Lê Thành Công', phone: '0963456783', bankId: 'TCB', accountNo: '1903456783', accountName: 'LE THANH CONG', note: 'Kế toán / Quản lý', status: 'active', is_active: true },
    { id: 4, name: 'Hạnh', nickname: 'Hạnh', fullName: 'Phạm Mỹ Hạnh', phone: '0914567894', bankId: 'ACB', accountNo: '214567894', accountName: 'PHAM MY HANH', note: 'Thiết kế', status: 'active', is_active: true },
    { id: 5, name: 'Quyền', nickname: 'Quyền', fullName: 'Vũ Đình Quyền', phone: '0935678905', bankId: 'VPB', accountNo: '0935678905', accountName: 'VU DINH QUYEN', note: 'Marketing', status: 'active', is_active: true },
    { id: 6, name: 'Duy', nickname: 'Duy', fullName: 'Hoàng Đức Duy', phone: '0906789016', bankId: 'BIDV', accountNo: '1206789016', accountName: 'HOANG DUC DUY', note: 'Phát triển', status: 'active', is_active: true },
    { id: 7, name: 'Huy', nickname: 'Huy', fullName: 'Nguyễn Quang Huy', phone: '0912888333', bankId: 'MB', accountNo: '0912888333', accountName: 'NGUYEN QUANG HUY', note: 'Thành viên phòng', status: 'active', is_active: true },
    { id: 8, name: 'Thiện', nickname: 'Thiện', fullName: 'Đặng Ngọc Thiện', phone: '0988777666', bankId: 'TCB', accountNo: '1903888777', accountName: 'DANG NGOC THIEN', note: 'Thành viên phòng', status: 'active', is_active: true }
  ];


  // Quản lý Danh Sách Đã Xóa Vĩnh Viễn (Deletion Tombstones)
  function getDeletedMembersBlacklist() {
    try {
      const raw = localStorage.getItem(DELETED_MEMBERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function addDeletedMemberToBlacklist(id, name, nickname) {
    try {
      const list = getDeletedMembersBlacklist();
      const strId = String(id);
      const cleanNick = (nickname || '').trim().toLowerCase();
      const cleanName = (name || '').trim().toLowerCase();
      
      const exists = list.some(item => 
        String(item.id) === strId || 
        (cleanNick && item.nickname && item.nickname.toLowerCase() === cleanNick) ||
        (cleanName && item.name && item.name.toLowerCase() === cleanName)
      );

      if (!exists) {
        list.push({
          id: strId,
          name: name || '',
          nickname: nickname || '',
          deleted_at: new Date().toISOString()
        });
        const serialized = JSON.stringify(list);
        localStorage.setItem(DELETED_MEMBERS_KEY, serialized);
        try {
          const db = window.dbStorage || (window.top && window.top.dbStorage);
          if (db && typeof db.setItem === 'function') db.setItem(DELETED_MEMBERS_KEY, serialized);
        } catch(e) {}
      }
    } catch (e) {}
  }

  function removeDeletedMemberFromBlacklist(id, name) {
    try {
      let list = getDeletedMembersBlacklist();
      const strId = String(id);
      const cleanName = (name || '').trim().toLowerCase();
      list = list.filter(item => String(item.id) !== strId && (!cleanName || item.name.toLowerCase() !== cleanName));
      const serialized = JSON.stringify(list);
      localStorage.setItem(DELETED_MEMBERS_KEY, serialized);
      try {
        const db = window.dbStorage || (window.top && window.top.dbStorage);
        if (db && typeof db.setItem === 'function') db.setItem(DELETED_MEMBERS_KEY, serialized);
      } catch(e) {}
    } catch(e) {}
  }

  function isMemberDeleted(m) {
    if (!m) return false;
    const list = getDeletedMembersBlacklist();
    if (list.length === 0) return false;
    const strId = String(m.id);
    const mNick = (m.nickname || m.name || '').trim().toLowerCase();
    const mFull = (m.fullName || m.full_name || m.name || '').trim().toLowerCase();
    const mName = (m.name || '').trim().toLowerCase();

    return list.some(d => {
      const dId = String(d.id);
      const dNick = (d.nickname || d.name || '').trim().toLowerCase();
      const dName = (d.name || '').trim().toLowerCase();

      if (dId === strId) return true;
      if (dNick && mNick && dNick === mNick) return true;
      if (dName && mName && dName === mName) return true;
      if (dNick && mName && dNick === mName) return true;
      if (dName && mNick && dName === mNick) return true;
      return false;
    });
  }

  let memoryMembers = [];
  let isFetchingSupabase = false;
  let isFlushingQueue = false;
  let lastSyncTime = null;

  // Lấy cấu hình Supabase
  function getSupabaseConfig() {
    let url = DEFAULT_SUPABASE_URL;
    let anonKey = '';

    if (window.__SUPABASE_CONFIG__) {
      if (window.__SUPABASE_CONFIG__.url) url = window.__SUPABASE_CONFIG__.url.trim();
      if (window.__SUPABASE_CONFIG__.anonKey) anonKey = window.__SUPABASE_CONFIG__.anonKey.trim();
    }

    try {
      const storedUrl = localStorage.getItem('supabase_url');
      if (storedUrl && storedUrl.trim()) url = storedUrl.trim();
      const storedKey = localStorage.getItem('supabase_anon_key');
      if (storedKey && storedKey.trim()) anonKey = storedKey.trim();
    } catch (e) {}

    if (url.endsWith('/')) url = url.slice(0, -1);
    return { url, anonKey };
  }

  // Khởi tạo bộ nhớ từ Cache cục bộ
  function loadFromLocalCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          memoryMembers = normalizeMemberList(parsed);
          return memoryMembers;
        }
      }
    } catch (e) {}

    // Fallback sang các key cũ nếu chưa có sys_global_members
    try {
      const rawP2p = localStorage.getItem('p2p_members');
      if (rawP2p) {
        const parsedP2p = JSON.parse(rawP2p);
        if (Array.isArray(parsedP2p) && parsedP2p.length > 0) {
          memoryMembers = normalizeMemberList(parsedP2p);
          saveToLocalCache(memoryMembers);
          return memoryMembers;
        }
      }
    } catch (e) {}

    memoryMembers = normalizeMemberList(ROOM_PRESET_MEMBERS);
    return memoryMembers;
  }

  // Chuẩn hóa cấu trúc thành viên
  function normalizeMemberList(list) {
    if (!Array.isArray(list)) return [];
    const blacklist = getDeletedMembersBlacklist();
    return list.filter(m => !isMemberDeleted(m)).map(m => {
      const idVal = m.id !== undefined && m.id !== null ? m.id : Date.now();
      const nameVal = m.name || m.nickname || m.fullName || 'Thành viên';
      const statusVal = m.status === 'inactive' || m.is_active === false ? 'inactive' : 'active';
      return {
        id: idVal,
        code: String(m.code || idVal),
        name: nameVal,
        nickname: m.nickname || m.name || nameVal,
        fullName: m.fullName || m.full_name || m.name || nameVal,
        phone: m.phone || '',
        dob: m.dob || '',
        bankId: m.bankId || m.bank_id || '',
        accountNo: m.accountNo || m.account_no || '',
        accountName: (m.accountName || m.account_name || '').toUpperCase(),
        balance: typeof m.balance === 'number' ? m.balance : 0,
        note: m.note || '',
        status: statusVal,
        is_active: statusVal === 'active',
        created_at: m.created_at || new Date().toISOString(),
        updated_at: m.updated_at || new Date().toISOString()
      };
    });
  }

  // Lưu cache cục bộ và đồng bộ các app con
  function saveToLocalCache(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      const db = window.dbStorage || (window.top && window.top.dbStorage);
      if (db && typeof db.setItem === 'function') {
        db.setItem(STORAGE_KEY, JSON.stringify(list));
      }
    } catch (e) {}

    // Đồng bộ sang danh sách nhau_members (Chia Bill)
    syncToChiaBillStorage(list);

    // Đồng bộ sang danh sách p2p_members (Tiền Cơm)
    syncToTienComStorage(list);

    // Phát sự kiện toàn hệ thống
    dispatchSystemEvents();
  }

  // Cập nhật nhau_members cho Chia Bill (chỉ cập nhật profile của thành viên đang tham gia, KHÔNG tự ý thêm lại người đã gỡ)
  function syncToChiaBillStorage(globalList) {
    try {
      const raw = localStorage.getItem('nhau_members');
      if (raw !== null) {
        // Đã có danh sách Chia Bill -> Chỉ cập nhật thông tin cá nhân (Bank, Phone,...) cho người ĐANG CÓ MẶT
        let existing = [];
        try { existing = JSON.parse(raw); } catch(e) {}
        if (Array.isArray(existing) && existing.length > 0) {
          let hasDiff = false;
          const updated = existing.map(m => {
            const strId = String(m.id);
            const gm = (globalList || []).find(g => 
              String(g.id) === strId || 
              (g.nickname && m.nickname && g.nickname.toLowerCase() === m.nickname.toLowerCase()) || 
              (g.fullName && m.fullName && g.fullName.toLowerCase() === m.fullName.toLowerCase()) ||
              (g.name && m.name && g.name.toLowerCase() === m.name.toLowerCase())
            );
            if (!gm) return m;
            const newObj = {
              ...m,
              fullName: gm.fullName || gm.full_name || m.fullName || m.name,
              nickname: gm.nickname || m.nickname || m.name,
              name: gm.nickname || gm.name || m.name,
              phone: gm.phone || m.phone || '',
              dob: gm.dob || m.dob || '',
              bankId: gm.bankId || gm.bank_id || m.bankId || '',
              accountNo: gm.accountNo || gm.account_no || m.accountNo || '',
              accountName: (gm.accountName || gm.account_name || m.accountName || '').toUpperCase(),
              note: gm.note !== undefined ? gm.note : (m.note || '')
            };
            if (JSON.stringify(newObj) !== JSON.stringify(m)) hasDiff = true;
            return newObj;
          });
          if (hasDiff) {
            localStorage.setItem('nhau_members', JSON.stringify(updated));
            try {
              const db = window.dbStorage || (window.top && window.top.dbStorage);
              if (db && typeof db.setItem === 'function') db.setItem('nhau_members', JSON.stringify(updated));
            } catch(e) {}
          }
          return;
        }
      }
      // Tuyệt đối không tự ý đổ toàn bộ Danh Bạ vào nhóm Chia Bill!
    } catch (e) {}
  }

  // Cập nhật p2p_members cho Tiền Cơm (chỉ cập nhật profile của thành viên đang tham gia, KHÔNG tự ý thêm lại người đã gỡ)
  function syncToTienComStorage(globalList) {
    try {
      const raw = localStorage.getItem('p2p_members');
      if (raw !== null) {
        // Đã có danh sách Tiền Cơm -> Chỉ cập nhật thông tin cá nhân (Bank, Phone,...) cho người ĐANG CÓ MẶT
        let existing = [];
        try { existing = JSON.parse(raw); } catch(e) {}
        if (Array.isArray(existing) && existing.length > 0) {
          let hasDiff = false;
          const updated = existing.map(m => {
            const strId = String(m.id);
            const gm = (globalList || []).find(g => 
              String(g.id) === strId || 
              (g.nickname && m.nickname && g.nickname.toLowerCase() === m.nickname.toLowerCase()) || 
              (g.fullName && m.fullName && g.fullName.toLowerCase() === m.fullName.toLowerCase()) ||
              (g.name && m.name && g.name.toLowerCase() === m.name.toLowerCase())
            );
            if (!gm) return m;
            const newObj = {
              ...m,
              fullName: gm.fullName || gm.full_name || m.fullName || m.name,
              nickname: gm.nickname || m.nickname || m.name,
              name: gm.nickname || gm.name || m.name,
              phone: gm.phone || m.phone || '',
              dob: gm.dob || m.dob || '',
              bankId: gm.bankId || gm.bank_id || m.bankId || '',
              accountNo: gm.accountNo || gm.account_no || m.accountNo || '',
              accountName: (gm.accountName || gm.account_name || m.accountName || '').toUpperCase(),
              note: gm.note !== undefined ? gm.note : (m.note || '')
            };
            if (JSON.stringify(newObj) !== JSON.stringify(m)) hasDiff = true;
            return newObj;
          });
          if (hasDiff) {
            localStorage.setItem('p2p_members', JSON.stringify(updated));
            try {
              const db = window.dbStorage || (window.top && window.top.dbStorage);
              if (db && typeof db.setItem === 'function') db.setItem('p2p_members', JSON.stringify(updated));
            } catch(e) {}
          }
          return;
        }
      }
      // Tuyệt đối không tự ý đổ toàn bộ Danh Bạ vào nhóm Tiền Cơm!
    } catch (e) {}
  }

  // Phát thông báo cho mọi app và iframe
  function dispatchSystemEvents() {
    try {
      const ev = new CustomEvent('member_data_changed', {
        detail: {
          members: memoryMembers,
          activeMembers: getActiveMembers(),
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(ev);

      // Phát StorageEvent để các tab và iframe bắt được
      window.dispatchEvent(new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: JSON.stringify(memoryMembers)
      }));

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'nhau_members',
        newValue: localStorage.getItem('nhau_members')
      }));

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'p2p_members',
        newValue: localStorage.getItem('p2p_members')
      }));

      // Gửi event trực tiếp cho các iframe
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({
            type: 'MEMBERS_UPDATED',
            members: memoryMembers,
            globalMembers: memoryMembers,
            activeMembers: getActiveMembers()
          }, '*');
          ifr.contentWindow.postMessage({ type: 'NHAU_DATA_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          ifr.contentWindow.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
        } catch (e) {}
      });

      // BroadcastChannel
      if ('BroadcastChannel' in window) {
        try {
          const payload = {
            type: 'MEMBERS_UPDATED',
            members: memoryMembers,
            globalMembers: memoryMembers,
            comMembers: JSON.parse(localStorage.getItem('p2p_members') || '[]'),
            nhauMembers: JSON.parse(localStorage.getItem('nhau_members') || '[]')
          };
          new BroadcastChannel('system_member_sync').postMessage(payload);
          new BroadcastChannel('members_sync').postMessage(payload);
          new BroadcastChannel('chia_bill_sync').postMessage({ type: 'CHIA_BILL_UPDATED' });
        } catch (e) {}
      }
    } catch (e) {}
  }

  // =========================================================================
  // SUPABASE REST API INTEGRATION
  // =========================================================================

  // Tải danh sách thành viên từ Supabase Cloud
  async function fetchFromSupabase() {
    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) return false;

    if (isFetchingSupabase) return false;
    isFetchingSupabase = true;

    try {
      const endpoint = `${url}/rest/v1/members?select=*&order=id.asc`;
      const res = await fetch(endpoint, {
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.warn('[MemberService] Supabase HTTP error:', res.status);
        return false;
      }

      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        // Chuẩn hóa tên trường từ Supabase (snake_case -> camelCase)
        const mapped = rows.map(r => ({
          id: r.id,
          code: r.code || String(r.id),
          name: r.name || r.nickname || r.full_name || '',
          nickname: r.nickname || r.name || '',
          fullName: r.full_name || r.fullName || r.name || '',
          phone: r.phone || '',
          dob: r.dob || '',
          bankId: r.bank_id || r.bankId || '',
          accountNo: r.account_no || r.accountNo || '',
          accountName: (r.account_name || r.accountName || '').toUpperCase(),
          balance: typeof r.balance === 'number' ? r.balance : 0,
          note: r.note || '',
          status: r.status === 'inactive' || r.is_active === false ? 'inactive' : 'active',
          is_active: r.is_active !== false && r.status !== 'inactive',
          created_at: r.created_at || new Date().toISOString(),
          updated_at: r.updated_at || new Date().toISOString()
        })).filter(m => !isMemberDeleted(m));

        // BẢO VỆ CHỐNG MẤT DỮ LIỆU CỤC BỘ: Không để Supabase vô tình xóa mất thành viên nội bộ
        let localExisting = [];
        try {
          const rawLocal = localStorage.getItem(STORAGE_KEY);
          if (rawLocal) localExisting = JSON.parse(rawLocal);
        } catch(e) {}

        const remoteIdSet = new Set(mapped.map(m => String(m.id)));
        const extraLocalMembers = (Array.isArray(localExisting) ? localExisting : []).filter(loc => loc && loc.id && !remoteIdSet.has(String(loc.id)) && !isMemberDeleted(loc));

        let finalMembers = [...mapped];
        if (extraLocalMembers.length > 0) {
          console.log(`🛡️ [MemberService] Bảo vệ an toàn ${extraLocalMembers.length} thành viên nội bộ chưa có trên Cloud:`, extraLocalMembers.map(m => m.name || m.fullName));
          extraLocalMembers.forEach(extra => {
            finalMembers.push(extra);
            enqueueOfflineAction('ADD', extra.id, extra);
          });
          setTimeout(flushOfflineQueue, 800);
        }

        memoryMembers = finalMembers;
        saveToLocalCache(finalMembers);
        lastSyncTime = new Date();
        console.log(`⚡ [MemberService] Đã đồng bộ an toàn ${finalMembers.length} thành viên từ Supabase Cloud!`);
        return true;
      }
    } catch (err) {
      console.warn('[MemberService] Không thể kết nối Supabase, dùng cache:', err.message);
    } finally {
      isFetchingSupabase = false;
    }
    return false;
  }

  // Chuyển đối tượng sang định dạng Supabase table
  function formatForSupabase(m) {
    return {
      id: m.id,
      code: String(m.code || m.id),
      name: m.name || m.nickname || m.fullName || '',
      full_name: m.fullName || m.name || '',
      nickname: m.nickname || m.name || '',
      phone: m.phone || '',
      dob: m.dob || '',
      bank_id: m.bankId || '',
      account_no: m.accountNo || '',
      account_name: (m.accountName || '').toUpperCase(),
      balance: typeof m.balance === 'number' ? m.balance : 0,
      note: m.note || '',
      status: m.status || 'active',
      is_active: m.is_active !== false && m.status !== 'inactive',
      updated_at: new Date().toISOString()
    };
  }

  // Lưu thao tác vào Hàng Đợi Ngoại Tuyến (Offline Queue)
  function enqueueOfflineAction(actionType, id, payload) {
    try {
      let queue = [];
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (raw) queue = JSON.parse(raw);
      queue.push({
        actionType,
        id,
        payload,
        timestamp: Date.now()
      });
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      console.log(`📦 [MemberService] Đã lưu thao tác [${actionType}] vào Offline Queue.`);
    } catch (e) {}
  }

  // Đẩy hàng đợi ngoại tuyến lên Supabase khi có mạng
  async function flushOfflineQueue() {
    if (isFlushingQueue) return;
    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) return;

    let queue = [];
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (raw) queue = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (!Array.isArray(queue) || queue.length === 0) return;

    isFlushingQueue = true;
    console.log(`🚀 [MemberService] Đang đẩy ${queue.length} thao tác ngoại tuyến lên Supabase...`);

    const remainingQueue = [];
    for (const item of queue) {
      try {
        if (item.actionType === 'ADD' || item.actionType === 'UPSERT') {
          await fetch(`${url}/rest/v1/members`, {
            method: 'POST',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(formatForSupabase(item.payload))
          });
        } else if (item.actionType === 'UPDATE') {
          await fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(formatForSupabase(item.payload))
          });
        } else if (item.actionType === 'DELETE') {
          await fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(item.id)}`, {
            method: 'DELETE',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`
            }
          });
        }
      } catch (err) {
        remainingQueue.push(item);
      }
    }

    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));
    } catch (e) {}

    isFlushingQueue = false;
    if (remainingQueue.length === 0) {
      console.log('✅ [MemberService] Đồng bộ ngoại tuyến hoàn tất 100%!');
    }
  }

  // =========================================================================
  // CRUD APIs FOR MEMBERS
  // =========================================================================

  // Lấy toàn bộ danh sách thành viên
  function getAllMembers(options = {}) {
    const includeInactive = options.includeInactive !== false;
    if (!includeInactive) {
      return getActiveMembers();
    }
    return [...memoryMembers];
  }

  // Lấy danh sách thành viên đang hoạt động (Active)
  function getActiveMembers() {
    return memoryMembers.filter(m => m.status === 'active' && m.is_active !== false);
  }

  // Tìm thành viên theo ID
  function getMemberById(id) {
    return memoryMembers.find(m => String(m.id) === String(id)) || null;
  }

  // Tìm thành viên theo tên hoặc biệt danh
  function getMemberByName(nameOrNickname) {
    if (!nameOrNickname) return null;
    const clean = String(nameOrNickname).toLowerCase().trim();
    return memoryMembers.find(m =>
      (m.name && m.name.toLowerCase().trim() === clean) ||
      (m.nickname && m.nickname.toLowerCase().trim() === clean) ||
      (m.fullName && m.fullName.toLowerCase().trim() === clean)
    ) || null;
  }

  // THÊM THÀNH VIÊN MỚI
  async function addMember(data) {
    const rawName = (data.name || data.nickname || data.fullName || '').trim();
    if (!rawName) throw new Error('Tên thành viên không được để trống!');
    removeDeletedMemberFromBlacklist(data.id, rawName);

    // Sinh ID mới
    let nextId = 1;
    if (memoryMembers.length > 0) {
      const validIds = memoryMembers.map(m => parseInt(m.id, 10)).filter(n => Number.isFinite(n) && n > 0 && n < 2000000000);
      nextId = validIds.length > 0 ? (Math.max(...validIds) + 1) : 1;
    }

    const newMember = {
      id: data.id || nextId,
      code: String(data.code || data.id || nextId),
      name: rawName,
      nickname: (data.nickname || rawName).trim(),
      fullName: (data.fullName || rawName).trim(),
      phone: (data.phone || '').trim(),
      dob: data.dob || '',
      bankId: (data.bankId || 'MB').trim(),
      accountNo: (data.accountNo || '').trim(),
      accountName: (data.accountName || rawName).trim().toUpperCase(),
      balance: typeof data.balance === 'number' ? data.balance : 0,
      note: (data.note || 'Thành viên mới').trim(),
      status: data.status || 'active',
      is_active: data.status !== 'inactive' && data.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Cập nhật bộ nhớ & cache cục bộ tức thì
    memoryMembers.push(newMember);
    saveToLocalCache(memoryMembers);

    // 2. Gửi Supabase REST
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey && navigator.onLine) {
      try {
        const res = await fetch(`${url}/rest/v1/members`, {
          method: 'POST',
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(formatForSupabase(newMember))
        });

        if (res.ok) {
          const inserted = await res.json();
          if (Array.isArray(inserted) && inserted.length > 0) {
            newMember.id = inserted[0].id;
            saveToLocalCache(memoryMembers);
          }
          console.log(`✅ [MemberService] Đã lưu thành viên "${newMember.nickname}" lên Supabase!`);
          return newMember;
        } else {
          enqueueOfflineAction('ADD', newMember.id, newMember);
        }
      } catch (err) {
        console.warn('[MemberService] Lỗi kết nối Supabase, ghi queue:', err.message);
        enqueueOfflineAction('ADD', newMember.id, newMember);
      }
    } else {
      enqueueOfflineAction('ADD', newMember.id, newMember);
    }

    return newMember;
  }

  // SỬA THÔNG TIN THÀNH VIÊN
  async function updateMember(id, fields) {
    const idx = memoryMembers.findIndex(m => String(m.id) === String(id));
    if (idx === -1) throw new Error(`Không tìm thấy thành viên có ID ${id}`);

    const current = memoryMembers[idx];
    const updated = {
      ...current,
      ...fields,
      id: current.id, // ID không được đổi
      updated_at: new Date().toISOString()
    };

    if (fields.status) {
      updated.status = fields.status;
      updated.is_active = fields.status === 'active';
    } else if (typeof fields.is_active === 'boolean') {
      updated.is_active = fields.is_active;
      updated.status = fields.is_active ? 'active' : 'inactive';
    }

    memoryMembers[idx] = updated;
    saveToLocalCache(memoryMembers);

    // Gửi Supabase PATCH
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey && navigator.onLine) {
      try {
        const res = await fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formatForSupabase(updated))
        });
        if (!res.ok) {
          enqueueOfflineAction('UPDATE', current.id, updated);
        }
      } catch (err) {
        enqueueOfflineAction('UPDATE', current.id, updated);
      }
    } else {
      enqueueOfflineAction('UPDATE', current.id, updated);
    }

    return updated;
  }

  // BẬT / TẮT TRẠNG THÁI THÀNH VIÊN (AN TOÀN - KHÔNG XÓA DỮ LIỆU CŨ)
  async function toggleMemberStatus(id, explicitStatus) {
    const member = getMemberById(id);
    if (!member) throw new Error(`Không tìm thấy thành viên ID ${id}`);

    let newStatus = explicitStatus;
    if (!newStatus) {
      newStatus = member.status === 'active' ? 'inactive' : 'active';
    }

    return await updateMember(id, {
      status: newStatus,
      is_active: newStatus === 'active'
    });
  }

  // XÓA THÀNH VIÊN (HỖ TRỢ SOFT-DELETE & PERMANENT DELETE - ATOMIC & TOMBSTONES)
  async function deleteMember(id, options = {}) {
    const permanent = options.permanent !== false;
    const strId = String(id);
    const member = getMemberById(id) || memoryMembers.find(m => String(m.id) === strId || m.name === id || m.nickname === id);
    const memName = member ? (member.name || member.nickname) : '';
    const memNick = member ? member.nickname : '';

    if (!permanent) {
      if (member) return await toggleMemberStatus(member.id, 'inactive');
      return false;
    }

    // 1. Thêm vào Danh Sách Đã Xóa Vĩnh Viễn (Tombstones Blacklist)
    addDeletedMemberToBlacklist(strId, memName, memNick);

    // 2. Dọn sạch các thao tác ngoại tuyến cũ liên quan đến thành viên này
    try {
      let q = [];
      const rawQ = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (rawQ) q = JSON.parse(rawQ);
      if (Array.isArray(q)) {
        q = q.filter(it => String(it.id) !== strId && (!memName || !it.payload || (it.payload.name !== memName && it.payload.nickname !== memNick)));
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
      }
    } catch(e) {}

    // 3. Xóa hẳn khỏi memoryMembers (cả theo ID và Tên/Nickname)
    memoryMembers = memoryMembers.filter(m => {
      if (String(m.id) === strId) return false;
      if (member && (m.name === member.name || m.nickname === member.nickname)) return false;
      return true;
    });
    saveToLocalCache(memoryMembers);

    // 4. Đồng bộ tức thì lên Supabase Cloud qua dbStorage
    if (window.dbStorage) {
      window.dbStorage.setItem(STORAGE_KEY, JSON.stringify(memoryMembers));
      const p2p = localStorage.getItem('p2p_members');
      if (p2p) window.dbStorage.setItem('p2p_members', p2p);
      const nhau = localStorage.getItem('nhau_members');
      if (nhau) window.dbStorage.setItem('nhau_members', nhau);
    }

    // 5. Cập nhật instance window.top.memberService nếu chạy trong iframe
    if (window.top && window.top !== window && window.top.memberService && typeof window.top.memberService.deleteMember === 'function') {
      try {
        if (window.top.memberService !== window.memberService) {
          window.top.memberService.deleteMember(id, { permanent: true });
        }
      } catch(e) {}
    }

    // 6. Gửi lệnh xóa triệt để lên bảng members trên Supabase (xóa theo ID, Name và Nickname)
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey && navigator.onLine) {
      try {
        await Promise.allSettled([
          fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
          }),
          memName ? fetch(`${url}/rest/v1/members?name=eq.${encodeURIComponent(memName)}`, {
            method: 'DELETE',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
          }) : Promise.resolve(),
          memNick ? fetch(`${url}/rest/v1/members?nickname=eq.${encodeURIComponent(memNick)}`, {
            method: 'DELETE',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
          }) : Promise.resolve()
        ]);
      } catch (err) {
        enqueueOfflineAction('DELETE', id, null);
      }
    } else {
      enqueueOfflineAction('DELETE', id, null);
    }

    return true;
  }

  // THÊM NHANH THÀNH VIÊN TỪ PRESET 1 CÚ CLICK (Đô, Đạt, Hạnh, Quyền, Huy, Thiện,...)
  async function quickAddPreset(nameOrNickname) {
    const clean = String(nameOrNickname).toLowerCase().trim();
    const preset = ROOM_PRESET_MEMBERS.find(p =>
      p.name.toLowerCase() === clean ||
      p.nickname.toLowerCase() === clean ||
      p.fullName.toLowerCase() === clean
    );

    if (!preset) {
      // Nếu không có trong preset mặc định, tạo mới nhanh với tên được truyền vào
      return await addMember({
        name: nameOrNickname,
        nickname: nameOrNickname,
        fullName: nameOrNickname,
        note: 'Thành viên mới trong phòng'
      });
    }

    // Kiểm tra xem đã tồn tại chưa
    const existing = memoryMembers.find(m =>
      m.name.toLowerCase() === preset.name.toLowerCase() ||
      m.nickname.toLowerCase() === preset.nickname.toLowerCase()
    );

    if (existing) {
      // Nếu đã tồn tại nhưng đang bị ẩn -> Bật lại
      if (existing.status === 'inactive' || existing.is_active === false) {
        return await toggleMemberStatus(existing.id, 'active');
      }
      return existing; // Đã có và đang active
    }

    // Chưa có -> Thêm mới
    return await addMember({ ...preset, id: null });
  }

  // =========================================================================
  // KHỞI ĐỘNG VÀ ĐỒNG BỘ
  // =========================================================================
  loadFromLocalCache();

  // Khởi động đồng bộ nền với Supabase Cloud
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      fetchFromSupabase().then(() => {
        flushOfflineQueue();
      });
    }, 500);

    // Lắng nghe sự kiện Online để tự động flush hàng đợi
    window.addEventListener('online', () => {
      console.log('🌐 [MemberService] Kết nối mạng đã phục hồi! Đang đồng bộ hàng đợi...');
      flushOfflineQueue();
      fetchFromSupabase();
    });

    // Lắng nghe định kỳ mỗi 30s
    setInterval(() => {
      if (navigator.onLine) {
        flushOfflineQueue();
      }
    }, 30000);
  }

  // =========================================================================
  // GIAO DIỆN QUẢN LÝ THÀNH VIÊN MODAL (ADMIN PANEL UI CONTROLLER)
  // =========================================================================
  let currentFilterTab = 'all'; // 'all' | 'active' | 'inactive'
  let currentSearchQuery = '';

  function openMembersManagerModal() {
    const modal = document.getElementById('membersManagerModal');
    if (!modal) return;
    modal.classList.add('active');
    if (typeof window.pushDashboardNavState === 'function') {
      window.pushDashboardNavState('modal', { modalId: 'members' });
    }
    renderMembersManagerUI();
  }

  function closeMembersManagerModal() {
    const modal = document.getElementById('membersManagerModal');
    if (modal) modal.classList.remove('active');
    closeMemberFormModal();
    if (typeof window.syncHistoryToHome === 'function') {
      window.syncHistoryToHome();
    }
  }

  function setMembersFilterTab(tab) {
    currentFilterTab = tab;
    document.querySelectorAll('.members-filter-tabs .filter-tab').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-filter') === tab);
    });
    renderMembersManagerUI();
  }

  function handleMembersSearch(query) {
    currentSearchQuery = (query || '').toLowerCase().trim();
    renderMembersManagerUI();
  }

  function renderPresetChips() {
    const container = document.getElementById('memberPresetChipsList');
    if (!container) return;
    const presets = ROOM_PRESET_MEMBERS;
    container.innerHTML = presets.map(p => {
      const existing = memoryMembers.find(m =>
        m.name.toLowerCase() === p.name.toLowerCase() ||
        m.nickname.toLowerCase() === p.nickname.toLowerCase()
      );
      if (existing) {
        if (existing.status === 'active' && existing.is_active !== false) {
          return `<button type="button" class="preset-chip is-active" title="${p.fullName} - Đang hoạt động">
            <span>✅</span> ${p.nickname || p.name}
          </button>`;
        } else {
          return `<button type="button" class="preset-chip is-inactive" onclick="quickAddPresetFromUI('${p.name}')" title="Bấm để kích hoạt lại ${p.fullName} (1-Click)">
            <span>⚪</span> + ${p.nickname || p.name} (Bật lại)
          </button>`;
        }
      } else {
        return `<button type="button" class="preset-chip not-present" onclick="quickAddPresetFromUI('${p.name}')" title="Bấm thêm ${p.fullName} vào phòng (1-Click)">
          <span>➕</span> + ${p.nickname || p.name}
        </button>`;
      }
    }).join('');
  }

  function renderMembersManagerUI() {
    renderPresetChips();

    const container = document.getElementById('membersCardsContainer');
    if (!container) return;

    let list = [...memoryMembers];

    // Filter by tab
    if (currentFilterTab === 'active') {
      list = list.filter(m => m.status === 'active' && m.is_active !== false);
    } else if (currentFilterTab === 'inactive') {
      list = list.filter(m => m.status === 'inactive' || m.is_active === false);
    }

    // Filter by search query
    if (currentSearchQuery) {
      list = list.filter(m =>
        (m.name || '').toLowerCase().includes(currentSearchQuery) ||
        (m.nickname || '').toLowerCase().includes(currentSearchQuery) ||
        (m.fullName || '').toLowerCase().includes(currentSearchQuery) ||
        (m.phone || '').toLowerCase().includes(currentSearchQuery) ||
        (m.accountNo || '').toLowerCase().includes(currentSearchQuery) ||
        (m.bankId || '').toLowerCase().includes(currentSearchQuery) ||
        (m.note || '').toLowerCase().includes(currentSearchQuery)
      );
    }

    // Update Tab Counts
    const allCount = memoryMembers.length;
    const activeCount = memoryMembers.filter(m => m.status === 'active' && m.is_active !== false).length;
    const inactiveCount = allCount - activeCount;

    const elAll = document.getElementById('countTabAll');
    if (elAll) elAll.innerText = allCount;
    const elAct = document.getElementById('countTabActive');
    if (elAct) elAct.innerText = activeCount;
    const elInact = document.getElementById('countTabInactive');
    if (elInact) elInact.innerText = inactiveCount;

    // Footer summary
    const footerSummary = document.getElementById('membersFooterSummary');
    if (footerSummary) {
      footerSummary.innerText = `Tổng cộng ${allCount} thành viên (${activeCount} đang hoạt động, ${inactiveCount} đã ẩn)`;
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:35px 20px; color:#94a3b8; font-style:italic;">
          <div style="font-size:32px; margin-bottom:10px;">🔍</div>
          Không tìm thấy thành viên nào phù hợp. Hãy bấm nút <b>"➕ Thêm Mới"</b> hoặc chọn nhanh anh em ở thanh trên nhé!
        </div>
      `;
      return;
    }

    const AVATARS = [
      'linear-gradient(135deg, #0284c7, #0369a1)',
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #f59e0b, #b45309)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #06b6d4, #0e7490)',
      'linear-gradient(135deg, #f97316, #c2410c)'
    ];

    container.innerHTML = list.map(m => {
      const displayName = m.nickname || m.name || 'Thành viên';
      const initial = (displayName.charAt(0) || 'U').toUpperCase();
      let hash = 0;
      for (let i = 0; i < displayName.length; i++) hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
      const bg = AVATARS[Math.abs(hash) % AVATARS.length];
      const isAct = m.status === 'active' && m.is_active !== false;

      return `
        <div class="member-row-card ${isAct ? '' : 'is-inactive'}" id="memCard_${m.id}">
          <div class="member-card-left">
            <div class="member-avatar-orb" style="background:${bg};">
              ${initial}
              <span class="member-status-indicator-dot ${isAct ? 'active' : 'inactive'}"></span>
            </div>
            <div class="member-meta">
              <div class="member-name-row">
                <span>${displayName}</span>
                ${m.fullName && m.fullName !== displayName ? `<span class="full-name">(${m.fullName})</span>` : ''}
              </div>
              <div class="member-sub-info">
                ${m.phone ? `
                  <span class="info-badge-item">
                    📞 ${m.phone}
                    <button type="button" class="copy-mini-btn" onclick="navigator.clipboard.writeText('${m.phone}'); alert('Đã chép SĐT ${m.phone}')" title="Sao chép SĐT">📋</button>
                  </span>
                ` : '<span style="color:#64748b;">Chưa có SĐT</span>'}
                ${m.accountNo ? `
                  <span class="info-badge-item">
                    💳 <b>${m.bankId || 'NH'}:</b> ${m.accountNo}
                    <button type="button" class="copy-mini-btn" onclick="navigator.clipboard.writeText('${m.accountNo}'); alert('Đã chép STK ${m.accountNo}')" title="Sao chép STK">📋</button>
                  </span>
                ` : ''}
                ${m.note ? `<span class="info-badge-item" style="color:#94a3b8; font-style:italic;">🏷️ ${m.note}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="member-card-right">
            <label class="mac-switch" title="${isAct ? 'Đang hoạt động (Bấm để Ẩn an toàn)' : 'Đã ẩn (Bấm để Kích hoạt lại)'}">
              <input type="checkbox" ${isAct ? 'checked' : ''} onchange="toggleMemberStatusFromUI(${m.id})">
              <span class="mac-switch-slider"></span>
            </label>
            <button type="button" class="member-action-icon-btn" onclick="openMemberFormModal(${m.id})" title="Sửa thông tin chi tiết">
              ✏️
            </button>
            <button type="button" class="member-action-icon-btn btn-delete" onclick="deleteMemberFromUI(${m.id})" title="Xóa / Ẩn thành viên">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function quickAddPresetFromUI(name) {
    try {
      const added = await quickAddPreset(name);
      renderMembersManagerUI();
      if (typeof window.showToast === 'function') {
        window.showToast(`👥 Đã cập nhật thành viên "${added.nickname || added.name}" vào phòng!`);
      }
    } catch(err) {
      alert(`Lỗi: ${err.message}`);
    }
  }

  async function toggleMemberStatusFromUI(id) {
    try {
      const updated = await toggleMemberStatus(id);
      renderMembersManagerUI();
      if (typeof window.showToast === 'function') {
        window.showToast(`🔄 Đã chuyển "${updated.nickname || updated.name}" sang ${updated.status === 'active' ? '🟢 Hoạt động' : '⚪ Đã ẩn'}`);
      }
    } catch(err) {
      alert(`Lỗi chuyển trạng thái: ${err.message}`);
    }
  }

  function openMemberFormModal(editId = null) {
    const drawer = document.getElementById('memberFormDrawer');
    if (!drawer) return;
    drawer.style.display = 'block';

    const titleEl = document.getElementById('memberFormDrawerTitle');
    const idEl = document.getElementById('memFormId');
    const nickEl = document.getElementById('memFormNickname');
    const fullEl = document.getElementById('memFormFullName');
    const phoneEl = document.getElementById('memFormPhone');
    const bankEl = document.getElementById('memFormBankId');
    const accEl = document.getElementById('memFormAccountNo');
    const accNameEl = document.getElementById('memFormAccountName');
    const noteEl = document.getElementById('memFormNote');

    if (editId) {
      const m = getMemberById(editId);
      if (!m) return;
      if (titleEl) titleEl.innerText = `✏️ Sửa Thông Tin: ${m.nickname || m.name}`;
      if (idEl) idEl.value = m.id;
      if (nickEl) nickEl.value = m.nickname || m.name || '';
      if (fullEl) fullEl.value = m.fullName || m.name || '';
      if (phoneEl) phoneEl.value = m.phone || '';
      if (bankEl) bankEl.value = m.bankId || 'MB';
      if (accEl) accEl.value = m.accountNo || '';
      if (accNameEl) accNameEl.value = m.accountName || '';
      if (noteEl) noteEl.value = m.note || '';
    } else {
      if (titleEl) titleEl.innerText = '➕ Thêm Thành Viên Mới';
      if (idEl) idEl.value = '';
      if (nickEl) nickEl.value = '';
      if (fullEl) fullEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (bankEl) bankEl.value = 'MB';
      if (accEl) accEl.value = '';
      if (accNameEl) accNameEl.value = '';
      if (noteEl) noteEl.value = '';
    }

    if (nickEl) setTimeout(() => nickEl.focus(), 100);
  }

  function closeMemberFormModal() {
    const drawer = document.getElementById('memberFormDrawer');
    if (drawer) drawer.style.display = 'none';
  }

  async function submitMemberForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('memFormId')?.value;
    const nickname = document.getElementById('memFormNickname')?.value.trim();
    const fullName = document.getElementById('memFormFullName')?.value.trim();
    const phone = document.getElementById('memFormPhone')?.value.trim();
    const bankId = document.getElementById('memFormBankId')?.value || 'MB';
    const accountNo = document.getElementById('memFormAccountNo')?.value.trim();
    const accountName = document.getElementById('memFormAccountName')?.value.trim().toUpperCase();
    const note = document.getElementById('memFormNote')?.value.trim();

    if (!nickname) {
      alert('Vui lòng nhập Tên gọi hoặc Nickname!');
      return;
    }

    try {
      if (id) {
        // Cập nhật
        await updateMember(id, {
          nickname,
          fullName: fullName || nickname,
          name: nickname,
          phone,
          bankId,
          accountNo,
          accountName,
          note
        });
      } else {
        // Thêm mới
        await addMember({
          name: nickname,
          nickname,
          fullName: fullName || nickname,
          phone,
          bankId,
          accountNo,
          accountName,
          note,
          status: 'active',
          is_active: true
        });
      }
      closeMemberFormModal();
      renderMembersManagerUI();
      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Đã lưu thông tin thành viên "${nickname}" thành công!`);
      }
    } catch(err) {
      alert(`Lỗi khi lưu: ${err.message}`);
    }
  }

  async function deleteMemberFromUI(id) {
    const m = getMemberById(id);
    if (!m) return;
    const name = m.nickname || m.name;

    const action = confirm(
      `⚠️ Bạn muốn xử lý thành viên "${name}" như thế nào?\n\n` +
      `- Bấm OK để ẨN AN TOÀN (Active: False - Giữ nguyên toàn bộ lịch sử hóa đơn & công nợ cũ)\n` +
      `- Bấm Cancel nếu không muốn thay đổi.`
    );

    if (action) {
      try {
        await deleteMember(id, { permanent: false });
        renderMembersManagerUI();
        if (typeof window.showToast === 'function') {
          window.showToast(`⚪ Đã ẩn an toàn thành viên "${name}"!`);
        }
      } catch(err) {
        alert(`Lỗi khi xóa: ${err.message}`);
      }
    }
  }

  async function refreshMembersFromCloud() {
    const btn = document.querySelector('.members-refresh-btn');
    if (btn) btn.innerText = '⏳ Đang đồng bộ...';
    try {
      await fetchFromSupabase();
      await flushOfflineQueue();
      renderMembersManagerUI();
      if (typeof window.showToast === 'function') {
        window.showToast('✅ Đã đồng bộ mới nhất với Supabase Cloud!');
      }
    } catch(err) {
      alert(`Lỗi đồng bộ: ${err.message}`);
    } finally {
      if (btn) btn.innerText = '🔄 Đồng bộ';
    }
  }

  // Gắn các hàm UI lên window
  window.openMembersManagerModal = openMembersManagerModal;
  window.closeMembersManagerModal = closeMembersManagerModal;
  window.renderMembersManagerUI = renderMembersManagerUI;
  window.setMembersFilterTab = setMembersFilterTab;
  window.handleMembersSearch = handleMembersSearch;
  window.quickAddPresetFromUI = quickAddPresetFromUI;
  window.toggleMemberStatusFromUI = toggleMemberStatusFromUI;
  window.openMemberFormModal = openMemberFormModal;
  window.closeMemberFormModal = closeMemberFormModal;
  window.submitMemberForm = submitMemberForm;
  window.deleteMemberFromUI = deleteMemberFromUI;
  window.refreshMembersFromCloud = refreshMembersFromCloud;

  // Xuất Public API
  window.memberService = {
    getAllMembers,
    getActiveMembers,
    getMemberById,
    getMemberByName,
    addMember,
    updateMember,
    toggleMemberStatus,
    deleteMember,
    quickAddPreset,
    fetchFromSupabase,
    flushOfflineQueue,
    getPresetList: () => ROOM_PRESET_MEMBERS,
    getLastSyncTime: () => lastSyncTime,
    normalizeMemberList,
    openModal: openMembersManagerModal,
    renderUI: renderMembersManagerUI
  };

  console.log('👥 [MemberService v1.0] Đã khởi tạo dịch vụ Quản lý thành viên Supabase Cloud & Offline Cache.');
})();

