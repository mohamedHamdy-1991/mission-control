/* MC.sanitize — every interpolated string goes through here. No eval, no inline handlers. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"'`]/g, (c) => MAP[c]);

  /** http(s) only, no embedded credentials, no control characters. Returns '' when unsafe. */
  function safeUrl(s, opts) {
    if (typeof s !== 'string') return '';
    const raw = s.trim();
    if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(raw)) return '';
    let u;
    try { u = new URL(raw); } catch (e) { return ''; }
    const allowHttp = !opts || opts.allowHttp !== false;
    if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) return '';
    if (u.username || u.password) return '';
    if (opts && Array.isArray(opts.hosts) && opts.hosts.length &&
        !opts.hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return '';
    return u.href;
  }
  /** images: https or data:image raster/svg base64 only. */
  function safeImage(s) {
    if (typeof s !== 'string') return '';
    if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
    return safeUrl(s, { allowHttp: false });
  }
  const attr = esc;

  /** External link markup; label escaped; href sanitised; inert text when unsafe. */
  function link(href, label, opts) {
    const u = safeUrl(href, opts);
    const l = esc(label == null ? href : label);
    if (!u) return '<span class="subtle" title="Link withheld: not an allowed http(s) URL">' + l + '</span>';
    return '<a href="' + attr(u) + '" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">' + l + '</a>';
  }

  /**
   * Untrusted report text → tightly limited markup.
   * Supports: paragraphs, #/##/### headings, - / * / 1. lists, **bold**, `code`,
   * [label](https url) and bare https URLs. Everything else is escaped text.
   * opts.hosts optional host allowlist for links.
   */
  function markdown(text, opts) {
    const src = (text == null ? '' : String(text)).replace(/\r\n?/g, '\n').slice(0, 200000);
    const inline = (line) => {
      let out = '';
      const re = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2048})\)|(https?:\/\/[^\s<>()"'`]{3,2048})/g;
      let last = 0, m;
      while ((m = re.exec(line))) {
        out += fmtText(line.slice(last, m.index));
        if (m[1] != null) out += link(m[2], m[1], opts);
        else { const trail = (m[3].match(/[.,;:!?]+$/) || [''])[0]; const u = m[3].slice(0, m[3].length - trail.length); out += link(u, u, opts) + esc(trail); }
        last = re.lastIndex;
      }
      return out + fmtText(line.slice(last));
    };
    const fmtText = (t) => esc(t)
      .replace(/\*\*([^*]{1,500})\*\*/g, '<strong>$1</strong>')
      .replace(/&#96;([^&]{1,200}?)&#96;/g, '<code>$1</code>');
    const lines = src.split('\n');
    let html = '', list = null, para = [];
    const flushPara = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
    const flushList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const ln of lines) {
      const h = ln.match(/^(#{1,4})\s+(.*)$/);
      const ul = ln.match(/^\s*[-*•]\s+(.*)$/);
      const ol = ln.match(/^\s*\d{1,3}[.)]\s+(.*)$/);
      if (!ln.trim()) { flushPara(); flushList(); continue; }
      if (h) { flushPara(); flushList(); const n = Math.min(4, h[1].length + 1); html += '<h' + n + '>' + inline(h[2]) + '</h' + n + '>'; continue; }
      if (ul || ol) { flushPara(); const t = ul ? 'ul' : 'ol'; if (list !== t) { flushList(); html += '<' + t + '>'; list = t; } html += '<li>' + inline((ul || ol)[1]) + '</li>'; continue; }
      flushList(); para.push(ln);
    }
    flushPara(); flushList();
    return html;
  }

  /** Plain-text excerpt, tags/markdown stripped, for cards. */
  function excerpt(text, n) {
    const t = (text == null ? '' : String(text)).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > (n || 220) ? t.slice(0, (n || 220) - 1) + '…' : t;
  }

  MC.sanitize = { esc, attr, safeUrl, safeImage, link, markdown, excerpt };
})();
