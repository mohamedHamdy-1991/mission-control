/* Workflows view (UI-A): kanban board over the merged model + detail modal (route workflows/<key>)
   + new-task modal (action 'new-task', also bound to the n key in app.js).
   Mouse users drag; keyboard users move with [ ] or ←/→ and Enter; touch users use the per-card
   status select. Filters: source, agent, category, text, show-archived. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;
  const DOW = MC.state.DOW; // 1=Mon..7=Sun
  const PRIORITIES = ['low', 'normal', 'medium', 'high', 'urgent'];
  const P_LABEL = { low: 'Low', normal: 'Normal', medium: 'Medium', high: 'High', urgent: 'Urgent' };
  const SCHED_TYPES = ['none', 'once', 'daily', 'weekly'];
  const RUN_BADGE = { completed: 'green', failed: 'red', missed: 'red', cancelled: 'red', running: 'blue', waiting: 'blue' };
  const SOURCE_LABEL = { mausbot: 'MausBot routine', chatgpt: 'ChatGPT snapshot', manual: 'Manual task' };

  let F = { source: 'all', agent: 'all', category: 'all', q: '', archived: false };
  let openModalKey = null;

  /* ---------- small builders ---------- */
  function originBadge(sched) {
    const o = sched && sched.origin;
    if (o === 'plan') return '<span class="badge purple">Dashboard plan</span>';
    if (o === 'snapshot') return '<span class="badge amber">Snapshot schedule · unverified</span>';
    return '<span class="badge blue">Source schedule</span>';
  }
  function statusBadge(st) {
    return '<span class="badge ' + (RUN_BADGE[st] != null ? RUN_BADGE[st] : '') + '">' + L(MC.state.STATUS_LABEL[st] || st) + '</span>';
  }
  function kindBadges(it) {
    let b = '';
    if (it.kind === 'routine') b += '<span class="badge blue">MausBot routine</span>';
    if (it.kind === 'snapshot-task') b += '<span class="badge amber" title="Historical snapshot — live status unverified">Historical snapshot — live status unverified</span>';
    if (it.kind === 'task') b += '<span class="badge purple">Manual task</span>';
    if (it.kind === 'routine' && it.enabled === false) b += '<span class="badge amber">Paused</span>';
    if (it.archived) b += '<span class="badge dark">Archived</span>';
    return b;
  }
  const slug = (k) => 'wfc-' + String(k).replace(/[^A-Za-z0-9_-]/g, '_');
  const opts = (list, sel, labels) => list.map((v) => '<option value="' + A(v) + '"' + (v === sel ? ' selected' : '') + '>' + L((labels && labels[v]) || v) + '</option>').join('');
  const statusSelect = (it, id) =>
    '<label class="sr-only" for="' + A(id) + '">Status of ' + A(it.title) + '</label>' +
    '<select class="card-select" id="' + A(id) + '" data-action="wf-status" data-key="' + A(it.key) + '">' + opts(MC.state.STATUSES, it.status, MC.state.STATUS_LABEL) + '</select>';

  /* ---------- filters ---------- */
  function categories(m) {
    const set = new Set();
    for (const i of m.items) if (i.category) set.add(i.category);
    return Array.from(set).sort();
  }
  function filterBar(m) {
    const agents = m.agents.slice().sort((a, b) => a.name.localeCompare(b.name));
    const wrap = (inner) => '<details class="wf-filters"' + (mcTier() === 'mobile' || mcTier() === 'tablet' ? '' : ' open') + '><summary>Filters</summary><div class="toolbar wf-filter-bar">' + inner + '</div></details>';
    return wrap(
      '<div class="seg" role="group" aria-label="Filter by source">' +
        ['all', 'mausbot', 'chatgpt', 'manual'].map((s) => '<button data-action="wf-f-source" data-v="' + s + '"' + (F.source === s ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>' + L(s === 'all' ? 'All sources' : SOURCE_LABEL[s]) + '</button>').join('') + '</div>' +
      '<div class="field"><span>Agent</span><select data-action="wf-f-agent" aria-label="Filter by agent">' +
        '<option value="all"' + (F.agent === 'all' ? ' selected' : '') + '>All agents</option>' +
        '<option value="__none"' + (F.agent === '__none' ? ' selected' : '') + '>Unassigned / snapshots</option>' +
        agents.map((a) => '<option value="' + A(a.id) + '"' + (F.agent === a.id ? ' selected' : '') + '>' + L(a.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span>Category</span><select data-action="wf-f-category" aria-label="Filter by category">' +
        '<option value="all"' + (F.category === 'all' ? ' selected' : '') + '>All categories</option>' +
        categories(m).map((c) => '<option value="' + A(c) + '"' + (F.category === c ? ' selected' : '') + '>' + L(c) + '</option>').join('') + '</select></div>' +
      '<div class="field wf-q"><span>Text</span><input type="search" id="wf-q" data-action="wf-f-q" value="' + A(F.q) + '" placeholder="Title, notes, tags…" aria-label="Filter cards by text"></div>' +
      '<label class="row wf-arch"><input type="checkbox" data-action="wf-f-archived"' + (F.archived ? ' checked' : '') + '> Show archived</label>'
    );
  }
  function mcTier() { return MC.tier ? MC.tier() : 'laptop'; }

  /* ---------- cards + board ---------- */
  function pass(it) {
    if (!F.archived && it.archived) return false;
    if (F.source !== 'all' && it.source !== F.source) return false;
    if (F.agent === '__none' && it.agentId) return false;
    if (F.agent !== 'all' && F.agent !== '__none' && it.agentId !== F.agent) return false;
    if (F.category !== 'all' && (it.category || '') !== F.category) return false;
    if (F.q) {
      const q = F.q.toLowerCase();
      const hay = [it.title, it.description, it.category, (it.tags || []).join(' '), it.notes, it.agentName].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  function card(it) {
    return '<div class="kanban-card wf-card' + (it.archived ? ' archived' : '') + '" id="' + A(slug(it.key)) + '" draggable="true" tabindex="0" role="button" ' +
      'data-drag-key="' + A(it.key) + '" aria-label="' + A(it.title + '. Status ' + (MC.state.STATUS_LABEL[it.status] || it.status) + '. Press Enter to open, left or right arrow to move between columns.') + '" ' +
      'data-action="wf-card-open" data-key="' + A(it.key) + '">' +
      '<div class="row" style="align-items:flex-start"><b class="card-title">' + L(it.title) + '</b></div>' +
      '<div class="meta-row">' + kindBadges(it) +
      (it.overridden || []).map((f) => '<span class="badge purple" title="You changed this field; the source value is kept">overridden: ' + L(f) + '</span>').join('') + '</div>' +
      '<p class="small muted card-line">' + L(MC.app.agentLabel(it)) + (it.category ? ' · ' + L(it.category) : '') + (it.priority && it.priority !== 'normal' ? ' · ' + L(P_LABEL[it.priority] || it.priority) + ' priority' : '') + '</p>' +
      (it.schedule && it.schedule.label ? '<p class="small sched-line">' + originBadge(it.schedule) + ' <span>' + L(it.schedule.label) + '</span></p>' : '') +
      (it.deadline ? '<p class="small muted">Due ' + L(MC.fmt.date(it.deadline)) + ' · ' + L(MC.fmt.relative(it.deadline)) + '</p>' : '') +
      statusSelect(it, slug(it.key) + '-sel') +
      '</div>';
  }
  function board(m) {
    const live = m.items.filter(pass);
    const cols = MC.state.STATUSES.map((st) => {
      const its = live.filter((i) => i.status === st);
      return '<section class="kanban-col" data-drop-status="' + st + '" aria-label="' + A(MC.state.STATUS_LABEL[st] || st) + ' column">' +
        '<div class="kanban-col-head"><span class="dot"></span>' + L(MC.state.STATUS_LABEL[st] || st) + '<span class="count">' + its.length + '</span></div>' +
        '<div class="wf-col-cards">' + (its.map(card).join('') || '<p class="small subtle wf-empty">No cards' + (F.q || F.agent !== 'all' || F.category !== 'all' || F.source !== 'all' ? ' match the filters' : '') + '.</p>') + '</div></section>';
    }).join('');
    const total = m.items.length, shown = live.length, arch = m.items.filter((i) => i.archived).length;
    return '<div class="toolbar wf-topbar">' +
      '<span class="badge">' + shown + ' of ' + total + ' card(s)' + (arch ? ' · ' + arch + ' archived' : '') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn primary" data-action="new-task">' + MC.icon('plus') + 'New task</button></div>' +
      filterBar(m) +
      '<div class="notice info wf-help">' + MC.icon('bolt') +
      '<span><b>Move cards three ways.</b> Drag with the mouse, focus a card and press <b>[</b> / <b>]</b> (or ← →) to move it between columns, or use the status menu on the card — keyboard and touch need no drag. <b>Enter</b> opens the detail view.</span></div>' +
      '<div class="kanban wf-board">' + cols + '</div>';
  }

  /* ---------- actions: board ---------- */
  MC.actions.register('wf-status', (el) => {
    const key = el.getAttribute('data-key'), st = el.value;
    const cur = MC.state.item(key);
    if (!cur || cur.status === st) return;
    MC.state.setStatus(key, st).then(() => MC.app.toast('Moved to ' + (MC.state.STATUS_LABEL[st] || st)))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-card-open', (el, ev) => {
    if (ev && ev.target && ev.target.closest && ev.target.closest('select,option')) return;
    MC.app.navigate('workflows/' + encodeURIComponent(el.getAttribute('data-key')));
  });
  MC.actions.register('wf-f-source', (el) => { F.source = el.getAttribute('data-v') || 'all'; MC.app.render(); });
  MC.actions.register('wf-f-agent', (el) => { F.agent = el.value; MC.app.render(); });
  MC.actions.register('wf-f-category', (el) => { F.category = el.value; MC.app.render(); });
  MC.actions.register('wf-f-q', (el) => {
    const pos = el.selectionStart;
    F.q = el.value; MC.app.render();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const n = document.getElementById('wf-q');
      if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(pos, pos); } catch (e) { /* type=date etc. */ } }
    }));
  });
  MC.actions.register('wf-f-archived', (el) => { F.archived = el.checked; MC.app.render(); });

  /* keyboard column moves: focus a card, then [ ] or ←/→ */
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('wf-card') || !t.closest('#view')) return;
    if (ev.key !== '[' && ev.key !== ']' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const key = t.getAttribute('data-drag-key');
    const it = MC.state.item(key); if (!it) return;
    const i = MC.state.STATUSES.indexOf(it.status); if (i < 0) return;
    const d = ev.key === '[' || ev.key === 'ArrowLeft' ? -1 : 1;
    const n = Math.min(MC.state.STATUSES.length - 1, Math.max(0, i + d));
    if (n === i) return;
    ev.preventDefault();
    MC.state.setStatus(key, MC.state.STATUSES[n]).then(() => {
      MC.app.toast('Moved to ' + MC.state.STATUS_LABEL[MC.state.STATUSES[n]]);
      const el = document.getElementById(slug(key)); if (el) el.focus({ preventScroll: false });
    }).catch((e) => MC.app.toast(e.message, { error: true }));
  });

  /* ---------- detail modal ---------- */
  function fieldRow(label, value) {
    if (value == null || value === '') return '';
    return '<div class="wf-field"><span class="wf-field-l">' + L(label) + '</span><span class="wf-field-v">' + value + '</span></div>';
  }
  function scheduleBlock(it) {
    const s = it.schedule; if (!s) return '';
    const src = it.sourceSchedule;
    let html = '<div class="wf-sched">';
    html += '<p>' + originBadge(s) + ' <b>' + L(s.label) + '</b></p>';
    if (src) {
      html += '<p class="small muted">Source schedule (unchanged): ' + L(src.label || JSON.stringify(src)) + '</p>';
    }
    if (s.kind === 'cron') html += fieldRow('Cron expression', '<code class="mono">' + L(s.cron || '') + '</code>') + fieldRow('Schedule timezone', L(s.timeZone || ''));
    if (s.verbatim && s.kind !== 'cron') html += fieldRow('Verbatim from the source', '<code class="mono">' + L(typeof s.verbatim === 'string' ? s.verbatim : JSON.stringify(s.verbatim)) + '</code>');
    if (s.timeZone && s.kind !== 'cron') html += fieldRow('Timezone', L(s.timeZone));
    if (s.tzNote) html += '<p class="small subtle">' + L(s.tzNote) + '</p>';
    if (s.nextRunAt) html += fieldRow('Next run (from source)', L(MC.fmt.dateTime(s.nextRunAt)));
    html += '</div>';
    return html;
  }
  function flagBlocks(it) {
    return (it.flags || []).map((f) =>
      '<div class="notice error wf-flag"><b>Upstream changed:</b> field “' + L(f.field) + '”. The source now says ' +
      '<b>“' + L(shortVal(f.upstream)) + '”</b>; your saved value is <b>“' + L(shortVal(f.ours)) + '”</b> (it was made against “' + L(shortVal(f.was)) + '”). ' +
      '<div class="row"><button class="btn" data-action="wf-accept" data-key="' + A(it.key) + '" data-field="' + A(f.field) + '">Accept upstream</button>' +
      '<button class="btn" data-action="wf-keep" data-key="' + A(it.key) + '" data-field="' + A(f.field) + '">Keep mine</button></div></div>').join('');
  }
  function shortVal(v) {
    const t = v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }
  function agentOptions(m, sel) {
    return '<option value=""' + (!sel ? ' selected' : '') + '>Unassigned</option>' +
      m.agents.map((a) => '<option value="' + A(a.id) + '"' + (sel === a.id ? ' selected' : '') + '>' + L(a.name) + '</option>').join('');
  }
  function dayChecks(days) {
    return '<div class="wf-days">' + [1, 2, 3, 4, 5, 6, 7].map((d) =>
      '<label class="row"><input type="checkbox" data-wf-day value="' + d + '"' + ((days || []).includes(d) ? ' checked' : '') + '> ' + L(DOW[d]) + '</label>').join('') + '</div>';
  }
  function schedFormFields(it) {
    const s = (it.schedule || {});
    const curType = it.kind === 'task'
      ? (s.kind === 'none' ? 'none' : s.kind)
      : (s.origin === 'plan' ? (s.kind === 'weekly' || s.kind === 'daily' ? s.kind : 'once') : 'none');
    const manual = it.kind === 'task'; // manual tasks keep one date field (deadline = once date)
    return '<div class="form-grid">' +
      '<div class="field"><span>' + (manual ? 'Schedule type' : 'Schedule type (dashboard plan)') + '</span><select id="wf-e-schedtype">' + opts(SCHED_TYPES, curType) + '</select></div>' +
      '<div class="field"><span>Time (Europe/London)</span><input type="time" id="wf-e-time" value="' + A(s.time || '') + '"></div>' +
      (manual ? '' : '<div class="field"><span>Date (for “once”)</span><input type="date" id="wf-e-date" value="' + A(s.date || '') + '"></div>') +
      '<div class="field full"><span>Days (for “weekly”)</span>' + dayChecks(s.days || []) + '</div></div>';
  }
  function infoBlock(it) {
    let h = '';
    h += fieldRow('Description', it.description ? '<span class="prose">' + L(it.description) + '</span>' : '');
    h += fieldRow('Category', L(it.category || ''));
    h += fieldRow('Priority', L(P_LABEL[it.priority] || it.priority || ''));
    h += fieldRow('Status', statusBadge(it.status));
    h += fieldRow('Agent', L(MC.app.agentLabel(it)));
    if (it.deadline) h += fieldRow('Deadline', L(MC.fmt.date(it.deadline)) + ' · ' + L(MC.fmt.relative(it.deadline)));
    if (it.tags && it.tags.length) h += fieldRow('Tags', it.tags.map((t) => '<span class="badge">' + L(t) + '</span>').join(' '));
    if (it.confirmation) h += fieldRow('Confirmation', L(it.confirmation));
    if (it.liveVerification) h += fieldRow('Live verification', L(it.liveVerification));
    if (it.checkedAt) h += fieldRow('Last checked', L(MC.fmt.dateTime(it.checkedAt)));
    if (it.createdAt) h += fieldRow('Created', L(MC.fmt.dateTime(it.createdAt)));
    if (it.updatedAt) h += fieldRow('Updated', L(MC.fmt.dateTime(it.updatedAt)));
    if (it.enabled === false) h += fieldRow('Scheduler state', '<span class="badge amber">Paused in the source — no future runs</span>');
    return h;
  }
  function sourceBlock(it) {
    let h = fieldRow('Source record', L(it.sourceRef || it.key));
    if (it.link) h += fieldRow('Source link', MC.sanitize.link(it.link, 'Open source'));
    h += '<p class="small subtle">Navigation back to the source: use the link above when the record carries one; the source reference line identifies the original store either way.</p>';
    return h;
  }
  function editBlock(it, m) {
    if (it.kind === 'task') {
      return '<details class="wf-edit" open><summary>Edit manual task</summary><div class="form-grid">' +
        '<div class="field"><span>Title</span><input type="text" id="wf-e-title" value="' + A(it.title) + '"></div>' +
        '<div class="field"><span>Agent</span><select id="wf-e-agent">' + agentOptions(m, it.agentId) + '</select></div>' +
        '<div class="field"><span>Category</span><input type="text" id="wf-e-category" value="' + A(it.category || '') + '"></div>' +
        '<div class="field"><span>Priority</span><select id="wf-e-priority">' + opts(PRIORITIES, it.priority || 'normal', P_LABEL) + '</select></div>' +
        '<div class="field"><span>Deadline date</span><input type="date" id="wf-e-deadline" value="' + A(it.deadline || '') + '"></div>' +
        '<div class="field"><span>Link</span><input type="url" id="wf-e-link" value="' + A(it.link || '') + '" placeholder="https://…"></div>' +
        '<div class="field full"><span>Description</span><textarea id="wf-e-desc">' + L(it.description || '') + '</textarea></div>' +
        '<div class="field full"><span>Tags (comma separated)</span><input type="text" id="wf-e-tags" value="' + A((it.tags || []).join(', ')) + '"></div>' +
        '<div class="field full"><span>Schedule (this task only)</span>' + schedFormFields(it) + '</div></div>' +
        '<div class="row wf-edit-foot"><button class="btn primary" data-action="wf-manual-save" data-key="' + A(it.key) + '">Save task</button>' +
        '<span class="small subtle">Manual tasks are yours alone — a feed refresh never overwrites them.</span></div></details>';
    }
    // source records: field-level overrides only
    return '<details class="wf-edit"><summary>Edit (dashboard override — the source feed is never written)</summary>' +
      '<div class="notice">Edits here are <b>dashboard overrides</b> kept separately from the source feed. ' +
      'Changing the schedule below creates a <b>dashboard plan</b> — it does <b>not</b> change the source scheduler ' +
      '(the OpenMausBot routine or the ChatGPT task keeps running on its own schedule). Any upstream change to an overridden field is flagged, never lost.</div>' +
      '<div class="form-grid">' +
      '<div class="field"><span>Agent (reassign)</span><select id="wf-e-agent">' + agentOptions(m, it.agentId) + '</select></div>' +
      '<div class="field"><span>Priority</span><select id="wf-e-priority">' + opts(PRIORITIES, it.priority || 'normal', P_LABEL) + '</select></div>' +
      '<div class="field full"><span>Schedule plan (does not touch the source scheduler)</span>' + schedFormFields(it) + '</div></div>' +
      '<div class="row wf-edit-foot"><button class="btn primary" data-action="wf-override-save" data-key="' + A(it.key) + '">Save override</button>' +
      ((it.overridden || []).length ? '<button class="btn danger" data-action="wf-clear-overrides" data-key="' + A(it.key) + '">Remove all overrides</button>' : '') + '</div></details>';
  }
  function detailBody(it, m) {
    return '<div class="stack">' +
      '<div class="meta-row">' + kindBadges(it) +
      (it.overridden || []).map((f) => '<span class="badge purple">overridden: ' + L(f) + '</span>').join('') + '</div>' +
      flagBlocks(it) +
      '<div class="wf-info">' + infoBlock(it) + '</div>' +
      '<div class="wf-field"><span class="wf-field-l">Schedule</span><span class="wf-field-v">' + scheduleBlock(it) + '</span></div>' +
      sourceBlock(it) +
      '<div class="field"><span>Notes (private, saved to your lane)</span><textarea id="wf-note" placeholder="Add a note…">' + L(it.notes || '') + '</textarea>' +
      '<div class="row"><button class="btn primary" data-action="wf-note-save" data-key="' + A(it.key) + '">Save note</button>' +
      '<span class="small subtle">Notes are only yours; they never feed back to any source.</span></div></div>' +
      '<div class="field"><span>Status</span>' + statusSelect(it, 'wf-m-status') + '</div>' +
      editBlock(it, m) +
      '</div>';
  }
  function openDetail(it, ctx) {
    const m = ctx.model;
    ctx.modal({
      title: it.title, wide: true,
      body: detailBody(it, m),
      foot: '<button class="btn danger" data-action="wf-archive" data-key="' + A(it.key) + '">' + (it.archived ? 'Restore from archive' : 'Archive') + '</button>' +
        '<button class="btn" data-action="close-modal">Close</button>',
      onClose() { openModalKey = null; if (String(location.hash).indexOf('#/workflows/') === 0) MC.app.navigate('workflows'); },
    });
  }

  /* ---------- actions: detail ---------- */
  const readSched = (scope) => {
    const type = scope.querySelector('#wf-e-schedtype').value;
    const time = scope.querySelector('#wf-e-time').value || null;
    const dateEl = scope.querySelector('#wf-e-date');
    const date = dateEl ? (dateEl.value || null) : null;
    const days = Array.from(scope.querySelectorAll('[data-wf-day]:checked')).map((c) => +c.value).sort();
    return { type, time, date, days };
  };
  MC.actions.register('wf-note-save', (el) => {
    const key = el.getAttribute('data-key');
    const scope = el.closest('.modal');
    const txt = scope.querySelector('#wf-note').value;
    MC.state.setNote(key, txt.trim()).then(() => MC.app.toast('Note saved.')).catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-manual-save', (el) => {
    const it = MC.state.item(el.getAttribute('data-key')); if (!it) return;
    const s = el.closest('.modal');
    const sched = readSched(s);
    const date = (s.querySelector('#wf-e-deadline').value || null); // manual tasks: one date = deadline = once date
    MC.state.updateManualTask(it.id, {
      title: s.querySelector('#wf-e-title').value.trim() || it.title,
      description: s.querySelector('#wf-e-desc').value,
      agentId: s.querySelector('#wf-e-agent').value || null,
      category: s.querySelector('#wf-e-category').value.trim() || 'General',
      priority: s.querySelector('#wf-e-priority').value,
      date,
      link: s.querySelector('#wf-e-link').value.trim(),
      tags: s.querySelector('#wf-e-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
      scheduleType: sched.type,
      days: sched.type === 'weekly' ? sched.days : [],
      time: sched.type === 'none' ? null : sched.time,
    }).then(() => MC.app.toast('Task saved.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-override-save', (el) => {
    const it = MC.state.item(el.getAttribute('data-key')); if (!it) return;
    const s = el.closest('.modal');
    const agent = s.querySelector('#wf-e-agent').value || null;
    const prio = s.querySelector('#wf-e-priority').value;
    const sched = readSched(s);
    const patch = {};
    if (agent !== (it.agentId || null)) patch.agentId = agent;
    if (prio !== (it.priority || 'normal')) patch.priority = prio;
    const cur = it.schedule || {};
    const wantDate = sched.type === 'once' ? sched.date : null;
    if ((sched.time || null) !== (cur.time || null)) patch.scheduleTime = sched.time;
    if (sched.type === 'weekly' && JSON.stringify(sched.days) !== JSON.stringify(cur.days || [])) patch.scheduleDays = sched.days;
    if ((wantDate || null) !== (cur.date || null)) patch.scheduleDate = wantDate;
    if (!Object.keys(patch).length) { MC.app.toast('Nothing to change — the dashboard already matches.'); return; }
    MC.state.setOverride(it.key, patch).then(() => MC.app.toast('Dashboard override saved — the source scheduler is unchanged.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-clear-overrides', (el) => {
    const key = el.getAttribute('data-key');
    MC.app.confirm('Remove every field override on this record and show the pure source values again?', 'Remove overrides').then((ok) => {
      if (!ok) return;
      const it = MC.state.item(key);
      const fields = (it && it.overridden) || [];
      const step = (i) => {
        if (i >= fields.length) { MC.app.toast('Overrides removed.'); return; }
        MC.state.clearOverride(key, fields[i]).then(() => step(i + 1)).catch((e) => MC.app.toast(e.message, { error: true }));
      };
      step(0);
    });
  });
  MC.actions.register('wf-archive', (el) => {
    const key = el.getAttribute('data-key');
    const it = MC.state.item(key);
    const p = it && it.archived ? MC.state.restore(key) : MC.state.archive(key);
    p.then(() => { MC.app.toast(it && it.archived ? 'Restored to the board.' : 'Archived — hidden from the board (toggle “Show archived” to see it).'); MC.app.closeModal(); })
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-accept', (el) => {
    const key = el.getAttribute('data-key'), f = el.getAttribute('data-field');
    MC.state.acceptUpstream(key, f).then(() => MC.app.toast('Upstream value accepted; your override on “' + f + '” was removed.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('wf-keep', (el) => {
    const key = el.getAttribute('data-key'), f = el.getAttribute('data-field');
    MC.state.keepMine(key, f).then(() => MC.app.toast('Kept your value; it is re-based on the new upstream data.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });

  /* ---------- new task ---------- */
  function newTaskBody(m) {
    return '<div class="form-grid">' +
      '<div class="field full"><span>Title *</span><input type="text" id="wf-n-title" required></div>' +
      '<div class="field full"><span>Description</span><textarea id="wf-n-desc"></textarea></div>' +
      '<div class="field"><span>Agent</span><select id="wf-n-agent">' + agentOptions(m, null) + '</select></div>' +
      '<div class="field"><span>Category</span><input type="text" id="wf-n-category" value="General"></div>' +
      '<div class="field"><span>Priority</span><select id="wf-n-priority">' + opts(PRIORITIES, 'normal', P_LABEL) + '</select></div>' +
      '<div class="field"><span>Schedule type</span><select id="wf-n-schedtype">' + opts(SCHED_TYPES, 'none') + '</select></div>' +
      '<div class="field"><span>Time (Europe/London)</span><input type="time" id="wf-n-time"></div>' +
      '<div class="field"><span>Date (for “once”)</span><input type="date" id="wf-n-date"></div>' +
      '<div class="field"><span>Link</span><input type="url" id="wf-n-link" placeholder="https://…"></div>' +
      '<div class="field full"><span>Days (for “weekly”, Mon=1 … Sun=7)</span>' + dayChecks([]) + '</div>' +
      '<div class="field full"><span>Tags (comma separated)</span><input type="text" id="wf-n-tags"></div></div>' +
      '<p class="small subtle">Manual tasks live in your private lane — feeds never overwrite them. Times are Europe/London.</p>';
  }
  function openNewTask(ctx) {
    const m = ctx.model;
    ctx.modal({
      title: 'New task',
      body: newTaskBody(m),
      foot: '<button class="btn primary" data-action="wf-task-create">Create task</button><button class="btn" data-action="close-modal">Cancel</button>',
    });
  }
  MC.actions.register('new-task', () => {
    openNewTask({ model: MC.state.get(), modal: MC.app.modal });
  });
  MC.actions.register('wf-task-create', (el) => {
    const s = el.closest('.modal');
    const title = s.querySelector('#wf-n-title').value.trim();
    if (!title) { MC.app.toast('A title is required.', { error: true }); return; }
    const type = s.querySelector('#wf-n-schedtype').value;
    const days = Array.from(s.querySelectorAll('[data-wf-day]:checked')).map((c) => +c.value).sort();
    MC.state.addManualTask({
      title,
      description: s.querySelector('#wf-n-desc').value,
      agentId: s.querySelector('#wf-n-agent').value || null,
      category: s.querySelector('#wf-n-category').value.trim() || 'General',
      priority: s.querySelector('#wf-n-priority').value,
      scheduleType: type,
      days: type === 'weekly' ? days : [],
      time: s.querySelector('#wf-n-time').value || null,
      date: type === 'once' ? (s.querySelector('#wf-n-date').value || null) : null,
      tags: s.querySelector('#wf-n-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
      link: s.querySelector('#wf-n-link').value.trim(),
    }).then((t) => {
      MC.app.closeModal();
      MC.app.toast('Task created: ' + t.title);
      MC.app.navigate('workflows');
    }).catch((e) => MC.app.toast(e.message, { error: true }));
  });

  /* ---------- render ---------- */
  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const key = (ctx.params && ctx.params[0]) || '';
    ctx.setTitle('Workflows', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    let missing = '';
    if (key) {
      const it = MC.state.item(key);
      if (!it || it.kind === 'opportunity') missing = key; else if (openModalKey !== key) { openModalKey = key; openDetail(it, ctx); }
    } else if (openModalKey) { openModalKey = null; }
    el.innerHTML = '<div class="view-inner">' + board(m) + (missing ? '<div class="notice error">No card found for “' + L(missing) + '”.</div>' : '') + '</div>';
  }

  MC.views.register({ id: 'workflows', render });
})();
