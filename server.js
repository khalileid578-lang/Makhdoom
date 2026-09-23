const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'db');
const db = new Database(path.join(DB_DIR, 'church.db'));
db.pragma('foreign_keys = ON');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1); // مهم لو الاستضافة (زي Render) وراء proxy عشان الكوكيز الآمنة تشتغل

app.use(session({
  store: new SQLiteStore({ dir: DB_DIR, db: 'sessions.db' }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,           // https فقط في الإنتاج
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8 // 8 ساعات
  }
}));

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
function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

// ---------- Users management (admin only) ----------
app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT id, username, name, role, active FROM users ORDER BY id').all();
  res.json(rows);
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !['admin', 'amin_khedma', 'khadem'].includes(role)) {
    return res.status(400).json({ error: 'بيانات ناقصة أو صلاحية غير معروفة' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)')
      .run(username, hash, name, role);
    res.json(sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  }
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { name, role, active, password } = req.body || {};
  const id = +req.params.id;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'غير موجود' });

  db.prepare('UPDATE users SET name = COALESCE(?,name), role = COALESCE(?,role), active = COALESCE(?,active) WHERE id = ?')
    .run(name ?? null, role ?? null, active === undefined ? null : (active ? 1 : 0), id);
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  res.json(sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

app.get('/api/khadem-list', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  res.json(db.prepare("SELECT id, name, username FROM users WHERE role = 'khadem' AND active = 1").all());
});

// ---------- Members (المخدومين) ----------
app.get('/api/members', requireAuth, (req, res) => {
  const { role, id } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = db.prepare('SELECT * FROM members WHERE assigned_khadem_id = ? AND active = 1 ORDER BY name').all(id);
  } else {
    rows = db.prepare('SELECT * FROM members WHERE active = 1 ORDER BY name').all();
  }
  res.json(rows);
});

app.post('/api/members', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const { name, age, phone, birth_date, group_name, assigned_khadem_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم المخدوم مطلوب' });
  const info = db.prepare(`INSERT INTO members (name, age, phone, birth_date, group_name, assigned_khadem_id)
    VALUES (?,?,?,?,?,?)`).run(name, age || null, phone || null, birth_date || null, group_name || null, assigned_khadem_id || null);
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const { name, age, phone, birth_date, group_name, assigned_khadem_id, active } = req.body || {};
  const id = +req.params.id;
  db.prepare(`UPDATE members SET
      name = COALESCE(?,name), age = COALESCE(?,age), phone = COALESCE(?,phone),
      birth_date = COALESCE(?,birth_date), group_name = COALESCE(?,group_name),
      assigned_khadem_id = COALESCE(?,assigned_khadem_id), active = COALESCE(?,active)
    WHERE id = ?`)
    .run(name ?? null, age ?? null, phone ?? null, birth_date ?? null, group_name ?? null,
      assigned_khadem_id ?? null, active === undefined ? null : (active ? 1 : 0), id);
  res.json(db.prepare('SELECT * FROM members WHERE id = ?').get(id));
});

app.delete('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  db.prepare('DELETE FROM members WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// ---------- Attendance (حضور المخدومين) ----------
app.get('/api/attendance', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const { role, id } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = db.prepare(`
      SELECT m.id member_id, m.name, a.present
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.assigned_khadem_id = ? AND m.active = 1 ORDER BY m.name`).all(date, id);
  } else {
    rows = db.prepare(`
      SELECT m.id member_id, m.name, a.present
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.active = 1 ORDER BY m.name`).all(date);
  }
  res.json(rows);
});

app.post('/api/attendance', requireAuth, (req, res) => {
  const { member_id, date, present } = req.body || {};
  if (!member_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });

  if (req.session.user.role === 'khadem') {
    const m = db.prepare('SELECT assigned_khadem_id FROM members WHERE id = ?').get(member_id);
    if (!m || m.assigned_khadem_id !== req.session.user.id) {
      return res.status(403).json({ error: 'هذا المخدوم غير مسند إليك' });
    }
  }
  db.prepare(`INSERT INTO attendance (member_id, date, present, recorded_by) VALUES (?,?,?,?)
    ON CONFLICT(member_id, date) DO UPDATE SET present = excluded.present, recorded_by = excluded.recorded_by`)
    .run(member_id, date, present ? 1 : 0, req.session.user.id);
  res.json({ ok: true });
});

// ---------- Servant attendance (حضور الخدام) ----------
app.get('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const rows = db.prepare(`
    SELECT u.id khadem_id, u.name, sa.present
    FROM users u LEFT JOIN servant_attendance sa ON sa.khadem_id = u.id AND sa.date = ?
    WHERE u.role = 'khadem' AND u.active = 1 ORDER BY u.name`).all(date);
  res.json(rows);
});

app.post('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const { khadem_id, date, present } = req.body || {};
  if (!khadem_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });
  db.prepare(`INSERT INTO servant_attendance (khadem_id, date, present, recorded_by) VALUES (?,?,?,?)
    ON CONFLICT(khadem_id, date) DO UPDATE SET present = excluded.present, recorded_by = excluded.recorded_by`)
    .run(khadem_id, date, present ? 1 : 0, req.session.user.id);
  res.json({ ok: true });
});

// ---------- Alerts (تنبيه غياب) ----------
app.get('/api/alerts/latest', requireAuth, (req, res) => {
  const lastDateRow = db.prepare('SELECT MAX(date) d FROM attendance').get();
  const lastDate = lastDateRow && lastDateRow.d;
  if (!lastDate) return res.json({ date: null, absentMembers: [], absentServants: [] });

  const { role, id } = req.session.user;
  let absentMembers;
  if (role === 'khadem') {
    absentMembers = db.prepare(`
      SELECT m.name FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.present = 0 AND m.assigned_khadem_id = ?`).all(lastDate, id);
  } else {
    absentMembers = db.prepare(`
      SELECT m.name FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.present = 0`).all(lastDate);
  }
  let absentServants = [];
  if (role === 'admin' || role === 'amin_khedma') {
    absentServants = db.prepare(`
      SELECT u.name FROM servant_attendance sa JOIN users u ON u.id = sa.khadem_id
      WHERE sa.date = ? AND sa.present = 0`).all(lastDate);
  }
  res.json({
    date: lastDate,
    absentMembers: absentMembers.map(r => r.name),
    absentServants: absentServants.map(r => r.name)
  });
});

// ---------- Reports ----------
app.get('/api/reports/attendance', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT date,
      SUM(present) as present_count,
      SUM(1 - present) as absent_count
    FROM attendance
    WHERE date BETWEEN COALESCE(?, '0000-01-01') AND COALESCE(?, '9999-12-31')
    GROUP BY date ORDER BY date`).all(from || null, to || null);
  res.json(rows);
});

app.get('/api/reports/birthdays', requireAuth, requireRole('admin', 'amin_khedma'), (req, res) => {
  const month = req.query.month || String(new Date().getMonth() + 1).padStart(2, '0');
  const rows = db.prepare(`
    SELECT name, birth_date, group_name FROM members
    WHERE active = 1 AND birth_date IS NOT NULL AND strftime('%m', birth_date) = ?
    ORDER BY strftime('%d', birth_date)`).all(month.padStart(2, '0'));
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`السيرفر شغال على المنفذ ${PORT}`));
