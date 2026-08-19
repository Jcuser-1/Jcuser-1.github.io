/**
 * 管理后台与在线编辑（仅管理员可见 / 可用）。
 */
import { state, markDirty, publish, downloadVault, setPassword, removeKey, toggleKey, discardDraft, loadDraft, VAULT_PATH, normalizeResume, RESUME_STATUSES } from './store.js';
import { isAdmin } from './auth.js';
import * as gh from './github.js';
import { renderMarkdown, escapeHtml } from './markdown.js';
import { $, $$, toast, modal, confirmDialog, uid, formatDate } from './ui.js';
import { passwordStrength } from './crypto.js';
import * as router from './router.js';
import { resumeBodyHtml } from './views.js?v=20260819g';

const SECTIONS = [
  { id: 'profile', name: '基础信息' },
  { id: 'resume', name: '简历内容' },
  { id: 'versions', name: '简历版本' },
  { id: 'posts', name: '经历文章' },
  { id: 'works', name: '项目作品' },
  { id: 'site', name: '站点设置' },
  { id: 'security', name: '密码安全' },
  { id: 'publish', name: '发布设置' },
];

const view = () => document.getElementById('view');

/* ---------- 通用表单工具 ---------- */

function bindInput(el, obj, key, transform) {
  el.value = transform === 'lines' ? (obj[key] || []).join('\n')
    : transform === 'tags' ? (obj[key] || []).join(', ')
    : obj[key] == null ? '' : obj[key];
  el.addEventListener('input', () => {
    if (transform === 'lines') obj[key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (transform === 'tags') obj[key] = el.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    else if (transform === 'number') obj[key] = Number(el.value) || 0;
    else obj[key] = el.value;
    markDirty();
    refreshBar();
  });
}

function field(label, hint = '') {
  const w = document.createElement('div');
  w.className = 'field';
  w.innerHTML = `<label>${escapeHtml(label)}</label>`;
  if (hint) w.insertAdjacentHTML('beforeend', `<div class="hint" data-hint>${escapeHtml(hint)}</div>`);
  return w;
}

function input(obj, key, label, opts = {}) {
  const w = field(label, opts.hint);
  const el = document.createElement(opts.type === 'textarea' ? 'textarea' : 'input');
  if (opts.type && opts.type !== 'textarea') el.type = opts.type === 'number' ? 'number' : opts.type;
  if (opts.rows) el.rows = opts.rows;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  if (opts.mono) el.className = 'mono';
  bindInput(el, obj, key, opts.transform || (opts.type === 'number' ? 'number' : null));
  const hint = w.querySelector('[data-hint]');
  if (hint) w.insertBefore(el, hint);
  else w.appendChild(el);
  return w;
}

function checkbox(obj, key, label) {
  const w = document.createElement('label');
  w.className = 'remember';
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = !!obj[key];
  el.addEventListener('change', () => { obj[key] = el.checked; markDirty(); refreshBar(); });
  w.appendChild(el);
  w.insertAdjacentHTML('beforeend', `<span>${escapeHtml(label)}</span>`);
  return w;
}

function select(obj, key, label, options) {
  const w = field(label);
  const el = document.createElement('select');
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    el.appendChild(opt);
  });
  el.value = obj[key] || options[0].id;
  el.addEventListener('change', () => { obj[key] = el.value; markDirty(); refreshBar(); });
  w.appendChild(el);
  return w;
}

/**
 * 数组编辑器：新增 / 删除 / 上下移动 + 字段绑定
 */
function arrayEditor(arr, schema, opts = {}) {
  const box = document.createElement('div');
  const render = () => {
    box.innerHTML = '';
    arr.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'repeat-item';
      const head = document.createElement('div');
      head.className = 'repeat-head';
      head.innerHTML = `<span class="t">${escapeHtml(opts.title ? opts.title(item, idx) : `#${idx + 1}`)}</span>
        <button class="btn btn-sm" data-up type="button" title="上移">↑</button>
        <button class="btn btn-sm" data-down type="button" title="下移">↓</button>
        <button class="btn btn-sm btn-danger" data-del type="button">删除</button>`;
      card.appendChild(head);
      const grid = document.createElement('div');
      grid.className = schema.length > 3 ? 'grid-2' : '';
      schema.forEach((f) => {
        const wrap = input(item, f.key, f.label, f);
        if (f.full) wrap.style.gridColumn = '1 / -1';
        grid.appendChild(wrap);
      });
      card.appendChild(grid);
      head.querySelector('[data-del]').addEventListener('click', async () => {
        if (await confirmDialog('确定删除这一条吗？')) { arr.splice(idx, 1); markDirty(); render(); refreshBar(); }
      });
      head.querySelector('[data-up]').addEventListener('click', () => {
        if (idx > 0) { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; markDirty(); render(); }
      });
      head.querySelector('[data-down]').addEventListener('click', () => {
        if (idx < arr.length - 1) { [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; markDirty(); render(); }
      });
      box.appendChild(card);
    });
    const add = document.createElement('button');
    add.className = 'btn';
    add.type = 'button';
    add.textContent = '+ 新增一条';
    add.addEventListener('click', () => { arr.push(opts.factory ? opts.factory() : {}); markDirty(); render(); refreshBar(); });
    box.appendChild(add);
  };
  render();
  return box;
}

/* ---------- 发布状态栏 ---------- */

function refreshBar() {
  const bar = document.getElementById('pubStatus');
  if (!bar) return;
  const draft = loadDraft();
  bar.textContent = state.dirty
    ? `有未发布的改动${draft ? `（本地草稿已保存于 ${new Date(draft.savedAt).toLocaleString()}）` : ''}`
    : '所有改动已发布';
  bar.classList.toggle('dirty', state.dirty);
}

function publishBar() {
  const el = document.createElement('div');
  el.className = 'publish-bar';
  el.innerHTML = `
    <span class="status" id="pubStatus"></span>
    <button class="btn btn-sm" id="discardBtn" type="button">放弃本地改动</button>
    <button class="btn btn-sm" id="exportBtn" type="button">导出 vault.json</button>
    <button class="btn btn-primary btn-sm" id="publishBtn" type="button">🚀 一键发布</button>`;
  el.querySelector('#publishBtn').addEventListener('click', () => doPublish());
  el.querySelector('#exportBtn').addEventListener('click', async () => {
    await downloadVault();
    toast('已导出，请手动上传到仓库 data/vault.json', 'ok');
    refreshBar();
  });
  el.querySelector('#discardBtn').addEventListener('click', async () => {
    if (await confirmDialog('放弃本地未发布的改动，并恢复为线上版本？')) {
      discardDraft();
      location.reload();
    }
  });
  setTimeout(refreshBar, 0);
  return el;
}

async function doPublish(overrideKeys, message) {
  const btn = document.getElementById('publishBtn');
  if (btn) { btn.disabled = true; btn.textContent = '发布中…'; }
  try {
    await publish(message, overrideKeys);
    toast('发布成功，GitHub Pages 通常在 1 分钟内生效', 'ok', 4000);
  } catch (e) {
    toast(e.message || '发布失败', 'err', 5000);
    throw e;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 一键发布'; }
    refreshBar();
  }
}

/* ---------- 后台主入口 ---------- */

export function renderAdmin(params) {
  if (!isAdmin()) { router.go('/', true); return; }
  const cur = SECTIONS.some((s) => s.id === params.section) ? params.section : 'profile';
  view().innerHTML = `
    <div class="page page-wide">
      <div class="page-head"><h1>管理后台</h1>
        <p class="desc">修改后点击「一键发布」同步到 GitHub 仓库</p></div>
      <div class="admin-layout">
        <aside class="admin-menu">
          ${SECTIONS.map((s) => `<button data-sec="${s.id}" class="${s.id === cur ? 'active' : ''}" type="button">${s.name}</button>`).join('')}
        </aside>
        <div id="adminPane"></div>
      </div>
    </div>`;
  $$('.admin-menu button').forEach((b) =>
    b.addEventListener('click', () => router.go(`/admin/${b.dataset.sec}`))
  );
  const pane = document.getElementById('adminPane');
  pane.appendChild(publishBar());
  const body = document.createElement('div');
  pane.appendChild(body);
  ({
    profile: paneProfile,
    resume: paneResume,
    versions: paneVersions,
    posts: panePosts,
    works: paneWorks,
    site: paneSite,
    security: paneSecurity,
    publish: panePublish,
  }[cur])(body);
}

/* ---------- 基础信息 ---------- */

function paneProfile(root) {
  const p = state.content.profile;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2 style="margin-top:0">个人基础信息</h2>';
  const grid = document.createElement('div');
  grid.className = 'grid-2';
  [
    input(p, 'name', '姓名'),
    input(p, 'title', '身份定位', { placeholder: '如：前端工程师 / 在读学生' }),
    input(p, 'avatar', '头像地址', { placeholder: 'assets/img/avatar.jpg 或图片链接' }),
    input(p, 'location', '所在城市'),
    input(p, 'tagline', '一句话标语'),
    input(p, 'tags', '核心标签', { transform: 'tags', placeholder: '用逗号分隔' }),
  ].forEach((f) => grid.appendChild(f));
  card.appendChild(grid);
  card.appendChild(input(p, 'bio', '简短简介', { type: 'textarea', rows: 3 }));
  root.appendChild(card);

  const about = document.createElement('div');
  about.className = 'card';
  about.style.marginTop = '14px';
  about.innerHTML = '<h2 style="margin-top:0">关于我（支持 Markdown）</h2>';
  about.appendChild(markdownEditor(p, 'about'));
  root.appendChild(about);

  const contact = document.createElement('div');
  contact.className = 'card';
  contact.style.marginTop = '14px';
  contact.innerHTML = '<h2 style="margin-top:0">联系方式</h2>';
  p.contacts = p.contacts || [];
  contact.appendChild(
    arrayEditor(p.contacts, [
      { key: 'icon', label: '图标（emoji）', placeholder: '✉️' },
      { key: 'label', label: '名称', placeholder: '邮箱' },
      { key: 'value', label: '展示内容', placeholder: 'you@example.com' },
      { key: 'link', label: '跳转链接', placeholder: 'mailto:you@example.com' },
    ], { title: (it) => it.label || '联系方式', factory: () => ({ icon: '🔗', label: '', value: '', link: '' }) })
  );
  root.appendChild(contact);
}

/* ---------- 简历 ---------- */

/** 简历六块内容的编辑器（主简历面板与版本编辑弹窗共用） */
function resumeFieldsEditor(r) {
  const wrap = document.createElement('div');
  const block = (title, node) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.style.marginBottom = '14px';
    c.innerHTML = `<h2 style="margin-top:0">${title}</h2>`;
    c.appendChild(node);
    wrap.appendChild(c);
  };

  block('简历概述', input(r, 'summary', '一句话概述', { type: 'textarea', rows: 2 }));

  r.education = r.education || [];
  block('教育背景', arrayEditor(r.education, [
    { key: 'school', label: '学校' },
    { key: 'major', label: '专业' },
    { key: 'degree', label: '学历' },
    { key: 'period', label: '时间', placeholder: '2021.09 - 2025.06' },
    { key: 'desc', label: '描述', type: 'textarea', rows: 2, full: true },
  ], { title: (it) => it.school || '教育经历', factory: () => ({ school: '', major: '', degree: '', period: '', desc: '' }) }));

  r.work = r.work || [];
  block('实习 / 工作经历', arrayEditor(r.work, [
    { key: 'company', label: '公司' },
    { key: 'role', label: '职位' },
    { key: 'period', label: '时间' },
    { key: 'desc', label: '职责概述', type: 'textarea', rows: 2 },
    { key: 'points', label: '亮点（每行一条）', type: 'textarea', rows: 3, transform: 'lines', full: true },
  ], { title: (it) => it.company || '工作经历', factory: () => ({ company: '', role: '', period: '', desc: '', points: [] }) }));

  r.projects = r.projects || [];
  block('项目经历', arrayEditor(r.projects, [
    { key: 'name', label: '项目名称' },
    { key: 'role', label: '担任角色' },
    { key: 'period', label: '时间' },
    { key: 'desc', label: '项目简介', type: 'textarea', rows: 2 },
    { key: 'points', label: '主要工作（每行一条）', type: 'textarea', rows: 3, transform: 'lines', full: true },
  ], { title: (it) => it.name || '项目', factory: () => ({ name: '', role: '', period: '', desc: '', points: [] }) }));

  r.skills = r.skills || [];
  block('技能清单', arrayEditor(r.skills, [
    { key: 'name', label: '技能名称' },
    { key: 'group', label: '分组', placeholder: '如：前端框架' },
    { key: 'level', label: '掌握程度 0-100', type: 'number' },
  ], { title: (it) => it.name || '技能', factory: () => ({ name: '', group: '技能', level: 60 }) }));

  r.awards = r.awards || [];
  block('荣誉奖项', arrayEditor(r.awards, [
    { key: 'name', label: '奖项名称' },
    { key: 'issuer', label: '颁发单位' },
    { key: 'date', label: '时间' },
    { key: 'desc', label: '说明', full: true },
  ], { title: (it) => it.name || '奖项', factory: () => ({ name: '', issuer: '', date: '', desc: '' }) }));

  return wrap;
}

function paneResume(root) {
  root.appendChild(resumeFieldsEditor(state.content.resume));
}

/* ---------- 简历版本管理（仅管理员） ---------- */

const verStatus = (v) => RESUME_STATUSES.find((s) => s.id === (v.status || 'none')) || RESUME_STATUSES[0];

function paneVersions(root) {
  const versions = (state.content.resumeVersions = state.content.resumeVersions || []);
  const card = document.createElement('div');
  card.className = 'card';
  card.style.padding = '22px 24px';
  let filter = 'all';

  const render = () => {
    const counts = { all: versions.length };
    RESUME_STATUSES.forEach((s) => { counts[s.id] = 0; });
    versions.forEach((v) => { const s = v.status || 'none'; counts[s] = (counts[s] || 0) + 1; });

    card.innerHTML = `
      <div class="ver-head">
        <div>
          <h2 style="margin:0">简历版本（${versions.length}）</h2>
          <p class="muted" style="margin:4px 0 0;font-size:.85rem">针对不同公司 / 岗位维护独立简历，可一键「应用」替换公开简历页内容</p>
        </div>
        <button class="btn btn-primary" data-new type="button">+ 新建版本</button>
      </div>`;

    const stats = document.createElement('div');
    stats.className = 'ver-stats';
    [{ id: 'all', name: '全部' }, ...RESUME_STATUSES].forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ver-stat ${filter === s.id ? 'active' : ''}`;
      b.innerHTML = `${s.id === 'all' ? '' : `<span class="dot s-${s.id}"></span>`}${s.name}<b>${counts[s.id] || 0}</b>`;
      b.addEventListener('click', () => { filter = s.id; render(); });
      stats.appendChild(b);
    });
    card.appendChild(stats);

    const grid = document.createElement('div');
    grid.className = 'ver-grid';
    const list = versions.filter((v) => filter === 'all' || (v.status || 'none') === filter);
    if (!versions.length) grid.innerHTML = '<div class="empty" style="grid-column:1/-1">还没有简历版本<br><span style="font-size:.84rem">「新建版本」会自动复制当前公开简历作为起点</span></div>';
    else if (!list.length) grid.innerHTML = '<div class="empty" style="grid-column:1/-1">该状态下暂无版本</div>';
    else list.forEach((v) => grid.appendChild(versionCard(v, render)));
    card.appendChild(grid);

    card.querySelector('[data-new]').addEventListener('click', () => openVersionEditor(null, render));
  };
  render();
  root.appendChild(card);
}

function versionCard(v, rerender) {
  const st = verStatus(v);
  const el = document.createElement('div');
  el.className = `ver-card s-${st.id}`;
  el.innerHTML = `
    <div class="ver-top">
      <span class="badge status-${st.id}">${st.name}</span>
      ${v.lastAppliedAt ? '<span class="badge badge-applied" title="最近应用为公开简历">★ 已应用</span>' : ''}
      <span class="ver-time">${escapeHtml(formatDate((v.updatedAt || '').slice(0, 10)))}</span>
    </div>
    <h3 class="ver-name">${escapeHtml(v.name || '(未命名版本)')}</h3>
    <p class="ver-target">${escapeHtml([v.company, v.position].filter(Boolean).join(' · ') || '未指定公司 / 岗位')}</p>
    ${v.appliedAt ? `<p class="ver-meta">投递于 ${escapeHtml(formatDate(v.appliedAt))}</p>` : ''}
    ${v.note ? `<p class="ver-note">${escapeHtml(v.note)}</p>` : ''}
    <div class="ver-actions">
      <button class="btn btn-sm" data-preview type="button">预览</button>
      <button class="btn btn-sm" data-edit type="button">编辑</button>
      <button class="btn btn-sm btn-apply" data-apply type="button">应用为公开简历</button>
      <button class="btn btn-sm" data-dup type="button">复制</button>
      <button class="btn btn-sm btn-danger" data-del type="button">删除</button>
    </div>`;
  el.querySelector('[data-preview]').addEventListener('click', () => openVersionPreview(v));
  el.querySelector('[data-edit]').addEventListener('click', () => openVersionEditor(v.id, rerender));
  el.querySelector('[data-apply]').addEventListener('click', () => applyVersion(v, rerender));
  el.querySelector('[data-dup]').addEventListener('click', () => duplicateVersion(v, rerender));
  el.querySelector('[data-del]').addEventListener('click', async () => {
    if (await confirmDialog(`删除版本「${v.name || '未命名'}」？该操作不可撤销（未发布的本地草稿中也会删除）。`)) {
      const arr = state.content.resumeVersions;
      arr.splice(arr.findIndex((x) => x.id === v.id), 1);
      markDirty();
      rerender();
    }
  });
  return el;
}

async function applyVersion(v, rerender) {
  const ok = await confirmDialog(`将版本「${v.name}」应用为公开简历？当前公开简历内容会被整体替换，版本本身保留。`);
  if (!ok) return;
  state.content.resume = normalizeResume(JSON.parse(JSON.stringify(v.data)));
  v.lastAppliedAt = new Date().toISOString();
  markDirty();
  toast('已应用为公开简历，记得点击「一键发布」同步到仓库', 'ok', 3500);
  rerender();
  refreshBar();
}

function duplicateVersion(v, rerender) {
  const copy = JSON.parse(JSON.stringify(v));
  copy.id = uid('rv');
  copy.name = `${v.name || '未命名'} 副本`;
  copy.status = 'none';
  copy.appliedAt = '';
  copy.lastAppliedAt = null;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  state.content.resumeVersions.unshift(copy);
  markDirty();
  toast('已复制为新版本', 'ok');
  rerender();
}

function openVersionPreview(v) {
  const st = verStatus(v);
  const p = state.content.profile;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="ver-preview-head no-print">
      <span class="badge status-${st.id}">${st.name}</span>
      ${v.company || v.position ? `<span class="muted" style="font-size:.82rem">${escapeHtml([v.company, v.position].filter(Boolean).join(' · '))}</span>` : ''}
      ${v.appliedAt ? `<span class="muted" style="font-size:.82rem">投递于 ${escapeHtml(formatDate(v.appliedAt))}</span>` : ''}
      <button class="btn btn-sm" id="verPrintBtn" type="button" style="margin-left:auto">⬇ 导出 PDF</button>
    </div>
    <h2 style="margin:14px 0 2px">${escapeHtml(p.name)}</h2>
    <p class="muted" style="margin:0">${escapeHtml(v.data.summary || '')}</p>`;
  const resumeBody = document.createElement('div');
  resumeBody.innerHTML = resumeBodyHtml(v.data);
  body.appendChild(resumeBody);
  modal({ title: `预览：${v.name || '未命名版本'}`, body, wide: true, hideOk: true, cancelText: '关闭' });
  body.querySelector('#verPrintBtn').addEventListener('click', () => window.print());
}

export function openVersionEditor(id, onDone) {
  if (!isAdmin()) return;
  const versions = (state.content.resumeVersions = state.content.resumeVersions || []);
  let ver = id ? versions.find((x) => x.id === id) : null;
  const isNew = !ver;
  if (isNew) {
    ver = {
      id: uid('rv'),
      name: '',
      company: '',
      position: '',
      status: 'none',
      appliedAt: '',
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAppliedAt: null,
      data: JSON.parse(JSON.stringify(normalizeResume(state.content.resume))),
    };
  }
  const working = JSON.parse(JSON.stringify(ver));

  const body = document.createElement('div');
  if (isNew) {
    body.insertAdjacentHTML('beforeend', '<div class="ver-source-hint">💡 已自动复制当前公开简历的内容，在此基础上针对目标岗位修改即可</div>');
  }
  const grid = document.createElement('div');
  grid.className = 'grid-2';
  [
    input(working, 'name', '版本名称', { placeholder: '如：腾讯-前端社招' }),
    input(working, 'company', '目标公司', { placeholder: '如：腾讯' }),
    input(working, 'position', '目标岗位', { placeholder: '如：前端开发工程师' }),
    input(working, 'appliedAt', '投递日期', { type: 'date' }),
  ].forEach((f) => grid.appendChild(f));
  grid.appendChild(select(working, 'status', '投递状态', RESUME_STATUSES));
  body.appendChild(grid);
  body.appendChild(input(working, 'note', '备注', { type: 'textarea', rows: 2, placeholder: '投递渠道 / 进展 / 面试记录等' }));

  const divider = document.createElement('div');
  divider.className = 'ver-divider';
  divider.innerHTML = '<span>简历内容</span>';
  body.appendChild(divider);

  const resumeWrap = document.createElement('div');
  resumeWrap.className = 'modal-resume';
  resumeWrap.appendChild(resumeFieldsEditor(working.data));
  body.appendChild(resumeWrap);

  modal({
    title: isNew ? '新建简历版本' : '编辑简历版本',
    body,
    wide: true,
    okText: '保存',
    onOk: () => {
      if (!working.name.trim()) { toast('请填写版本名称', 'err'); return false; }
      working.updatedAt = new Date().toISOString();
      if (isNew) versions.unshift(working);
      else Object.assign(ver, working);
      markDirty();
      toast('已保存到本地草稿，记得点击「一键发布」', 'ok', 3500);
      if (onDone) onDone();
      else router.resolve();
      refreshBar();
    },
  });
}

/* ---------- Markdown 编辑器 ---------- */

function markdownEditor(obj, key) {
  const wrap = document.createElement('div');
  const toolbar = document.createElement('div');
  toolbar.className = 'md-toolbar';
  const tools = [
    ['H2', '\n## 标题\n'], ['粗体', '**加粗**'], ['斜体', '*斜体*'],
    ['链接', '[文字](https://)'], ['图片', '![描述](图片地址)'],
    ['代码块', '\n```js\ncode\n```\n'], ['引用', '\n> 引用内容\n'], ['列表', '\n- 第一项\n- 第二项\n'],
  ];
  toolbar.innerHTML = tools.map((t, i) => `<button type="button" data-i="${i}">${t[0]}</button>`).join('');
  const split = document.createElement('div');
  split.className = 'editor-split';
  const ta = document.createElement('textarea');
  ta.className = 'mono';
  ta.rows = 18;
  ta.value = obj[key] || '';
  const preview = document.createElement('div');
  preview.className = 'preview md';

  const sync = () => { preview.innerHTML = renderMarkdown(ta.value).html; };
  ta.addEventListener('input', () => { obj[key] = ta.value; sync(); markDirty(); refreshBar(); });
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const snippet = tools[+b.dataset.i][1];
    const s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + snippet + ta.value.slice(ta.selectionEnd);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + snippet.length;
    obj[key] = ta.value;
    sync();
    markDirty();
    refreshBar();
  });
  sync();
  split.append(ta, preview);
  wrap.append(toolbar, split);
  return wrap;
}

/* ---------- 文章管理 ---------- */

function panePosts(root) {
  const posts = state.content.posts;
  const card = document.createElement('div');
  card.className = 'card';
  const render = () => {
    card.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <h2 style="margin:0;flex:1">经历文章（${posts.length}）</h2>
      <button class="btn btn-primary btn-sm" data-new type="button">+ 新建文章</button></div>`;
    const list = document.createElement('div');
    posts
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .forEach((p) => {
        const row = document.createElement('div');
        row.className = 'list-row';
        row.innerHTML = `
          <span class="t"><b>${escapeHtml(p.title || '(无标题)')}</b>
            <small>${escapeHtml(formatDate(p.date))} · ${escapeHtml(p.category || '未分类')}</small></span>
          ${p.draft ? '<span class="badge badge-draft">草稿</span>' : ''}
          ${p.adminOnly ? '<span class="badge badge-lock">仅管理员</span>' : ''}
          <button class="btn btn-sm" data-edit type="button">编辑</button>
          <button class="btn btn-sm btn-danger" data-del type="button">删除</button>`;
        row.querySelector('[data-edit]').addEventListener('click', () => openPostEditor(p.id, render));
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (await confirmDialog(`删除文章「${p.title}」？`)) {
            const i = posts.findIndex((x) => x.id === p.id);
            posts.splice(i, 1);
            markDirty();
            render();
          }
        });
        list.appendChild(row);
      });
    if (!posts.length) list.innerHTML = '<div class="empty">还没有文章</div>';
    card.appendChild(list);
    card.querySelector('[data-new]').addEventListener('click', () => openPostEditor(null, render));
  };
  render();
  root.appendChild(card);
}

export function openPostEditor(id, onDone) {
  if (!isAdmin()) return;
  const posts = state.content.posts;
  let post = id ? posts.find((p) => p.id === id) : null;
  const isNew = !post;
  if (isNew) {
    post = {
      id: uid('p'),
      title: '',
      date: new Date().toISOString().slice(0, 10),
      category: '随笔',
      cover: '',
      summary: '',
      tags: [],
      draft: true,
      adminOnly: false,
      body: '',
    };
  }
  const working = JSON.parse(JSON.stringify(post));

  const body = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'grid-2';
  [
    input(working, 'title', '标题'),
    input(working, 'date', '日期', { type: 'date' }),
    input(working, 'category', '分类', { placeholder: '如：随笔 / 学习 / 项目' }),
    input(working, 'tags', '标签', { transform: 'tags', placeholder: '逗号分隔' }),
    input(working, 'cover', '封面图', { placeholder: '可留空' }),
    input(working, 'summary', '摘要', { placeholder: '留空则自动截取正文' }),
  ].forEach((f) => grid.appendChild(f));
  body.appendChild(grid);

  const flags = document.createElement('div');
  flags.style.display = 'flex';
  flags.style.gap = '20px';
  flags.append(checkbox(working, 'draft', '保存为草稿（不对访客展示）'), checkbox(working, 'adminOnly', '仅管理员可见'));
  body.appendChild(flags);
  body.appendChild(markdownEditor(working, 'body'));

  modal({
    title: isNew ? '新建文章' : '编辑文章',
    body,
    wide: true,
    okText: '保存',
    onOk: () => {
      if (!working.title.trim()) { toast('请填写标题', 'err'); return false; }
      if (isNew) posts.push(working);
      else Object.assign(post, working);
      markDirty();
      toast('已保存到本地草稿，记得点击「一键发布」', 'ok', 3500);
      if (onDone) onDone();
      else router.resolve();
      refreshBar();
    },
  });
}

/* ---------- 项目管理 ---------- */

function paneWorks(root) {
  const works = (state.content.works = state.content.works || []);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2 style="margin-top:0">项目作品</h2>';
  card.appendChild(
    arrayEditor(works, [
      { key: 'title', label: '项目名称' },
      { key: 'link', label: '外部链接' },
      { key: 'cover', label: '封面图地址' },
      { key: 'tags', label: '技术标签', transform: 'tags', placeholder: '逗号分隔' },
      { key: 'order', label: '排序（越小越前）', type: 'number' },
      { key: 'desc', label: '项目简介', type: 'textarea', rows: 2, full: true },
    ], {
      title: (it) => it.title || '项目',
      factory: () => ({ id: uid('w'), title: '', cover: '', desc: '', tags: [], link: '', order: works.length, pinned: false }),
    })
  );
  const pinBox = document.createElement('div');
  pinBox.innerHTML = '<h3>置顶设置</h3>';
  works.forEach((w) => pinBox.appendChild(checkbox(w, 'pinned', `置顶「${w.title || '未命名'}」`)));
  card.appendChild(pinBox);
  root.appendChild(card);
}

/* ---------- 站点设置 ---------- */

function paneSite(root) {
  const s = state.content.site;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2 style="margin-top:0">站点设置</h2>';
  card.appendChild(input(s, 'siteName', '站点名称'));
  card.appendChild(input(s, 'footer', '页脚文字'));
  card.appendChild(checkbox(s, 'showProjects', '显示「项目」导航'));
  card.appendChild(checkbox(s, 'showAbout', '显示「关于」导航'));
  card.appendChild(checkbox(s, 'showContact', '显示「联系」导航'));
  root.appendChild(card);
}

/* ---------- 密码安全 ---------- */

function paneSecurity(root) {
  const card = document.createElement('div');
  card.className = 'card';
  const render = () => {
    const keys = state.vault.keys || [];
    card.innerHTML = `
      <h2 style="margin-top:0">密码管理</h2>
      <p class="muted" style="font-size:.86rem">仓库中不保存明文密码：所有密码都用于「包裹」内容主密钥，改密后原密码立即失效。密码变更需要点击下方按钮直接发布生效。</p>`;
    const list = document.createElement('div');
    keys.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const expired = k.expiresAt && Date.now() > new Date(k.expiresAt).getTime();
      row.innerHTML = `
        <span class="t"><b>${escapeHtml(k.label || k.id)}</b>
          <small>${k.role === 'admin' ? '管理员' : '访客'} · 创建于 ${escapeHtml(formatDate((k.createdAt || '').slice(0, 10)))}
          ${k.expiresAt ? ` · 有效期至 ${escapeHtml(k.expiresAt.slice(0, 10))}` : ''}</small></span>
        ${k.enabled === false ? '<span class="badge">已禁用</span>' : expired ? '<span class="badge badge-lock">已过期</span>' : ''}
        <button class="btn btn-sm" data-pwd type="button">改密码</button>
        ${k.role === 'guest' ? `<button class="btn btn-sm" data-toggle type="button">${k.enabled === false ? '启用' : '禁用'}</button>
        <button class="btn btn-sm btn-danger" data-del type="button">删除</button>` : ''}`;
      row.querySelector('[data-pwd]').addEventListener('click', () => changePassword(k, render));
      const tg = row.querySelector('[data-toggle]');
      if (tg) tg.addEventListener('click', async () => {
        const next = toggleKey(k.id, k.enabled === false);
        await applyKeys(next, '安全：启用/禁用访客密码');
        render();
      });
      const del = row.querySelector('[data-del]');
      if (del) del.addEventListener('click', async () => {
        if (await confirmDialog(`删除访客密码「${k.label}」？该密码将立即失效。`)) {
          await applyKeys(removeKey(k.id), '安全：删除访客密码');
          render();
        }
      });
      list.appendChild(row);
    });
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:16px';
    actions.innerHTML = `
      <button class="btn" data-add type="button">+ 新增访客密码</button>
      <button class="btn btn-danger" data-reset type="button">一键失效所有访客密码</button>`;
    actions.querySelector('[data-add]').addEventListener('click', () => changePassword(null, render));
    actions.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!(await confirmDialog('将删除全部访客密码并生成一个新的访客密码，原有访客立即无法访问。继续？'))) return;
      changePassword({ role: 'guest', label: '默认访客', __replaceAll: true }, render);
    });
    card.appendChild(actions);
  };
  render();
  root.appendChild(card);
}

function changePassword(entry, done) {
  const isNew = !entry || !entry.id;
  const role = entry?.role || 'guest';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>密码名称</label>
      <input type="text" id="pwLabel" value="${escapeHtml(entry?.label || (role === 'admin' ? '管理员' : '访客密码'))}"></div>
    <div class="field"><label>新密码</label><input type="password" id="pw1" autocomplete="new-password">
      <div class="hint" id="pwTip">建议 12 位以上，包含大小写、数字与符号</div></div>
    <div class="field"><label>确认新密码</label><input type="password" id="pw2" autocomplete="new-password"></div>
    ${role === 'guest' ? `<div class="field"><label>有效期（可选，到期自动失效）</label>
      <input type="date" id="pwExp" value="${entry?.expiresAt ? entry.expiresAt.slice(0, 10) : ''}"></div>` : ''}
    <p class="muted" style="font-size:.84rem">保存后会立即加密并发布到 GitHub 仓库。</p>`;

  const m = modal({
    title: isNew ? '新增访客密码' : `修改「${entry.label || ''}」密码`,
    body,
    okText: '保存并发布',
    onOk: async () => {
      const p1 = body.querySelector('#pw1').value;
      const p2 = body.querySelector('#pw2').value;
      const label = body.querySelector('#pwLabel').value.trim() || '未命名';
      if (p1.length < 6) { toast('密码至少 6 位', 'err'); return false; }
      if (p1 !== p2) { toast('两次输入的密码不一致', 'err'); return false; }
      const expEl = body.querySelector('#pwExp');
      const keys = await setPassword({
        keyId: isNew ? null : entry.id,
        role,
        label,
        password: p1,
        expiresAt: expEl && expEl.value ? new Date(expEl.value + 'T23:59:59').toISOString() : null,
        replaceAll: !!entry?.__replaceAll,
      });
      await applyKeys(keys, `安全：更新${role === 'admin' ? '管理员' : '访客'}密码`);
      if (done) done();
    },
  });
  const pw1 = body.querySelector('#pw1');
  pw1.addEventListener('input', () => {
    const s = passwordStrength(pw1.value);
    body.querySelector('#pwTip').textContent = `强度：${s.text}`;
  });
  return m;
}

async function applyKeys(keys, message) {
  try {
    await publish(message, keys);
    toast('密码已更新并发布', 'ok');
  } catch (e) {
    // 未配置 GitHub 时退化为本地导出
    state.vault.keys = keys;
    toast(`${e.message}；已在本地更新，请导出 vault.json 手动上传`, 'err', 6000);
  }
  refreshBar();
}

/* ---------- 发布设置 ---------- */

function panePublish(root) {
  const cfg = gh.getConfig();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2 style="margin-top:0">GitHub 发布设置</h2>
    <p class="muted" style="font-size:.86rem">Token 只保存在你当前浏览器（localStorage），不会写入仓库。建议使用
      <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">Fine-grained token</a>，
      仅授予本仓库的 <b>Contents: Read and write</b> 权限。</p>
    <div class="grid-2">
      <div class="field"><label>仓库所有者 owner</label><input type="text" id="ghOwner" value="${escapeHtml(cfg.owner || '')}" placeholder="yourname"></div>
      <div class="field"><label>仓库名 repo</label><input type="text" id="ghRepo" value="${escapeHtml(cfg.repo || '')}" placeholder="yourname.github.io"></div>
      <div class="field"><label>分支</label><input type="text" id="ghBranch" value="${escapeHtml(cfg.branch || 'main')}"></div>
      <div class="field"><label>数据文件路径</label><input type="text" id="ghPath" value="${escapeHtml(cfg.path || VAULT_PATH)}"></div>
    </div>
    <div class="field"><label>访问令牌 Token</label><input type="password" id="ghToken" value="${escapeHtml(cfg.token || '')}" placeholder="github_pat_..."></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" id="saveCfg" type="button">保存配置</button>
      <button class="btn" id="testCfg" type="button">测试连接</button>
      <button class="btn btn-danger" id="clearTok" type="button">清除本机 Token</button>
    </div>
    <hr>
    <h3>发布历史</h3>
    <div id="commits"><p class="muted">保存配置后可查看最近的发布记录</p></div>`;
  root.appendChild(card);

  const read = () => ({
    owner: card.querySelector('#ghOwner').value.trim(),
    repo: card.querySelector('#ghRepo').value.trim(),
    branch: card.querySelector('#ghBranch').value.trim() || 'main',
    path: card.querySelector('#ghPath').value.trim() || VAULT_PATH,
    token: card.querySelector('#ghToken').value.trim(),
  });

  card.querySelector('#saveCfg').addEventListener('click', () => {
    gh.saveConfig(read());
    toast('配置已保存', 'ok');
  });
  card.querySelector('#clearTok').addEventListener('click', () => {
    gh.clearToken();
    card.querySelector('#ghToken').value = '';
    toast('已清除本机 Token', 'ok');
  });
  card.querySelector('#testCfg').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const c = read();
      await gh.verifyToken(c);
      gh.saveConfig(c);
      toast('连接成功，权限正常', 'ok');
      loadCommits(c);
    } catch (err) {
      toast(err.message, 'err', 5000);
    } finally {
      btn.disabled = false;
    }
  });

  async function loadCommits(c) {
    const box = card.querySelector('#commits');
    box.innerHTML = '<span class="spinner"></span>';
    try {
      const commits = await gh.listCommits(c, c.path || VAULT_PATH, 10);
      box.innerHTML = commits.length
        ? commits.map((x) => `<div class="list-row"><span class="t"><b>${escapeHtml(x.commit.message.split('\n')[0])}</b>
            <small>${escapeHtml(new Date(x.commit.author.date).toLocaleString())} · ${escapeHtml(x.sha.slice(0, 7))}</small></span>
            <a class="btn btn-sm" href="${escapeHtml(x.html_url)}" target="_blank" rel="noopener noreferrer">查看</a></div>`).join('')
        : '<p class="muted">暂无记录</p>';
    } catch (err) {
      box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  }
  if (cfg.owner && cfg.repo && cfg.token) loadCommits(cfg);
}
