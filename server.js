const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db/client');
const { ensureSchema } = require('./db/init');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'change-this-secret-in-production'],
  maxAge: 1000 * 60 * 60 * 8,
  sameSite: 'lax',
  secure: isProd,
  httpOnly: true
}));

// تأكيد إن الجداول موجودة والأدمن الافتراضي متزروع، مرة واحدة فقط لكل نسخة شغّالة من السيرفر
// (مهم مع الاستضافات اللي بتشتغل عند كل طلب زي Vercel، وآمن كمان مع سيرفر عادي شغّال باستمرار)
let schemaReady = null;
app.use((req, res, next) => {
  if (!schemaReady) schemaReady = ensureSchema().catch(err => { schemaReady = null; throw err; });
  schemaReady.then(() => next()).catch(next);
});

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية لهذا الإجراء' });
    }
    next();
  };
}
// يلف أي دالة async عشان الأخطاء تتصرّف صح بدل ما السيرفر يقع
function ah(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'خطأ داخلي في السيرفر' });
  });
}
async function run(sql, args = []) {
  return db.execute({ sql, args });
}
async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}
async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}

// ---------- Auth ----------
app.post('/api/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });

  const user = await get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ user: req.session.user });
}));

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

// ---------- Users management (admin only) ----------
app.get('/api/users', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const rows = await all('SELECT id, username, name, role, active FROM users ORDER BY id');
  res.json(rows);
}));

app.post('/api/users', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !['admin', 'amin_khedma', 'khadem'].includes(role)) {
    return res.status(400).json({ error: 'بيانات ناقصة أو صلاحية غير معروفة' });
  }
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });

  const hash = bcrypt.hashSync(password, 10);
  const info = await run('INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)',
    [username, hash, name, role]);const newUser = await get('SELECT id, username, name, role, active FROM users WHERE id = ?', [Number(info.lastInsertRowid)]);
  res.json(newUser);
}));

app.put('/api/users/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const { name, role, active, password } = req.body || {};
  const id = +req.params.id;
  const existing = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'غير موجود' });

  await run('UPDATE users SET name = COALESCE(?,name), role = COALESCE(?,role), active = COALESCE(?,active) WHERE id = ?',
    [name ?? null, role ?? null, active === undefined ? null : (active ? 1 : 0), id]);
  if (password) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), id]);
  }
  const updated = await get('SELECT id, username, name, role, active FROM users WHERE id = ?', [id]);
  res.json(updated);
}));

app.delete('/api/users/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  await run('DELETE FROM users WHERE id = ?', [+req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/khadem-list', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const rows = await all("SELECT id, name, username FROM users WHERE role = 'khadem' AND active = 1");
  res.json(rows);
}));

// ---------- Members (المخدومين) ----------
app.get('/api/members', requireAuth, ah(async (req, res) => {
  const { role, id } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = await all('SELECT * FROM members WHERE assigned_khadem_id = ? AND active = 1 ORDER BY name', [id]);
  } else {
    rows = await all('SELECT * FROM members WHERE active = 1 ORDER BY name');
  }
  res.json(rows);
}));

app.post('/api/members', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { name, age, phone, birth_date, group_name, assigned_khadem_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم المخدوم مطلوب' });
  const info = await run(`INSERT INTO members (name, age, phone, birth_date, group_name, assigned_khadem_id)
    VALUES (?,?,?,?,?,?)`, [name, age || null, phone || null, birth_date || null, group_name || null, assigned_khadem_id || null]);
  const created = await get('SELECT * FROM members WHERE id = ?', [Number(info.lastInsertRowid)]);
  res.json(created);
}));

app.put('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { name, age, phone, birth_date, group_name, assigned_khadem_id, active } = req.body || {};
  const id = +req.params.id;
  await run(`UPDATE members SET
      name = COALESCE(?,name), age = COALESCE(?,age), phone = COALESCE(?,phone),
      birth_date = COALESCE(?,birth_date), group_name = COALESCE(?,group_name),
      assigned_khadem_id = COALESCE(?,assigned_khadem_id), active = COALESCE(?,active)
    WHERE id = ?`,
    [name ?? null, age ?? null, phone ?? null, birth_date ?? null, group_name ?? null,
      assigned_khadem_id ?? null, active === undefined ? null : (active ? 1 : 0), id]);
  const updated = await get('SELECT * FROM members WHERE id = ?', [id]);
  res.json(updated);
}));

app.delete('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  await run('DELETE FROM members WHERE id = ?', [+req.params.id]);
  res.json({ ok: true });
}));

// ---------- Attendance (حضور المخدومين) ----------
app.get('/api/attendance', requireAuth, ah(async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const { role, id } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = await all(`
      SELECT m.id member_id, m.name, a.present
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.assigned_khadem_id = ? AND m.active = 1 ORDER BY m.name`, [date, id]);
  } else {
    rows = await all(`
      SELECT m.id member_id, m.name, a.present
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.active = 1 ORDER BY m.name`, [date]);
  }
  res.json(rows);
}));

app.post('/api/attendance', requireAuth, ah(async (req, res) => {
  const { member_id, date, present } = req.body || {};
  if (!member_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });

  if (req.session.user.role === 'khadem') {
    const m = await get('SELECT assigned_khadem_id FROM members WHERE id = ?', [member_id]);
    if (!m || m.assigned_khadem_id !== req.session.user.id) {
      return res.status(403).json({ error: 'هذا المخدوم غير مسند إليك' });
    }
  }
  await run(`INSERT INTO attendance (member_id, date, present, recorded_by) VALUES (?,?,?,?)ON CONFLICT(member_id, date) DO UPDATE SET present = excluded.present, recorded_by = excluded.recorded_by`,
    [member_id, date, present ? 1 : 0, req.session.user.id]);
  res.json({ ok: true });
}));

// ---------- Servant attendance (حضور الخدام) ----------
app.get('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const rows = await all(`
    SELECT u.id khadem_id, u.name, sa.present
    FROM users u LEFT JOIN servant_attendance sa ON sa.khadem_id = u.id AND sa.date = ?
    WHERE u.role = 'khadem' AND u.active = 1 ORDER BY u.name`, [date]);
  res.json(rows);
}));

app.post('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { khadem_id, date, present } = req.body || {};
  if (!khadem_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });
  await run(`INSERT INTO servant_attendance (khadem_id, date, present, recorded_by) VALUES (?,?,?,?)
    ON CONFLICT(khadem_id, date) DO UPDATE SET present = excluded.present, recorded_by = excluded.recorded_by`,
    [khadem_id, date, present ? 1 : 0, req.session.user.id]);
  res.json({ ok: true });
}));

// ---------- Alerts (تنبيه غياب) ----------
app.get('/api/alerts/latest', requireAuth, ah(async (req, res) => {
  const lastDateRow = await get('SELECT MAX(date) d FROM attendance');
  const lastDate = lastDateRow && lastDateRow.d;
  if (!lastDate) return res.json({ date: null, absentMembers: [], absentServants: [] });

  const { role, id } = req.session.user;
  let absentMembers;
  if (role === 'khadem') {
    absentMembers = await all(`
      SELECT m.name FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.present = 0 AND m.assigned_khadem_id = ?`, [lastDate, id]);
  } else {
    absentMembers = await all(`
      SELECT m.name FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.present = 0`, [lastDate]);
  }
  let absentServants = [];
  if (role === 'admin' || role === 'amin_khedma') {
    absentServants = await all(`
      SELECT u.name FROM servant_attendance sa JOIN users u ON u.id = sa.khadem_id
      WHERE sa.date = ? AND sa.present = 0`, [lastDate]);
  }
  res.json({
    date: lastDate,
    absentMembers: absentMembers.map(r => r.name),
    absentServants: absentServants.map(r => r.name)
  });
}));

// ---------- Reports ----------
app.get('/api/reports/attendance', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { from, to } = req.query;
  const rows = await all(`
    SELECT date,
      SUM(present) as present_count,
      SUM(1 - present) as absent_count
    FROM attendance
    WHERE date BETWEEN COALESCE(?, '0000-01-01') AND COALESCE(?, '9999-12-31')
    GROUP BY date ORDER BY date`, [from || null, to || null]);
  res.json(rows);
}));

app.get('/api/reports/birthdays', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const month = (req.query.month || String(new Date().getMonth() + 1).padStart(2, '0')).padStart(2, '0');
  const rows = await all(`
    SELECT name, birth_date, group_name FROM members
    WHERE active = 1 AND birth_date IS NOT NULL AND strftime('%m', birth_date) = ?
    ORDER BY strftime('%d', birth_date)`, [month]);
  res.json(rows);
}));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`السيرفر شغال على المنفذ ${PORT}`));
}
module.exports = app;
