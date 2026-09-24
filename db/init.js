// إنشاء الجداول وزرع حساب أدمن افتراضي (يعمل مع Turso أو الملف المحلي)
// exported كـ ensureSchema عشان يتنادى تلقائيًا من السيرفر عند كل تشغيل (مفيد جدًا مع Vercel)
const bcrypt = require('bcryptjs');
const client = require('./client');

async function ensureSchema() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','amin_khedma','khadem')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      phone TEXT,
      birth_date TEXT,
      group_name TEXT,
      assigned_khadem_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (assigned_khadem_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      present INTEGER NOT NULL,
      recorded_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(member_id, date),
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS servant_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      khadem_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      present INTEGER NOT NULL,
      recorded_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(khadem_id, date),
      FOREIGN KEY (khadem_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  const countRes = await client.execute('SELECT COUNT(*) c FROM users');
  const count = Number(countRes.rows[0].c);

  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await client.execute({
      sql: 'INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)',
      args: ['admin', hash, 'المدير العام', 'admin']
    });
  }
  return count;
}

module.exports = { ensureSchema };

// لو الملف اتشغل مباشرة (node db/init.js) وليس عن طريق require
if (require.main === module) {
  ensureSchema()
    .then(count => {
      if (count === 0) {
        console.log('تم إنشاء حساب الأدمن الافتراضي:');
        console.log('  اسم المستخدم: admin');
        console.log('  كلمة المرور:  admin123');
        console.log('غيّر كلمة المرور فورًا بعد أول دخول من صفحة إدارة المستخدمين.');
      } else {
        console.log('قاعدة البيانات موجودة بالفعل. عدد المستخدمين الحالي: ' + count);
      }
      process.exit(0);
    })
    .catch(err => { console.error('حصل خطأ أثناء الإعداد:', err); process.exit(1); });
}
