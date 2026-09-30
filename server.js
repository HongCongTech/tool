/**
 * Web Application & Supabase Database Server
 * Connects directly to Supabase PostgreSQL and handles all persistent storage.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const DatabaseClient = require('./db');
const RelationalManager = require('./relational');

// 1. Load Environment Configuration (.env)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

// Prevent server crash on unhandled socket errors or client aborts
process.on('uncaughtException', (err) => {
  console.error('[Server UncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server UnhandledRejection]', reason);
});

loadEnv();

const DB_CONFIG = {
  host: process.env.host || 'db.wqzwxzwrozbpetbwbgrk.supabase.co',
  port: parseInt(process.env.db_port || process.env.port || '5432', 10),
  user: process.env.user || 'postgres',
  password: process.env.password || '@Aa010001010046',
  database: process.env.database || 'postgres'
};

const PORT = parseInt(process.env.SERVER_PORT || process.env.WEB_PORT || '3000', 10);
const db = new DatabaseClient(DB_CONFIG);
const relationalManager = new RelationalManager(db);
const otpStore = new Map();
const resetTokenStore = new Map();

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Seed default data if database store is clean
async function seedDefaultData() {
  try {
    const res = await db.query('SELECT COUNT(*) as count FROM public.system_store;');
    const count = parseInt(res.rows[0].count, 10);
    if (count === 0) {
      console.log('[DB] Seeding initial defaults into public.system_store...');

      const defaultApps = [
        { id: '1', title: 'Chia Bill', icon: '🍻', url: 'apps/chia-bill/index.html', adminOnly: false },
        { id: '2', title: 'Tính Tiền Cơm', icon: '🍚', url: 'apps/tien-com/index.html', adminOnly: false },
        { id: '3', title: 'Lãi Suất', icon: '💵', url: 'apps/lai-suat/index.html', adminOnly: false },
        { id: '4', title: 'Ghi Chú', icon: '📝', url: 'apps/ghi-chu/index.html', adminOnly: false },
        { id: 'control-panel', title: 'Cài Đặt', icon: '⚙️', url: 'apps/control-panel/index.html', adminOnly: true }
      ];

      const defaultChiaBillMembers = [
        { id: 1, name: "Đô", fullName: "Nguyễn Văn Đô", nickname: "Đô", balance: 285000, dob: "1994-05-10", phone: "0987111222", bankId: "MB", accountNo: "0987111222", accountName: "NGUYEN VAN DO", note: "Thủ quỹ" },
        { id: 2, name: "Đạt", fullName: "Trần Thành Đạt", nickname: "Đạt", balance: 212000, dob: "1996-09-18", phone: "0976222333", bankId: "VCB", accountNo: "1023456789", accountName: "TRAN THANH DAT", note: "Thành viên" },
        { id: 3, name: "Công", fullName: "Lê Thành Công", nickname: "Công", balance: 685000, dob: "1993-12-05", phone: "0965333444", bankId: "TCB", accountNo: "1903334445", accountName: "LE THANH CONG", note: "Thành viên" },
        { id: 4, name: "Hạnh", fullName: "Phạm Hồng Hạnh", nickname: "Hạnh", balance: 0, dob: "1998-03-22", phone: "0944555666", bankId: "ACB", accountNo: "246813579", accountName: "PHAM HONG HANH", note: "Kế toán" },
        { id: 5, name: "Quyền", fullName: "Vũ Thế Quyền", nickname: "Quyền", balance: -225000, dob: "1995-07-14", phone: "0933777888", bankId: "VPB", accountNo: "9876543210", accountName: "VU THE QUYEN", note: "Thành viên" },
        { id: 6, name: "Duy", fullName: "Hoàng Anh Duy", nickname: "Duy", balance: 0, dob: "1997-11-28", phone: "0912888999", bankId: "BIDV", accountNo: "5678901234", accountName: "HOANG ANH DUY", note: "Thành viên" }
      ];

      const initialSeeds = {
        'mac_dashboard_apps_v3': defaultApps,
        'nhau_members': defaultChiaBillMembers,
        'sys_is_admin': 'false',
        'sys_recovery_email': 'admin@hethong.com'
      };

      for (const [k, v] of Object.entries(initialSeeds)) {
        const valStr = JSON.stringify(v).replace(/'/g, "''");
        await db.query(`INSERT INTO public.system_store(key, value) VALUES('${k}', '${valStr}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);
      }
      console.log('[DB] Seeding completed.');
    }
  } catch (err) {
    console.error('[DB] Seed error:', err.message);
  }
}

// Request Helper to Parse JSON Body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 20 * 1024 * 1024) { // 20MB limit
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function envValue(name, fallback = '') {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return 'configured email';
  return `${name.slice(0, 2)}***@${domain}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function generateOtp() {
  const length = Math.min(Math.max(parseInt(envValue('OTP_LENGTH', '6'), 10) || 6, 4), 8);
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

function getOtpExpiryMs() {
  const minutes = Math.min(Math.max(parseInt(envValue('OTP_EXPIRES_MINUTES', '1'), 10) || 1, 1), 60);
  return minutes * 60 * 1000;
}

async function getRecoveryEmail(requestedEmail) {
  try {
    const cfg = await db.query('SELECT recovery_email FROM public.system_config WHERE id = 1 LIMIT 1;');
    if (cfg.rows[0]?.recovery_email && isValidEmail(cfg.rows[0].recovery_email)) {
      return cfg.rows[0].recovery_email.trim().toLowerCase();
    }
  } catch (e) {}

  try {
    const q = await db.query("SELECT value FROM public.system_store WHERE key = 'sys_recovery_email' LIMIT 1;");
    if (q.rows[0]?.value) {
      const parsed = JSON.parse(q.rows[0].value);
      if (isValidEmail(parsed)) return parsed.trim().toLowerCase();
    }
  } catch (e) {}

  const fallback = envValue('ADMIN_RECOVERY_EMAIL');
  return isValidEmail(fallback) ? fallback.toLowerCase() : '';
}

function createSmtpClient(socket) {
  let buffer = '';
  const readResponse = () => new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3}\s/.test(last)) {
        socket.off('data', onData);
        const response = buffer;
        buffer = '';
        resolve(response);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });

  const command = async (line, expectedCodes = ['250']) => {
    socket.write(line + '\r\n');
    const response = await readResponse();
    const code = response.slice(0, 3);
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP command failed (${code}): ${response.trim()}`);
    }
    return response;
  };

  return { readResponse, command };
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => resolve(socket))
      : net.createConnection({ host, port }, () => resolve(socket));
    socket.once('error', reject);
    socket.setTimeout(30000, () => {
      socket.destroy(new Error('SMTP connection timed out'));
    });
  });
}

async function sendOtpEmail(toEmail, otp) {
  const host = envValue('SMTP_HOST', 'smtp.gmail.com');
  const port = parseInt(envValue('SMTP_PORT', '587'), 10);
  const secure = envValue('SMTP_SECURE', 'false').toLowerCase() === 'true';
  const user = envValue('SMTP_USER');
  const pass = envValue('SMTP_PASS').replace(/\s+/g, '');
  const from = envValue('SMTP_FROM', `Mac Dashboard <${user}>`);

  if (!host || !port || !user || !pass) {
    throw new Error('Missing SMTP_HOST, SMTP_PORT, SMTP_USER, or SMTP_PASS in .env');
  }

  let socket = await connectSocket({ host, port, secure });
  let client = createSmtpClient(socket);
  await client.readResponse();
  await client.command(`EHLO localhost`);

  if (!secure) {
    await client.command('STARTTLS', ['220']);
    socket = tls.connect({ socket, servername: host, rejectUnauthorized: true });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    client = createSmtpClient(socket);
    await client.command(`EHLO localhost`);
  }

  await client.command('AUTH LOGIN', ['334']);
  await client.command(Buffer.from(user).toString('base64'), ['334']);
  await client.command(Buffer.from(pass).toString('base64'), ['235']);
  await client.command(`MAIL FROM:<${user}>`);
  await client.command(`RCPT TO:<${toEmail}>`, ['250', '251']);
  await client.command('DATA', ['354']);

  const subject = 'Mã OTP khôi phục mật khẩu Admin';
  const expiresMinutes = Math.round(getOtpExpiryMs() / 60000);
  const boundary = `otp_boundary_${crypto.randomBytes(12).toString('hex')}`;
  const escapedOtp = String(otp).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const textBody = [
    'Mã OTP khôi phục mật khẩu Admin của bạn là:',
    '',
    otp,
    '',
    `Mã này hết hạn sau ${expiresMinutes} phút.`,
    'Nếu bạn không yêu cầu, vui lòng bỏ qua email này.'
  ].join('\r\n');
  const htmlBody = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background:#eef2f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7; padding:32px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px; background:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 18px 48px rgba(15,23,42,0.16);">
          <tr>
            <td style="background:#0f172a; padding:28px 28px 24px; text-align:center;">
              <div style="display:inline-block; width:54px; height:54px; line-height:54px; border-radius:16px; background:#0284c7; color:#ffffff; font-size:26px; font-weight:800;">OTP</div>
              <h1 style="margin:18px 0 6px; color:#f8fafc; font-size:22px; line-height:1.25;">Khôi phục mật khẩu Admin</h1>
              <p style="margin:0; color:#cbd5e1; font-size:14px; line-height:1.6;">Dùng mã bên dưới để xác minh yêu cầu đặt lại mật khẩu.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 26px;">
              <p style="margin:0 0 14px; color:#475569; font-size:14px; line-height:1.7;">Mã xác minh của bạn là:</p>
              <div style="background:#f8fafc; border:1px solid #dbeafe; border-radius:14px; padding:20px 16px; text-align:center;">
                <div style="font-size:34px; letter-spacing:10px; color:#0284c7; font-weight:800; line-height:1.1;">${escapedOtp}</div>
              </div>
              <div style="margin-top:18px; padding:13px 14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; color:#1e40af; font-size:13px; line-height:1.55;">
                Mã OTP này có hiệu lực trong <strong>${expiresMinutes} phút</strong>. Không chia sẻ mã này với bất kỳ ai.
              </div>
              <p style="margin:18px 0 0; color:#64748b; font-size:13px; line-height:1.65;">Nếu bạn không yêu cầu khôi phục mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn sẽ không thay đổi.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; text-align:center;">
              <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.5;">Mac Dashboard Security</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const body = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
    '.'
  ].join('\r\n');

  socket.write(body + '\r\n');
  await client.readResponse();
  try { await client.command('QUIT', ['221']); } catch (e) {}
  socket.end();
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --------------------------------------------------------------------------
  // API ROUTING
  // --------------------------------------------------------------------------

  // 0. Admin password recovery with Gmail OTP
  if (pathname === '/api/auth/recovery-email' && req.method === 'GET') {
    try {
      const email = await getRecoveryEmail();
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Recovery email is not configured' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, email: maskEmail(email) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/auth/request-admin-otp' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const email = await getRecoveryEmail(body.email);
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Recovery email is not configured' }));
        return;
      }

      const otp = generateOtp();
      const expiresAt = Date.now() + getOtpExpiryMs();
      otpStore.set(email, {
        otpHash: crypto.createHash('sha256').update(otp).digest('hex'),
        expiresAt,
        attempts: 0
      });

      await sendOtpEmail(email, otp);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        email: maskEmail(email),
        expiresInMinutes: Math.round(getOtpExpiryMs() / 60000)
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/auth/verify-admin-otp' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const email = await getRecoveryEmail(body.email);
      const otp = String(body.otp || '').trim();
      const record = otpStore.get(email);

      if (!email || !otp || !record || Date.now() > record.expiresAt) {
        if (email) otpStore.delete(email);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'OTP is invalid or expired' }));
        return;
      }

      record.attempts += 1;
      if (record.attempts > 5) {
        otpStore.delete(email);
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Too many OTP attempts' }));
        return;
      }

      const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
      if (otpHash !== record.otpHash) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'OTP is incorrect' }));
        return;
      }

      otpStore.delete(email);
      const resetToken = crypto.randomBytes(32).toString('hex');
      resetTokenStore.set(resetToken, { email, expiresAt: Date.now() + 10 * 60 * 1000 });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, resetToken }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/auth/reset-admin-password' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const token = String(body.resetToken || '').trim();
      const passwordHash = String(body.passwordHash || '').trim();
      const record = resetTokenStore.get(token);

      if (!record || Date.now() > record.expiresAt) {
        resetTokenStore.delete(token);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Reset token is invalid or expired' }));
        return;
      }
      if (!/^[a-f0-9]{64}$/i.test(passwordHash)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Invalid password hash' }));
        return;
      }

      const hashValue = JSON.stringify(passwordHash).replace(/'/g, "''");
      await db.query(`INSERT INTO public.system_store(key, value, updated_at) VALUES('sys_admin_pass_hash', '${hashValue}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);
      await db.query(`INSERT INTO public.system_store(key, value, updated_at) VALUES('p2p_admin_pass_hash', '${hashValue}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);
      await db.query(`
        INSERT INTO public.system_config(id, admin_pass_hash, updated_at)
        VALUES(1, '${passwordHash.replace(/'/g, "''")}', NOW())
        ON CONFLICT (id) DO UPDATE SET admin_pass_hash = EXCLUDED.admin_pass_hash, updated_at = NOW();
      `);
      resetTokenStore.delete(token);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 1. Health & DB Status
  if (pathname === '/api/status' || pathname === '/api/health') {
    try {
      const dbStatus = await db.query('SELECT COUNT(*) as count FROM public.system_store;');
      const relationalStats = await relationalManager.getTableStats();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'online',
        server: 'Node.js Relational PostgreSQL Server',
        database: DB_CONFIG.database,
        host: DB_CONFIG.host,
        connected: db.connected,
        schemaType: 'Relational (PostgreSQL Tables)',
        tables: relationalStats,
        totalKeys: parseInt(dbStatus.rows[0].count, 10),
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'error',
        connected: false,
        error: err.message
      }));
    }
    return;
  }

  // 1.1 Relational Tables Stats
  if (pathname === '/api/relational/tables' && req.method === 'GET') {
    try {
      const stats = await relationalManager.getTableStats();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, schema: 'relational', tables: stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 1.2 Query specific relational table: /api/relational/:table
  if (pathname.startsWith('/api/relational/') && req.method === 'GET') {
    const table = pathname.slice('/api/relational/'.length);
    const ALLOWED_TABLES = [
      'chia_bill_members', 'chia_bill_meals', 'chia_bill_expense_items',
      'chia_bill_participants', 'chia_bill_money_logs',
      'tien_com_members', 'tien_com_orders', 'tien_com_order_items', 'tien_com_menu_presets',
      'system_config', 'bank_accounts', 'dashboard_apps', 'wallpapers', 'notes_and_tasks'
    ];

    if (!ALLOWED_TABLES.includes(table)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Table not allowed or invalid' }));
      return;
    }

    try {
      const q = await db.query(`SELECT * FROM public.${table} LIMIT 500;`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, table, count: q.rows.length, rows: q.rows }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 2. GET all storage keys: /api/storage
  if (pathname === '/api/storage' && req.method === 'GET') {
    try {
      const q = await db.query('SELECT key, value FROM public.system_store ORDER BY key ASC;');
      const data = {};
      for (const row of q.rows) {
        try {
          data[row.key] = JSON.parse(row.value);
        } catch (e) {
          data[row.key] = row.value;
        }
      }

      // Always merge relational system_config so security credentials are never lost
      try {
        const sysCfg = await db.query('SELECT * FROM public.system_config WHERE id = 1;');
        if (sysCfg.rows.length > 0) {
          const row = sysCfg.rows[0];
          if (row.admin_pass_hash) {
            data['sys_admin_pass_hash'] = row.admin_pass_hash;
            data['p2p_admin_pass_hash'] = row.admin_pass_hash;
          }
          if (row.master_key_hash) data['sys_master_key_hash'] = row.master_key_hash;
          if (row.recovery_email) data['sys_recovery_email'] = row.recovery_email;
          if (row.is_admin_active !== null && row.is_admin_active !== undefined) {
            data['sys_is_admin'] = String(row.is_admin_active);
          }
        }
      } catch (e) {}

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, count: Object.keys(data).length, data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. GET single key: /api/storage/:key
  if (pathname.startsWith('/api/storage/') && req.method === 'GET') {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    if (!key) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Key required' }));
      return;
    }

    try {
      const escapedKey = key.replace(/'/g, "''");
      const q = await db.query(`SELECT value FROM public.system_store WHERE key = '${escapedKey}' LIMIT 1;`);
      if (q.rows.length === 0) {
        if (key === 'sys_admin_pass_hash' || key === 'p2p_admin_pass_hash' || key === 'sys_master_key_hash' || key === 'sys_recovery_email') {
          const sysCfg = await db.query('SELECT * FROM public.system_config WHERE id = 1;');
          if (sysCfg.rows.length > 0) {
            const col = (key === 'sys_admin_pass_hash' || key === 'p2p_admin_pass_hash') ? 'admin_pass_hash' : (key === 'sys_master_key_hash' ? 'master_key_hash' : 'recovery_email');
            if (sysCfg.rows[0][col]) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: true, key, value: sysCfg.rows[0][col] }));
              return;
            }
          }
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Key not found', value: null }));
      } else {
        let val;
        try { val = JSON.parse(q.rows[0].value); } catch (e) { val = q.rows[0].value; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, key, value: val }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 4. POST /api/storage - Save single or bulk entries (Synced to Relational Tables)
  if (pathname === '/api/storage' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      let itemsToSave = [];

      if (body.key !== undefined) {
        itemsToSave.push({ key: body.key, value: body.value });
      } else if (body.data && typeof body.data === 'object') {
        for (const [k, v] of Object.entries(body.data)) {
          itemsToSave.push({ key: k, value: v });
        }
      } else if (typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) {
          itemsToSave.push({ key: k, value: v });
        }
      }

      if (itemsToSave.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No data provided to save' }));
        return;
      }

      for (const item of itemsToSave) {
        const escapedKey = String(item.key).replace(/'/g, "''");
        const valStr = JSON.stringify(item.value).replace(/'/g, "''");
        await db.query(`INSERT INTO public.system_store(key, value, updated_at) VALUES('${escapedKey}', '${valStr}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);
        // Sync to relational domain tables
        relationalManager.syncKeyToRelational(item.key, item.value).catch(e => console.error('[Relational Sync]', e.message));
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, savedCount: itemsToSave.length, relationalSynced: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 5. POST single key: /api/storage/:key
  if (pathname.startsWith('/api/storage/') && req.method === 'POST') {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    try {
      const body = await parseJsonBody(req);
      const val = body.value !== undefined ? body.value : body;
      const escapedKey = key.replace(/'/g, "''");
      const valStr = JSON.stringify(val).replace(/'/g, "''");

      await db.query(`INSERT INTO public.system_store(key, value, updated_at) VALUES('${escapedKey}', '${valStr}', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);
      relationalManager.syncKeyToRelational(key, val).catch(e => console.error('[Relational Sync]', e.message));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, key, relationalSynced: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 6. DELETE /api/storage/:key
  if (pathname.startsWith('/api/storage/') && req.method === 'DELETE') {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    try {
      const escapedKey = key.replace(/'/g, "''");
      await db.query(`DELETE FROM public.system_store WHERE key = '${escapedKey}';`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deleted: key }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 7. POST /api/storage/clear
  if (pathname === '/api/storage/clear' && req.method === 'POST') {
    try {
      await db.query(`DELETE FROM public.system_store;`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'All storage cleared' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // --------------------------------------------------------------------------
  // STATIC FILE SERVING
  // --------------------------------------------------------------------------
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Prevent directory traversal
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(normalizedPath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    if (stats.isDirectory()) {
      normalizedPath = path.join(normalizedPath, 'index.html');
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(normalizedPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error: ' + readErr.message);
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    });
  });
});

// Start Server & Connect to Supabase
async function start() {
  console.log('------------------------------------------------------------');
  console.log('🚀 Starting macOS Web & Supabase Database Server...');
  console.log(`📡 Connecting to PostgreSQL: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
  
  try {
    await db.connect();
    console.log('✅ Connected to Supabase PostgreSQL Database successfully!');
    await seedDefaultData();
  } catch (err) {
    console.error('❌ Failed to connect to database initially:', err.message);
    console.log('⚠️ Server will still start and retry database connection upon request.');
  }

  server.listen(PORT, () => {
    console.log(`\n🎉 Server is running live at: http://localhost:${PORT}`);
    console.log(`🌐 Local Network Access: http://127.0.0.1:${PORT}`);
    console.log(`⚡ PostgreSQL Host: ${DB_CONFIG.host}`);
    console.log(`🔒 Storage Mode: SUPABASE POSTGRESQL (Local Storage Disabled)`);
    console.log('------------------------------------------------------------\n');
  });
}

start();
