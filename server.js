const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db/client');
const { ensureSchema } = require('./db/init');
const { sendTelegramMessage, telegramDeepLink, generateTelegramCode } = require('./lib/telegram');

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

// المجموعات (الفصول) الثابتة
const GROUPS = ['أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي'];

// ---------- Auth ----------
app.post('/api/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });

  const user = await get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role, group_name: user.group_name || null };
  res.json({ user: req.session.user });
}));

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

// ---------- Users management (admin: كل حاجة | أمين خدمة: حسابات الخدام فقط) ----------
function withTelegramLink(u) {
  return { ...u, telegram_linked: !!u.telegram_chat_id, telegram_link: telegramDeepLink(u.telegram_code) };
}

app.get('/api/users', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const myRole = req.session.user.role;
  const rows = myRole === 'admin'
    ? await all('SELECT id, username, name, role, group_name, active, telegram_chat_id, telegram_code FROM users ORDER BY id')
    : await all("SELECT id, username, name, role, group_name, active, telegram_chat_id, telegram_code FROM users WHERE role = 'khadem' ORDER BY id");
  res.json(rows.map(withTelegramLink));
}));

app.post('/api/users', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { username, password, name, role, group_name } = req.body || {};
  const myRole = req.session.user.role;
  if (myRole === 'amin_khedma' && role !== 'khadem') {
    return res.status(403).json({ error: 'أمين الخدمة يقدر يضيف حسابات خدام فقط' });
  }
  if (!username || !password || !name || !['admin', 'amin_khedma', 'khadem'].includes(role)) {
    return res.status(400).json({ error: 'بيانات ناقصة أو صلاحية غير معروفة' });
  }
  if (role === 'khadem' && !GROUPS.includes(group_name)) {
    return res.status(400).json({ error: 'اختر مجموعة (فصل) صحيحة للخادم' });
  }
  const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });

  const hash = bcrypt.hashSync(password, 10);
  const tgCode = generateTelegramCode();
  const info = await run('INSERT INTO users (username, password_hash, name, role, group_name, telegram_code) VALUES (?,?,?,?,?,?)',
    [username, hash, name, role, role === 'khadem' ? group_name : null, tgCode]);
  const newUser = await get('SELECT id, username, name, role, group_name, active, telegram_chat_id, telegram_code FROM users WHERE id = ?', [Number(info.lastInsertRowid)]);
  res.json(withTelegramLink(newUser));
}));

app.put('/api/users/:id', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const id = +req.params.id;
  const myRole = req.session.user.role;
  const existing = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'غير موجود' });
  if (myRole === 'amin_khedma' && existing.role !== 'khadem') {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const { name, role, group_name, active, password } = req.body || {};
  if (myRole === 'amin_khedma' && role && role !== 'khadem') {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  await run('UPDATE users SET name = COALESCE(?,name), role = COALESCE(?,role), group_name = COALESCE(?,group_name), active = COALESCE(?,active) WHERE id = ?',
    [name ?? null, role ?? null, group_name ?? null, active === undefined ? null : (active ? 1 : 0), id]);
  if (password) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), id]);
  }
  // كل مستخدم لازم يكون ليه كود تليجرام حتى لو اتعمل قبل إضافة الميزة دي
  let updated = await get('SELECT id, username, name, role, group_name, active, telegram_chat_id, telegram_code FROM users WHERE id = ?', [id]);
  if (!updated.telegram_code) {
    const tgCode = generateTelegramCode();
    await run('UPDATE users SET telegram_code = ? WHERE id = ?', [tgCode, id]);
    updated.telegram_code = tgCode;
  }
  res.json(withTelegramLink(updated));
}));

app.delete('/api/users/:id', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const id = +req.params.id;
  if (req.session.user.role === 'amin_khedma') {
    const existing = await get('SELECT role FROM users WHERE id = ?', [id]);
    if (!existing || existing.role !== 'khadem') return res.status(403).json({ error: 'غير مسموح' });
  }
  await run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
}));

app.get('/api/groups', requireAuth, (req, res) => res.json(GROUPS));

// ---------- Telegram linking ----------
// تليجرام بيبعت هنا كل رسالة توصل للبوت
app.post('/api/telegram/webhook/:secret', ah(async (req, res) => {
  if (req.params.secret !== process.env.TELEGRAM_WEBHOOK_SECRET) return res.status(403).json({ error: 'غير مسموح' });
  const msg = req.body && req.body.message;
  if (!msg || !msg.text) return res.json({ ok: true });

  const chatId = msg.chat.id;
  const match = msg.text.match(/\/start\s+(\S+)/);
  if (match) {
    const code = match[1];
    const user = await get('SELECT id, name FROM users WHERE telegram_code = ?', [code]);
    if (user) {
      await run('UPDATE users SET telegram_chat_id = ? WHERE id = ?', [String(chatId), user.id]);
      await sendTelegramMessage(chatId, `تم ربط حسابك بنجاح ✅ يا ${user.name}. هتوصلك تقارير الحضور والغياب هنا كل جمعة.`);
    } else {
      await sendTelegramMessage(chatId, 'الكود ده مش معروف، تأكد من اللينك اللي استخدمته.');
    }
  } else {
    await sendTelegramMessage(chatId, 'أهلًا! استخدم اللينك اللي بعتهولك المسؤول عن الموقع عشان تربط حسابك.');
  }
  res.json({ ok: true });
}));

// ---------- Members (المخدومين) ----------
// أدمن وأمين خدمة: كل المخدومين. خادم: مخدومين مجموعته بس (لكن بتحكم كامل فيهم)
app.get('/api/members', requireAuth, ah(async (req, res) => {
  const { role, group_name } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = await all('SELECT * FROM members WHERE group_name = ? AND active = 1 ORDER BY name', [group_name]);
  } else {
    rows = await all('SELECT * FROM members WHERE active = 1 ORDER BY name');
  }
  res.json(rows);
}));

app.post('/api/members', requireAuth, requireRole('admin', 'amin_khedma', 'khadem'), ah(async (req, res) => {
  const { role, group_name: myGroup } = req.session.user;
  let { name, age, phone, birth_date, group_name, address, guardian_phone, facebook_link } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم المخدوم مطلوب' });
  if (role === 'khadem') group_name = myGroup; // الخادم يقدر يضيف بس في مجموعته
  else if (group_name && !GROUPS.includes(group_name)) return res.status(400).json({ error: 'مجموعة غير صحيحة' });

  const info = await run(`INSERT INTO members (name, age, phone, birth_date, group_name, address, guardian_phone, facebook_link)
    VALUES (?,?,?,?,?,?,?,?)`, [name, age || null, phone || null, birth_date || null, group_name || null, address || null, guardian_phone || null, facebook_link || null]);
  const created = await get('SELECT * FROM members WHERE id = ?', [Number(info.lastInsertRowid)]);
  res.json(created);
}));

app.put('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma', 'khadem'), ah(async (req, res) => {
  const id = +req.params.id;
  const { role, group_name: myGroup } = req.session.user;
  const existing = await get('SELECT * FROM members WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'غير موجود' });
  if (role === 'khadem' && existing.group_name !== myGroup) {
    return res.status(403).json({ error: 'هذا المخدوم مش في مجموعتك' });
  }
  const { name, age, phone, birth_date, group_name, address, guardian_phone, facebook_link, active } = req.body || {};
  const newGroup = role === 'khadem' ? myGroup : (group_name ?? existing.group_name); // الخادم متسمحش ينقل المخدوم لمجموعة تانية
  await run(`UPDATE members SET
      name = COALESCE(?,name), age = COALESCE(?,age), phone = COALESCE(?,phone),
      birth_date = COALESCE(?,birth_date), group_name = ?, address = COALESCE(?,address),
      guardian_phone = COALESCE(?,guardian_phone), facebook_link = COALESCE(?,facebook_link), active = COALESCE(?,active)
    WHERE id = ?`,
    [name ?? null, age ?? null, phone ?? null, birth_date ?? null, newGroup, address ?? null,
      guardian_phone ?? null, facebook_link ?? null, active === undefined ? null : (active ? 1 : 0), id]);
  const updated = await get('SELECT * FROM members WHERE id = ?', [id]);
  res.json(updated);
}));

app.delete('/api/members/:id', requireAuth, requireRole('admin', 'amin_khedma', 'khadem'), ah(async (req, res) => {
  const id = +req.params.id;
  const { role, group_name: myGroup } = req.session.user;
  if (role === 'khadem') {
    const existing = await get('SELECT group_name FROM members WHERE id = ?', [id]);
    if (!existing || existing.group_name !== myGroup) return res.status(403).json({ error: 'هذا المخدوم مش في مجموعتك' });
  }
  await run('DELETE FROM members WHERE id = ?', [id]);
  res.json({ ok: true });
}));

// ---------- Attendance (حضور المخدومين) ----------
app.get('/api/attendance', requireAuth, ah(async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const { role, group_name } = req.session.user;
  let rows;
  if (role === 'khadem') {
    rows = await all(`
      SELECT m.id member_id, m.name, a.present, a.reason
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.group_name = ? AND m.active = 1 ORDER BY m.name`, [date, group_name]);
  } else {
    rows = await all(`
      SELECT m.id member_id, m.name, a.present, a.reason
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.active = 1 ORDER BY m.name`, [date]);
  }
  res.json(rows);
}));

app.post('/api/attendance', requireAuth, ah(async (req, res) => {
  const { member_id, date, present, reason } = req.body || {};
  if (!member_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });

  if (req.session.user.role === 'khadem') {
    const m = await get('SELECT group_name FROM members WHERE id = ?', [member_id]);
    if (!m || m.group_name !== req.session.user.group_name) {
      return res.status(403).json({ error: 'هذا المخدوم مش في مجموعتك' });
    }
  }
  await run(`INSERT INTO attendance (member_id, date, present, reason, recorded_by) VALUES (?,?,?,?,?)
    ON CONFLICT(member_id, date) DO UPDATE SET present = excluded.present, reason = excluded.reason, recorded_by = excluded.recorded_by`,
    [member_id, date, present ? 1 : 0, present ? null : (reason || null), req.session.user.id]);
  res.json({ ok: true });
}));

// ---------- Servant attendance (حضور الخدام) ----------
app.get('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'حدد التاريخ' });
  const rows = await all(`
    SELECT u.id khadem_id, u.name, sa.present, sa.reason
    FROM users u LEFT JOIN servant_attendance sa ON sa.khadem_id = u.id AND sa.date = ?
    WHERE u.role = 'khadem' AND u.active = 1 ORDER BY u.name`, [date]);
  res.json(rows);
}));

app.post('/api/servant-attendance', requireAuth, requireRole('admin', 'amin_khedma'), ah(async (req, res) => {
  const { khadem_id, date, present, reason } = req.body || {};
  if (!khadem_id || !date || present === undefined) return res.status(400).json({ error: 'بيانات ناقصة' });
  await run(`INSERT INTO servant_attendance (khadem_id, date, present, reason, recorded_by) VALUES (?,?,?,?,?)
    ON CONFLICT(khadem_id, date) DO UPDATE SET present = excluded.present, reason = excluded.reason, recorded_by = excluded.recorded_by`,
    [khadem_id, date, present ? 1 : 0, present ? null : (reason || null), req.session.user.id]);
  res.json({ ok: true });
}));

// ---------- Alerts (تنبيه غياب) ----------
app.get('/api/alerts/latest', requireAuth, ah(async (req, res) => {
  const lastDateRow = await get('SELECT MAX(date) d FROM attendance');
  const lastDate = lastDateRow && lastDateRow.d;
  if (!lastDate) return res.json({ date: null, absentMembers: [], absentServants: [] });

  const { role, group_name } = req.session.user;
  let absentMembers;
  if (role === 'khadem') {
    absentMembers = await all(`
      SELECT m.name FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.present = 0 AND m.group_name = ?`, [lastDate, group_name]);
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
// أدمن وأمين خدمة: أي فصل (أو الكل). خادم: فصله بس تلقائيًا
app.get('/api/reports/attendance', requireAuth, ah(async (req, res) => {
  const { from, to } = req.query;
  const { role, group_name } = req.session.user;
  let group = req.query.group_name || null;
  if (role === 'khadem') group = group_name; // الخادم يشوف فصله بس مهما بعت

  let sql = `
    SELECT a.date,
      SUM(a.present) as present_count,
      SUM(1 - a.present) as absent_count
    FROM attendance a JOIN members m ON m.id = a.member_id
    WHERE a.date BETWEEN COALESCE(?, '0000-01-01') AND COALESCE(?, '9999-12-31')`;
  const args = [from || null, to || null];
  if (group) { sql += ' AND m.group_name = ?'; args.push(group); }
  sql += ' GROUP BY a.date ORDER BY a.date';

  const rows = await all(sql, args);
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

// ---------- تقرير أسبوعي تلقائي عبر تليجرام (كل جمعة) ----------
function formatMembersReport(groupName, date, rows) {
  const present = rows.filter(r => r.present === 1);
  const absent = rows.filter(r => r.present === 0 || r.present === null);
  let text = `📋 تقرير فصل ${groupName} - ${date}\n\n`;
  text += `✅ الحاضرين (${present.length}):\n`;
  text += present.length ? present.map(r => `- ${r.name}`).join('\n') : '(لا يوجد)';
  text += `\n\n❌ الغائبين (${absent.length}):\n`;
  text += absent.length
    ? absent.map(r => `- ${r.name}` + (r.reason ? ` (السبب: ${r.reason})` : ' (بدون سبب)')).join('\n')
    : '(لا يوجد)';
  return text;
}

app.get('/api/cron/weekly-report', ah(async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const date = new Date().toISOString().slice(0, 10);
  const results = [];

  // تقرير كل فصل لخدامه
  for (const group of GROUPS) {
    const rows = await all(`
      SELECT m.name, a.present, a.reason
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.group_name = ? AND m.active = 1 ORDER BY m.name`, [date, group]);
    const text = formatMembersReport(group, date, rows);

    const khadamInGroup = await all("SELECT id, name, telegram_chat_id FROM users WHERE role='khadem' AND group_name = ? AND active = 1", [group]);
    for (const k of khadamInGroup) {
      if (k.telegram_chat_id) {
        await sendTelegramMessage(k.telegram_chat_id, text);
        results.push({ to: k.name, group, ok: true });
      }
    }
  }

  // تقرير حضور الخدام + تقرير الفصول الثلاثة لأمناء الخدمة
  const servantsRows = await all(`
    SELECT u.name, sa.present, sa.reason
    FROM users u LEFT JOIN servant_attendance sa ON sa.khadem_id = u.id AND sa.date = ?
    WHERE u.role = 'khadem' AND u.active = 1 ORDER BY u.name`, [date]);
  const presentServants = servantsRows.filter(r => r.present === 1);
  const absentServants = servantsRows.filter(r => r.present === 0 || r.present === null);
  let servantsText = `👨‍🏫 تقرير حضور الخدام - ${date}\n\n✅ حاضرين (${presentServants.length}):\n`;
  servantsText += presentServants.length ? presentServants.map(r => `- ${r.name}`).join('\n') : '(لا يوجد)';
  servantsText += `\n\n❌ غائبين (${absentServants.length}):\n`;
  servantsText += absentServants.length
    ? absentServants.map(r => `- ${r.name}` + (r.reason ? ` (السبب: ${r.reason})` : ' (بدون سبب)')).join('\n')
    : '(لا يوجد)';

  let classesText = `📊 تقرير الفصول الثلاثة - ${date}\n`;
  for (const group of GROUPS) {
    const rows = await all(`
      SELECT m.name, a.present, a.reason
      FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.date = ?
      WHERE m.group_name = ? AND m.active = 1 ORDER BY m.name`, [date, group]);
    classesText += '\n' + formatMembersReport(group, date, rows) + '\n';
  }

  const aminUsers = await all("SELECT id, name, telegram_chat_id FROM users WHERE role='amin_khedma' AND active = 1");
  for (const a of aminUsers) {
    if (a.telegram_chat_id) {
      await sendTelegramMessage(a.telegram_chat_id, servantsText);
      await sendTelegramMessage(a.telegram_chat_id, classesText);
      results.push({ to: a.name, type: 'amin_khedma', ok: true });
    }
  }

  res.json({ ok: true, date, sent: results.length, results });
}));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`السيرفر شغال على المنفذ ${PORT}`));
}
module.exports = app;
