let ME = null;
const GROUPS = ['أولى إعدادي', 'تانية إعدادي', 'تالتة إعدادي'];
const today = () => new Date().toISOString().slice(0, 10);

const ROLE_LABEL = { admin: 'أدمن', amin_khedma: 'أمين خدمة', khadem: 'خادم' };

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

function buildTabs() {
  const tabs = [{ id: 'members', label: '👦 المخدومين' }, { id: 'attendance', label: '✅ الحضور' }];
  if (ME.role === 'admin' || ME.role === 'amin_khedma') {
    tabs.push({ id: 'servants', label: '👨‍🏫 حضور الخدام' });
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
    servants: renderServants, reports: renderReports, users: renderUsers
  };
  renderers[id] && renderers[id]();
}

async function loadAlerts() {
  try {
    const data = await api('/api/alerts/latest');
    const box = document.getElementById('alertBox');
    if (!data.date) { box.innerHTML = ''; return; }
    const parts = [];
    if (data.absentMembers.length) parts.push(`غياب مخدومين: ${data.absentMembers.join('، ')}`);
    if (data.absentServants.length) parts.push(`غياب خدام: ${data.absentServants.join('، ')}`);
    box.innerHTML = parts.length
      ? `<div class="alert">🔔 تنبيه غياب بتاريخ ${data.date}<br>${parts.join('<br>')}</div>`
      : `<div class="alert ok">✅ لا يوجد غياب مسجل بتاريخ ${data.date}</div>`;
  } catch (e) { /* تجاهل */ }
}

// ---------------- المخدومين ----------------
async function renderMembers() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  const members = await api('/api/members');
  const isKhadem = ME.role === 'khadem';

  const groupField = isKhadem
    ? `<input value="${ME.group_name || ''}" disabled>`
    : `<select id="m_group"><option value="">بدون</option>${GROUPS.map(g => `<option value="${g}">${g}</option>`).join('')}</select>`;

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
      </div>
      <div class="actions"><button class="btn" onclick="addMember()">إضافة</button></div>
    </div>
    <div class="card">
      <h3>قائمة المخدومين (${members.length})</h3>
      <table>
        <tr><th>الاسم</th><th>السن</th><th>الهاتف</th><th>موبايل ولي الأمر</th><th>فيسبوك</th><th>المجموعة</th><th></th></tr>
        ${members.map(m => `
          <tr>
            <td>${m.name}</td><td>${m.age ?? '-'}</td><td>${m.phone ?? '-'}</td>
            <td>${m.guardian_phone ?? '-'}</td>
            <td>${m.facebook_link ? `<a href="${m.facebook_link}" target="_blank">رابط</a>` : '-'}</td>
            <td>${m.group_name ?? '-'}</td>
            <td>
              <button class="btn" onclick='editMember(${JSON.stringify(m)})'>تعديل</button>
              <button class="btn danger" onclick="deleteMember(${m.id})">حذف</button>
            </td>
          </tr>`).join('')}
      </table>
    </div>`;
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
    group_name: ME.role === 'khadem' ? ME.group_name : (document.getElementById('m_group').value || null)
  };
  if (!body.name) { alert('اكتب اسم المخدوم'); return; }
  await api('/api/members', { method: 'POST', body: JSON.stringify(body) });
  renderMembers();
}

function editMember(m) {
  const name = prompt('الاسم:', m.name);
  if (name === null) return;
  const age = prompt('السن:', m.age ?? '');
  const phone = prompt('رقم الهاتف:', m.phone ?? '');
  const address = prompt('العنوان:', m.address ?? '');
  const guardian_phone = prompt('موبايل ولي الأمر:', m.guardian_phone ?? '');
  const facebook_link = prompt('رابط فيسبوك:', m.facebook_link ?? '');
  updateMember(m.id, { name, age: +age || null, phone, address, guardian_phone, facebook_link });
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
      <table>
        <tr><th>الاسم</th><th>الحالة</th><th>تسجيل</th></tr>
        ${rows.map(r => `
          <tr>
            <td>${r.name}</td>
            <td>${r.present === null ? '-' : `<span class="badge ${r.present ? 'present' : 'absent'}">${r.present ? 'حاضر' : 'غائب'}</span>` + (r.reason ? `<br><small>${r.reason}</small>` : '')}</td>
            <td>
              <button class="btn" onclick="markAttendance(${r.member_id}, '${date}', 1)">حاضر</button>
              <button class="btn danger" onclick="markAttendanceAbsent(${r.member_id}, '${date}')">غائب</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3">لا يوجد مخدومين</td></tr>'}
      </table>
    </div>`;
}

async function markAttendance(member_id, date, present, reason) {
  await api('/api/attendance', { method: 'POST', body: JSON.stringify({ member_id, date, present, reason: reason || null }) });
  renderAttendance(date);
  loadAlerts();
}

function markAttendanceAbsent(member_id, date) {
  const reason = prompt('سبب الغياب (اختياري):') || '';
  markAttendance(member_id, date, 0, reason);
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
      <table>
        <tr><th>الاسم</th><th>الحالة</th><th>تسجيل</th></tr>
        ${rows.map(r => `
          <tr>
            <td>${r.name}</td>
            <td>${r.present === null ? '-' : `<span class="badge ${r.present ? 'present' : 'absent'}">${r.present ? 'حاضر' : 'غائب'}</span>` + (r.reason ? `<br><small>${r.reason}</small>` : '')}</td>
            <td>
              <button class="btn" onclick="markServant(${r.khadem_id}, '${date}', 1)">حاضر</button>
              <button class="btn danger" onclick="markServantAbsent(${r.khadem_id}, '${date}')">غائب</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="3">لا يوجد خدام</td></tr>'}
      </table>
    </div>`;
}

async function markServant(khadem_id, date, present, reason) {
  await api('/api/servant-attendance', { method: 'POST', body: JSON.stringify({ khadem_id, date, present, reason: reason || null }) });
  renderServants(date);
  loadAlerts();
}

function markServantAbsent(khadem_id, date) {
  const reason = prompt('سبب الغياب (اختياري):') || '';
  markServant(khadem_id, date, 0, reason);
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
    <table>
      <tr><th>التاريخ</th><th>حاضر</th><th>غائب</th></tr>
      ${rows.map(r => `<tr><td>${r.date}</td><td>${r.present_count}</td><td>${r.absent_count}</td></tr>`).join('') || '<tr><td colspan="3">لا بيانات</td></tr>'}
    </table>`;
}

async function loadBirthdays() {
  const month = document.getElementById('rep_month').value;
  const rows = await api('/api/reports/birthdays?month=' + month);
  document.getElementById('rep_bday_table').innerHTML = `
    <table>
      <tr><th>الاسم</th><th>تاريخ الميلاد</th><th>المجموعة</th></tr>
      ${rows.map(r => `<tr><td>${r.name}</td><td>${r.birth_date}</td><td>${r.group_name ?? '-'}</td></tr>`).join('') || '<tr><td colspan="3">لا أعياد ميلاد هذا الشهر</td></tr>'}
    </table>`;
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
      <table>
        <tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>المجموعة</th><th>تليجرام</th><th>مفعّل</th><th></th></tr>
        ${users.map(u => `
          <tr>
            <td>${u.name}</td><td>${u.username}</td><td>${ROLE_LABEL[u.role]}</td><td>${u.group_name ?? '-'}</td>
            <td>${u.telegram_linked ? '✅ مربوط' : (u.telegram_link ? `<a href="${u.telegram_link}" target="_blank">لينك الربط</a>` : '-')}</td>
            <td>${u.active ? 'نعم' : 'لا'}</td>
            <td>
              <button class="btn" onclick='editUser(${JSON.stringify({ id: u.id, name: u.name, group_name: u.group_name, role: u.role })})'>تعديل</button>
              <button class="btn" onclick="toggleUser(${u.id}, ${u.active ? 0 : 1})">${u.active ? 'تعطيل' : 'تفعيل'}</button>
              <button class="btn danger" onclick="deleteUser(${u.id})">حذف</button>
            </td>
          </tr>`).join('')}
      </table>
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

init();
