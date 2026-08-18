/**
 * 双密码鉴权 + 登录状态持久化。
 * 无账号体系：只凭密码区分身份（admin / guest）。
 */
import { unwrapWithPassword, bufToB64, b64ToBuf } from './crypto.js';

const SESSION_KEY = 'jcweb.session';
const DEFAULT_DAYS = 7;

let current = null; // { role, label, keyId, masterRaw, expiresAt }

/** 使用密码解锁，成功返回会话对象 */
export async function login(vault, password, remember = true, days = DEFAULT_DAYS) {
  const res = await unwrapWithPassword(vault, password);
  if (!res) return null;
  const expiresAt = Date.now() + days * 86400000;
  current = {
    role: res.entry.role === 'admin' ? 'admin' : 'guest',
    label: res.entry.label || '',
    keyId: res.entry.id,
    fp: String(res.entry.wrapped).slice(0, 16),
    masterRaw: res.masterRaw,
    expiresAt,
  };
  persist(remember);
  return current;
}

function persist(remember) {
  if (!current) return;
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  try {
    other.removeItem(SESSION_KEY);
    store.setItem(
      SESSION_KEY,
      JSON.stringify({
        role: current.role,
        label: current.label,
        keyId: current.keyId,
        fp: current.fp,
        k: bufToB64(current.masterRaw),
        expiresAt: current.expiresAt,
      })
    );
  } catch (_) {
    /* 隐私模式下可能写入失败，忽略 */
  }
}

/** 从本地恢复登录状态；vault 校验确保密钥被吊销后本地会话立即失效 */
export function restore(vault) {
  for (const store of [localStorage, sessionStorage]) {
    let raw;
    try {
      raw = store.getItem(SESSION_KEY);
    } catch (_) {
      continue;
    }
    if (!raw) continue;
    try {
      const s = JSON.parse(raw);
      if (!s.k || !s.expiresAt || Date.now() > s.expiresAt) {
        store.removeItem(SESSION_KEY);
        continue;
      }
      const entry = (vault.keys || []).find((k) => k.id === s.keyId);
      if (!entry || entry.enabled === false) {
        store.removeItem(SESSION_KEY);
        continue;
      }
      if (entry.expiresAt && Date.now() > new Date(entry.expiresAt).getTime()) {
        store.removeItem(SESSION_KEY);
        continue;
      }
      // 密钥被重置（重新包裹）后 wrapped 会变化，这里用指纹校验强制重新登录
      if (s.fp && s.fp !== entry.wrapped.slice(0, 16)) {
        store.removeItem(SESSION_KEY);
        continue;
      }
      current = {
        role: entry.role === 'admin' ? 'admin' : 'guest',
        label: entry.label || '',
        keyId: s.keyId,
        fp: String(entry.wrapped).slice(0, 16),
        masterRaw: b64ToBuf(s.k),
        expiresAt: s.expiresAt,
      };
      return current;
    } catch (_) {
      store.removeItem(SESSION_KEY);
    }
  }
  return null;
}

export function logout() {
  current = null;
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

export function session() {
  if (current && Date.now() > current.expiresAt) logout();
  return current;
}

export const isLoggedIn = () => !!session();
export const isAdmin = () => session()?.role === 'admin';
export const masterKey = () => session()?.masterRaw || null;
