/* Overview view (UI-A): metrics, status flow board, latest results, approaching deadlines,
   upstream-change flags + conflicts callout, demo banner. All data from MC.state's merged model. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;
  const DAY = 86400000;

  const KIND_BADGE = { routine: ['Routine', 'blue'], 'snapshot-task': ['ChatGPT snapshot', 'amber'], task: ['Task', 'purple'] };
  const RUN_BADGE = { completed: 'green', failed: 'red', missed: 'red', cancelled: 'red', running: 'blue', waiting: 'blue' };
  const RUN_LABEL = { missed: 'Missed', cancelled: 'Cancelled' }; // not in MC.state.STATUS_LABEL
  const runLabel = (s) => MC.state.STATUS_LABEL[s] || RUN_LABEL[s] || s;

  MC.actions.register('ov-status', (el) => {
    const key = el.getAttribute('data-key'), st = el.value;
    const cur = MC.state.item(key);
    if (!cur || cur.status === st) return; // fired from the click that opened the menu — wait for a real change
    MC.state.setStatus(key, st).then(() => MC.app.toast('Moved to ' + (MC.state.STATUS_LABEL[st] || st)))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  // Change/input delegation (shared by all views): selects, checkboxes and text filters carrying
  // data-action run their action on change/input instead of click. Registered once, at file load.
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t || !t.matches || !t.matches('[data-action]')) return;
    MC.actions.run(t.getAttribute('data-action'), t, ev);
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    // only live-filter text inputs here; file/checkbox/date inputs act on change, not input
    if (!t || !t.matches || !t.matches('[data-action]') || t.tagName !== 'INPUT') return;
    if (!/^(text|search|url|tel|email|number|password)$/.test(t.type || 'text')) return;
    MC.actions.run(t.getAttribute('data-action'), t, ev);
  });
  MC.actions.register('ov-open', (el, ev) => {
    // a status <select> inside a clickable card must not navigate
    if (ev && ev.target && ev.target.closest && ev.target.closest('select,option')) return;
    MC.app.navigate(el.getAttribute('data-route'));
  });
  // Keyboard parity (shared by all views): Enter/Space activates focusable [data-action] elements
  // that are not natively activatable (div/span cards). Registered once, at file load.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target;
    if (!t || !t.matches || !t.matches('[data-action]')) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable) return;
    ev.preventDefault();
    MC.actions.run(t.getAttribute('data-action'), t, ev);
  });

  /* ---------- helpers ---------- */
  function kindBadge(kind) {
    const b = KIND_BADGE[kind] || ['Item', ''];
    return '<span class="badge ' + b[1] + '">' + L(b[0]) + '</span>';
  }
  function statusBadge(st) {
    const cls = RUN_BADGE[st] != null ? RUN_BADGE[st] : '';
    return '<span class="badge ' + cls + '">' + L(runLabel(st)) + '</span>';
  }
  function shortVal(v) {
    const t = v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
    return t.length > 90 ? t.slice(0, 89) + '…' : t;
  }
  function itemCard(it, fmt) {
    const agent = L(fmt ? fmt.agentLabel(it) : (it.agentName || it.assignedLabel || 'Unassigned'));
    const paused = it.kind === 'routine' && it.enabled === false ? '<span class="badge amber">Paused</span>' : '';
    const snap = it.kind === 'snapshot-task' ? '<span class="badge amber" title="' + A('Historical snapshot — live status unverified') + '">Snapshot · unverified</span>' : '';
    const opts = MC.state.STATUSES.map((s) => '<option value="' + s + '"' + (s === it.status ? ' selected' : '') + '>' + L(MC.state.STATUS_LABEL[s] || s) + '</option>').join('');
    const sched = it.schedule && it.schedule.label ? '<p class="small muted card-line">' + L(it.schedule.label) + '</p>' : '';
    return '<div class="kanban-card" draggable="true" data-drag-key="' + A(it.key) + '" tabindex="0" role="button" ' +
      'aria-label="' + A(it.title + ' — press Enter to open details') + '" data-action="ov-open" data-route="workflows/' + A(encodeURIComponent(it.key)) + '">' +
      '<div class="row" style="align-items:flex-start"><b class="card-title">' + L(it.title) + '</b></div>' +
      '<div class="meta-row">' + kindBadge(it.kind) + paused + snap + '</div>' + sched +
      '<p class="small muted card-line">' + agent + (it.category ? ' · ' + L(it.category) : '') + '</p>' +
      '<label class="sr-only" for="ov-sel-' + A(it.key) + '">Status of ' + A(it.title) + '</label>' +
      '<select class="card-select" id="ov-sel-' + A(it.key) + '" data-action="ov-status" data-key="' + A(it.key) + '">' + opts + '</select>' +
      '</div>';
  }

  /* ---------- metrics ---------- */
  function metrics(m) {
    const routines = m.items.filter((i) => i.kind === 'routine');
    const enabled = routines.filter((r) => r.enabled).length;
    const cut = Date.now() - 7 * DAY;
    const recent = m.runs.filter((r) => { const t = r.finishedAt || r.startedAt; return t && Date.parse(t) >= cut; });
    const bad = recent.filter((r) => ['failed', 'missed', 'cancelled'].includes(r.status)).length;
    const open = m.items.filter((i) => !i.archived && i.status !== 'completed').length;
    let overdue = 0, soon = 0;
    const dated = [];
    for (const o of m.opportunities) {
      if (o.archived || !o.deadline) continue;
      const d = MC.fmt.daysUntil(o.deadline);
      if (d == null) continue;
      if (d < 0) overdue++; else if (d <= 14) { soon++; dated.push(o); }
    }
    for (const i of m.items) {
      if (i.archived || !i.deadline || i.status === 'completed') continue;
      const d = MC.fmt.daysUntil(i.deadline);
      if (d != null && d < 0) overdue++;
    }
    dated.sort((a, b) => MC.fmt.daysUntil(a.deadline) - MC.fmt.daysUntil(b.deadline));
    const metric = (n, lbl, extra) => '<div class="metric"><b>' + n + '</b><span>' + L(lbl) + '</span>' + (extra || '') + '</div>';
    return {
      html: metric(enabled, 'Active routines', '<p class="small subtle">' + pausedTxt(routines.length - enabled) + '</p>') +
        metric(recent.length, 'Runs · last 7 days', '<p class="small subtle">' + bad + ' failed or missed</p>') +
        metric(open, 'Open items on the board') +
        metric(overdue, 'Overdue', '<p class="small subtle">Past deadline, not done</p>') +
        metric(soon, 'Deadlines ≤ 14 days', '<p class="small subtle">Genuine dates only</p>'),
      dated, recent,
    };
  }
  function pausedTxt(n) { return n === 0 ? 'None paused' : n + ' paused'; }

  /* ---------- panels ---------- */
  function flowBoard(m, fmt) {
    const live = m.items.filter((i) => !i.archived);
    const cols = MC.state.STATUSES.map((st) => {
      const its = live.filter((i) => i.status === st);
      const cap = 4;
      const cards = its.slice(0, cap).map((i) => itemCard(i, fmt)).join('');
      const more = its.length > cap ? '<button class="btn ghost small" data-action="ov-open" data-route="workflows">+' + (its.length - cap) + ' more in Workflows</button>' : '';
      return '<section class="kanban-col" data-drop-status="' + st + '" aria-label="' + A(MC.state.STATUS_LABEL[st] || st) + ' column">' +
        '<div class="kanban-col-head"><span class="dot"></span>' + L(MC.state.STATUS_LABEL[st] || st) + '<span class="count">' + its.length + '</span></div>' +
        (cards || '<p class="small subtle" style="padding:4px 2px">Nothing here. Drag a card over, or use its status menu.</p>') + more + '</section>';
    }).join('');
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Status flow</p><h2 class="panel-title">Board at a glance</h2></div>' +
      '<div class="panel-actions"><span class="badge">Drag, or use each card’s menu</span>' +
      '<button class="btn" data-action="ov-open" data-route="workflows">Open full board</button></div></div>' +
      '<div class="section-pad"><div class="kanban ov-flow">' + cols + '</div></div></div>';
  }
  function latestRuns(recent, m) {
    const rows = m.runs.slice(0, 7).map((r) => {
      const lag = r.scheduledFor && r.startedAt ? Math.round((Date.parse(r.startedAt) - Date.parse(r.scheduledFor)) / 60000) : null;
      const lagTxt = lag != null && Math.abs(lag) >= 2 ? ' · started ' + (lag > 0 ? lag + ' min late' : Math.abs(lag) + ' min early') : '';
      return '<button class="card clickable run-row" data-action="ov-open" data-route="results/' + A(encodeURIComponent(r.key)) + '">' +
        '<div class="row" style="align-items:flex-start">' + statusBadge(r.status) +
        '<b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(r.routineName || 'Run') + '</b>' +
        (r.receipt ? '<span class="badge purple">Receipt</span>' : '') + '</div>' +
        '<p class="small muted">' + L(MC.fmt.dateTime(r.finishedAt || r.startedAt)) + lagTxt +
        (r.outputTruncated ? ' · output truncated by the source' : '') + '</p></button>';
    }).join('');
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Runs &amp; receipts</p><h2 class="panel-title">Latest results</h2></div>' +
      '<div class="panel-actions"><button class="btn" data-action="ov-open" data-route="results">All results</button></div></div>' +
      '<div class="section-pad"><div class="stack">' + (rows || '<div class="empty-state">No runs recorded yet.</div>') + '</div></div></div>';
  }
  function deadlines(dated, m, overdueCount) {
    const rows = dated.slice(0, 8).map((o) => {
      const d = MC.fmt.daysUntil(o.deadline);
      return '<button class="card clickable dl-row" data-action="ov-open" data-route="opportunities/funding/' + A(encodeURIComponent(o.key)) + '">' +
        '<div class="row"><span class="date-chip">' + L(MC.fmt.dateShort(o.deadline)) + '</span><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(o.title) + '</b></div>' +
        '<p class="small muted">' + L(MC.fmt.relative(o.deadline)) + (o.deadlineTime ? ' · ' + L(o.deadlineTime) : '') +
        (o.category ? ' · ' + L(o.category) : '') + ' · stage: ' + L(o.stage || 'New') + '</p></button>';
    }).join('');
    const overdueLine = overdueCount ? '<div class="notice">' + L(String(overdueCount)) + ' item(s) are past their deadline and still open — see Opportunities and the board.</div>' : '';
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Next 14 days</p><h2 class="panel-title">Approaching deadlines</h2></div>' +
      '<div class="panel-actions"><button class="btn" data-action="ov-open" data-route="opportunities">All opportunities</button></div></div>' +
      '<div class="section-pad"><div class="stack">' + overdueLine + (rows || '<div class="empty-state">No dated deadlines in the next 14 days. Undated records are never given an invented date.</div>') +
      '<p class="small subtle">Only records with a genuine published date are listed; date-less opportunities stay undated.</p></div></div></div>';
  }
  function flagsPanel(m) {
    const flags = m.flags || [], conflicts = m.conflicts || [];
    if (!flags.length && !conflicts.length) return '';
    const title = (key) => { const it = MC.state.item(key); return it ? it.title : key; };
    const fRows = flags.slice(0, 5).map((f) => '<li><b>' + L(title(f.key)) + '</b> · field ' + L(f.field) +
      ': upstream is now “' + L(shortVal(f.upstream)) + '”, your saved value is “' + L(shortVal(f.ours)) + '”.</li>').join('');
    const cRows = conflicts.slice(0, 5).map((c) => '<li><b>' + L(c.file) + '</b> · ' + L((c.path || []).join(' › ')) +
      ': another writer saved “' + L(shortVal(c.theirs)) + '” while you had “' + L(shortVal(c.ours)) + '”.</li>').join('');
    return '<div class="notice error flag-callout" role="alert">' +
      '<b>Needs your review.</b>' + (flags.length ? ' ' + flags.length + ' record(s) changed upstream where you had made edits.' : '') +
      (conflicts.length ? ' ' + conflicts.length + ' concurrent edit(s) were not applied.' : '') +
      '<ul class="flag-list">' + fRows + cRows + '</ul>' +
      '<div class="row"><button class="btn" data-action="nav" data-view="settings">Review in Settings</button>' +
      '<span class="small subtle">Accept the upstream value or keep yours, per field.</span></div></div>';
  }
  function demoBanner(mode) {
    if (mode !== 'demo') return '';
    return '<div class="notice info demo-banner">' + MC.icon('sparkles') +
      '<span><b>Synthetic demo workspace.</b> Every agent, task, run and deadline on this page is fictional demo content — nothing here is real or synced. Connect your private data repository in <button class="link-btn" data-action="nav" data-view="settings">Settings</button> to see your actual workspace.</span></div>';
  }

  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const mm = metrics(m);
    ctx.setTitle('Overview', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    el.innerHTML = '<div class="view-inner">' +
      demoBanner(MC.state.mode()) +
      '<div class="metrics-row">' + mm.html + '</div>' +
      flagsPanel(m) +
      flowBoard(m, ctx) +
      '<div class="split ov-split">' + latestRuns(mm.recent, m) + deadlines(mm.dated, m, countOverdue(m)) + '</div>' +
      '</div>';
  }
  function countOverdue(m) {
    let n = 0;
    for (const o of m.opportunities) { if (o.archived || !o.deadline) continue; const d = MC.fmt.daysUntil(o.deadline); if (d != null && d < 0) n++; }
    for (const i of m.items) { if (i.archived || !i.deadline || i.status === 'completed') continue; const d = MC.fmt.daysUntil(i.deadline); if (d != null && d < 0) n++; }
    return n;
  }

  MC.views.register({ id: 'overview', render });
})();
