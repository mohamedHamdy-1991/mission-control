/* MC.app — full-screen adaptive shell: routing, navigation per tier, fullscreen, search, modal/sheet,
   toasts, drag & drop, sync chip, portrait hydration. Boots last. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc, attr } = MC.sanitize;
  const I = MC.icon;

  const NAV = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'agents', label: 'Agents', icon: 'users' },
    { id: 'workflows', label: 'Workflows', icon: 'layers' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'results', label: 'Results', icon: 'file' },
    { id: 'reports', label: 'Reports', icon: 'chart' },
    { id: 'opportunities', label: 'Opportunities', icon: 'award' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const TABS = ['overview', 'workflows', 'calendar', 'opportunities', 'agents'];
  const PREF = 'mc.prefs.v1'; // UI preferences only (theme). Never private content, never tokens.

  let route = { view: 'overview', params: [] };
  let mounted = false, raf = 0, modalStack = [];

  /* ---------- prefs ---------- */
  function prefs() { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(PREF, JSON.stringify({ theme: p.theme === 'dark' ? 'dark' : 'light' })); } catch (e) { /* ignore */ } }
  function applyTheme(t) { document.body.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#202e40' : '#e7ebf1'); }

  /* ---------- routing ---------- */
  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const segs = h.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    const view = NAV.some((n) => n.id === segs[0]) ? segs[0] : 'overview';
    return { view, params: segs.slice(1) };
  }
  function navigate(path) {
    const target = '#/' + String(path).split('/').map((s) => encodeURIComponent(decodeURIComponentSafe(s))).join('/');
    if (location.hash === target) renderView(); else location.hash = target;
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /* ---------- shell ---------- */
  function shell() {
    const navBtn = (n, cls) => '<button class="' + cls + '" data-action="nav" data-view="' + n.id + '" title="' + attr(n.label) + '" aria-label="' + attr(n.label) + '">' + I(n.icon) + '<span class="rail-label">' + esc(n.label) + '</span></button>';
    const fsBtn = document.fullscreenEnabled
      ? '<button class="rail-btn" data-action="fullscreen" title="Full screen (F)" aria-label="Toggle full screen">' + I('maximize') + '<span class="rail-label">Full screen</span></button>' : '';
    document.getElementById('app').innerHTML =
      '<div class="app">' +
        '<aside class="rail" aria-label="Main navigation">' +
          '<div class="brand"><div class="brand-mark">' + I('layers') + '</div><div class="brand-text"><b>Mission Control</b><span>Agent journeys</span></div></div>' +
          '<nav class="rail-nav">' + NAV.map((n) => navBtn(n, 'rail-btn')).join('') + '</nav>' +
          '<div class="rail-bottom">' + fsBtn +
            '<button class="rail-btn" data-action="toggle-theme" title="Light / dark" aria-label="Toggle light or dark theme">' + I('moon') + '<span class="rail-label">Theme</span></button>' +
          '</div>' +
        '</aside>' +
        '<div class="main">' +
          '<header class="topbar">' +
            '<div class="topbar-title"><div class="eyebrow" id="page-eyebrow"></div><h1 class="page-title" id="page-title">Mission Control</h1></div>' +
            '<div class="top-actions">' +
              '<button class="sync-chip" id="sync-chip" data-action="nav" data-view="settings" title="Data status"><span class="dot"></span><span class="label" id="sync-label">Demo</span></button>' +
              '<button class="icon-btn" data-action="refresh" title="Refresh data" aria-label="Refresh data">' + I('refresh') + '</button>' +
              '<button class="icon-btn" data-action="open-search" title="Search (/)" aria-label="Search">' + I('search') + '</button>' +
              (document.fullscreenEnabled ? '<button class="icon-btn hide-sm" data-action="fullscreen" title="Full screen (F)" aria-label="Toggle full screen" id="fs-top">' + I('maximize') + '</button>' : '') +
            '</div>' +
          '</header>' +
          '<main class="view" id="view" tabindex="-1"></main>' +
          '<nav class="tabbar" aria-label="Primary">' +
            TABS.map((id) => { const n = NAV.find((x) => x.id === id); return '<button class="tab-btn" data-action="nav" data-view="' + id + '" aria-label="' + attr(n.label) + '">' + I(n.icon) + '<span>' + esc(n.label === 'Opportunities' ? 'Opport.' : n.label) + '</span></button>'; }).join('') +
            '<button class="tab-btn" data-action="open-more" aria-label="More">' + I('menu') + '<span>More</span></button>' +
          '</nav>' +
        '</div>' +
      '</div>';
    mounted = true;
  }
  function highlightNav() {
    document.querySelectorAll('[data-action=nav][data-view]').forEach((b) => {
      const on = b.getAttribute('data-view') === route.view && !b.classList.contains('sync-chip');
      b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const moreActive = !TABS.includes(route.view);
    const mb = document.querySelector('.tab-btn[data-action=open-more]'); if (mb) mb.classList.toggle('active', moreActive);
  }

  function ctx() {
    return {
      state: MC.state, model: MC.state.get(), s: MC.sanitize, icon: I, fmt: MC.fmt, params: route.params, tier: MC.tier(),
      navigate, modal: openModal, closeModal, toast, confirm: confirmDialog, avatar, agentLabel, setTitle,
    };
  }
  function setTitle(title, eyebrow) {
    document.getElementById('page-title').textContent = title || '';
    document.getElementById('page-eyebrow').textContent = eyebrow || '';
    document.title = (title ? title + ' · ' : '') + 'Mission Control';
  }

  function renderView() {
    if (!mounted) return;
    route = parseHash();
    const v = MC.views.get(route.view);
    const el = document.getElementById('view');
    const keepScroll = el.dataset.view === route.view + '/' + route.params.join('/') ? el.scrollTop : 0;
    const focusId = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
    el.dataset.view = route.view + '/' + route.params.join('/');
    highlightNav();
    const n = NAV.find((x) => x.id === route.view);
    setTitle(n.label, MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    if (!v) { el.innerHTML = '<div class="view-inner"><div class="empty-state">This view is not available in this build.</div></div>'; return; }
    try {
      el.innerHTML = '';
      v.render(el, ctx());
    } catch (e) {
      console.error(e);
      el.innerHTML = '<div class="view-inner"><div class="notice error">This view failed to render: ' + esc(e.message) + '</div></div>';
    }
    hydratePortraits(el);
    el.scrollTop = keepScroll;
    if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }
  }
  function scheduleRender() { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderView); }

  /* ---------- avatars / portraits ---------- */
  const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);
  function avatar(agent, size) {
    if (!agent) return '<span class="avatar ' + (size || '') + '" style="background:var(--subtle)" aria-hidden="true">?</span>';
    const bg = safeColor(agent.color) || '#7c97d5';
    // Portrait refs from the private feed look like {file:'<name>.jpg', lane:'private/portraits'}; initials-only agents carry no file.
    const pr = agent.portrait;
    const p = pr && typeof pr === 'object' ? (pr.path || (pr.file ? 'portraits/' + pr.file : null)) : (typeof pr === 'string' ? pr : null);
    const dp = p && MC.state.mode() !== 'demo' ? ' data-portrait="' + attr(p) + '"' : '';
    return '<span class="avatar ' + (size || '') + '" style="background:' + bg + '"' + dp + ' role="img" aria-label="' + attr(agent.name) + '">' + esc(agent.initials || (agent.name || '?').slice(0, 1).toUpperCase()) + '</span>';
  }
  function hydratePortraits(root) {
    (root || document).querySelectorAll('[data-portrait]').forEach((el) => {
      const p = el.getAttribute('data-portrait');
      MC.data.portrait(p).then((url) => {
        if (!url || !el.isConnected) return;
        const img = new Image(); img.alt = ''; img.decoding = 'async'; img.src = url;
        img.addEventListener('error', () => img.remove());
        el.textContent = ''; el.appendChild(img);
      }).catch(() => {});
    });
  }
  function agentLabel(item) {
    const m = MC.state.get();
    if (item && item.agentId && m.agentById[item.agentId]) return m.agentById[item.agentId].name;
    return (item && item.assignedLabel) || 'Unassigned';
  }

  /* ---------- modal / sheet ---------- */
  function openModal(o) {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + attr(o.title || 'Dialog') + '">' +
      '<div class="modal-head"><h2>' + esc(o.title || '') + '</h2><button class="icon-btn ghost" data-action="close-modal" aria-label="Close">' + I('x') + '</button></div>' +
      '<div class="modal-body">' + (o.body || '') + '</div>' + (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') + '</div>';
    const prev = document.activeElement;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeModal(); });
    root.appendChild(wrap);
    modalStack.push({ wrap, prev, onClose: o.onClose });
    const first = wrap.querySelector('input,select,textarea,button:not([data-action=close-modal])');
    (first || wrap.querySelector('.modal')).focus && setTimeout(() => (first || wrap.querySelector('.icon-btn')).focus(), 20);
    if (o.onMount) o.onMount(wrap.querySelector('.modal'));
    hydratePortraits(wrap);
    return closeModal;
  }
  function closeModal() {
    const m = modalStack.pop(); if (!m) return;
    m.wrap.remove(); if (m.onClose) m.onClose();
    if (m.prev && m.prev.focus) m.prev.focus({ preventScroll: true });
  }
  function confirmDialog(message, okLabel) {
    return new Promise((resolve) => {
      let done = false;
      openModal({
        title: 'Please confirm', body: '<p class="prose">' + esc(message) + '</p>',
        foot: '<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" id="mc-confirm-ok">' + esc(okLabel || 'Confirm') + '</button>',
        onMount(el) { el.querySelector('#mc-confirm-ok').addEventListener('click', () => { done = true; closeModal(); resolve(true); }); },
        onClose() { if (!done) resolve(false); },
      });
    });
  }
  function toast(msg, opts) {
    const root = document.getElementById('toast-root');
    const t = document.createElement('div');
    t.className = 'toast' + (opts && opts.error ? ' error' : '');
    t.textContent = String(msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), (opts && opts.ms) || 3600);
  }

  /* ---------- search ---------- */
  function openSearch() {
    openModal({
      title: 'Search everything', wide: true,
      body: '<input type="search" id="mc-search" placeholder="Tasks, routines, agents, opportunities, runs, reports…" autocomplete="off" aria-label="Search">' +
        '<div id="mc-search-results" class="stack" role="listbox"></div>',
      onMount(el) {
        const inp = el.querySelector('#mc-search'), out = el.querySelector('#mc-search-results');
        const draw = () => {
          const r = MC.state.search(inp.value);
          out.innerHTML = !inp.value.trim() ? '<p class="muted small">Type to search. Results open the record; each record links back to its source.</p>'
            : r.length ? r.map((x) => '<button class="card clickable" style="text-align:left" data-action="search-go" data-route="' + attr(x.route) + '"><div class="row"><span class="badge blue">' + esc(x.kind) + '</span><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + esc(x.title) + '</b></div>' + (x.sub ? '<p class="small muted" style="margin-top:4px">' + esc(x.sub) + '</p>' : '') + '</button>').join('')
            : '<div class="empty-state">No matches.</div>';
        };
        inp.addEventListener('input', draw); draw();
      },
    });
  }

  /* ---------- More sheet (tablet/mobile) ---------- */
  function openMore() {
    const extra = NAV.filter((n) => !TABS.includes(n.id));
    openModal({
      title: 'More',
      body: '<div class="more-sheet stack">' + extra.map((n) => '<button class="rail-btn' + (route.view === n.id ? ' active' : '') + '" data-action="nav" data-view="' + n.id + '">' + I(n.icon) + '<span class="rail-label">' + esc(n.label) + '</span></button>').join('') +
        '<div class="separator"></div>' +
        '<button class="rail-btn" data-action="toggle-theme">' + I('moon') + '<span class="rail-label">Light / dark theme</span></button>' +
        (document.fullscreenEnabled ? '<button class="rail-btn" data-action="fullscreen">' + I('maximize') + '<span class="rail-label">Full screen</span></button>' : '') +
        '</div>',
    });
  }

  /* ---------- fullscreen ---------- */
  function toggleFullscreen() {
    if (!document.fullscreenEnabled) { toast('Full screen is not supported by this browser. On iPhone/iPad, use Share › Add to Home Screen for a full-screen app.'); return; }
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch((e) => toast('Full screen refused: ' + e.message, { error: true }));
  }
  document.addEventListener('fullscreenchange', () => {
    document.querySelectorAll('[data-action=fullscreen]').forEach((b) => {
      b.innerHTML = I(document.fullscreenElement ? 'minimize' : 'maximize') + (b.classList.contains('rail-btn') ? '<span class="rail-label">' + (document.fullscreenElement ? 'Exit full screen' : 'Full screen') + '</span>' : '');
    });
  });

  /* ---------- data actions ---------- */
  async function refresh() {
    if (MC.state.mode() === 'demo') { MC.state.load(await MC.data.loadAll(), { mode: 'demo' }); toast('Demo workspace reloaded (synthetic data).'); return; }
    try { const b = await MC.data.loadAll(); MC.state.load(b, { mode: MC.data.config().mode }); toast('Fresh data loaded.'); }
    catch (e) { toast('Refresh failed: ' + e.message, { error: true }); }
  }
  async function connect(opts) {
    MC.data.connect(opts);
    const b = await MC.data.loadAll();
    MC.state.load(b, { mode: MC.data.config().mode });
    return b;
  }
  async function lock() {
    MC.data.lock();
    MC.state.load(await MC.data.loadAll(), { mode: 'demo' });
    toast('Locked. Private data was cleared from this tab.');
  }

  function updateChip(st) {
    const chip = document.getElementById('sync-chip'); if (!chip) return;
    const labels = { demo: 'Demo · not synced', loading: 'Loading…', synced: 'Synced', saving: 'Saving…', offline: 'Offline', failed: 'Not saved', locked: 'Locked', stale: 'Stale', conflict: 'Conflict' };
    chip.setAttribute('data-state', st.state);
    document.getElementById('sync-label').textContent = labels[st.state] || st.state;
    chip.title = st.detail || '';
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]'); if (!el) return;
    const a = el.getAttribute('data-action');
    switch (a) {
      case 'nav': ev.preventDefault(); if (modalStack.length && el.closest('.modal')) closeModal(); navigate(el.getAttribute('data-view')); return;
      case 'route': ev.preventDefault(); if (el.closest('.modal')) closeModal(); navigate(el.getAttribute('data-route')); return;
      case 'search-go': closeModal(); navigate(el.getAttribute('data-route')); return;
      case 'toggle-theme': { const t = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; applyTheme(t); savePrefs({ theme: t }); return; }
      case 'fullscreen': toggleFullscreen(); return;
      case 'open-search': openSearch(); return;
      case 'open-more': openMore(); return;
      case 'close-modal': closeModal(); return;
      case 'refresh': refresh(); return;
      default: if (!MC.actions.run(a, el, ev)) console.warn('No handler for action', a);
    }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if (e.key === 'Escape' && modalStack.length) { closeModal(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === 'n') { e.preventDefault(); if (!MC.actions.run('new-task', null, e)) toast('Open Workflows to add a task.'); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
  });
  // HTML5 drag & drop (mouse/trackpad). Touch devices use the select/keyboard move controls in each card.
  document.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('[data-drag-key]'); if (c) { e.dataTransfer.setData('text/plain', c.getAttribute('data-drag-key')); e.dataTransfer.effectAllowed = 'move'; } });
  document.addEventListener('dragover', (e) => { const t = e.target.closest && e.target.closest('[data-drop-status],[data-drop-stage]'); if (t) { e.preventDefault(); t.classList.add('drop-target'); } });
  document.addEventListener('dragleave', (e) => { const t = e.target.closest && e.target.closest('[data-drop-status],[data-drop-stage]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-target'); });
  document.addEventListener('drop', (e) => {
    const t = e.target.closest && e.target.closest('[data-drop-status],[data-drop-stage]'); if (!t) return;
    e.preventDefault(); t.classList.remove('drop-target');
    const key = e.dataTransfer.getData('text/plain'); if (!key) return;
    const st = t.getAttribute('data-drop-status'), sg = t.getAttribute('data-drop-stage');
    const p = st ? MC.state.setStatus(key, st) : MC.state.setStage(key, sg);
    toast('Moved to ' + (st ? MC.state.STATUS_LABEL[st] : sg));
    p.catch((err) => toast(err.message, { error: true }));
  });
  window.addEventListener('hashchange', renderView);
  let lastTier = null;
  window.addEventListener('resize', () => { const t = MC.tier(); if (t !== lastTier) { lastTier = t; scheduleRender(); } });

  MC.app = { NAV, navigate, refresh, connect, lock, modal: openModal, closeModal, toast, confirm: confirmDialog, avatar, agentLabel, hydratePortraits, toggleFullscreen, render: scheduleRender };

  /* ---------- boot ---------- */
  async function boot() {
    // Refuse to run inside a frame: GitHub Pages cannot send frame-ancestors, and meta CSP ignores it.
    if (window.top !== window.self) { document.getElementById('app').textContent = 'Mission Control cannot run inside a frame.'; return; }
    applyTheme(prefs().theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    shell();
    MC.data.onStatus(updateChip);
    MC.state.subscribe(scheduleRender);
    lastTier = MC.tier();
    MC.state.load(await MC.data.loadAll(), { mode: 'demo' });
    updateChip(MC.data.status());
    renderView();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
