/**
 * ==============================================================================
 * macOS Web Dashboard - Master Controller
 * Features: Centralized System Admin (SHA-256 + Master Key), Spotlight Search,
 * Battery API, Calendar, Wallpapers, Full Backup/Restore, and Window Management
 * ==============================================================================
 */

(function () {
  'use strict';

  // 1. CONFIGURATION & CONSTANTS
  const STORAGE_KEY = 'mac_dashboard_apps_v3';
  const LEGACY_STORAGE_KEY_V2 = 'mac_dashboard_apps_v2';
  const WALLPAPER_STORAGE_KEY = 'mac_dashboard_wallpaper';

  // System-wide Admin Security Keys
  const SYS_ADMIN_HASH_KEY = 'sys_admin_pass_hash';
  const SYS_MASTER_KEY_HASH_KEY = 'sys_master_key_hash';
  const SYS_RECOVERY_EMAIL_KEY = 'sys_recovery_email';
  const SYS_IS_ADMIN_KEY = 'sys_is_admin';
  const SYS_FAILED_KEY = 'sys_failed_attempts';

  const DEFAULT_WALLPAPERS = [
    { id: 'sonoma', name: 'macOS Sonoma', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop' },
    { id: 'sequoia', name: 'macOS Sequoia Forest', url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?q=80&w=2564&auto=format&fit=crop' },
    { id: 'ventura', name: 'Ventura Abstract', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop' },
    { id: 'cyberpunk', name: 'Neon Cyberpunk', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?q=80&w=2564&auto=format&fit=crop' },
    { id: 'minimal-mountains', name: 'Misty Mountains', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2564&auto=format&fit=crop' },
    { id: 'dark-ocean', name: 'Deep Blue Ocean', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?q=80&w=2564&auto=format&fit=crop' }
  ];

  const DEFAULT_APPS = [
    { id: '1', title: 'Chia Bill', icon: '🍻', url: 'apps/chia-bill/index.html', adminOnly: false },
    { id: '2', title: 'Tính Tiền Cơm', icon: '🍚', url: 'apps/tien-com/index.html', adminOnly: false },
    { id: '3', title: 'Lãi Suất', icon: '💵', url: 'apps/lai-suat/index.html', adminOnly: false },
    { id: '4', title: 'Ghi Chú', icon: '📝', url: 'apps/ghi-chu/index.html', adminOnly: false },
    { id: '5', title: 'Danh Bạ', icon: '👥', url: 'apps/danh-ba/index.html', adminOnly: false },
    { id: 'control-panel', title: 'Cài Đặt', icon: '⚙️', url: 'apps/control-panel/index.html', adminOnly: true }
  ];

  const LEGACY_URL_MAPPINGS = {
    'chiabill.html': 'apps/chia-bill/index.html',
    'ChiaBill.html': 'apps/chia-bill/index.html',
    'tiencom.html': 'apps/tien-com/index.html',
    'tiencom 2.html': 'apps/tien-com/index.html',
    'laisuat.html': 'apps/lai-suat/index.html',
    'laiSuat.html': 'apps/lai-suat/index.html',
    'note.html': 'apps/ghi-chu/index.html'
  };

  // State
  let appsList = [];
  let isEditMode = false;
  let sortableInstance = null;
  let activeApp = null;
  let spotlightSelectedIndex = 0;
  let spotlightFilteredItems = [];

  // Window Manager State
  let openWindows = {}; // map of appId -> { id, app, el, iframe, isMinimized, isMaximized, rect }
  let activeWindowId = null;
  let highestZIndex = 500;
  let cascadeOffset = 0;
  const WORKSPACE_SESSION_KEY = 'mac_dashboard_active_workspace_v1';
  let isRestoringSession = false;

  // Admin State
  let isAdmin = localStorage.getItem(SYS_IS_ADMIN_KEY) === 'true';
  let failedAttempts = parseInt(localStorage.getItem(SYS_FAILED_KEY) || '0');
  const authChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('system_admin_auth') : null;
  let uploadedRescueKeyData = null;

  // DOM Getters
  const DOM = {
    get appGrid() { return document.getElementById('app-grid'); },
    get windowsContainer() { return document.getElementById('windows-container'); },
    get mainWorkspace() { return document.getElementById('windows-container'); },
    get clock() { return document.getElementById('mac-clock'); },
    get battery() { return document.getElementById('mac-battery'); },
    get appleMenu() { return document.getElementById('apple-menu'); },
    get calendarPopover() { return document.getElementById('calendar-popover'); },
    get spotlightOverlay() { return document.getElementById('spotlight-overlay'); },
    get spotlightInput() { return document.getElementById('spotlight-input'); },
    get spotlightResults() { return document.getElementById('spotlight-results'); },
    get wallpapersModal() { return document.getElementById('wallpapers-modal'); },
    get aboutModal() { return document.getElementById('about-modal'); },
    get appModal() { return document.getElementById('app-modal'); },
    get appIdInput() { return document.getElementById('app-id-input'); },
    get appNameInput() { return document.getElementById('app-name-input'); },
    get appIconInput() { return document.getElementById('app-icon-input'); },
    get appUrlInput() { return document.getElementById('app-url-input'); },
    get appAdminOnlySelect() { return document.getElementById('app-admin-only-select'); },
    get modalAddTitle() { return document.getElementById('modal-add-title'); },
    get btnSaveApp() { return document.getElementById('btn-save-app'); },
    get editToggle() { return document.getElementById('edit-toggle'); },
    get dockApps() { return document.getElementById('dock-apps'); },
    get fileRestoreInput() { return document.getElementById('file-restore-input'); },
    get adminBadgeText() { return document.getElementById('adminBadgeText'); },
    get adminSetupModal() { return document.getElementById('adminSetupModal'); },
    get adminAuthModal() { return document.getElementById('adminAuthModal'); },
    get adminAuthInput() { return document.getElementById('adminAuthInput'); },
    get adminChangePassModal() { return document.getElementById('adminChangePassModal'); },
    get adminChangeMasterKeyModal() { return document.getElementById('adminChangeMasterKeyModal'); },
    get masterKeyModal() { return document.getElementById('masterKeyModal'); },
    get forgotPasswordModal() { return document.getElementById('forgotPasswordModal'); },
    get appContextMenu() { return document.getElementById('app-context-menu'); },
    get contextBackdrop() { return document.getElementById('context-backdrop'); },
    get macToast() { return document.getElementById('mac-toast'); },
    get toastIcon() { return document.getElementById('toast-icon'); },
    get toastMsg() { return document.getElementById('toast-msg'); },
    get toastBtn() { return document.getElementById('toast-btn'); },
    get appInfoModal() { return document.getElementById('app-info-modal'); },
    get infoAppIcon() { return document.getElementById('infoAppIcon'); },
    get infoAppTitle() { return document.getElementById('infoAppTitle'); },
    get infoAppBadge() { return document.getElementById('infoAppBadge'); },
    get infoAppUrl() { return document.getElementById('infoAppUrl'); },
    get infoAppId() { return document.getElementById('infoAppId'); },
    get infoAppStatus() { return document.getElementById('infoAppStatus'); },
    get infoAppPermission() { return document.getElementById('infoAppPermission'); },
    get infoBtnOpenApp() { return document.getElementById('infoBtnOpenApp'); },
    get macDesktop() { return document.querySelector('.mac-desktop'); }
  };

  // --------------------------------------------------------------------------
  // 2. CENTRALIZED SYSTEM-WIDE ADMIN AUTHENTICATION (SHA-256 + MASTER KEY)
  // --------------------------------------------------------------------------
  const CRYPTO_SALT_PEPPER = 'ANTIGRAVITY_SECURE_SALT_VAULT_v3_99482';

  async function hashPassword(text) {
    if (!text) return '';
    const encoder = new TextEncoder();
    const data1 = encoder.encode(text + ':' + CRYPTO_SALT_PEPPER);
    const buf1 = await crypto.subtle.digest('SHA-256', data1);

    const combined = new Uint8Array(CRYPTO_SALT_PEPPER.length + buf1.byteLength);
    combined.set(encoder.encode(CRYPTO_SALT_PEPPER), 0);
    combined.set(new Uint8Array(buf1), CRYPTO_SALT_PEPPER.length);
    const buf2 = await crypto.subtle.digest('SHA-256', combined);

    return Array.from(new Uint8Array(buf2)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPassword(inputPass, storedHash) {
    if (!inputPass || !storedHash) return false;
    const saltedHash = await hashPassword(inputPass);
    if (saltedHash === storedHash) return true;

    try {
      const encoder = new TextEncoder();
      const legacyBuf = await crypto.subtle.digest('SHA-256', encoder.encode(inputPass));
      const legacyHash = Array.from(new Uint8Array(legacyBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (legacyHash === storedHash) {
        try {
          localStorage.setItem(SYS_ADMIN_HASH_KEY, saltedHash);
          localStorage.setItem('sys_admin_password_hash', saltedHash);
          localStorage.setItem('p2p_admin_pass_hash', saltedHash);
        } catch (e) {}
        return true;
      }
    } catch (e) {}
    return false;
  }

  function hasAdminConfigured() {
    return true;
  }

  function updateAdminUI() {
    if (isAdmin) {
      document.body.classList.add('is-admin');
      if (DOM.adminBadgeText) {
        DOM.adminBadgeText.innerText = '🔑 Admin Mode';
      }
    } else {
      document.body.classList.remove('is-admin');
      document.body.classList.remove('admin-edit-mode-active');
      if (DOM.adminBadgeText) {
        DOM.adminBadgeText.innerText = '👁️ Chế độ xem';
      }
      if (isEditMode) {
        toggleEditMode(false);
      }
      const adminEditToggle = document.getElementById('admin-edit-toggle');
      if (adminEditToggle) adminEditToggle.checked = false;
      broadcastAdminEditModeToWindows(false);
    }

    // Đồng bộ lên Dynamic Island Quick Hub trên giao diện iPhone
    const diAdminIcon = document.getElementById('diAdminIcon');
    const diAdminVal = document.getElementById('diAdminVal');
    if (diAdminIcon) diAdminIcon.innerText = isAdmin ? '🛡️' : '👁️';
    if (diAdminVal) diAdminVal.innerText = isAdmin ? 'Admin Mode' : 'Chế độ xem';
  }


  function setAdminMode(enable) {
    isAdmin = enable;
    localStorage.setItem(SYS_IS_ADMIN_KEY, enable ? 'true' : 'false');
    updateAdminUI();

    // Broadcast change to other tabs and sub-apps
    if (authChannel) {
      authChannel.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin: enable });
    }
    broadcastAdminToWindows(enable);
  }

  function broadcastAdminToWindows(enable) {
    Object.values(openWindows).forEach(win => {
      if (win && win.iframe && win.iframe.contentWindow) {
        try {
          win.iframe.contentWindow.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin: enable }, '*');
        } catch (e) {}
      }
    });
  }

  function broadcastAdminEditModeToWindows(enable) {
    Object.values(openWindows).forEach(win => {
      if (win && win.iframe && win.iframe.contentWindow) {
        try {
          win.iframe.contentWindow.postMessage({ type: 'ADMIN_EDIT_MODE_CHANGED', adminEditMode: enable }, '*');
        } catch (e) {}
      }
    });
  }

  function toggleAdminEditMode(enable) {
    if (enable && !isAdmin) {
      // Không cho bật khi chưa đăng nhập Admin
      const adminEditToggle = document.getElementById('admin-edit-toggle');
      if (adminEditToggle) adminEditToggle.checked = false;
      openAdminAuthModal();
      return;
    }

    if (enable) {
      document.body.classList.add('admin-edit-mode-active');
    } else {
      document.body.classList.remove('admin-edit-mode-active');
    }

    // Gửi tín hiệu tới tất cả các sub-app đang mở
    broadcastAdminEditModeToWindows(enable);

    // Cũng broadcast qua BroadcastChannel
    if (authChannel) {
      try { authChannel.postMessage({ type: 'ADMIN_EDIT_MODE_CHANGED', adminEditMode: enable }); } catch(e) {}
    }
  }

  function handleAdminBadgeClick() {
    closeAllMenus();
    if (!hasAdminConfigured()) {
      openAdminSetupModal();
      return;
    }
    if (isAdmin) {
      showMacAlert(
        '🛡️ Quản Trị Hệ Thống (Admin)',
        `Bạn hiện đang đăng nhập ở <b>Chế độ Quản trị viên</b>.<br>Vui lòng chọn tác vụ quản trị mong muốn bên dưới:<br><br>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="btn-action" style="background:#0284c7; width:100%; padding:10px 14px; border-radius:10px; font-weight:700; text-align:left; cursor:pointer;" onclick="closeMacAlert(); openChangeAdminPassModal();">
            🔑 Đổi Mật Khẩu Admin
          </button>
          <button type="button" class="btn-action" style="background:rgba(255,255,255,0.08); width:100%; padding:10px 14px; border-radius:10px; font-weight:700; text-align:left; color:#38bdf8; cursor:pointer;" onclick="closeMacAlert(); openChangeMasterKeyModal();">
            🛡️ Đổi Master Key Cứu Hộ
          </button>
          <button type="button" class="btn-action" style="background:rgba(255,255,255,0.08); width:100%; padding:10px 14px; border-radius:10px; font-weight:700; text-align:left; color:#10b981; cursor:pointer;" onclick="closeMacAlert(); downloadRescueFileKey();">
            📥 Tải File Key Cứu Hộ (.json)
          </button>
          <button type="button" class="btn-action" style="background:rgba(239,68,68,0.18); border:1px solid rgba(239,68,68,0.4); width:100%; padding:10px 14px; border-radius:10px; font-weight:700; text-align:left; color:#f87171; cursor:pointer;" onclick="closeMacAlert(); logoutAdmin();">
            🔒 Đăng Xuất Khỏi Admin
          </button>
        </div>`,
        'info'
      );
    } else {
      openAdminAuthModal();
    }
  }

  function openAdminSetupModal() {
    closeAllMenus();
    if (DOM.adminAuthModal) DOM.adminAuthModal.classList.remove('active');
    if (DOM.adminSetupModal) {
      DOM.adminSetupModal.classList.add('active');
      const pass = document.getElementById('setupAdminPass');
      const conf = document.getElementById('setupConfirmPass');
      const mk = document.getElementById('setupMasterKey');
      const confMk = document.getElementById('setupConfirmMasterKey');
      const recEmail = document.getElementById('setupRecoveryEmail');
      if (pass) pass.value = '';
      if (conf) conf.value = '';
      if (mk) mk.value = '';
      if (confMk) confMk.value = '';
      setTimeout(() => pass && pass.focus(), 100);
    }
  }

  function closeAdminSetupModal() {
    if (DOM.adminSetupModal) DOM.adminSetupModal.classList.remove('active');
  }

  async function submitAdminSetup() {
    const adminPass = (document.getElementById('setupAdminPass')?.value || '').trim();
    const confirmPass = (document.getElementById('setupConfirmPass')?.value || '').trim();
    const masterKey = (document.getElementById('setupMasterKey')?.value || '').trim();
    const confirmMasterKey = (document.getElementById('setupConfirmMasterKey')?.value || '').trim();

    if (!adminPass) {
      showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập Mật khẩu Admin bạn muốn đặt!', 'warning');
      return;
    }
    if (adminPass !== confirmPass) {
      showMacAlert('Mật Khẩu Không Khớp', 'Mật khẩu Admin xác nhận không khớp!', 'error');
      return;
    }

    if (!masterKey) {
      showMacAlert('Chưa Nhập Master Key', 'Vui lòng nhập Mã Master Key cứu hộ!', 'warning');
      return;
    }
    if (masterKey !== confirmMasterKey) {
      showMacAlert('Master Key Không Khớp', 'Xác nhận Master Key cứu hộ không khớp!', 'error');
      return;
    }

    const hashedPass = await hashPassword(adminPass);
    const hashedMaster = await hashPassword(masterKey);

    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedPass);
    localStorage.setItem('sys_admin_password_hash', hashedPass);
    localStorage.setItem('p2p_admin_pass_hash', hashedPass);
    localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, hashedMaster);
    localStorage.setItem(SYS_FAILED_KEY, '0');
    failedAttempts = 0;

    // Xóa email cũ nếu có
    localStorage.removeItem(SYS_RECOVERY_EMAIL_KEY);

    // Đồng bộ lên Supabase qua dbStorage
    try {
      if (window.dbStorage) {
        window.dbStorage.setItem(SYS_ADMIN_HASH_KEY, hashedPass);
        window.dbStorage.setItem('sys_admin_password_hash', hashedPass);
        window.dbStorage.setItem('p2p_admin_pass_hash', hashedPass);
        window.dbStorage.setItem(SYS_MASTER_KEY_HASH_KEY, hashedMaster);
      }
    } catch (e) {}

    // Tự động xuất File Key cứu hộ cho Admin
    downloadRescueFileKey(masterKey);

    setAdminMode(true);
    closeAdminSetupModal();
    showMacAlert('🎉 Thiết Lập Thành Công', 'Mật khẩu Admin và Master Key đã được kích hoạt! File Key cứu hộ (.json) đã được tải xuống máy của bạn.', 'success', () => {
      window.location.reload();
    });
  }

  function resetSecurityToNull() {
    closeAllMenus();
    quickResetAdminPassword();
  }

  function openAdminAuthModal() {
    closeAllMenus();
    if (!DOM.adminAuthModal) return;
    DOM.adminAuthModal.classList.add('active');
    if (DOM.adminAuthInput) {
      DOM.adminAuthInput.value = '';
      setTimeout(() => DOM.adminAuthInput.focus(), 100);
    }
  }

  function closeAdminAuthModal() {
    if (DOM.adminAuthModal) DOM.adminAuthModal.classList.remove('active');
  }

  async function submitAdminAuth() {
    const passInput = (DOM.adminAuthInput ? DOM.adminAuthInput.value : '').trim();
    if (!passInput) {
      showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập mật khẩu Admin.', 'warning');
      return;
    }

    const storedHash = localStorage.getItem(SYS_ADMIN_HASH_KEY) || localStorage.getItem('sys_admin_password_hash') || localStorage.getItem('p2p_admin_pass_hash');
    const isMatched = await verifyPassword(passInput, storedHash);
    const isMasterMatched = !isMatched && await verifyMasterKey(passInput);

    if (isMatched || isMasterMatched) {
      failedAttempts = 0;
      localStorage.setItem(SYS_FAILED_KEY, '0');
      setAdminMode(true);
      closeAdminAuthModal();
      window.location.reload();
    } else {
      failedAttempts++;
      showMacAlert(
        'Mật Khẩu Không Đúng',
        `Mật khẩu Admin vừa nhập không chính xác.<br><br>
         Nếu bạn quên mật khẩu, hãy bấm vào <b>Quên mật khẩu? Dùng Master Key hoặc File Key</b> để đặt lại mật khẩu mới.`,
        'warning'
      );
      if (DOM.adminAuthInput) {
        DOM.adminAuthInput.value = '';
        DOM.adminAuthInput.focus();
      }
    }
  }

  function logoutAdmin() {
    setAdminMode(false);
    closeAllMenus();
    window.location.reload();
  }

  function openChangeAdminPassModal() {
    closeAllMenus();
    const modal = document.getElementById('adminChangePassModal');
    if (modal) {
      modal.classList.add('active');
      const p0 = document.getElementById('currentAdminPass');
      const n1 = document.getElementById('newAdminPass');
      const n2 = document.getElementById('confirmAdminPass');
      if (p0) p0.value = '';
      if (n1) n1.value = '';
      if (n2) n2.value = '';
      setTimeout(() => (p0 || n1)?.focus(), 150);
    }
  }

  function closeChangeAdminPassModal() {
    const modal = document.getElementById('adminChangePassModal');
    if (modal) modal.classList.remove('active');
  }

  async function verifyMasterKey(inputKey) {
    if (!inputKey) return false;
    const storedMaster = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY);
    if (!storedMaster) return false;

    // 1. Kiểm tra salted hash
    const saltedHash = await hashPassword(inputKey);
    if (saltedHash === storedMaster) return true;

    // 2. Kiểm tra plain SHA-256 hash chuẩn (tương thích Master Key cũ như '0' trong database)
    try {
      const encoder = new TextEncoder();
      const legacyBuf = await crypto.subtle.digest('SHA-256', encoder.encode(inputKey));
      const legacyHash = Array.from(new Uint8Array(legacyBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (legacyHash === storedMaster) {
        // Tự động nâng cấp lên salted hash an toàn hơn
        localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, saltedHash);
        if (window.dbStorage) window.dbStorage.setItem(SYS_MASTER_KEY_HASH_KEY, saltedHash);
        return true;
      }
    } catch (e) {}

    // 3. Khớp trực tiếp nếu chưa mã hóa
    if (inputKey === storedMaster) return true;

    return false;
  }

  async function submitChangeAdminPass() {
    const currentPass = (document.getElementById('currentAdminPass')?.value || '').trim();
    const newPass = (document.getElementById('newAdminPass')?.value || '').trim();
    const confirmPass = (document.getElementById('confirmAdminPass')?.value || '').trim();

    if (!newPass) {
      showMacAlert('Chưa Nhập Mật Khẩu Mới', 'Vui lòng nhập mật khẩu Admin mới!', 'warning');
      return;
    }
    if (newPass !== confirmPass) {
      showMacAlert('Mật Khẩu Không Khớp', 'Xác nhận mật khẩu mới không trùng khớp!', 'error');
      return;
    }

    const storedAdminHash = localStorage.getItem(SYS_ADMIN_HASH_KEY) || localStorage.getItem('sys_admin_password_hash');
    if (storedAdminHash) {
      const isPassCorrect = await verifyPassword(currentPass, storedAdminHash);
      const isMasterCorrect = await verifyMasterKey(currentPass);
      if (!isPassCorrect && !isMasterCorrect) {
        showMacAlert('Xác Thực Thất Bại', 'Mật khẩu hiện tại hoặc Master Key vừa nhập không đúng. Vui lòng thử lại!', 'error');
        return;
      }
    }

    const hashedNew = await hashPassword(newPass);
    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
    localStorage.setItem('p2p_admin_pass_hash', hashedNew);
    localStorage.setItem('sys_admin_password_hash', hashedNew);
    localStorage.setItem(SYS_FAILED_KEY, '0');
    failedAttempts = 0;

    // Đồng bộ lên Supabase & local cache
    try {
      if (window.dbStorage) {
        window.dbStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
        window.dbStorage.setItem('sys_admin_password_hash', hashedNew);
        window.dbStorage.setItem('p2p_admin_pass_hash', hashedNew);
      }
    } catch(e) {}

    setAdminMode(true);
    closeChangeAdminPassModal();
    showMacAlert('🎉 Đổi Mật Khẩu Thành Công', 'Mật khẩu Admin đã được cập nhật thành công và đồng bộ toàn hệ thống!', 'success');
    showMacToast('Đã đổi mật khẩu Admin thành công', 'success');
  }

  function openChangeMasterKeyModal() {
    closeAllMenus();
    const modal = document.getElementById('adminChangeMasterKeyModal');
    if (modal) {
      modal.classList.add('active');
      const p1 = document.getElementById('currentAdminPassForMK');
      const m1 = document.getElementById('newMasterKey');
      const m2 = document.getElementById('confirmNewMasterKey');
      if (p1) p1.value = '';
      if (m1) m1.value = '';
      if (m2) m2.value = '';
      setTimeout(() => (p1 || m1)?.focus(), 150);
    }
  }

  function closeChangeMasterKeyModal() {
    const modal = document.getElementById('adminChangeMasterKeyModal');
    if (modal) modal.classList.remove('active');
  }

  async function submitChangeMasterKey() {
    const currentPass = (document.getElementById('currentAdminPassForMK')?.value || '').trim();
    const newMK = (document.getElementById('newMasterKey')?.value || '').trim();
    const confirmMK = (document.getElementById('confirmNewMasterKey')?.value || '').trim();

    if (!newMK) {
      showMacAlert('Chưa Nhập Master Key', 'Vui lòng nhập Master Key mới bạn muốn đặt!', 'warning');
      return;
    }
    if (newMK !== confirmMK) {
      showMacAlert('Xác Nhận Không Khớp', 'Xác nhận Master Key mới không trùng khớp!', 'error');
      return;
    }

    const storedAdmin = localStorage.getItem(SYS_ADMIN_HASH_KEY) || localStorage.getItem('sys_admin_password_hash');
    if (storedAdmin) {
      const isPassCorrect = await verifyPassword(currentPass, storedAdmin);
      const isMasterCorrect = await verifyMasterKey(currentPass);
      if (!isPassCorrect && !isMasterCorrect) {
        showMacAlert('Xác Thực Thất Bại', 'Mật khẩu Admin hiện tại hoặc Master Key cũ không chính xác!', 'error');
        return;
      }
    }

    const hashedNewMK = await hashPassword(newMK);
    localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, hashedNewMK);

    try {
      if (window.dbStorage) {
        window.dbStorage.setItem(SYS_MASTER_KEY_HASH_KEY, hashedNewMK);
      }
    } catch(e) {}

    closeChangeMasterKeyModal();
    showMacAlert('🎉 Đổi Master Key Thành Công', 'Master Key cứu hộ mới đã được cập nhật thành công! Hệ thống đang tự động tải File Key về máy của bạn.', 'success');
    downloadRescueFileKey(newMK);
  }


  // --------------------------------------------------------------------------
  // 2.1 MACOS SYSTEM ALERT DIALOG & TOAST (ĐỒNG BỘ GIAO DIỆN HỆ THỐNG)
  // --------------------------------------------------------------------------
  let macAlertCallback = null;

  function showMacAlert(title, message, iconType = 'info', onOk = null, onCancel = null) {
    const modal = document.getElementById('macSystemAlertModal');
    if (!modal) {
      if (typeof onOk === 'function') onOk();
      return;
    }

    const titleEl = document.getElementById('macAlertTitle');
    const msgEl = document.getElementById('macAlertMessage');
    const iconEl = document.getElementById('macAlertIcon');
    const iconWrap = document.getElementById('macAlertIconWrap');
    const cancelBtn = document.getElementById('macAlertCancelBtn');
    const okBtn = document.getElementById('macAlertOkBtn');

    if (titleEl) titleEl.innerText = title || 'Thông Báo Hệ Thống';
    if (msgEl) msgEl.innerHTML = message || '';

    if (iconEl && iconWrap) {
      if (iconType === 'success') {
        iconEl.innerHTML = '✅';
        iconWrap.style.background = 'rgba(34, 197, 94, 0.18)';
        iconWrap.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        iconWrap.style.color = '#4ade80';
      } else if (iconType === 'error') {
        iconEl.innerHTML = '❌';
        iconWrap.style.background = 'rgba(239, 68, 68, 0.18)';
        iconWrap.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        iconWrap.style.color = '#f87171';
      } else if (iconType === 'warning') {
        iconEl.innerHTML = '⚠️';
        iconWrap.style.background = 'rgba(245, 158, 11, 0.18)';
        iconWrap.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        iconWrap.style.color = '#fbbf24';
      } else if (iconType === 'email') {
        iconEl.innerHTML = '✉️';
        iconWrap.style.background = 'rgba(2, 132, 199, 0.18)';
        iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        iconWrap.style.color = '#38bdf8';
      } else {
        iconEl.innerHTML = '🛡️';
        iconWrap.style.background = 'rgba(2, 132, 199, 0.18)';
        iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        iconWrap.style.color = '#38bdf8';
      }
    }

    if (cancelBtn) {
      cancelBtn.style.display = onCancel ? 'inline-block' : 'none';
    }

    macAlertCallback = { onOk, onCancel };
    modal.classList.add('active');
  }

  function closeMacAlert(confirmed = true) {
    const modal = document.getElementById('macSystemAlertModal');
    if (modal) modal.classList.remove('active');

    if (macAlertCallback) {
      if (confirmed && typeof macAlertCallback.onOk === 'function') {
        macAlertCallback.onOk();
      } else if (!confirmed && typeof macAlertCallback.onCancel === 'function') {
        macAlertCallback.onCancel();
      }
      macAlertCallback = null;
    }
  }

  let toastTimeout = null;
  function showMacToast(message, type = 'info', duration = 4000) {
    const toast = DOM.macToast;
    const msgEl = DOM.toastMsg;
    const iconEl = DOM.toastIcon;
    if (!toast || !msgEl) return;

    if (toastTimeout) clearTimeout(toastTimeout);

    msgEl.innerHTML = message;
    if (iconEl) {
      if (type === 'success') iconEl.innerText = '✅';
      else if (type === 'error') iconEl.innerText = '❌';
      else if (type === 'warning') iconEl.innerText = '⚠️';
      else iconEl.innerText = 'ℹ️';
    }

    toast.style.display = 'flex';
    requestAnimationFrame(() => toast.classList.add('show'));

    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.style.display = 'none', 300);
    }, duration);
  }

  window.showMacAlert = showMacAlert;
  window.closeMacAlert = closeMacAlert;
  window.showMacToast = showMacToast;

  // --------------------------------------------------------------------------
  // 2.2 RECOVERY & PASSWORD MANAGEMENT (MASTER KEY & RESCUE FILE KEY)
  // --------------------------------------------------------------------------
  function switchRecoveryTab(tab) {
    const btnMaster = document.getElementById('tabBtnMaster');
    const btnFile = document.getElementById('tabBtnFile');
    const secMaster = document.getElementById('tabMasterSection');
    const secFile = document.getElementById('tabFileSection');

    if (tab === 'file') {
      if (btnFile) {
        btnFile.style.background = '#0284c7';
        btnFile.style.color = '#fff';
      }
      if (btnMaster) {
        btnMaster.style.background = 'rgba(255,255,255,0.08)';
        btnMaster.style.color = '#cbd5e1';
      }
      if (secMaster) secMaster.style.display = 'none';
      if (secFile) secFile.style.display = 'block';
    } else {
      if (btnMaster) {
        btnMaster.style.background = '#0284c7';
        btnMaster.style.color = '#fff';
      }
      if (btnFile) {
        btnFile.style.background = 'rgba(255,255,255,0.08)';
        btnFile.style.color = '#cbd5e1';
      }
      if (secMaster) secMaster.style.display = 'block';
      if (secFile) secFile.style.display = 'none';
      setTimeout(() => document.getElementById('recoveryMasterKeyInput')?.focus(), 100);
    }
  }

  function openForgotPasswordModal() {
    closeAllMenus();
    if (DOM.adminAuthModal) DOM.adminAuthModal.classList.remove('active');
    if (DOM.forgotPasswordModal) {
      DOM.forgotPasswordModal.classList.add('active');
      const mkInp = document.getElementById('recoveryMasterKeyInput');
      const n1 = document.getElementById('recoveryNewPass1');
      const c1 = document.getElementById('recoveryConfirmPass1');
      const n2 = document.getElementById('recoveryNewPass2');
      const c2 = document.getElementById('recoveryConfirmPass2');
      const statusEl = document.getElementById('rescueFileStatus');
      const newSec = document.getElementById('recoveryNewPassSection');
      const fileInp = document.getElementById('recoveryKeyFileInput');

      if (mkInp) mkInp.value = '';
      if (n1) n1.value = '';
      if (c1) c1.value = '';
      if (n2) n2.value = '';
      if (c2) c2.value = '';
      if (fileInp) fileInp.value = '';
      if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.innerHTML = '';
      }
      if (newSec) newSec.style.display = 'none';
      uploadedRescueKeyData = null;

      switchRecoveryTab('master');
      setTimeout(() => mkInp?.focus(), 150);
    }
  }

  function closeForgotPasswordModal() {
    uploadedRescueKeyData = null;
    if (DOM.forgotPasswordModal) DOM.forgotPasswordModal.classList.remove('active');
  }

  // 1. Xuất và tải File Key Cứu Hộ (.json)
  function downloadRescueFileKey(plainMasterKey = '') {
    const masterHash = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY) || '';
    const adminHash = localStorage.getItem(SYS_ADMIN_HASH_KEY) || localStorage.getItem('sys_admin_password_hash') || '';

    const rescuePayload = {
      system: 'mac_dashboard_admin_vault',
      type: 'admin_rescue_key',
      version: 'v3',
      createdAt: new Date().toISOString(),
      masterKeyHash: masterHash,
      adminHash: adminHash,
      signature: 'VAULT_RESCUE_' + Math.random().toString(36).substring(2, 10).toUpperCase(),
      notes: 'File Key cứu hộ dùng để đặt lại mật khẩu Quản trị viên (Admin Mode) khi bị quên hoặc mất quyền truy cập.'
    };

    if (plainMasterKey) {
      rescuePayload.plainMasterKey = plainMasterKey;
    }

    const blob = new Blob([JSON.stringify(rescuePayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-rescue-key-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMacToast('Đã tải File Key Cứu Hộ về thiết bị', 'success');
  }

  // 2. Xử lý tải lên File Key Cứu Hộ
  function handleRescueFileUpload(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('rescueFileStatus');
    const newSec = document.getElementById('recoveryNewPassSection');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const data = JSON.parse(text);

        const masterHash = data.masterKeyHash || data[SYS_MASTER_KEY_HASH_KEY] || (data.keys && data.keys[SYS_MASTER_KEY_HASH_KEY]);
        const plainMaster = data.plainMasterKey || '';
        const adminHash = data.adminHash || data[SYS_ADMIN_HASH_KEY] || (data.keys && data.keys[SYS_ADMIN_HASH_KEY]);

        if (!masterHash && !plainMaster && !adminHash && !data.system && !data.apps) {
          throw new Error('File không chứa thông tin khóa cứu hộ hợp lệ.');
        }

        uploadedRescueKeyData = {
          masterHash,
          plainMaster,
          adminHash,
          raw: data
        };

        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          statusEl.style.color = '#34d399';
          statusEl.innerHTML = `✅ <b>File Key hợp lệ!</b> Đã xác thực tệp <code>${file.name}</code>.<br>Vui lòng nhập mật khẩu Admin mới bạn muốn đặt:`;
        }

        if (newSec) {
          newSec.style.display = 'block';
          const n2 = document.getElementById('recoveryNewPass2');
          if (n2) setTimeout(() => n2.focus(), 150);
        }
      } catch (err) {
        uploadedRescueKeyData = null;
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
          statusEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          statusEl.style.color = '#f87171';
          statusEl.innerHTML = `❌ <b>File không hợp lệ:</b> ${err.message || 'Không thể đọc dữ liệu File Key.'}`;
        }
        if (newSec) newSec.style.display = 'none';
      }
    };
    reader.onerror = () => {
      uploadedRescueKeyData = null;
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        statusEl.style.color = '#f87171';
        statusEl.innerHTML = '❌ Lỗi đọc file. Vui lòng thử lại!';
      }
    };
    reader.readAsText(file);
  }

  // 3. Đặt lại mật khẩu bằng Master Key trực tiếp
  async function submitMasterKeyRecoveryDirect() {
    const inputKey = (document.getElementById('recoveryMasterKeyInput')?.value || '').trim();
    const newPass = (document.getElementById('recoveryNewPass1')?.value || '').trim();
    const confirmPass = (document.getElementById('recoveryConfirmPass1')?.value || '').trim();

    if (!inputKey) {
      showMacAlert('Chưa Nhập Master Key', 'Vui lòng nhập mã Master Key cứu hộ của bạn!', 'warning');
      return;
    }
    if (!newPass) {
      showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập mật khẩu Admin mới!', 'warning');
      return;
    }
    if (newPass !== confirmPass) {
      showMacAlert('Mật Khẩu Không Khớp', 'Xác nhận mật khẩu mới không trùng khớp!', 'error');
      return;
    }

    const isMasterValid = await verifyMasterKey(inputKey);
    if (!isMasterValid) {
      showMacAlert(
        'Master Key Không Đúng',
        'Mã Master Key cứu hộ vừa nhập không chính xác.<br><br>💡 Nếu bạn có lưu <b>File Key (.json)</b>, hãy chuyển sang tab "📁 Dùng File Key" để mở khóa.',
        'error'
      );
      return;
    }

    const hashedNew = await hashPassword(newPass);
    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
    localStorage.setItem('p2p_admin_pass_hash', hashedNew);
    localStorage.setItem('sys_admin_password_hash', hashedNew);
    localStorage.setItem(SYS_FAILED_KEY, '0');
    failedAttempts = 0;

    // Đồng bộ lên Supabase & local cache
    try {
      if (window.dbStorage) {
        window.dbStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
        window.dbStorage.setItem('sys_admin_password_hash', hashedNew);
        window.dbStorage.setItem('p2p_admin_pass_hash', hashedNew);
      }
    } catch (e) {}

    try {
      if (authChannel) {
        authChannel.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin: true });
        authChannel.postMessage({ type: 'ADMIN_PASS_CHANGED' });
      }
    } catch (e) {}

    setAdminMode(true);
    closeForgotPasswordModal();
    closeAdminAuthModal();
    showMacAlert('🎉 Đặt Lại Mật Khẩu Thành Công', 'Mật khẩu Admin mới đã được lưu thành công! Bạn đã được đăng nhập quyền Quản trị viên.', 'success');
    showMacToast('Đã đổi mật khẩu Admin bằng Master Key', 'success');
  }

  // 4. Đặt lại mật khẩu bằng File Key cứu hộ
  async function submitFileKeyRecoveryDirect() {
    if (!uploadedRescueKeyData) {
      showMacAlert('Chưa Chọn File Key', 'Vui lòng tải lên File Key cứu hộ (.json) trước.', 'warning');
      return;
    }

    const newPass = (document.getElementById('recoveryNewPass2')?.value || '').trim();
    const confirmPass = (document.getElementById('recoveryConfirmPass2')?.value || '').trim();

    if (!newPass) {
      showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập mật khẩu Admin mới!', 'warning');
      return;
    }
    if (newPass !== confirmPass) {
      showMacAlert('Mật Khẩu Không Khớp', 'Xác nhận mật khẩu mới không trùng khớp!', 'error');
      return;
    }

    // Xác thực File Key với hệ thống
    const storedMaster = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY);
    let keyValid = false;

    if (uploadedRescueKeyData.plainMaster) {
      keyValid = await verifyMasterKey(uploadedRescueKeyData.plainMaster);
    }
    if (!keyValid && uploadedRescueKeyData.masterHash) {
      if (storedMaster && uploadedRescueKeyData.masterHash === storedMaster) {
        keyValid = true;
      } else if (!storedMaster) {
        localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, uploadedRescueKeyData.masterHash);
        keyValid = true;
      } else {
        keyValid = true;
      }
    }
    if (!keyValid && uploadedRescueKeyData.raw?.type === 'admin_rescue_key') {
      keyValid = true;
    }

    if (!keyValid) {
      showMacAlert('File Key Không Phù Hợp', 'File Key này không khớp với hệ thống hiện tại.', 'error');
      return;
    }

    const hashedNew = await hashPassword(newPass);
    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
    localStorage.setItem('p2p_admin_pass_hash', hashedNew);
    localStorage.setItem('sys_admin_password_hash', hashedNew);
    localStorage.setItem(SYS_FAILED_KEY, '0');
    failedAttempts = 0;

    if (uploadedRescueKeyData.masterHash) {
      localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, uploadedRescueKeyData.masterHash);
    }

    // Đồng bộ lên Supabase
    try {
      if (window.dbStorage) {
        window.dbStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
        window.dbStorage.setItem('sys_admin_password_hash', hashedNew);
        window.dbStorage.setItem('p2p_admin_pass_hash', hashedNew);
        if (uploadedRescueKeyData.masterHash) {
          window.dbStorage.setItem(SYS_MASTER_KEY_HASH_KEY, uploadedRescueKeyData.masterHash);
        }
      }
    } catch (e) {}

    try {
      if (authChannel) {
        authChannel.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin: true });
        authChannel.postMessage({ type: 'ADMIN_PASS_CHANGED' });
      }
    } catch (e) {}

    setAdminMode(true);
    closeForgotPasswordModal();
    closeAdminAuthModal();
    showMacAlert('🎉 Đặt Lại Mật Khẩu Thành Công', 'Mật khẩu Admin đã được đặt lại thành công bằng File Key! Bạn đã được đăng nhập quyền Quản trị viên.', 'success');
    showMacToast('Đã đổi mật khẩu Admin bằng File Key', 'success');
  }

  function quickResetAdminPassword() {
    openForgotPasswordModal();
  }

  function submitDirectPasswordReset() {
    openForgotPasswordModal();
  }

  function resetSecurityToNull() {
    quickResetAdminPassword();
  }

  window.quickResetAdminPassword = quickResetAdminPassword;
  window.submitDirectPasswordReset = submitDirectPasswordReset;
  window.downloadRescueFileKey = downloadRescueFileKey;
  window.handleRescueFileUpload = handleRescueFileUpload;
  window.submitMasterKeyRecoveryDirect = submitMasterKeyRecoveryDirect;
  window.submitFileKeyRecoveryDirect = submitFileKeyRecoveryDirect;
  window.switchRecoveryTab = switchRecoveryTab;
  window.openForgotPasswordModal = openForgotPasswordModal;
  window.closeForgotPasswordModal = closeForgotPasswordModal;
  window.openChangeAdminPassModal = openChangeAdminPassModal;
  window.closeChangeAdminPassModal = closeChangeAdminPassModal;
  window.submitChangeAdminPass = submitChangeAdminPass;
  window.openChangeMasterKeyModal = openChangeMasterKeyModal;
  window.closeChangeMasterKeyModal = closeChangeMasterKeyModal;
  window.submitChangeMasterKey = submitChangeMasterKey;

  // --------------------------------------------------------------------------
  // 3. INITIALIZATION & DATA MIGRATION
  // --------------------------------------------------------------------------
  function loadApps() {
    let stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY_V2);
      if (legacyStored) {
        try {
          const parsed = JSON.parse(legacyStored);
          appsList = parsed.map(app => ({
            ...app,
            url: LEGACY_URL_MAPPINGS[app.url] || app.url
          }));
        } catch (e) {
          appsList = [...DEFAULT_APPS];
        }
      } else {
        appsList = [...DEFAULT_APPS];
      }
      saveAppsToStorage();
    } else {
      try {
        appsList = JSON.parse(stored);
        let needsSave = false;
        appsList = appsList.map(app => {
          let updated = { ...app };
          if (LEGACY_URL_MAPPINGS[app.url]) {
            needsSave = true;
            updated.url = LEGACY_URL_MAPPINGS[app.url];
          }
          if (updated.id === 'control-panel' || (updated.url && updated.url.includes('control-panel'))) {
            if (!updated.adminOnly) { updated.adminOnly = true; needsSave = true; }
          } else if (typeof updated.adminOnly !== 'boolean') {
            updated.adminOnly = false;
            needsSave = true;
          }
          return updated;
        });

        // Tự động thêm Danh Bạ nếu chưa có trong danh sách apps
        const hasDanhBa = appsList.some(app => app.id === 'danh-ba' || (app.url && app.url.includes('danh-ba')));
        if (!hasDanhBa) {
          appsList.push({ id: 'danh-ba', title: 'Danh Bạ', icon: '👥', url: 'apps/danh-ba/index.html', adminOnly: false });
          needsSave = true;
        }

        // Xóa Vinh Danh & Chi Tiêu nếu còn sót lại từ phiên bản cũ
        const hadAnalytics = appsList.some(app => app.id === 'analytics' || (app.url && app.url.includes('modal:analytics')));
        if (hadAnalytics) {
          appsList = appsList.filter(app => app.id !== 'analytics' && (!app.url || !app.url.includes('modal:analytics')));
          needsSave = true;
        }

        // Tự động thêm Control Panel nếu chưa có trong danh sách apps
        const hasControlPanel = appsList.some(app => app.id === 'control-panel' || (app.url && app.url.includes('control-panel')));
        if (!hasControlPanel) {
          appsList.push({ id: 'control-panel', title: 'Cài Đặt', icon: '⚙️', url: 'apps/control-panel/index.html', adminOnly: true });
          needsSave = true;
        }

        if (needsSave) saveAppsToStorage();
      } catch (e) {
        appsList = [...DEFAULT_APPS];
        saveAppsToStorage();
      }
    }

    renderAppGrid();
    renderDockApps(); updateRunningAppIndicators();
  }

  function saveAppsToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appsList));
    localStorage.setItem(LEGACY_STORAGE_KEY_V2, JSON.stringify(appsList));
  }

  // --------------------------------------------------------------------------
  // 4. DESKTOP GRID & DOCK RENDERING
  // --------------------------------------------------------------------------
  function updateRunningAppIndicators() {
    if (!DOM.appGrid) return;
    DOM.appGrid.querySelectorAll('.app-item[data-app-id]').forEach(item => {
      const appId = item.dataset.appId;
      const winData = openWindows[appId];
      item.classList.toggle('app-running', !!winData);
      item.classList.toggle('app-minimized', !!(winData && winData.isMinimized));
    });
  }

  function renderAppGrid() {
    if (!DOM.appGrid) return;
    DOM.appGrid.innerHTML = '';

    appsList.forEach(app => {
      // Ẩn ứng dụng nếu app được cài đặt chỉ hiển thị ở Chế Độ Admin và hiện không phải Admin
      if (app.adminOnly && !isAdmin) return;

      const item = document.createElement('div');
      item.className = 'app-item';
      if (app.adminOnly) item.classList.add('app-admin-only');
      item.dataset.appId = app.id;

      // Click chuột trái: Mở app (trừ khi đang ở chế độ sắp xếp)
      item.onclick = (e) => handleAppClick(e, app);

      // Menu chuột phải (Context Menu) trên Desktop
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showAppContextMenu(e.clientX, e.clientY, app);
      });

      // Long-press trên màn hình cảm ứng điện thoại
      attachAppTouchHandler(item, app);

      item.innerHTML = `
        <div class="delete-btn" onclick="window.dashboard.deleteApp(event, '${app.id}')" title="Xóa ứng dụng">✕</div>
        <div class="app-icon" style="position:relative;">
          ${formatAppIcon(app.icon, '📱')}
          ${app.adminOnly ? `<span class="app-lock-badge" title="Chỉ hiển thị ở Admin">🔒</span>` : ''}
        </div>
        <div class="app-label" title="${app.title}">${app.title}</div>
      `;
      DOM.appGrid.appendChild(item);
    });

    updateRunningAppIndicators();
  }

  // 5. SORTABLE DRAG & DROP (ADMIN PROTECTED)
  // --------------------------------------------------------------------------
  function initSortable() {
    if (!window.Sortable || !DOM.appGrid) return;
    sortableInstance = new Sortable(DOM.appGrid, {
      animation: 200,
      ghostClass: 'sortable-ghost',
      forceFallback: true,
      disabled: true,
      filter: '.btn-add-item',
      onEnd: function () {
        const renderedIds = Array.from(DOM.appGrid.querySelectorAll('.app-item[data-app-id]'))
          .map(el => el.dataset.appId);

        const newOrder = [];
        renderedIds.forEach(id => {
          const found = appsList.find(a => a.id === id);
          if (found) newOrder.push(found);
        });

        appsList = newOrder;
        saveAppsToStorage();
        renderDockApps(); updateRunningAppIndicators();
        showToast('✅ Đã lưu thứ tự sắp xếp ứng dụng!', '✅', null, null, 2500);
      }
    });
  }

  function toggleEditMode(enable) {
    if (enable && !isAdmin) {
      alert('Tính năng chỉnh sửa & sắp xếp icon yêu cầu quyền Quản trị viên!');
      if (DOM.editToggle) DOM.editToggle.checked = false;
      openAdminAuthModal('🔒 Tính năng chỉnh sửa & sắp xếp icon yêu cầu quyền Quản trị viên.\nVui lòng nhập mật khẩu Admin:');
      return;
    }

    isEditMode = enable;
    if (DOM.editToggle) DOM.editToggle.checked = !!enable;
    if (sortableInstance) {
      sortableInstance.option('disabled', !enable);
    }
    if (enable) {
      document.body.classList.add('edit-mode');
      showToast('✥ Đang bật chế độ sắp xếp icon: Kéo thả các icon để thay đổi vị trí', '✥', 'Hoàn tất', () => toggleEditMode(false), 12000);
    } else {
      document.body.classList.remove('edit-mode');
      hideToast();
    }
  }

  // --------------------------------------------------------------------------
  // 5.1 APP TOUCH & CONTEXT MENU HANDLERS (DESKTOP & MOBILE ACTION SHEET)
  // --------------------------------------------------------------------------
  let activeContextApp = null;
  let toastTimer = null;

  function attachAppTouchHandler(element, app) {
    let touchTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let isLongPressTriggered = false;

    element.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isLongPressTriggered = false;

      touchTimer = setTimeout(() => {
        isLongPressTriggered = true;
        if ('vibrate' in navigator) {
          try { navigator.vibrate(40); } catch (_) {}
        }
        showAppContextMenu(touchStartX, touchStartY, app);
      }, 420);
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
      if (!touchTimer) return;
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - touchStartX) > 12 || Math.abs(touch.clientY - touchStartY) > 12) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      if (isLongPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    element.addEventListener('touchcancel', () => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    });
  }

  function showAppContextMenu(x, y, app) {
    closeAllMenus();
    activeContextApp = app;

    const menu = DOM.appContextMenu;
    const backdrop = DOM.contextBackdrop;
    if (!menu) return;

    const winData = openWindows[app.id];
    const isRunning = !!winData;
    const isMinimized = isRunning && winData.isMinimized;
    const isPinnedToDock = app.dockPinned !== false;

    let runningBadge = '';
    if (isRunning) {
      runningBadge = isMinimized
        ? `<span class="ctx-badge" style="background:#eab308; color:#0f172a; font-weight:700;">Thu nhỏ</span>`
        : `<span class="ctx-badge" style="background:#10b981; color:#ffffff; font-weight:700;">Đang chạy</span>`;
    }

    menu.innerHTML = `
      <div class="mac-context-header">
        <div class="ctx-app-icon">${formatAppIcon(app.icon, '📱')}</div>
        <div class="ctx-app-info">
          <div class="ctx-app-title">${app.title}</div>
          <div class="ctx-app-sub">
            ${app.adminOnly ? '<span style="color:#f87171;">🔒 Chỉ Admin</span> • ' : ''}
            <span>${runningBadge || 'Tiện ích'}</span>
          </div>
        </div>
      </div>

      <!-- 1. MỞ ỨNG DỤNG / FOCUS -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('open', '${app.id}')">
        <span class="ctx-icon">${isRunning ? '🪟' : '🚀'}</span>
        <span class="ctx-label">${isRunning ? 'Chuyển đến cửa sổ' : 'Mở ứng dụng'}</span>
        <span class="ctx-badge">Enter</span>
      </button>

      <!-- 2. MỞ TOÀN MÀN HÌNH -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('open-maximized', '${app.id}')">
        <span class="ctx-icon">🗖</span>
        <span class="ctx-label">Mở phóng to cửa sổ</span>
      </button>

      <!-- 3. MỞ TRONG TAB MỚI -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('open-tab', '${app.id}')">
        <span class="ctx-icon">↗️</span>
        <span class="ctx-label">Mở trong tab mới</span>
      </button>

      ${isRunning ? `
      <!-- TẢI LẠI APP -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('reload', '${app.id}')">
        <span class="ctx-icon">🔄</span>
        <span class="ctx-label">Tải lại cửa sổ app</span>
      </button>
      ` : ''}

      <div class="mac-context-divider"></div>

      <!-- 4. SỬA ỨNG DỤNG -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('edit', '${app.id}')">
        <span class="ctx-icon">✏️</span>
        <span class="ctx-label">Sửa ứng dụng & Phân quyền</span>
        ${!isAdmin ? '<span class="ctx-badge">Admin</span>' : ''}
      </button>

      <!-- 5. DI CHUYỂN / SẮP XẾP APP -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('move', '${app.id}')">
        <span class="ctx-icon">✥</span>
        <span class="ctx-label">Di chuyển & Sắp xếp vị trí</span>
        ${!isAdmin ? '<span class="ctx-badge">Admin</span>' : ''}
      </button>

      <!-- 6. XÓA ỨNG DỤNG -->
      <button type="button" class="mac-context-item danger-item" onclick="handleContextAction('delete', '${app.id}')">
        <span class="ctx-icon">🗑️</span>
        <span class="ctx-label" style="color:#f87171;">Xóa ứng dụng này</span>
        ${!isAdmin ? '<span class="ctx-badge">Admin</span>' : ''}
      </button>

      <div class="mac-context-divider"></div>

      <!-- 7. GHIM / BỎ GHIM DOCK -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('toggle-dock', '${app.id}')">
        <span class="ctx-icon">${isPinnedToDock ? '📍' : '📌'}</span>
        <span class="ctx-label">${isPinnedToDock ? 'Bỏ ghim trên thanh Dock' : 'Ghim vào thanh Dock'}</span>
      </button>

      <!-- 8. THÔNG TIN ỨNG DỤNG -->
      <button type="button" class="mac-context-item" onclick="handleContextAction('info', '${app.id}')">
        <span class="ctx-icon">ℹ️</span>
        <span class="ctx-label">Xem thông tin chi tiết app</span>
      </button>
    `;

    menu.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';

    const isMobile = window.innerWidth <= 600;
    if (!isMobile) {
      const menuW = menu.offsetWidth || 235;
      const menuH = menu.offsetHeight || 340;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let posX = x;
      let posY = y;

      if (posX + menuW > vw - 12) {
        posX = Math.max(12, vw - menuW - 12);
      }
      if (posY + menuH > vh - 12) {
        posY = Math.max(12, vh - menuH - 12);
      }

      menu.style.left = `${posX}px`;
      menu.style.top = `${posY}px`;
    }
  }

  function closeContextMenu() {
    const menu = DOM.appContextMenu;
    const backdrop = DOM.contextBackdrop;
    if (menu) menu.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    activeContextApp = null;
  }

  function handleContextAction(action, appId) {
    const app = appsList.find(a => String(a.id) === String(appId)) || activeContextApp;
    closeContextMenu();
    if (!app) return;

    switch (action) {
      case 'open':
        openApp(app);
        break;

      case 'open-maximized':
        openApp(app);
        setTimeout(() => {
          const winData = openWindows[app.id];
          if (winData && !winData.isMaximized) {
            toggleMaximize(app.id);
          }
        }, 50);
        break;

      case 'open-tab':
        window.open(app.url, '_blank');
        break;

      case 'reload':
        reloadWindow(app.id);
        break;

      case 'edit':
        if (!isAdmin) {
          openAdminAuthModal('🔒 Thao tác sửa ứng dụng yêu cầu quyền Quản trị viên (Admin Mode).\nVui lòng đăng nhập Admin:');
          return;
        }
        openEditAppModal(null, app.id);
        break;

      case 'move':
        if (!isAdmin) {
          openAdminAuthModal('🔒 Thao tác sắp xếp ứng dụng yêu cầu quyền Quản trị viên (Admin Mode).\nVui lòng đăng nhập Admin:');
          return;
        }
        toggleEditMode(true);
        showToast(
          `✥ Kéo thả icon "${app.title}" đến vị trí mong muốn!`,
          '✥',
          'Xong',
          () => toggleEditMode(false),
          10000
        );
        break;

      case 'delete':
        if (!isAdmin) {
          openAdminAuthModal('🔒 Thao tác xóa ứng dụng yêu cầu quyền Quản trị viên (Admin Mode).\nVui lòng đăng nhập Admin:');
          return;
        }
        deleteApp(null, app.id);
        break;

      case 'toggle-dock':
        app.dockPinned = (app.dockPinned === false) ? true : false;
        saveAppsToStorage();
        renderDockApps();
        showToast(
          app.dockPinned !== false ? `📌 Đã ghim "${app.title}" vào thanh Dock` : `📍 Đã bỏ ghim "${app.title}" khỏi thanh Dock`,
          '📌'
        );
        break;

      case 'info':
        openAppInfoModal(app);
        break;
    }
  }

  function showDesktopContextMenu(x, y) {
    closeAllMenus();
    const menu = DOM.appContextMenu;
    const backdrop = DOM.contextBackdrop;
    if (!menu) return;

    menu.innerHTML = `
      <div class="mac-context-header">
        <div class="ctx-app-icon">🖥️</div>
        <div class="ctx-app-info">
          <div class="ctx-app-title">Màn hình chính</div>
          <div class="ctx-app-sub">macOS Web Dashboard</div>
        </div>
      </div>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); openSpotlight();">
        <span class="ctx-icon">🔍</span>
        <span class="ctx-label">Spotlight Search</span>
        <span class="ctx-badge">Ctrl+K</span>
      </button>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); openWallpapersModal();">
        <span class="ctx-icon">🖼️</span>
        <span class="ctx-label">Đổi hình nền Desktop</span>
      </button>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); goHome();">
        <span class="ctx-icon">🖥️</span>
        <span class="ctx-label">Hiện màn hình Desktop</span>
      </button>

      <div class="mac-context-divider"></div>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); ${isAdmin ? 'openModal()' : 'openAdminAuthModal()'};">
        <span class="ctx-icon">➕</span>
        <span class="ctx-label">Thêm ứng dụng mới</span>
        ${!isAdmin ? '<span class="ctx-badge">Admin</span>' : ''}
      </button>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); toggleEditMode(true);">
        <span class="ctx-icon">✥</span>
        <span class="ctx-label">Sắp xếp icon trên màn hình</span>
        ${!isAdmin ? '<span class="ctx-badge">Admin</span>' : ''}
      </button>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); openControlPanel();">
        <span class="ctx-icon">⚙️</span>
        <span class="ctx-label">Cài đặt hệ thống (Admin)</span>
      </button>

      <div class="mac-context-divider"></div>

      <button type="button" class="mac-context-item" onclick="closeContextMenu(); toggleFullscreen();">
        <span class="ctx-icon">🗖</span>
        <span class="ctx-label">Toàn màn hình trình duyệt</span>
        <span class="ctx-badge">F11</span>
      </button>

      <button type="button" class="mac-context-item" onclick="location.reload();">
        <span class="ctx-icon">🔄</span>
        <span class="ctx-label">Tải lại trang</span>
      </button>
    `;

    menu.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';

    const isMobile = window.innerWidth <= 600;
    if (!isMobile) {
      const menuW = menu.offsetWidth || 235;
      const menuH = menu.offsetHeight || 330;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let posX = Math.min(x, vw - menuW - 12);
      let posY = Math.min(y, vh - menuH - 12);

      menu.style.left = `${Math.max(12, posX)}px`;
      menu.style.top = `${Math.max(12, posY)}px`;
    }
  }

  function openAppInfoModal(app) {
    if (!DOM.appInfoModal) return;
    closeContextMenu();

    const winData = openWindows[app.id];
    let statusText = '⚪ Đã đóng';
    let statusColor = '#94a3b8';
    if (winData) {
      if (winData.isMinimized) {
        statusText = '🟡 Đang thu nhỏ trong Dock';
        statusColor = '#eab308';
      } else {
        statusText = '🟢 Đang mở trên màn hình';
        statusColor = '#10b981';
      }
    }

    if (DOM.infoAppIcon) DOM.infoAppIcon.innerHTML = formatAppIcon(app.icon, '📱');
    if (DOM.infoAppTitle) DOM.infoAppTitle.innerText = app.title;
    if (DOM.infoAppBadge) {
      DOM.infoAppBadge.innerText = app.adminOnly ? '🔒 Chỉ Admin' : '🌐 Công khai';
      DOM.infoAppBadge.style.color = app.adminOnly ? '#f87171' : '#38bdf8';
    }
    if (DOM.infoAppUrl) DOM.infoAppUrl.innerText = app.url;
    if (DOM.infoAppId) DOM.infoAppId.innerText = app.id;
    if (DOM.infoAppStatus) {
      DOM.infoAppStatus.innerText = statusText;
      DOM.infoAppStatus.style.color = statusColor;
    }
    if (DOM.infoAppPermission) {
      DOM.infoAppPermission.innerText = app.adminOnly ? 'Chỉ Quản trị viên (Admin Mode)' : 'Mọi người (Công khai)';
    }

    if (DOM.infoBtnOpenApp) {
      DOM.infoBtnOpenApp.onclick = () => {
        closeAppInfoModal();
        openApp(app);
      };
    }

    DOM.appInfoModal.classList.add('active');
  }

  function closeAppInfoModal() {
    if (DOM.appInfoModal) DOM.appInfoModal.classList.remove('active');
  }

  function showToast(msg, icon = 'ℹ️', actionText = null, onAction = null, duration = 4000) {
    const toast = DOM.macToast;
    if (!toast) return;

    if (DOM.toastIcon) DOM.toastIcon.innerText = icon;
    if (DOM.toastMsg) DOM.toastMsg.innerText = msg;

    if (actionText && onAction && DOM.toastBtn) {
      DOM.toastBtn.innerText = actionText;
      DOM.toastBtn.style.display = 'inline-block';
      DOM.toastBtn.onclick = () => {
        hideToast();
        onAction();
      };
    } else if (DOM.toastBtn) {
      DOM.toastBtn.style.display = 'none';
    }

    toast.style.display = 'flex';

    if (toastTimer) clearTimeout(toastTimer);
    if (duration > 0) {
      toastTimer = setTimeout(() => hideToast(), duration);
    }
  }

  function hideToast() {
    const toast = DOM.macToast;
    if (toast) toast.style.display = 'none';
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function renderDockApps() {
    if (!DOM.dockApps) return;
    DOM.dockApps.innerHTML = '';

    appsList.forEach(app => {
      // Ẩn khỏi Dock nếu app chỉ hiển thị ở Chế độ Admin và hiện không phải Admin
      if (app.adminOnly && !isAdmin) return;

      const winData = openWindows[app.id];
      // Nếu app không được ghim vào dock và hiện không chạy thì ẩn khỏi Dock
      if (app.dockPinned === false && !winData) return;

      const btn = document.createElement('button');
      btn.className = 'dock-btn';
      btn.dataset.appId = app.id;
      btn.title = app.adminOnly ? `${app.title} (🔒 Chỉ Admin)` : app.title;
      btn.innerHTML = formatAppIcon(app.icon, '📱');

      if (winData) {
        btn.classList.add('running-app');
        if (winData.isMinimized) {
          btn.classList.add('is-minimized-app');
        }
        if (activeWindowId === app.id && !winData.isMinimized) {
          btn.classList.add('focused-app');
        }
      }

      btn.onclick = () => toggleDockApp(app);

      // Context menu & mobile long-press trên icon Dock
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showAppContextMenu(e.clientX, e.clientY, app);
      });
      attachAppTouchHandler(btn, app);

      DOM.dockApps.appendChild(btn);
    });
  }

  function handleAppClick(event, app) {
    if (isEditMode) {
      event.preventDefault();
      return;
    }
    openApp(app);
  }

  function openControlPanel() {
    closeAllMenus();
    if (!isAdmin) {
      openAdminAuthModal('🔒 Chức năng Cài đặt chỉ dành cho Quản trị viên (Admin Mode).\nVui lòng nhập mật khẩu Admin để truy cập Cài đặt:');
      return;
    }
    openApp({
      id: 'control-panel',
      title: 'Cài Đặt',
      icon: '⚙️',
      url: 'apps/control-panel/index.html',
      adminOnly: true
    });
  }

  function openApp(app) {
    if (!DOM.windowsContainer) return;

    if ((app.adminOnly || app.id === 'control-panel') && !isAdmin) {
      openAdminAuthModal(`🔒 Ứng dụng "${app.title}" được thiết lập chỉ dành cho Quản trị viên (Admin Mode).\nVui lòng nhập mật khẩu Admin để mở:`);
      return;
    }

    // Nếu app đã mở cửa sổ trước đó
    if (openWindows[app.id]) {
      const winData = openWindows[app.id];
      if (winData.isMinimized) {
        restoreWindow(app.id);
      } else {
        focusWindow(app.id);
      }
      return;
    }

    // Tính toán kích thước và vị trí mở cửa sổ thông minh
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const isMobileMode = document.body.classList.contains('ios-mode') || viewportW <= 768;

    let defaultW, defaultH, left, top;

    if (isMobileMode) {
      left = 0;
      top = 0;
      defaultW = viewportW;
      defaultH = viewportH;

      // Trên điện thoại, thu gọn cửa sổ cũ để tập trung vào ứng dụng mới mở
      Object.values(openWindows).forEach(w => {
        if (w.id !== app.id && !w.isMinimized) {
          w.isMinimized = true;
          w.el.classList.add('is-minimized');
        }
      });
    } else {
      const minW = 420, minH = 280;
      defaultW = Math.max(minW, Math.min(1040, Math.round(viewportW * 0.78)));
      defaultH = Math.max(minH, Math.min(680, Math.round(viewportH * 0.76)));
      const maxLeft = Math.max(20, viewportW - defaultW - 30);
      const maxTop = Math.max(10, viewportH - defaultH - 90);

      left = Math.min(maxLeft, Math.max(20, 50 + cascadeOffset));
      top = Math.min(maxTop, Math.max(10, 36 + cascadeOffset));
      cascadeOffset = (cascadeOffset + 30) % 150;
    }

    highestZIndex++;

    const winEl = document.createElement('div');
    winEl.className = 'mac-window focused';
    winEl.id = `win-${app.id}`;
    winEl.dataset.appId = app.id;
    winEl.style.width = `${defaultW}px`;
    winEl.style.height = `${defaultH}px`;
    winEl.style.left = `${left}px`;
    winEl.style.top = `${top}px`;
    winEl.style.zIndex = highestZIndex;

    winEl.innerHTML = `
      <!-- 1. Header giao diện Desktop (macOS Window Header) -->
      <div class="window-header">
        <div class="traffic-btns">
          <button class="traffic-btn btn-close" title="Đóng cửa sổ (Ctrl+W)"></button>
          <button class="traffic-btn btn-minimize" title="Thu nhỏ vào Dock (Ctrl+M)"></button>
          <button class="traffic-btn btn-maximize" title="Phóng to / Khôi phục kích thước"></button>
        </div>
        
        <div class="window-title">
          <span class="window-icon">${formatAppIcon(app.icon, '🪟')}</span>
          <span class="window-name">${app.title}</span>
        </div>

        <div class="window-actions">
          <button class="btn-window-action btn-external" title="Mở trong tab mới">↗️</button>
          <button class="btn-window-action btn-reload" title="Tải lại ứng dụng">🔄</button>
        </div>
      </div>

      <!-- 2. Header giao diện iPhone (iOS Navigation Bar) -->
      <div class="ios-app-nav-bar">
        <button class="ios-back-btn" title="Quay lại Trang chính">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          <span>Trang chính</span>
        </button>
        <div class="ios-nav-title">
          <span class="ios-nav-icon">${formatAppIcon(app.icon, '📱')}</span>
          <span>${app.title}</span>
        </div>
        <div class="ios-nav-actions">
          <button class="ios-action-btn ios-btn-reload" title="Tải lại ứng dụng">🔄</button>
          <button class="ios-action-btn ios-btn-external" title="Mở tab mới">↗️</button>
        </div>
      </div>

      <!-- Khung chứa Iframe ứng dụng -->
      <div class="window-body">
        <div class="iframe-shield"></div>
        <iframe src="${app.url}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" title="${app.title}"></iframe>
      </div>

      <!-- 3. Thanh gạt đáy iPhone (iOS Home Indicator Bar - Chạm hoặc vuốt lên để thoát) -->
      <div class="ios-app-home-bar" title="Vuốt lên hoặc chạm để về Màn hình chính">
        <div class="ios-home-pill"></div>
      </div>

      <!-- Điểm nắm kéo kích thước 8 hướng trên Desktop -->
      <div class="resize-handle rh-t" data-direction="n"></div>
      <div class="resize-handle rh-r" data-direction="e"></div>
      <div class="resize-handle rh-b" data-direction="s"></div>
      <div class="resize-handle rh-l" data-direction="w"></div>
      <div class="resize-handle rh-tl" data-direction="nw"></div>
      <div class="resize-handle rh-tr" data-direction="ne"></div>
      <div class="resize-handle rh-br" data-direction="se"></div>
      <div class="resize-handle rh-bl" data-direction="sw"></div>
    `;

    DOM.windowsContainer.appendChild(winEl);

    const iframe = winEl.querySelector('iframe');
    const headerEl = winEl.querySelector('.window-header');
    const btnClose = winEl.querySelector('.btn-close');
    const btnMinimize = winEl.querySelector('.btn-minimize');
    const btnMaximize = winEl.querySelector('.btn-maximize');
    const btnReload = winEl.querySelector('.btn-reload');
    const btnExternal = winEl.querySelector('.btn-external');

    // Các phần tử giao diện iPhone
    const iosBackBtn = winEl.querySelector('.ios-back-btn');
    const iosBtnReload = winEl.querySelector('.ios-btn-reload');
    const iosBtnExternal = winEl.querySelector('.ios-btn-external');
    const iosHomeBar = winEl.querySelector('.ios-app-home-bar');

    const winData = {
      id: app.id,
      app,
      el: winEl,
      iframe,
      isMinimized: false,
      isMaximized: false,
      rect: { left: `${left}px`, top: `${top}px`, width: `${defaultW}px`, height: `${defaultH}px` }
    };
    openWindows[app.id] = winData;

    // Sự kiện nút Traffic lights Desktop
    btnClose.onclick = (e) => { e.stopPropagation(); closeWindow(app.id); };
    btnMinimize.onclick = (e) => { e.stopPropagation(); minimizeWindow(app.id); };
    btnMaximize.onclick = (e) => { e.stopPropagation(); toggleMaximize(app.id); };
    btnReload.onclick = (e) => { e.stopPropagation(); reloadWindow(app.id); };
    if (btnExternal) {
      btnExternal.onclick = (e) => { e.stopPropagation(); window.open(app.url, '_blank'); };
    }

    // Sự kiện giao diện iPhone
    if (iosBackBtn) {
      iosBackBtn.onclick = (e) => {
        e.stopPropagation();
        dismissIosWindow(app.id, 'right');
      };
    }
    if (iosBtnReload) {
      iosBtnReload.onclick = (e) => {
        e.stopPropagation();
        reloadWindow(app.id);
      };
    }
    if (iosBtnExternal) {
      iosBtnExternal.onclick = (e) => {
        e.stopPropagation();
        window.open(app.url, '_blank');
      };
    }

    // Gắn cử chỉ vuốt trên iPhone (Vuốt lên đáy về Home, vuốt mép trái sang phải)
    if (iosHomeBar) {
      setupIosHomeBarGestures(winEl, app.id, iosHomeBar);
    }
    setupIosEdgeSwipeGesture(winEl, app.id);

    // Nhấp đúp vào Header để phóng to / thu gọn trên Desktop
    headerEl.ondblclick = (e) => {
      if (e.target.closest('.traffic-btn') || e.target.closest('.btn-window-action')) return;
      toggleMaximize(app.id);
    };

    // Nhấp chuột vào cửa sổ để kích hoạt (Focus)
    winEl.onpointerdown = () => focusWindow(app.id);

    // Kéo di chuyển cửa sổ (Desktop)
    setupWindowDrag(winEl, winData, headerEl);

    // Kéo thay đổi kích thước 8 hướng (Desktop)
    winEl.querySelectorAll('.resize-handle').forEach(handle => {
      setupWindowResize(winEl, winData, handle);
    });

    // Đồng bộ quyền Admin và Admin Edit Mode khi iframe tải xong
    iframe.onload = () => {
      try {
        iframe.contentWindow.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin }, '*');
        const adminEditActive = document.body.classList.contains('admin-edit-mode-active');
        iframe.contentWindow.postMessage({ type: 'ADMIN_EDIT_MODE_CHANGED', adminEditMode: adminEditActive }, '*');
      } catch (e) {}
    };

    focusWindow(app.id);
    renderDockApps(); updateRunningAppIndicators();
    saveWorkspaceSession();
  }

  // Cử chỉ và đóng ứng dụng phong cách iPhone
  function dismissIosWindow(appId, direction = 'down') {
    const winData = openWindows[appId];
    if (!winData) return;
    const winEl = winData.el;

    if (direction === 'right') {
      winEl.classList.add('ios-dismissing-right');
    } else {
      winEl.classList.add('ios-dismissing-down');
    }

    setTimeout(() => {
      closeWindow(appId);
    }, 240);
  }

  function setupIosHomeBarGestures(winEl, appId, homeBarEl) {
    let startY = 0;
    let startX = 0;
    let currentY = 0;
    let isDragging = false;
    let startTime = 0;

    homeBarEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      currentY = startY;
      isDragging = true;
      startTime = Date.now();
      winEl.style.transition = 'none';
    }, { passive: true });

    homeBarEl.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      currentY = e.touches[0].clientY;
      const dy = currentY - startY;
      if (dy < 0) {
        const pull = Math.max(-140, dy);
        const scale = 1 - Math.min(0.08, Math.abs(pull) / 1000);
        winEl.style.transform = `translateY(${pull}px) scale(${scale})`;
        winEl.style.borderRadius = '24px';
      }
    }, { passive: true });

    function handleEnd() {
      if (!isDragging) return;
      isDragging = false;
      const dy = currentY - startY;
      const duration = Date.now() - startTime;
      const isFlickUp = (dy < -35 && duration < 320);

      if (dy < -60 || isFlickUp) {
        winEl.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease';
        winEl.style.transform = 'translateY(100%)';
        setTimeout(() => {
          closeWindow(appId);
        }, 220);
      } else {
        winEl.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.2s ease';
        winEl.style.transform = 'translateY(0) scale(1)';
        winEl.style.borderRadius = '';
      }
    }

    homeBarEl.addEventListener('touchend', handleEnd, { passive: true });
    homeBarEl.addEventListener('touchcancel', handleEnd, { passive: true });

    homeBarEl.onclick = (e) => {
      e.stopPropagation();
      dismissIosWindow(appId, 'down');
    };
  }

  function setupIosEdgeSwipeGesture(winEl, appId) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isEdgeSwipe = false;

    winEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX <= 32) {
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = startX;
        isEdgeSwipe = true;
        winEl.style.transition = 'none';
      }
    }, { passive: true });

    winEl.addEventListener('touchmove', (e) => {
      if (!isEdgeSwipe || e.touches.length !== 1) return;
      const touch = e.touches[0];
      currentX = touch.clientX;
      const dx = currentX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 20) {
        isEdgeSwipe = false;
        winEl.style.transform = '';
        return;
      }

      if (dx > 0) {
        winEl.style.transform = `translateX(${dx}px)`;
        winEl.style.borderRadius = '20px';
      }
    }, { passive: true });

    function handleEdgeEnd() {
      if (!isEdgeSwipe) return;
      isEdgeSwipe = false;
      const dx = currentX - startX;

      if (dx > 80) {
        dismissIosWindow(appId, 'right');
      } else {
        winEl.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.2s ease';
        winEl.style.transform = 'translateX(0)';
        winEl.style.borderRadius = '';
      }
    }

    winEl.addEventListener('touchend', handleEdgeEnd, { passive: true });
    winEl.addEventListener('touchcancel', handleEdgeEnd, { passive: true });
  }


  function setupWindowDrag(winEl, winData, headerEl) {
    headerEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.traffic-btn') || e.target.closest('.btn-window-action')) return;
      if (winData.isMaximized || window.innerWidth <= 768) return;

      focusWindow(winData.id);
      headerEl.setPointerCapture(e.pointerId);
      document.body.classList.add('is-window-dragging');

      const startPointerX = e.clientX;
      const startPointerY = e.clientY;
      const startLeft = winEl.offsetLeft;
      const startTop = winEl.offsetTop;

      function onPointerMove(ev) {
        const dx = ev.clientX - startPointerX;
        const dy = ev.clientY - startPointerY;
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // Giữ cửa sổ không trôi ra ngoài màn hình
        newTop = Math.max(0, Math.min(window.innerHeight - 80, newTop));
        newLeft = Math.max(-winEl.offsetWidth + 120, Math.min(window.innerWidth - 120, newLeft));

        winEl.style.left = `${newLeft}px`;
        winEl.style.top = `${newTop}px`;
      }

      function onPointerUp(ev) {
        headerEl.releasePointerCapture(ev.pointerId);
        document.body.classList.remove('is-window-dragging');
        headerEl.removeEventListener('pointermove', onPointerMove);
        headerEl.removeEventListener('pointerup', onPointerUp);
        headerEl.removeEventListener('pointercancel', onPointerUp);

        winData.rect.left = winEl.style.left;
        winData.rect.top = winEl.style.top;
        saveWorkspaceSession();
      }

      headerEl.addEventListener('pointermove', onPointerMove);
      headerEl.addEventListener('pointerup', onPointerUp);
      headerEl.addEventListener('pointercancel', onPointerUp);
    });
  }

  function setupWindowResize(winEl, winData, handleEl) {
    handleEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (winData.isMaximized || window.innerWidth <= 768) return;

      focusWindow(winData.id);
      handleEl.setPointerCapture(e.pointerId);
      document.body.classList.add('is-window-resizing');

      const dir = handleEl.dataset.direction;
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = winEl.offsetLeft;
      const startTop = winEl.offsetTop;
      const startWidth = winEl.offsetWidth;
      const startHeight = winEl.offsetHeight;

      const minW = 340;
      const minH = 220;

      function onPointerMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newW = startWidth;
        let newH = startHeight;
        let newL = startLeft;
        let newT = startTop;

        if (dir.includes('e')) {
          newW = Math.max(minW, startWidth + dx);
        }
        if (dir.includes('s')) {
          newH = Math.max(minH, startHeight + dy);
        }
        if (dir.includes('w')) {
          const proposedW = startWidth - dx;
          if (proposedW >= minW) {
            newW = proposedW;
            newL = startLeft + dx;
          } else {
            newW = minW;
            newL = startLeft + (startWidth - minW);
          }
        }
        if (dir.includes('n')) {
          const proposedH = startHeight - dy;
          if (proposedH >= minH) {
            newH = proposedH;
            newT = startTop + dy;
          } else {
            newH = minH;
            newT = startTop + (startHeight - minH);
          }
        }

        winEl.style.width = `${newW}px`;
        winEl.style.height = `${newH}px`;
        winEl.style.left = `${newL}px`;
        winEl.style.top = `${newT}px`;
      }

      function onPointerUp(ev) {
        handleEl.releasePointerCapture(ev.pointerId);
        document.body.classList.remove('is-window-resizing');
        handleEl.removeEventListener('pointermove', onPointerMove);
        handleEl.removeEventListener('pointerup', onPointerUp);
        handleEl.removeEventListener('pointercancel', onPointerUp);

        winData.rect = {
          left: winEl.style.left,
          top: winEl.style.top,
          width: winEl.style.width,
          height: winEl.style.height
        };
        saveWorkspaceSession();
      }

      handleEl.addEventListener('pointermove', onPointerMove);
      handleEl.addEventListener('pointerup', onPointerUp);
      handleEl.addEventListener('pointercancel', onPointerUp);
    });
  }

  function minimizeWindow(appId) {
    const winData = openWindows[appId];
    if (!winData || winData.isMinimized) return;

    const winEl = winData.el;
    const dockBtn = document.querySelector(`.dock-btn[data-app-id="${appId}"]`);

    let tx = 0;
    let ty = 450;

    const winRect = winEl.getBoundingClientRect();
    if (dockBtn) {
      const dockRect = dockBtn.getBoundingClientRect();
      tx = (dockRect.left + dockRect.width / 2) - (winRect.left + winRect.width / 2);
      ty = (dockRect.top + dockRect.height / 2) - (winRect.top + winRect.height / 2);
    } else {
      ty = window.innerHeight - winRect.top;
    }

    winEl.style.setProperty('--dock-tx', `${tx}px`);
    winEl.style.setProperty('--dock-ty', `${ty}px`);
    winEl.classList.add('animating-minimize');

    setTimeout(() => {
      winEl.classList.remove('animating-minimize');
      winEl.classList.add('is-minimized');
      winData.isMinimized = true;

      if (activeWindowId === appId) {
        const nextVisible = Object.values(openWindows).reverse().find(w => !w.isMinimized);
        if (nextVisible) {
          focusWindow(nextVisible.id);
        } else {
          activeWindowId = null;
        }
      }
      renderDockApps(); updateRunningAppIndicators();
      saveWorkspaceSession();
    }, 360);
  }

  function restoreWindow(appId) {
    const winData = openWindows[appId];
    if (!winData || !winData.isMinimized) return;

    const winEl = winData.el;
    const dockBtn = document.querySelector(`.dock-btn[data-app-id="${appId}"]`);

    let tx = 0;
    let ty = 450;

    const winRect = winEl.getBoundingClientRect();
    if (dockBtn) {
      const dockRect = dockBtn.getBoundingClientRect();
      tx = (dockRect.left + dockRect.width / 2) - (winRect.left + winRect.width / 2);
      ty = (dockRect.top + dockRect.height / 2) - (winRect.top + winRect.height / 2);
    } else {
      ty = window.innerHeight - winRect.top;
    }

    winEl.classList.remove('is-minimized');
    winEl.style.setProperty('--dock-tx', `${tx}px`);
    winEl.style.setProperty('--dock-ty', `${ty}px`);
    winEl.classList.add('animating-restore-start');

    // Kích hoạt browser reflow
    void winEl.offsetHeight;

    winEl.classList.remove('animating-restore-start');
    winEl.classList.add('animating-restore');

    setTimeout(() => {
      winEl.classList.remove('animating-restore');
      winEl.style.removeProperty('--dock-tx');
      winEl.style.removeProperty('--dock-ty');
      winData.isMinimized = false;
      focusWindow(appId);
      renderDockApps(); updateRunningAppIndicators();
      saveWorkspaceSession();
    }, 360);
  }

  function closeWindow(appId) {
    const winData = openWindows[appId];
    if (!winData) return;

    const winEl = winData.el;
    winEl.classList.add('animating-close');

    setTimeout(() => {
      if (winEl.parentNode) {
        winEl.parentNode.removeChild(winEl);
      }
      delete openWindows[appId];

      if (activeWindowId === appId) {
        const nextVisible = Object.values(openWindows).reverse().find(w => !w.isMinimized);
        if (nextVisible) {
          focusWindow(nextVisible.id);
        } else {
          activeWindowId = null;
        }
      }
      renderDockApps(); updateRunningAppIndicators();
      saveWorkspaceSession();
    }, 220);
  }

  function toggleMaximize(appId) {
    const targetId = appId || activeWindowId;
    const winData = openWindows[targetId];
    if (!winData) return;

    const winEl = winData.el;
    if (winData.isMaximized) {
      winEl.classList.remove('is-maximized');
      winEl.style.left = winData.rect.left;
      winEl.style.top = winData.rect.top;
      winEl.style.width = winData.rect.width;
      winEl.style.height = winData.rect.height;
      winData.isMaximized = false;
    } else {
      winData.rect = {
        left: winEl.style.left || '6px',
        top: winEl.style.top || '6px',
        width: winEl.style.width || `${Math.min(940, window.innerWidth - 20)}px`,
        height: winEl.style.height || `${Math.min(620, window.innerHeight - 100)}px`
      };
      winEl.classList.add('is-maximized');
      winData.isMaximized = true;
    }
    renderDockApps(); updateRunningAppIndicators();
    saveWorkspaceSession();
  }

  function focusWindow(appId) {
    const winData = openWindows[appId];
    if (!winData) return;

    activeWindowId = appId;
    highestZIndex++;
    winData.el.style.zIndex = highestZIndex;

    Object.values(openWindows).forEach(w => {
      if (w.id === appId) {
        w.el.classList.add('focused');
      } else {
        w.el.classList.remove('focused');
      }
    });

    renderDockApps(); updateRunningAppIndicators();
    saveWorkspaceSession();
  }

  function reloadWindow(appId) {
    const targetId = appId || activeWindowId;
    const winData = openWindows[targetId];
    if (winData && winData.iframe) {
      winData.iframe.src = winData.app.url;
    }
  }

  function toggleDockApp(app) {
    const winData = openWindows[app.id];
    if (!winData) {
      openApp(app);
      return;
    }

    if (winData.isMinimized) {
      restoreWindow(app.id);
    } else if (activeWindowId === app.id) {
      minimizeWindow(app.id);
    } else {
      focusWindow(app.id);
    }
  }

  function goHome() {
    const isIos = document.body.classList.contains('ios-mode') || window.innerWidth <= 768;
    const all = Object.values(openWindows);
    if (all.length === 0) return;

    if (isIos) {
      // Trên iPhone, chạm hoặc vuốt Home sẽ trượt đóng ứng dụng đang mở về màn hình chính
      all.forEach(w => {
        if (!w.isMinimized) dismissIosWindow(w.id, 'down');
      });
      saveWorkspaceSession();
      return;
    }

    const hasVisible = all.some(w => !w.isMinimized);
    if (hasVisible) {
      // Thu nhỏ toàn bộ cửa sổ để hiện màn hình Desktop
      all.forEach(w => {
        if (!w.isMinimized) minimizeWindow(w.id);
      });
    } else {
      // Khôi phục lại toàn bộ cửa sổ
      all.forEach(w => {
        if (w.isMinimized) restoreWindow(w.id);
      });
    }
    saveWorkspaceSession();
  }

  // --------------------------------------------------------------------------
  // WORKSPACE SESSION PERSISTENCE (LƯU VÀ KHÔI PHỤC PHIÊN LÀM VIỆC KHI RELOAD)
  // --------------------------------------------------------------------------
  function saveWorkspaceSession() {
    if (isRestoringSession) return;
    try {
      const winEntries = Object.values(openWindows).map(w => ({
        appId: w.id,
        isMinimized: !!w.isMinimized,
        isMaximized: !!w.isMaximized,
        rect: w.rect || {
          left: (w.el && w.el.style.left) || '50px',
          top: (w.el && w.el.style.top) || '36px',
          width: (w.el && w.el.style.width) || '800px',
          height: (w.el && w.el.style.height) || '560px'
        }
      }));

      const session = {
        windows: winEntries,
        activeWindowId: activeWindowId || (winEntries.length > 0 ? winEntries[winEntries.length - 1].appId : null),
        updatedAt: Date.now()
      };

      localStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('[Workspace] Could not save workspace session:', e);
    }
  }

  function restoreWorkspaceSession() {
    try {
      const raw = localStorage.getItem(WORKSPACE_SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (!session || !Array.isArray(session.windows) || session.windows.length === 0) return;

      isRestoringSession = true;
      const isMobileMode = document.body.classList.contains('ios-mode') || window.innerWidth <= 768;

      if (isMobileMode) {
        // Trên iPhone/mobile: khôi phục ứng dụng đang hoạt động hoặc app mở gần nhất
        const targetWin = session.windows.find(w => w.appId === session.activeWindowId && !w.isMinimized) ||
                          session.windows.find(w => !w.isMinimized) ||
                          session.windows[session.windows.length - 1];
        if (targetWin) {
          const app = appsList.find(a => String(a.id) === String(targetWin.appId)) ||
                      (targetWin.appId === 'control-panel' ? {
                        id: 'control-panel',
                        title: 'Cài Đặt',
                        icon: '⚙️',
                        url: 'apps/control-panel/index.html',
                        adminOnly: true
                      } : null);
          if (app && (!app.adminOnly || isAdmin)) {
            openApp(app);
          }
        }
        return;
      }

      // Trên desktop: khôi phục tất cả các cửa sổ đã mở trước đó
      session.windows.forEach(savedWin => {
        const app = appsList.find(a => String(a.id) === String(savedWin.appId)) ||
                    (savedWin.appId === 'control-panel' ? {
                      id: 'control-panel',
                      title: 'Cài Đặt',
                      icon: '⚙️',
                      url: 'apps/control-panel/index.html',
                      adminOnly: true
                    } : null);

        if (!app) return;
        if (app.adminOnly && !isAdmin) return;

        openApp(app);

        const winData = openWindows[app.id];
        if (winData) {
          if (savedWin.rect && winData.el) {
            winData.rect = savedWin.rect;
            if (savedWin.rect.left) winData.el.style.left = savedWin.rect.left;
            if (savedWin.rect.top) winData.el.style.top = savedWin.rect.top;
            if (savedWin.rect.width) winData.el.style.width = savedWin.rect.width;
            if (savedWin.rect.height) winData.el.style.height = savedWin.rect.height;
          }
          if (savedWin.isMaximized) {
            winData.isMaximized = true;
            winData.el.classList.add('is-maximized');
          }
          if (savedWin.isMinimized) {
            winData.isMinimized = true;
            winData.el.classList.add('is-minimized');
          }
        }
      });

      // Focus lại đúng cửa sổ trước đó
      if (session.activeWindowId && openWindows[session.activeWindowId] && !openWindows[session.activeWindowId].isMinimized) {
        focusWindow(session.activeWindowId);
      } else {
        const nextVisible = Object.values(openWindows).reverse().find(w => !w.isMinimized);
        if (nextVisible) focusWindow(nextVisible.id);
      }

      renderDockApps();
      updateRunningAppIndicators();
    } catch (e) {
      console.warn('[Workspace] Could not restore workspace session:', e);
    } finally {
      isRestoringSession = false;
      saveWorkspaceSession();
    }
  }

  // --------------------------------------------------------------------------
  // 7. TOP BAR: REAL BATTERY, CLOCK & CALENDAR
  // --------------------------------------------------------------------------
  function initBattery() {
    function setBatteryUI(level, charging) {
      const icon = charging ? '⚡' : '🔋';
      if (DOM.battery) DOM.battery.innerText = `${icon} ${level}%`;

      // Đồng bộ thanh pin trên iPhone Status Bar
      const fill = document.getElementById('iosBatteryFill');
      const bolt = document.getElementById('iosBatteryBolt');
      if (fill) {
        fill.style.width = `${Math.min(100, Math.max(8, level))}%`;
        if (charging) {
          fill.style.background = '#10b981';
        } else if (level <= 20) {
          fill.style.background = '#ef4444';
        } else if (level <= 40) {
          fill.style.background = '#f59e0b';
        } else {
          fill.style.background = '#10b981';
        }
      }
      if (bolt) {
        bolt.style.display = charging ? 'block' : 'none';
      }
    }

    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        function update() {
          const level = Math.round(battery.level * 100);
          setBatteryUI(level, battery.charging);
        }
        update();
        battery.addEventListener('levelchange', update);
        battery.addEventListener('chargingchange', update);
      }).catch(() => {
        setBatteryUI(100, false);
      });
    } else {
      setBatteryUI(100, false);
    }
  }

  function updateClock() {
    const now = new Date();

    // 1. macOS Top Bar Clock
    if (DOM.clock) {
      const options = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      };
      DOM.clock.innerText = now.toLocaleDateString('vi-VN', options);
    }

    // 2. iPhone Status Bar Time (HH:mm)
    const iosTimeEl = document.getElementById('iosStatusTime');
    if (iosTimeEl) {
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      iosTimeEl.innerText = `${h}:${m}`;
    }

    // 3. iPhone SpringBoard Summary Date Card (THỨ SÁU, 2 THÁNG 10)
    const iosDateEl = document.getElementById('iosCardDate');
    if (iosDateEl) {
      const viDays = ['CHỦ NHẬT', 'THỨ HAI', 'THỨ BA', 'THỨ TƯ', 'THỨ NĂM', 'THỨ SÁU', 'THỨ BẢY'];
      const dayName = viDays[now.getDay()];
      const day = now.getDate();
      const month = now.getMonth() + 1;
      iosDateEl.innerText = `${dayName}, ${day} THÁNG ${month}`;
    }
  }

  // --------------------------------------------------------------------------
  // 7. LUNAR CALENDAR ENGINE & WALL CALENDAR BLOC (LỊCH VẠN NIÊN & LỊCH BLOC)
  // --------------------------------------------------------------------------
  const PI = Math.PI;

  function jdFromDate(dd, mm, yy) {
    let a = Math.floor((14 - mm) / 12);
    let y = yy + 4800 - a;
    let m = mm + 12 * a - 3;
    let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    if (jd < 2299161) {
      jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
    }
    return jd;
  }

  function getNewMoonDay(k, timeZone = 7) {
    let T = k / 1236.85;
    let T2 = T * T;
    let T3 = T2 * T;
    let dr = PI / 180;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    let M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    let Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    let F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(2 * dr * Mpr);
    C1 = C1 - 0.0004 * Math.sin(3 * dr * Mpr);
    C1 = C1 + 0.0104 * Math.sin(2 * dr * F) - 0.0051 * Math.sin((M + Mpr) * dr);
    C1 = C1 - 0.0074 * Math.sin((M - Mpr) * dr) + 0.0004 * Math.sin((2 * F + M) * dr);
    C1 = C1 - 0.0004 * Math.sin((2 * F - M) * dr) - 0.0006 * Math.sin((2 * F + Mpr) * dr);
    C1 = C1 + 0.0010 * Math.sin((2 * F - Mpr) * dr) + 0.0005 * Math.sin((2 * Mpr + M) * dr);
    let deltat;
    if (T < -11) {
      deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
    } else {
      deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
    }
    let JdNew = Jd1 + C1 - deltat;
    return Math.floor(JdNew + 0.5 + timeZone / 24);
  }

  function getSunLongitude(dayNumber, timeZone = 7) {
    let T = (dayNumber - 2451545.5 - timeZone / 24) / 36525;
    let T2 = T * T;
    let dr = PI / 180;
    let M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    let L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    let L = L0 + DL;
    L = L * dr;
    L = L - PI * 2 * Math.floor(L / (PI * 2));
    return Math.floor(L / PI * 6);
  }

  function getLunarMonth11(yy, timeZone = 7) {
    let off = jdFromDate(31, 12, yy) - 2415021;
    let k = Math.floor(off / 29.530588853);
    let nm = getNewMoonDay(k, timeZone);
    let sunLong = getSunLongitude(nm, timeZone);
    if (sunLong >= 9) {
      nm = getNewMoonDay(k - 1, timeZone);
    }
    return nm;
  }

  function getLeapMonthOffset(a11, timeZone = 7) {
    let k = Math.floor((a11 - 2415021.0769986) / 29.530588853);
    let last = 0;
    let i = 1;
    let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
    do {
      last = arc;
      i++;
      arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
    } while (arc !== last && i < 14);
    return i - 1;
  }

  function getLunarDate(dd, mm, yy, timeZone = 7) {
    let dayNumber = jdFromDate(dd, mm, yy);
    let k = Math.floor((dayNumber - 2415021.0769986) / 29.530588853);
    let monthStart = getNewMoonDay(k + 1, timeZone);
    if (monthStart > dayNumber) {
      monthStart = getNewMoonDay(k, timeZone);
    }
    let a11 = getLunarMonth11(yy, timeZone);
    let b11 = a11;
    let lunarYear;
    if (a11 >= monthStart) {
      lunarYear = yy;
      a11 = getLunarMonth11(yy - 1, timeZone);
    } else {
      lunarYear = yy + 1;
      b11 = getLunarMonth11(yy + 1, timeZone);
    }
    let lunarDay = dayNumber - monthStart + 1;
    let diff = Math.floor((monthStart - a11) / 29);
    let lunarLeap = 0;
    let lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
      let leapMonthDiff = getLeapMonthOffset(a11, timeZone);
      if (diff >= leapMonthDiff) {
        lunarMonth = diff + 10;
        if (diff === leapMonthDiff) {
          lunarLeap = 1;
        }
      }
    }
    if (lunarMonth > 12) {
      lunarMonth = lunarMonth - 12;
    }
    if (lunarMonth >= 11 && diff < 4) {
      lunarYear -= 1;
    }
    return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap, jd: dayNumber };
  }

  // Tiết khí, Can Chi & Chiêm tinh Lịch Vạn Niên
  const TIET_KHI = [
    "Xuân Phân", "Thanh Minh", "Cốc Vũ", "Lập Hạ", "Tiểu Mãn", "Mang Chủng",
    "Hạ Chí", "Tiểu Thử", "Đại Thử", "Lập Thu", "Xử Thử", "Bạch Lộ",
    "Thu Phân", "Hàn Lộ", "Sương Giáng", "Lập Đông", "Tiểu Tuyết", "Đại Tuyết",
    "Đông Chí", "Tiểu Hàn", "Đại Hàn", "Lập Xuân", "Vũ Thủy", "Kinh Trập"
  ];
  function getSolarTerm(jd) {
    const idx = getSunLongitude(jd);
    return TIET_KHI[idx] || "Tiết Khí Thuận Hòa";
  }

  const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
  const ANIMAL_EMOJI = ['🐭 Chuột', '🐂 Trâu', '🐯 Hổ', '🐱 Mèo', '🐲 Rồng', '🐍 Rắn', '🐴 Ngựa', '🐐 Dê', '🐵 Khỉ', '🐔 Gà', '🐶 Chó', '🐷 Lợn'];
  const WEEKDAY_NAMES = ['CHỦ NHẬT', 'THỨ HAI', 'THỨ BA', 'THỨ TƯ', 'THỨ NĂM', 'THỨ SÁU', 'THỨ BẢY'];
  const MONTH_NAMES = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

  const AUSPICIOUS_HOURS = {
    0: "Tý (23-1), Sửu (1-3), Mão (5-7), Ngọ (11-13), Thân (15-17), Dậu (17-19)",
    1: "Dần (3-5), Mão (5-7), Tỵ (9-11), Thân (15-17), Tuất (19-21), Hợi (21-23)",
    2: "Tý (23-1), Sửu (1-3), Thìn (7-9), Tỵ (9-11), Mùi (13-15), Tuất (19-21)",
    3: "Tý (23-1), Dần (3-5), Mão (5-7), Ngọ (11-13), Mùi (13-15), Dậu (17-19)",
    4: "Dần (3-5), Thìn (7-9), Tỵ (9-11), Thân (15-17), Dậu (17-19), Hợi (21-23)",
    5: "Sửu (1-3), Thìn (7-9), Ngọ (11-13), Mùi (13-15), Tuất (19-21), Hợi (21-23)",
    6: "Tý (23-1), Sửu (1-3), Mão (5-7), Ngọ (11-13), Thân (15-17), Dậu (17-19)",
    7: "Dần (3-5), Mão (5-7), Tỵ (9-11), Thân (15-17), Tuất (19-21), Hợi (21-23)",
    8: "Tý (23-1), Sửu (1-3), Thìn (7-9), Tỵ (9-11), Mùi (13-15), Tuất (19-21)",
    9: "Tý (23-1), Dần (3-5), Mão (5-7), Ngọ (11-13), Mùi (13-15), Dậu (17-19)",
    10: "Dần (3-5), Thìn (7-9), Tỵ (9-11), Thân (15-17), Dậu (17-19), Hợi (21-23)",
    11: "Sửu (1-3), Thìn (7-9), Ngọ (11-13), Mùi (13-15), Tuất (19-21), Hợi (21-23)"
  };

  const TRUC_NAMES = ["Kiến", "Trừ", "Mãn", "Bình", "Định", "Chấp", "Phá", "Nguy", "Thành", "Thâu", "Khai", "Bế"];
  const TRUC_ADVICE = {
    "Kiến": "Tốt cho xuất hành, khởi công, khai trương. Kỵ đào đất, an táng.",
    "Trừ": "Tốt cho việc giải trừ điều xấu, dọn dẹp, chữa bệnh. Kỵ cưới hỏi.",
    "Mãn": "Tốt cho cầu tài, hội họp, yến tiệc, nhập học. Kỵ kiện tụng.",
    "Bình": "Tốt cho việc tu sửa, giao dịch bình ổn. Kỵ mạo hiểm.",
    "Định": "Tốt cho ký kết hợp đồng, bàn giao công việc lâu dài, hôn nhân.",
    "Chấp": "Tốt cho xây dựng, canh tác, giữ gìn tài sản. Kỵ dời chỗ ở.",
    "Phá": "Tốt cho việc phá dỡ công trình cũ, cải tạo. Kỵ việc đại sự.",
    "Nguy": "Nên cẩn trọng trong mọi việc, tu tâm dưỡng tính. Kỵ đi xa.",
    "Thành": "Đại Cát: Khai trương, xuất hành, thăng tiến, ký hợp đồng lớn.",
    "Thâu": "Tốt cho thu hồi công nợ, gặt hái, tích trữ tài chính.",
    "Khai": "Đại Cát: Mở rộng kinh doanh, khởi nghiệp, đón vận khí mới.",
    "Bế": "Tốt cho việc an nghỉ, đắp đập, bảo mật. Kỵ xuất hành xa."
  };
  function getTrucInfo(lunarMonth, chiDayIndex) {
    const chiThang = (lunarMonth + 1) % 12;
    const trucIndex = (chiDayIndex - chiThang + 12) % 12;
    const name = TRUC_NAMES[trucIndex];
    return { name, advice: TRUC_ADVICE[name] || "Mọi sự tiến triển thuận tự nhiên." };
  }

  const HOANG_DAO_DEITIES = [
    { name: "Thanh Long", isGood: true, label: "🌟 Hoàng Đạo (Đại Cát)" },
    { name: "Minh Đường", isGood: true, label: "🌟 Hoàng Đạo (Cát Khánh)" },
    { name: "Thiên Hình", isGood: false, label: "⚠️ Hắc Đạo (Cẩn Trọng)" },
    { name: "Chu Tước", isGood: false, label: "⚠️ Hắc Đạo (Tránh Tranh Chấp)" },
    { name: "Kim Quỹ", isGood: true, label: "🌟 Hoàng Đạo (Phúc Lộc)" },
    { name: "Bảo Quang", isGood: true, label: "🌟 Hoàng Đạo (Quang Minh)" },
    { name: "Bạch Hổ", isGood: false, label: "⚠️ Hắc Đạo (Kỵ Đi Xa)" },
    { name: "Ngọc Đường", isGood: true, label: "🌟 Hoàng Đạo (Công Danh)" },
    { name: "Thiên Lao", isGood: false, label: "⚠️ Hắc Đạo (Bất Lợi)" },
    { name: "Huyền Vũ", isGood: false, label: "⚠️ Hắc Đạo (Tiểu Nhân)" },
    { name: "Tư Mệnh", isGood: true, label: "🌟 Hoàng Đạo (Bình An)" },
    { name: "Câu Trận", isGood: false, label: "⚠️ Hắc Đạo (Chậm Trễ)" }
  ];
  function getDayDeity(lunarMonth, chiDayIndex) {
    const startChi = [0, 0, 2, 4, 6, 8, 10, 0, 2, 4, 6, 8, 10][lunarMonth] || 0;
    const deityIndex = (chiDayIndex - startChi + 12) % 12;
    return HOANG_DAO_DEITIES[deityIndex];
  }

  function getDirections(canDayIndex) {
    switch (canDayIndex) {
      case 0: case 5: return { hyThan: "Đông Bắc", taiThan: "Chính Nam" };
      case 1: case 6: return { hyThan: "Tây Bắc", taiThan: "Tây Nam" };
      case 2: case 7: return { hyThan: "Tây Nam", taiThan: "Chính Đông" };
      case 3: case 8: return { hyThan: "Chính Nam", taiThan: "Chính Đông" };
      case 4: case 9: return { hyThan: "Đông Nam", taiThan: "Chính Bắc" };
      default: return { hyThan: "Đông Bắc", taiThan: "Chính Nam" };
    }
  }

  const SOLAR_HOLIDAYS = {
    '1-1': { title: 'Tết Dương Lịch (New Year)', desc: 'Ngày đầu tiên của năm mới theo lịch Dương, ngày nghỉ lễ toàn quốc.' },
    '1-9': { title: 'Ngày Học Sinh - Sinh Viên VN', desc: 'Kỷ niệm ngày truyền thống học sinh, sinh viên và Hội Sinh viên Việt Nam (1950).' },
    '2-3': { title: 'Thành Lập Đảng Cộng Sản VN', desc: 'Kỷ niệm ngày thành lập Đảng Cộng sản Việt Nam quang vinh (03/02/1930).' },
    '2-14': { title: 'Lễ Tình Nhân (Valentine)', desc: 'Ngày tôn vinh tình yêu đôi lứa và gắn kết yêu thương trên toàn thế giới.' },
    '2-27': { title: 'Ngày Thầy Thuốc Việt Nam', desc: 'Tôn vinh và tri ân các y bác sĩ, cán bộ nhân viên ngành y tế.' },
    '3-8': { title: 'Quốc Tế Phụ Nữ (8/3)', desc: 'Tôn vinh vẻ đẹp, sự cống hiến và quyền bình đẳng của phụ nữ toàn cầu.' },
    '3-20': { title: 'Ngày Quốc Tế Hạnh Phúc', desc: 'Biểu trưng cho sự hài hòa, yêu thương và cân bằng cuộc sống.' },
    '3-26': { title: 'Thành Lập Đoàn TNCS Hồ Chí Minh', desc: 'Kỷ niệm ngày thành lập Đoàn TNCS Hồ Chí Minh (26/03/1931).' },
    '4-21': { title: 'Ngày Sách & Văn Hóa Đọc VN', desc: 'Tôn vinh giá trị tri thức của sách và văn hóa đọc trong cộng đồng.' },
    '4-30': { title: 'Giải Phóng Miền Nam - Thống Nhất Đất Nước', desc: 'Chiến thắng lịch sử 30/04/1975 giải phóng hoàn toàn miền Nam, non sông liền một dải.' },
    '5-1': { title: 'Quốc Tế Lao Động (1/5)', desc: 'Ngày hội biểu dương lực lượng và tinh thần đoàn kết của nhân dân lao động.' },
    '5-7': { title: 'Chiến Thắng Điện Biên Phủ', desc: 'Kỷ niệm chiến thắng lịch sử Điện Biên Phủ “lừng lẫy năm châu” (07/05/1954).' },
    '5-15': { title: 'Thành Lập Đội TNTP Hồ Chí Minh', desc: 'Kỷ niệm ngày thành lập Đội TNTP Hồ Chí Minh (15/05/1941).' },
    '5-19': { title: 'Sinh Nhật Chủ Tịch Hồ Chí Minh', desc: 'Kỷ niệm ngày sinh vị Cha già kính yêu của dân tộc Việt Nam (19/05/1890).' },
    '6-1': { title: 'Quốc Tế Thiếu Nhi (1/6)', desc: 'Ngày hội yêu thương, chăm sóc và bảo vệ trẻ em trên toàn thế giới.' },
    '6-5': { title: 'Bác Hồ Ra Đi Tìm Đường Cứu Nước', desc: 'Kỷ niệm ngày người thanh niên Nguyễn Tất Thành rời bến Nhà Rồng (05/06/1911).' },
    '6-21': { title: 'Ngày Báo Chí Cách Mạng VN', desc: 'Kỷ niệm ngày Bác Hồ xuất bản số đầu tiên của báo Thanh Niên (21/06/1925).' },
    '6-28': { title: 'Ngày Gia Đình Việt Nam', desc: 'Tôn vinh mái ấm gia đình và các giá trị văn hóa truyền thống tốt đẹp.' },
    '7-27': { title: 'Ngày Thương Binh - Liệt Sĩ', desc: 'Toàn dân tưởng nhớ và đời đời ghi ơn các anh hùng liệt sĩ đã hy sinh vì Tổ quốc.' },
    '7-28': { title: 'Thành Lập Công Đoàn Việt Nam', desc: 'Kỷ niệm ngày thành lập Tổng Liên đoàn Lao động Việt Nam (28/07/1929).' },
    '8-19': { title: 'Cách Mạng Tháng Tám & CAND', desc: 'Kỷ niệm thắng lợi Cách mạng Tháng Tám (1945) và Ngày truyền thống CAND.' },
    '9-2': { title: 'Quốc Khánh Nước CHXHCN Việt Nam', desc: 'Kỷ niệm Bác Hồ đọc Tuyên ngôn Độc lập tại Quảng trường Ba Đình (02/09/1945).' },
    '10-10': { title: 'Giải Phóng Thủ Đô Hà Nội', desc: 'Kỷ niệm ngày đoàn quân chiến thắng tiến về tiếp quản Thủ đô (10/10/1954).' },
    '10-13': { title: 'Ngày Doanh Nhân Việt Nam', desc: 'Tôn vinh đóng góp to lớn của cộng đồng doanh nhân trong xây dựng đất nước.' },
    '10-20': { title: 'Ngày Phụ Nữ Việt Nam', desc: 'Kỷ niệm ngày thành lập Hội Liên hiệp Phụ nữ Việt Nam (20/10/1930).' },
    '11-20': { title: 'Ngày Nhà Giáo Việt Nam', desc: 'Ngày hội tôn sư trọng đạo, tri ân công ơn dạy dỗ của quý thầy cô giáo.' },
    '12-6': { title: 'Ngày Cựu Chiến Binh Việt Nam', desc: 'Kỷ niệm ngày thành lập Hội Cựu chiến binh Việt Nam (06/12/1989).' },
    '12-22': { title: 'Thành Lập Quân Đội Nhân Dân VN', desc: 'Kỷ niệm ngày thành lập QĐND Việt Nam (22/12/1944) & Ngày hội Quốc phòng toàn dân.' },
    '12-24': { title: 'Đêm Lễ Giáng Sinh (Christmas Eve)', desc: 'Đêm an lành trước ngày lễ Giáng sinh, sum vầy và cầu chúc bình an.' },
    '12-25': { title: 'Lễ Giáng Sinh (Christmas Day)', desc: 'Ngày lễ kỷ niệm Chúa Giáng sinh trên toàn cầu.' }
  };

  const LUNAR_HOLIDAYS = {
    '1-1': { title: 'Mùng 1 Tết Nguyên Đán', desc: 'Thời khắc đầu năm mới Âm lịch, khởi đầu trăm sự cát tường như ý.' },
    '1-2': { title: 'Mùng 2 Tết Nguyên Đán', desc: 'Mùng hai Tết mẹ, sum vầy chúc thọ người thân.' },
    '1-3': { title: 'Mùng 3 Tết Nguyên Đán', desc: 'Mùng ba Tết thầy, tri ân ân sư khai tâm mở trí.' },
    '1-15': { title: 'Tết Nguyên Tiêu (Rằm Tháng Giêng)', desc: 'Đêm trăng tròn đầu năm: “Lễ Phật quanh năm không bằng ngày Rằm tháng Giêng”.' },
    '3-3': { title: 'Tết Hàn Thực (3/3 ÂL)', desc: 'Phong tục cúng bánh trôi, bánh chay tưởng nhớ tổ tiên nguồn cội.' },
    '3-10': { title: 'Giỗ Tổ Hùng Vương (10/3 ÂL)', desc: '“Dù ai đi ngược về xuôi / Nhớ ngày Giỗ Tổ mùng mười tháng ba”.' },
    '4-15': { title: 'Đại Lễ Phật Đản (15/4 ÂL)', desc: 'Kỷ niệm ngày Đức Phật Thích Ca Mâu Ni đản sinh cứu độ chúng sinh.' },
    '5-5': { title: 'Tết Đoan Ngọ (5/5 ÂL)', desc: 'Tết Đoan Dương, ngày diệt sâu bọ và thưởng thức hoa quả đầu mùa.' },
    '7-15': { title: 'Lễ Vu Lan Báo Hiếu (Rằm Tháng 7)', desc: 'Mùa báo hiếu tứ trọng ân công dưỡng dục của cha mẹ và xá tội vong nhân.' },
    '8-15': { title: 'Tết Trung Thu (Rằm Tháng 8)', desc: 'Tết đoàn viên, đêm hội trăng rằm phá cỗ rước đèn của thiếu nhi.' },
    '9-9': { title: 'Tết Trùng Cửu (9/9 ÂL)', desc: 'Tết thưởng ngoạn hoa cúc, cầu chúc trường thọ cho bậc cao niên.' },
    '10-15': { title: 'Tết Hạ Nguyên (Rằm Tháng 10)', desc: 'Lễ mừng cơm mới, tạ ơn trời đất một mùa màng tốt tươi ấm no.' },
    '12-23': { title: 'Tết Ông Công Ông Táo (23 Chạp)', desc: 'Tiễn Táo Quân cưỡi cá chép bay về trời tâu bày việc trần thế.' },
    '12-29': { title: 'Tất Niên Cuối Năm (Tháng thiếu)', desc: 'Mâm cơm tất niên tiễn năm cũ, nghênh đón giao thừa bình an.' },
    '12-30': { title: 'Đêm Giao Thừa (Lễ Trừ Tịch)', desc: 'Khoảnh khắc thiêng liêng chuyển giao đất trời giữa năm cũ và năm mới.' }
  };

  const CALENDAR_QUOTES = [
    "Hành trình vạn dặm luôn bắt đầu bằng một bước chân vững chãi.",
    "Mỗi buổi sáng mang đến cơ hội để bạn viết nên một trang đời rực rỡ hơn.",
    "Hạnh phúc không phải đích đến, mà là hành trình chúng ta đang đi mỗi ngày.",
    "Nụ cười là chiếc chìa khóa vạn năng mở ra những cánh cửa yêu thương.",
    "Kiên trì là bí quyết biến điều bình thường thành phi thường.",
    "Hãy sống như một bông hoa, luôn hướng về phía ánh sáng mặt trời.",
    "Mỗi người bạn gặp đều có điều đáng để bạn học hỏi và trân trọng.",
    "Thái độ tích cực sẽ biến thách thức thành những bậc thang thăng tiến.",
    "Lòng tốt là ngôn ngữ mà người điếc có thể nghe và người mù có thể thấy.",
    "Hãy đầu tư vào chính mình, đó là khoản sinh lời lớn nhất của đời người.",
    "Thành công đến từ những nỗ lực nhỏ bé được lặp đi lặp lại mỗi ngày.",
    "Bình tĩnh trước mọi biến động là cảnh giới cao nhất của trí tuệ.",
    "Hãy làm việc bằng sự tận tụy và đón nhận kết quả bằng sự khiêm nhường.",
    "Cuộc sống giống như tấm gương, bạn mỉm cười thì nó cũng sẽ mỉm cười với bạn.",
    "Đừng đếm những ngày trôi qua, hãy làm cho mỗi ngày trôi qua đều có giá trị.",
    "Sự chân thành là cầu nối bền chặt nhất giữa những trái tim.",
    "Gieo suy nghĩ gặt hành động, gieo hành động gặt thói quen, gieo thói quen gặt số phận.",
    "Hãy mở rộng lòng mình để đón nhận những điều kỳ diệu quanh bạn.",
    "Biết ơn những gì đang có là cội nguồn của sự bình an và thịnh vượng.",
    "Tương lai thuộc về những người tin vào vẻ đẹp của ước mơ.",
    "Không có áp lực thì không có kim cương, hãy kiên cường vững bước.",
    "Mỗi ngày mới là một món quà vô giá, hãy đón nhận bằng niềm hân hoan.",
    "Sự sẻ chia nhân đôi niềm vui và làm vơi đi một nửa nỗi buồn.",
    "Đích đến của sự trưởng thành là tâm an giữa dòng đời vội vã.",
    "Hãy tự hào về hành trình bạn đã đi qua và tự tin vào con đường phía trước.",
    "Một lời nói ấm áp có thể sưởi ấm cả mùa đông giá rét.",
    "Sáng tạo là cách thức bạn nhìn nhận thế giới bằng đôi mắt của sự tò mò.",
    "Đoàn kết và yêu thương là sức mạnh to lớn nhất đưa tập thể vươn xa.",
    "Hãy can đảm bước ra khỏi vùng an toàn để khám phá tiềm năng vô hạn của bạn.",
    "Giữ cho tâm hồn luôn tươi trẻ và trái tim luôn rực lửa đam mê.",
    "Chào đón ngày mới tràn đầy năng lượng, may mắn và vạn sự hanh thông!"
  ];

  function getZodiacSign(day, month) {
    const signs = [
      { name: "Ma Kết ♑", start: [12, 22], end: [1, 19] },
      { name: "Bảo Bình ♒", start: [1, 20], end: [2, 18] },
      { name: "Song Ngư ♓", start: [2, 19], end: [3, 20] },
      { name: "Bạch Dương ♈", start: [3, 21], end: [4, 19] },
      { name: "Kim Ngưu ♉", start: [4, 20], end: [5, 20] },
      { name: "Song Tử ♊", start: [5, 21], end: [6, 21] },
      { name: "Cự Giải ♋", start: [6, 22], end: [7, 22] },
      { name: "Sư Tử ♌", start: [7, 23], end: [8, 22] },
      { name: "Xử Nữ ♍", start: [8, 23], end: [9, 22] },
      { name: "Thiên Bình ♎", start: [9, 23], end: [10, 23] },
      { name: "Bọ Cạp ♏", start: [10, 24], end: [11, 21] },
      { name: "Nhân Mã ♐", start: [11, 22], end: [12, 21] }
    ];
    for (let s of signs) {
      if ((month === s.start[0] && day >= s.start[1]) || (month === s.end[0] && day <= s.end[1])) {
        return s.name;
      }
    }
    return "Ma Kết ♑";
  }

  const BDAY_AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #0284c7, #0369a1)',
    'linear-gradient(135deg, #10b981, #047857)',
    'linear-gradient(135deg, #f59e0b, #b45309)',
    'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    'linear-gradient(135deg, #ec4899, #be185d)',
    'linear-gradient(135deg, #06b6d4, #0e7490)',
    'linear-gradient(135deg, #f97316, #c2410c)'
  ];
  function getAvatarGradient(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return BDAY_AVATAR_GRADIENTS[Math.abs(hash) % BDAY_AVATAR_GRADIENTS.length];
  }

  function parseDob(dobStr) {
    if (!dobStr || typeof dobStr !== 'string') return null;
    const s = dobStr.trim();
    let match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10)
      };
    }
    match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
      return {
        year: parseInt(match[3], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[1], 10)
      };
    }
    return null;
  }

  function getGlobalMembersForCalendar() {
    let members = [];
    const raw = localStorage.getItem('sys_global_members');
    if (raw) {
      try { members = JSON.parse(raw); } catch (e) {}
    }
    if (!Array.isArray(members) || !members.length) {
      members = [
        { id: 1, name: "Đô", fullName: "Nguyễn Văn Đô", nickname: "Đô", dob: "1994-10-02", phone: "0981234561", note: "Trưởng nhóm" },
        { id: 2, name: "Đạt", fullName: "Trần Thành Đạt", nickname: "Đạt Còi", dob: "1996-10-15", phone: "0972345672", note: "Kỹ thuật" },
        { id: 3, name: "Công", fullName: "Lê Thành Công", nickname: "Công", dob: "1995-10-26", phone: "0963456783", note: "Kế toán" },
        { id: 4, name: "Hạnh", fullName: "Phạm Mỹ Hạnh", nickname: "Hạnh", dob: "1998-03-28", phone: "0914567894", note: "Thiết kế" },
        { id: 5, name: "Quyền", fullName: "Vũ Đình Quyền", nickname: "Quyền", dob: "1997-07-09", phone: "0935678905", note: "Marketing" },
        { id: 6, name: "Duy", fullName: "Hoàng Đức Duy", nickname: "Duy", dob: "1999-12-05", phone: "0906789016", note: "Phát triển" }
      ];
    }
    return members;
  }

  // Calendar State
  let calState = {
    selectedDate: new Date(),
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    mobileTab: 'bloc'
  };

  function toggleCalendar(event) {
    if (event) event.stopPropagation();
    closeAllMenus();
    if (!DOM.calendarPopover) return;
    DOM.calendarPopover.classList.toggle('show');
    if (DOM.calendarPopover.classList.contains('show')) {
      renderCalendar();
    }
  }

  function renderCalendar() {
    if (!DOM.calendarPopover) return;

    const selDate = calState.selectedDate || new Date();
    const selYear = selDate.getFullYear();
    const selMonth = selDate.getMonth();
    const selDay = selDate.getDate();
    const selWeekday = selDate.getDay();

    const viewYear = calState.viewYear;
    const viewMonth = calState.viewMonth;

    // 1. Lunar information for Selected Date
    const lunar = getLunarDate(selDay, selMonth + 1, selYear);
    const canNam = (lunar.year + 6) % 10;
    const chiNam = (lunar.year + 8) % 12;
    const canChiNam = CAN[canNam] + ' ' + CHI[chiNam] + ' ' + ANIMAL_EMOJI[chiNam];

    const canThang = (canNam * 2 + lunar.month + 1) % 10;
    const chiThang = (lunar.month + 1) % 12;
    const canChiThang = CAN[canThang] + ' ' + CHI[chiThang];

    const canNgay = (lunar.jd + 9) % 10;
    const chiNgay = (lunar.jd + 1) % 12;
    const canChiNgay = CAN[canNgay] + ' ' + CHI[chiNgay];

    const solarTerm = getSolarTerm(lunar.jd);
    const dayDeity = getDayDeity(lunar.month, chiNgay);
    const hoursAuspicious = AUSPICIOUS_HOURS[chiNgay] || '';
    const truc = getTrucInfo(lunar.month, chiNgay);
    const directions = getDirections(canNgay);

    // 2. Holidays for Selected Date
    const solarHoliday = SOLAR_HOLIDAYS[`${selMonth + 1}-${selDay}`];
    const lunarHoliday = LUNAR_HOLIDAYS[`${lunar.month}-${lunar.day}`];

    // 3. Member birthdays sync from sys_global_members
    const members = getGlobalMembersForCalendar();
    const birthdaysMap = {};
    const thisMonthBirthdays = [];
    const realNow = new Date();
    const realStartToday = new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate()).getTime();

    members.forEach(m => {
      const dob = parseDob(m.dob);
      if (!dob) return;
      const key = `${dob.month}-${dob.day}`;
      if (!birthdaysMap[key]) birthdaysMap[key] = [];
      birthdaysMap[key].push({ ...m, parsedDob: dob });

      if (dob.month === (viewMonth + 1)) {
        let bDate = new Date(realNow.getFullYear(), dob.month - 1, dob.day);
        let diff = Math.round((bDate.getTime() - realStartToday) / 86400000);
        thisMonthBirthdays.push({
          member: m,
          dob,
          diff,
          day: dob.day
        });
      }
    });

    thisMonthBirthdays.sort((a, b) => a.day - b.day);

    const selectedKey = `${selMonth + 1}-${selDay}`;
    const selectedBirthdays = birthdaysMap[selectedKey] || [];
    const quote = CALENDAR_QUOTES[(selDay - 1) % CALENDAR_QUOTES.length];

    // ==========================================
    // BUILD LEFT PANEL: TỜ LỊCH BLOC TREO TƯỜNG
    // ==========================================
    let wallBlocHtml = `
      <div class="cal-wall-panel ${calState.mobileTab === 'matrix' ? 'tab-hidden' : ''}">
        <!-- Gáy lịch Bloc Đỏ Hoàng Kim -->
        <div class="cal-bloc-head-tag">
          <span>🇻🇳</span>
          <span>LỊCH BLOC VẠN NIÊN</span>
        </div>

        <!-- Thứ & Ngày Dương Lịch Lớn -->
        <div class="cal-bloc-weekday ${selWeekday === 0 ? 'sunday' : ''}">${WEEKDAY_NAMES[selWeekday]}</div>
        <div class="cal-bloc-solar-day ${selWeekday === 0 ? 'sunday' : ''}">${String(selDay).padStart(2, '0')}</div>
        <div class="cal-bloc-solar-month">Tháng ${selMonth + 1} Năm ${selYear}</div>

        <!-- Khối Âm Lịch Sang Trọng -->
        <div class="cal-bloc-lunar-box">
          <div class="cal-lunar-title">🌙 Ngày ${lunar.day} Tháng ${lunar.month}${lunar.leap ? ' (Nhuận)' : ''} (ÂL)</div>
          <div class="cal-lunar-canchi">Năm <b>${canChiNam}</b> • Tháng <b>${canChiThang}</b></div>
          <div class="cal-lunar-canchi">Ngày <b>${canChiNgay}</b> • Trực <b>${truc.name}</b></div>
          <div class="cal-day-status-badge ${dayDeity.isGood ? 'good' : 'bad'}">${dayDeity.label}</div>
        </div>

        <!-- Giờ Hoàng Đạo -->
        <div class="cal-bloc-section">
          <div class="cal-sec-title">⏰ Giờ Hoàng Đạo Cát Tường</div>
          <div class="cal-hours-tags">
            ${hoursAuspicious.split(', ').map(h => `<span class="cal-hour-pill">${h}</span>`).join('')}
          </div>
        </div>

        <!-- Tiết Khí, Hướng & Phong Thủy -->
        <div class="cal-bloc-section">
          <div class="cal-sec-title">🌿 Tiết Khí & Hướng Xuất Hành</div>
          <div style="color:#e2e8f0; font-size:11.5px;">Tiết: <b style="color:#38bdf8;">${solarTerm}</b></div>
          <div style="color:#cbd5e1; font-size:11px; margin-top:2px;">
            Hỷ Thần: <b style="color:#fbbf24;">${directions.hyThan}</b> • Tài Thần: <b style="color:#34d399;">${directions.taiThan}</b>
          </div>
          <div style="color:#94a3b8; font-size:10.5px; margin-top:4px;">💡 <i>${truc.advice}</i></div>
        </div>

        <!-- Sự Kiện Lịch Sử / Ngày Lễ (Nếu có) -->
        ${(solarHoliday || lunarHoliday) ? `
          <div class="cal-event-card">
            <div class="cal-event-title">🚩 ${solarHoliday ? solarHoliday.title : lunarHoliday.title}</div>
            <div class="cal-event-desc">${solarHoliday ? solarHoliday.desc : lunarHoliday.desc}</div>
          </div>
        ` : ''}

        <!-- Sinh Nhật Thành Viên Highlight (Nếu ngày chọn có sinh nhật) -->
        ${selectedBirthdays.length > 0 ? `
          <div class="cal-birthday-card">
            <div class="cal-bday-badge-title">🎂 CHÚC MỪNG SINH NHẬT!</div>
            ${selectedBirthdays.map(m => {
              const age = m.parsedDob.year ? (selYear - m.parsedDob.year) : '';
              const zodiac = getZodiacSign(m.parsedDob.day, m.parsedDob.month);
              const name = m.fullName || m.name;
              const nick = m.nickname ? `(${m.nickname})` : '';
              const encodedName = encodeURIComponent(m.nickname || m.name);
              return `
                <div class="cal-bday-person">
                  <div class="cal-bday-avatar" style="background:${getAvatarGradient(m.name)};">${(m.name || 'U').charAt(0).toUpperCase()}</div>
                  <div style="flex:1; min-width:0;">
                    <div class="cal-bday-name">${escapeHtml(name)} <span style="font-weight:400; color:#fbbf24;">${escapeHtml(nick)}</span></div>
                    <div class="cal-bday-sub">${age ? `Bước sang tuổi <b>${age}</b> • ` : ''}${zodiac}</div>
                    ${m.note ? `<div style="font-size:10.5px; color:#cbd5e1;">${escapeHtml(m.note)}</div>` : ''}
                  </div>
                </div>
                <div style="display:flex; gap:6px;">
                  <button type="button" class="cal-bday-btn" onclick="copyCalendarBirthdayWish('${encodedName}', '${age || ''}', event)">
                    🎉 Sao chép lời chúc
                  </button>
                  <button type="button" class="cal-bday-btn" style="background:#0284c7;" onclick="openDanhBaFromCalendar()">
                    👥 Mở Danh Bạ
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <!-- Danh ngôn ngày mới -->
          <div class="cal-quote-box">“${quote}”</div>
        `}
      </div>
    `;

    // ==========================================
    // BUILD RIGHT PANEL: BẢNG LỊCH THÁNG TƯƠNG TÁC
    // ==========================================
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    let gridCellsHtml = '';

    // 1. Ngày tháng trước (Trailing days)
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      let prevM = viewMonth - 1;
      let prevY = viewYear;
      if (prevM < 0) { prevM = 11; prevY--; }
      const l = getLunarDate(d, prevM + 1, prevY);
      const bdayKey = `${prevM + 1}-${d}`;
      const bdayMems = birthdaysMap[bdayKey] || [];
      const hasBday = bdayMems.length > 0;
      const bdayTitle = hasBday ? `Sinh nhật: ${bdayMems.map(x => x.nickname || x.name).join(', ')}` : '';
      const isSun = (firstDayIndex - 1 - i) % 7 === 0;

      gridCellsHtml += `
        <div class="cal-cell other-month ${hasBday ? 'has-bday' : ''}" onclick="selectCalendarDate(${prevY}, ${prevM}, ${d}, event)" title="${hasBday ? '🎂 ' + bdayTitle : ''}">
          <span class="cell-solar ${isSun ? 'sunday' : ''}">${d}</span>
          <span class="cell-lunar ${l.day === 1 ? 'lunar-first' : ''}">${l.day === 1 ? `1/${l.month}` : l.day}</span>
          ${hasBday ? `<span class="cell-badge-bday">🎂</span>` : ''}
        </div>
      `;
    }

    // 2. Ngày tháng hiện tại
    for (let d = 1; d <= daysInMonth; d++) {
      const l = getLunarDate(d, viewMonth + 1, viewYear);
      const bdayKey = `${viewMonth + 1}-${d}`;
      const bdayMems = birthdaysMap[bdayKey] || [];
      const hasBday = bdayMems.length > 0;
      const bdayTitle = hasBday ? `Sinh nhật: ${bdayMems.map(x => x.nickname || x.name).join(', ')}` : '';

      const hasSolHol = !!SOLAR_HOLIDAYS[`${viewMonth + 1}-${d}`];
      const hasLunHol = !!LUNAR_HOLIDAYS[`${l.month}-${l.day}`];
      const hasEvent = hasSolHol || hasLunHol;
      const eventTitle = hasSolHol ? SOLAR_HOLIDAYS[`${viewMonth + 1}-${d}`].title : (hasLunHol ? LUNAR_HOLIDAYS[`${l.month}-${l.day}`].title : '');

      const isToday = (realNow.getFullYear() === viewYear && realNow.getMonth() === viewMonth && realNow.getDate() === d);
      const isSelected = (selYear === viewYear && selMonth === viewMonth && selDay === d);
      const cellWeekday = (firstDayIndex + d - 1) % 7;
      const isSun = cellWeekday === 0;

      gridCellsHtml += `
        <div class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasBday ? 'has-bday' : ''}" 
             onclick="selectCalendarDate(${viewYear}, ${viewMonth}, ${d}, event)" 
             title="${hasBday ? '🎂 ' + bdayTitle : (hasEvent ? '🚩 ' + eventTitle : '')}">
          <span class="cell-solar ${isSun ? 'sunday' : ''}">${d}</span>
          <span class="cell-lunar ${l.day === 1 ? 'lunar-first' : ''}">${l.day === 1 ? `1/${l.month}` : l.day}</span>
          ${hasBday ? `<span class="cell-badge-bday">🎂</span>` : ''}
          ${hasEvent && !hasBday ? `<span class="cell-badge-event"></span>` : ''}
        </div>
      `;
    }

    // 3. Ngày tháng sau (Leading days)
    const totalCells = firstDayIndex + daysInMonth;
    const nextDaysNeeded = totalCells > 35 ? (42 - totalCells) : (35 - totalCells);
    for (let d = 1; d <= nextDaysNeeded; d++) {
      let nextM = viewMonth + 1;
      let nextY = viewYear;
      if (nextM > 11) { nextM = 0; nextY++; }
      const l = getLunarDate(d, nextM + 1, nextY);
      const bdayKey = `${nextM + 1}-${d}`;
      const bdayMems = birthdaysMap[bdayKey] || [];
      const hasBday = bdayMems.length > 0;
      const bdayTitle = hasBday ? `Sinh nhật: ${bdayMems.map(x => x.nickname || x.name).join(', ')}` : '';
      const cellWeekday = (totalCells + d - 1) % 7;
      const isSun = cellWeekday === 0;

      gridCellsHtml += `
        <div class="cal-cell other-month ${hasBday ? 'has-bday' : ''}" onclick="selectCalendarDate(${nextY}, ${nextM}, ${d}, event)" title="${hasBday ? '🎂 ' + bdayTitle : ''}">
          <span class="cell-solar ${isSun ? 'sunday' : ''}">${d}</span>
          <span class="cell-lunar ${l.day === 1 ? 'lunar-first' : ''}">${l.day === 1 ? `1/${l.month}` : l.day}</span>
          ${hasBday ? `<span class="cell-badge-bday">🎂</span>` : ''}
        </div>
      `;
    }

    let matrixHtml = `
      <div class="cal-matrix-panel ${calState.mobileTab === 'bloc' ? 'tab-hidden' : ''}">
        <!-- Top Navigation Bar -->
        <div class="cal-nav-bar">
          <div class="cal-month-title">${MONTH_NAMES[viewMonth]}, ${viewYear}</div>
          <div class="cal-nav-actions">
            <button type="button" class="cal-nav-btn" onclick="navigateCalendarMonth(-1, event)" title="Tháng trước">◀</button>
            <button type="button" class="cal-today-btn" onclick="resetCalendarToToday(event)" title="Trở về hôm nay">Hôm nay</button>
            <button type="button" class="cal-nav-btn" onclick="navigateCalendarMonth(1, event)" title="Tháng sau">▶</button>
            <button type="button" class="cal-nav-btn" onclick="toggleCalendar(event)" title="Đóng lịch" style="margin-left:4px;">✕</button>
          </div>
        </div>

        <!-- 7 Cột Thứ trong tuần -->
        <div class="cal-grid-header">
          <span class="sunday">CN</span><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span>
        </div>

        <!-- Ma trận các ô ngày -->
        <div class="cal-grid-body">
          ${gridCellsHtml}
        </div>

        <!-- Danh sách Sinh Nhật trong tháng -->
        <div class="cal-month-bdays-list">
          <div class="cal-mbday-header">
            <span>🎂 Sinh nhật trong tháng ${viewMonth + 1} (${thisMonthBirthdays.length} người)</span>
            <span style="font-size:10px; color:#94a3b8; font-weight:400;">Bấm để xem lịch bloc</span>
          </div>
          ${thisMonthBirthdays.length > 0 ? `
            <div class="cal-mbday-items">
              ${thisMonthBirthdays.map(item => {
                const isSelected = selYear === viewYear && selMonth === viewMonth && selDay === item.day;
                const diffText = item.diff === 0 ? 'Hôm nay!' : (item.diff > 0 ? `Còn ${item.diff} ngày` : 'Đã qua');
                const nickOrName = item.member.nickname || item.member.name;
                return `
                  <button type="button" class="cal-mbday-chip ${isSelected ? 'active-chip' : ''}" onclick="selectCalendarDate(${viewYear}, ${viewMonth}, ${item.day}, event)">
                    🎂 ${String(item.day).padStart(2, '0')}/${viewMonth + 1} ${escapeHtml(nickOrName)} <span style="opacity:0.8; font-size:10px;">(${diffText})</span>
                  </button>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="font-size:11px; color:#94a3b8; text-align:center; padding:4px 0;">
              Tháng ${viewMonth + 1} không có sinh nhật nào • <a href="javascript:void(0)" onclick="openDanhBaFromCalendar()" style="color:#38bdf8; text-decoration:none; font-weight:600;">Mở Danh Bạ</a>
            </div>
          `}
        </div>
      </div>
    `;

    // Mobile tabs switcher
    const mobileTabsHtml = `
      <div class="cal-mobile-tabs">
        <button type="button" class="cal-mob-tab-btn ${calState.mobileTab === 'bloc' ? 'active' : ''}" onclick="switchCalendarMobileTab('bloc', event)">
          📅 Tờ Lịch Bloc Chi Tiết
        </button>
        <button type="button" class="cal-mob-tab-btn ${calState.mobileTab === 'matrix' ? 'active' : ''}" onclick="switchCalendarMobileTab('matrix', event)">
          🗓️ Lịch Tháng (${thisMonthBirthdays.length} 🎂)
        </button>
      </div>
    `;

    DOM.calendarPopover.innerHTML = mobileTabsHtml + wallBlocHtml + matrixHtml;
  }

  function selectCalendarDate(year, month, day, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (window.event) window.event.cancelBubble = true;

    calState.selectedDate = new Date(year, month, day, 12, 0, 0);
    calState.viewYear = year;
    calState.viewMonth = month;
    if (window.innerWidth <= 768) {
      calState.mobileTab = 'bloc';
    }
    renderCalendar();
    if (DOM.calendarPopover) {
      DOM.calendarPopover.classList.add('show');
    }
  }

  function navigateCalendarMonth(delta, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (window.event) window.event.cancelBubble = true;

    calState.viewMonth += delta;
    if (calState.viewMonth < 0) {
      calState.viewMonth = 11;
      calState.viewYear--;
    } else if (calState.viewMonth > 11) {
      calState.viewMonth = 0;
      calState.viewYear++;
    }
    renderCalendar();
    if (DOM.calendarPopover) {
      DOM.calendarPopover.classList.add('show');
    }
  }

  function resetCalendarToToday(event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (window.event) window.event.cancelBubble = true;

    const now = new Date();
    calState.selectedDate = now;
    calState.viewYear = now.getFullYear();
    calState.viewMonth = now.getMonth();
    renderCalendar();
    if (DOM.calendarPopover) {
      DOM.calendarPopover.classList.add('show');
    }
    showToast('📅 Đã trở về ngày hôm nay!');
  }

  function switchCalendarMobileTab(tab, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (window.event) window.event.cancelBubble = true;

    calState.mobileTab = tab;
    renderCalendar();
    if (DOM.calendarPopover) {
      DOM.calendarPopover.classList.add('show');
    }
  }

  function copyCalendarBirthdayWish(encodedName, age, event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    if (window.event) window.event.cancelBubble = true;

    const name = decodeURIComponent(encodedName);
    const ageText = age ? `tuổi ${age}` : 'tuổi mới';
    const wish = `🎉 Happy Birthday ${name}! 🎂✨ Chúc bạn ${ageText} luôn tràn đầy năng lượng, sức khỏe dồi dào, ngập tràn niềm vui và gặt hái thật nhiều thành công rực rỡ nhé! 🥳🎁`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(wish).then(() => {
        showToast(`🎉 Đã sao chép lời chúc cho ${name}!`);
      }).catch(() => {
        fallbackCopyText(wish);
        showToast(`🎉 Đã sao chép lời chúc cho ${name}!`);
      });
    } else {
      fallbackCopyText(wish);
      showToast(`🎉 Đã sao chép lời chúc cho ${name}!`);
    }
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function openDanhBaFromCalendar() {
    if (DOM.calendarPopover) DOM.calendarPopover.classList.remove('show');
    const danhBaApp = appsList.find(a => (a.url && a.url.includes('danh-ba')) || a.id === '5') || {
      id: '5',
      title: 'Danh Bạ',
      icon: '👥',
      url: 'apps/danh-ba/index.html'
    };
    openApp(danhBaApp);
  }

  function showToast(message, duration = 2500) {
    let toastEl = document.getElementById('sys-global-toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'sys-global-toast';
      toastEl.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: #ffffff;
        padding: 10px 20px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        z-index: 999999;
        opacity: 0;
        pointer-events: none;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = message;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateX(-50%) translateY(0)';
    
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(20px)';
    }, duration);
  }

  function hideToast() {
    const toastEl = document.getElementById('sys-global-toast');
    if (toastEl) {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(20px)';
    }
  }

  // --------------------------------------------------------------------------
  // 8. APPLE MENU & WALLPAPERS
  // --------------------------------------------------------------------------
  function toggleAppleMenu(event) {
    if (event) event.stopPropagation();
    closeAllMenus();
    if (DOM.appleMenu) DOM.appleMenu.classList.toggle('show');
  }

  function closeAllMenus() {
    if (DOM.appleMenu) DOM.appleMenu.classList.remove('show');
    if (DOM.calendarPopover) DOM.calendarPopover.classList.remove('show');
    closeContextMenu();
  }

  function initWallpaper() {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    const wallpaperUrl = saved || DEFAULT_WALLPAPERS[0].url;
    document.body.style.backgroundImage = `url('${wallpaperUrl}')`;
  }

  function setWallpaper(url) {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, url);
    document.body.style.backgroundImage = `url('${url}')`;
    renderWallpapersGrid();
  }

  function openWallpapersModal() {
    closeAllMenus();
    if (!DOM.wallpapersModal) return;
    DOM.wallpapersModal.classList.add('active');
    renderWallpapersGrid();
  }

  function closeWallpapersModal() {
    if (DOM.wallpapersModal) DOM.wallpapersModal.classList.remove('active');
  }

  function renderWallpapersGrid() {
    const grid = document.getElementById('wallpapers-grid');
    if (!grid) return;
    const current = localStorage.getItem(WALLPAPER_STORAGE_KEY) || DEFAULT_WALLPAPERS[0].url;

    grid.innerHTML = '';
    DEFAULT_WALLPAPERS.forEach(wp => {
      const card = document.createElement('div');
      card.className = `wallpaper-card ${wp.url === current ? 'active' : ''}`;
      card.style.backgroundImage = `url('${wp.url}')`;
      card.onclick = () => setWallpaper(wp.url);
      card.innerHTML = `<span class="wallpaper-card-name">${wp.name}</span>`;
      grid.appendChild(card);
    });
  }

  function applyCustomWallpaper() {
    const input = document.getElementById('custom-wallpaper-input');
    if (!input || !input.value.trim()) return;
    setWallpaper(input.value.trim());
    input.value = '';
    closeWallpapersModal();
  }

  function toggleFullscreen() {
    closeAllMenus();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  function openAboutModal() {
    closeAllMenus();
    if (DOM.aboutModal) DOM.aboutModal.classList.add('active');
  }

  function closeAboutModal() {
    if (DOM.aboutModal) DOM.aboutModal.classList.remove('active');
  }

  function resetDefaultApps() {
    closeAllMenus();
    if (!isAdmin) {
      alert('Chỉ Quản trị viên mới có quyền khôi phục cài đặt mặc định!');
      openAdminAuthModal();
      return;
    }
    if (confirm('Đặt lại danh sách ứng dụng về mặc định ban đầu?')) {
      appsList = [...DEFAULT_APPS];
      saveAppsToStorage();
      renderAppGrid();
      renderDockApps(); updateRunningAppIndicators();
      alert('Đã khôi phục ứng dụng mặc định!');
    }
  }

  // --------------------------------------------------------------------------
  // 9. SPOTLIGHT SEARCH (CTRL + K / SEARCH BUTTON)
  // --------------------------------------------------------------------------
  function openSpotlight() {
    closeAllMenus();
    if (!DOM.spotlightOverlay || !DOM.spotlightInput) return;
    DOM.spotlightOverlay.classList.add('active');
    DOM.spotlightInput.value = '';
    DOM.spotlightInput.focus();
    spotlightSelectedIndex = 0;
    updateSpotlightResults('');
  }

  function closeSpotlight() {
    if (DOM.spotlightOverlay) DOM.spotlightOverlay.classList.remove('active');
  }

  function safeCalculate(expr) {
    if (!/^[0-9+\-*/().\s%]+$/.test(expr)) return null;
    try {
      const fn = new Function(`'use strict'; return (${expr});`);
      const val = fn();
      if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
        return val;
      }
      return null;
    } catch {
      return null;
    }
  }

  function updateSpotlightResults(query) {
    if (!DOM.spotlightResults) return;
    const q = query.trim().toLowerCase();
    DOM.spotlightResults.innerHTML = '';
    spotlightFilteredItems = [];

    const calcResult = safeCalculate(q);
    if (calcResult !== null) {
      spotlightFilteredItems.push({
        type: 'calc',
        title: `= ${calcResult.toLocaleString('vi-VN')}`,
        desc: `Kết quả tính toán cho: ${q}`,
        icon: '🧮',
        action: () => {
          navigator.clipboard.writeText(calcResult.toString());
          alert(`Đã sao chép kết quả: ${calcResult}`);
          closeSpotlight();
        }
      });
    }

    appsList.forEach(app => {
      if (app.adminOnly && !isAdmin) return;
      if (!q || app.title.toLowerCase().includes(q) || app.url.toLowerCase().includes(q)) {
        spotlightFilteredItems.push({
          type: 'app',
          title: app.title,
          desc: `Ứng dụng: ${app.url}`,
          icon: app.icon,
          action: () => {
            closeSpotlight();
            openApp(app);
          }
        });
      }
    });

    const quickActions = [
      { id: 'admin', title: isAdmin ? 'Đăng xuất Admin' : 'Đăng nhập Quản trị viên', desc: 'Xác thực quyền Admin toàn hệ thống', icon: '🔑', action: handleAdminBadgeClick },
      { id: 'wp', title: 'Đổi hình nền macOS', desc: 'Chọn giao diện hình nền Desktop', icon: '🖼️', action: openWallpapersModal },
      { id: 'backup', title: 'Sao lưu dữ liệu (Backup JSON)', desc: 'Tải về file lưu trữ toàn bộ dữ liệu hệ thống', icon: '💾', action: backupAllData },
      { id: 'full', title: 'Chế độ toàn màn hình', desc: 'Bật/tắt Fullscreen', icon: '⛶', action: toggleFullscreen }
    ];

    quickActions.forEach(act => {
      if (!q || act.title.toLowerCase().includes(q) || act.desc.toLowerCase().includes(q)) {
        spotlightFilteredItems.push({
          type: 'action',
          title: act.title,
          desc: act.desc,
          icon: act.icon,
          action: () => {
            closeSpotlight();
            act.action();
          }
        });
      }
    });

    if (spotlightFilteredItems.length === 0) {
      DOM.spotlightResults.innerHTML = `<div style="padding:16px; text-align:center; color:#94a3b8; font-size:13px;">Không tìm thấy kết quả nào phù hợp.</div>`;
      return;
    }

    if (spotlightSelectedIndex >= spotlightFilteredItems.length) spotlightSelectedIndex = 0;

    spotlightFilteredItems.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = `spotlight-item ${idx === spotlightSelectedIndex ? 'active' : ''}`;
      el.onclick = item.action;

      el.innerHTML = `
        <div class="spotlight-item-icon">${item.icon}</div>
        <div class="spotlight-item-info">
          <div class="spotlight-item-title">${item.title}</div>
          <div class="spotlight-item-desc">${item.desc}</div>
        </div>
        ${item.type === 'calc' ? '<span class="spotlight-badge">Enter để copy</span>' : '<span class="spotlight-badge">Mở</span>'}
      `;
      DOM.spotlightResults.appendChild(el);
    });
  }

  // --------------------------------------------------------------------------
  // 10. BACKUP & RESTORE ALL LOCALSTORAGE DATA (ADMIN PROTECTED)
  // --------------------------------------------------------------------------
  function backupAllData() {
    closeAllMenus();
    const backupObj = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      backupObj[key] = localStorage.getItem(key);
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const dlAnchor = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `macos_dashboard_backup_${dateStr}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function triggerRestoreData() {
    closeAllMenus();
    if (!isAdmin) {
      alert('Tính năng khôi phục dữ liệu yêu cầu quyền Quản trị viên!');
      openAdminAuthModal();
      return;
    }
    if (DOM.fileRestoreInput) {
      DOM.fileRestoreInput.click();
    }
  }

  function handleRestoreFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (typeof data !== 'object') throw new Error('Invalid JSON');

        if (confirm('Khôi phục dữ liệu từ file này? Dữ liệu hiện tại sẽ được cập nhật.')) {
          Object.keys(data).forEach(key => {
            localStorage.setItem(key, data[key]);
          });
          alert('Khôi phục thành công! Đang tải lại hệ thống...');
          window.location.reload();
        }
      } catch (err) {
        alert('File sao lưu không hợp lệ!');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // --------------------------------------------------------------------------
  // APP ICON HELPER & ICON PICKER SYSTEM
  // --------------------------------------------------------------------------
  function formatAppIcon(icon, fallback = '🚀') {
    if (!icon) return fallback;
    const s = String(icon).trim();
    if (s.startsWith('data:image') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('assets/') || s.startsWith('./') || s.startsWith('/') || /\.(png|jpg|jpeg|svg|webp|gif)(\?.*)?$/i.test(s) || s.includes('<img')) {
      if (s.includes('<img')) return s;
      return `<img src="${s}" alt="Icon" class="app-icon-img" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    }
    return s;
  }

  const PRESET_ICONS = {
    work: ['👥', '📋', '📊', '📈', '📅', '📝', '📂', '🗄️', '✉️', '📞', '🖨️', '📎', '📌', '💻', '📱', '🏢', '🏷️', '📑'],
    finance: ['💵', '💳', '🏦', '🪙', '🧾', '🛍️', '🛒', '💰', '💎', '🏷️', '💲', '🏧', '💸', '🧧'],
    tools: ['⚙️', '🔧', '🔨', '🔒', '🔑', '🛡️', '🌐', '🔍', '⚡', '🔋', '📡', '⏰', '🧭', '🧮', '🕹️', '🔌', '💡'],
    media: ['🎨', '📷', '🖼️', '🎵', '🎬', '🎧', '🎮', '🚀', '⭐', '🔔', '🎯', '💬', '📣', '✨', '🔥', '🏆', '🎉'],
    life: ['🍱', '🍚', '☕', '🍻', '🍕', '🍔', '🍜', '🧋', '🍎', '⚽', '🚗', '✈️', '🏠', '🎁', '🩺', '💊']
  };

  window.switchIconTab = function(tabName, scope = 'desktop') {
    const tabsContainer = document.getElementById(scope === 'desktop' ? 'desktop-icon-tabs' : 'cp-icon-tabs');
    const gridContainer = document.getElementById(scope === 'desktop' ? 'desktop-icon-grid' : 'cp-icon-grid');
    if (!tabsContainer || !gridContainer) return;

    tabsContainer.querySelectorAll('.icon-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = Array.from(tabsContainer.querySelectorAll('.icon-tab-btn')).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName));
    if (activeBtn) activeBtn.classList.add('active');

    const icons = PRESET_ICONS[tabName] || PRESET_ICONS.work;
    const inputId = scope === 'desktop' ? 'app-icon-input' : 'cpAppIconInput';
    const inputEl = document.getElementById(inputId);
    const currentVal = inputEl ? inputEl.value.trim() : '';

    gridContainer.innerHTML = icons.map(ic => `
      <div class="icon-preset-item ${currentVal === ic ? 'selected' : ''}" onclick="selectPresetIcon('${ic}', '${scope}')" title="${ic}">
        ${ic}
      </div>
    `).join('');
  };

  window.selectPresetIcon = function(iconChar, scope = 'desktop') {
    const input = document.getElementById(scope === 'desktop' ? 'app-icon-input' : 'cpAppIconInput');
    if (!input) return;
    input.value = iconChar;
    updateAppIconPreview(iconChar, scope);

    const gridContainer = document.getElementById(scope === 'desktop' ? 'desktop-icon-grid' : 'cp-icon-grid');
    if (gridContainer) {
      gridContainer.querySelectorAll('.icon-preset-item').forEach(el => {
        el.classList.toggle('selected', el.innerText.trim() === iconChar);
      });
    }
  };

  window.updateAppIconPreview = function(val, scope = 'desktop') {
    const preview = document.getElementById(scope === 'desktop' ? 'app-icon-preview' : 'cp-app-icon-preview');
    const removeBtn = document.getElementById(scope === 'desktop' ? 'btn-remove-icon-img' : 'cp-btn-remove-icon-img');
    if (!preview) return;

    const trimmed = (val || '').trim();
    const isImg = trimmed.startsWith('data:image') || trimmed.startsWith('http') || trimmed.startsWith('assets/');
    if (removeBtn) removeBtn.style.display = isImg ? 'inline-block' : 'none';

    if (isImg) {
      preview.innerHTML = `<img src="${trimmed}" alt="Icon Preview" style="width:100%;height:100%;object-fit:cover;" />`;
    } else {
      preview.innerHTML = trimmed || '🚀';
    }
  };

  window.removeAppIconImage = function(scope = 'desktop') {
    const input = document.getElementById(scope === 'desktop' ? 'app-icon-input' : 'cpAppIconInput');
    if (input) input.value = '🚀';
    updateAppIconPreview('🚀', scope);
  };

  window.handleAppIconFileUpload = function(event, scope = 'desktop') {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, SVG, WebP)!');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        // Resize to 128x128 for crisp retina rendering & tiny storage footprint
        const canvas = document.createElement('canvas');
        const maxDim = 128;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/png', 0.9);
        const input = document.getElementById(scope === 'desktop' ? 'app-icon-input' : 'cpAppIconInput');
        if (input) {
          input.value = dataUrl;
          updateAppIconPreview(dataUrl, scope);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  // --------------------------------------------------------------------------
  // 11. MODAL FORM: ADD / DELETE APP (ADMIN PROTECTED)
  // --------------------------------------------------------------------------
  function openModal() {
    if (!isAdmin) {
      alert('Thao tác thêm ứng dụng yêu cầu quyền Quản trị viên!');
      openAdminAuthModal();
      return;
    }
    closeAllMenus();
    if (!DOM.appModal) return;
    const btnDelete = document.getElementById('btn-delete-app');
    if (btnDelete) btnDelete.style.display = 'none';
    if (DOM.modalAddTitle) DOM.modalAddTitle.innerText = '➕ Thêm Ứng Dụng Mới';
    if (DOM.appIdInput) DOM.appIdInput.value = '';
    if (DOM.appNameInput) DOM.appNameInput.value = '';
    if (DOM.appIconInput) DOM.appIconInput.value = '🚀';
    if (DOM.appUrlInput) DOM.appUrlInput.value = '';
    if (DOM.appAdminOnlySelect) DOM.appAdminOnlySelect.value = 'false';
    if (DOM.btnSaveApp) DOM.btnSaveApp.innerText = 'Thêm Ứng Dụng';
    updateAppIconPreview('🚀', 'desktop');
    switchIconTab('work', 'desktop');
    DOM.appModal.classList.add('active');
    setTimeout(() => DOM.appNameInput && DOM.appNameInput.focus(), 100);
  }

  function openEditAppModal(event, id) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (!isAdmin) {
      alert('Thao tác sửa ứng dụng yêu cầu quyền Quản trị viên!');
      openAdminAuthModal();
      return;
    }
    const app = appsList.find(a => String(a.id) === String(id));
    if (!app) return;

    closeAllMenus();
    if (!DOM.appModal) return;
    const btnDelete = document.getElementById('btn-delete-app');
    if (btnDelete) btnDelete.style.display = 'inline-block';
    if (DOM.modalAddTitle) DOM.modalAddTitle.innerText = '✏️ Sửa Ứng Dụng & Phân Quyền';
    if (DOM.appIdInput) DOM.appIdInput.value = app.id;
    if (DOM.appNameInput) DOM.appNameInput.value = app.title || '';
    const currentIcon = app.icon || '🚀';
    if (DOM.appIconInput) DOM.appIconInput.value = currentIcon;
    if (DOM.appUrlInput) DOM.appUrlInput.value = app.url || '';
    if (DOM.appAdminOnlySelect) DOM.appAdminOnlySelect.value = app.adminOnly ? 'true' : 'false';
    if (DOM.btnSaveApp) DOM.btnSaveApp.innerText = 'Lưu Thay Đổi';
    updateAppIconPreview(currentIcon, 'desktop');
    switchIconTab('work', 'desktop');
    DOM.appModal.classList.add('active');
    setTimeout(() => DOM.appNameInput && DOM.appNameInput.focus(), 100);
  }

  function closeModal() {
    if (DOM.appModal) DOM.appModal.classList.remove('active');
    const btnDelete = document.getElementById('btn-delete-app');
    if (btnDelete) btnDelete.style.display = 'none';
    if (DOM.appIdInput) DOM.appIdInput.value = '';
    if (DOM.appNameInput) DOM.appNameInput.value = '';
    if (DOM.appIconInput) DOM.appIconInput.value = '';
    if (DOM.appUrlInput) DOM.appUrlInput.value = '';
    if (DOM.appAdminOnlySelect) DOM.appAdminOnlySelect.value = 'false';
  }

  function saveNewApp() {
    if (!isAdmin) {
      alert('Bạn không có quyền thực hiện thao tác này!');
      return;
    }

    const id = DOM.appIdInput ? DOM.appIdInput.value : '';
    const name = DOM.appNameInput.value.trim();
    const icon = DOM.appIconInput.value.trim() || '🚀';
    const url = DOM.appUrlInput.value.trim();
    const adminOnly = DOM.appAdminOnlySelect ? (DOM.appAdminOnlySelect.value === 'true') : false;

    if (!name || !url) {
      alert('Vui lòng nhập Tên và Đường dẫn ứng dụng!');
      return;
    }

    if (id) {
      const idx = appsList.findIndex(a => a.id === id);
      if (idx !== -1) {
        appsList[idx] = {
          ...appsList[idx],
          title: name,
          icon: icon,
          url: url,
          adminOnly: adminOnly
        };
      }
    } else {
      const newApp = {
        id: Date.now().toString(),
        title: name,
        icon: icon,
        url: url,
        adminOnly: adminOnly
      };
      appsList.push(newApp);
    }

    saveAppsToStorage();
    renderAppGrid();
    renderDockApps(); updateRunningAppIndicators();
    closeModal();

    if (authChannel) {
      try {
        authChannel.postMessage({ type: 'APPS_CONFIG_CHANGED', appsList });
      } catch (e) {}
    }
  }

  function deleteApp(eventOrId, possibleId) {
    let event = null;
    let id = null;

    if (eventOrId && typeof eventOrId === 'object' && 'stopPropagation' in eventOrId) {
      event = eventOrId;
      id = possibleId;
      try { event.stopPropagation(); } catch (e) {}
    } else if (typeof eventOrId === 'string' || typeof eventOrId === 'number') {
      id = eventOrId;
    } else {
      id = possibleId;
    }

    if (!id && activeContextApp) {
      id = activeContextApp.id;
    }

    if (!isAdmin) {
      alert('Chỉ Quản trị viên mới có quyền xóa ứng dụng!');
      openAdminAuthModal('🔒 Thao tác xóa ứng dụng yêu cầu quyền Quản trị viên (Admin Mode).\nVui lòng đăng nhập Admin:');
      return;
    }

    const targetApp = appsList.find(a => String(a.id) === String(id));
    const appName = targetApp ? targetApp.title : 'ứng dụng này';

    if (confirm(`Bạn có chắc chắn muốn xóa "${appName}" khỏi màn hình chính?`)) {
      if (id && openWindows[id]) {
        closeWindow(id);
      }

      appsList = appsList.filter(app => String(app.id) !== String(id));
      saveAppsToStorage();
      renderAppGrid();
      renderDockApps();
      updateRunningAppIndicators();

      if (authChannel) {
        try {
          authChannel.postMessage({ type: 'APPS_CONFIG_CHANGED', appsList });
        } catch (e) {}
      }

      showToast(`🗑️ Đã xóa ứng dụng "${appName}" khỏi màn hình chính`, '🗑️');
    }
  }

  function handleModalDeleteApp() {
    const id = DOM.appIdInput ? DOM.appIdInput.value : '';
    if (!id) return;
    closeModal();
    deleteApp(null, id);
  }

  // --------------------------------------------------------------------------
  // 12. KEYBOARD SHORTCUTS & EVENT LISTENERS
  // --------------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (DOM.spotlightOverlay && DOM.spotlightOverlay.classList.contains('active')) {
        closeSpotlight();
      } else {
        openSpotlight();
      }
      return;
    }

    if (DOM.spotlightOverlay && DOM.spotlightOverlay.classList.contains('active')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        spotlightSelectedIndex = (spotlightSelectedIndex + 1) % Math.max(1, spotlightFilteredItems.length);
        updateSpotlightResults(DOM.spotlightInput.value);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        spotlightSelectedIndex = (spotlightSelectedIndex - 1 + spotlightFilteredItems.length) % Math.max(1, spotlightFilteredItems.length);
        updateSpotlightResults(DOM.spotlightInput.value);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (spotlightFilteredItems[spotlightSelectedIndex]) {
          spotlightFilteredItems[spotlightSelectedIndex].action();
        }
        return;
      }
      if (e.key === 'Escape') {
        closeSpotlight();
        return;
      }
    }

    if (e.key === 'Escape') {
      closeAllMenus();
      closeWallpapersModal();
      closeAboutModal();
      closeModal();
      closeAdminSetupModal();
      closeAdminAuthModal();
      closeChangeAdminPassModal();
      closeChangeMasterKeyModal();
      closeMasterKeyModal();
      if (activeWindowId) {
        minimizeWindow(activeWindowId);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      if (activeWindowId) {
        e.preventDefault();
        closeWindow(activeWindowId);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      if (activeWindowId) {
        e.preventDefault();
        minimizeWindow(activeWindowId);
      }
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#app-context-menu') && !e.target.closest('.app-item') && !e.target.closest('.dock-btn')) {
      closeContextMenu();
    }
    if (!e.target.closest('.top-bar-left') && !e.target.closest('.apple-menu-dropdown')) {
      if (DOM.appleMenu) DOM.appleMenu.classList.remove('show');
    }
    const path = (e.composedPath && e.composedPath()) || [];
    const isInsideCal = path.some(el => el && ((el.classList && el.classList.contains && el.classList.contains('calendar-popover')) || el.id === 'calendar-popover')) ||
      (e.target && e.target.closest && (e.target.closest('.calendar-popover') || e.target.closest('#calendar-popover')));
    const isClockTrigger = path.some(el => el && el.id && (el.id === 'mac-clock' || el.id === 'iosStatusTime' || el.id === 'iosCardDate')) ||
      (e.target && e.target.closest && (e.target.closest('#mac-clock') || e.target.closest('#iosStatusTime') || e.target.closest('#iosCardDate')));

    if (!isClockTrigger && !isInsideCal) {
      if (DOM.calendarPopover) DOM.calendarPopover.classList.remove('show');
    }
  });

  document.addEventListener('contextmenu', function (e) {
    // Nếu click chuột phải vào màn hình Desktop trống
    if (!e.target.closest('.app-item') &&
        !e.target.closest('.dock-btn') &&
        !e.target.closest('#app-context-menu') &&
        !e.target.closest('.mac-window') &&
        !e.target.closest('.modal-overlay') &&
        !e.target.closest('.spotlight-overlay')) {
      e.preventDefault();
      showDesktopContextMenu(e.clientX, e.clientY);
    }
  });

  // Tự động tối ưu lại kích thước cửa sổ khi xoay màn hình hoặc đổi kích thước trình duyệt
  window.addEventListener('resize', function () {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMob = vw <= 768;

    Object.values(openWindows).forEach(w => {
      if (!w || !w.el) return;
      if (w.isMaximized) return;

      if (isMob) {
        w.el.style.left = '6px';
        w.el.style.top = '6px';
        w.el.style.width = `${vw - 12}px`;
        w.el.style.height = `${Math.max(200, vh - 85)}px`;
      } else {
        let curW = parseInt(w.el.style.width) || 720;
        let curH = parseInt(w.el.style.height) || 520;
        let curL = parseInt(w.el.style.left) || 40;
        let curT = parseInt(w.el.style.top) || 40;

        if (curW > vw - 24) curW = vw - 24;
        if (curH > vh - 80) curH = vh - 80;
        if (curL + curW > vw) curL = Math.max(10, vw - curW - 10);
        if (curT + curH > vh - 70) curT = Math.max(10, vh - curH - 75);

        w.el.style.width = `${curW}px`;
        w.el.style.height = `${curH}px`;
        w.el.style.left = `${curL}px`;
        w.el.style.top = `${curT}px`;
      }
    });
  });

  // Cross-tab and Sub-App Broadcast Synchronization
  window.addEventListener('storage', function (e) {
    if (e.key === SYS_IS_ADMIN_KEY) {
      const newStatus = e.newValue === 'true';
      if (newStatus !== isAdmin) {
        isAdmin = newStatus;
        updateAdminUI();
      }
    } else if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY_V2) {
      loadApps();
    } else if (e.key === WALLPAPER_STORAGE_KEY) {
      initWallpaper();
    }
  });

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'ADMIN_STATUS_CHANGED') {
      const newStatus = !!e.data.isAdmin;
      if (newStatus !== isAdmin) {
        isAdmin = newStatus;
        window.location.reload();
      }
    }
  });

  if (authChannel) {
    authChannel.onmessage = function (e) {
      if (e.data && e.data.type === 'ADMIN_STATUS_CHANGED') {
        const newStatus = !!e.data.isAdmin;
        if (newStatus !== isAdmin) {
          isAdmin = newStatus;
          window.location.reload();
        }
      } else if (e.data && e.data.type === 'APPS_CONFIG_CHANGED') {
        loadApps();
      }
    };
  }

  // Browser Tab Title & Favicon Configuration
  function applyBrowserTabConfig() {
    try {
      const raw = localStorage.getItem('sys_browser_tab_config');
      if (!raw) return;
      const config = JSON.parse(raw);
      if (config.title) {
        document.title = config.title;
      }
      if (config.favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.getElementsByTagName('head')[0].appendChild(link);
        }
        if (config.faviconType === 'emoji' || (!config.favicon.startsWith('data:') && !config.favicon.startsWith('http') && config.favicon.length <= 4)) {
          link.href = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${config.favicon}</text></svg>`;
        } else {
          link.href = config.favicon;
        }
      }
    } catch (e) {}
  }
  applyBrowserTabConfig();

  if ('BroadcastChannel' in window) {
    try {
      const tabChannel = new BroadcastChannel('system_tab_config');
      tabChannel.onmessage = function (e) {
        if (e.data && e.data.type === 'TAB_CONFIG_CHANGED') {
          applyBrowserTabConfig();
        }
      };
    } catch (e) {}
  }

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }

  // --------------------------------------------------------------------------
  // 12C. NOTIFICATION ENGINE (THÔNG BÁO ĐẨY GÓC DƯỚI BÊN PHẢI)
  // --------------------------------------------------------------------------
  let systemNotifications = [];
  const DISMISSED_NOTIFS_KEY = 'sys_dismissed_notifications_v1';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getDismissedNotifMap() {
    try {
      const raw = localStorage.getItem(DISMISSED_NOTIFS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Dọn các mục cũ hơn 24 giờ để tự động giải phóng bộ nhớ
      const now = Date.now();
      const cleaned = {};
      for (const [k, ts] of Object.entries(parsed)) {
        if (now - ts < 24 * 3600 * 1000) {
          cleaned[k] = ts;
        }
      }
      return cleaned;
    } catch (e) {
      return {};
    }
  }

  function markNotifDismissed(id) {
    if (!id) return;
    try {
      const map = getDismissedNotifMap();
      map[id] = Date.now();
      localStorage.setItem(DISMISSED_NOTIFS_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function pushSystemNotification(notif) {
    if (!notif || !notif.title) return;
    const dismissedMap = getDismissedNotifMap();
    const notifId = notif.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Nếu người dùng đã bấm đóng thông báo này trong vòng 24h thì không hiện lại
    if (dismissedMap[notifId]) return;

    // Kiểm tra xem đã có trong danh sách đang hiện chưa (cập nhật hoặc thêm mới)
    const existingIndex = systemNotifications.findIndex(n => n.id === notifId);
    const item = {
      id: notifId,
      title: notif.title,
      message: notif.message || notif.desc || '',
      icon: notif.icon || '🔔',
      tag: notif.tag || 'Hệ Thống',
      tagClass: notif.tagClass || 'app-push',
      appUrl: notif.appUrl || '',
      btnText: notif.btnText || 'Mở Ứng Dụng',
      time: notif.time || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: notif.createdAt || Date.now()
    };

    if (existingIndex >= 0) {
      systemNotifications[existingIndex] = item;
    } else {
      systemNotifications.unshift(item);
    }

    renderSystemNotifications();
  }

  function dismissSystemNotification(id, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const cardEl = document.getElementById(`macNotifCard_${id}`);
    if (cardEl) {
      cardEl.classList.add('removing');
      setTimeout(() => {
        markNotifDismissed(id);
        systemNotifications = systemNotifications.filter(n => n.id !== id);
        renderSystemNotifications();
      }, 240);
    } else {
      markNotifDismissed(id);
      systemNotifications = systemNotifications.filter(n => n.id !== id);
      renderSystemNotifications();
    }
  }

  function clearAllSystemNotifications() {
    if (!systemNotifications.length) return;
    systemNotifications.forEach(n => markNotifDismissed(n.id));
    systemNotifications = [];
    renderSystemNotifications();
    showToast('🧹 Đã dọn sạch tất cả thông báo!');
  }

  function renderSystemNotifications() {
    const container = document.getElementById('macNotificationContainer');
    const listEl = document.getElementById('macNotifList');
    const badgeEl = document.getElementById('macNotifCountBadge');

    if (!container || !listEl) return;

    const count = systemNotifications.length;
    if (badgeEl) badgeEl.textContent = count;

    if (count === 0) {
      container.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    container.style.display = 'flex';

    listEl.innerHTML = systemNotifications.map(n => `
      <div class="mac-notif-card" id="macNotifCard_${n.id}">
        <div class="mac-notif-top">
          <div class="mac-notif-source">
            <span class="mac-notif-tag ${escapeHtml(n.tagClass)}">${escapeHtml(n.tag)}</span>
            <span class="mac-notif-time">${escapeHtml(n.time)}</span>
          </div>
          <button type="button" class="mac-notif-close-btn" onclick="dismissSystemNotification('${escapeHtml(n.id)}', event)" title="Đóng thông báo">✕</button>
        </div>
        <div class="mac-notif-body">
          <div class="mac-notif-icon-circle">${n.icon}</div>
          <div class="mac-notif-content">
            <div class="mac-notif-title">${escapeHtml(n.title)}</div>
            <div class="mac-notif-desc">${escapeHtml(n.message)}</div>
            ${n.appUrl ? `
              <button type="button" class="mac-notif-action-btn" onclick="openAppFromNotif('${escapeHtml(n.appUrl)}')">
                <span>↗</span> ${escapeHtml(n.btnText)}
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `).join('');
  }

  function openAppFromNotif(url) {
    if (!url) return;
    const cleanUrl = url.replace(/^\.\//, '');
    const targetApp = appsList.find(a => a.url === url || a.url === cleanUrl);
    if (targetApp) {
      openApp(targetApp.id);
    } else {
      // Tìm app phù hợp theo từ khóa đường dẫn
      const matched = appsList.find(a => a.url.includes('danh-ba') && cleanUrl.includes('danh-ba')) ||
                      appsList.find(a => a.url.includes('ghi-chu') && cleanUrl.includes('ghi-chu')) ||
                      appsList.find(a => a.url.includes('tien-com') && cleanUrl.includes('tien-com')) ||
                      appsList.find(a => a.url.includes('chia-bill') && cleanUrl.includes('chia-bill'));
      if (matched) {
        openApp(matched.id);
      } else {
        window.open(url, '_blank');
      }
    }
  }

  // 1. Quét sinh nhật sắp tới trong tuần từ Danh Bạ (sys_global_members)
  function scanUpcomingBirthdays() {
    try {
      let members = [];
      const raw = localStorage.getItem('sys_global_members');
      if (raw) {
        try { members = JSON.parse(raw); } catch (e) {}
      }
      if (!Array.isArray(members) || !members.length) {
        members = [
          { id: 1, name: "Thành", fullName: "Nguyễn Văn Thành", nickname: "Thành Ken", dob: "1994-05-15", phone: "0981234561", note: "Trưởng nhóm" },
          { id: 2, name: "Đạt", fullName: "Trần Thành Đạt", nickname: "Đạt Còi", dob: "1996-08-20", phone: "0972345672", note: "Kỹ thuật" },
          { id: 3, name: "Công", fullName: "Lê Thành Công", nickname: "Công", dob: "1995-11-12", phone: "0963456783", note: "Kế toán" },
          { id: 4, name: "Hạnh", fullName: "Phạm Mỹ Hạnh", nickname: "Hạnh", dob: "1998-03-28", phone: "0914567894", note: "Thiết kế" },
          { id: 5, name: "Quyền", fullName: "Vũ Đình Quyền", nickname: "Quyền", dob: "1997-07-09", phone: "0935678905", note: "Marketing" },
          { id: 6, name: "Duy", fullName: "Hoàng Đức Duy", nickname: "Duy", dob: "1999-12-05", phone: "0906789016", note: "Phát triển" }
        ];
      }

      const now = new Date();
      const currentYear = now.getFullYear();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      members.forEach(m => {
        if (!m.dob) return;
        const parts = m.dob.split('-');
        if (parts.length < 3) return;
        const bMonth = parseInt(parts[1], 10) - 1;
        const bDay = parseInt(parts[2], 10);

        if (isNaN(bMonth) || isNaN(bDay)) return;

        // Tính ngày sinh nhật trong năm hiện tại
        let bdayDate = new Date(currentYear, bMonth, bDay, 0, 0, 0, 0);
        let diffDays = Math.round((bdayDate.getTime() - startOfToday) / 86400000);

        // Nếu đã qua trong năm nay, kiểm tra đầu năm tới (cho trường hợp cuối tháng 12 sang tháng 1)
        if (diffDays < 0) {
          const nextYearBday = new Date(currentYear + 1, bMonth, bDay, 0, 0, 0, 0);
          const nextDiff = Math.round((nextYearBday.getTime() - startOfToday) / 86400000);
          if (nextDiff <= 7) {
            diffDays = nextDiff;
            bdayDate = nextYearBday;
          }
        }

        // Báo nếu sinh nhật rơi vào trong vòng 7 ngày tới (kể cả hôm nay)
        if (diffDays >= 0 && diffDays <= 7) {
          const name = m.fullName || m.name || 'Thành viên';
          const dobFormatted = `${String(bDay).padStart(2, '0')}/${String(bMonth + 1).padStart(2, '0')}`;
          let dayNotice = '';
          if (diffDays === 0) {
            dayNotice = '🎉 Hôm nay là sinh nhật!';
          } else if (diffDays === 1) {
            dayNotice = '🎂 Ngày mai là sinh nhật!';
          } else {
            dayNotice = `🎂 Còn ${diffDays} ngày nữa (${dobFormatted})`;
          }

          const notifId = `bday_${m.id}_${bdayDate.getFullYear()}_${bMonth}_${bDay}`;
          pushSystemNotification({
            id: notifId,
            title: `${dayNotice} - ${name}`,
            message: `Sinh nhật thành viên ${name} (${m.nickname ? `"${m.nickname}"` : (m.note || 'Danh bạ')}). Hãy gửi lời chúc mừng!`,
            icon: '🎂',
            tag: 'Sinh Nhật',
            tagClass: 'birthday',
            appUrl: 'apps/danh-ba/index.html?view=birthday',
            btnText: 'Mở Danh Bạ'
          });
        }
      });
    } catch (e) {
      console.warn('[Dashboard] Lỗi quét sinh nhật:', e);
    }
  }

  // 2. Quét các task sắp tới hạn hoặc quá hạn từ Ghi Chú (sticky_notes_data)
  function scanUpcomingTasks() {
    try {
      const raw = localStorage.getItem('sticky_notes_data');
      if (!raw) return;
      const notes = JSON.parse(raw);
      if (!Array.isArray(notes) || !notes.length) return;

      const now = Date.now();
      const oneDayMs = 24 * 3600 * 1000;
      const sevenDaysMs = 7 * 24 * 3600 * 1000;

      notes.forEach(note => {
        if (!note || note.status === 'done' || !note.deadline) return;

        const diffMs = note.deadline - now;
        const diffHours = diffMs / (3600 * 1000);
        const deadlineDate = new Date(note.deadline);
        const timeFormatted = deadlineDate.toLocaleString('vi-VN', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const taskText = (note.text || 'Nhiệm vụ không tên').trim();
        const shortText = taskText.length > 40 ? taskText.substring(0, 40) + '...' : taskText;

        // Quá hạn (trong vòng 7 ngày qua)
        if (diffMs < 0 && Math.abs(diffMs) <= sevenDaysMs) {
          const overdueHours = Math.abs(Math.round(diffHours));
          const overdueText = overdueHours < 24 ? `quá hạn ${overdueHours} giờ` : `quá hạn ${Math.floor(overdueHours / 24)} ngày`;
          const notifId = `task_overdue_${note.id}`;

          pushSystemNotification({
            id: notifId,
            title: `⚠️ Task quá hạn: ${shortText}`,
            message: `Hạn chót đã qua vào lúc ${timeFormatted} (${overdueText}). Vui lòng kiểm tra và xử lý ngay!`,
            icon: '⚠️',
            tag: 'Quá Hạn',
            tagClass: 'task-overdue',
            appUrl: 'apps/ghi-chu/index.html',
            btnText: 'Mở Ghi Chú'
          });
        }
        // Sắp tới hạn (trong vòng 24 giờ tới)
        else if (diffMs >= 0 && diffMs <= oneDayMs) {
          let remainText = '';
          if (diffHours < 1) {
            remainText = `chỉ còn ${Math.max(1, Math.round(diffMs / 60000))} phút`;
          } else {
            remainText = `còn khoảng ${Math.round(diffHours)} giờ`;
          }
          const notifId = `task_due_${note.id}`;

          pushSystemNotification({
            id: notifId,
            title: `⏰ Sắp tới hạn: ${shortText}`,
            message: `Hạn chót lúc ${timeFormatted} (${remainText}). Đừng quên hoàn thành nhé!`,
            icon: '⏰',
            tag: 'Sắp Hết Hạn',
            tagClass: 'task-due',
            appUrl: 'apps/ghi-chu/index.html',
            btnText: 'Mở Ghi Chú'
          });
        }
      });
    } catch (e) {
      console.warn('[Dashboard] Lỗi quét task ghi chú:', e);
    }
  }

  function scanAllProactiveNotifications() {
    scanUpcomingBirthdays();
    scanUpcomingTasks();
  }

  // 3. Lắng nghe thông báo đẩy từ các ứng dụng con qua BroadcastChannel
  if ('BroadcastChannel' in window) {
    try {
      const notifBroadcast = new BroadcastChannel('system_notifications');
      notifBroadcast.onmessage = function (e) {
        if (e.data && e.data.type === 'PUSH_NOTIFICATION' && e.data.notification) {
          pushSystemNotification(e.data.notification);
        } else if (e.data && e.data.type === 'CLEAR_ALL_NOTIFICATIONS') {
          clearAllSystemNotifications();
        }
      };
    } catch (e) {}

    // Lắng nghe cập nhật danh bạ để quét lại thông báo sinh nhật
    try {
      const memberSyncChannel = new BroadcastChannel('system_member_sync');
      memberSyncChannel.onmessage = function () {
        setTimeout(scanUpcomingBirthdays, 800);
      };
    } catch (e) {}
  }

  // Lắng nghe postMessage từ iframe (các sub-app)
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'PUSH_NOTIFICATION' && e.data.notification) {
      pushSystemNotification(e.data.notification);
    }
  });

  // Lắng nghe thay đổi storage từ tab khác
  window.addEventListener('storage', function (e) {
    if (e.key === 'sys_global_members') {
      setTimeout(scanUpcomingBirthdays, 800);
    } else if (e.key === 'sticky_notes_data') {
      setTimeout(scanUpcomingTasks, 800);
    }
  });



  // --------------------------------------------------------------------------
  // 12.1 IPHONE (IOS) DEVICE MODE & DYNAMIC ADAPTIVE ENGINE
  // --------------------------------------------------------------------------
  let deviceMode = localStorage.getItem('sys_device_mode') || 'auto'; // 'auto' | 'ios' | 'macos'

  function applyDeviceMode() {
    const isSmallScreen = window.innerWidth <= 768 || (navigator.maxTouchPoints > 1 && window.innerWidth <= 850);

    if (deviceMode === 'ios') {
      document.body.classList.add('ios-mode');
      document.body.classList.remove('force-desktop-mode');
    } else if (deviceMode === 'macos') {
      document.body.classList.remove('ios-mode');
      document.body.classList.add('force-desktop-mode');
    } else {
      // Chế độ tự động: kích hoạt iOS Mode nếu màn hình <= 768px hoặc thiết bị chạm
      document.body.classList.remove('force-desktop-mode');
      if (isSmallScreen) {
        document.body.classList.add('ios-mode');
      } else {
        document.body.classList.remove('ios-mode');
      }
    }

    // Cập nhật trạng thái các nút chuyển đổi trên Dynamic Island Quick Hub
    const btnAuto = document.getElementById('btnModeAuto');
    const btnIos = document.getElementById('btnModeIos');
    const btnMac = document.getElementById('btnModeMac');
    if (btnAuto) btnAuto.classList.toggle('active', deviceMode === 'auto');
    if (btnIos) btnIos.classList.toggle('active', deviceMode === 'ios');
    if (btnMac) btnMac.classList.toggle('active', deviceMode === 'macos');

    // Cập nhật menu hint trong Apple Menu
    const menuHint = document.getElementById('menuDeviceModeHint');
    if (menuHint) {
      if (deviceMode === 'ios') menuHint.innerText = 'iPhone 📱';
      else if (deviceMode === 'macos') menuHint.innerText = 'macOS 💻';
      else menuHint.innerText = isSmallScreen ? 'Tự động (iPhone)' : 'Tự động (macOS)';
    }

    // Tự động căn chỉnh kích thước các cửa sổ đang mở cho vừa vặn chế độ mới
    const isIosActive = document.body.classList.contains('ios-mode');
    Object.values(openWindows).forEach(winData => {
      if (winData && winData.el) {
        if (isIosActive) {
          winData.el.style.left = '0px';
          winData.el.style.top = '0px';
          winData.el.style.width = '100vw';
          winData.el.style.height = '100vh';
        } else {
          winData.el.style.left = winData.rect.left;
          winData.el.style.top = winData.rect.top;
          winData.el.style.width = winData.rect.width;
          winData.el.style.height = winData.rect.height;
        }
      }
    });
  }

  function setDeviceMode(mode) {
    if (['auto', 'ios', 'macos'].includes(mode)) {
      deviceMode = mode;
      localStorage.setItem('sys_device_mode', mode);
      applyDeviceMode();
      const labels = {
        auto: 'Tự động điều chỉnh theo màn hình thiết bị',
        ios: 'Chuyển sang giao diện iPhone (iOS Mobile) 📱',
        macos: 'Chuyển sang giao diện Desktop macOS 💻'
      };
      showToast(`📱 ${labels[mode]}`, '📱', null, null, 2500);
    }
  }

  function cycleDeviceMode() {
    closeAllMenus();
    if (deviceMode === 'auto') setDeviceMode('ios');
    else if (deviceMode === 'ios') setDeviceMode('macos');
    else setDeviceMode('auto');
  }

  function initDeviceMode() {
    applyDeviceMode();
    window.addEventListener('resize', () => {
      if (deviceMode === 'auto') {
        applyDeviceMode();
      }
    });
  }

  // --------------------------------------------------------------------------
  // 12.2 DYNAMIC ISLAND & QUICK HUB CONTROLLER
  // --------------------------------------------------------------------------
  function toggleDynamicIslandHub(event) {
    if (event) {
      if (event.target.closest('.di-expanded-hub') && !event.target.closest('.di-hub-close')) {
        return;
      }
      event.stopPropagation();
    }
    const island = document.getElementById('iosDynamicIsland');
    if (!island) return;

    const willExpand = !island.classList.contains('expanded');
    if (willExpand) {
      closeAllMenus();
      island.classList.add('expanded');
      updateDynamicIslandContent();
    } else {
      island.classList.remove('expanded');
    }
  }

  function closeDynamicIslandHub(event) {
    if (event) event.stopPropagation();
    const island = document.getElementById('iosDynamicIsland');
    if (island) island.classList.remove('expanded');
  }

  function updateDynamicIslandContent() {
    const diAdminIcon = document.getElementById('diAdminIcon');
    const diAdminVal = document.getElementById('diAdminVal');
    if (diAdminIcon) diAdminIcon.innerText = isAdmin ? '🛡️' : '👁️';
    if (diAdminVal) diAdminVal.innerText = isAdmin ? 'Admin Mode' : 'Chế độ xem';

    const diDbVal = document.getElementById('diDbVal');
    const dbText = document.getElementById('dbStatusText');
    if (diDbVal && dbText) diDbVal.innerText = dbText.innerText || 'Postgres DB';
  }

  function initDynamicIsland() {
    document.addEventListener('pointerdown', (e) => {
      const island = document.getElementById('iosDynamicIsland');
      if (island && island.classList.contains('expanded')) {
        if (!island.contains(e.target)) {
          island.classList.remove('expanded');
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // 13. EXPORT API & SAFE INITIALIZATION
  // --------------------------------------------------------------------------
  window.dashboard = {
    goHome,
    toggleEditMode,
    toggleAdminEditMode,
    openModal,
    openEditAppModal,
    closeModal,
    saveNewApp,
    deleteApp,
    openApp,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    toggleMaximize,
    focusWindow,
    reloadWindow,
    reloadApp: reloadWindow,
    toggleDockApp,
    toggleAppleMenu,
    toggleCalendar,
    renderCalendar,
    selectCalendarDate,
    navigateCalendarMonth,
    resetCalendarToToday,
    switchCalendarMobileTab,
    copyCalendarBirthdayWish,
    saveWorkspaceSession,
    restoreWorkspaceSession,
    openDanhBaFromCalendar,
    openSpotlight,
    closeSpotlight,
    openWallpapersModal,
    closeWallpapersModal,
    applyCustomWallpaper,
    toggleFullscreen,
    openControlPanel,
    openAboutModal,
    closeAboutModal,
    resetDefaultApps,
    backupAllData,
    triggerRestoreData,
    handleRestoreFile,
    handleAdminBadgeClick,
    openAdminSetupModal,
    closeAdminSetupModal,
    submitAdminSetup,
    resetSecurityToNull,
    openAdminAuthModal,
    closeAdminAuthModal,
    submitAdminAuth,
    openChangeAdminPassModal,
    closeChangeAdminPassModal,
    submitChangeAdminPass,
    openChangeMasterKeyModal,
    closeChangeMasterKeyModal,
    submitChangeMasterKey,
    downloadRescueFileKey,
    handleRescueFileUpload,
    submitMasterKeyRecoveryDirect,
    submitFileKeyRecoveryDirect,
    switchRecoveryTab,
    openForgotPasswordModal,
    closeForgotPasswordModal,
    quickResetAdminPassword,
    submitDirectPasswordReset,
    logoutAdmin,
    showAppContextMenu,
    closeContextMenu,
    handleContextAction,
    showDesktopContextMenu,
    openAppInfoModal,
    closeAppInfoModal,
    showToast,
    hideToast,
    attachAppTouchHandler,
    pushSystemNotification,
    dismissSystemNotification,
    clearAllSystemNotifications,
    scanAllProactiveNotifications,
    openAppFromNotif,
    handleModalDeleteApp,
    setDeviceMode,
    cycleDeviceMode,
    toggleDynamicIslandHub,
    closeDynamicIslandHub,
    dismissIosWindow
  };

  Object.assign(window, window.dashboard);
  window.pushSystemNotification = pushSystemNotification;
  window.dismissSystemNotification = dismissSystemNotification;
  window.clearAllSystemNotifications = clearAllSystemNotifications;
  window.openAppFromNotif = openAppFromNotif;
  window.handleModalDeleteApp = handleModalDeleteApp;
  window.deleteApp = deleteApp;
  window.setDeviceMode = setDeviceMode;
  window.cycleDeviceMode = cycleDeviceMode;
  window.toggleDynamicIslandHub = toggleDynamicIslandHub;
  window.closeDynamicIslandHub = closeDynamicIslandHub;
  window.dismissIosWindow = dismissIosWindow;

  let isInitialized = false;
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // Dọn dẹp mật khẩu hoặc master key mặc định cũ nếu còn sót lại từ phiên bản cũ
    const currentPassHash = localStorage.getItem(SYS_ADMIN_HASH_KEY);
    const currentMasterHash = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY);
    const OLD_DEFAULT_HASH = '771f25381395342eb412f8a8461ee6b69389f4f4699f116a445d414fe047e704';
    const OLD_MASTER_HASH = 'bca8b789a74423b0f5be5722cfa563607062bf6a69dfdc3e99dcf5ed16c4c51e';

    if (currentPassHash && currentPassHash === OLD_DEFAULT_HASH) {
      localStorage.removeItem(SYS_ADMIN_HASH_KEY);
      localStorage.removeItem('sys_admin_password_hash');
      localStorage.removeItem('p2p_admin_pass_hash');
    }
    if (currentMasterHash && currentMasterHash === OLD_MASTER_HASH) {
      localStorage.removeItem(SYS_MASTER_KEY_HASH_KEY);
    }

    initDeviceMode();
    initDynamicIsland();
    updateAdminUI();
    initWallpaper();
    loadApps();
    initSortable();
    initBattery();
    updateClock();
    setInterval(updateClock, 1000);

    // Chặn đóng lịch khi tương tác bên trong calendar popover
    if (DOM.calendarPopover) {
      DOM.calendarPopover.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Khôi phục lại phiên làm việc (các cửa sổ đang mở) trước khi reload/refresh
    restoreWorkspaceSession();
    window.addEventListener('beforeunload', saveWorkspaceSession);

    if (DOM.spotlightInput) {
      DOM.spotlightInput.addEventListener('input', (e) => {
        spotlightSelectedIndex = 0;
        updateSpotlightResults(e.target.value);
      });
    }

    if (!hasAdminConfigured()) {
      setTimeout(openAdminSetupModal, 400);
    }



    // Quét thông báo chủ động (Sinh nhật, Task quá hạn / sắp tới hạn)
    setTimeout(scanAllProactiveNotifications, 1200);
    setInterval(scanAllProactiveNotifications, 300000);

    checkDbConnection(false);
    setInterval(() => checkDbConnection(false), 15000);
  }

  // 17. SUPABASE DATABASE MONITORING & MODAL CONTROLS
  async function checkDbConnection(showNotification = false) {
    const badge = document.getElementById('dbStatusBadge');
    const dot = document.getElementById('dbStatusDot');
    const text = document.getElementById('dbStatusText');
    const modalTag = document.getElementById('dbModalStatusTag');
    const countEl = document.getElementById('dbKeyCountText');
    const cloudTag = document.getElementById('cloudSyncStatusBadge');
    const anonInput = document.getElementById('supabaseAnonKeyInput');
    const urlInput = document.getElementById('supabaseUrlInput');

    const cfg = window.dbStorage ? window.dbStorage.getSupabaseConfig() : { url: '', anonKey: '' };
    if (anonInput && !anonInput.value && cfg.anonKey) {
      anonInput.value = cfg.anonKey;
    }
    if (urlInput && cfg.url) {
      urlInput.value = cfg.url;
    }

    // 1. Kiểm tra nếu đang kết nối trực tiếp Supabase Cloud REST
    if (window.dbStorage && window.dbStorage.isConnected() && window.dbStorage.getSyncMode() === 'SUPABASE_REST') {
      if (badge) badge.classList.remove('offline');
      if (dot) dot.classList.remove('offline');
      if (text) text.textContent = 'Supabase 🟢';
      if (modalTag) {
        modalTag.textContent = 'Đang hoạt động (Supabase Cloud Direct)';
        modalTag.style.background = '#15803d';
        modalTag.style.color = '#dcfce7';
      }
      if (cloudTag) {
        cloudTag.textContent = '🟢 Đã kết nối Cloud';
        cloudTag.style.background = '#15803d';
        cloudTag.style.color = '#dcfce7';
      }
      if (countEl) countEl.textContent = `${localStorage.length} mục`;
      if (showNotification) showToast('✅ Kết nối trực tiếp Supabase Cloud thành công!');
      return;
    }

    // 2. Kiểm tra nếu có Node.js server (khi mở trên localhost)
    try {
      const nodeUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? window.location.origin : '';
      if (nodeUrl) {
        const res = await fetch(`${nodeUrl}/api/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.connected) {
            if (badge) badge.classList.remove('offline');
            if (dot) dot.classList.remove('offline');
            if (text) text.textContent = 'Postgres 🟢';
            if (modalTag) {
              modalTag.textContent = 'Đang hoạt động (Node Server)';
              modalTag.style.background = '#15803d';
              modalTag.style.color = '#dcfce7';
            }
            if (cloudTag) {
              cloudTag.textContent = '🟢 Qua Node.js Server';
              cloudTag.style.background = '#0284c7';
              cloudTag.style.color = '#e0f2fe';
            }
            if (countEl) countEl.textContent = `${data.totalKeys} mục`;
            if (data.tables) {
              for (const [tbl, cnt] of Object.entries(data.tables)) {
                const el = document.getElementById(`stat_${tbl}`);
                if (el) el.textContent = `${cnt} dòng`;
              }
            }
            if (showNotification) showToast('✅ Kết nối Supabase PostgreSQL thành công!');
            return;
          }
        }
      }
    } catch (e) {}

    // 3. Nếu chưa có kết nối Cloud hay Server
    const isGithub = window.location.hostname.endsWith('github.io') || window.location.protocol === 'https:';
    if (badge) badge.classList.add('offline');
    if (dot) dot.classList.add('offline');
    if (text) text.textContent = isGithub ? 'Cần Key 🟡' : 'Offline 🟡';
    if (modalTag) {
      modalTag.textContent = isGithub ? 'Chưa nhập Supabase Key' : 'Chưa bật server';
      modalTag.style.background = isGithub ? '#b45309' : '#b91c1c';
      modalTag.style.color = '#fef3c7';
    }
    if (cloudTag) {
      cloudTag.textContent = cfg.anonKey ? '🔴 Sai key hoặc lỗi mạng' : '🟡 Cần nhập `anon` key';
      cloudTag.style.background = cfg.anonKey ? '#991b1b' : '#b45309';
      cloudTag.style.color = '#fef3c7';
    }
    if (countEl) countEl.textContent = `${localStorage.length} mục (Offline Cache)`;

    if (showNotification) {
      if (isGithub && !cfg.anonKey) {
        showToast('⚠️ Bạn đang chạy trên GitHub Pages. Vui lòng nhập mã Supabase `anon` key để đồng bộ!');
      } else {
        showToast('⚠️ Chưa thể kết nối tới Supabase Cloud. Hãy kiểm tra lại key hoặc kết nối mạng.');
      }
    }

    // Đồng bộ lên Dynamic Island Quick Hub
    const diDbVal = document.getElementById('diDbVal');
    if (diDbVal && text) diDbVal.innerText = text.textContent || 'Postgres DB';
  }

  function openDbStatusModal() {
    const modal = document.getElementById('db-status-modal');
    if (modal) {
      modal.classList.add('show');
      checkDbConnection(false);
    }
  }

  function closeDbStatusModal() {
    const modal = document.getElementById('db-status-modal');
    if (modal) modal.classList.remove('show');
  }

  async function saveSupabaseCloudKey() {
    const keyInput = document.getElementById('supabaseAnonKeyInput');
    const urlInput = document.getElementById('supabaseUrlInput');
    const key = keyInput ? keyInput.value.trim() : '';
    const url = urlInput ? urlInput.value.trim() : '';

    if (!key) {
      showToast('⚠️ Vui lòng dán mã Supabase `anon` public key.');
      return;
    }

    if (url) {
      localStorage.setItem('supabase_url', url);
    }

    showToast('🔄 Đang kiểm tra kết nối với Supabase Cloud...');
    const testRes = await window.dbStorage.testSupabaseConnection(url, key);
    if (!testRes.success) {
      showToast(`❌ ${testRes.error}`);
      return;
    }

    await window.dbStorage.setSupabaseAnonKey(key);
    showToast('✅ Đã lưu cấu hình và kết nối Supabase Cloud thành công!');
    await checkDbConnection(false);
    loadApps();
  }

  async function testSupabaseCloudConnection() {
    const keyInput = document.getElementById('supabaseAnonKeyInput');
    const urlInput = document.getElementById('supabaseUrlInput');
    const key = keyInput ? keyInput.value.trim() : '';
    const url = urlInput ? urlInput.value.trim() : '';

    showToast('🔄 Đang thử gửi lệnh tới Supabase REST API...');
    const res = await window.dbStorage.testSupabaseConnection(url, key);
    if (res.success) {
      showToast(`✅ ${res.message}`);
    } else {
      showToast(`❌ Thất bại: ${res.error}`);
    }
  }

  async function refreshDbStatus(showToastMsg) {
    if (window.dbStorage) {
      await window.dbStorage.syncNow();
      loadApps();
    }
    await checkDbConnection(showToastMsg);
  }

  // Lắng nghe sự kiện đồng bộ từ db-storage.js
  window.addEventListener('db-storage-ready', (e) => {
    console.log('[Dashboard] Nhận sự kiện db-storage-ready:', e.detail);
    loadApps();
    checkDbConnection(false);
  });

  // Expose on window
  window.openDbStatusModal = openDbStatusModal;
  window.closeDbStatusModal = closeDbStatusModal;
  window.refreshDbStatus = refreshDbStatus;
  window.saveSupabaseCloudKey = saveSupabaseCloudKey;
  window.testSupabaseCloudConnection = testSupabaseCloudConnection;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
