/**
 * ==============================================================================
 * Supabase Database Storage Bridge (db-storage.js)
 * Completely eliminates browser localStorage and connects all data directly
 * to Supabase PostgreSQL on the server.
 * ==============================================================================
 */

(function () {
  'use strict';

  // 1. Connect to parent store if in iframe to share memory instantly
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
  let saveDebounceTimers = {};

  // Store original browser Storage methods
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key
  };

  // Determine API base URL
  function getApiBase() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }

  const API_BASE = getApiBase();

  // 2. Synchronous Initial Load to ensure zero race conditions before app logic runs
  function loadDatabaseSync() {
    // If we inherited cache from parent window, no need to re-fetch synchronously
    if (sharedStore && Object.keys(sharedStore).length > 0) {
      isDbConnected = true;
      return;
    }

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', API_BASE + '/api/storage', false); // synchronous for boot (MUST NOT set xhr.timeout)
      xhr.send(null);

      if (xhr.status >= 200 && xhr.status < 300) {
        const res = JSON.parse(xhr.responseText);
        if (res.success && res.data) {
          for (const [k, v] of Object.entries(res.data)) {
            memoryStore[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
          isDbConnected = true;
          console.log('[DB-Storage] Successfully loaded', Object.keys(res.data).length, 'keys from Supabase PostgreSQL.');
        }
      }
    } catch (err) {
      console.warn('[DB-Storage] Could not connect to DB server synchronously:', err.message);
    }

    // One-time migration: If memoryStore is empty but user had legacy browser localStorage,
    // migrate legacy data up to Supabase PostgreSQL, then wipe local storage!
    try {
      let legacyCount = 0;
      const legacyData = {};
      const keysToMigrate = [
        'mac_dashboard_apps_v3', 'mac_dashboard_apps_v2', 'mac_dashboard_wallpaper',
        'sys_admin_pass_hash', 'sys_master_key_hash', 'sys_recovery_email', 'sys_is_admin',
        'nhau_members', 'nhau_meals', 'nhau_money_logs',
        'p2p_members', 'p2p_logs', 'p2p_meal_presets', 'p2p_bank_info', 'sys_bank_config',
        'sticky_notes_data', 'lai_suat_data'
      ];

      for (let i = 0; i < localStorage.length; i++) {
        const k = nativeStorage.key.call(localStorage, i);
        if (k && !memoryStore[k]) {
          const val = nativeStorage.getItem.call(localStorage, k);
          if (val !== null) {
            legacyData[k] = val;
            memoryStore[k] = val;
            legacyCount++;
          }
        }
      }

      if (legacyCount > 0) {
        console.log(`[DB-Storage] Migrating ${legacyCount} legacy localStorage keys to Supabase PostgreSQL...`);
        fetch(API_BASE + '/api/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: legacyData })
        }).then(r => r.json()).then(res => {
          console.log('[DB-Storage] Migration to Supabase completed successfully!', res);
          // WIPE physical browser localStorage to enforce "bỏ lưu trữ trên local storge"
          nativeStorage.clear.call(localStorage);
          console.log('[DB-Storage] Browser localStorage cleared permanently.');
        }).catch(err => {
          console.error('[DB-Storage] Migration sync failed:', err);
        });
      } else {
        // Clear browser localStorage to ensure no data lingers on local browser storage
        nativeStorage.clear.call(localStorage);
      }
    } catch (e) {
      // Ignored
    }
  }

  loadDatabaseSync();

  // 3. Save to Supabase PostgreSQL (Immediate for critical keys, debounced for frequent typing)
  function persistToServer(key, value) {
    if (saveDebounceTimers[key]) {
      clearTimeout(saveDebounceTimers[key]);
      delete saveDebounceTimers[key];
    }

    const isCriticalKey = [
      'sys_admin_pass_hash', 'sys_master_key_hash', 'sys_recovery_email',
      'sys_is_admin', 'p2p_admin_pass_hash', 'sys_failed_attempts'
    ].includes(key);

    const executeSave = () => {
      let parsedVal = value;
      try {
        parsedVal = JSON.parse(value);
      } catch (e) {
        parsedVal = value;
      }

      fetch(API_BASE + '/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: parsedVal })
      })
      .then(r => r.json())
      .then(res => {
        if (!res.success) {
          console.error('[DB-Storage] Server save error for key:', key, res.error);
        } else {
          console.log('[DB-Storage] Persisted to PostgreSQL:', key);
        }
      })
      .catch(err => {
        console.warn('[DB-Storage] Failed to persist key', key, 'to database server:', err.message);
      });
    };

    if (isCriticalKey) {
      executeSave();
    } else {
      saveDebounceTimers[key] = setTimeout(executeSave, 50);
    }
  }

  function deleteFromServer(key) {
    fetch(API_BASE + '/api/storage/' + encodeURIComponent(key), {
      method: 'DELETE'
    }).catch(err => {
      console.warn('[DB-Storage] Failed to delete key from server:', err.message);
    });
  }

  function clearAllOnServer() {
    fetch(API_BASE + '/api/storage/clear', {
      method: 'POST'
    }).catch(err => {
      console.warn('[DB-Storage] Failed to clear storage on server:', err.message);
    });
  }

  // 4. OVERRIDE Storage.prototype to intercept ALL localStorage calls
  Storage.prototype.getItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      return memoryStore.hasOwnProperty(k) ? memoryStore[k] : null;
    }
    return nativeStorage.getItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) {
      const k = String(key);
      const strVal = String(value);
      const oldVal = memoryStore[k];
      memoryStore[k] = strVal;

      // DO NOT save to native browser storage - keep browser localStorage empty!
      // nativeStorage.setItem is bypassed.

      // Persist to Supabase PostgreSQL database
      persistToServer(k, strVal);

      // Trigger standard storage event for window/tabs
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
      deleteFromServer(k);
      return;
    }
    return nativeStorage.removeItem.call(this, key);
  };

  Storage.prototype.clear = function () {
    if (this === localStorage) {
      for (const k of Object.keys(memoryStore)) {
        delete memoryStore[k];
      }
      clearAllOnServer();
      nativeStorage.clear.call(localStorage);
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
      return 0;
    },
    configurable: true
  });

  // 5. Expose dedicated API: window.dbStorage
  window.dbStorage = {
    isConnected: () => isDbConnected,
    apiBase: API_BASE,
    getAll: () => ({ ...memoryStore }),
    getItem: (k) => memoryStore[k] || null,
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
    clear: () => localStorage.clear(),
    refresh: async () => {
      try {
        const r = await fetch(API_BASE + '/api/storage');
        const res = await r.json();
        if (res.success && res.data) {
          for (const [k, v] of Object.entries(res.data)) {
            memoryStore[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
          isDbConnected = true;
          return true;
        }
      } catch (e) {
        return false;
      }
      return false;
    }
  };

  console.log('⚡ [DB-Storage] Activated. Browser localStorage is bypassed. Source of truth: Supabase PostgreSQL.');
})();
