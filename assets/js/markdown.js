/**
 * 轻量 Markdown 渲染器（零依赖，离线可用）。
 * 安全策略：先整体转义 HTML，再生成受支持的标签；链接协议白名单，杜绝 XSS。
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^[\w./-]+$/.test(u)) return u; // 相对路径
  return '#';
}

function slugify(text, used) {
  let base = String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let slug = base;
  let i = 2;
  while (used.has(slug)) slug = `${base}-${i++}`;
  used.add(slug);
  return slug;
}

/* ---------- 代码高亮（通用词法着色） ---------- */

const KEYWORDS = new Set(
  ('const let var function return if else for while class extends new import from export default await async try catch finally throw ' +
    'typeof instanceof this super null undefined true false break continue switch case do in of delete void yield static get set ' +
    'def elif except lambda pass raise with as global nonlocal None True False and or not is print self ' +
    'public private protected interface implements package abstract final void int long float double boolean char String struct enum ' +
    'fn let mut pub impl trait use match where type namespace using select insert update delete where from join group order by limit')
    .split(' ')
);

function highlight(code, lang) {
  const src = escapeHtml(code);
  const out = [];
  let i = 0;
  const isWord = (c) => /[\w$#@.]/.test(c);
  while (i < src.length) {
    const rest = src.slice(i);
    // 注释
    let m = rest.match(/^(\/\/[^\n]*|#(?!\w*;)[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)/);
    if (m) { out.push(`<span class="tk-com">${m[0]}</span>`); i += m[0].length; continue; }
    // 字符串（注意 &quot; &#39; 是转义后的形式）
    m = rest.match(/^(&quot;(?:\\.|(?!&quot;)[\s\S])*?&quot;|&#39;(?:\\.|(?!&#39;)[\s\S])*?&#39;|`(?:\\.|[^`])*?`)/);
    if (m) { out.push(`<span class="tk-str">${m[0]}</span>`); i += m[0].length; continue; }
    // 数字
    m = rest.match(/^\b(0[xX][\da-fA-F]+|\d+(\.\d+)?)\b/);
    if (m) { out.push(`<span class="tk-num">${m[0]}</span>`); i += m[0].length; continue; }
    // 标签（HTML/XML）
    if (lang === 'html' || lang === 'xml' || lang === 'vue') {
      m = rest.match(/^&lt;\/?[\w-]+/);
      if (m) { out.push(`<span class="tk-tag">${m[0]}</span>`); i += m[0].length; continue; }
    }
    // 单词
    if (isWord(src[i])) {
      let j = i;
      while (j < src.length && isWord(src[j])) j++;
      const word = src.slice(i, j);
      if (KEYWORDS.has(word)) out.push(`<span class="tk-key">${word}</span>`);
      else if (src[j] === '(') out.push(`<span class="tk-fn">${word}</span>`);
      else out.push(word);
      i = j;
      continue;
    }
    // 跳过 HTML 实体，避免被拆坏
    m = rest.match(/^&[a-z#0-9]+;/i);
    if (m) { out.push(m[0]); i += m[0].length; continue; }
    out.push(src[i]);
    i++;
  }
  return out.join('');
}

/* ---------- 行内语法 ---------- */

function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+?)`/g, (_, c) => `\u0000C${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  // 图片
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, url, title) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy"${title ? ` title="${title}"` : ''}>`);
  // 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const u = safeUrl(url);
    const ext = /^https?:/i.test(u);
    return `<a href="${u}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${txt}</a>`;
  });
  s = s.replace(/(^|[^\\])\*\*\*(.+?)\*\*\*/g, '$1<strong><em>$2</em></strong>');
  s = s.replace(/(^|[^\\])\*\*(.+?)\*\*/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\\*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, pre, url) => `${pre}<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s.replace(/\\([*_`~[\]])/g, '$1');
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[+i]);
  return s;
}

/**
 * 渲染 Markdown。
 * @returns {{html: string, toc: Array<{level:number,text:string,id:string}>, words: number}}
 */
export function renderMarkdown(md) {
  const text = String(md || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const html = [];
  const toc = [];
  const used = new Set();
  let i = 0;

  const flushList = (ordered, items) =>
    `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^\s*```+\s*([\w+-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] || '').toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(
        `<div class="code-block">${lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''}` +
        `<button class="code-copy" type="button" data-copy>复制</button>` +
        `<pre><code>${highlight(buf.join('\n'), lang)}</code></pre></div>`
      );
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      const content = inline(h[2].trim());
      const id = slugify(h[2].trim(), used);
      if (lv >= 2 && lv <= 4) toc.push({ level: lv, text: h[2].trim(), id });
      html.push(`<h${lv} id="${id}">${content}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${lv}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { html.push('<hr>'); i++; continue; }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(buf.join('\n')).html}</blockquote>`);
      continue;
    }

    // 表格
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const split = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = split(line);
      i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(split(lines[i++]));
      html.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>'
      );
      continue;
    }

    // 列表
    const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(m[2]);
        i++;
      }
      html.push(flushList(ordered, items));
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 段落
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length) html.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    else i++;
  }

  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[#*`>_\-[\]()!]/g, ' ');
  const cn = (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (plain.match(/\b[a-zA-Z]+\b/g) || []).length;

  return { html: html.join('\n'), toc, words: cn + en };
}

/** 依据字数估算阅读时长（分钟） */
export function readingTime(words) {
  return Math.max(1, Math.round(words / 350));
}

/** 从 Markdown 中提取纯文本摘要 */
export function excerpt(md, len = 90) {
  const s = String(md || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>_~|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > len ? s.slice(0, len) + '…' : s;
}
