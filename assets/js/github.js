/**
 * GitHub 内容发布：通过 GitHub REST API 把加密后的 vault.json 写回仓库。
 * Token 仅保存在管理员本机浏览器（localStorage），绝不会写入仓库。
 */
import { utf8ToB64 } from './crypto.js';

const CFG_KEY = 'jcweb.gh';

export function getConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return { branch: 'main', path: 'data/vault.json', ...JSON.parse(raw) };
  } catch (_) {}
  const guess = guessFromLocation();
  return { owner: guess.owner, repo: guess.repo, branch: 'main', path: 'data/vault.json', token: '' };
}

export function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

export function clearToken() {
  const cfg = getConfig();
  cfg.token = '';
  saveConfig(cfg);
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.owner && c.repo && c.token);
}

/** 从 *.github.io 域名推断仓库信息，减少手工填写 */
function guessFromLocation() {
  const host = location.hostname || '';
  const m = host.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const owner = m[1];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg && !seg.includes('.') ? seg : `${owner}.github.io` };
}

async function api(cfg, path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (res.status === 404 && options.method !== 'PUT') return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message ? `GitHub API: ${data.message}` : `GitHub API 请求失败 (${res.status})`);
  }
  return data;
}

export async function verifyToken(cfg) {
  const repo = await api(cfg, `/repos/${cfg.owner}/${cfg.repo}`);
  if (!repo) throw new Error('仓库不存在，或 Token 无访问权限');
  if (repo.permissions && !repo.permissions.push) throw new Error('该 Token 没有写入（push）权限');
  return repo;
}

async function getSha(cfg, path) {
  const data = await api(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`);
  return data && data.sha ? data.sha : null;
}

/** 写入（新建或更新）一个文本文件 */
export async function putFile(cfg, path, text, message) {
  const sha = await getSha(cfg, path);
  return api(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `chore: update ${path}`,
      content: utf8ToB64(text),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

/** 上传图片等二进制资源（内容为 base64 字符串） */
export async function putBinary(cfg, path, base64, message) {
  const sha = await getSha(cfg, path);
  return api(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `chore: upload ${path}`,
      content: base64,
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

/** 读取 vault.json 的历史提交记录（用于版本回退提示） */
export async function listCommits(cfg, path, limit = 10) {
  const data = await api(
    cfg,
    `/repos/${cfg.owner}/${cfg.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(cfg.branch)}&per_page=${limit}`
  );
  return Array.isArray(data) ? data : [];
}
