/**
 * 内容仓库：加载 / 解密 / 本地草稿 / 加密发布。
 */
import { decryptJson, encryptJson, wrapMasterKey, generateMasterKeyRaw } from './crypto.js';
import { masterKey, isAdmin } from './auth.js';
import * as gh from './github.js';

export const VAULT_PATH = 'data/vault.json';
const DRAFT_KEY = 'jcweb.draft';

/** 简历版本的投递状态（轻量四态） */
export const RESUME_STATUSES = [
  { id: 'none', name: '未投递' },
  { id: 'applied', name: '已投递' },
  { id: 'interview', name: '面试中' },
  { id: 'closed', name: '已结束' },
];

export const state = {
  vault: null,      // 加密文件原文（含 keys / payload）
  content: null,    // 解密后的内容对象
  dirty: false,     // 存在未发布的本地改动
  loadedAt: 0,
};

/* ---------- 默认内容 ---------- */

export function defaultContent() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    profile: {
      name: '你的名字',
      avatar: '',
      title: '前端工程师 / 在读学生',
      tagline: '记录成长，沉淀作品',
      bio: '这里是一段简短的自我介绍，登录后可在管理后台随时修改。',
      tags: ['前端开发', 'Node.js', '产品思维'],
      location: '中国',
      contacts: [
        { icon: '✉️', label: '邮箱', value: 'you@example.com', link: 'mailto:you@example.com' },
        { icon: '🐙', label: 'GitHub', value: 'github.com/yourname', link: 'https://github.com/yourname' },
      ],
      about: '## 关于我\n\n在这里写更完整的个人介绍，支持 **Markdown** 语法。',
    },
    resume: {
      summary: '一句话概括你的核心竞争力。',
      education: [
        { school: '某某大学', major: '计算机科学与技术', degree: '本科', period: '2021.09 - 2025.06', desc: 'GPA 3.8/4.0，主修课程：数据结构、操作系统、计算机网络。' },
      ],
      work: [
        { company: '某某科技', role: '前端开发实习生', period: '2024.07 - 2024.12', desc: '负责中后台系统的开发与优化。', points: ['独立完成 3 个核心模块开发', '首屏加载时间优化 40%'] },
      ],
      projects: [
        { name: '个人主页系统', role: '独立开发', period: '2025.01 - 至今', desc: '基于纯静态托管的私密个人主页，支持在线编辑与双密码鉴权。', points: ['WebCrypto 端到端加密', 'GitHub API 一键发布'] },
      ],
      skills: [
        { name: 'JavaScript / TypeScript', level: 90, group: '开发语言' },
        { name: 'Vue / React', level: 85, group: '前端框架' },
        { name: 'Node.js', level: 75, group: '后端' },
      ],
      awards: [{ name: '校级一等奖学金', issuer: '某某大学', date: '2023.10', desc: '' }],
    },
    posts: [
      {
        id: 'p_welcome',
        title: '欢迎来到我的私密主页',
        date: today,
        category: '随笔',
        cover: '',
        summary: '这是一篇示例文章，管理员登录后可以直接在线编辑或删除。',
        tags: ['开始'],
        draft: false,
        adminOnly: false,
        body:
          '## 这是什么\n\n这是一个部署在 GitHub Pages 上的**私密个人主页**：所有内容在仓库中都是加密存储的，只有拿到密码才能解密浏览。\n\n## 如何编辑\n\n1. 使用**管理员密码**登录\n2. 页面各处会出现「编辑」按钮\n3. 修改后点击「一键发布」，内容会自动同步回 GitHub 仓库\n\n> 访客密码只能浏览，看不到任何编辑入口。\n\n```js\nconsole.log("Hello, world!");\n```\n',
      },
    ],
    works: [
      { id: 'w_demo', title: '示例项目', cover: '', desc: '这里是项目简介，可在后台随时修改。', tags: ['Vue', 'Vite'], link: '', order: 0, pinned: true },
    ],
    resumeVersions: [],
    site: {
      siteName: '我的主页',
      footer: '© ' + new Date().getFullYear() + ' 保留所有权利',
      showProjects: true,
      showAbout: true,
      showContact: true,
    },
  };
}

/** 补齐简历对象的六个子字段，主简历与版本内容共用 */
export function normalizeResume(r) {
  const d = defaultContent().resume;
  const c = r && typeof r === 'object' ? r : {};
  return {
    summary: c.summary != null ? c.summary : d.summary,
    education: Array.isArray(c.education) ? c.education : d.education,
    work: Array.isArray(c.work) ? c.work : d.work,
    projects: Array.isArray(c.projects) ? c.projects : d.projects,
    skills: Array.isArray(c.skills) ? c.skills : d.skills,
    awards: Array.isArray(c.awards) ? c.awards : d.awards,
  };
}

/** 补齐缺失字段，避免旧数据结构导致渲染报错 */
function normalize(content) {
  const d = defaultContent();
  const c = content && typeof content === 'object' ? content : {};
  return {
    profile: { ...d.profile, ...(c.profile || {}) },
    resume: { ...d.resume, ...(c.resume || {}) },
    posts: Array.isArray(c.posts) ? c.posts : d.posts,
    works: Array.isArray(c.works) ? c.works : d.works,
    resumeVersions: Array.isArray(c.resumeVersions)
      ? c.resumeVersions.map((v) => ({ ...v, data: normalizeResume(v.data) }))
      : [],
    site: { ...d.site, ...(c.site || {}) },
  };
}

/* ---------- 加载 ---------- */

export async function loadVault() {
  const res = await fetch(`./${VAULT_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null; // 未初始化
  const data = await res.json();
  if (!data || !Array.isArray(data.keys) || !data.payload) return null;
  state.vault = data;
  return data;
}

/** 登录成功后解密内容；优先使用管理员本地未发布草稿 */
export async function decryptContent() {
  const key = masterKey();
  if (!key || !state.vault) throw new Error('尚未解锁');
  const raw = await decryptJson(key, state.vault.payload);
  state.content = normalize(raw);
  state.loadedAt = Date.now();

  if (isAdmin()) {
    const draft = loadDraft();
    if (draft && draft.baseAt >= (state.vault.updatedAt || '')) {
      state.content = normalize(draft.content);
      state.dirty = true;
    }
  }
  return state.content;
}

/* ---------- 本地草稿 ---------- */

export function markDirty() {
  state.dirty = true;
  saveDraft();
  window.dispatchEvent(new CustomEvent('content:changed'));
}

export function saveDraft() {
  if (!isAdmin() || !state.content) return;
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ baseAt: state.vault?.updatedAt || '', savedAt: new Date().toISOString(), content: state.content })
    );
  } catch (_) {}
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function discardDraft() {
  localStorage.removeItem(DRAFT_KEY);
  state.dirty = false;
}

/* ---------- 生成与发布 ---------- */

/** 用当前内容重新加密，生成完整 vault.json 文本 */
export async function buildVaultJson(overrideKeys) {
  const key = masterKey();
  const payload = await encryptJson(key, state.content);
  const vault = {
    v: 1,
    app: 'jcweb',
    updatedAt: new Date().toISOString(),
    keys: overrideKeys || state.vault.keys,
    payload,
  };
  return { vault, text: JSON.stringify(vault, null, 2) };
}

/** 发布到 GitHub */
export async function publish(message, overrideKeys) {
  if (!isAdmin()) throw new Error('无权限');
  const cfg = gh.getConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) throw new Error('请先在「后台 → 发布设置」中配置 GitHub 仓库与 Token');
  const { vault, text } = await buildVaultJson(overrideKeys);
  await gh.putFile(cfg, cfg.path || VAULT_PATH, text, message || 'chore(content): update site content');
  state.vault = vault;
  discardDraft();
  window.dispatchEvent(new CustomEvent('content:changed'));
  return vault;
}

/** 离线导出：直接下载 vault.json 手动上传 */
export async function downloadVault(overrideKeys) {
  const { vault, text } = await buildVaultJson(overrideKeys);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vault.json';
  a.click();
  URL.revokeObjectURL(a.href);
  state.vault = vault;
  discardDraft();
  return vault;
}

/* ---------- 密码管理 ---------- */

/** 重新包裹某个角色的密码（管理员改访客密码 / 改自己的密码） */
export async function setPassword({ keyId, role, label, password, expiresAt = null, replaceAll = false }) {
  if (!isAdmin()) throw new Error('无权限');
  const key = masterKey();
  const entry = await wrapMasterKey(key, password, {
    id: keyId || undefined,
    role,
    label,
    expiresAt,
  });
  let keys = [...(state.vault.keys || [])];
  if (replaceAll) keys = keys.filter((k) => k.role !== role);
  const idx = keys.findIndex((k) => k.id === entry.id);
  if (idx >= 0) keys[idx] = entry;
  else keys.push(entry);
  return keys;
}

export function removeKey(keyId) {
  return (state.vault.keys || []).filter((k) => k.id !== keyId);
}

export function toggleKey(keyId, enabled) {
  return (state.vault.keys || []).map((k) => (k.id === keyId ? { ...k, enabled } : k));
}

/** 首次初始化：生成主密钥 + 管理员/访客密码 + 默认内容 */
export async function initVault(adminPwd, guestPwd) {
  const master = generateMasterKeyRaw();
  const keys = [
    await wrapMasterKey(master, adminPwd, { role: 'admin', label: '管理员', id: 'admin' }),
    await wrapMasterKey(master, guestPwd, { role: 'guest', label: '默认访客', id: 'guest_default' }),
  ];
  const payload = await encryptJson(master, defaultContent());
  const vault = { v: 1, app: 'jcweb', updatedAt: new Date().toISOString(), keys, payload };
  return { vault, text: JSON.stringify(vault, null, 2) };
}

/* ---------- 内容访问（带权限过滤） ---------- */

export function visiblePosts() {
  const admin = isAdmin();
  const posts = (state.content?.posts || []).slice();
  return posts
    .filter((p) => admin || (!p.draft && !p.adminOnly))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function visibleWorks() {
  const admin = isAdmin();
  return (state.content?.works || [])
    .filter((w) => admin || !w.adminOnly)
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.order || 0) - (b.order || 0));
}

export function findPost(id) {
  const p = (state.content?.posts || []).find((x) => x.id === id);
  if (!p) return null;
  if (!isAdmin() && (p.draft || p.adminOnly)) return null;
  return p;
}

export function categories() {
  const set = new Set();
  visiblePosts().forEach((p) => p.category && set.add(p.category));
  return [...set];
}

/** 简历版本仅管理员可访问（后台专属，访客一律返回空） */
export function resumeVersions() {
  if (!isAdmin()) return [];
  return (state.content?.resumeVersions || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
