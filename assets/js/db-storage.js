/**
 * ==============================================================================
 * Supabase Database Storage Bridge (db-storage.js)
 * Đồng bộ hai chiều với Supabase PostgreSQL:
 * 1. Chạy trực tiếp trên GitHub Pages / Mobile qua Supabase Cloud REST API
 * 2. Hỗ trợ chạy nội bộ qua Node.js Server (localhost:3000)
 * 3. Tự động lưu cache an toàn (Offline Fallback) - KHÔNG BAO GIỜ mất dữ liệu
 * ==============================================================================
 */

(function () {
  'use strict';

  // 1. Chia sẻ vùng nhớ giữa Tab chính và các Tab/Iframe con
  let sharedStore = null;
  try {
    if (window.top && window.top !== window && window.top.__DB_SYSTEM_STORE__) {
      sharedStore = window.top.__DB_SYSTEM_STORE__;
    }
  } catch (e) {
    // Cross-origin fallback
  }

  const memoryStore = sharedStore || (window.__DB_SYSTEM_STORE__ = {});
  let isDbConnected = false;
  let currentSyncMode = 'OFFLINE_CACHE'; // 'SUPABASE_REST' | 'NODE_SERVER' | 'OFFLINE_CACHE'
  let saveDebounceTimers = {};
  let isSyncing = false;

  // Lưu trữ các hàm nguyên bản của trình duyệt (Native Storage)
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key
  };

  // Cấu hình Supabase mặc định
  const DEFAULT_SUPABASE_URL = 'https://wqzwxzwrozbpetbwbgrk.supabase.co';

  function getSupabaseConfig() {
    let url = DEFAULT_SUPABASE_URL;
    let anonKey = '';

    if (window.__SUPABASE_CONFIG__) {
      if (window.__SUPABASE_CONFIG__.url) url = window.__SUPABASE_CONFIG__.url.trim();
      if (window.__SUPABASE_CONFIG__.anonKey) anonKey = window.__SUPABASE_CONFIG__.anonKey.trim();
    }

    try {
      const storedUrl = nativeStorage.getItem.call(localStorage, 'supabase_url');
      if (storedUrl && storedUrl.trim()) url = storedUrl.trim();

      const storedKey = nativeStorage.getItem.call(localStorage, 'supabase_anon_key');
      if (storedKey && storedKey.trim()) anonKey = storedKey.trim();
    } catch (e) {}

    // Chuẩn hóa URL (bỏ dấu gạch chéo cuối nếu có)
    if (url.endsWith('/')) url = url.slice(0, -1);

    return { url, anonKey };
  }

  // Xác định Node.js Server Base URL nếu chạy trên máy tính cá nhân
  function getNodeApiBase() {
    try {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
      }
      if (window.location.protocol === 'file:') {
        return 'http://localhost:3000';
      }
    } catch (e) {}
    return null;
  }

  // 2. KHỞI ĐỘNG ĐỒNG THỜI (Instant Synchronous Boot):
  // Nạp toàn bộ dữ liệu từ localStorage vào memoryStore ngay tức khắc
  // để ứng dụng hiển thị tức thì, không bị nháy trắng màn hình.
  function bootInstantCache() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = nativeStorage.key.call(localStorage, i);
        if (k && !memoryStore.hasOwnProperty(k)) {
          const val = nativeStorage.getItem.call(localStorage, k);
          if (val !== null) memoryStore[k] = val;
        }
      }
    } catch (e) {
      console.warn('[DB-Storage] Không thể đọc cache ban đầu:', e);
    }
  }

  bootInstantCache();

  // 3. ĐỒNG BỘ CLOUD VỚI SUPABASE REST API
  async function syncFromSupabaseRest(url, key) {
    if (!url || !key) return false;
    try {
      const endpoint = `${url}/rest/v1/system_store?select=key,value`;
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.warn(`[DB-Storage] Supabase REST phản hồi mã: ${res.status}`);
        return false;
      }

      const rows = await res.json();
      if (Array.isArray(rows)) {
        rows.forEach(item => {
          if (item && item.key) {
            const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
            memoryStore[item.key] = valStr;
            // Lưu đệm an toàn vào native localStorage
            try {
              nativeStorage.setItem.call(localStorage, item.key, valStr);
            } catch (e) {}
          }
        });

        isDbConnected = true;
        currentSyncMode = 'SUPABASE_REST';
        console.log(`✅ [DB-Storage] Đã đồng bộ thành công ${rows.length} mục từ Supabase Cloud REST!`);
        notifyDataChanged();
        return true;
      }
    } catch (err) {
      console.warn('[DB-Storage] Lỗi khi kết nối Supabase REST:', err.message);
    }
    return false;
  }

  // 4. ĐỒNG BỘ VỚI NODE.JS SERVER (Nếu chạy localhost)
  async function syncFromNodeServer(apiBase) {
    if (!apiBase) return false;
    try {
      const res = await fetch(`${apiBase}/api/storage`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          for (const [k, v] of Object.entries(json.data)) {
            const valStr = typeof v === 'string' ? v : JSON.stringify(v);
            memoryStore[k] = valStr;
            try {
              nativeStorage.setItem.call(localStorage, k, valStr);
            } catch (e) {}
          }
          isDbConnected = true;
          currentSyncMode = 'NODE_SERVER';
          console.log(`✅ [DB-Storage] Đã đồng bộ thành công từ Node.js Server (${apiBase})!`);
          notifyDataChanged();
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // Kích hoạt đồng bộ thông minh theo thứ tự ưu tiên
  async function initiateSmartSync() {
    if (isSyncing) return;
    isSyncing = true;

    try {
      const { url, anonKey } = getSupabaseConfig();

      // Ưu tiên 1: Kết nối trực tiếp Supabase Cloud REST nếu có Anon Key
      if (anonKey) {
        const ok = await syncFromSupabaseRest(url, anonKey);
        if (ok) return;
      }

      // Ưu tiên 2: Kết nối Node.js Server nếu đang ở localhost
      const nodeBase = getNodeApiBase();
      if (nodeBase) {
        const okNode = await syncFromNodeServer(nodeBase);
        if (okNode) return;
      }

      // Ưu tiên 3: Chạy Offline Cache (Giữ nguyên dữ liệu hiện có trong localStorage)
      isDbConnected = false;
      currentSyncMode = 'OFFLINE_CACHE';
      if (!anonKey && (window.location.hostname.endsWith('github.io') || window.location.protocol === 'https:')) {
        console.info('💡 [DB-Storage] Đang mở trên GitHub Pages. Hãy nhập mã Supabase `anon` key trong menu Cài đặt để đồng bộ đám mây trực tiếp!');
      }
    } finally {
      isSyncing = false;
    }
  }

  // Thông báo các thành phần UI cập nhật khi có dữ liệu mới từ Cloud
  function notifyDataChanged() {
    try {
      const ev = new CustomEvent('db-storage-ready', { detail: { syncMode: currentSyncMode } });
      window.dispatchEvent(ev);
    } catch (e) {}
  }

  // Tự động đồng bộ ngay sau khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initiateSmartSync);
  } else {
    setTimeout(initiateSmartSync, 10);
  }

  // 5. GHI DỮ LIỆU LÊN DATABASE (PERSISTENCE)
  function persistKey(key, value) {
    if (saveDebounceTimers[key]) {
      clearTimeout(saveDebounceTimers[key]);
      delete saveDebounceTimers[key];
    }

    const isCritical = [
      'sys_admin_pass_hash', 'sys_master_key_hash', 'sys_recovery_email',
      'sys_is_admin', 'p2p_admin_pass_hash', 'supabase_anon_key'
    ].includes(key);

    const executeSave = async () => {
      // 1. Luôn lưu vào native storage làm cache an toàn
      try {
        nativeStorage.setItem.call(localStorage, key, value);
      } catch (e) {}

      // 2. Ghi lên Supabase REST API nếu có key
      const { url, anonKey } = getSupabaseConfig();
      if (anonKey) {
        try {
          let parsedVal = value;
          try { parsedVal = JSON.parse(value); } catch (e) {}

          const res = await fetch(`${url}/rest/v1/system_store`, {
            method: 'POST',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              key: key,
              value: typeof parsedVal === 'string' ? parsedVal : JSON.stringify(parsedVal),
              updated_at: new Date().toISOString()
            })
          });

          if (res.ok) {
            isDbConnected = true;
            currentSyncMode = 'SUPABASE_REST';
            return;
          }
        } catch (err) {
          console.warn('[DB-Storage] Không thể ghi Supabase REST:', err.message);
        }
      }

      // 3. Ghi lên Node.js Server nếu đang kết nối local
      const nodeBase = getNodeApiBase();
      if (nodeBase) {
        try {
          let parsedVal = value;
          try { parsedVal = JSON.parse(value); } catch (e) {}

          await fetch(`${nodeBase}/api/storage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: parsedVal })
          });
        } catch (e) {}
      }
    };

    if (isCritical) {
      executeSave();
    } else {
      saveDebounceTimers[key] = setTimeout(executeSave, 60);
    }
  }

  function deleteKeyFromServer(key) {
    try {
      nativeStorage.removeItem.call(localStorage, key);
    } catch (e) {}

    const { url, anonKey } = getSupabaseConfig();
    if (anonKey) {
      fetch(`${url}/rest/v1/system_store?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`
        }
      }).catch(() => {});
    }

    const nodeBase = getNodeApiBase();
    if (nodeBase) {
      fetch(`${nodeBase}/api/storage/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  }

  // 6. GHI ĐÈ CÁC HÀM CỦA TRÌNH DUYỆT (Storage.prototype Interceptor)
  Storage.prototype.getItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      if (memoryStore.hasOwnProperty(k)) return memoryStore[k];
      return nativeStorage.getItem.call(this, k);
    }
    return nativeStorage.getItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) {
      const k = String(key);
      const strVal = String(value);
      const oldVal = memoryStore[k];
      memoryStore[k] = strVal;

      // Lưu đồng thời vào cache và database
      persistKey(k, strVal);

      // Kích hoạt StorageEvent chuẩn
      try {
        const ev = new StorageEvent('storage', {
          key: k,
          oldValue: oldVal,
          newValue: strVal,
          url: window.location.href,
          storageArea: localStorage
        });
        window.dispatchEvent(ev);
      } catch (e) {}

      return;
    }
    return nativeStorage.setItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      delete memoryStore[k];
      deleteKeyFromServer(k);
      return;
    }
    return nativeStorage.removeItem.call(this, key);
  };

  Storage.prototype.clear = function () {
    if (this === localStorage) {
      // Bảo toàn khóa cấu hình Supabase khi bấm xóa dữ liệu ứng dụng
      const savedKey = memoryStore['supabase_anon_key'] || nativeStorage.getItem.call(localStorage, 'supabase_anon_key');
      const savedUrl = memoryStore['supabase_url'] || nativeStorage.getItem.call(localStorage, 'supabase_url');

      for (const k of Object.keys(memoryStore)) {
        if (k !== 'supabase_anon_key' && k !== 'supabase_url') {
          delete memoryStore[k];
          deleteKeyFromServer(k);
        }
      }

      nativeStorage.clear.call(localStorage);
      if (savedKey) nativeStorage.setItem.call(localStorage, 'supabase_anon_key', savedKey);
      if (savedUrl) nativeStorage.setItem.call(localStorage, 'supabase_url', savedUrl);
      return;
    }
    return nativeStorage.clear.call(this);
  };

  Storage.prototype.key = function (index) {
    if (this === localStorage) {
      const keys = Object.keys(memoryStore);
      return keys[index] || null;
    }
    return nativeStorage.key.call(this, index);
  };

  Object.defineProperty(Storage.prototype, 'length', {
    get: function () {
      if (this === localStorage) {
        return Object.keys(memoryStore).length;
      }
      return nativeStorage.key.call(this, 0) !== null ? 1 : 0;
    },
    configurable: true
  });

  // 7. BỘ API CHUYÊN DỤNG (window.dbStorage)
  window.dbStorage = {
    isConnected: () => isDbConnected,
    getSyncMode: () => currentSyncMode,
    getSupabaseConfig,
    setSupabaseAnonKey: async function (newKey) {
      const trimmed = (newKey || '').trim();
      try {
        if (trimmed) {
          nativeStorage.setItem.call(localStorage, 'supabase_anon_key', trimmed);
          memoryStore['supabase_anon_key'] = trimmed;
        } else {
          nativeStorage.removeItem.call(localStorage, 'supabase_anon_key');
          delete memoryStore['supabase_anon_key'];
        }
      } catch (e) {}

      // Đồng bộ lại ngay
      return await initiateSmartSync();
    },
    syncNow: initiateSmartSync,
    testSupabaseConnection: async function (url, key) {
      const targetUrl = (url || DEFAULT_SUPABASE_URL).trim().replace(/\/$/, '');
      const targetKey = (key || '').trim();

      if (!targetKey) {
        return { success: false, error: 'Chưa nhập mã Supabase `anon` public key.' };
      }

      try {
        const endpoint = `${targetUrl}/rest/v1/system_store?select=key&limit=5`;
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'apikey': targetKey,
            'Authorization': `Bearer ${targetKey}`
          }
        });

        if (res.ok) {
          const rows = await res.json();
          return { success: true, count: rows.length, message: `Kết nối thành công! Tìm thấy bảng dữ liệu.` };
        } else {
          const errText = await res.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch (e) {}
          return {
            success: false,
            status: res.status,
            error: (errJson && (errJson.message || errJson.hint || errJson.error)) || `Lỗi HTTP ${res.status}: ${errText}`
          };
        }
      } catch (err) {
        return { success: false, error: `Lỗi kết nối mạng: ${err.message}` };
      }
    }
  };

  console.log('⚡ [DB-Storage v2.0] Đã kích hoạt cơ chế đồng bộ lai: Supabase Cloud REST / Node.js Server / Safe Local Cache.');
})();
