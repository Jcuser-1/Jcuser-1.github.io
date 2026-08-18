/**
 * 页面视图：全部在登录成功后才会渲染。
 */
import { state, visiblePosts, visibleWorks, findPost, categories } from './store.js';
import { isAdmin, session, logout } from './auth.js';
import { renderMarkdown, readingTime, excerpt, escapeHtml } from './markdown.js';
import { $, $$, bindCodeCopy, toggleTheme, formatDate, safeUrl } from './ui.js';
import * as router from './router.js';
import { openPostEditor } from './editor.js';

const app = () => document.getElementById('app');

/* ---------- 布局 ---------- */

const NAV_ITEMS = () => {
  const site = state.content.site || {};
  const items = [
    { href: '#/', text: '首页' },
    { href: '#/resume', text: '简历' },
    { href: '#/timeline', text: '经历' },
  ];
  if (site.showProjects !== false) items.push({ href: '#/works', text: '项目' });
  if (site.showAbout !== false) items.push({ href: '#/about', text: '关于' });
  if (site.showContact !== false) items.push({ href: '#/contact', text: '联系' });
  items.push({ href: '#/search', text: '搜索' });
  return items;
};

export function renderShell() {
  const s = session();
  const admin = isAdmin();
  const site = state.content.site || {};
  app().innerHTML = `
    <header class="nav">
      <div class="nav-inner">
        <a class="nav-brand" href="#/"><span class="dot"></span>${escapeHtml(site.siteName || '我的主页')}</a>
        <nav class="nav-links" id="navLinks">
          ${NAV_ITEMS().map((i) => `<a href="${i.href}">${i.text}</a>`).join('')}
          ${admin ? '<a href="#/admin">管理后台</a>' : ''}
        </nav>
        <div class="nav-actions">
          <span class="role-chip ${admin ? 'admin' : ''}" title="当前身份">${admin ? '管理员' : '访客'}</span>
          <button class="icon-btn" id="themeBtn" type="button" title="切换深浅色">🌓</button>
          <button class="icon-btn" id="logoutBtn" type="button" title="退出登录">⏻</button>
          <button class="icon-btn nav-toggle" id="navToggle" type="button" title="菜单">☰</button>
        </div>
      </div>
    </header>
    <main id="view"></main>
    <footer class="footer">${escapeHtml(site.footer || '')}</footer>`;

  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#logoutBtn').addEventListener('click', () => {
    logout();
    location.reload();
  });
  $('#navToggle').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => $('#navLinks').classList.remove('open')));
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

/* ---------- 首页 ---------- */

export function renderHome() {
  const p = state.content.profile;
  const posts = visiblePosts().slice(0, 3);
  const cards = [
    { href: '#/resume', ic: '📄', t: '在线简历', d: '教育背景、工作实习、项目与技能' },
    { href: '#/timeline', ic: '🗂️', t: '成长经历', d: '时间轴记录，支持分类筛选' },
  ];
  if (state.content.site.showProjects !== false) cards.push({ href: '#/works', ic: '🚀', t: '项目作品', d: '做过的产品与开源项目' });
  if (state.content.site.showAbout !== false) cards.push({ href: '#/about', ic: '👤', t: '关于我', d: '更完整的个人介绍与技能' });
  if (state.content.site.showContact !== false) cards.push({ href: '#/contact', ic: '✉️', t: '联系方式', d: '邮箱与社交账号' });

  view(`
    <div class="page">
      <section class="hero">
        ${p.avatar
          ? `<img class="hero-avatar" src="${escapeHtml(safeUrl(p.avatar))}" alt="${escapeHtml(p.name)}">`
          : `<div class="hero-avatar">${escapeHtml((p.name || '·').slice(0, 1))}</div>`}
        <div style="flex:1;min-width:0">
          <h1>${escapeHtml(p.name)}</h1>
          <p class="role">${escapeHtml(p.title || '')}</p>
          <div>${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p class="bio">${escapeHtml(p.bio || '')}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a class="btn btn-primary" href="#/resume">查看简历</a>
            <a class="btn" href="#/timeline">浏览经历</a>
            ${editBtn('profile', '编辑资料')}
          </div>
        </div>
      </section>

      <h2 class="section-title">去哪里看看</h2>
      <div class="nav-cards">
        ${cards.map((c) => `<a class="nav-card" href="${c.href}">
            <span class="ic">${c.ic}</span>
            <span class="tx"><h3>${c.t}</h3><p>${c.d}</p></span></a>`).join('')}
      </div>

      ${posts.length ? `
      <h2 class="section-title">最近更新 ${isAdmin() ? '<a class="btn btn-sm edit-btn" href="#/admin/posts">管理文章</a>' : ''}</h2>
      <div class="timeline">
        ${posts.map(postCard).join('')}
      </div>` : ''}
    </div>`);
}

/* ---------- 简历 ---------- */

/** 简历正文（教育 / 工作 / 项目 / 技能 / 奖项），公开简历页与版本预览共用 */
export function resumeBodyHtml(r, { editable = false } = {}) {
  const edit = editable
    ? `<a class="btn btn-sm edit-btn" href="#/admin/resume">✎ 编辑</a>`
    : '';
  const list = (title, arr, fn) => `
    <h2 class="section-title">${title}${edit}</h2>
    ${arr && arr.length ? `<div class="group">${arr.map(fn).join('')}</div>` : '<p class="muted">暂无内容</p>'}`;

  const entry = (title, at, period, desc, points) => `
    <div class="entry">
      <div class="entry-head">
        <h3>${escapeHtml(title || '')}</h3>
        ${at ? `<span class="at">${escapeHtml(at)}</span>` : ''}
        ${period ? `<span class="period">${escapeHtml(period)}</span>` : ''}
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
    ${list('教育背景', r.education, (e) => entry(e.school, e.major ? `${e.major}${e.degree ? ' · ' + e.degree : ''}` : e.degree, e.period, e.desc))}
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

export function renderTimeline() {
  const cats = categories();
  const cur = router.query().cat || '';
  const posts = visiblePosts().filter((p) => !cur || p.category === cur);

  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '经历记录' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1">
          <h1>成长经历</h1>
          <p class="desc">共 ${posts.length} 篇记录</p>
        </div>
        ${isAdmin() ? '<button class="btn btn-primary btn-sm" id="newPost" type="button">+ 新建</button>' : ''}
      </div>
      <div class="filters">
        <button class="${cur ? '' : 'active'}" data-cat="">全部</button>
        ${cats.map((c) => `<button class="${cur === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
      ${posts.length ? `<div class="timeline">${posts.map(postCard).join('')}</div>` : '<div class="empty">还没有内容</div>'}
    </div>`);

  $$('.filters button').forEach((b) =>
    b.addEventListener('click', () => {
      const c = b.dataset.cat;
      router.go(c ? `/timeline?cat=${encodeURIComponent(c)}` : '/timeline');
    })
  );
  const nb = document.getElementById('newPost');
  if (nb) nb.addEventListener('click', () => openPostEditor(null));
}

/* ---------- 文章详情 ---------- */

export function renderPost(params) {
  const p = findPost(params.id);
  if (!p) return renderNotFound();
  const { html: body, toc, words } = renderMarkdown(p.body || '');

  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '经历记录', href: '#/timeline' }, { text: p.title }])}
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
      <a class="btn" href="#/timeline">← 返回列表</a>
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

/* ---------- 关于 ---------- */

export function renderAbout() {
  const p = state.content.profile;
  const { html: body } = renderMarkdown(p.about || '');
  const skills = state.content.resume.skills || [];
  view(`
    <div class="page page-narrow">
      ${crumbs([{ text: '首页', href: '#/' }, { text: '关于我' }])}
      <div class="page-head" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1"><h1>关于我</h1><p class="desc">${escapeHtml(p.tagline || '')}</p></div>
        ${editBtn('profile')}
      </div>
      <div class="card md">${body || '<p class="muted">暂无内容</p>'}</div>
      ${skills.length ? `
        <h2 class="section-title">技能可视化</h2>
        <div class="card">${skills.map((s) => `
          <div class="skill-row">
            <div class="name"><span>${escapeHtml(s.name)}</span><span class="muted">${Number(s.level) || 0}%</span></div>
            <div class="skill-bar"><i style="width:${Math.max(0, Math.min(100, Number(s.level) || 0))}%"></i></div>
          </div>`).join('')}</div>` : ''}
    </div>`);
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
