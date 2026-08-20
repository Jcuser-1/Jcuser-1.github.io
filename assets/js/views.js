/**
 * 页面视图：全部在登录成功后才会渲染。
 */
import { state, visiblePosts, visibleWorks, findPost, categories, markDirty } from './store.js';
import { isAdmin, session, logout } from './auth.js';
import { renderMarkdown, readingTime, excerpt, escapeHtml } from './markdown.js';
import { $, $$, bindCodeCopy, formatDate, safeUrl, toast, modal } from './ui.js';
import * as router from './router.js';
import { openPostEditor } from './editor.js';

const app = () => document.getElementById('app');

/* ---------- 布局 ---------- */

const NAV_ITEMS = () => {
  const site = state.content.site || {};
  const items = [
    { href: '#/', text: '首页' },
    { href: '#/resume', text: '简历' },
    { href: '#/timeline', text: '实习经历' },
  ];
  if (site.showProjects !== false) items.push({ href: '#/works', text: '项目' });
  if (site.showAbout !== false) items.push({ href: '#/about', text: '项目经历' });
  if (site.showContact !== false) items.push({ href: '#/contact', text: '联系' });
  items.push({ href: '#/search', text: '搜索' });
  return items;
};

export function renderShell() {
  const s = session();
  const admin = isAdmin();
  const site = state.content.site || {};
  const name = state.content.profile?.name || site.siteName || '我的主页';
  app().innerHTML = `
    <header class="nav">
      <div class="nav-inner">
        <div class="runners" aria-hidden="true">
          <svg class="runner walk-scene" viewBox="0 0 92 46">
            <circle cx="21" cy="6.5" r="4" class="runner-head"></circle>
            <line x1="19" y1="11" x2="17" y2="24" class="runner-torso"></line>
            <g class="limb arm-a"><line x1="19" y1="13" x2="25" y2="17" class="upper"></line><line x1="25" y1="17" x2="24" y2="11" class="fore"></line></g>
            <g class="limb arm-b"><line x1="19" y1="13" x2="13" y2="16" class="upper"></line><line x1="13" y1="16" x2="14" y2="21" class="fore"></line></g>
            <g class="limb leg-a"><line x1="17" y1="24" x2="12" y2="31" class="thigh"></line><line x1="12" y1="31" x2="14" y2="39" class="shin"></line></g>
            <g class="limb leg-b"><line x1="17" y1="24" x2="23" y2="30" class="thigh"></line><line x1="23" y1="30" x2="21" y2="38" class="shin"></line></g>
            <line x1="25" y1="12" x2="79" y2="23" class="leash"></line>
            <g class="dog">
              <line x1="57" y1="26" x2="80" y2="24" class="dog-body"></line>
              <circle cx="84" cy="21" r="3.6" class="dog-head"></circle>
              <line x1="87.5" y1="21.5" x2="91" y2="23" class="dog-snout"></line>
              <line x1="83" y1="17.5" x2="81" y2="14" class="dog-ear"></line>
              <g class="dog-limb dla"><line x1="78" y1="25.5" x2="82" y2="30.5"></line><line x1="82" y1="30.5" x2="80" y2="36"></line></g>
              <g class="dog-limb dlb"><line x1="76.5" y1="25.5" x2="72.5" y2="30.5"></line><line x1="72.5" y1="30.5" x2="74.5" y2="36"></line></g>
              <g class="dog-limb dlc"><line x1="60" y1="25.5" x2="56" y2="30.5"></line><line x1="56" y1="30.5" x2="58" y2="36"></line></g>
              <g class="dog-limb dld"><line x1="58.5" y1="25.5" x2="62.5" y2="30.5"></line><line x1="62.5" y1="30.5" x2="60.5" y2="36"></line></g>
              <line x1="57.5" y1="24.5" x2="52" y2="19" class="dog-tail"></line>
            </g>
          </svg>
        </div>
        <a class="nav-brand" href="#/">
          <span class="brand-mark">${escapeHtml(name.slice(0, 1))}</span>
          <span class="brand-text"><b>${escapeHtml(name)}</b></span>
        </a>
        <nav class="nav-links" id="navLinks">
          ${NAV_ITEMS().map((i) => `<a href="${i.href}">${i.text}</a>`).join('')}
          ${admin ? '<a href="#/admin">管理后台</a>' : ''}
        </nav>
        <div class="nav-actions">
          <span class="role-chip ${admin ? 'admin' : ''}" title="当前身份">${admin ? '管理员' : '访客'}</span>
          <button class="icon-btn" id="logoutBtn" type="button" title="退出登录">⏻</button>
          <button class="icon-btn nav-toggle" id="navToggle" type="button" title="菜单">☰</button>
        </div>
      </div>
    </header>
    <main id="view"></main>
    <footer class="footer">${escapeHtml(site.footer || '')}</footer>`;

  $('#logoutBtn').addEventListener('click', () => {
    logout();
    location.reload();
  });
  $('#navToggle').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => $('#navLinks').classList.remove('open')));

  // 滚动收缩：页面下滚后导航变紧凑 + 阴影/流光显现
  const navEl = document.querySelector('.nav');
  const onScroll = () => navEl && navEl.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

export function highlightNav(path) {
  $$('#navLinks a').forEach((a) => {
    const href = a.getAttribute('href').replace('#', '');
    const active = href === '/' ? path === '/' : path.startsWith(href);
    a.classList.toggle('active', active);
  });
}

function view(inner) {
  const v = document.getElementById('view');
  if (!v) return;
  v.innerHTML = inner;
  bindCodeCopy(v);
}

const editBtn = (target, text = '编辑') =>
  isAdmin() ? `<a class="btn btn-sm edit-btn" href="#/admin/${target}">✎ ${text}</a>` : '';

const crumbs = (items) =>
  `<nav class="crumbs">${items
    .map((it, i) => (it.href ? `<a href="${it.href}">${escapeHtml(it.text)}</a>` : `<b>${escapeHtml(it.text)}</b>`) + (i < items.length - 1 ? '<span>/</span>' : ''))
    .join('')}</nav>`;

/* ---------- 首页 · 深蓝封面 ---------- */

export function renderHome() {
  const p = state.content.profile;
  const posts = visiblePosts().slice(0, 3);
  const { html: aboutHtml } = renderMarkdown(p.about || '');
  const cards = [
    { href: '#/resume', ic: '📄', t: '在线简历', d: '教育背景、实习、项目与技能' },
    { href: '#/timeline', ic: '💼', t: '实习经历', d: '工作与实习时间轴' },
  ];
  if (state.content.site.showAbout !== false) cards.push({ href: '#/about', ic: '🚀', t: '项目经历', d: '做过的项目与竞赛作品' });
  if (state.content.site.showContact !== false) cards.push({ href: '#/contact', ic: '✉️', t: '联系方式', d: '邮箱与微信' });

  view(`
    <section class="landing">
      <div class="landing-bg">
        <video class="landing-video" id="landingVideo" autoplay muted loop playsinline preload="auto" src="assets/video/cover.mp4"></video>
        <div class="landing-veil"></div>
        <div class="landing-admin">${editBtn('profile', '编辑资料')}</div>
        <div class="landing-inner">
          <a class="avatar-ring" href="#/resume" title="点击进入">
            ${p.avatar
              ? `<img src="${escapeHtml(safeUrl(p.avatar))}" alt="${escapeHtml(p.name)}">`
              : `<div class="avatar-fallback">${escapeHtml((p.name || '·').slice(0, 1))}</div>`}
            <span class="avatar-hint">点击进入</span>
          </a>
          <h1>${escapeHtml(p.name)}</h1>
          <p class="landing-role">${escapeHtml(p.title || '')}</p>
          ${(p.contacts || []).length ? `
          <div class="landing-contacts">
            ${(p.contacts || []).map((c) => {
              const link = safeUrl(c.link);
              const inner = `<span>${escapeHtml(c.icon || '🔗')}</span><span>${escapeHtml(c.value || c.label || '')}</span>`;
              return link
                ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
                : `<a href="#/contact">${inner}</a>`;
            }).join('')}
          </div>` : ''}
        </div>
        <div class="scroll-hint">SCROLL</div>
      </div>
    </section>

    <div class="page">
      <h2 class="section-title">去哪里看看</h2>
      <div class="nav-cards">
        ${cards.map((c) => `<a class="nav-card" href="${c.href}">
            <span class="ic">${c.ic}</span>
            <span class="tx"><h3>${c.t}</h3><p>${c.d}</p></span></a>`).join('')}
      </div>

      ${aboutHtml && p.about ? `
      <h2 class="section-title">关于我${isAdmin() ? `<a class="btn btn-sm edit-btn" href="#/admin/profile">✎ 编辑</a>` : ''}</h2>
      <div class="card md">${aboutHtml}</div>` : ''}

      ${posts.length ? `
      <h2 class="section-title">最近更新 ${isAdmin() ? '<a class="btn btn-sm edit-btn" href="#/admin/posts">管理文章</a>' : ''}</h2>
      <div class="timeline">
        ${posts.map(postCard).join('')}
      </div>` : ''}
    </div>`);

  const lv = document.getElementById('landingVideo');
  if (lv) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lv.pause();
      lv.removeAttribute('autoplay');
    } else {
      lv.addEventListener('canplay', () => lv.classList.add('is-ready'), { once: true });
      if (lv.readyState >= 3) lv.classList.add('is-ready');
      lv.addEventListener('error', () => lv.remove(), { once: true });
      lv.play().catch(() => {});
    }
  }

  // 封面底部滚动提示：点击平滑滚到内容区
  const sh = document.querySelector('.scroll-hint');
  if (sh) sh.addEventListener('click', () => {
    const target = document.querySelector('.page');
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
}

/* ---------- 简历 ---------- */

/** 机构徽标映射（全站浅色模式，单版本） */
const ORG_LOGOS = {
  '电子科技大学': 'assets/img/电子科技大学.png',
  '浙江理工大学': 'assets/img/浙江理工大学.png',
  '梅卡曼德': 'assets/img/梅卡曼德logo.png',
  '联芸': 'assets/img/联芸科技.png',
};
const orgLogoHtml = (name) => {
  const hit = Object.entries(ORG_LOGOS).find(([k]) => String(name || '').includes(k));
  if (!hit) return `<span class="org-logo org-logo-text">${escapeHtml((name || '·').slice(0, 1))}</span>`;
  return `<img class="org-logo" src="${encodeURI(hit[1])}?v=hd5" alt="${escapeHtml(name)}" loading="lazy">`;
};

/** 简历正文（教育 / 工作 / 项目 / 技能 / 奖项），公开简历页与版本预览共用 */
export function resumeBodyHtml(r, { editable = false } = {}) {
  const edit = editable
    ? `<a class="btn btn-sm edit-btn" href="#/admin/resume">✎ 编辑</a>`
    : '';
  const list = (title, arr, fn) => `
    <h2 class="section-title">${title}${edit}</h2>
    ${arr && arr.length ? `<div class="group">${arr.map(fn).join('')}</div>` : '<p class="muted">暂无内容</p>'}`;

  const entry = (title, at, period, desc, points, logo = false) => `
    <div class="entry">
      <div class="entry-head">
        ${logo ? orgLogoHtml(title) : ''}
        <div class="entry-main">
          <div class="entry-line">
            <h3>${escapeHtml(title || '')}</h3>
            ${at ? `<span class="at">${escapeHtml(at)}</span>` : ''}
          </div>
          ${period ? `<span class="period">${escapeHtml(period)}</span>` : ''}
        </div>
      </div>
      ${desc ? `<p class="desc">${escapeHtml(desc)}</p>` : ''}
      ${points && points.length ? `<ul>${points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
    </div>`;

  const groups = {};
  (r.skills || []).forEach((s) => {
    const g = s.group || '技能';
    (groups[g] = groups[g] || []).push(s);
  });

  return `
    ${list('教育背景', r.education, (e) => entry(e.school, e.major ? `${e.major}${e.degree ? ' · ' + e.degree : ''}` : e.degree, e.period, e.desc, null, true))}
    ${list('实习 / 工作经历', r.work, (e) => entry(e.company, e.role, e.period, e.desc, e.points))}
    ${list('项目经历', r.projects, (e) => entry(e.name, e.role, e.period, e.desc, e.points))}

    <h2 class="section-title">技能清单${edit}</h2>
    ${Object.keys(groups).length
      ? Object.entries(groups).map(([g, arr]) => `
        <div class="card" style="margin-bottom:12px">
          <h3 style="margin-top:0">${escapeHtml(g)}</h3>
          ${arr.map((s) => `
            <div class="skill-row">
              <div class="name"><span>${escapeHtml(s.name)}</span><span class="muted">${Number(s.level) || 0}%</span></div>
              <div class="skill-bar"><i style="width:${Math.max(0, Math.min(100, Number(s.level) || 0))}%"></i></div>
            </div>`).join('')}
        </div>`).join('')
      : '<p class="muted">暂无内容</p>'}

    ${list('荣誉奖项', r.awards, (a) => entry(a.name, a.issuer, a.date, a.desc))}`;
}

export function renderResume() {
  const r = state.content.resume;
  const p = state.content.profile;

  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '简历' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h1>${escapeHtml(p.name)} · 个人简历</h1>
          <p class="desc">${escapeHtml(r.summary || p.title || '')}</p>
        </div>
        <div class="no-print" style="display:flex;gap:8px">
          <button class="btn" id="printBtn" type="button">⬇ 导出 PDF</button>
          ${editBtn('resume')}
        </div>
      </div>

      ${resumeBodyHtml(r, { editable: isAdmin() })}
    </div>`);

  const btn = document.getElementById('printBtn');
  if (btn) btn.addEventListener('click', () => window.print());
}

/* ---------- 经历时间轴 ---------- */

function postCard(p) {
  return `
    <div class="tl-item">
      <a class="tl-card" href="#/post/${encodeURIComponent(p.id)}">
        <div class="tl-meta">
          <span>${escapeHtml(formatDate(p.date))}</span>
          ${p.category ? `<span class="tag tag-plain">${escapeHtml(p.category)}</span>` : ''}
          ${p.draft ? '<span class="badge badge-draft">草稿</span>' : ''}
          ${p.adminOnly ? '<span class="badge badge-lock">仅管理员</span>' : ''}
        </div>
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.summary || excerpt(p.body))}</p>
      </a>
    </div>`;
}

/* ---------- 实习经历 ---------- */

/** 面试笔记：仅管理员可见的私密备注，不对外渲染、不进打印 */
function openInterviewNote(item, title) {
  const body = document.createElement('div');
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.style.cssText = 'font-size:.84rem;margin:0 0 12px';
  hint.textContent = '仅管理员可见，不会展示给访客。建议按「背景 → 做了什么 → 结果 → 强调什么」组织。保存后记得「一键发布」。';
  const ta = document.createElement('textarea');
  ta.rows = 14;
  ta.value = item.interviewNote || '';
  ta.placeholder = '写下这段经历的面试讲法…';
  body.append(hint, ta);
  modal({
    title: `💬 面试笔记 · ${title}`,
    body,
    wide: true,
    okText: '保存',
    onOk: () => {
      const v = ta.value.trim();
      if (v) item.interviewNote = v;
      else delete item.interviewNote;
      markDirty();
      toast('面试笔记已保存到本地草稿，记得点击「一键发布」', 'ok', 3500);
      router.resolve();
    },
  });
}

function bindNoteButtons(root, list, attr) {
  $$(`[data-${attr}]`, root).forEach((b) => {
    b.addEventListener('click', () => {
      const item = list[+b.dataset[attr === 'note-work' ? 'noteWork' : 'noteProj']];
      if (item) openInterviewNote(item, item.company || item.name || '');
    });
  });
}

const noteBtn = (attr, idx, has) =>
  isAdmin()
    ? `<button class="btn btn-sm note-btn no-print ${has ? 'has' : ''}" data-${attr}="${idx}" type="button">💬 面试笔记</button>`
    : '';

function workExpItem(e, i) {
  const period = String(e.period || '');
  const [start, end] = period.split(/\s*[-–—~至到]\s*/);
  const points = (e.points || []).filter(Boolean);
  return `
    <div class="exp-item ${i % 2 ? 'alt' : ''}">
      <div class="exp-date">
        <strong>${escapeHtml(start || period || '')}</strong>
        ${end ? `<span>至 ${escapeHtml(end)}</span>` : ''}
      </div>
      <div class="exp-rail"><span class="exp-dot"></span></div>
      <div class="exp-card">
        <div class="exp-org">
          ${orgLogoHtml(e.company)}
          <div class="exp-org-main">
            <h3>${escapeHtml(e.company || '经历')}</h3>
            <p class="meta">
              ${escapeHtml(e.role || '')}${e.role ? '<span class="exp-degree">实习 / 工作</span>' : ''}
              ${noteBtn('note-work', i, !!e.interviewNote)}
            </p>
          </div>
        </div>
        ${e.desc ? `<p style="margin:0 0 ${points.length ? 14 : 0}px;color:var(--text-soft);font-size:15px">${escapeHtml(e.desc)}</p>` : ''}
        ${points.length ? `<ul>${points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
}

export function renderTimeline() {
  const works = state.content.resume.work || [];
  view(`
    <div class="page">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '实习经历' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1">
          <h1>实习经历</h1>
          <p class="desc">共 ${works.length} 段经历</p>
        </div>
        ${editBtn('resume')}
      </div>
      ${works.length
        ? `<div class="exp-timeline">${works.map(workExpItem).join('')}</div>`
        : '<div class="empty">还没有实习 / 工作经历，可在后台「简历内容」中添加</div>'}
    </div>`);
  bindNoteButtons(document, works, 'note-work');
}

/* ---------- 文章详情 ---------- */

export function renderPost(params) {
  const p = findPost(params.id);
  if (!p) return renderNotFound();
  const { html: body, toc, words } = renderMarkdown(p.body || '');

  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '文章', href: '#/' }, { text: p.title }])}
      <article>
        <header class="article-head">
          <h1>${escapeHtml(p.title)}</h1>
          <div class="tl-meta">
            <span>${escapeHtml(formatDate(p.date))}</span>
            ${p.category ? `<span class="tag tag-plain">${escapeHtml(p.category)}</span>` : ''}
            <span>约 ${words} 字 · ${readingTime(words)} 分钟</span>
            ${p.draft ? '<span class="badge badge-draft">草稿</span>' : ''}
            ${p.adminOnly ? '<span class="badge badge-lock">仅管理员可见</span>' : ''}
            ${isAdmin() ? '<button class="btn btn-sm edit-btn" id="editPost" type="button" style="margin-left:auto">✎ 编辑</button>' : ''}
          </div>
          ${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </header>
        ${p.cover ? `<img src="${escapeHtml(safeUrl(p.cover))}" alt="" style="border-radius:14px;width:100%;margin-bottom:20px">` : ''}
        ${toc.length > 2 ? `<div class="toc"><strong>目录</strong><ul>${toc
          .map((t) => `<li class="lv${t.level}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
          .join('')}</ul></div>` : ''}
        <div class="md">${body}</div>
      </article>
      <hr>
      <a class="btn" href="#/">← 返回首页</a>
    </div>`);

  const eb = document.getElementById('editPost');
  if (eb) eb.addEventListener('click', () => openPostEditor(p.id));
  // 目录锚点使用 hash 路由，这里改为手动滚动，避免触发路由跳转
  $$('.toc a, .md .anchor').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );
}

/* ---------- 项目作品集 ---------- */

export function renderWorks() {
  const works = visibleWorks();
  view(`
    <div class="page page-wide">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '项目作品' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1"><h1>项目作品</h1><p class="desc">共 ${works.length} 个项目</p></div>
        ${editBtn('works', '管理项目')}
      </div>
      ${works.length ? `<div class="proj-grid">${works.map((w) => `
        <div class="proj-card">
          ${w.cover ? `<img class="proj-cover" src="${escapeHtml(safeUrl(w.cover))}" alt="${escapeHtml(w.title)}" loading="lazy">` : ''}
          <div class="proj-body">
            <h3>${escapeHtml(w.title)} ${w.pinned ? '<span class="badge">置顶</span>' : ''}</h3>
            <p>${escapeHtml(w.desc || '')}</p>
            <div>${(w.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
            ${safeUrl(w.link) ? `<a class="btn btn-sm" style="margin-top:10px;align-self:flex-start" href="${escapeHtml(safeUrl(w.link))}" target="_blank" rel="noopener noreferrer">访问项目 ↗</a>` : ''}
          </div>
        </div>`).join('')}</div>` : '<div class="empty">还没有项目</div>'}
    </div>`);
}

/* ---------- 项目经历 ---------- */

export function renderAbout() {
  const projects = state.content.resume.projects || [];
  view(`
    <div class="page">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '项目经历' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1">
          <h1>项目经历</h1>
          <p class="desc">共 ${projects.length} 个项目</p>
        </div>
        ${editBtn('resume')}
      </div>
      ${projects.length ? `<div class="pj-grid">${projects.map((e, i) => `
        <div class="pj-card">
          <div class="pj-head">
            <span>${escapeHtml(e.period || '')}</span>
            ${noteBtn('note-proj', i, !!e.interviewNote)}
            <strong>${escapeHtml(e.role || '成员')}</strong>
          </div>
          <h2>${escapeHtml(e.name || '未命名项目')}</h2>
          <p>${escapeHtml(e.desc || '')}</p>
          ${(e.points || []).length ? `<ul>${e.points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
        </div>`).join('')}</div>` : '<div class="empty">还没有项目经历，可在后台「简历内容」中添加</div>'}
    </div>`);
  bindNoteButtons(document, projects, 'note-proj');
}

/* ---------- 联系 ---------- */

export function renderContact() {
  const p = state.content.profile;
  const items = p.contacts || [];
  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '联系方式' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1"><h1>联系方式</h1><p class="desc">欢迎交流</p></div>
        ${editBtn('profile')}
      </div>
      ${items.length ? `<div class="contact-list">${items.map((c) => {
        const link = safeUrl(c.link);
        const inner = `<span class="ic">${escapeHtml(c.icon || '🔗')}</span><span><span class="k">${escapeHtml(c.label || '')}</span><br><span class="v">${escapeHtml(c.value || '')}</span></span>`;
        return link
          ? `<a class="contact-item" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
          : `<div class="contact-item">${inner}</div>`;
      }).join('')}</div>` : '<div class="empty">暂未填写</div>'}
    </div>`);
}

/* ---------- 搜索 ---------- */

export function renderSearch() {
  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '搜索' }])}
      <h1>全站搜索</h1>
      <div class="search-box">
        <input type="text" id="q" placeholder="搜索经历、项目、简历内容…" autocomplete="off">
      </div>
      <div class="search-results" id="results"><p class="muted">输入关键词开始搜索</p></div>
    </div>`);

  const input = document.getElementById('q');
  const box = document.getElementById('results');
  const run = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.innerHTML = '<p class="muted">输入关键词开始搜索</p>'; return; }
    const hits = [];
    visiblePosts().forEach((p) => {
      const text = `${p.title} ${p.summary || ''} ${p.body || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
      if (text.includes(q)) hits.push({ type: '经历', title: p.title, desc: excerpt(p.body, 110), href: `#/post/${encodeURIComponent(p.id)}` });
    });
    visibleWorks().forEach((w) => {
      if (`${w.title} ${w.desc || ''} ${(w.tags || []).join(' ')}`.toLowerCase().includes(q))
        hits.push({ type: '项目', title: w.title, desc: w.desc || '', href: '#/works' });
    });
    const r = state.content.resume;
    [...(r.education || []).map((e) => ({ t: e.school, d: `${e.major || ''} ${e.desc || ''}` })),
     ...(r.work || []).map((e) => ({ t: e.company, d: `${e.role || ''} ${e.desc || ''}` })),
     ...(r.projects || []).map((e) => ({ t: e.name, d: `${e.role || ''} ${e.desc || ''}` })),
     ...(r.skills || []).map((e) => ({ t: e.name, d: e.group || '' }))]
      .forEach((x) => {
        if (`${x.t} ${x.d}`.toLowerCase().includes(q)) hits.push({ type: '简历', title: x.t, desc: x.d, href: '#/resume' });
      });

    box.innerHTML = hits.length
      ? hits.map((h) => `<a class="list-row" href="${h.href}">
          <span class="tag tag-plain">${h.type}</span>
          <span class="t"><b>${escapeHtml(h.title)}</b><small>${escapeHtml(h.desc)}</small></span></a>`).join('')
      : '<div class="empty">没有找到相关内容</div>';
  };
  input.addEventListener('input', run);
  input.focus();
}

/* ---------- 404 ---------- */

export function renderNotFound() {
  view(`
    <div class="page page-404">
      <div class="err-code">404</div>
      <h1>页面走丢了</h1>
      <p class="muted">你访问的内容不存在或已被删除。</p>
      <a class="btn btn-primary" href="#/">返回首页</a>
    </div>`);
}
