# 姜城 · 私密个人主页（GitHub Pages + 双密码 + 在线编辑）

纯静态站点，零依赖、零构建，直接托管在 GitHub Pages。所有内容在仓库中都以 **AES-256-GCM 加密**存储，未通过密码验证拿不到任何数据。

**设计**：Apple 风格（#f5f5f7 浅灰底 / 白卡大圆角 / 苹果蓝）+ 全屏深蓝封面首页 + 时间轴式实习经历页，全站响应式，**手机 / 平板 / 桌面均适配**（后续所有改动保持移动端可用）。

> 🔑 本站密码已初始化：管理员密码与访客密码由站长保管，仓库中不存在明文密码。
> **密码丢失后内容无法恢复**，请务必妥善保管。

## 一、能力总览

| 分类 | 已实现（P0 全量 + 部分 P1） |
| --- | --- |
| 权限安全 | 双密码鉴权（无账号）、严格权限边界、未验证不加载任何隐私内容、在线改密即时生效、密码非明文存储、7 天免验证 + 主动退出、非管理员完全隐藏编辑入口 |
| 权限增强 | 多组独立访客密码、单独启用/禁用、带有效期的临时密码、一键失效全部访客密码、单篇内容「仅管理员可见」 |
| 页面模块 | 深蓝封面首页（大头像 + 玻璃拟态联系方式）、简历详情页、实习经历时间轴页、项目经历卡片页、联系、搜索、404、吸顶毛玻璃导航（移动端汉堡菜单） |
| 移动适配 | 全站响应式：封面 / 时间轴 / 项目卡 / 后台在手机端单列自适应，无横向溢出 |
| 简历版本 | 针对不同公司/岗位维护多版本简历（仅管理员可见）、投递状态跟踪（未投递/已投递/面试中/已结束）、一键应用为公开简历、版本预览 + 导出 PDF、复制版本 |
| 在线编辑 | 管理员专属入口、基础信息/简历全字段/文章/项目在线编辑、Markdown 编辑 + 代码高亮 + 实时预览、草稿暂存、一键发布到 GitHub |
| 基础体验 | 深浅色主题、回到顶部、面包屑、文章目录、阅读时长、代码块一键复制、平滑滚动、简历一键导出 PDF（打印样式）、登录页 SEO |

## 二、部署到 GitHub Pages

1. 新建仓库（如 `yourname.github.io` 或任意名称的仓库）。
2. 把本目录所有文件推送到仓库根目录（含 `.nojekyll`，避免 Jekyll 处理静态资源）。
3. 仓库 **Settings → Pages → Source** 选择 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`。
4. 打开站点地址，按向导设置管理员密码与访客密码。

## 三、开启在线编辑（一键发布）

在线编辑本质是通过 GitHub API 把加密后的 `data/vault.json` 写回仓库。

1. 到 <https://github.com/settings/personal-access-tokens> 创建 **Fine-grained token**：
   - Repository access：只勾选本仓库
   - Permissions → Repository permissions → **Contents: Read and write**
2. 管理员登录站点 → **管理后台 → 发布设置**，填写 `owner` / `repo` / 分支 / Token，点「测试连接」→「保存配置」。
3. 之后任意页面修改内容 → 点「🚀 一键发布」，等待 GitHub Pages 构建（约 1 分钟）即可生效。

> Token 只保存在管理员当前浏览器的 `localStorage`，**不会写入仓库**。换设备需要重新填写；可随时用「清除本机 Token」移除。
> 没有 Token 时也能用：编辑后点「导出 vault.json」，手动上传覆盖仓库中的 `data/vault.json`。

## 四、安全模型

```
随机主密钥 MK ──AES-GCM──> 加密全部站点内容 (payload)
       │
       ├── PBKDF2(管理员密码, salt, 210k) ─> KEK_A ─> 包裹 MK  → keys[admin]
       └── PBKDF2(访客密码,   salt, 210k) ─> KEK_G ─> 包裹 MK  → keys[guest-*]
```

- 仓库中**不存在明文密码**，也**不存在明文内容**；`vault.json` 只有密文与盐值。
- 修改访客密码 = 用新密码重新包裹主密钥，旧密码立刻失效，无需重新加密全部内容。
- 直连任何子页面（`#/resume`、`#/post/xxx` 等）都不会加载数据：路由只在解密成功后挂载。
- 本地会话保存主密钥并绑定密钥指纹；密码被重置或禁用后，本地登录状态会立即失效。
- 权限边界：访客登录后进入 `#/admin` 会被强制跳回首页，且页面不渲染任何编辑按钮。

**注意**：静态站点没有服务端，密码强度即安全上限。请为管理员设置 12 位以上的强密码，并妥善保管——**密码丢失后内容无法恢复**。

## 五、本地预览

```powershell
cd 项目目录
python -m http.server 5180
# 浏览器打开 http://localhost:5180/index.html
```

必须通过 HTTP 访问（`file://` 下 ES Module 与 WebCrypto 受限）。

## 六、目录结构

```
index.html            登录/初始化入口（唯一公开页面，含 SEO 配置）
404.html              GitHub Pages 404 页
robots.txt            仅允许收录登录页
.nojekyll             关闭 Jekyll 处理
data/vault.json       加密后的全部内容 + 密码包裹信息
assets/css/style.css  全局样式（Apple 风 / 深蓝封面 / 时间轴 / 响应式 / 打印）
assets/js/
  app.js        启动、登录页、初始化向导、路由挂载
  auth.js       双密码鉴权与会话持久化
  crypto.js     PBKDF2 + AES-GCM 封装
  store.js      内容加载、草稿、加密发布、密码管理
  github.js     GitHub REST API（发布 / 历史）
  markdown.js   Markdown 渲染 + 代码高亮（零依赖）
  router.js     hash 路由
  views.js      各页面视图（含 resumeBodyHtml 供版本预览复用）
  editor.js     管理后台与在线编辑（含简历版本管理）
  ui.js         Toast / Modal / 主题 / 通用工具
```

## 七、常见问题

- **忘记密码？** 无法找回。删除 `data/vault.json` 后重新初始化（原内容将丢失）。
- **改完密码后自己被登出？** 正常现象，用新密码重新登录即可。
- **发布报 404/403？** 检查 `owner`/`repo`/分支是否正确、Token 是否勾选了本仓库的 Contents 写权限。
- **图片放哪里？** 放到仓库 `assets/img/`，在编辑器里填相对路径，如 `assets/img/avatar.jpg`。
