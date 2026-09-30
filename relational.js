/**
 * Relational Schema & ORM Mapper for Supabase PostgreSQL
 * Translates domain data into normalized relational tables:
 * - chia_bill_members, chia_bill_meals, chia_bill_expense_items, chia_bill_participants, chia_bill_money_logs
 * - tien_com_members, tien_com_orders, tien_com_order_items, tien_com_menu_presets
 * - system_config, bank_accounts, dashboard_apps, wallpapers, notes_and_tasks
 */

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

const parseJson = (raw) => {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  return Array.isArray(raw) ? raw : [];
};

class RelationalManager {
  constructor(db) {
    this.db = db;
  }

  // Get table statistics
  async getTableStats() {
    const tables = [
      'chia_bill_members', 'chia_bill_meals', 'chia_bill_expense_items',
      'chia_bill_participants', 'chia_bill_money_logs',
      'tien_com_members', 'tien_com_orders', 'tien_com_order_items', 'tien_com_menu_presets',
      'system_config', 'bank_accounts', 'dashboard_apps', 'wallpapers', 'notes_and_tasks'
    ];

    const stats = {};
    for (const t of tables) {
      try {
        const res = await this.db.query(`SELECT COUNT(*) as count FROM public.${t};`);
        stats[t] = parseInt(res.rows[0].count, 10);
      } catch (e) {
        stats[t] = 0;
      }
    }
    return stats;
  }

  // Synchronize writes to relational tables
  async syncKeyToRelational(key, value) {
    try {
      if (key === 'nhau_members') {
        const members = parseJson(value);
        for (const m of members) {
          if (!m || !m.name) continue;
          const mid = typeof m.id === 'number' ? m.id : parseInt(m.id, 10);
          await this.db.query(`
            INSERT INTO public.chia_bill_members(id, name, full_name, nickname, balance, dob, phone, bank_id, account_no, account_name, note, updated_at)
            VALUES(${mid}, ${esc(m.name)}, ${esc(m.fullName || m.name)}, ${esc(m.nickname || m.name)}, ${m.balance || 0}, ${esc(m.dob || '')}, ${esc(m.phone || '')}, ${esc(m.bankId || '')}, ${esc(m.accountNo || '')}, ${esc(m.accountName || '')}, ${esc(m.note || '')}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              full_name = EXCLUDED.full_name,
              nickname = EXCLUDED.nickname,
              balance = EXCLUDED.balance,
              phone = EXCLUDED.phone,
              dob = EXCLUDED.dob,
              bank_id = EXCLUDED.bank_id,
              account_no = EXCLUDED.account_no,
              account_name = EXCLUDED.account_name,
              note = EXCLUDED.note,
              updated_at = NOW();
          `);
        }
      } else if (key === 'nhau_meals') {
        const meals = parseJson(value);
        for (const meal of meals) {
          if (!meal || !meal.id) continue;
          await this.db.query(`
            INSERT INTO public.chia_bill_meals(id, title, meal_date, total_cost, cost_per_person, payer_name, note, created_at)
            VALUES(${meal.id}, ${esc(meal.title || meal.name || 'Hóa đơn')}, ${esc(meal.date || new Date().toISOString().slice(0, 10))}, ${meal.totalCost || 0}, ${meal.costPerPerson || 0}, ${esc(meal.payerName || '')}, ${esc(meal.note || '')}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              meal_date = EXCLUDED.meal_date,
              total_cost = EXCLUDED.total_cost,
              cost_per_person = EXCLUDED.cost_per_person;
          `);

          if (Array.isArray(meal.expenseItems)) {
            await this.db.query(`DELETE FROM public.bill_expense_items WHERE meal_id = ${meal.id};`);
            for (const item of meal.expenseItems) {
              await this.db.query(`
                INSERT INTO public.chia_bill_expense_items(meal_id, item_name, cost)
                VALUES(${meal.id}, ${esc(item.name || 'Món')}, ${item.cost || 0});
              `);
            }
          }

          if (Array.isArray(meal.participants)) {
            await this.db.query(`DELETE FROM public.bill_participants WHERE meal_id = ${meal.id};`);
            for (const p of meal.participants) {
              await this.db.query(`
                INSERT INTO public.chia_bill_participants(meal_id, member_id, member_name, cost, paid)
                VALUES(${meal.id}, ${typeof p.id === 'number' ? p.id : 'NULL'}, ${esc(p.name || '')}, ${p.cost || 0}, ${p.paid || 0});
              `);
            }
          }
        }
      } else if (key === 'nhau_money_logs') {
        const logs = parseJson(value);
        for (const log of logs) {
          if (!log || !log.id) continue;
          await this.db.query(`
            INSERT INTO public.chia_bill_money_logs(id, log_date, description, amount, created_at)
            VALUES(${log.id}, ${esc(log.date || new Date().toISOString().slice(0, 10))}, ${esc(log.description || '')}, ${log.amount || 0}, NOW())
            ON CONFLICT (id) DO NOTHING;
          `);
        }
      } else if (key === 'p2p_members') {
        const members = parseJson(value);
        for (const m of members) {
          if (!m || !m.name) continue;
          const mid = String(m.id || Date.now());
          await this.db.query(`
            INSERT INTO public.tien_com_members(id, name, full_name, balance, phone, bank_id, account_no, account_name, updated_at)
            VALUES(${esc(mid)}, ${esc(m.name)}, ${esc(m.fullName || m.name)}, ${m.balance || 0}, ${esc(m.phone || '')}, ${esc(m.bankId || '')}, ${esc(m.accountNo || '')}, ${esc(m.accountName || '')}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              balance = EXCLUDED.balance,
              updated_at = NOW();
          `);
        }
      } else if (key === 'p2p_logs') {
        const orders = parseJson(value);
        for (const order of orders) {
          if (!order || !order.id) continue;
          const orderId = String(order.id);
          await this.db.query(`
            INSERT INTO public.tien_com_orders(id, order_date, order_type, payer_name, total_amount, description, created_at)
            VALUES(${esc(orderId)}, ${esc(order.dateStr || new Date().toISOString().slice(0, 10))}, ${esc(order.type || 'Bữa ăn')}, ${esc(order.payerName || '')}, ${order.amount || 0}, ${esc(order.description || '')}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              total_amount = EXCLUDED.total_amount,
              description = EXCLUDED.description;
          `);

          if (Array.isArray(order.items)) {
            await this.db.query(`DELETE FROM public.tien_com_order_items WHERE order_id = ${esc(orderId)};`);
            for (const item of order.items) {
              await this.db.query(`
                INSERT INTO public.tien_com_order_items(order_id, member_name, dish_name, amount)
                VALUES(${esc(orderId)}, ${esc(item.colleagueName || '')}, ${esc(item.dishName || '')}, ${item.amount || 0});
              `);
            }
          }
        }
      } else if (key === 'mac_dashboard_apps_v3' || key === 'mac_dashboard_apps_v2') {
        const apps = parseJson(value);
        for (let i = 0; i < apps.length; i++) {
          const a = apps[i];
          if (!a || !a.id) continue;
          await this.db.query(`
            INSERT INTO public.dashboard_apps(id, title, icon, url, admin_only, dock_pinned, sort_order, updated_at)
            VALUES(${esc(a.id)}, ${esc(a.title)}, ${esc(a.icon)}, ${esc(a.url)}, ${!!a.adminOnly}, ${a.dockPinned !== false}, ${i}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              icon = EXCLUDED.icon,
              url = EXCLUDED.url,
              admin_only = EXCLUDED.admin_only,
              dock_pinned = EXCLUDED.dock_pinned,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW();
          `);
        }
      } else if (key === 'sticky_notes_data') {
        const notes = parseJson(value);
        for (const n of notes) {
          if (!n || !n.id) continue;
          const deadlineVal = n.deadline ? new Date(n.deadline).toISOString() : null;
          const completedVal = n.completedAt ? new Date(n.completedAt).toISOString() : null;
          await this.db.query(`
            INSERT INTO public.notes_and_tasks(id, title, task_type, status, deadline, completed_at, color, updated_at)
            VALUES(${esc(n.id)}, ${esc(n.text || '')}, ${esc(n.type || 'todo')}, ${esc(n.status || 'todo')}, ${esc(deadlineVal)}, ${esc(completedVal)}, ${esc(n.color || '#fef08a')}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              status = EXCLUDED.status,
              color = EXCLUDED.color,
              updated_at = NOW();
          `);
        }
      } else if (key === 'sys_bank_config') {
        const bankObj = typeof value === 'string' ? JSON.parse(value) : value;
        if (bankObj) {
          await this.db.query(`
            INSERT INTO public.bank_accounts(bank_id, bank_name, account_no, account_name, qr_template, is_default, updated_at)
            VALUES(${esc(bankObj.bankId || 'VCB')}, ${esc(bankObj.bankName || 'Vietcombank')}, ${esc(bankObj.accountNo || '')}, ${esc(bankObj.accountName || '')}, ${esc(bankObj.template || 'compact2')}, true, NOW());
          `);
        }
      } else if (key === 'sys_admin_pass_hash' || key === 'p2p_admin_pass_hash') {
        const hashStr = String(value || '');
        await this.db.query(`
          INSERT INTO public.system_config(id, admin_pass_hash, updated_at)
          VALUES(1, ${esc(hashStr)}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            admin_pass_hash = EXCLUDED.admin_pass_hash,
            updated_at = NOW();
        `);
      } else if (key === 'sys_master_key_hash') {
        const mkStr = String(value || '');
        await this.db.query(`
          INSERT INTO public.system_config(id, master_key_hash, updated_at)
          VALUES(1, ${esc(mkStr)}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            master_key_hash = EXCLUDED.master_key_hash,
            updated_at = NOW();
        `);
      } else if (key === 'sys_recovery_email') {
        const emStr = String(value || '');
        await this.db.query(`
          INSERT INTO public.system_config(id, recovery_email, updated_at)
          VALUES(1, ${esc(emStr)}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            recovery_email = EXCLUDED.recovery_email,
            updated_at = NOW();
        `);
      } else if (key === 'sys_is_admin') {
        const isAdmin = (value === 'true' || value === true);
        await this.db.query(`
          INSERT INTO public.system_config(id, is_admin_active, updated_at)
          VALUES(1, ${isAdmin}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            is_admin_active = EXCLUDED.is_admin_active,
            updated_at = NOW();
        `);
      } else if (key === 'sys_failed_attempts') {
        const failedNum = parseInt(String(value || '0'), 10);
        await this.db.query(`
          INSERT INTO public.system_config(id, failed_attempts, updated_at)
          VALUES(1, ${failedNum}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            failed_attempts = EXCLUDED.failed_attempts,
            updated_at = NOW();
        `);
      } else if (key === 'mac_dashboard_wallpaper') {
        await this.db.query(`
          INSERT INTO public.wallpapers(id, name, url, is_selected)
          VALUES('current', 'Active Wallpaper', ${esc(String(value))}, true)
          ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url;
        `);
      }
    } catch (err) {
      console.error('[Relational] Sync error for key', key, ':', err.message);
    }
  }
}

module.exports = RelationalManager;
