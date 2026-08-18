/**
 * 应用入口：未验证 → 登录页；已验证 → 挂载路由与页面。
 */
import { loadVault, decryptContent, initVault, state } from './store.js';
import { login, restore, session, isAdmin, logout } from './auth.js';
import { initTheme, initBackToTop, toast, $ } from './ui.js';
import { escapeHtml } from './markdown.js';
import { passwordStrength } from './crypto.js';
import { mountTechCanvas } from './bg-canvas.js';
import * as gh from './github.js';
import * as router from './router.js';
import * as views from './views.js';
import { renderAdmin } from './editor.js';

const app = () => document.getElementById('app');

/* ---------- 启动 ---------- */

async function boot() {
  initTheme();
  initBackToTop();

  let vault;
  try {
    vault = await loadVault();
  } catch (e) {
    return renderError('数据文件读取失败：' + e.message);
  }

  if (!vault) return renderSetup();

  const s = restore(vault);
  if (s) {
    try {
      await decryptContent();
      return startApp();
    } catch (_) {
      logout(); // 会话数据与当前 vault 不匹配
    }
  }
  renderLogin();
}

function renderError(msg) {
  app().innerHTML = `<div class="gate"><div class="gate-box">
    <div class="gate-logo">!</div><h1>加载失败</h1>
    <p class="sub">${escapeHtml(msg)}</p>
    <button class="btn btn-primary btn-block" onclick="location.reload()">重新加载</button>
  </div></div>`;
}

/* ---------- 登录页（唯一公开页面） ---------- */

/** 登录/初始化页的科技风粒子背景（切换渲染时销毁旧实例） */
let techBg = null;
function bindTechGate() {
  if (techBg) techBg.destroy();
  const canvas = document.querySelector('.gate-canvas');
  if (canvas) techBg = mountTechCanvas(canvas);
}

function renderLogin(message = '') {
  document.title = '访问验证 · 个人主页';
  app().innerHTML = `
    <div class="gate">
      <canvas class="gate-canvas"></canvas>
      <div class="gate-veil"></div>
      <form class="gate-box" id="loginForm" autocomplete="off">
        <div class="gate-logo">🔒</div>
        <h1>访问验证</h1>
        <p class="sub">这是一个私密个人主页。请输入管理员密码或访客密码继续。</p>
        <div class="field">
          <label for="pwd">访问密码</label>
          <input type="password" id="pwd" placeholder="请输入密码" autocomplete="current-password" required>
        </div>
        <label class="remember"><input type="checkbox" id="remember" checked><span>7 天内免验证（本机）</span></label>
        <button class="btn btn-primary btn-block" id="loginBtn" type="submit">进入</button>
        <p class="gate-msg ${message ? 'error' : ''}" id="msg">${escapeHtml(message)}</p>
        <div class="gate-foot">内容经 AES-256-GCM 加密存储，未验证无法获取任何数据</div>
      </form>
    </div>`;
  bindTechGate();

  const form = $('#loginForm');
  const msg = $('#msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const pwd = $('#pwd').value;
    if (!pwd) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 验证中…';
    msg.className = 'gate-msg';
    msg.textContent = '';
    // 让浏览器有机会绘制 loading 状态（PBKDF2 是同步阻塞的重计算）
    await new Promise((r) => setTimeout(r, 30));
    try {
      const s = await login(state.vault, pwd, $('#remember').checked);
      if (!s) {
        msg.className = 'gate-msg error';
        msg.textContent = '密码不正确，请重试';
        $('#pwd').select();
        return;
      }
      await decryptContent();
      startApp();
    } catch (err) {
      msg.className = 'gate-msg error';
      msg.textContent = err.message || '验证失败';
    } finally {
      btn.disabled = false;
      btn.textContent = '进入';
    }
  });
  $('#pwd').focus();
}

/* ---------- 首次初始化向导 ---------- */

function renderSetup() {
  document.title = '初始化 · 个人主页';
  const cfg = gh.getConfig();
  app().innerHTML = `
    <div class="gate">
      <canvas class="gate-canvas"></canvas>
      <div class="gate-veil"></div>
      <form class="gate-box wide" id="setupForm" autocomplete="off">
        <div class="gate-logo">✨</div>
        <h1>首次初始化</h1>
        <p class="sub">还没有检测到 <code>data/vault.json</code>。请设置两组密码，系统会生成加密的数据文件。</p>
        <div class="field"><label>管理员密码（可浏览 + 编辑 + 改访客密码）</label>
          <input type="password" id="a1" required><div class="hint" id="aTip">建议 12 位以上</div></div>
        <div class="field"><label>确认管理员密码</label><input type="password" id="a2" required></div>
        <hr>
        <div class="field"><label>访客密码（只能浏览）</label><input type="password" id="g1" required></div>
        <div class="field"><label>确认访客密码</label><input type="password" id="g2" required></div>
        <hr>
        <p class="muted" style="font-size:.85rem;margin:0 0 10px">
          可选：填写 GitHub 信息直接提交数据文件；留空则生成文件供你手动上传到仓库的 <code>data/vault.json</code>。</p>
        <div class="grid-2">
          <div class="field"><label>owner</label><input type="text" id="o" value="${escapeHtml(cfg.owner || '')}"></div>
          <div class="field"><label>repo</label><input type="text" id="r" value="${escapeHtml(cfg.repo || '')}"></div>
          <div class="field"><label>分支</label><input type="text" id="b" value="${escapeHtml(cfg.branch || 'main')}"></div>
          <div class="field"><label>Token</label><input type="password" id="t" placeholder="github_pat_..."></div>
        </div>
        <button class="btn btn-primary btn-block" id="setupBtn" type="submit">生成并保存</button>
        <p class="gate-msg" id="smsg"></p>
        <div class="gate-foot">密码一旦丢失将无法恢复任何内容，请务必妥善保存</div>
      </form>
    </div>`;
  bindTechGate();

  const a1 = $('#a1');
  a1.addEventListener('input', () => ($('#aTip').textContent = `强度：${passwordStrength(a1.value).text}`));

  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#smsg');
    const btn = $('#setupBtn');
    const admin = a1.value;
    const guest = $('#g1').value;
    msg.className = 'gate-msg error';
    if (admin.length < 8) return (msg.textContent = '管理员密码至少 8 位');
    if (admin !== $('#a2').value) return (msg.textContent = '两次输入的管理员密码不一致');
    if (guest.length < 6) return (msg.textContent = '访客密码至少 6 位');
    if (guest !== $('#g2').value) return (msg.textContent = '两次输入的访客密码不一致');
    if (admin === guest) return (msg.textContent = '管理员密码与访客密码不能相同');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 生成中…';
    try {
      const { vault, text } = await initVault(admin, guest);
      const cfg2 = {
        owner: $('#o').value.trim(),
        repo: $('#r').value.trim(),
        branch: $('#b').value.trim() || 'main',
        path: 'data/vault.json',
        token: $('#t').value.trim(),
      };
      if (cfg2.owner && cfg2.repo && cfg2.token) {
        await gh.putFile(cfg2, cfg2.path, text, 'feat: initialize site vault');
        gh.saveConfig(cfg2);
        msg.className = 'gate-msg ok';
        msg.textContent = '已提交到仓库！等待 GitHub Pages 构建完成后刷新即可登录。';
      } else {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'vault.json';
        a.click();
        URL.revokeObjectURL(a.href);
        msg.className = 'gate-msg ok';
        msg.textContent = '已生成 vault.json，请把它放到仓库的 data/ 目录后刷新本页。';
      }
      state.vault = vault;
      btn.textContent = '完成';
    } catch (err) {
      msg.className = 'gate-msg error';
      msg.textContent = err.message || '生成失败';
      btn.disabled = false;
      btn.textContent = '生成并保存';
    }
  });
}

/* ---------- 登录后：挂载路由 ---------- */

function startApp() {
  const site = state.content.site || {};
  document.title = `${state.content.profile.name || '个人主页'} · ${site.siteName || ''}`;
  views.renderShell();

  router.route('/', views.renderHome);
  router.route('/resume', views.renderResume);
  router.route('/timeline', views.renderTimeline);
  router.route('/post/:id', views.renderPost);
  router.route('/works', views.renderWorks);
  router.route('/about', views.renderAbout);
  router.route('/contact', views.renderContact);
  router.route('/search', views.renderSearch);
  router.route('/404', views.renderNotFound);
  router.route('/admin', () => renderAdmin({ section: 'profile' }));
  router.route('/admin/:section', renderAdmin);
  router.setNotFound(views.renderNotFound);
  router.setOnNavigate((path) => {
    // 访客不得访问后台
    if (path.startsWith('/admin') && !isAdmin()) {
      toast('该页面仅管理员可访问', 'err');
      router.go('/', true);
      return;
    }
    // 每页专属动态背景标记
    document.body.dataset.page = path.split('?')[0].split('/')[1] || 'home';
    views.highlightNav(path);
  });

  router.start();

  // 会话过期自动回到登录页
  setInterval(() => {
    if (!session()) location.reload();
  }, 60000);

  window.addEventListener('beforeunload', (e) => {
    if (isAdmin() && state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

boot();
