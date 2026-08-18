/**
 * 加密工具：基于 WebCrypto 的 PBKDF2 + AES-GCM。
 *
 * 设计要点：
 *  - 站点内容使用随机生成的「主密钥」加密（AES-GCM 256）。
 *  - 主密钥被「管理员密码」和「访客密码」分别包裹（key wrapping）后存入 vault.json。
 *  - 因此仓库里不存在任何明文密码，也不存在明文内容；未通过验证无法拿到任何数据。
 *  - 修改访客密码时只需用新密码重新包裹主密钥，无需重新加密全部内容。
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 210000;

/* ---------- base64 ---------- */

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 安全的 base64（用于 GitHub API 提交文件内容） */
export function utf8ToB64(str) {
  return bufToB64(enc.encode(str));
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/* ---------- 密钥派生 ---------- */

async function deriveKek(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importMasterKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/* ---------- 主密钥 ---------- */

export function generateMasterKeyRaw() {
  return randomBytes(32);
}

/** 用某个密码包裹主密钥，生成一条 vault.keys 记录 */
export async function wrapMasterKey(masterRaw, password, meta = {}, iterations = KDF_ITERATIONS) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await deriveKek(password, salt, iterations);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, masterRaw);
  return {
    id: meta.id || `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: meta.role || 'guest',
    label: meta.label || '访客密码',
    enabled: meta.enabled !== false,
    createdAt: meta.createdAt || new Date().toISOString(),
    expiresAt: meta.expiresAt || null,
    maxVisits: meta.maxVisits || null,
    iterations,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    wrapped: bufToB64(wrapped),
  };
}

/**
 * 尝试用密码解开 vault 中任意一条 key 记录。
 * @returns {Promise<{masterRaw: Uint8Array, entry: object}|null>}
 */
export async function unwrapWithPassword(vault, password) {
  const keys = Array.isArray(vault?.keys) ? vault.keys : [];
  // 管理员优先，保证同一密码不会被访客条目抢先匹配
  const ordered = [...keys].sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0));
  for (const entry of ordered) {
    if (entry.enabled === false) continue;
    if (entry.expiresAt && Date.now() > new Date(entry.expiresAt).getTime()) continue;
    try {
      const kek = await deriveKek(password, b64ToBuf(entry.salt), entry.iterations || KDF_ITERATIONS);
      const raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBuf(entry.iv) },
        kek,
        b64ToBuf(entry.wrapped)
      );
      return { masterRaw: new Uint8Array(raw), entry };
    } catch (_) {
      /* 密码不匹配，继续尝试下一条 */
    }
  }
  return null;
}

/* ---------- 内容加解密 ---------- */

export async function encryptJson(masterRaw, obj) {
  const key = await importMasterKey(masterRaw);
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: bufToB64(iv), data: bufToB64(data) };
}

export async function decryptJson(masterRaw, payload) {
  const key = await importMasterKey(masterRaw);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(payload.iv) },
    key,
    b64ToBuf(payload.data)
  );
  return JSON.parse(dec.decode(plain));
}

/** 密码强度粗评估，仅用于前端提示 */
export function passwordStrength(pwd) {
  if (!pwd) return { score: 0, text: '请输入密码' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^\w\s]/.test(pwd)) score++;
  const text = ['非常弱', '弱', '一般', '较强', '强', '很强'][score];
  return { score, text };
}
