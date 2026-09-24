// عميل قاعدة البيانات المشترك.
// لو متغيرات TURSO_DATABASE_URL و TURSO_AUTH_TOKEN موجودة، هيتصل بقاعدة بيانات Turso
// السحابية (بيانات دائمة حقيقية ولا تُمسح أبدًا حتى مع كل نشر جديد).
// لو مش موجودة (تجربة على جهازك)، هيستخدم ملف SQLite محلي كبديل.
const path = require('path');
const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || ('file:' + path.join(__dirname, 'church.db')),
  authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

module.exports = client;
