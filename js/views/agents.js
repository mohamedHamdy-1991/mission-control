/* Agents view (UI-A): agent card grid + agent detail route (agents/<id>).
   Cards: portrait avatar (hydrated from the private lane by app.js), role, routines with schedule
   labels (source schedule vs dashboard plan vs snapshot), task inputs, assignment counts, dated outputs.
   Unassigned and ChatGPT snapshot tasks are shown honestly in their own panel. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;
  const DAY = 86400000;

  const RUN_BADGE = { completed: 'green', failed: 'red', missed: 'red', cancelled: 'red', running: 'blue', waiting: 'blue' };
  const RUN_LABEL = { missed: 'Missed', cancelled: 'Cancelled' }; // not in MC.state.STATUS_LABEL
  const runLabel = (s) => MC.state.STATUS_LABEL[s] || RUN_LABEL[s] || s;

  function originBadge(sched) {
    const o = sched && sched.origin;
    if (o === 'plan') return '<span class="badge purple">Dashboard plan</span>';
    if (o === 'snapshot') return '<span class="badge amber">Snapshot · unverified</span>';
    return '<span class="badge blue">Source schedule</span>';
  }
  function schedLine(it, withTz) {
    const s = it.schedule;
    if (!s || s.kind === 'none') return '';
    return '<p class="small sched-line">' + originBadge(s) + ' <span>' + L(s.label) + '</span>' +
      (withTz && s.tzNote ? '<span class="subtle sched-tz" title="' + A(s.tzNote) + '"> · ' + L(s.tzNote) + '</span>' : '') + '</p>';
  }
  function statusBadge(st) {
    const cls = RUN_BADGE[st] != null ? RUN_BADGE[st] : '';
    return '<span class="badge ' + cls + '">' + L(runLabel(st)) + '</span>';
  }

  /* ---------- data helpers ---------- */
  function agentStats(m, agentId) {
    const routines = m.items.filter((i) => i.kind === 'routine' && i.agentId === agentId);
    const runs = m.runs.filter((r) => r.agentId === agentId);
    const asgs = (m.assignments || []).filter((a) => a && (a.assignee_bot_id === agentId || a.assigneeBotId === agentId || a.agentId === agentId));
    const tasks = m.items.filter((i) => i.kind === 'task' && i.agentId === agentId && !i.archived);
    const week = runs.filter((r) => { const t = r.finishedAt || r.startedAt; return t && Date.parse(t) >= Date.now() - 7 * DAY; });
    return { routines, runs, asgs, tasks, week, latest: runs[0] || null };
  }

  /* ---------- agent card ---------- */
  function agentCard(ag, m, ctx) {
    const st = agentStats(m, ag.id);
    const routineLines = st.routines.slice(0, 4).map((r) =>
      '<div class="ag-routine"><b>' + L(r.title) + '</b>' + (r.enabled === false ? ' <span class="badge amber">Paused</span>' : '') +
      schedLine(r, false) +
      (r.description ? '<p class="small muted ag-input">' + L(MC.sanitize.excerpt(r.description, 110)) + '</p>' : '') +
      '</div>').join('');
    const more = st.routines.length > 4 ? '<p class="small subtle">+' + (st.routines.length - 4) + ' more routine(s) — open for the full list.</p>' : '';
    const latest = st.latest
      ? '<p class="small muted">Latest output: ' + L(MC.fmt.dateTime(st.latest.finishedAt || st.latest.startedAt)) + ' · ' + statusBadge(st.latest.status) + '</p>'
      : '<p class="small subtle">No recorded outputs yet.</p>';
    return '<article class="card agent-card">' +
      '<button class="ag-head" data-action="ov-open" data-route="agents/' + A(encodeURIComponent(ag.id)) + '" aria-label="' + A('Open ' + ag.name) + '">' +
      ctx.avatar(ag, '') +
      '<span class="ag-id"><b>' + L(ag.name) + '</b><span class="muted small">' + L(ag.title || 'Agent') + '</span>' +
      (ag.chiefOfStaff ? '<span class="badge purple">Chief of staff</span>' : '') + '</span></button>' +
      '<div class="meta-row"><span class="badge">' + st.routines.length + ' routine' + (st.routines.length === 1 ? '' : 's') + '</span>' +
      '<span class="badge">' + st.week.length + ' run' + (st.week.length === 1 ? '' : 's') + ' · 7 days</span>' +
      '<span class="badge">' + st.asgs.length + ' assignment' + (st.asgs.length === 1 ? '' : 's') + '</span>' +
      (st.tasks.length ? '<span class="badge purple">' + st.tasks.length + ' manual</span>' : '') + '</div>' +
      '<div class="ag-work">' + (routineLines || '<p class="small subtle">No routines assigned.</p>') + more + '</div>' + latest +
      '<div class="row"><button class="btn small" data-action="ov-open" data-route="agents/' + A(encodeURIComponent(ag.id)) + '">Open agent</button></div>' +
      '</article>';
  }

  /* ---------- unassigned / snapshot panel ---------- */
  function otherPanel(m) {
    const snap = m.items.filter((i) => i.kind === 'snapshot-task' && !i.archived);
    const un = m.items.filter((i) => !i.agentId && i.kind !== 'snapshot-task' && !i.archived);
    if (!snap.length && !un.length) return '';
    const row = (it) => '<button class="card clickable" data-action="ov-open" data-route="workflows/' + A(encodeURIComponent(it.key)) + '">' +
      '<div class="row" style="align-items:flex-start"><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(it.title) + '</b>' +
      '<span class="badge ' + (it.kind === 'snapshot-task' ? 'amber' : '') + '">' + L(MC.app.agentLabel(it)) + '</span></div>' +
      schedLine(it, true) + '</button>';
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Not attached to an agent profile</p>' +
      '<h2 class="panel-title">ChatGPT snapshots &amp; unassigned tasks</h2></div></div>' +
      '<div class="section-pad"><div class="grid-auto" style="--min:280px">' +
      snap.map(row).join('') + un.map(row).join('') +
      '</div><p class="small subtle">ChatGPT entries are saved historical snapshots — their live status is unverified. “Unassigned” tasks have no agent yet.</p></div></div>';
  }

  /* ---------- agent detail ---------- */
  function detail(ag, m, ctx) {
    const st = agentStats(m, ag.id);
    const routines = st.routines.map((r) =>
      '<div class="card"><div class="row" style="align-items:flex-start"><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(r.title) + '</b>' +
      (r.enabled === false ? '<span class="badge amber">Paused</span>' : '<span class="badge green">Enabled</span>') +
      '<button class="btn small" data-action="ov-open" data-route="workflows/' + A(encodeURIComponent(r.key)) + '">Details</button></div>' +
      schedLine(r, true) +
      (r.description ? '<p class="small muted">Input: ' + L(r.description) + '</p>' : '') +
      (r.checks && r.checks.length ? '<p class="small subtle">Heartbeat check · last checked ' + L(MC.fmt.dateTime(r.checkedAt)) + ' — checks that find nothing leave no run.</p>' : '') +
      '</div>').join('');
    const runRows = st.runs.slice(0, 15).map((r) => {
      const lag = r.scheduledFor && r.startedAt ? Math.round((Date.parse(r.startedAt) - Date.parse(r.scheduledFor)) / 60000) : null;
      return '<tr><td data-label="Status">' + statusBadge(r.status) + '</td>' +
        '<td data-label="Routine">' + L(r.routineName || r.id) + '</td>' +
        '<td data-label="Finished">' + L(MC.fmt.dateTime(r.finishedAt || r.startedAt)) + '</td>' +
        '<td data-label="Trigger">' + L(r.trigger || '—') + '</td>' +
        '<td data-label="Lag">' + (lag == null ? '—' : lag + ' min') + '</td>' +
        '<td data-label=""><button class="btn small" data-action="ov-open" data-route="results/' + A(encodeURIComponent(r.key)) + '">Output</button></td></tr>';
    }).join('');
    const asgRows = st.asgs.slice(0, 15).map((a) => {
      const rid = a.requester_run_id || a.requesterRunId || null;
      const run = rid ? m.runs.find((x) => x.id === rid) : null;
      return '<tr><td data-label="Assignment">' + L(a.id || '—') + '</td>' +
        '<td data-label="Status">' + L(a.status || '—') + '</td>' +
        '<td data-label="Created">' + L(MC.fmt.dateTime(a.created_at || a.createdAt)) + '</td>' +
        '<td data-label="From run">' + (run ? '<button class="btn small" data-action="ov-open" data-route="results/' + A(encodeURIComponent(run.key)) + '">' + L(run.routineName || rid) + '</button>' : L(rid || '—')) + '</td></tr>';
    }).join('');
    const tasks = st.tasks.map((t) =>
      '<button class="card clickable" data-action="ov-open" data-route="workflows/' + A(encodeURIComponent(t.key)) + '">' +
      '<div class="row"><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(t.title) + '</b>' + statusBadge(t.status) + '</div>' +
      schedLine(t, true) + (t.deadline ? '<p class="small muted">Due ' + L(MC.fmt.date(t.deadline)) + '</p>' : '') + '</button>').join('');
    return '<div class="view-inner">' +
      '<div class="row ag-detail-head"><button class="btn ghost" data-action="ov-open" data-route="agents">' + MC.icon('chevron-left') + 'All agents</button></div>' +
      '<div class="panel"><div class="section-pad ag-profile">' + ctx.avatar(ag, 'lg') +
      '<div><h2 class="panel-title" style="font-size:20px">' + L(ag.name) + '</h2>' +
      '<p class="muted">' + L(ag.title || 'Agent') + (ag.chiefOfStaff ? ' · Chief of staff' : '') + '</p>' +
      '<p class="small subtle">' + (ag.model ? 'Model: ' + L(ag.model) + (ag.variant ? ' · ' + L(ag.variant) : '') + ' · ' : '') +
      st.routines.length + ' routine(s) · ' + st.asgs.length + ' assignment(s) · ' + st.runs.length + ' recorded run(s)</p>' +
      '<p class="small subtle">Portraits load only from your private data lane; without a connection the initials card is shown.</p></div></div></div>' +
      '<div class="split ag-split">' +
      '<div class="stack"><div class="panel"><div class="panel-head"><h2 class="panel-title">Routines</h2></div>' +
      '<div class="section-pad"><div class="stack">' + (routines || '<div class="empty-state">No routines for this agent.</div>') + '</div></div></div>' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Manual tasks assigned</h2></div>' +
      '<div class="section-pad"><div class="stack">' + (tasks || '<div class="empty-state">No manual tasks assigned to this agent.</div>') + '</div></div></div></div>' +
      '<div class="stack">' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Run history</h2><span class="badge">' + st.runs.length + '</span></div>' +
      '<div class="section-pad"><div class="table-wrap"><table class="data collapse"><thead><tr><th>Status</th><th>Routine</th><th>Finished</th><th>Trigger</th><th>Lag</th><th></th></tr></thead>' +
      '<tbody>' + (runRows || '<tr><td colspan="6">No recorded runs for this agent.</td></tr>') + '</tbody></table></div></div></div>' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Assignments</h2><span class="badge">' + st.asgs.length + '</span></div>' +
      '<div class="section-pad"><div class="table-wrap"><table class="data collapse"><thead><tr><th>Assignment</th><th>Status</th><th>Created</th><th>From run</th></tr></thead>' +
      '<tbody>' + (asgRows || '<tr><td colspan="4">No assignments recorded.</td></tr>') + '</tbody></table></div></div></div>' +
      '</div></div></div>';
  }

  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const id = (ctx.params && ctx.params[0]) || '';
    if (id) {
      const ag = m.agentById[id];
      if (!ag) {
        ctx.setTitle('Agent not found', 'Agents');
        el.innerHTML = '<div class="view-inner"><div class="empty-state">No agent with id “' + L(id) + '”. ' +
          '<button class="btn" data-action="ov-open" data-route="agents">Back to all agents</button></div></div>';
        return;
      }
      ctx.setTitle(ag.name, 'Agent · ' + (ag.title || ''));
      el.innerHTML = detail(ag, m, ctx);
      return;
    }
    ctx.setTitle('Agents', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    const cards = m.agents.map((a) => agentCard(a, m, ctx)).join('');
    el.innerHTML = '<div class="view-inner">' +
      '<div class="metrics-row"><div class="metric"><b>' + m.agents.length + '</b><span>Agent profiles</span></div>' +
      '<div class="metric"><b>' + m.items.filter((i) => i.kind === 'routine' && i.enabled).length + '</b><span>Enabled routines</span></div>' +
      '<div class="metric"><b>' + m.runs.length + '</b><span>Recorded runs</span></div>' +
      '<div class="metric"><b>' + (m.assignments || []).length + '</b><span>Assignments</span></div></div>' +
      '<div class="grid-auto ag-grid" style="--min:320px">' + (cards || '<div class="empty-state">No agents in this workspace yet.</div>') + '</div>' +
      otherPanel(m) + '</div>';
  }

  MC.views.register({ id: 'agents', render });
})();
