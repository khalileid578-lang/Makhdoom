let ME = null;
const GROUPS = ['أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي'];
const today = () => new Date().toISOString().slice(0, 10);

const ROLE_LABEL = { admin: 'أدمن', amin_khedma: 'أمين خدمة', khadem: 'خادم' };

// ---------------- الوضع الليلي/النهاري ----------------
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('church_theme', next); } catch (e) {}
  applyTheme(next);
}
(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('church_theme') || 'light'; } catch (e) {}
  applyTheme(saved);
})();

async function api(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'خطأ');
  return data;
}

async function init() {
  try {
    const { user } = await api('/api/me');
    ME = user;
  } catch (e) {
    location.href = '/index.html';
    return;
  }
  document.getElementById('whoami').textContent = `${ME.name} — ${ROLE_LABEL[ME.role]}` + (ME.group_name ? ` (${ME.group_name})` : '');

  buildTabs();
  loadAlerts();
  showTab('members');
}

function logout() {
  api('/api/logout', { method: 'POST' }).finally(() => location.href = '/index.html');
}

function downloadBackup() {
  window.location.href = '/api/export';
}

function buildTabs() {
  const tabs = [{ id: 'members', label: '👦 المخدومين' }, { id: 'attendance', label: '✅ الحضور' }];
  if (ME.role === 'admin' || ME.role === 'amin_khedma') {
    tabs.push({ id: 'servants', label: '👨‍🏫 حضور الخدام' });
    tabs.push({ id: 'servantsReport', label: '📋 تقارير الخدام' });
  }
  tabs.push({ id: 'reports', label: '📊 التقارير' });
  if (ME.role === 'admin' || ME.role === 'amin_khedma') tabs.push({ id: 'users', label: '👨‍💼 المستخدمين' });

  const box = document.getElementById('tabs');
  box.innerHTML = '';
  tabs.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tab';
    el.id = 'tab-' + t.id;
    el.textContent = t.label;
    el.onclick = () => showTab(t.id);
    box.appendChild(el);
  });
}

function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById('tab-' + id);
  if (el) el.classList.add('active');
  const renderers = {
    members: renderMembers, attendance: renderAttendance,
    servants: renderServants, servantsReport: renderServantsReport, reports: renderReports, users: renderUsers
  };
  renderers[id] && renderers[id]();
}

async function loadAlerts() {
  // شريط تنبيه الغياب متشال (بقرار المستخدم). الدالة فاضية عشان باقي الأكواد اللي بتناديها ما تتأثرش.
}

// ---------------- المخدومين ----------------
let KHADAM_LIST = [];

function khademOptions(group, selectedId) {
  return '<option value="">بدون</option>' + KHADAM_LIST
    .filter(k => k.group_name === group)
    .map(k => `<option value="${k.id}" ${k.id === selectedId ? 'selected' : ''}>${k.name}</option>`).join('');
}

function refreshKhadamSelect() {
  const group = ME.role === 'khadem' ? ME.group_name : document.getElementById('m_group').value;
  const sel = document.getElementById('m_khadem');
  sel.innerHTML = group
    ? khademOptions(group, ME.role === 'khadem' ? ME.id : null)
    : '<option value="">اختر الفصل أولاً</option>';
}

async function assignKhadem(memberId, khademId) {
  try {
    await api('/api/members/' + memberId, { method: 'PUT', body: JSON.stringify({ assigned_khadem_id: khademId ? +khademId : null }) });
  } catch (e) { alert(e.message); renderMembers(); }
}

function memberRowsHtml(members) {
  let lastKey = null;
  return members.map(m => {
    const key = (m.group_name || '') + '|' + (m.khadem_name || '');
    let head = '';
    if (key !== lastKey) {
      lastKey = key;
      head = `<tr><td colspan="10" style="background:rgba(175,138,83,.18);font-weight:bold;">${m.group_name || 'بدون فصل'} — 👤 الخادم: ${m.khadem_name || 'بدون خادم محدد'}</td></tr>`;
    }
    return head + `
          <tr>
            <td>${m.name}</td><td>${m.age ?? '-'}</td><td>${m.phone ?? '-'}</td>
            <td>${m.birth_date ?? '-'}</td>
            <td>${m.address ?? '-'}</td>
            <td>${m.guardian_phone ?? '-'}</td>
            <td>${m.facebook_link ? `<a href="${m.facebook_link}" target="_blank">رابط</a>` : '-'}</td>
            <td>${m.group_name ?? '-'}</td>
            <td><select onchange="assignKhadem(${m.id}, this.value)">${khademOptions(m.group_name, m.assigned_khadem_id)}</select></td>
            <td class="row-actions">
              <button class="btn" onclick='editMember(${JSON.stringify(m)})'>تعديل</button>
              <button class="btn danger" onclick="deleteMember(${m.id})">حذف</button>
            </td>
          </tr>`;
  }).join('');
}

async function renderMembers() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  const [members, khadam] = await Promise.all([api('/api/members'), api('/api/group-khadam')]);
  KHADAM_LIST = khadam;
  const isKhadem = ME.role === 'khadem';

  const groupField = isKhadem
    ? `<input value="${ME.group_name || ''}" disabled>`
    : `<select id="m_group" onchange="refreshKhadamSelect()"><option value="">بدون</option>${GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}</select>`;

  content.innerHTML = `
    <div class="card">
      <h3>إضافة مخدوم جديد</h3>
      <div class="grid">
        <div><label>الاسم</label><input id="m_name"></div>
        <div><label>السن</label><input id="m_age" type="number"></div>
        <div><label>رقم الهاتف</label><input id="m_phone"></div>
        <div><label>تاريخ الميلاد</label><input id="m_birth" type="date"></div>
        <div><label>العنوان</label><input id="m_address"></div>
        <div><label>موبايل ولي الأمر</label><input id="m_guardian_phone"></div>
        <div><label>رابط فيسبوك</label><input id="m_facebook"></div>
        <div><label>المجموعة</label>${groupField}</div>
        <div><label>الخادم المسؤول</label><select id="m_khadem"><option value="">اختر الفصل أولاً</option></select></div>
      </div>
      <div class="actions"><button class="btn" onclick="addMember()">إضافة</button></div>
    </div>
    <div class="card">
      <h3>قائمة المخدومين (${members.length})</h3>
      <div class="table-wrap"><table>
        <tr><th>الاسم</th><th>السن</th><th>الهاتف</th><th>تاريخ الميلاد</th><th>العنوان</th><th>موبايل ولي الأمر</th><th>فيسبوك</th><th>المجموعة</th><th>الخادم المسؤول</th><th></th></tr>
        ${memberRowsHtml(members)}
      </table></div>
    </div>`;
  refreshKhadamSelect();
}

async function addMember() {
  const body = {
    name: document.getElementById('m_name').value.trim(),
    age: +document.getElementById('m_age').value || null,
    phone: document.getElementById('m_phone').value.trim(),
    birth_date: document.getElementById('m_birth').value || null,
    address: document.getElementById('m_address').value.trim(),
    guardian_phone: document.getElementById('m_guardian_phone').value.trim(),
    facebook_link: document.getElementById('m_facebook').value.trim(),
    group_name: ME.role === 'khadem' ? ME.group_name : (document.getElementById('m_group').value || null),
    assigned_khadem_id: +document.getElementById('m_khadem').value || null
  };
  if (!body.name) { alert('اكتب اسم المخدوم'); return; }
  try {
    await api('/api/members', { method: 'POST', body: JSON.stringify(body) });
    renderMembers();
  } catch (e) { alert(e.message); }
}

// يحوّل تاريخ الميلاد لصيغة 2012-05-30. بيقبل 2012-05-30 أو 30/5/2012 وبيقبل الأرقام العربي
function normalizeBirthDate(v) {
  v = (v || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (!v) return null; // فاضي = سيب القديم
  let m = v.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined; // صيغة غلط
}

function editMember(m) {
  const name = prompt('الاسم:', m.name);
  if (name === null) return;
  const age = prompt('السن:', m.age ?? '');
  const phone = prompt('رقم الهاتف:', m.phone ?? '');
  const birthRaw = prompt('تاريخ الميلاد (مثال: 2012-05-30 أو 30/5/2012):', m.birth_date ?? '');
  const birth_date = normalizeBirthDate(birthRaw);
  if (birth_date === undefined) { alert('صيغة تاريخ الميلاد غلط، اكتبه زي: 2012-05-30'); return; }
  const address = prompt('العنوان:', m.address ?? '');
  const guardian_phone = prompt('موبايل ولي الأمر:', m.guardian_phone ?? '');
  const facebook_link = prompt('رابط فيسبوك:', m.facebook_link ?? '');
  let group_name;
  if (ME.role !== 'khadem') {
    const idx = prompt('المجموعة (اكتب رقم):\n' + GROUPS.map((g, i) => `${i + 1}) ${g}`).join('\n'), GROUPS.indexOf(m.group_name) + 1);
    if (idx && GROUPS[+idx - 1]) group_name = GROUPS[+idx - 1];
  }
  updateMember(m.id, { name, age: +age || null, phone, birth_date, address, guardian_phone, facebook_link, group_name });
}

async function updateMember(id, body) {
  await api('/api/members/' + id, { method: 'PUT', body: JSON.stringify(body) });
  renderMembers();
}

async function deleteMember(id) {
  if (!confirm('تأكيد حذف المخدوم؟')) return;
  await api('/api/members/' + id, { method: 'DELETE' });
  renderMembers();
}

// ---------------- الحضور ----------------
async function renderAttendance(date) {
  date = date || today();
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  const rows = await api('/api/attendance?date=' + date);
  content.innerHTML = `
    <div class="card">
      <label>تاريخ الاجتماع</label>
      <input type="date" id="att_date" value="${date}" onchange="renderAttendance(this.value)">
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <tr><th>الاسم</th><th>الحالة</th><th>تسجيل</th></tr>
        ${rows.map(r => `
          <tr>
            <td>${r.name}</td>
            <td id="att-status-${r.member_id}">${attendanceStatusHTML(r.present, r.reason)}</td>
            <td class="row-actions">
              <button class="btn" onclick="markAttendance(${r.member_id}, '${date}', 1)">حاضر</button>
              <button class="btn danger" onclick="markAttendanceAbsent(${r.member_id}, '${date}')">غائب</button>
              <button class="btn secondary" id="att-clear-${r.member_id}" style="${r.present === null ? 'display:none' : ''}" onclick="clearAttendance(${r.member_id}, '${date}')">↩️ إلغاء</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3">لا يوجد مخدومين</td></tr>'}
      </table></div>
    </div>`;
}

function attendanceStatusHTML(present, reason) {
  if (present === null) return '-';
  return `<span class="badge ${present ? 'present' : 'absent'}">${present ? 'حاضر' : 'غائب'}</span>` + (reason ? `<br><small>${reason}</small>` : '');
}

function updateAttendanceRowUI(member_id, present, reason) {
  const statusCell = document.getElementById('att-status-' + member_id);
  if (statusCell) statusCell.innerHTML = attendanceStatusHTML(present, reason);
  const clearBtn = document.getElementById('att-clear-' + member_id);
  if (clearBtn) clearBtn.style.display = present === null ? 'none' : '';
}

async function markAttendance(member_id, date, present, reason) {
  updateAttendanceRowUI(member_id, present, reason); // تحديث فوري من غير انتظار السيرفر
  try {
    await api('/api/attendance', { method: 'POST', body: JSON.stringify({ member_id, date, present, reason: reason || null }) });
    loadAlerts();
  } catch (e) {
    alert('حصل خطأ ومتسجلش: ' + e.message);
    renderAttendance(date);
  }
}

function markAttendanceAbsent(member_id, date) {
  const reason = prompt('سبب الغياب (اختياري):') || '';
  markAttendance(member_id, date, 0, reason);
}

async function clearAttendance(member_id, date) {
  if (!confirm('تأكيد إلغاء تسجيل هذا اليوم؟ (المخدوم نفسه مش هيتمسح)')) return;
  updateAttendanceRowUI(member_id, null, null);
  try {
    await api('/api/attendance', { method: 'DELETE', body: JSON.stringify({ member_id, date }) });
    loadAlerts();
  } catch (e) {
    alert('حصل خطأ: ' + e.message);
    renderAttendance(date);
  }
}

// ---------------- حضور الخدام ----------------
async function renderServants(date) {
  date = date || today();
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  const rows = await api('/api/servant-attendance?date=' + date);
  content.innerHTML = `
    <div class="card">
      <label>تاريخ الاجتماع</label>
      <input type="date" id="srv_date" value="${date}" onchange="renderServants(this.value)">
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <tr><th>الاسم</th><th>الحالة</th><th>تسجيل</th></tr>
        ${rows.map(r => `
          <tr>
            <td>${r.name}</td>
            <td id="srv-status-${r.khadem_id}">${attendanceStatusHTML(r.present, r.reason)}</td>
            <td class="row-actions">
              <button class="btn" onclick="markServant(${r.khadem_id}, '${date}', 1)">حاضر</button>
              <button class="btn danger" onclick="markServantAbsent(${r.khadem_id}, '${date}')">غائب</button>
              <button class="btn secondary" id="srv-clear-${r.khadem_id}" style="${r.present === null ? 'display:none' : ''}" onclick="clearServant(${r.khadem_id}, '${date}')">↩️ إلغاء</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3">لا يوجد خدام</td></tr>'}
      </table></div>
    </div>`;
}

function updateServantRowUI(khadem_id, present, reason) {
  const statusCell = document.getElementById('srv-status-' + khadem_id);
  if (statusCell) statusCell.innerHTML = attendanceStatusHTML(present, reason);
  const clearBtn = document.getElementById('srv-clear-' + khadem_id);
  if (clearBtn) clearBtn.style.display = present === null ? 'none' : '';
}

async function markServant(khadem_id, date, present, reason) {
  updateServantRowUI(khadem_id, present, reason);
  try {
    await api('/api/servant-attendance', { method: 'POST', body: JSON.stringify({ khadem_id, date, present, reason: reason || null }) });
    loadAlerts();
  } catch (e) {
    alert('حصل خطأ ومتسجلش: ' + e.message);
    renderServants(date);
  }
}

function markServantAbsent(khadem_id, date) {
  const reason = prompt('سبب الغياب (اختياري):') || '';
  markServant(khadem_id, date, 0, reason);
}

async function clearServant(khadem_id, date) {
  if (!confirm('تأكيد إلغاء تسجيل هذا اليوم؟ (الخادم نفسه مش هيتمسح)')) return;
  updateServantRowUI(khadem_id, null, null);
  try {
    await api('/api/servant-attendance', { method: 'DELETE', body: JSON.stringify({ khadem_id, date }) });
    loadAlerts();
  } catch (e) {
    alert('حصل خطأ: ' + e.message);
    renderServants(date);
  }
}

// ---------------- التقارير ----------------
async function renderReports() {
  const content = document.getElementById('content');
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const canSeeAllGroups = ME.role === 'admin' || ME.role === 'amin_khedma';

  const groupFilter = canSeeAllGroups
    ? `<label>الفصل</label>
       <select id="rep_group" onchange="loadAttendanceReport()">
         <option value="">كل الفصول</option>
         ${GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}
       </select>`
    : `<div class="sub">فصلك: ${ME.group_name || '-'}</div>`;

  content.innerHTML = `
    <div class="card">
      <h3>📊 تقرير الحضور والغياب</h3>
      ${groupFilter}
      <div class="grid" style="margin-top:10px;">
        <div><label>من تاريخ</label><input type="date" id="rep_from"></div>
        <div><label>إلى تاريخ</label><input type="date" id="rep_to"></div>
      </div>
      <div class="actions"><button class="btn" onclick="loadAttendanceReport()">عرض</button></div>
      <div id="rep_att_table" style="margin-top:12px;"></div>
    </div>
    ${canSeeAllGroups ? `
    <div class="card">
      <h3>🎂 أعياد الميلاد</h3>
      <label>الشهر</label>
      <select id="rep_month" onchange="loadBirthdays()">
        ${Array.from({length:12}, (_,i)=>{const v=String(i+1).padStart(2,'0'); return `<option value="${v}" ${v===month?'selected':''}>${v}</option>`}).join('')}
      </select>
      <div id="rep_bday_table" style="margin-top:12px;"></div>
    </div>` : ''}`;
  loadAttendanceReport();
  if (canSeeAllGroups) loadBirthdays();
}

async function loadAttendanceReport() {
  const from = document.getElementById('rep_from').value;
  const to = document.getElementById('rep_to').value;
  const group = ME.role === 'khadem' ? '' : (document.getElementById('rep_group')?.value || '');
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (group) q.set('group_name', group);
  const rows = await api('/api/reports/attendance?' + q.toString());
  document.getElementById('rep_att_table').innerHTML = `
    <div class="table-wrap"><table>
      <tr><th>التاريخ</th><th>حاضر</th><th>غائب</th></tr>
      ${rows.map(r => `<tr><td><a href="#" onclick="showDayDetails('${r.date}'); return false;">${r.date} 🔍</a></td><td>${r.present_count}</td><td>${r.absent_count}</td></tr>`).join('') || '<tr><td colspan="3">لا بيانات</td></tr>'}
    </table></div>`;
}

async function loadBirthdays() {
  const month = document.getElementById('rep_month').value;
  const rows = await api('/api/reports/birthdays?month=' + month);
  document.getElementById('rep_bday_table').innerHTML = `
    <div class="table-wrap"><table>
      <tr><th>الاسم</th><th>تاريخ الميلاد</th><th>المجموعة</th></tr>
      ${rows.map(r => `<tr><td>${r.name}</td><td>${r.birth_date}</td><td>${r.group_name ?? '-'}</td></tr>`).join('') || '<tr><td colspan="3">لا أعياد ميلاد هذا الشهر</td></tr>'}
    </table></div>`;
}

// ---------------- المستخدمين (أدمن + أمين خدمة) ----------------
async function renderUsers() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  const users = await api('/api/users');
  const isAdmin = ME.role === 'admin';

  const roleOptions = isAdmin
    ? `<option value="khadem">خادم</option><option value="amin_khedma">أمين خدمة</option><option value="admin">أدمن</option>`
    : `<option value="khadem">خادم</option>`;

  content.innerHTML = `
    <div class="card">
      <h3>إضافة مستخدم جديد</h3>
      <div class="grid">
        <div><label>الاسم</label><input id="u_name"></div>
        <div><label>اسم المستخدم</label><input id="u_username"></div>
        <div><label>كلمة المرور</label><input id="u_password" type="password"></div>
        <div><label>الصلاحية</label>
          <select id="u_role" onchange="toggleGroupField()">${roleOptions}</select>
        </div>
        <div id="u_group_wrap"><label>المجموعة (للخادم فقط)</label>
          <select id="u_group"><option value="">اختر المجموعة</option>${GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}</select>
        </div>
      </div>
      <div class="actions"><button class="btn" onclick="addUser()">إضافة</button></div>
    </div>
    <div class="card">
      <h3>المستخدمون</h3>
      <div class="table-wrap"><table>
        <tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>المجموعة</th><th>تليجرام</th><th>مفعّل</th><th></th></tr>
        ${users.map(u => `
          <tr>
            <td>${u.name}</td><td>${u.username}</td><td>${ROLE_LABEL[u.role]}</td><td>${u.group_name ?? '-'}</td>
            <td>${u.telegram_linked ? `✅ مربوط <button class="btn secondary" onclick="resetTelegram(${u.id})">🔄 تغيير</button>` : (u.telegram_link ? `<a href="${u.telegram_link}" target="_blank">لينك الربط</a>` : '-')}</td>
            <td>${u.active ? 'نعم' : 'لا'}</td>
            <td class="row-actions">
              <button class="btn" onclick='editUser(${JSON.stringify({ id: u.id, name: u.name, group_name: u.group_name, role: u.role })})'>تعديل</button>
              <button class="btn" onclick="resetPassword(${u.id})">🔑 كلمة</button>
              <button class="btn" onclick="toggleUser(${u.id}, ${u.active ? 0 : 1})">${u.active ? 'تعطيل' : 'تفعيل'}</button>
              <button class="btn danger" onclick="deleteUser(${u.id})">حذف</button>
            </td>
          </tr>`).join('')}
      </table></div>
    </div>`;
}

function editUser(u) {
  const name = prompt('الاسم:', u.name);
  if (name === null) return;
  let group_name = u.group_name;
  if (u.role === 'khadem') {
    const idx = prompt('المجموعة (اكتب رقم):\n' + GROUPS.map((g, i) => `${i + 1}) ${g}`).join('\n'), GROUPS.indexOf(u.group_name) + 1);
    if (idx && GROUPS[+idx - 1]) group_name = GROUPS[+idx - 1];
  }
  api('/api/users/' + u.id, { method: 'PUT', body: JSON.stringify({ name, group_name }) })
    .then(renderUsers)
    .catch(e => alert(e.message));
}

async function resetTelegram(id) {
  if (!confirm('تأكيد تصفير ربط تليجرام؟ هيظهر اللينك تاني عشان تبعته لربط جديد')) return;
  await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ reset_telegram: true }) });
  renderUsers();
}

function resetPassword(id) {
  const newPassword = prompt('اكتب كلمة المرور الجديدة:');
  if (!newPassword) return;
  api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ password: newPassword }) })
    .then(() => alert('تم تغيير كلمة المرور بنجاح ✅'))
    .catch(e => alert(e.message));
}

function toggleGroupField() {
  const role = document.getElementById('u_role').value;
  document.getElementById('u_group_wrap').style.display = role === 'khadem' ? 'block' : 'none';
}

async function addUser() {
  const role = document.getElementById('u_role').value;
  const body = {
    name: document.getElementById('u_name').value.trim(),
    username: document.getElementById('u_username').value.trim(),
    password: document.getElementById('u_password').value,
    role,
    group_name: role === 'khadem' ? document.getElementById('u_group').value : null
  };
  if (!body.name || !body.username || !body.password) { alert('أكمل كل الحقول'); return; }
  if (role === 'khadem' && !body.group_name) { alert('اختر مجموعة (فصل) للخادم'); return; }
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    renderUsers();
  } catch (e) { alert(e.message); }
}

async function toggleUser(id, active) {
  await api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ active }) });
  renderUsers();
}
async function deleteUser(id) {
  if (!confirm('تأكيد حذف المستخدم؟')) return;
  await api('/api/users/' + id, { method: 'DELETE' });
  renderUsers();
}

// ---------------- تقارير الخدام ----------------
async function renderServantsReport() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <h3>📋 تقرير حضور وغياب الخدام</h3>
      <label>الفصل</label>
      <select id="srep_group" onchange="loadServantsReport()">
        <option value="">كل الفصول</option>
        ${GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}
      </select>
      <div class="grid" style="margin-top:10px;">
        <div><label>من تاريخ</label><input type="date" id="srep_from"></div>
        <div><label>إلى تاريخ</label><input type="date" id="srep_to"></div>
      </div>
      <div class="actions"><button class="btn" onclick="loadServantsReport()">عرض</button></div>
      <div id="srep_table" style="margin-top:12px;"></div>
    </div>`;
  loadServantsReport();
}

async function loadServantsReport() {
  const q = new URLSearchParams();
  const from = document.getElementById('srep_from').value;
  const to = document.getElementById('srep_to').value;
  const group = document.getElementById('srep_group').value;
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (group) q.set('group_name', group);
  const rows = await api('/api/reports/servants-attendance?' + q.toString());
  document.getElementById('srep_table').innerHTML = `
    <div class="table-wrap"><table>
      <tr><th>التاريخ</th><th>حاضر</th><th>غائب</th></tr>
      ${rows.map(r => `<tr><td><a href="#" onclick="showDayDetails('${r.date}'); return false;">${r.date} 🔍</a></td><td>${r.present_count}</td><td>${r.absent_count}</td></tr>`).join('') || '<tr><td colspan="3">لا بيانات</td></tr>'}
    </table></div>`;
}

// ---------------- تفاصيل يوم في التقرير ----------------
function dayListHtml(rows) {
  const present = rows.filter(r => r.present === 1);
  const absent = rows.filter(r => r.present !== 1);
  return `
    <b>✅ الحاضرين (${present.length}):</b>
    <div>${present.map(r => `- ${r.name}`).join('<br>') || '(لا يوجد)'}</div>
    <br>
    <b>❌ الغائبين (${absent.length}):</b>
    <div>${absent.map(r => `- ${r.name}` + (r.reason ? ` (السبب: ${r.reason})` : '')).join('<br>') || '(لا يوجد)'}</div>`;
}

async function showDayDetails(date) {
  const isServants = !!document.getElementById('srep_table');
  const group = isServants
    ? (document.getElementById('srep_group')?.value || '')
    : (ME.role === 'khadem' ? '' : (document.getElementById('rep_group')?.value || ''));
  const q = new URLSearchParams({ type: isServants ? 'servants' : 'members', date });
  if (group) q.set('group_name', group);
  const rows = await api('/api/reports/day-details?' + q.toString());

  let body;
  if (isServants) {
    body = dayListHtml(rows);
  } else {
    const groups = new Map();
    rows.forEach(r => {
      const key = (r.group_name || '') + '|' + r.khadem_name;
      if (!groups.has(key)) groups.set(key, { title: (r.group_name ? r.group_name + ' — ' : '') + 'الخادم: ' + r.khadem_name, rows: [] });
      groups.get(key).rows.push(r);
    });
    body = [...groups.values()].map(g => `<div style="margin-bottom:14px;"><h4>👤 ${g.title}</h4>${dayListHtml(g.rows)}</div>`).join('') || '(لا بيانات)';
  }

  const html = `
    <div class="card" id="day_details" style="margin-top:12px;background:#fbf7ec;">
      <h4>📅 تفاصيل يوم ${date}</h4>
      ${body}
    </div>`;
  const old = document.getElementById('day_details');
  if (old) old.remove();
  document.getElementById(isServants ? 'srep_table' : 'rep_att_table').insertAdjacentHTML('afterend', html);
}


init();

