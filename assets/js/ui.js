/**
 * 通用 UI 工具：DOM 构建、提示、弹窗、主题、导航栏。
 */
import { escapeHtml } from './markdown.js';

export { escapeHtml };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? values[i] : ''), '');
}

/* ---------- Toast ---------- */

export function toast(msg, type = 'info', ms = 2600) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ---------- Modal ---------- */

export function modal({ title, body, okText = '保存', cancelText = '取消', onOk, wide = false, hideOk = false }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" style="${wide ? 'max-width:900px' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2>
        <button class="icon-btn" data-close type="button" aria-label="关闭">✕</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot">
        <button class="btn" data-close type="button">${escapeHtml(cancelText)}</button>
        ${hideOk ? '' : `<button class="btn btn-primary" data-ok type="button">${escapeHtml(okText)}</button>`}
      </div>
    </div>`;
  const bodyEl = mask.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const close = () => {
    mask.remove();
    document.body.style.overflow = '';
  };
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-close]')) close();
  });
  const okBtn = mask.querySelector('[data-ok]');
  if (okBtn) {
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      try {
        const r = onOk ? await onOk(bodyEl, close) : true;
        if (r !== false) close();
      } catch (err) {
        toast(err.message || '操作失败', 'err');
      } finally {
        okBtn.disabled = false;
      }
    });
  }
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.style.overflow = 'hidden';
  document.body.appendChild(mask);
  return { el: mask, body: bodyEl, close };
}

export function confirmDialog(message, title = '请确认') {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p style="margin:0">${escapeHtml(message)}</p>`,
      okText: '确定',
      onOk: () => { resolve(true); return true; },
    });
    m.el.addEventListener('click', (e) => {
      if (e.target === m.el || e.target.closest('[data-close]')) resolve(false);
    });
  });
}

/* ---------- 主题 ---------- */

const THEME_KEY = 'jcweb.theme';

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}

export function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
  return document.documentElement.getAttribute('data-theme');
}

/* ---------- 回到顶部 ---------- */

export function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  const onScroll = () => { btn.hidden = window.scrollY < 320; };
  window.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  onScroll();
}

/* ---------- 代码块复制 ---------- */

export function bindCodeCopy(root) {
  $$('[data-copy]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.parentElement.querySelector('code');
      try {
        await navigator.clipboard.writeText(code.innerText);
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制'), 1500);
      } catch (_) {
        toast('复制失败，请手动选择', 'err');
      }
    });
  });
}

/* ---------- 小工具 ---------- */

export function formatDate(d) {
  if (!d) return '';
  const s = String(d);
  const t = new Date(s.replace(/-/g, '/'));
  if (isNaN(t)) return s;
  return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function safeUrl(url) {
  const u = String(url || '').trim();
  return /^(https?:|mailto:|tel:|\.\/|\/|data:image\/)/i.test(u) ? u : '';
}
