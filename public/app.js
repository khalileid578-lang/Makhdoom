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
              <button class="btn" onclick="showMemberSheet(${m.id})">📅 الحضور</button>
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

// صفحة حضور مخدوم واحد: كل الاجتماعات، ✔ أخضر للحاضر و ✘ أحمر للغايب (شكل شيت إكسيل)
async function showMemberSheet(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card">جارِ التحميل...</div>';
  try {
    const d = await api('/api/members/' + id + '/attendance');
    const pct = d.total ? Math.round(d.present_count * 100 / d.total) : 0;
    const cell = 'border:1px solid #b9b9b9;padding:8px 10px;text-align:center;';
    const rowsHtml = d.meetings.map((r, i) => {
      const day = new Date(r.date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long' });
      const status = r.present
        ? `<td style="${cell}background:rgba(46,160,67,.25);color:#1f9d3a;font-weight:bold;font-size:20px;">✔</td>`
        : `<td style="${cell}background:rgba(229,72,77,.22);color:#d93036;font-weight:bold;font-size:20px;">✘</td>`;
      return `<tr><td style="${cell}">${i + 1}</td><td style="${cell}">${r.date}</td><td style="${cell}">${day}</td>${status}<td style="${cell}">${r.reason || ''}</td></tr>`;
    }).join('');
    content.innerHTML = `
      <div class="card">
        <button class="btn" onclick="renderMembers()">← رجوع للمخدومين</button>
        <h3 style="margin-top:12px;">📅 سجل حضور: ${d.name}</h3>
        <p>${d.group_name || ''}${d.khadem_name ? ' — الخادم: ' + d.khadem_name : ''}</p>
        <p><b>حضر ${d.present_count} من ${d.total} اجتماع (${pct}%)</b></p>
        <div class="table-wrap"><table style="border-collapse:collapse;width:100%;">
          <tr><th style="${cell}">#</th><th style="${cell}">التاريخ</th><th style="${cell}">اليوم</th><th style="${cell}">الحضور</th><th style="${cell}">السبب</th></tr>
          ${rowsHtml || `<tr><td colspan="5" style="${cell}">لسه مفيش اجتماعات متسجلة</td></tr>`}
        </table></div>
      </div>`;
  } catch (e) { alert(e.message); renderMembers(); }
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
  document.getElementById('rep_bday_table'
