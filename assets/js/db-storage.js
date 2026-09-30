/**
 * ==============================================================================
 * Supabase Database Storage Bridge (db-storage.js) - Version 3.0 (Multi-Device Live Sync)
 * 1. Nạp đồng bộ tức thì (Synchronous Boot) - Không có độ trễ, không có race condition.
 * 2. Đồng bộ thời gian thực đa thiết bị (Multi-Device Auto-Sync & Polling).
 * 3. Hỗ trợ chạy trên GitHub Pages, Mobile & Localhost.
 * 4. Cache an toàn hai chiều (Offline Cache Fallback).
 * ==============================================================================
 */

(function () {
  'use strict';

  // 1. Chia sẻ vùng nhớ giữa Tab chính (window.top) và các Iframe ứng dụng con
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
  let lastSyncTimestamp = 0;

  // Lưu trữ các hàm native của trình duyệt
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key
  };

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

    if (url.endsWith('/')) url = url.slice(0, -1);
    return { url, anonKey };
  }

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

  // 2. KHỞI ĐỘNG ĐỒNG BỘ CHẶN TỨC THÌ (Synchronous Instant Boot):
  // Nạp dữ liệu từ Supabase Cloud vào memoryStore NGAY LẬP TỨC trước khi các file script khác chạy
  function bootSynchronousStore() {
    // 2.1 Đọc cache sẵn có từ trình duyệt trước tiên
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = nativeStorage.key.call(localStorage, i);
        if (k && !memoryStore.hasOwnProperty(k)) {
          const val = nativeStorage.getItem.call(localStorage, k);
          if (val !== null) memoryStore[k] = val;
        }
      }
    } catch (e) {}

    // 2.2 Nếu là iframe và window.top đã có sẵn dữ liệu thì tái sử dụng tức thì
    if (sharedStore && Object.keys(sharedStore).length > 2) {
      isDbConnected = true;
      currentSyncMode = 'SUPABASE_REST';
      return;
    }

    // 2.3 NẠP TRỰC TIẾP TỪ SUPABASE CLOUD (Đồng bộ qua Simple GET Request với ?apikey=...)
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey) {
      try {
        const syncUrl = `${url}/rest/v1/system_store?select=key,value&apikey=${encodeURIComponent(anonKey)}`;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', syncUrl, false); // synchronous GET
        xhr.send(null);

        if (xhr.status >= 200 && xhr.status < 300) {
          const rows = JSON.parse(xhr.responseText);
          if (Array.isArray(rows)) {
            rows.forEach(item => {
              if (item && item.key) {
                const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
                memoryStore[item.key] = valStr;
                try { nativeStorage.setItem.call(localStorage, item.key, valStr); } catch (e) {}
              }
            });
            isDbConnected = true;
            currentSyncMode = 'SUPABASE_REST';
            lastSyncTimestamp = Date.now();
            console.log(`⚡ [DB-Storage] Đã nạp tức thì ${rows.length} mục dữ liệu từ Supabase Cloud!`);
          }
        }
      } catch (err) {
        console.warn('[DB-Storage] Nạp đồng bộ thất bại, chuyển sang chế độ nền:', err.message);
      }
    } else {
      // Nếu chạy localhost nội bộ không có anonKey
      const nodeBase = getNodeApiBase();
      if (nodeBase) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', `${nodeBase}/api/storage`, false);
          xhr.send(null);
          if (xhr.status >= 200 && xhr.status < 300) {
            const res = JSON.parse(xhr.responseText);
            if (res.success && res.data) {
              for (const [k, v] of Object.entries(res.data)) {
                const valStr = typeof v === 'string' ? v : JSON.stringify(v);
                memoryStore[k] = valStr;
                try { nativeStorage.setItem.call(localStorage, k, valStr); } catch (e) {}
              }
              isDbConnected = true;
              currentSyncMode = 'NODE_SERVER';
              lastSyncTimestamp = Date.now();
            }
          }
        } catch (e) {}
      }
    }
  }

  // Chạy ngay khi file JS được nạp
  bootSynchronousStore();

  // 3. ĐỒNG BỘ NỀN & BẮT DỮ LIỆU TỪ MÁY KHÁC (Asynchronous Pull)
  async function syncFromSupabaseRest(url, key) {
    if (!url || !key) return false;
    try {
      const endpoint = `${url}/rest/v1/system_store?select=key,value,updated_at&apikey=${encodeURIComponent(key)}`;
      const res = await fetch(endpoint, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) return false;

      const rows = await res.json();
      let hasChanges = false;
      if (Array.isArray(rows)) {
        rows.forEach(item => {
          if (item && item.key) {
            const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
            if (memoryStore[item.key] !== valStr) {
              const oldVal = memoryStore[item.key];
              memoryStore[item.key] = valStr;
              try { nativeStorage.setItem.call(localStorage, item.key, valStr); } catch (e) {}
              hasChanges = true;

              // Phát sự kiện StorageEvent để giao diện các ứng dụng cập nhật ngay
              dispatchStorageChange(item.key, oldVal, valStr);
            }
          }
        });

        isDbConnected = true;
        currentSyncMode = 'SUPABASE_REST';
        lastSyncTimestamp = Date.now();

        if (hasChanges) {
          console.log(`🔄 [DB-Storage] Đã cập nhật ${rows.length} mục dữ liệu từ máy khác!`);
          notifyDataChanged();
        }
        return true;
      }
    } catch (err) {
      console.warn('[DB-Storage] Lỗi sync nền:', err.message);
    }
    return false;
  }

  function dispatchStorageChange(key, oldVal, newVal) {
    try {
      const ev = new StorageEvent('storage', {
        key: key,
        oldValue: oldVal,
        newValue: newVal,
        url: window.location.href,
        storageArea: localStorage
      });
      window.dispatchEvent(ev);

      // Nếu có iframes con, chuyển tiếp sự kiện vào các iframe
      if (window.frames && window.frames.length > 0) {
        for (let i = 0; i < window.frames.length; i++) {
          try {
            window.frames[i].dispatchEvent(ev);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function notifyDataChanged() {
    try {
      const ev = new CustomEvent('db-storage-ready', { detail: { syncMode: currentSyncMode } });
      window.dispatchEvent(ev);

      if (window.frames && window.frames.length > 0) {
        for (let i = 0; i < window.frames.length; i++) {
          try {
            window.frames[i].dispatchEvent(ev);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  async function initiateSmartSync() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const { url, anonKey } = getSupabaseConfig();
      if (anonKey) {
        const ok = await syncFromSupabaseRest(url, anonKey);
        if (ok) return;
      }

      const nodeBase = getNodeApiBase();
      if (nodeBase) {
        try {
          const res = await fetch(`${nodeBase}/api/storage`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
              for (const [k, v] of Object.entries(json.data)) {
                const valStr = typeof v === 'string' ? v : JSON.stringify(v);
                memoryStore[k] = valStr;
                try { nativeStorage.setItem.call(localStorage, k, valStr); } catch (e) {}
              }
              isDbConnected = true;
              currentSyncMode = 'NODE_SERVER';
              notifyDataChanged();
              return;
            }
          }
        } catch (e) {}
      }
    } finally {
      isSyncing = false;
    }
  }

  // 4. ĐỒNG BỘ NỀN LIÊN TỤC (Multi-Device Auto-Sync Polling)
  // Kiểm tra dữ liệu mới từ các máy khác mỗi 5 giây
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    // Chỉ kích hoạt ở cửa sổ chính (window.top) để tránh trùng lặp
    if (window.top === window) {
      pollTimer = setInterval(() => {
        initiateSmartSync();
      }, 5000);
    }
  }

  startPolling();

  // Tự động kiểm tra ngay khi người dùng chuyển lại tab (Focus / VisibilityChange)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      initiateSmartSync();
    }
  });

  window.addEventListener('focus', () => {
    initiateSmartSync();
  });

  // 5. LƯU DỮ LIỆU LÊN SUPABASE (PERSISTENCE)
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
      // Luôn ghi vào nativeStorage làm cache an toàn
      try {
        nativeStorage.setItem.call(localStorage, key, value);
      } catch (e) {}

      // Ghi lên Supabase REST API
      const { url, anonKey } = getSupabaseConfig();
      if (anonKey) {
        try {
          let parsedVal = value;
          try { parsedVal = JSON.parse(value); } catch (e) {}

          await fetch(`${url}/rest/v1/system_store`, {
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
        } catch (err) {
          console.warn('[DB-Storage] Không thể ghi Supabase Cloud:', err.message);
        }
      }

      // Ghi lên Node.js Server nếu local
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
      saveDebounceTimers[key] = setTimeout(executeSave, 40);
    }
  }

  function deleteKeyFromServer(key) {
    try { nativeStorage.removeItem.call(localStorage, key); } catch (e) {}

    const { url, anonKey } = getSupabaseConfig();
    if (anonKey) {
      fetch(`${url}/rest/v1/system_store?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
      }).catch(() => {});
    }

    const nodeBase = getNodeApiBase();
    if (nodeBase) {
      fetch(`${nodeBase}/api/storage/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // 6. GHI ĐÈ Storage.prototype
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

      persistKey(k, strVal);
      dispatchStorageChange(k, oldVal, strVal);
      return;
    }
    return nativeStorage.setItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      const oldVal = memoryStore[k];
      delete memoryStore[k];
      deleteKeyFromServer(k);
      dispatchStorageChange(k, oldVal, null);
      return;
    }
    return nativeStorage.removeItem.call(this, key);
  };

  Storage.prototype.clear = function () {
    if (this === localStorage) {
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
      notifyDataChanged();
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

  // 7. PUBLIC API
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
      return await initiateSmartSync();
    },
    syncNow: initiateSmartSync,
    testSupabaseConnection: async function (url, key) {
      const targetUrl = (url || DEFAULT_SUPABASE_URL).trim().replace(/\/$/, '');
      const targetKey = (key || '').trim();
      if (!targetKey) return { success: false, error: 'Chưa nhập mã `anon` key.' };

      try {
        const endpoint = `${targetUrl}/rest/v1/system_store?select=key&limit=5&apikey=${encodeURIComponent(targetKey)}`;
        const res = await fetch(endpoint);
        if (res.ok) {
          const rows = await res.json();
          return { success: true, count: rows.length, message: `Kết nối thành công! Đã kết nối Supabase Cloud.` };
        } else {
          return { success: false, error: `Lỗi kết nối HTTP ${res.status}` };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  };

  console.log('⚡ [DB-Storage v3.0] Kích hoạt nạp đồng bộ tức thì & Auto-Sync đa thiết bị.');
})();
