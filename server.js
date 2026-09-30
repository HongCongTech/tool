/**
 * Web Application & Supabase Database Server
 * Connects directly to Supabase PostgreSQL and handles all persistent storage.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
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
