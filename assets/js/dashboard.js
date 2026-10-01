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

  // Admin State
  let isAdmin = localStorage.getItem(SYS_IS_ADMIN_KEY) === 'true';
  let failedAttempts = parseInt(localStorage.getItem(SYS_FAILED_KEY) || '0');
  const authChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('system_admin_auth') : null;
  let adminPasswordResetToken = '';
  let adminOtpEmail = '';
  let adminOtpCountdownTimer = null;

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
  async function hashPassword(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
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
      if (confirm('Bạn có muốn đăng xuất khỏi Chế độ Quản trị viên (Admin Mode) không?')) {
        logoutAdmin();
      }
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
      if (recEmail) recEmail.value = localStorage.getItem(SYS_RECOVERY_EMAIL_KEY) || '';
      setTimeout(() => pass && pass.focus(), 100);
    }
  }

  function closeAdminSetupModal() {
    if (DOM.adminSetupModal) DOM.adminSetupModal.classList.remove('active');
  }

  async function submitAdminSetup() {
    const adminPass = (document.getElementById('setupAdminPass')?.value || '').trim();
    const confirmPass = (document.getElementById('setupConfirmPass')?.value || '').trim();
    const recoveryEmail = (document.getElementById('setupRecoveryEmail')?.value || '').trim();

    if (!adminPass) {
      showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập Mật khẩu Admin bạn muốn đặt!', 'warning');
      return;
    }
    if (adminPass !== confirmPass) {
      showMacAlert('Mật Khẩu Không Khớp', 'Mật khẩu Admin xác nhận không khớp!', 'error');
      return;
    }

    const hashedPass = await hashPassword(adminPass);
    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedPass);
    localStorage.setItem('sys_admin_password_hash', hashedPass);
    localStorage.setItem('p2p_admin_pass_hash', hashedPass);
    if (recoveryEmail) localStorage.setItem(SYS_RECOVERY_EMAIL_KEY, recoveryEmail);
    localStorage.setItem(SYS_FAILED_KEY, '0');
    failedAttempts = 0;

    // Ensure immediate database persistence
    try {
      if (window.SUPABASE_CLIENT) {
        window.SUPABASE_CLIENT.from('system_store').upsert({
          key: SYS_ADMIN_HASH_KEY,
          value: JSON.stringify(hashedPass),
          updated_at: new Date().toISOString()
        }).catch(() => {});
        if (recoveryEmail) {
          window.SUPABASE_CLIENT.from('system_store').upsert({
            key: SYS_RECOVERY_EMAIL_KEY,
            value: JSON.stringify(recoveryEmail),
            updated_at: new Date().toISOString()
          }).catch(() => {});
        }
      }
    } catch (e) {}

    setAdminMode(true);
    closeAdminSetupModal();
    showMacAlert('🎉 Thiết Lập Thành Công', 'Mật khẩu Admin của bạn đã được lưu thành công. Quyền Quản trị viên đã được kích hoạt.', 'success');
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

    const hashedInput = await hashPassword(passInput);
    const storedHash = localStorage.getItem(SYS_ADMIN_HASH_KEY);
    const isMatched = Boolean(storedHash && hashedInput === storedHash);

    if (isMatched) {
      failedAttempts = 0;
      localStorage.setItem(SYS_FAILED_KEY, '0');
      setAdminMode(true);
      closeAdminAuthModal();
      showMacAlert('🎉 Đăng Nhập Thành Công', 'Chế độ Quản trị viên đã được kích hoạt. Bạn hiện có toàn quyền chỉnh sửa và quản lý hệ thống.', 'success');
      showMacToast('Đã đăng nhập Quản trị viên (Admin Mode)', 'success');
    } else {
      failedAttempts++;
      showMacAlert(
        'Mật Khẩu Không Đúng',
        `Mật khẩu Admin vừa nhập không chính xác.<br><br>
         Nếu bạn quên mật khẩu, hãy dùng chức năng <b>Gửi mã OTP</b> để khôi phục.`,
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
    showMacToast('Đã chuyển về Chế độ xem (Chỉ đọc)', 'info');
  }

  function openChangeAdminPassModal() {
    closeAllMenus();
    if (!isAdmin) {
      showMacAlert('Yêu Cầu Đăng Nhập', 'Vui lòng đăng nhập Admin trước khi đổi mật khẩu!', 'warning');
      return;
    }
    if (DOM.adminChangePassModal) {
      DOM.adminChangePassModal.classList.add('active');
      const n1 = document.getElementById('newAdminPass');
      const n2 = document.getElementById('confirmAdminPass');
      if (n1) n1.value = '';
      if (n2) n2.value = '';
      setTimeout(() => n1 && n1.focus(), 150);
    }
  }

  function closeChangeAdminPassModal() {
    if (DOM.adminChangePassModal) DOM.adminChangePassModal.classList.remove('active');
  }

  async function submitChangeAdminPass() {
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

    const hashedNew = await hashPassword(newPass);
    localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
    localStorage.setItem('p2p_admin_pass_hash', hashedNew);
    localStorage.setItem('sys_admin_password_hash', hashedNew);

    // Sync to Supabase
    try {
      if (window.SUPABASE_CLIENT) {
        window.SUPABASE_CLIENT.from('system_store').upsert({
          key: SYS_ADMIN_HASH_KEY,
          value: JSON.stringify(hashedNew),
          updated_at: new Date().toISOString()
        }).catch(() => {});
      }
    } catch(e) {}

    closeChangeAdminPassModal();
    showMacAlert('🎉 Đổi Mật Khẩu Thành Công', `Mật khẩu Admin mới của bạn đã được cập nhật thành công và đồng bộ toàn hệ thống!`, 'success');
    showMacToast('Đã cập nhật mật khẩu Admin mới', 'success');
  }

  function openChangeMasterKeyModal() {
    closeAllMenus();
    if (!isAdmin) {
      alert('Vui lòng đăng nhập Admin để đổi Master Key!');
      return;
    }
    if (DOM.adminChangeMasterKeyModal) {
      DOM.adminChangeMasterKeyModal.classList.add('active');
      document.getElementById('currentAdminPassForMK').value = '';
      document.getElementById('newMasterKey').value = '';
      document.getElementById('confirmNewMasterKey').value = '';
    }
  }

  function closeChangeMasterKeyModal() {
    if (DOM.adminChangeMasterKeyModal) DOM.adminChangeMasterKeyModal.classList.remove('active');
  }

  async function submitChangeMasterKey() {
    const adminPass = document.getElementById('currentAdminPassForMK').value;
    const newMK = document.getElementById('newMasterKey').value;
    const confirmMK = document.getElementById('confirmNewMasterKey').value;

    if (!adminPass || !newMK) {
      alert('Vui lòng điền đầy đủ thông tin!');
      return;
    }
    if (newMK !== confirmMK) {
      alert('Master Key mới xác nhận không khớp!');
      return;
    }

    const hashedAdmin = await hashPassword(adminPass);
    const storedAdmin = localStorage.getItem(SYS_ADMIN_HASH_KEY);

    if (hashedAdmin !== storedAdmin) {
      alert('Mật khẩu Admin hiện tại không chính xác!');
      return;
    }

    const hashedNewMK = await hashPassword(newMK);
    localStorage.setItem(SYS_MASTER_KEY_HASH_KEY, hashedNewMK);
    alert('Đổi Master Key cứu hộ thành công!');
    closeChangeMasterKeyModal();
  }

  function openMasterKeyModal() {
    if (!DOM.masterKeyModal) return;
    DOM.masterKeyModal.classList.add('active');
    const mkInput = document.getElementById('masterKeyInput');
    const mpInput = document.getElementById('masterNewPass');
    if (mkInput) mkInput.value = '';
    if (mpInput) mpInput.value = '';
  }

  function closeMasterKeyModal() {
    if (DOM.masterKeyModal) DOM.masterKeyModal.classList.remove('active');
  }

  async function submitMasterKeyRecovery() {
    const keyVal = document.getElementById('masterKeyInput').value.trim();
    const newPass = document.getElementById('masterNewPass').value.trim();
    const storedMaster = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY);

    if (!storedMaster) {
      alert('Chưa có Master Key trong hệ thống. Vui lòng thiết lập ban đầu!');
      closeMasterKeyModal();
      openAdminSetupModal();
      return;
    }

    if (!keyVal || !newPass) {
      alert('Vui lòng nhập Master Key và Mật khẩu mới!');
      return;
    }

    const hashedKey = await hashPassword(keyVal);
    if (hashedKey === storedMaster) {
      const hashedNew = await hashPassword(newPass);
      localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
      localStorage.setItem('p2p_admin_pass_hash', hashedNew);
      failedAttempts = 0;
      localStorage.setItem(SYS_FAILED_KEY, '0');
      setAdminMode(true);
      closeMasterKeyModal();
      alert('Khôi phục hệ thống thành công! Mật khẩu Admin đã được đặt lại.');
    } else {
      alert('Master Key không chính xác!');
    }
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
  // 2.2 RECOVERY & PASSWORD MANAGEMENT WITH EMAIL OTP
  // --------------------------------------------------------------------------
  function getSupabaseAuthConfig() {
    const config = window.dbStorage?.getSupabaseConfig?.() || window.__SUPABASE_CONFIG__ || {};
    const url = String(config.url || '').trim().replace(/\/$/, '');
    const anonKey = String(config.anonKey || '').trim();
    if (!url || !anonKey) {
      throw new Error('Chưa cấu hình Supabase URL hoặc anon public key.');
    }
    return { url, anonKey };
  }

  function getRecoveryEmail() {
    let email = localStorage.getItem(SYS_RECOVERY_EMAIL_KEY) || '';
    try {
      const parsed = JSON.parse(email);
      if (typeof parsed === 'string') email = parsed;
    } catch (e) {}
    email = String(email).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  function maskEmail(email) {
    const [name, domain] = String(email).split('@');
    if (!name || !domain) return 'email cứu hộ';
    return `${name.slice(0, 2)}***@${domain}`;
  }

  async function supabaseRequest(path, body, accessToken = '') {
    const { url, anonKey } = getSupabaseAuthConfig();
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken || anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.msg || data.message || data.error_description || data.error || `Supabase HTTP ${res.status}`);
    }
    return data;
  }

  async function saveAdminPasswordWithSession(passwordHash, accessToken) {
    const { url, anonKey } = getSupabaseAuthConfig();
    const rows = [SYS_ADMIN_HASH_KEY, 'p2p_admin_pass_hash'].map(key => ({
      key,
      value: passwordHash,
      updated_at: new Date().toISOString()
    }));
    const res = await fetch(`${url}/rest/v1/system_store?on_conflict=key`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || `Không thể cập nhật mật khẩu (HTTP ${res.status})`);
    }
  }

  function openForgotPasswordModal() {
    closeAllMenus();
    if (DOM.adminAuthModal) DOM.adminAuthModal.classList.remove('active');
    if (DOM.forgotPasswordModal) {
      DOM.forgotPasswordModal.classList.add('active');
      const otp = document.getElementById('adminOtpInput');
      const d1 = document.getElementById('newAdminPassDirect');
      const d2 = document.getElementById('confirmAdminPassDirect');
      const requestStep = document.getElementById('otpRequestStep');
      const verifyStep = document.getElementById('otpVerifyStep');
      const resetStep = document.getElementById('passwordResetStep');
      const emailHint = document.getElementById('otpEmailHint');
      const timerText = document.getElementById('otpTimerText');
      const sendBtn = document.getElementById('btnSendAdminOtp');
      const resendBtn = document.getElementById('btnResendAdminOtp');
      const verifyBtn = document.getElementById('btnVerifyAdminOtp');
      adminPasswordResetToken = '';
      adminOtpEmail = '';
      stopAdminOtpCountdown();
      if (requestStep) requestStep.style.display = 'block';
      if (verifyStep) verifyStep.style.display = 'none';
      if (resetStep) resetStep.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'block';
      if (resendBtn) resendBtn.style.display = 'none';
      if (timerText) timerText.style.display = 'none';
      if (verifyBtn) verifyBtn.disabled = false;
      if (emailHint) {
        emailHint.style.display = 'block';
        emailHint.textContent = 'Đang tải email nhận OTP...';
      }
      if (otp) otp.value = '';
      if (d1) d1.value = '';
      if (d2) d2.value = '';
      loadRecoveryEmailHint();
      setTimeout(() => document.getElementById('btnSendAdminOtp')?.focus(), 150);
    }
  }

  function closeForgotPasswordModal() {
    adminPasswordResetToken = '';
    adminOtpEmail = '';
    stopAdminOtpCountdown();
    if (DOM.forgotPasswordModal) DOM.forgotPasswordModal.classList.remove('active');
  }

  function stopAdminOtpCountdown() {
    if (adminOtpCountdownTimer) {
      clearInterval(adminOtpCountdownTimer);
      adminOtpCountdownTimer = null;
    }
  }

  function formatOtpSeconds(seconds) {
    const safeSeconds = Math.max(0, seconds);
    return `00:${String(safeSeconds).padStart(2, '0')}`;
  }

  function startAdminOtpCountdown(seconds) {
    stopAdminOtpCountdown();

    let remaining = Math.max(parseInt(seconds, 10) || 60, 1);
    const timerText = document.getElementById('otpTimerText');
    const resendBtn = document.getElementById('btnResendAdminOtp');
    const verifyBtn = document.getElementById('btnVerifyAdminOtp');
    const otpInput = document.getElementById('adminOtpInput');

    if (timerText) {
      timerText.style.display = 'block';
      timerText.textContent = `Có thể gửi lại mã sau ${formatOtpSeconds(remaining)}`;
    }
    if (resendBtn) resendBtn.style.display = 'none';
    if (verifyBtn) verifyBtn.disabled = false;
    if (otpInput) otpInput.disabled = false;

    adminOtpCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (timerText) {
        timerText.textContent = remaining > 0
          ? `Có thể gửi lại mã sau ${formatOtpSeconds(remaining)}`
          : 'Bạn có thể gửi lại mã OTP mới.';
      }

      if (remaining <= 0) {
        stopAdminOtpCountdown();
        if (resendBtn) resendBtn.style.display = 'block';
        if (verifyBtn) verifyBtn.disabled = false;
        if (otpInput) otpInput.disabled = false;
      }
    }, 1000);
  }

  async function loadRecoveryEmailHint() {
    const emailHint = document.getElementById('otpEmailHint');
    if (!emailHint) return;

    try {
      await window.dbStorage?.syncNow?.();
      const email = getRecoveryEmail();
      if (!email) throw new Error('Chưa cấu hình email nhận OTP');
      emailHint.style.display = 'block';
      emailHint.textContent = `Email nhận OTP: ${maskEmail(email)}`;
    } catch (err) {
      emailHint.style.display = 'block';
      emailHint.textContent = 'Chưa cấu hình email nhận OTP';
    }
  }

  async function requestAdminOtp() {
    const btn = document.getElementById('btnSendAdminOtp');
    const resendBtn = document.getElementById('btnResendAdminOtp');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang gửi OTP...';
    }
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Đang gửi lại OTP...';
    }

    try {
      await window.dbStorage?.syncNow?.();
      const email = getRecoveryEmail();
      if (!email) throw new Error('Chưa cấu hình email cứu hộ trong phần cài đặt Admin.');

      await supabaseRequest('/auth/v1/otp', {
        email,
        create_user: true
      });
      adminOtpEmail = email;
      const maskedEmail = maskEmail(email);

      const verifyStep = document.getElementById('otpVerifyStep');
      const resetStep = document.getElementById('passwordResetStep');
      const emailHint = document.getElementById('otpEmailHint');
      const timerText = document.getElementById('otpTimerText');
      const otp = document.getElementById('adminOtpInput');
      const verifyBtn = document.getElementById('btnVerifyAdminOtp');
      if (verifyStep) verifyStep.style.display = 'block';
      if (resetStep) resetStep.style.display = 'none';
      if (btn) btn.style.display = 'none';
      if (resendBtn) resendBtn.style.display = 'none';
      if (timerText) timerText.style.display = 'block';
      if (otp) {
        otp.value = '';
        otp.disabled = false;
      }
      if (verifyBtn) verifyBtn.disabled = false;
      if (emailHint) {
        emailHint.style.display = 'block';
        emailHint.textContent = `Mã OTP đã gửi tới: ${maskedEmail}`;
      }
      startAdminOtpCountdown(60);
      showMacAlert('Đã Gửi OTP', `Mã OTP đã được Supabase gửi tới <b>${maskedEmail}</b>.`, 'success');
      if (otp) setTimeout(() => otp.focus(), 100);
    } catch (err) {
      showMacAlert('Gửi OTP Thất Bại', err.message || 'Không thể gửi OTP. Vui lòng kiểm tra Email Auth và SMTP trong Supabase.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Gửi Mã OTP';
      }
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Gửi Lại Mã OTP';
      }
    }
  }

  async function verifyAdminOtp() {
    const otp = (document.getElementById('adminOtpInput')?.value || '').trim();
    const btn = document.getElementById('btnVerifyAdminOtp');

    if (!otp) {
      return showMacAlert('Chưa Nhập OTP', 'Vui lòng nhập mã OTP đã nhận.', 'warning');
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang xác minh OTP...';
    }

    try {
      const email = adminOtpEmail || getRecoveryEmail();
      if (!email) throw new Error('Không xác định được email nhận OTP.');
      const verifyData = await supabaseRequest('/auth/v1/verify', {
        email,
        token: otp,
        type: 'email'
      });
      const session = verifyData.session || verifyData;
      const verifiedEmail = String(verifyData.user?.email || session.user?.email || '').toLowerCase();
      if (!session.access_token || (verifiedEmail && verifiedEmail !== email)) {
        throw new Error('Phiên xác minh OTP không hợp lệ.');
      }

      adminPasswordResetToken = session.access_token;
      const resetStep = document.getElementById('passwordResetStep');
      if (resetStep) resetStep.style.display = 'block';
      const passInput = document.getElementById('newAdminPassDirect');
      stopAdminOtpCountdown();
      const timerText = document.getElementById('otpTimerText');
      const resendBtn = document.getElementById('btnResendAdminOtp');
      if (timerText) {
        timerText.style.display = 'block';
        timerText.textContent = 'OTP đã được xác minh.';
      }
      if (resendBtn) resendBtn.style.display = 'none';
      showMacAlert('OTP Hợp Lệ', 'Mã OTP chính xác. Bạn có thể đặt mật khẩu Admin mới.', 'success');
      if (passInput) setTimeout(() => passInput.focus(), 100);
    } catch (err) {
      showMacAlert('Xác Minh OTP Thất Bại', err.message || 'OTP không đúng hoặc đã hết hạn.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Xác Minh OTP';
      }
    }
  }

  async function submitOtpPasswordReset() {
    const newPass = (document.getElementById('newAdminPassDirect')?.value || '').trim();
    const confirmPass = (document.getElementById('confirmAdminPassDirect')?.value || '').trim();
    const btn = document.getElementById('btnResetAdminPassword');

    if (!adminPasswordResetToken) {
      return showMacAlert('Chưa Xác Minh OTP', 'Vui lòng xác minh mã OTP chính xác trước khi đổi mật khẩu.', 'warning');
    }
    if (!newPass) {
      return showMacAlert('Chưa Nhập Mật Khẩu', 'Vui lòng nhập mật khẩu mới bạn muốn đặt.', 'warning');
    }
    if (newPass !== confirmPass) {
      return showMacAlert('Mật Khẩu Không Khớp', 'Xác nhận mật khẩu mới không trùng khớp.', 'error');
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang đổi mật khẩu...';
    }

    try {
      const hashedNew = await hashPassword(newPass);
      await saveAdminPasswordWithSession(hashedNew, adminPasswordResetToken);

      if (window.dbStorage?.setCachedValue) {
        window.dbStorage.setCachedValue(SYS_ADMIN_HASH_KEY, hashedNew);
        window.dbStorage.setCachedValue('p2p_admin_pass_hash', hashedNew);
      } else {
        localStorage.setItem(SYS_ADMIN_HASH_KEY, hashedNew);
        localStorage.setItem('p2p_admin_pass_hash', hashedNew);
      }
      localStorage.setItem('sys_admin_password_hash', hashedNew);
      localStorage.setItem(SYS_FAILED_KEY, '0');
      failedAttempts = 0;
      adminPasswordResetToken = '';
      adminOtpEmail = '';

      try {
        const bc = new BroadcastChannel('system_admin_auth');
        bc.postMessage({ type: 'ADMIN_STATUS_CHANGED', isAdmin: true });
        bc.postMessage({ type: 'ADMIN_PASS_CHANGED' });
      } catch(e) {}

      setAdminMode(true);
      closeAdminAuthModal();
      closeForgotPasswordModal();
      showMacAlert('Khôi Phục Thành Công', 'Mật khẩu Admin mới đã được cập nhật. Bạn đã được đăng nhập quyền Quản trị viên.', 'success');
      showMacToast('Đã đổi mật khẩu Admin bằng OTP', 'success');
    } catch (err) {
      showMacAlert('Khôi Phục Thất Bại', err.message || 'Không thể đổi mật khẩu.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Đổi Mật Khẩu';
      }
    }
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
  window.requestAdminOtp = requestAdminOtp;
  window.verifyAdminOtp = verifyAdminOtp;
  window.submitOtpPasswordReset = submitOtpPasswordReset;

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
          ${app.icon}
          ${app.adminOnly ? `<span class="app-lock-badge" title="Chỉ hiển thị ở Admin">🔒</span>` : ''}
        </div>
        <div class="app-label" title="${app.title}">${app.title}</div>
      `;
      DOM.appGrid.appendChild(item);
    });

    // Nút Thêm App (Admin only)
    const addBtn = document.createElement('div');
    addBtn.className = 'app-item btn-add-item admin-only';
    addBtn.onclick = openModal;
    addBtn.innerHTML = `
      <div class="app-icon btn-add-icon">➕</div>
      <div class="app-label">Thêm App</div>
    `;
    DOM.appGrid.appendChild(addBtn);
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
        <div class="ctx-app-icon">${app.icon}</div>
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
    const app = appsList.find(a => a.id === appId);
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

    if (DOM.infoAppIcon) DOM.infoAppIcon.innerText = app.icon || '📱';
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
      btn.innerHTML = app.icon;

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
    const isMobile = viewportW <= 768;

    let defaultW, defaultH, left, top;

    if (isMobile) {
      left = 6;
      top = 6;
      defaultW = viewportW - 12;
      defaultH = Math.max(220, viewportH - 85);
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
      <div class="window-header">
        <div class="traffic-btns">
          <button class="traffic-btn btn-close" title="Đóng cửa sổ (Ctrl+W)"></button>
          <button class="traffic-btn btn-minimize" title="Thu nhỏ vào Dock (Ctrl+M)"></button>
          <button class="traffic-btn btn-maximize" title="Phóng to / Khôi phục kích thước"></button>
        </div>
        
        <div class="window-title">
          <span class="window-icon">${app.icon}</span>
          <span class="window-name">${app.title}</span>
        </div>

        <div class="window-actions">
          <button class="btn-window-action btn-external" title="Mở trong tab mới">↗️</button>
          <button class="btn-window-action btn-reload" title="Tải lại ứng dụng">🔄</button>
        </div>
      </div>

      <div class="window-body">
        <div class="iframe-shield"></div>
        <iframe src="${app.url}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" title="${app.title}"></iframe>
      </div>

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

    // Sự kiện nút Traffic lights
    btnClose.onclick = (e) => { e.stopPropagation(); closeWindow(app.id); };
    btnMinimize.onclick = (e) => { e.stopPropagation(); minimizeWindow(app.id); };
    btnMaximize.onclick = (e) => { e.stopPropagation(); toggleMaximize(app.id); };
    btnReload.onclick = (e) => { e.stopPropagation(); reloadWindow(app.id); };
    if (btnExternal) {
      btnExternal.onclick = (e) => { e.stopPropagation(); window.open(app.url, '_blank'); };
    }

    // Nhấp đúp vào Header để phóng to / thu gọn
    headerEl.ondblclick = (e) => {
      if (e.target.closest('.traffic-btn') || e.target.closest('.btn-window-action')) return;
      toggleMaximize(app.id);
    };

    // Nhấp chuột vào cửa sổ để kích hoạt (Focus)
    winEl.onpointerdown = () => focusWindow(app.id);

    // Kéo di chuyển cửa sổ
    setupWindowDrag(winEl, winData, headerEl);

    // Kéo thay đổi kích thước 8 hướng
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
    const all = Object.values(openWindows);
    if (all.length === 0) return;

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
  }

  // --------------------------------------------------------------------------
  // 7. TOP BAR: REAL BATTERY, CLOCK & CALENDAR
  // --------------------------------------------------------------------------
  function initBattery() {
    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        function update() {
          const level = Math.round(battery.level * 100);
          const icon = battery.charging ? '⚡' : '🔋';
          if (DOM.battery) DOM.battery.innerText = `${icon} ${level}%`;
        }
        update();
        battery.addEventListener('levelchange', update);
        battery.addEventListener('chargingchange', update);
      }).catch(() => {
        if (DOM.battery) DOM.battery.innerText = '🔋 100%';
      });
    } else {
      if (DOM.battery) DOM.battery.innerText = '🔋 100%';
    }
  }

  function updateClock() {
    if (!DOM.clock) return;
    const now = new Date();
    const options = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    DOM.clock.innerText = now.toLocaleDateString('vi-VN', options);
  }

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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    const daysHeader = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    let html = `
      <div class="cal-header">
        <span>${monthNames[month]}, ${year}</span>
        <span style="font-size:12px; color:#94a3b8;">Hôm nay: ${today}/${month + 1}</span>
      </div>
      <div class="cal-grid">
    `;

    daysHeader.forEach(d => {
      html += `<div class="cal-day-header">${d}</div>`;
    });

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      html += `<div class="cal-day other-month">${daysInPrevMonth - i}</div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today ? 'today' : '';
      html += `<div class="cal-day ${isToday}">${d}</div>`;
    }

    html += `</div>`;
    DOM.calendarPopover.innerHTML = html;
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
    if (DOM.modalAddTitle) DOM.modalAddTitle.innerText = '➕ Thêm Ứng Dụng Mới';
    if (DOM.appIdInput) DOM.appIdInput.value = '';
    if (DOM.appNameInput) DOM.appNameInput.value = '';
    if (DOM.appIconInput) DOM.appIconInput.value = '';
    if (DOM.appUrlInput) DOM.appUrlInput.value = '';
    if (DOM.appAdminOnlySelect) DOM.appAdminOnlySelect.value = 'false';
    if (DOM.btnSaveApp) DOM.btnSaveApp.innerText = 'Thêm Ứng Dụng';
    DOM.appModal.classList.add('active');
    setTimeout(() => DOM.appNameInput && DOM.appNameInput.focus(), 100);
  }

  function openEditAppModal(event, id) {
    if (event) event.stopPropagation();
    if (!isAdmin) {
      alert('Thao tác sửa ứng dụng yêu cầu quyền Quản trị viên!');
      openAdminAuthModal();
      return;
    }
    const app = appsList.find(a => a.id === id);
    if (!app) return;

    closeAllMenus();
    if (!DOM.appModal) return;
    if (DOM.modalAddTitle) DOM.modalAddTitle.innerText = '✏️ Sửa Ứng Dụng & Phân Quyền';
    if (DOM.appIdInput) DOM.appIdInput.value = app.id;
    if (DOM.appNameInput) DOM.appNameInput.value = app.title || '';
    if (DOM.appIconInput) DOM.appIconInput.value = app.icon || '';
    if (DOM.appUrlInput) DOM.appUrlInput.value = app.url || '';
    if (DOM.appAdminOnlySelect) DOM.appAdminOnlySelect.value = app.adminOnly ? 'true' : 'false';
    if (DOM.btnSaveApp) DOM.btnSaveApp.innerText = 'Lưu Thay Đổi';
    DOM.appModal.classList.add('active');
    setTimeout(() => DOM.appNameInput && DOM.appNameInput.focus(), 100);
  }

  function closeModal() {
    if (DOM.appModal) DOM.appModal.classList.remove('active');
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

  function deleteApp(event, id) {
    event.stopPropagation();
    if (!isAdmin) {
      alert('Chỉ Quản trị viên mới có quyền xóa ứng dụng!');
      openAdminAuthModal();
      return;
    }
    if (confirm('Bạn có chắc chắn muốn xóa ứng dụng này khỏi màn hình chính?')) {
      appsList = appsList.filter(app => app.id !== id);
      saveAppsToStorage();
      renderAppGrid();
      renderDockApps(); updateRunningAppIndicators();
    }
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
    if (!e.target.closest('#mac-clock') && !e.target.closest('.calendar-popover')) {
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
        updateAdminUI();
      }
    }
  });

  if (authChannel) {
    authChannel.onmessage = function (e) {
      if (e.data && e.data.type === 'ADMIN_STATUS_CHANGED') {
        const newStatus = !!e.data.isAdmin;
        if (newStatus !== isAdmin) {
          isAdmin = newStatus;
          updateAdminUI();
        }
      } else if (e.data && e.data.type === 'APPS_CONFIG_CHANGED') {
        loadApps();
      }
    };
  }

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
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
    attachAppTouchHandler
  };

  Object.assign(window, window.dashboard);

  let isInitialized = false;
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // Tự động xóa sạch mật khẩu và master key mặc định cũ về null để người dùng tự đặt lại
    const currentPassHash = localStorage.getItem(SYS_ADMIN_HASH_KEY);
    const currentMasterHash = localStorage.getItem(SYS_MASTER_KEY_HASH_KEY);
    const OLD_DEFAULT_HASH = '771f25381395342eb412f8a8461ee6b69389f4f4699f116a445d414fe047e704';
    const OLD_MASTER_HASH = 'bca8b789a74423b0f5be5722cfa563607062bf6a69dfdc3e99dcf5ed16c4c51e';

    if ((currentPassHash && currentPassHash === OLD_DEFAULT_HASH) || (currentMasterHash && currentMasterHash === OLD_MASTER_HASH)) {
      localStorage.removeItem(SYS_ADMIN_HASH_KEY);
      localStorage.removeItem(SYS_MASTER_KEY_HASH_KEY);
      localStorage.removeItem('p2p_admin_pass_hash');
      localStorage.removeItem('p2p_admin_pass');
      localStorage.removeItem(SYS_IS_ADMIN_KEY);
      localStorage.removeItem(SYS_FAILED_KEY);
      isAdmin = false;
    }

    updateAdminUI();
    initWallpaper();
    loadApps();
    initSortable();
    initBattery();
    updateClock();
    setInterval(updateClock, 1000);

    if (DOM.spotlightInput) {
      DOM.spotlightInput.addEventListener('input', (e) => {
        spotlightSelectedIndex = 0;
        updateSpotlightResults(e.target.value);
      });
    }

    if (!hasAdminConfigured()) {
      setTimeout(openAdminSetupModal, 400);
    }

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
