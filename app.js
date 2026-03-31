// ══════════════════════════════════════════════════════
//  부서업무관리 app.js — Firebase Firestore 버전
// ══════════════════════════════════════════════════════

// ── 상수 ──────────────────────────────────────────────
const COLORS = ['#4f6ef7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const DEFAULT_NOTICE =
`• 업무는 해당 월의 본인 탭에서 직접 입력합니다.
• 업무명은 간결하게 작성하고, 세부 내용은 메모란을 활용해 주세요.
• 날짜는 업무 예정일 또는 완료일 기준으로 입력합니다.
• 전체 보기에서 부서원 전체의 이번 달 업무를 확인할 수 있습니다.
• 문의 사항은 팀장에게 연락 바랍니다.`;

// ── 상태 ──────────────────────────────────────────────
let members        = [];
let tasks          = [];
let sites          = [];
let memberSites    = [];
let memberNotices  = {};
let noticeText     = DEFAULT_NOTICE;
let noticeBeforeEdit = '';

let currentView     = 'all';
let currentMemberId = null;
let currentYear     = new Date().getFullYear();
let currentMonth    = new Date().getMonth() + 1;
let selectedColor   = COLORS[0];
let currentUserId   = sessionStorage.getItem('workium_user') || null;
let _pendingLoginId = null;

let _ready = false;
const _loaded = { members: false, tasks: false, sites: false, notice: false, memberSites: false, memberNotices: false };

// ── Firebase 초기화 ────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const ts = () => firebase.firestore.FieldValue.serverTimestamp();

// ── Firestore CRUD ─────────────────────────────────────

async function dbAddMember(data) {
  await db.collection('members').add({ ...data, createdAt: ts() });
}
async function dbUpdateMember(id, data) {
  await db.collection('members').doc(id).update(data);
}
async function dbDeleteMember(id) {
  await db.collection('members').doc(id).delete();
  const snap = await db.collection('tasks').where('memberId', '==', id).get();
  if (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

async function dbAddTask(data) {
  await db.collection('tasks').add({ ...data, createdAt: ts() });
}
async function dbUpdateTask(id, data) {
  await db.collection('tasks').doc(id).update(data);
}
async function dbDeleteTask(id) {
  await db.collection('tasks').doc(id).delete();
}

async function dbAddMemberSite(data) {
  await db.collection('memberSites').add({ ...data, createdAt: ts() });
}
async function dbUpdateMemberSite(id, data) {
  await db.collection('memberSites').doc(id).update(data);
}
async function dbDeleteMemberSite(id) {
  await db.collection('memberSites').doc(id).delete();
}

async function dbAddSite(data) {
  await db.collection('sites').add({ ...data, createdAt: ts() });
}
async function dbUpdateSite(id, data) {
  await db.collection('sites').doc(id).update(data);
}
async function dbDeleteSite(id) {
  await db.collection('sites').doc(id).delete();
}

async function dbSaveNotice(text) {
  await db.collection('config').doc('notice').set({ text });
}

// ── 로딩 ──────────────────────────────────────────────
function showLoading() { document.getElementById('loadingOverlay').style.display = 'flex'; }
function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }

// ── 실시간 리스너 ──────────────────────────────────────
function _checkReady() {
  if (_ready) return;
  if (!_loaded.members || !_loaded.tasks || !_loaded.sites || !_loaded.notice || !_loaded.memberSites || !_loaded.memberNotices) return;
  _ready = true;
  hideLoading();
  updateMonthLabel();
  updateYearLabel();
  renderCurrentUser();
  renderSidebar();
  renderNotice();
  renderSites();
  renderAll();
  if (!currentUserId) openLoginModal();
}

function initListeners() {
  db.collection('members').orderBy('createdAt').onSnapshot(snap => {
    members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_loaded.members) { _loaded.members = true; _checkReady(); return; }
    renderSidebar();
    renderCurrentUser();
    _refreshView();
  }, e => console.error(e));

  db.collection('tasks').onSnapshot(snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_loaded.tasks) { _loaded.tasks = true; _checkReady(); return; }
    _refreshView();
  }, e => console.error(e));

  db.collection('sites').orderBy('createdAt').onSnapshot(snap => {
    sites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_loaded.sites) { _loaded.sites = true; _checkReady(); return; }
    renderSites();
  }, e => console.error(e));

  db.collection('config').doc('notice').onSnapshot(doc => {
    noticeText = doc.exists ? doc.data().text : DEFAULT_NOTICE;
    if (!_loaded.notice) { _loaded.notice = true; _checkReady(); return; }
    renderNotice();
  }, e => console.error(e));

  db.collection('memberSites').orderBy('createdAt').onSnapshot(snap => {
    memberSites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_loaded.memberSites) { _loaded.memberSites = true; _checkReady(); return; }
    if (currentView === 'member') renderMemberSites();
  }, e => console.error(e));

  db.collection('memberNotices').onSnapshot(snap => {
    memberNotices = {};
    snap.docs.forEach(d => { memberNotices[d.id] = d.data().text || ''; });
    if (!_loaded.memberNotices) { _loaded.memberNotices = true; _checkReady(); return; }
    if (currentView === 'member') renderMemberNotice();
  }, e => console.error(e));
}

function _refreshView() {
  if (!_ready) return;
  if (currentView === 'all')    renderAll();
  if (currentView === 'member') { renderMemberNotice(); renderMemberSites(); renderMemberTasks(); }
  if (currentView === 'manage') renderManage();
}

// ── 유틸 ──────────────────────────────────────────────
function getMember(id) { return members.find(m => m.id === id); }

function isBoss() {
  return !!currentUserId && getMember(currentUserId)?.role === '부장';
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function fmtDay(dateStr) {
  if (!dateStr) return '';
  const [, mo, d] = dateStr.split('-');
  return `${parseInt(mo)}월 ${parseInt(d)}일`;
}

function fmtFull(dateStr) {
  if (!dateStr) return '';
  const [y, mo, d] = dateStr.split('-');
  return `${y}.${mo}.${d}`;
}

function avatarHtml(m, size) {
  const s = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size*0.4)}px;` : '';
  return `<div class="avatar-circle" style="background:${m.color};${s}">${m.name[0]}</div>`;
}

function getTasksForMonth(memberId, year, month) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`;
  return tasks
    .filter(t => t.memberId === memberId && t.date && t.date.startsWith(prefix))
    .sort((a, b) => (a.date||'').localeCompare(b.date||''));
}

// ── 사이드바 ──────────────────────────────────────────
function renderSidebar() {
  const el = document.getElementById('memberNavList');
  el.innerHTML = members.map(m => `
    <button class="nav-member ${currentView==='member' && currentMemberId===m.id ? 'active' : ''}"
            data-id="${m.id}" onclick="selectView('member','${m.id}')">
      ${avatarHtml(m)}
      <span>${escHtml(m.name)}</span>
    </button>`).join('');
  document.querySelector('.nav-member[data-id="all"]')
    ?.classList.toggle('active', currentView === 'all');
}

// ── 뷰 전환 ──────────────────────────────────────────
function selectView(view, memberId) {
  currentView     = view;
  currentMemberId = memberId || null;

  document.querySelectorAll('.view').forEach(v => {
    v.style.display = 'none'; v.classList.remove('active');
  });
  const showEl = id => {
    const el = document.getElementById(id);
    el.style.display = 'block'; el.classList.add('active');
  };

  ['headerAll','headerMember','headerManage'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  document.getElementById('monthNav').style.display     = 'none';
  document.getElementById('yearNav').style.display      = 'none';
  document.getElementById('addTaskBtn').style.display   = 'none';
  document.getElementById('addMemberBtn').style.display = 'none';

  if (view === 'all') {
    showEl('view-all');
    document.getElementById('headerAll').style.display = 'flex';
    document.getElementById('monthNav').style.display  = 'flex';
    updateMonthLabel();
    renderAll();
  } else if (view === 'member') {
    const m = getMember(memberId);
    if (!m) return;
    showEl('view-member');
    document.getElementById('headerMember').style.display = 'flex';
    document.getElementById('memberAvatarHeader').style.background = m.color;
    document.getElementById('memberAvatarHeader').textContent = m.name[0];
    document.getElementById('memberNameHeader').textContent   = m.name;
    document.getElementById('memberRoleHeader').textContent   = m.role || '';
    document.getElementById('yearNav').style.display = 'flex';
    updateYearLabel();
    renderMemberNotice();
    renderMemberSites();
    renderMemberTasks();
  } else if (view === 'manage') {
    if (!isBoss() && members.length > 0) { showToast('부장만 접근할 수 있습니다.'); return; }
    showEl('view-manage');
    document.getElementById('headerManage').style.display    = 'flex';
    document.getElementById('addMemberBtn').style.display    = isBoss() ? 'inline-flex' : 'none';
    renderManage();
  }
  renderSidebar();
}

function openMembersPage() { selectView('manage'); }

// ── 월/연도 네비게이션 ────────────────────────────────
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1;  currentYear++; }
  if (currentMonth < 1)  { currentMonth = 12; currentYear--; }
  updateMonthLabel();
  renderAll();
}
function updateMonthLabel() {
  document.getElementById('monthLabel').textContent = `${currentYear}년 ${currentMonth}월`;
}

function changeYear(delta) {
  currentYear += delta;
  updateYearLabel();
  renderMemberTasks();
}
function updateYearLabel() {
  document.getElementById('yearLabel').textContent = `${currentYear}년`;
}

// ── 전체 보기 ─────────────────────────────────────────
function renderAll() {
  const grid = document.getElementById('allGrid');
  if (members.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      </svg>
      <p>부서원을 먼저 추가해주세요.</p></div>`;
    return;
  }
  grid.innerHTML = members.map(m => {
    const mTasks = getTasksForMonth(m.id, currentYear, currentMonth);
    const rows = mTasks.length
      ? mTasks.map(t => `
          <div class="all-task-row">
            <div class="task-date-dot" style="background:${m.color}"></div>
            <div class="all-task-info">
              <div class="all-task-title">${escHtml(t.title)}</div>
              ${t.memo ? `<div class="all-task-memo">${escHtml(t.memo)}</div>` : ''}
            </div>
          </div>`).join('')
      : `<div class="all-empty">이번 달 업무 없음</div>`;
    return `
    <div class="all-member-card">
      <div class="all-member-card-header" onclick="selectView('member','${m.id}')">
        ${avatarHtml(m, 36)}
        <div>
          <div class="name">${escHtml(m.name)}</div>
          <div class="role">${escHtml(m.role || '')}</div>
          ${m.email ? `<div class="all-member-contact">${escHtml(m.email)}</div>` : ''}
        </div>
        <span class="task-count-badge">${mTasks.length}건</span>
      </div>
      <div class="all-member-tasks">${rows}</div>
    </div>`;
  }).join('');
}

// ── 개인 업무 뷰 (12개 월 섹션) ──────────────────────
function renderMemberTasks() {
  const wrap = document.getElementById('memberTasksWrap');
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const m = getMember(currentMemberId);
  const dotColor = m ? m.color : '#4f6ef7';

  const canEdit = isBoss() || currentUserId === currentMemberId;

  wrap.innerHTML = MONTHS.map((label, idx) => {
    const mo     = idx + 1;
    const mTasks = getTasksForMonth(currentMemberId, currentYear, mo);
    const rows   = mTasks.length
      ? mTasks.map(t => `
        <tr>
          <td>
            <div class="td-title">${escHtml(t.title)}</div>
            ${t.memo ? `<div class="td-memo">${escHtml(t.memo)}</div>` : ''}
          </td>
          ${canEdit ? `<td class="td-actions">
            <button class="btn-icon" onclick="openTaskModal('${t.id}')" title="수정">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon btn-del" onclick="deleteTask('${t.id}')" title="삭제">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </td>` : ''}
        </tr>`).join('')
      : `<tr><td colspan="${canEdit ? 2 : 1}" class="td-empty">등록된 업무가 없습니다.</td></tr>`;

    return `
    <div class="month-section">
      <div class="month-section-header">
        <span class="month-dot" style="background:${dotColor}"></span>
        <h3 class="month-section-title">${label}</h3>
        <span class="month-task-cnt">${mTasks.length}건</span>
        ${canEdit ? `<button class="btn-add-task" onclick="openTaskModal(null,${mo})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          업무 추가
        </button>` : ''}
      </div>
      <table class="task-table"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
}

// ── 부서원 업무 안내 ──────────────────────────────────
function renderMemberNotice() {
  const wrap = document.getElementById('memberNoticeWrap');
  if (!wrap) return;
  const canEdit = isBoss() || currentUserId === currentMemberId;
  const text    = memberNotices[currentMemberId] || '';

  wrap.innerHTML = `
    <div class="notice-panel" style="margin-bottom:20px">
      <div class="notice-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8h1a4 4 0 010 8h-1"/>
          <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
          <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
        </svg>
        <span class="notice-label">업무 안내</span>
        ${canEdit ? `
          <button class="notice-edit-btn" id="memberNoticeEditBtn" onclick="toggleMemberNoticeEdit()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            편집
          </button>` : ''}
      </div>
      <div class="notice-content" id="memberNoticeContent">
        ${text ? escHtml(text).replace(/\n/g,'<br>') : '<span style="opacity:.4">업무 안내 사항을 입력하세요.</span>'}
      </div>
      <div class="notice-edit-area" id="memberNoticeEditArea" style="display:none">
        <textarea id="memberNoticeTextarea" rows="4" placeholder="업무에서 꼭 알아야 할 사항을 입력하세요.">${escHtml(text)}</textarea>
        <div class="notice-edit-actions">
          <button class="btn btn-ghost btn-sm" onclick="cancelMemberNoticeEdit()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="saveMemberNotice()">저장</button>
        </div>
      </div>
    </div>`;
}

function toggleMemberNoticeEdit() {
  document.getElementById('memberNoticeContent').style.display  = 'none';
  document.getElementById('memberNoticeEditArea').style.display = 'block';
  document.getElementById('memberNoticeEditBtn').style.display  = 'none';
  document.getElementById('memberNoticeTextarea').focus();
}

function cancelMemberNoticeEdit() {
  document.getElementById('memberNoticeContent').style.display  = 'block';
  document.getElementById('memberNoticeEditArea').style.display = 'none';
  document.getElementById('memberNoticeEditBtn').style.display  = 'inline-flex';
}

async function saveMemberNotice() {
  const text = document.getElementById('memberNoticeTextarea').value;
  try {
    await db.collection('memberNotices').doc(currentMemberId).set({ text });
    showToast('업무 안내가 저장되었습니다.');
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 부서원 추천 사이트 ────────────────────────────────
function renderMemberSites() {
  const wrap = document.getElementById('memberSitesWrap');
  if (!wrap) return;
  const canEdit = isBoss() || currentUserId === currentMemberId;
  const mSites  = memberSites.filter(s => s.memberId === currentMemberId);

  const editBtns = `
    <div class="site-actions">
      <button class="btn-icon" onclick="openMemberSiteModal('__ID__')" title="수정">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn-icon btn-del" onclick="deleteMemberSite('__ID__')" title="삭제">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`;

  const sitesHtml = mSites.length
    ? mSites.map(s => `
      <div class="site-item">
        <div class="site-favicon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
        </div>
        <div class="site-info">
          <a href="${escHtml(s.url)}" target="_blank" rel="noopener" class="site-name">${escHtml(s.name)}</a>
          ${s.desc ? `<span class="site-desc">${escHtml(s.desc)}</span>` : ''}
        </div>
        ${canEdit ? editBtns.replaceAll('__ID__', s.id) : ''}
      </div>`).join('')
    : `<span style="font-size:13px;color:#b45309;opacity:.6">등록된 사이트가 없습니다.</span>`;

  wrap.innerHTML = `
    <div class="notice-panel sites-panel" style="margin-bottom:20px">
      <div class="notice-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
        </svg>
        <span class="notice-label">추천 사이트</span>
        ${canEdit ? `
          <button class="notice-edit-btn" onclick="openMemberSiteModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            추가
          </button>` : ''}
      </div>
      <div class="sites-list">${sitesHtml}</div>
    </div>`;
}

function openMemberSiteModal(id) {
  const modal = document.getElementById('memberSiteModal');
  if (id) {
    const s = memberSites.find(s => s.id === id);
    if (!s) return;
    document.getElementById('memberSiteModalTitle').textContent = '추천 사이트 수정';
    document.getElementById('memberSiteId').value   = s.id;
    document.getElementById('memberSiteName').value = s.name;
    document.getElementById('memberSiteUrl').value  = s.url;
    document.getElementById('memberSiteDesc').value = s.desc || '';
  } else {
    document.getElementById('memberSiteModalTitle').textContent = '추천 사이트 추가';
    document.getElementById('memberSiteId').value   = '';
    document.getElementById('memberSiteName').value = '';
    document.getElementById('memberSiteUrl').value  = '';
    document.getElementById('memberSiteDesc').value = '';
  }
  modal.classList.add('open');
  document.getElementById('memberSiteName').focus();
}

function closeMemberSiteModal() {
  document.getElementById('memberSiteModal').classList.remove('open');
}

async function saveMemberSite() {
  const name = document.getElementById('memberSiteName').value.trim();
  let   url  = document.getElementById('memberSiteUrl').value.trim();
  if (!name) { showToast('사이트명을 입력해주세요.'); return; }
  if (!url)  { showToast('URL을 입력해주세요.');      return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const id   = document.getElementById('memberSiteId').value;
  const data = { name, url, desc: document.getElementById('memberSiteDesc').value.trim() };

  closeMemberSiteModal();
  try {
    if (id) {
      await dbUpdateMemberSite(id, data);
      showToast('사이트가 수정되었습니다.');
    } else {
      await dbAddMemberSite({ ...data, memberId: currentMemberId });
      showToast('사이트가 추가되었습니다.');
    }
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

async function deleteMemberSite(id) {
  if (!confirm('이 사이트를 삭제하시겠습니까?')) return;
  try {
    await dbDeleteMemberSite(id);
    showToast('사이트가 삭제되었습니다.');
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 업무 모달 ─────────────────────────────────────────
function openTaskModal(id, addMonth) {
  const modal = document.getElementById('taskModal');
  if (id) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    document.getElementById('taskModalTitle').textContent = '업무 수정';
    document.getElementById('taskId').value    = t.id;
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskMemo').value  = t.memo  || '';
    modal._month = null;
  } else {
    const mo = addMonth || currentMonth;
    document.getElementById('taskModalTitle').textContent = '업무 추가';
    document.getElementById('taskId').value    = '';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskMemo').value  = '';
    modal._month = mo;
  }
  modal.classList.add('open');
  document.getElementById('taskTitle').focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('open');
}

async function saveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { showToast('업무명을 입력해주세요.'); return; }

  const modal = document.getElementById('taskModal');
  const id    = document.getElementById('taskId').value;
  const mo    = modal._month || currentMonth;
  const date  = `${currentYear}-${String(mo).padStart(2,'0')}-01`;
  const data  = {
    title,
    date,
    memo: document.getElementById('taskMemo').value.trim(),
  };

  closeTaskModal();
  try {
    if (id) {
      await dbUpdateTask(id, data);
      showToast('업무가 수정되었습니다.');
    } else {
      await dbAddTask({ ...data, memberId: currentMemberId });
      showToast('업무가 추가되었습니다.');
    }
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

async function deleteTask(id) {
  if (!confirm('이 업무를 삭제하시겠습니까?')) return;
  try {
    await dbDeleteTask(id);
    showToast('업무가 삭제되었습니다.');
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 부서원 관리 ────────────────────────────────────────
function renderManage() {
  const grid = document.getElementById('membersGrid');
  if (members.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      </svg>
      <p>부서원이 없습니다.</p></div>`;
    return;
  }
  grid.innerHTML = members.map(m => {
    const cnt = tasks.filter(t => t.memberId === m.id).length;
    return `
    <div class="member-card">
      <div class="avatar-circle" style="background:${m.color};width:52px;height:52px;font-size:20px">${m.name[0]}</div>
      <div class="member-card-name">${escHtml(m.name)}</div>
      <div class="member-card-role">${escHtml(m.role || '')}</div>
      ${m.email ? `<div class="member-card-email">${escHtml(m.email)}</div>` : ''}
      <div class="member-card-cnt">전체 업무 ${cnt}건</div>
      <div class="member-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openMemberModal('${m.id}')">수정</button>
        <button class="btn btn-sm" style="background:var(--danger-light);color:var(--danger)"
                onclick="deleteMember('${m.id}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

// ── 부서원 모달 ────────────────────────────────────────
function buildColorPicker(current) {
  selectedColor = current || COLORS[0];
  document.getElementById('colorPicker').innerHTML = COLORS.map(c =>
    `<div class="color-swatch ${c === selectedColor ? 'selected' : ''}"
         style="background:${c}" onclick="selectColor('${c}')"></div>`
  ).join('');
}

function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-swatch').forEach(el => {
    const hex = rgbToHex(el.style.backgroundColor) || el.style.backgroundColor;
    el.classList.toggle('selected', c === hex);
  });
}

function rgbToHex(rgb) {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return null;
  return '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

function openMemberModal(id) {
  const modal = document.getElementById('memberModal');
  if (id) {
    const m = getMember(id);
    if (!m) return;
    document.getElementById('memberModalTitle').textContent = '부서원 수정';
    document.getElementById('memberId').value    = m.id;
    document.getElementById('memberName').value  = m.name;
    document.getElementById('memberRole').value  = m.role  || '';
    document.getElementById('memberEmail').value = m.email || '';
    document.getElementById('memberPin').value   = m.pin   || '';
    buildColorPicker(m.color);
  } else {
    document.getElementById('memberModalTitle').textContent = '부서원 추가';
    document.getElementById('memberId').value    = '';
    document.getElementById('memberName').value  = '';
    document.getElementById('memberRole').value  = '';
    document.getElementById('memberEmail').value = '';
    document.getElementById('memberPin').value   = '';
    buildColorPicker();
  }
  modal.classList.add('open');
  document.getElementById('memberName').focus();
}

function closeMemberModal() {
  document.getElementById('memberModal').classList.remove('open');
}

async function saveMember() {
  const name = document.getElementById('memberName').value.trim();
  if (!name) { showToast('이름을 입력해주세요.'); return; }

  const id   = document.getElementById('memberId').value;
  const pinVal = document.getElementById('memberPin').value.trim();
  const data = {
    name,
    role:  document.getElementById('memberRole').value.trim(),
    email: document.getElementById('memberEmail').value.trim(),
    color: selectedColor,
    pin:   pinVal,
  };

  closeMemberModal();
  try {
    if (id) {
      await dbUpdateMember(id, data);
      showToast('수정되었습니다.');
    } else {
      await dbAddMember(data);
      showToast('부서원이 추가되었습니다.');
    }
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

async function deleteMember(id) {
  const m = getMember(id);
  if (!confirm(`"${m?.name}"을(를) 삭제하면 해당 부서원의 모든 업무도 삭제됩니다.\n계속하시겠습니까?`)) return;
  try {
    await dbDeleteMember(id);
    if (currentUserId === id) {
      currentUserId = null;
      sessionStorage.removeItem('workium_user');
      renderCurrentUser();
    }
    showToast('부서원이 삭제되었습니다.');
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 공지 ──────────────────────────────────────────────
function renderNotice() {
  document.getElementById('noticeContent').innerHTML =
    escHtml(noticeText).replace(/\n/g, '<br>');
  document.getElementById('noticeEditBtn').style.display =
    isBoss() ? 'inline-flex' : 'none';
}

function toggleNoticeEdit() {
  noticeBeforeEdit = noticeText;
  document.getElementById('noticeContent').style.display  = 'none';
  document.getElementById('noticeEditArea').style.display = 'block';
  document.getElementById('noticeEditBtn').style.display  = 'none';
  const ta = document.getElementById('noticeTextarea');
  ta.value = noticeText;
  ta.focus();
}

function cancelNoticeEdit() {
  document.getElementById('noticeContent').style.display  = 'block';
  document.getElementById('noticeEditArea').style.display = 'none';
  document.getElementById('noticeEditBtn').style.display  = isBoss() ? 'inline-flex' : 'none';
}

async function saveNotice() {
  const text = document.getElementById('noticeTextarea').value;
  try {
    await dbSaveNotice(text);
    showToast('공지가 저장되었습니다.');
    cancelNoticeEdit();
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 사이트 ────────────────────────────────────────────
function renderSites() {
  const el     = document.getElementById('sitesList');
  const addBtn = document.querySelector('.sites-panel .notice-edit-btn');
  if (addBtn) addBtn.style.display = isBoss() ? 'inline-flex' : 'none';

  if (sites.length === 0) {
    el.innerHTML = `<span style="font-size:13px;color:#b45309;opacity:.6">등록된 사이트가 없습니다.</span>`;
    return;
  }

  const editBtns = isBoss() ? `
    <div class="site-actions">
      <button class="btn-icon" onclick="openSiteModal('__ID__')" title="수정">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn-icon btn-del" onclick="deleteSite('__ID__')" title="삭제">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>` : '';

  el.innerHTML = sites.map(s => `
    <div class="site-item">
      <div class="site-favicon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
        </svg>
      </div>
      <div class="site-info">
        <a href="${escHtml(s.url)}" target="_blank" rel="noopener" class="site-name">${escHtml(s.name)}</a>
        ${s.desc ? `<span class="site-desc">${escHtml(s.desc)}</span>` : ''}
      </div>
      ${editBtns.replaceAll('__ID__', s.id)}
    </div>`).join('');
}

function openSiteModal(id) {
  const modal = document.getElementById('siteModal');
  if (id) {
    const s = sites.find(s => s.id === id);
    if (!s) return;
    document.getElementById('siteModalTitle').textContent = '사이트 수정';
    document.getElementById('siteId').value   = s.id;
    document.getElementById('siteName').value = s.name;
    document.getElementById('siteUrl').value  = s.url;
    document.getElementById('siteDesc').value = s.desc || '';
  } else {
    document.getElementById('siteModalTitle').textContent = '사이트 추가';
    document.getElementById('siteId').value   = '';
    document.getElementById('siteName').value = '';
    document.getElementById('siteUrl').value  = '';
    document.getElementById('siteDesc').value = '';
  }
  modal.classList.add('open');
  document.getElementById('siteName').focus();
}

function closeSiteModal() {
  document.getElementById('siteModal').classList.remove('open');
}

async function saveSite() {
  const name = document.getElementById('siteName').value.trim();
  let   url  = document.getElementById('siteUrl').value.trim();
  if (!name) { showToast('사이트명을 입력해주세요.'); return; }
  if (!url)  { showToast('URL을 입력해주세요.');      return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const id   = document.getElementById('siteId').value;
  const data = { name, url, desc: document.getElementById('siteDesc').value.trim() };

  closeSiteModal();
  try {
    if (id) {
      await dbUpdateSite(id, data);
      showToast('사이트가 수정되었습니다.');
    } else {
      await dbAddSite(data);
      showToast('사이트가 추가되었습니다.');
    }
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다.'); console.error(e);
  }
}

async function deleteSite(id) {
  if (!confirm('이 사이트를 삭제하시겠습니까?')) return;
  try {
    await dbDeleteSite(id);
    showToast('사이트가 삭제되었습니다.');
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다.'); console.error(e);
  }
}

// ── 접속자 선택 ───────────────────────────────────────
function openLoginModal() {
  document.getElementById('loginStep1').style.display = 'block';
  document.getElementById('loginStep2').style.display = 'none';
  const list = document.getElementById('loginMemberList');
  list.innerHTML = members.map(m => `
    <button class="login-member-btn ${m.id === currentUserId ? 'selected' : ''}"
            onclick="pickLoginMember('${m.id}')">
      <div class="avatar-circle" style="background:${m.color};width:36px;height:36px;font-size:14px">${m.name[0]}</div>
      <div>
        <div style="font-weight:700;font-size:13.5px">${escHtml(m.name)}</div>
        <div style="font-size:12px;color:#94a3b8">${escHtml(m.role || '')}</div>
      </div>
      ${m.id === currentUserId
        ? `<svg style="margin-left:auto;color:#4f6ef7" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
        : ''}
    </button>`).join('');
  document.getElementById('loginModal').classList.add('open');
}

function selectUser(id) {
  currentUserId = id;
  sessionStorage.setItem('workium_user', id);
  document.getElementById('loginModal').classList.remove('open');
  renderCurrentUser();
  renderNotice();
  renderSites();
  showToast(`${getMember(id)?.name}님으로 접속했습니다.`);
}

function pickLoginMember(id) {
  const m = getMember(id);
  if (!m) return;
  if (!m.pin) { selectUser(id); return; }
  _pendingLoginId = id;
  document.getElementById('loginStep1').style.display = 'none';
  document.getElementById('loginStep2').style.display = 'block';
  document.getElementById('loginPinAvatar').style.background = m.color;
  document.getElementById('loginPinAvatar').textContent = m.name[0];
  document.getElementById('loginPinName').textContent = m.name;
  document.getElementById('loginPinInput').value = '';
  setTimeout(() => document.getElementById('loginPinInput').focus(), 50);
}

function backToMemberList() {
  _pendingLoginId = null;
  document.getElementById('loginStep1').style.display = 'block';
  document.getElementById('loginStep2').style.display = 'none';
}

function confirmPin() {
  const input = document.getElementById('loginPinInput').value;
  const m = getMember(_pendingLoginId);
  if (!m) return;
  if (input !== m.pin) {
    showToast('PIN이 틀렸습니다.');
    document.getElementById('loginPinInput').value = '';
    document.getElementById('loginPinInput').focus();
    return;
  }
  selectUser(_pendingLoginId);
}

function renderCurrentUser() {
  const avatar = document.getElementById('currentUserAvatar');
  const name   = document.getElementById('currentUserName');
  const role   = document.getElementById('currentUserRole');
  const m = getMember(currentUserId);
  document.querySelector('.manage-btn').style.display = (isBoss() || members.length === 0) ? 'flex' : 'none';
  document.getElementById('addMemberBtn').style.display = isBoss() ? 'inline-flex' : 'none';
  if (m) {
    avatar.style.background = m.color;
    avatar.textContent = m.name[0];
    name.textContent   = m.name;
    role.innerHTML     = isBoss()
      ? `${escHtml(m.role)} <span class="boss-badge">편집권한</span>`
      : escHtml(m.role || '');
  } else {
    avatar.style.background = '#cbd5e1';
    avatar.textContent = '?';
    name.textContent   = '접속자 선택';
    role.textContent   = '클릭하여 선택';
  }
}

// ── 모달 외부 클릭 닫기 ───────────────────────────────
document.querySelectorAll('.modal-overlay').forEach(o =>
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); })
);

// ── 토스트 ────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── 초기화 ────────────────────────────────────────────
showLoading();
initListeners();
