/**
 * 极简 hash 路由。所有页面都在登录后才会被挂载，未验证时路由不生效。
 */

const routes = [];
let notFound = null;
let onNavigate = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:([\w]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  routes.push({ regex, keys, handler, pattern });
}

export function setNotFound(handler) { notFound = handler; }
export function setOnNavigate(fn) { onNavigate = fn; }

export function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h || '/';
}

export function go(path, replace = false) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) location.replace(target);
  else location.hash = target;
}

export function resolve() {
  const path = currentPath().split('?')[0];
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      if (onNavigate) onNavigate(path, r.pattern);
      r.handler(params);
      return;
    }
  }
  if (onNavigate) onNavigate(path, null);
  if (notFound) notFound();
}

export function start() {
  window.addEventListener('hashchange', () => {
    resolve();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  resolve();
}

/** 读取 hash 中的查询参数，如 #/timeline?cat=随笔 */
export function query() {
  const q = currentPath().split('?')[1];
  return q ? Object.fromEntries(new URLSearchParams(q)) : {};
}
