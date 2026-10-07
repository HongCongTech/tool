/**
 * ==============================================================================
 * SYSTEM VERSION CONTROLLER & GATEKEEPER (system-version.js)
 * Phiên Bản Quản Trị Hệ Thống Tự Động • Hong Cong Tech Tool Hub
 * ==============================================================================
 * QUY TẮC ĐÁNH VERSION CHO AI & HỆ THỐNG:
 * - Major (X.0.0): Thay đổi kiến trúc lớn, cấu trúc database, thay đổi breaking.
 * - Minor (X.Y.0): Bổ sung tính năng mới, module mới, nâng cấp logic nghiệp vụ.
 * - Patch (X.Y.Z): Vá lỗi, tinh chỉnh giao diện, sửa logic nhỏ, hotfix.
 * ==============================================================================
 */

(function () {
  'use strict';

  // 1. THÔNG TIN PHIÊN BẢN CỦA MÃ NGUỒN HIỆN TẠI (BUILD VERSION)
  const CURRENT_SYSTEM_VERSION = {
    version: '2.12.0',
    buildNumber: 2026100706,
    releaseDate: '07/10/2026',
    title: 'Nâng Cấp Tiền Cơm: Tinh Gọn Thanh Chọn Ngày & Bổ Sung Bộ Lọc Lịch Sử Dài Hạn',
    description: 'Di chuyển thanh chọn ngày (Date Toolbar) xuống ngay phía trên bảng log giao dịch theo đúng ngữ cảnh sử dụng; Tinh gọn kích thước từ dạng card cồng kềnh sang thanh compact chips tinh tế chuẩn macOS/iOS; Bổ sung bộ chọn lịch HTML5 native cho phép xem lại lịch sử bất kỳ ngày nào trong quá khứ; Mở rộng tùy chọn dải ngày 14/30/60 ngày hoặc tất cả ngày từng có log; Thêm nút điều hướng nhanh lùi/tiến 1 ngày và nút quay về Hôm nay tức thì; Tối ưu zero-overlap và responsive mượt mà trên iPad và Mobile.',
    level: 'minor', // 'patch' | 'minor' | 'major'
    author: 'Hong Cong Tech (AI Pair System)'
  };

  window.SYSTEM_VERSION = CURRENT_SYSTEM_VERSION;

  const VERSION_STORAGE_KEY = 'sys_latest_app_version';
  const CRYPTO_SALT_PEPPER = 'ANTIGRAVITY_SECURE_SALT_VAULT_v3_99482';

  // 2. SO SÁNH PHIÊN BẢN (Semantic Versioning: v1.2.3)
  // Trả về: 1 nếu v1 > v2, -1 nếu v1 < v2, 0 nếu bằng nhau
  function compareSemver(v1, v2) {
    if (!v1 || !v2) return 0;
    const clean = (v) => String(v).replace(/^v/i, '').trim().split('.').map(n => parseInt(n, 10) || 0);
    const p1 = clean(v1);
    const p2 = clean(v2);
    const len = Math.max(p1.length, p2.length);

    for (let i = 0; i < len; i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  // 3. XÁC THỰC MASTER KEY & MẬT KHẨU ADMIN TRỰC TIẾP (HỖ TRỢ CẢ LOCAL VÀ CLOUD)
  async function verifyMasterKey(inputKey) {
    if (!inputKey || typeof inputKey !== 'string') return false;
    const trimmed = inputKey.trim();
    if (!trimmed) return false;

    // 3.0. Cứu hộ khẩn cấp: Master Key mặc định của hệ thống là "0"
    if (trimmed === '0') return true;

    // Tính toán hash của chuỗi nhập vào
    let saltedHash = '';
    let legacyHash = '';
    try {
      const encoder = new TextEncoder();
      const data1 = encoder.encode(trimmed + ':' + CRYPTO_SALT_PEPPER);
      const buf1 = await crypto.subtle.digest('SHA-256', data1);
      const combined = new Uint8Array(CRYPTO_SALT_PEPPER.length + buf1.byteLength);
      combined.set(encoder.encode(CRYPTO_SALT_PEPPER), 0);
      combined.set(new Uint8Array(buf1), CRYPTO_SALT_PEPPER.length);
      const buf2 = await crypto.subtle.digest('SHA-256', combined);
      saltedHash = Array.from(new Uint8Array(buf2)).map(b => b.toString(16).padStart(2, '0')).join('');

      const legacyBuf = await crypto.subtle.digest('SHA-256', encoder.encode(trimmed));
      legacyHash = Array.from(new Uint8Array(legacyBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {}

    // Danh sách các hash hợp lệ từ LocalStorage:
    const candidateHashes = [
      localStorage.getItem('sys_master_key_hash'),
      localStorage.getItem('sys_admin_pass_hash'),
      localStorage.getItem('sys_admin_password_hash'),
      localStorage.getItem('p2p_admin_pass_hash'),
      '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9' // Hash SHA-256 của "0"
    ].filter(Boolean);

    // Kiểm tra trực tiếp với candidate hashes
    for (const hash of candidateHashes) {
      if (saltedHash && saltedHash === hash) return true;
      if (legacyHash && legacyHash === hash) return true;
      if (trimmed === hash) return true;
    }

    const rawMaster = localStorage.getItem('sys_raw_master_key');
    if (rawMaster && trimmed === rawMaster) return true;
    const lunchPass = localStorage.getItem('lunch_app_password');
    if (lunchPass && trimmed === lunchPass) return true;

    // Nếu chưa khớp trong localStorage (ví dụ chạy trên trình duyệt mới hoặc vừa xóa cache):
    // Truy vấn trực tiếp từ Supabase Cloud REST
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey) {
      try {
        const queryKeys = ['sys_master_key_hash', 'sys_admin_pass_hash', 'p2p_admin_pass_hash', 'lunch_app_password'];
        const res = await fetch(`${url}/rest/v1/system_store?key=in.(${queryKeys.join(',')})&select=key,value`, {
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
        });
        if (res.ok) {
          const rows = await res.json();
          for (const row of rows) {
            const val = row.value ? String(row.value).replace(/^"|"$/g, '') : '';
            if (!val) continue;
            try { localStorage.setItem(row.key, val); } catch (e) {}

            if (saltedHash && saltedHash === val) return true;
            if (legacyHash && legacyHash === val) return true;
            if (trimmed === val) return true;
          }
        }
      } catch (err) {
        console.warn('⚠️ Lỗi truy vấn xác thực Cloud:', err);
      }
    }

    return false;
  }

  // 4. LẤY CẤU HÌNH SUPABASE ĐỂ TRUY VẤN VERSION MỚI NHẤT
  function getSupabaseConfig() {
    let url = 'https://wqzwxzwrozbpetbwbgrk.supabase.co';
    let anonKey = '';
    if (window.__SUPABASE_CONFIG__) {
      if (window.__SUPABASE_CONFIG__.url) url = window.__SUPABASE_CONFIG__.url.trim();
      if (window.__SUPABASE_CONFIG__.anonKey) anonKey = window.__SUPABASE_CONFIG__.anonKey.trim();
    }
    try {
      const u = localStorage.getItem('supabase_url');
      const k = localStorage.getItem('supabase_anon_key');
      if (u && u.trim()) url = u.trim();
      if (k && k.trim()) anonKey = k.trim();
    } catch (e) {}
    if (url.endsWith('/')) url = url.slice(0, -1);
    return { url, anonKey };
  }

  // 5. ĐỒNG BỘ VERSION MỚI NHẤT LÊN CLOUD
  async function publishCurrentVersionToCloud() {
    const { url, anonKey } = getSupabaseConfig();
    const versionPayload = {
      version: CURRENT_SYSTEM_VERSION.version,
      buildNumber: CURRENT_SYSTEM_VERSION.buildNumber,
      releaseDate: CURRENT_SYSTEM_VERSION.releaseDate,
      title: CURRENT_SYSTEM_VERSION.title,
      description: CURRENT_SYSTEM_VERSION.description,
      level: CURRENT_SYSTEM_VERSION.level,
      updated_at: new Date().toISOString()
    };

    try {
      localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(versionPayload));
    } catch (e) {}

    if (url && anonKey) {
      try {
        await fetch(`${url}/rest/v1/system_store`, {
          method: 'POST',
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            key: VERSION_STORAGE_KEY,
            value: JSON.stringify(versionPayload),
            updated_at: new Date().toISOString()
          })
        });
      } catch (err) {}
    }
  }

  // 6. KIỂM TRA PHIÊN BẢN HỆ THỐNG (GATEKEEPER)
  async function checkVersionGatekeeper() {
    let latestVersionData = null;

    // 6.0 KIỂM TRA NGỮ CẢNH: NẾU ĐANG CHẠY TRONG IFRAME CỦA TOOL HUB
    // Tool Hub mẹ (index.html) là nơi quản lý phiên bản toàn cục. Iframe con tuyệt đối không tự hiện modal chặn.
    const isInIframe = (window.self !== window.top);
    if (isInIframe) {
      try {
        if (window.parent && window.parent.SYSTEM_VERSION) {
          window.SYSTEM_VERSION = window.parent.SYSTEM_VERSION;
        }
      } catch (e) {}
      console.log('ℹ️ [System Version] Ứng dụng chạy trong Iframe của Tool Hub. Quyền kiểm soát Gatekeeper thuộc về Hub cha.');
      return;
    }

    // 6.1 Đọc từ localStorage trước
    try {
      const raw = localStorage.getItem(VERSION_STORAGE_KEY);
      if (raw) latestVersionData = JSON.parse(raw);
    } catch (e) {}

    // 6.2 Đọc cập nhật từ Supabase Cloud
    const { url, anonKey } = getSupabaseConfig();
    if (url && anonKey) {
      try {
        const res = await fetch(`${url}/rest/v1/system_store?key=eq.${VERSION_STORAGE_KEY}&select=value`, {
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
        });
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0 && rows[0].value) {
            const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
            if (parsed && parsed.version) {
              latestVersionData = parsed;
              try { localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(parsed)); } catch (e) {}
            }
          }
        }
      } catch (err) {}
    }

    // 6.3 Nếu Cloud chưa có hoặc Version hiện tại lớn hơn Version trên Cloud:
    // -> Mã nguồn máy này mới hơn, xuất bản lên Cloud làm bản chuẩn mới nhất!
    if (!latestVersionData || !latestVersionData.version || compareSemver(CURRENT_SYSTEM_VERSION.version, latestVersionData.version) > 0) {
      publishCurrentVersionToCloud();
      return;
    }

    // 6.4 Nếu Version hiện tại NHỎ HƠN Version mới nhất trên Cloud
    if (compareSemver(CURRENT_SYSTEM_VERSION.version, latestVersionData.version) < 0) {
      // TỰ ĐỘNG THỬ TẢI LẠI TRÊN NỀN VỚI THAM SỐ CACHE-BUSTER (tránh dính cache HTTP disk)
      const autoBustKey = 'sys_ver_silent_cb_' + latestVersionData.version;
      const hasTriedSilentCb = sessionStorage.getItem(autoBustKey) === 'true';
      if (!hasTriedSilentCb) {
        sessionStorage.setItem(autoBustKey, 'true');
        console.log(`🔄 [System Version] Phát hiện phiên bản mới v${latestVersionData.version}. Đang tự động làm mới mã nguồn để dọn cache...`);
        try {
          const targetUrl = new URL(window.location.href);
          targetUrl.searchParams.set('_sys_cb', Date.now());
          targetUrl.searchParams.set('sys_v', latestVersionData.version);
          window.location.replace(targetUrl.toString());
          return;
        } catch (e) {}
      }

      const bypassKey = 'sys_version_bypassed_' + latestVersionData.version;
      const isBypassed = sessionStorage.getItem(bypassKey) === 'true';

      if (!isBypassed) {
        showVersionOutdatedModal(CURRENT_SYSTEM_VERSION.version, latestVersionData);
      }
    }
  }

  // 7. GIAO DIỆN MODAL BẮT BUỘC CẬP NHẬT HOẶC NHẬP MASTER KEY (macOS Style)
  function showVersionOutdatedModal(currentVer, latestInfo) {
    if (document.getElementById('sysVersionGateModal')) return;

    const modal = document.createElement('div');
    modal.id = 'sysVersionGateModal';
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      animation: sysVersionFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    const latestVer = latestInfo.version || 'Mới nhất';
    const releaseTitle = latestInfo.title || 'Cập nhật hệ thống mới';
    const releaseDesc = latestInfo.description || 'Có phiên bản mới hơn đã được phát hành trên hệ thống.';
    const releaseDate = latestInfo.releaseDate || 'Gần đây';

    modal.innerHTML = `
      <style>
        @keyframes sysVersionFadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        .sys-ver-card {
          background: #ffffff;
          border-radius: 20px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.8);
          max-width: 500px;
          width: 100%;
          overflow: hidden;
          color: #0f172a;
        }
        @media (prefers-color-scheme: dark) {
          .sys-ver-card {
            background: #1e293b;
            color: #f8fafc;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.1);
          }
        }
      </style>
      <div class="sys-ver-card">
        <!-- Header -->
        <div style="padding: 24px 24px 16px 24px; text-align: center; border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
          <div style="width: 64px; height: 64px; margin: 0 auto 14px auto; background: linear-gradient(135deg, #f59e0b, #ef4444); border-radius: 18px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 20px -5px rgba(245, 158, 11, 0.4);">
            <i class="fa-solid fa-cloud-arrow-down" style="font-size: 28px; color: #ffffff;"></i>
          </div>
          <h2 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 6px;">Yêu Cầu Cập Nhật Phiên Bản</h2>
          <div style="font-size: 0.88rem; color: #64748b;">Hệ thống phát hiện phiên bản mã nguồn của bạn đã lỗi thời</div>
        </div>

        <!-- Body -->
        <div style="padding: 20px 24px; font-size: 0.9rem;">
          <!-- Version compare pills -->
          <div style="display: flex; gap: 10px; margin-bottom: 16px;">
            <div style="flex: 1; padding: 12px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; text-align: center;">
              <div style="font-size: 0.72rem; font-weight: 700; color: #ef4444; text-transform: uppercase;">Phiên bản bạn đang mở</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #ef4444; margin-top: 2px;">v${currentVer}</div>
            </div>
            <div style="flex: 1; padding: 12px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; text-align: center;">
              <div style="font-size: 0.72rem; font-weight: 700; color: #10b981; text-transform: uppercase;">Phiên bản mới nhất</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #10b981; margin-top: 2px;">v${latestVer}</div>
            </div>
          </div>

          <!-- Release note -->
          <div style="background: rgba(100, 116, 139, 0.07); border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; border-left: 4px solid #3b82f6;">
            <div style="font-weight: 700; font-size: 0.88rem; margin-bottom: 4px; display: flex; justify-content: space-between;">
              <span>${releaseTitle}</span>
              <span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">${releaseDate}</span>
            </div>
            <div style="font-size: 0.82rem; color: #64748b; line-height: 1.45;">${releaseDesc}</div>
          </div>

          <p style="font-size: 0.85rem; color: #64748b; line-height: 1.5; margin-bottom: 16px;">
            Để bảo toàn cấu trúc dữ liệu, chống mất mát số dư và tiếp tục sử dụng đầy đủ các tính năng mới, bạn cần cập nhật lên phiên bản mới nhất ngay.
          </p>

          <!-- Master Key bypass section (collapsible) -->
          <div id="sysVerMasterKeySection" style="display: none; margin-bottom: 16px; padding: 14px; background: rgba(245, 158, 11, 0.08); border: 1px dashed rgba(245, 158, 11, 0.4); border-radius: 12px;">
            <div style="font-size: 0.82rem; font-weight: 700; color: #d97706; margin-bottom: 8px;">
              <i class="fa-solid fa-key"></i> Xác thực Master Key để bỏ qua phiên bản này:
            </div>
            <div style="display: flex; gap: 8px;">
              <input type="password" id="sysVerMasterKeyInput" placeholder="Nhập Master Key cứu hộ..." style="flex: 1; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem; outline: none;" />
              <button id="sysVerSubmitKeyBtn" style="padding: 10px 16px; background: #d97706; color: #ffffff; border: none; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                Xác Nhận
              </button>
            </div>
            <div id="sysVerKeyError" style="font-size: 0.75rem; color: #ef4444; margin-top: 6px; display: none; font-weight: 600;"></div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div style="padding: 16px 24px 20px 24px; background: rgba(241, 245, 249, 0.5); border-top: 1px solid rgba(226, 232, 240, 0.6); display: flex; flex-direction: column; gap: 10px;">
          <button id="sysVerUpdateNowBtn" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; border-radius: 12px; font-size: 0.95rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
            <i class="fa-solid fa-rotate"></i> Cập Nhật Ngay (Tải lại phiên bản mới)
          </button>
          
          <button id="sysVerToggleKeyBtn" style="width: 100%; padding: 10px; background: transparent; color: #64748b; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 12px; font-size: 0.85rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <i class="fa-solid fa-shield-halved"></i> Nhập Master Key để tiếp tục sử dụng
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event 1: Nút cập nhật ngay -> dọn cache triệt để và reload với URL Cache-Buster
    const updateBtn = document.getElementById('sysVerUpdateNowBtn');
    if (updateBtn) {
      updateBtn.onclick = async () => {
        updateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải lại bản mới nhất...';
        updateBtn.disabled = true;

        // 1. Xóa toàn bộ CacheStorage API của trình duyệt
        if ('caches' in window) {
          try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
          } catch (e) {}
        }

        // 2. Bỏ đăng ký toàn bộ Service Worker cũ
        if ('serviceWorker' in navigator) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(reg => reg.unregister()));
          } catch (e) {}
        }

        // 3. Xóa sessionStorage
        try { sessionStorage.clear(); } catch (e) {}

        // 4. Ép trình duyệt tải mới 100% bằng cách gắn timestamp và version mới vào URL (Bypass HTTP Disk Cache)
        setTimeout(() => {
          try {
            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('_force_update', Date.now());
            if (latestVer) targetUrl.searchParams.set('sys_v', latestVer);
            window.location.replace(targetUrl.toString());
          } catch (e) {
            window.location.reload();
          }
        }, 300);
      };
    }

    // Event 2: Nút mở khung nhập Master Key
    const toggleKeyBtn = document.getElementById('sysVerToggleKeyBtn');
    const keySection = document.getElementById('sysVerMasterKeySection');
    const keyInput = document.getElementById('sysVerMasterKeyInput');
    const keyError = document.getElementById('sysVerKeyError');

    if (toggleKeyBtn && keySection) {
      toggleKeyBtn.onclick = () => {
        if (keySection.style.display === 'none') {
          keySection.style.display = 'block';
          if (keyInput) keyInput.focus();
        } else {
          keySection.style.display = 'none';
        }
      };
    }

    // Event 3: Nút xác nhận Master Key
    const submitKeyBtn = document.getElementById('sysVerSubmitKeyBtn');
    if (submitKeyBtn && keyInput) {
      const handleVerify = async () => {
        const val = keyInput.value.trim();
        if (!val) {
          keyError.textContent = 'Vui lòng nhập Master Key!';
          keyError.style.display = 'block';
          return;
        }

        submitKeyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        submitKeyBtn.disabled = true;

        const isOk = await verifyMasterKey(val);
        submitKeyBtn.disabled = false;
        submitKeyBtn.textContent = 'Xác Nhận';

        if (isOk) {
          // Lưu trạng thái bypass cho phiên làm việc hiện tại
          const bypassKey = 'sys_version_bypassed_' + latestVer;
          sessionStorage.setItem(bypassKey, 'true');
          modal.remove();
          if (typeof window.showToast === 'function') {
            window.showToast(`🔓 Đã xác thực Master Key: Tiếp tục sử dụng phiên bản v${currentVer}`);
          }
        } else {
          keyError.textContent = 'Master Key không chính xác!';
          keyError.style.display = 'block';
        }
      };

      submitKeyBtn.onclick = handleVerify;
      keyInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleVerify();
      };
    }
  }

  // 8. TỰ ĐỘNG CHẠY KHI TRANG TẢI XONG
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(checkVersionGatekeeper, 1000);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(checkVersionGatekeeper, 1000);
    });
  }

  // 9. XUẤT CÁC HÀM TIỆN ÍCH RA GLOBAL
  window.systemVersion = {
    info: CURRENT_SYSTEM_VERSION,
    compareSemver: compareSemver,
    verifyMasterKey: verifyMasterKey,
    checkUpdate: checkVersionGatekeeper,
    publishVersion: publishCurrentVersionToCloud,
    showModal: showVersionOutdatedModal
  };

  console.log(`🚀 [System Version] Đang chạy phiên bản Tool Hub: v${CURRENT_SYSTEM_VERSION.version} (${CURRENT_SYSTEM_VERSION.title})`);
})();
