// إنشاء قاعدة البيانات وجدولها، وزرع حساب أدمن افتراضي
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'church.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
  birth_date TEXT,          -- YYYY-MM-DD
  group_name TEXT,
  assigned_khadem_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_khadem_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  date TEXT NOT NULL,       -- YYYY-MM-DD (تاريخ الاجتماع)
  present INTEGER NOT NULL, -- 1 حاضر / 0 غائب
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

// زرع حساب أدمن افتراضي لو مفيش مستخدمين
const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (count === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)`)
    .run('admin', hash, 'المدير العام', 'admin');
  console.log('تم إنشاء حساب الأدمن الافتراضي:');
  console.log('  اسم المستخدم: admin');
  console.log('  كلمة المرور:  admin123');
  console.log('غيّر كلمة المرور فورًا بعد أول دخول من صفحة إدارة المستخدمين.');
} else {
  console.log('قاعدة البيانات موجودة بالفعل، لا حاجة للزرع.');
}

db.close();
