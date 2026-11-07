/* Results view (UI-A): run history (MausBot runs + receipts) with filters, and run detail route
   (results/<key>). Output is UNTRUSTED and only ever rendered through MC.sanitize.markdown.
   Honest notes: source-side truncation (2,000 characters) and heartbeat checks that leave no run. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;
  const RUN_BADGE = { completed: 'green', failed: 'red', missed: 'red', cancelled: 'red', running: 'blue', waiting: 'blue' };
  const RUN_LABEL = { missed: 'Missed', cancelled: 'Cancelled' }; // not in MC.state.STATUS_LABEL
  const runLabel = (s) => MC.state.STATUS_LABEL[s] || RUN_LABEL[s] || s;

  let F = { agent: 'all', status: 'all', source: 'all', from: '', to: '' };

  function statusBadge(st) {
    return '<span class="badge ' + (RUN_BADGE[st] != null ? RUN_BADGE[st] : '') + '">' + L(runLabel(st)) + '</span>';
  }
  function runStamp(r) { return r.finishedAt || r.startedAt || ''; }
  function inRange(r) {
    const t = runStamp(r);
    if (F.from && (!t || MC.fmt.dayKey(t) < F.from)) return false;
    if (F.to && (!t || MC.fmt.dayKey(t) > F.to)) return false;
    return true;
  }
  function pass(r) {
    if (F.agent !== 'all' && (r.agentId || '') !== F.agent) return false;
    if (F.status !== 'all' && (r.status || '') !== F.status) return false;
    if (F.source !== 'all' && (r.source || '') !== F.source) return false;
    return inRange(r);
  }

  function filterBar(m) {
    const agents = m.agents.slice().sort((a, b) => a.name.localeCompare(b.name));
    const sources = Array.from(new Set(m.runs.map((r) => r.source || 'unknown'))).sort();
    const statuses = ['all', 'completed', 'failed', 'missed', 'cancelled', 'running'];
    const wrap = (inner) => '<details class="rs-filters"' + (mcTier() === 'mobile' || mcTier() === 'tablet' ? '' : ' open') + '><summary>Filters</summary><div class="toolbar">' + inner + '</div></details>';
    return wrap(
      '<div class="field"><span>Agent</span><select data-action="rs-f-agent" aria-label="Filter by agent">' +
        '<option value="all"' + (F.agent === 'all' ? ' selected' : '') + '>All agents</option>' +
        '<option value=""' + (F.agent === '' ? ' selected' : '') + '>No agent / receipts</option>' +
        agents.map((a) => '<option value="' + A(a.id) + '"' + (F.agent === a.id ? ' selected' : '') + '>' + L(a.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span>Status</span><select data-action="rs-f-status" aria-label="Filter by status">' +
        statuses.map((s) => '<option value="' + A(s) + '"' + (F.status === s ? ' selected' : '') + '>' + L(s === 'all' ? 'All statuses' : runLabel(s)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span>Source</span><select data-action="rs-f-source" aria-label="Filter by source">' +
        '<option value="all"' + (F.source === 'all' ? ' selected' : '') + '>All sources</option>' +
        sources.map((s) => '<option value="' + A(s) + '"' + (F.source === s ? ' selected' : '') + '>' + L(s) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span>From (finished/started)</span><input type="date" data-action="rs-f-from" value="' + A(F.from) + '" aria-label="From date"></div>' +
      '<div class="field"><span>To</span><input type="date" data-action="rs-f-to" value="' + A(F.to) + '" aria-label="To date"></div>'
    );
  }
  function mcTier() { return MC.tier ? MC.tier() : 'laptop'; }

  function list(m) {
    const rows = m.runs.filter(pass);
    const trs = rows.slice(0, 200).map((r) => {
      const lag = r.scheduledFor && r.startedAt ? Math.round((Date.parse(r.startedAt) - Date.parse(r.scheduledFor)) / 60000) : null;
      return '<tr><td data-label="Status">' + statusBadge(r.status) + '</td>' +
        '<td data-label="Routine">' + L(r.routineName || r.id) + '</td>' +
        '<td data-label="Agent">' + L(MC.app.agentLabel(r)) + '</td>' +
        '<td data-label="Finished">' + L(r.finishedAt ? MC.fmt.dateTime(r.finishedAt) : '—') + '</td>' +
        '<td data-label="Started">' + L(r.startedAt ? MC.fmt.dateTime(r.startedAt) : 'Not started') + '</td>' +
        '<td data-label="Lag">' + (lag == null ? '—' : (lag >= 0 ? '+' + lag : lag) + ' min') + '</td>' +
        '<td data-label="Trigger">' + L(r.trigger || '—') + '</td>' +
        '<td data-label="Source">' + L(r.source || '—') + (r.receipt ? ' · receipt' : '') + '</td>' +
        '<td data-label=""><button class="btn small" data-action="rs-open" data-key="' + A(r.key) + '">Open</button></td></tr>';
    }).join('');
    return '<div class="toolbar"><span class="badge">' + rows.length + ' run(s)' + (rows.length > 200 ? ' · showing first 200' : '') + '</span><span class="spacer"></span>' +
      '<button class="btn primary" data-action="new-task">' + MC.icon('plus') + 'New task</button></div>' +
      filterBar(m) +
      '<div class="table-wrap"><table class="data collapse"><thead><tr><th>Status</th><th>Routine</th><th>Agent</th><th>Finished</th><th>Started</th><th>Lag</th><th>Trigger</th><th>Source</th><th></th></tr></thead>' +
      '<tbody>' + (trs || '<tr><td colspan="9">No runs match the filters. Heartbeat checks that find nothing leave no run at all.</td></tr>') + '</tbody></table></div>';
  }

  function routineFor(run, m) {
    if (!run.routineId) return null;
    return m.items.find((i) => i.kind === 'routine' && i.id === run.routineId) || null;
  }
  function detail(run, m, ctx) {
    const lagMs = run.scheduledFor && run.startedAt ? Date.parse(run.startedAt) - Date.parse(run.scheduledFor) : null;
    const lagTxt = lagMs == null ? 'No scheduled time recorded' :
      Math.abs(lagMs) < 60000 ? 'Started on schedule' :
        'Started ' + Math.round(Math.abs(lagMs) / 60000) + ' minute(s) ' + (lagMs > 0 ? 'after' : 'before') + ' the scheduled time';
    const durMs = run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
    const routine = routineFor(run, m);
    const heartbeat = routine && routine.checks && routine.checks.length
      ? '<div class="notice info">Checks that find nothing leave no run — last checked ' + L(MC.fmt.dateTime(routine.checkedAt)) + '. A quiet routine is not a failed routine.</div>' : '';
    const truncated = run.outputTruncated
      ? '<div class="notice">Output truncated by the source at 2,000 characters — the full text stays in the source system and is not available here.</div>' : '';
    const out = run.output
      ? '<div class="prose">' + ctx.s.markdown(run.output) + '</div>'
      : '<div class="empty-state">No output text was recorded for this run.</div>';
    let thread = '';
    const tid = run.raw && (run.raw.threadId || run.raw.thread_id);
    if (tid) thread = '<p class="small subtle">Source thread reference: ' + L(String(tid)) + ' (key only — the conversation itself is not synced).</p>';
    return '<div class="view-inner">' +
      '<div class="row"><button class="btn ghost" data-action="rs-back">' + MC.icon('chevron-left') + 'All results</button></div>' +
      '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Run detail</p><h2 class="panel-title">' + L(run.routineName || run.id) + '</h2></div>' +
      '<div class="panel-actions">' + statusBadge(run.status) + (run.receipt ? '<span class="badge purple">Receipt</span>' : '') + '</div></div>' +
      '<div class="section-pad"><div class="grid-2 rs-grid">' +
      '<div class="wf-info">' +
      '<div class="wf-field"><span class="wf-field-l">Agent</span><span class="wf-field-v">' + L(MC.app.agentLabel(run)) + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Trigger</span><span class="wf-field-v">' + L(run.trigger || '—') + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Scheduled for</span><span class="wf-field-v">' + L(run.scheduledFor ? MC.fmt.dateTime(run.scheduledFor) : 'Not recorded') + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Started</span><span class="wf-field-v">' + L(run.startedAt ? MC.fmt.dateTime(run.startedAt) : 'Not started') + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Finished</span><span class="wf-field-v">' + L(run.finishedAt ? MC.fmt.dateTime(run.finishedAt) : 'Not finished') + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Scheduling lag</span><span class="wf-field-v">' + L(lagTxt) + '</span></div>' +
      (durMs != null ? '<div class="wf-field"><span class="wf-field-l">Duration</span><span class="wf-field-v">' + L(Math.max(1, Math.round(durMs / 60000)) + ' minute(s)') + '</span></div>' : '') +
      '<div class="wf-field"><span class="wf-field-l">Source record</span><span class="wf-field-v">' + L((run.source || 'receipt') + ':' + run.id) + '</span></div>' +
      '<p class="small subtle">All times shown in Europe/London.</p></div>' +
      '<div class="stack">' + heartbeat + truncated + '</div>' +
      '</div><div class="separator"></div>' +
      '<h3 class="panel-title">Output</h3>' + out + thread +
      '<p class="small subtle">Output text is untrusted content and is rendered as sanitised text; scripts, event handlers and non-http links can never execute.</p>' +
      '</div></div></div>';
  }

  MC.actions.register('rs-open', (el) => { MC.app.navigate('results/' + encodeURIComponent(el.getAttribute('data-key'))); });
  MC.actions.register('rs-back', () => { MC.app.navigate('results'); });
  MC.actions.register('rs-f-agent', (el) => { F.agent = el.value; MC.app.render(); });
  MC.actions.register('rs-f-status', (el) => { F.status = el.value; MC.app.render(); });
  MC.actions.register('rs-f-source', (el) => { F.source = el.value; MC.app.render(); });
  MC.actions.register('rs-f-from', (el) => { F.from = el.value; MC.app.render(); });
  MC.actions.register('rs-f-to', (el) => { F.to = el.value; MC.app.render(); });

  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const key = (ctx.params && ctx.params[0]) || '';
    if (key) {
      const run = m.runs.find((r) => r.key === key);
      if (!run) {
        ctx.setTitle('Run not found', 'Results');
        el.innerHTML = '<div class="view-inner"><div class="empty-state">No run with key “' + L(key) + '”. ' +
          '<button class="btn" data-action="rs-back">Back to results</button></div></div>';
        return;
      }
      ctx.setTitle(run.routineName || 'Run', 'Result · ' + MC.fmt.dateTime(run.finishedAt || run.startedAt));
      el.innerHTML = detail(run, m, ctx);
      return;
    }
    ctx.setTitle('Results', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    el.innerHTML = '<div class="view-inner">' + list(m) + '</div>';
  }

  MC.views.register({ id: 'results', render });
})();
