/**
 * ==============================================================================
 * Supabase Database Storage Bridge (db-storage.js) - Version 4.0 (Realtime & Offline-First Queue Sync)
 * 1. Nạp đồng bộ tức thì (Synchronous Boot) - Không race condition.
 * 2. Hàng đợi Offline-First Sync Queue (Tự động lưu khi mất mạng & đẩy khi online).
 * 3. Lắng nghe Realtime Subscriptions thời gian thực (Supabase Realtime Channel & WebSockets).
 * 4. Hỗ trợ chạy trên GitHub Pages, Mobile & Localhost.
 * 5. Bộ tiện ích Sao lưu & Phục hồi Full Database (JSON/SQL).
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
  let currentSyncMode = 'OFFLINE_CACHE'; // 'SUPABASE_REST' | 'OFFLINE_CACHE'
  let saveDebounceTimers = {};
  let isSyncing = false;
  let lastSyncTimestamp = 0;
  let realtimeChannel = null;
  let realtimeSocket = null;
  let isRealtimeConnected = false;

  const OFFLINE_QUEUE_KEY = 'sys_offline_sync_queue';

  // Danh sách các key chỉ lưu cục bộ trên phiên trình duyệt của máy hiện tại, tuyệt đối không đẩy lên Cloud
  // và không cho phép Cloud ghi đè (đặc biệt là trạng thái đăng nhập sys_is_admin)
  const LOCAL_ONLY_KEYS = new Set([
    'sys_is_admin',
    'mac_admin_mode',
    'sys_failed_attempts',
    'sys_raw_master_key'
  ]);

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

  // --------------------------------------------------------------------------
  // 2. KHỞI ĐỘNG ĐỒNG BỘ CHẶN TỨC THÌ (Synchronous Instant Boot)
  // --------------------------------------------------------------------------
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
              if (item && item.key && !LOCAL_ONLY_KEYS.has(item.key)) {
                let valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);

                // BẢO VỆ CHỐNG MẤT DỮ LIỆU CHO sys_global_members
                if (item.key === 'sys_global_members') {
                  try {
                    const localRaw = nativeStorage.getItem.call(localStorage, 'sys_global_members');
                    if (localRaw) {
                      const localList = JSON.parse(localRaw);
                      const cloudList = JSON.parse(valStr);
                      if (Array.isArray(localList) && Array.isArray(cloudList) && localList.length > 0) {
                        const cloudIds = new Set(cloudList.map(c => String(c.id)));
                        const extras = localList.filter(l => l && l.id && !cloudIds.has(String(l.id)));
                        if (extras.length > 0) {
                          const merged = [...cloudList, ...extras];
                          valStr = JSON.stringify(merged);
                        }
                      }
                    }
                  } catch (e) {}
                }

                memoryStore[item.key] = valStr;
                try { nativeStorage.setItem.call(localStorage, item.key, valStr); } catch (e) {}
              }
            });
            isDbConnected = true;
            currentSyncMode = 'SUPABASE_REST';
            lastSyncTimestamp = Date.now();
            console.log(`⚡ [DB-Storage v4.0] Đã nạp tức thì ${rows.length} mục dữ liệu từ Supabase Cloud!`);
          }
        }
      } catch (err) {
        console.warn('[DB-Storage v4.0] Nạp đồng bộ thất bại, chuyển sang chế độ offline cache:', err.message);
      }
    }
  }

  // Khởi động đồng bộ tức thì
  bootSynchronousStore();

  // --------------------------------------------------------------------------
  // 3. HÀNG ĐỢI ĐỒNG BỘ OFFLINE-FIRST (OFFLINE SYNC QUEUE)
  // --------------------------------------------------------------------------
  function getOfflineQueue() {
    try {
      const raw = nativeStorage.getItem.call(localStorage, OFFLINE_QUEUE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveOfflineQueue(queue) {
    try {
      nativeStorage.setItem.call(localStorage, OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      updateQueueBadge(queue.length);
    } catch (e) {}
  }

  function enqueueOfflineMutation(type, key, value) {
    if (LOCAL_ONLY_KEYS.has(key) || key === OFFLINE_QUEUE_KEY) return;
    const queue = getOfflineQueue();
    // Thay thế mutation cũ cho cùng một key để tránh spam
    const existingIndex = queue.findIndex(item => item.key === key);
    const mutation = {
      id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      type, // 'UPSERT' | 'DELETE'
      key,
      value,
      timestamp: Date.now()
    };

    if (existingIndex >= 0) {
      queue[existingIndex] = mutation;
    } else {
      queue.push(mutation);
    }
    saveOfflineQueue(queue);
    console.log(`📦 [Offline Queue] Đã lưu thao tác ${type} cho key "${key}" vào hàng đợi (Tổng: ${queue.length}).`);
  }

  function updateQueueBadge(count) {
    try {
      const badge = document.getElementById('offlineQueueBadge');
      if (badge) {
        if (count > 0) {
          badge.style.display = 'inline-flex';
          badge.textContent = `${count} chờ sync`;
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) {}
  }

  async function flushOfflineSyncQueue() {
    if (!navigator.onLine) return;
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) return;

    console.log(`🚀 [Offline Queue] Đang đẩy ${queue.length} thay đổi offline lên Supabase Cloud...`);
    const remaining = [];
    let syncedCount = 0;

    for (const mut of queue) {
      try {
        if (mut.type === 'DELETE') {
          const res = await fetch(`${url}/rest/v1/system_store?key=eq.${encodeURIComponent(mut.key)}`, {
            method: 'DELETE',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
          });
          if (res.ok || res.status === 404) {
            syncedCount++;
          } else {
            remaining.push(mut);
          }
        } else {
          // UPSERT
          let parsedVal = mut.value;
          try { parsedVal = JSON.parse(mut.value); } catch (e) {}
          const res = await fetch(`${url}/rest/v1/system_store`, {
            method: 'POST',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              key: mut.key,
              value: typeof parsedVal === 'string' ? parsedVal : JSON.stringify(parsedVal),
              updated_at: new Date(mut.timestamp || Date.now()).toISOString()
            })
          });
          if (res.ok) {
            syncedCount++;
          } else {
            remaining.push(mut);
          }
        }
      } catch (err) {
        remaining.push(mut);
      }
    }

    saveOfflineQueue(remaining);

    if (syncedCount > 0) {
      console.log(`✅ [Offline Queue] Đã đồng bộ thành công ${syncedCount} mục lên Supabase Cloud!`);
      if (typeof window.showToast === 'function') {
        window.showToast(`🟢 Đã đồng bộ ${syncedCount} thay đổi offline lên Supabase Cloud!`);
      } else if (typeof window.showMacToast === 'function') {
        window.showMacToast(`🟢 Đã đồng bộ ${syncedCount} thay đổi offline lên Supabase!`, 'success');
      }
    }
  }

  // Tự động đẩy hàng đợi khi có mạng trở lại
  window.addEventListener('online', () => {
    console.log('🌐 [Network] Trình duyệt đã kết nối Internet trở lại!');
    flushOfflineSyncQueue();
    initiateSmartSync();
  });

  // --------------------------------------------------------------------------
  // 4. LẮNG NGHE REALTIME THỜI GIAN THỰC (REALTIME SUBSCRIPTIONS)
  // --------------------------------------------------------------------------
  function initRealtimeSubscription() {
    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) return;

    // 4.1 Nếu có thư viện @supabase/supabase-js trên trang (window.supabase)
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        if (realtimeChannel) {
          try { realtimeChannel.unsubscribe(); } catch (e) {}
        }
        const client = window.supabase.createClient(url, anonKey);
        realtimeChannel = client
          .channel('system_store_realtime_v4')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'system_store' }, (payload) => {
            handleRealtimeEvent(payload);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              isRealtimeConnected = true;
              console.log('⚡ [Realtime] Đã kết nối Supabase Realtime Channel thành công!');
              updateRealtimeUI(true);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              isRealtimeConnected = false;
              updateRealtimeUI(false);
            }
          });
        return;
      } catch (e) {
        console.warn('[Realtime] Lỗi khởi tạo Supabase JS client:', e.message);
      }
    }

    // 4.2 Fallback: Kết nối WebSocket trực tiếp tới Supabase Realtime Gateway
    try {
      if (realtimeSocket && (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const host = url.replace(/^https?:\/\//, '');
      const wsUrl = `wss://${host}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;

      realtimeSocket = new WebSocket(wsUrl);

      let heartbeatTimer = null;
      let refCount = 1;

      realtimeSocket.onopen = () => {
        isRealtimeConnected = true;
        console.log('⚡ [Realtime WS] Đã kết nối Supabase Realtime Gateway thành công!');
        updateRealtimeUI(true);

        // Tham gia kênh public:system_store
        const joinMsg = {
          topic: 'realtime:public:system_store',
          event: 'phx_join',
          payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: 'system_store' }] } },
          ref: String(refCount++)
        };
        realtimeSocket.send(JSON.stringify(joinMsg));

        // Heartbeat mỗi 25s
        heartbeatTimer = setInterval(() => {
          if (realtimeSocket && realtimeSocket.readyState === WebSocket.OPEN) {
            realtimeSocket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(refCount++) }));
          }
        }, 25000);
      };

      realtimeSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.event === 'postgres_changes' && msg.payload && msg.payload.data) {
            handleRealtimeEvent(msg.payload.data);
          }
        } catch (e) {}
      };

      realtimeSocket.onclose = () => {
        isRealtimeConnected = false;
        updateRealtimeUI(false);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // Tự động kết nối lại sau 10s
        setTimeout(() => {
          if (navigator.onLine) initRealtimeSubscription();
        }, 10000);
      };

      realtimeSocket.onerror = () => {
        isRealtimeConnected = false;
      };
    } catch (err) {
      console.warn('[Realtime WS] Không thể mở kết nối WebSocket:', err.message);
    }
  }

  function updateRealtimeUI(connected) {
    try {
      const el = document.getElementById('dbRealtimeStatusDot');
      if (el) {
        el.style.background = connected ? '#22c55e' : '#eab308';
        el.title = connected ? 'Realtime Subscriptions: Đang hoạt động 🟢' : 'Realtime: Đang chờ kết nối 🟡';
      }
    } catch (e) {}
  }

  function handleRealtimeEvent(payload) {
    if (!payload) return;
    const eventType = payload.eventType || payload.type;
    const newRecord = payload.new;
    const oldRecord = payload.old;

    if (eventType === 'DELETE' && oldRecord && oldRecord.key) {
      const k = oldRecord.key;
      if (LOCAL_ONLY_KEYS.has(k)) return;
      const oldVal = memoryStore[k];
      delete memoryStore[k];
      try { nativeStorage.removeItem.call(localStorage, k); } catch (e) {}
      dispatchStorageChange(k, oldVal, null);
      notifyDataChanged();
      console.log(`⚡ [Realtime] Đã xóa key "${k}" từ thiết bị khác.`);
    } else if ((eventType === 'INSERT' || eventType === 'UPDATE') && newRecord && newRecord.key) {
      const k = newRecord.key;
      if (LOCAL_ONLY_KEYS.has(k)) return;
      const valStr = typeof newRecord.value === 'string' ? newRecord.value : JSON.stringify(newRecord.value);
      if (memoryStore[k] !== valStr) {
        const oldVal = memoryStore[k];
        memoryStore[k] = valStr;
        try { nativeStorage.setItem.call(localStorage, k, valStr); } catch (e) {}
        dispatchStorageChange(k, oldVal, valStr);
        notifyDataChanged();
        console.log(`⚡ [Realtime] Đã cập nhật key "${k}" thời gian thực từ thiết bị khác!`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. ĐỒNG BỘ NỀN & BẮT DỮ LIỆU TỪ MÁY KHÁC (Asynchronous Pull)
  // --------------------------------------------------------------------------
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
          if (item && item.key && !LOCAL_ONLY_KEYS.has(item.key)) {
            const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
            if (memoryStore[item.key] !== valStr) {
              const oldVal = memoryStore[item.key];
              memoryStore[item.key] = valStr;
              try { nativeStorage.setItem.call(localStorage, item.key, valStr); } catch (e) {}
              hasChanges = true;
              dispatchStorageChange(item.key, oldVal, valStr);
            }
          }
        });

        isDbConnected = true;
        currentSyncMode = 'SUPABASE_REST';
        lastSyncTimestamp = Date.now();

        if (hasChanges) {
          console.log(`🔄 [DB-Storage] Đã cập nhật ${rows.length} mục dữ liệu từ Supabase Cloud!`);
          notifyDataChanged();
        }
        return true;
      }
    } catch (err) {
      console.warn('[DB-Storage] Lỗi sync nền:', err.message);
    }
    return false;
  }

  // 4.3 Kênh Broadcast đồng bộ thời gian thực toàn hệ thống
  let globalSyncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      globalSyncChannel = new BroadcastChannel('hongcong_tool_sync');
      globalSyncChannel.onmessage = function (ev) {
        if (!ev.data || ev.data.type !== 'STORAGE_KEY_CHANGED') return;
        const { key, oldValue, newValue } = ev.data;
        if (!key) return;

        // Cập nhật memory store nếu có sự khác biệt
        if (memoryStore[key] !== newValue) {
          if (newValue === null || newValue === undefined) {
            delete memoryStore[key];
            try { nativeStorage.removeItem.call(localStorage, key); } catch(e) {}
          } else {
            memoryStore[key] = newValue;
            try { nativeStorage.setItem.call(localStorage, key, newValue); } catch(e) {}
          }
        }

        // Kích hoạt sự kiện storage nội bộ
        try {
          const sEv = new StorageEvent('storage', {
            key: key,
            oldValue: oldValue,
            newValue: newValue,
            url: window.location.href,
            storageArea: localStorage
          });
          window.dispatchEvent(sEv);
        } catch(e) {}

        // Kích hoạt custom event
        try {
          window.dispatchEvent(new CustomEvent('system_storage_changed', { detail: { key, oldValue, newValue } }));
        } catch(e) {}

        // Nếu là trang chính (window.top), chuyển tiếp tới tất cả iframe
        if (window.top === window) {
          document.querySelectorAll('iframe').forEach(ifr => {
            try {
              ifr.contentWindow.postMessage(ev.data, '*');
              if (key === 'sticky_notes_data' || key === 'sys_reminders') ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED' }, '*');
              if (key === 'sys_global_members' || key === 'nhau_members' || key === 'p2p_members') ifr.contentWindow.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
              if (key.startsWith('nhau_')) ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
              if (key.startsWith('p2p_')) ifr.contentWindow.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
              ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
            } catch(e) {}
          });
        }
      };
    }
  } catch(e) {}

  let isDispatchingStorageChange = false;
  function dispatchStorageChange(key, oldVal, newVal) {
    if (isDispatchingStorageChange) return;
    isDispatchingStorageChange = true;
    try {
      const ev = new StorageEvent('storage', {
        key: key,
        oldValue: oldVal,
        newValue: newVal,
        url: window.location.href,
        storageArea: localStorage
      });
      window.dispatchEvent(ev);

      try {
        window.dispatchEvent(new CustomEvent('system_storage_changed', { detail: { key, oldValue: oldVal, newValue: newVal } }));
      } catch (e) {}

      // Phát sóng qua BroadcastChannel cho mọi tab / iframe cùng domain
      if (globalSyncChannel) {
        try {
          globalSyncChannel.postMessage({ type: 'STORAGE_KEY_CHANGED', key, oldValue: oldVal, newValue: newVal });
        } catch (e) {}
      }

      // Nếu đang trong iframe, BẮT BUỘC gửi thông điệp lên window.parent và window.top
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({ type: 'STORAGE_KEY_CHANGED', key, oldValue: oldVal, newValue: newVal }, '*');
          if (key === 'sticky_notes_data' || key === 'sys_reminders') window.parent.postMessage({ type: 'NOTES_UPDATED' }, '*');
          if (key === 'sys_global_members' || key === 'nhau_members' || key === 'p2p_members') window.parent.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
          if (key.startsWith('nhau_')) window.parent.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          if (key.startsWith('p2p_')) window.parent.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
          window.parent.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      }
      if (window.top && window.top !== window && window.top !== window.parent) {
        try {
          window.top.postMessage({ type: 'STORAGE_KEY_CHANGED', key, oldValue: oldVal, newValue: newVal }, '*');
          if (key === 'sticky_notes_data' || key === 'sys_reminders') window.top.postMessage({ type: 'NOTES_UPDATED' }, '*');
          if (key === 'sys_global_members' || key === 'nhau_members' || key === 'p2p_members') window.top.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
          if (key.startsWith('nhau_')) window.top.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          if (key.startsWith('p2p_')) window.top.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
          window.top.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      }

      // Chuyển tiếp sự kiện vào các iframe ứng dụng con
      if (window.frames && window.frames.length > 0) {
        for (let i = 0; i < window.frames.length; i++) {
          try {
            window.frames[i].dispatchEvent(ev);
          } catch (e) {}
        }
      }

      // Thông báo qua postMessage tới tất cả iframe đang chạy
      document.querySelectorAll('iframe').forEach(ifr => {
        try {
          ifr.contentWindow.postMessage({ type: 'STORAGE_KEY_CHANGED', key, oldValue: oldVal, newValue: newVal }, '*');
          if (key === 'sys_global_members' || key === 'nhau_members' || key === 'p2p_members') {
            ifr.contentWindow.postMessage({ type: 'MEMBERS_UPDATED' }, '*');
          }
          if (key.startsWith('nhau_')) {
            ifr.contentWindow.postMessage({ type: 'CHIA_BILL_UPDATED' }, '*');
          }
          if (key.startsWith('p2p_')) {
            ifr.contentWindow.postMessage({ type: 'TIEN_COM_UPDATED' }, '*');
          }
          if (key === 'sticky_notes_data' || key === 'sys_reminders') {
            ifr.contentWindow.postMessage({ type: 'NOTES_UPDATED' }, '*');
          }
          ifr.contentWindow.postMessage({ type: 'APP_DATA_UPDATED' }, '*');
        } catch (e) {}
      });
    } catch (e) {}
    finally {
      isDispatchingStorageChange = false;
    }
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
        if (ok) {
          await flushOfflineSyncQueue();
          if (!isRealtimeConnected) {
            initRealtimeSubscription();
          }
          return;
        }
      }
    } finally {
      isSyncing = false;
    }
  }

  // --------------------------------------------------------------------------
  // 6. ĐỒNG BỘ NỀN LIÊN TỤC (Multi-Device Auto-Sync Polling)
  // --------------------------------------------------------------------------
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (window.top === window) {
      pollTimer = setInterval(() => {
        initiateSmartSync();
      }, 5000);
    }
  }

  startPolling();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      initiateSmartSync();
    }
  });

  window.addEventListener('focus', () => {
    initiateSmartSync();
  });

  // Khởi chạy Realtime sau khi trang nạp xong
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initRealtimeSubscription, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initRealtimeSubscription, 500);
    });
  }

  // --------------------------------------------------------------------------
  // 7. LƯU DỮ LIỆU LÊN SUPABASE (PERSISTENCE & OFFLINE-FALLBACK)
  // --------------------------------------------------------------------------
  function persistKey(key, value) {
    if (LOCAL_ONLY_KEYS.has(key)) {
      try {
        nativeStorage.setItem.call(localStorage, key, value);
      } catch (e) {}
      return;
    }

    if (saveDebounceTimers[key]) {
      clearTimeout(saveDebounceTimers[key]);
      delete saveDebounceTimers[key];
    }

    const isCritical = [
      'sys_admin_pass_hash', 'sys_master_key_hash', 'sys_recovery_email',
      'p2p_admin_pass_hash', 'supabase_anon_key', 'sys_global_members',
      'nhau_meals', 'p2p_logs', 'p2p_members', 'nhau_members'
    ].includes(key);

    const executeSave = async () => {
      // 1. Luôn ghi vào nativeStorage làm cache an toàn
      try {
        nativeStorage.setItem.call(localStorage, key, value);
      } catch (e) {}

      // 2. Nếu đang offline, lưu ngay vào Offline Queue
      if (!navigator.onLine) {
        enqueueOfflineMutation('UPSERT', key, value);
        return;
      }

      // 3. Ghi lên Supabase REST API
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

          if (!res.ok) {
            console.warn('[DB-Storage] Ghi Supabase thất bại HTTP ' + res.status + ', lưu vào hàng đợi offline.');
            enqueueOfflineMutation('UPSERT', key, value);
          }
        } catch (err) {
          console.warn('[DB-Storage] Lỗi mạng khi ghi Supabase, lưu vào hàng đợi offline:', err.message);
          enqueueOfflineMutation('UPSERT', key, value);
        }
      }
    };

    if (isCritical) {
      executeSave();
    } else {
      saveDebounceTimers[key] = setTimeout(executeSave, 40);
    }
  }

  function deleteKeyFromServer(key) {
    if (LOCAL_ONLY_KEYS.has(key)) {
      try { nativeStorage.removeItem.call(localStorage, key); } catch (e) {}
      return;
    }

    try { nativeStorage.removeItem.call(localStorage, key); } catch (e) {}

    if (!navigator.onLine) {
      enqueueOfflineMutation('DELETE', key, null);
      return;
    }

    const { url, anonKey } = getSupabaseConfig();
    if (anonKey) {
      fetch(`${url}/rest/v1/system_store?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
      }).catch((err) => {
        enqueueOfflineMutation('DELETE', key, null);
      });
    }
  }

  // --------------------------------------------------------------------------
  // 8. GHI ĐÈ Storage.prototype
  // --------------------------------------------------------------------------
  Storage.prototype.getItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      if (LOCAL_ONLY_KEYS.has(k)) {
        return nativeStorage.getItem.call(this, k);
      }
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

      try { nativeStorage.setItem.call(localStorage, k, strVal); } catch (e) {}

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
      try { nativeStorage.removeItem.call(localStorage, k); } catch (e) {}
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

  // --------------------------------------------------------------------------
  // 9. PUBLIC API & ADMIN DATABASE DASHBOARD UTILITIES
  // --------------------------------------------------------------------------
  window.dbStorage = {
    set: (k, v) => localStorage.setItem(k, v),
    setItem: (k, v) => localStorage.setItem(k, v),
    get: (k) => localStorage.getItem(k),
    getItem: (k) => localStorage.getItem(k),
    removeItem: (k) => localStorage.removeItem(k),
    isConnected: () => isDbConnected,
    isRealtimeConnected: () => isRealtimeConnected,
    getSyncMode: () => currentSyncMode,
    getSupabaseConfig,
    setCachedValue: function (key, value) {
      const k = String(key);
      const strVal = String(value);
      const oldVal = memoryStore[k];
      memoryStore[k] = strVal;
      try { nativeStorage.setItem.call(localStorage, k, strVal); } catch (e) {}
      dispatchStorageChange(k, oldVal, strVal);
    },
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
      const ok = await initiateSmartSync();
      initRealtimeSubscription();
      return ok;
    },
    syncNow: initiateSmartSync,
    getOfflineQueue,
    flushOfflineQueue: flushOfflineSyncQueue,
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
    },
    // Tiện ích Sao Lưu Toàn Diện (Full Database Export)
    exportFullDatabase: function () {
      const dump = {
        metadata: {
          system: 'Hong Cong Tech Tool Hub - Database Backup',
          version: '4.0',
          exported_at: new Date().toISOString(),
          total_keys: 0
        },
        tables: {
          members: [],
          bills: [],
          meal_logs: [],
          notes: [],
          contacts: [],
          system_store: []
        },
        raw_store: {}
      };

      try {
        // 1. Members
        const mems = localStorage.getItem('sys_global_members');
        if (mems) dump.tables.members = JSON.parse(mems);

        // 2. Bills
        const meals = localStorage.getItem('nhau_meals');
        if (meals) dump.tables.bills = JSON.parse(meals);

        // 3. Meal Logs
        const logs = localStorage.getItem('p2p_logs');
        if (logs) dump.tables.meal_logs = JSON.parse(logs);

        // 4. Notes
        const notes = localStorage.getItem('sticky_notes_data');
        if (notes) dump.tables.notes = JSON.parse(notes);

        // 5. Contacts
        const contacts = localStorage.getItem('p2p_all_contacts') || localStorage.getItem('sys_contacts') || localStorage.getItem('sys_global_members');
        if (contacts) dump.tables.contacts = JSON.parse(contacts);

        // 6. Toàn bộ Raw Key-Value trong memoryStore
        for (const k of Object.keys(memoryStore)) {
          if (!LOCAL_ONLY_KEYS.has(k)) {
            dump.raw_store[k] = memoryStore[k];
            dump.tables.system_store.push({ key: k, value: memoryStore[k] });
          }
        }
        dump.metadata.total_keys = Object.keys(dump.raw_store).length;
      } catch (e) {
        console.error('[DB-Storage] Lỗi export full DB:', e);
      }
      return dump;
    },
    // Tiện ích Khôi Phục Toàn Diện (Full Database Import)
    importFullDatabase: async function (backupObj, mode = 'merge') {
      if (!backupObj || typeof backupObj !== 'object') {
        throw new Error('Dữ liệu sao lưu không hợp lệ!');
      }

      const raw = backupObj.raw_store || {};
      const tables = backupObj.tables || {};
      let restoredCount = 0;

      // Nếu có tables cấu trúc chuẩn
      if (tables.members && Array.isArray(tables.members)) {
        localStorage.setItem('sys_global_members', JSON.stringify(tables.members));
        restoredCount++;
      }
      if (tables.nhau_members && Array.isArray(tables.nhau_members)) {
        localStorage.setItem('nhau_members', JSON.stringify(tables.nhau_members));
        restoredCount++;
      }
      if (tables.p2p_members && Array.isArray(tables.p2p_members)) {
        localStorage.setItem('p2p_members', JSON.stringify(tables.p2p_members));
        restoredCount++;
      }
      if (tables.bills && Array.isArray(tables.bills)) {
        localStorage.setItem('nhau_meals', JSON.stringify(tables.bills));
        restoredCount++;
      }
      if (tables.meal_logs && Array.isArray(tables.meal_logs)) {
        localStorage.setItem('p2p_logs', JSON.stringify(tables.meal_logs));
        restoredCount++;
      }
      if (tables.notes && Array.isArray(tables.notes)) {
        localStorage.setItem('sticky_notes_data', JSON.stringify(tables.notes));
        restoredCount++;
      }

      // Khôi phục tất cả raw keys
      for (const [k, v] of Object.entries(raw)) {
        if (!LOCAL_ONLY_KEYS.has(k)) {
          const strVal = typeof v === 'string' ? v : JSON.stringify(v);
          localStorage.setItem(k, strVal);
          restoredCount++;
        }
      }

      // Đẩy tức thì lên Supabase Cloud
      await initiateSmartSync();
      notifyDataChanged();
      return { success: true, count: restoredCount };
    }
  };

  console.log('⚡ [DB-Storage v4.0] Sẵn sàng: Realtime Subscriptions + Offline-First Queue Sync.');
})();
