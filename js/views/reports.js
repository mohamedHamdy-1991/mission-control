/* Reports view (UI-A): Research Radar weekly report archive (complete vs partial) with markdown
   detail route (reports/<key>), plus summary charts drawn with pure CSS bars — no libraries.
   Report text is untrusted and only rendered through MC.sanitize.markdown. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;
  const RUN_LABEL = { missed: 'Missed', cancelled: 'Cancelled' }; // not in MC.state.STATUS_LABEL
  const runLabel = (s) => MC.state.STATUS_LABEL[s] || RUN_LABEL[s] || s;

  /* ---------- CSS-bar chart helpers ---------- */
  function barChart(title, entries, colour, note) {
    const max = Math.max(1, ...entries.map((e) => e.n));
    const rows = entries.map((e) =>
      '<div class="bar-line"><span class="bar-label">' + L(e.label) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + Math.round((e.n / max) * 100) + '%;background:' + colour + '"></span></span>' +
      '<span class="bar-n">' + e.n + '</span></div>').join('');
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Summary</p><h2 class="panel-title">' + L(title) + '</h2></div></div>' +
      '<div class="section-pad">' + (rows || '<div class="empty-state">Nothing to chart yet.</div>') +
      (note ? '<p class="small subtle">' + L(note) + '</p>' : '') + '</div></div>';
  }
  function charts(m) {
    const byAgent = new Map();
    for (const r of m.runs) { const k = MC.app.agentLabel(r); byAgent.set(k, (byAgent.get(k) || 0) + 1); }
    const runsPerAgent = Array.from(byAgent.entries()).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    const byStatus = new Map();
    for (const r of m.runs) { const k = r.status || 'unknown'; byStatus.set(k, (byStatus.get(k) || 0) + 1); }
    const statusMix = Array.from(byStatus.entries()).map(([label, n]) => ({ label: runLabel(label), n })).sort((a, b) => b.n - a.n);
    const byMonth = new Map();
    for (const o of m.opportunities) {
      if (!o.deadline) continue;
      const k = MC.fmt.dayKey(o.deadline);
      if (!k) continue;
      const mth = k.slice(0, 7);
      byMonth.set(mth, (byMonth.get(mth) || 0) + 1);
    }
    const deadlines = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0])) // by YYYY-MM key, never by label
      .map(([mth, n]) => ({ label: MC.fmt.monthLabel(mth + '-01'), n }));
    return '<div class="grid-auto rp-charts" style="--min:300px">' +
      barChart('Runs per agent', runsPerAgent, 'var(--accent)', 'Counts include receipts; runs without an agent are listed as their honest label.') +
      barChart('Run status mix', statusMix, 'var(--green)', 'Failed and missed runs stay visible — a clean board is not faked here.') +
      barChart('Deadlines per month', deadlines, 'var(--amber)', 'Only opportunities with a genuine published date are counted; undated records are never assumed.') +
      '</div>';
  }

  /* ---------- archive ---------- */
  function archive(m) {
    const cards = m.reports.map((r) =>
      '<button class="card clickable rp-card" data-action="rp-open" data-route="reports/' + A(encodeURIComponent(r.key)) + '">' +
      '<div class="row" style="align-items:flex-start"><b style="flex:1;min-width:0;overflow-wrap:anywhere">' + L(r.title || 'Report') + '</b>' +
      '<span class="badge ' + (r.complete ? 'green' : 'amber') + '">' + (r.complete ? 'Complete' : 'Partial') + '</span></div>' +
      '<p class="small muted">' + L(r.date ? MC.fmt.date(r.date) : 'Date parsed from the report title') +
      (r.source ? ' · ' + L(r.source) : '') + '</p></button>').join('');
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Weekly scans</p><h2 class="panel-title">Radar report archive</h2></div>' +
      '<div class="panel-actions"><span class="badge">' + m.reports.length + ' report(s)</span></div></div>' +
      '<div class="section-pad"><div class="grid-auto rp-grid" style="--min:300px">' +
      (cards || '<div class="empty-state">No reports in this workspace yet.</div>') + '</div>' +
      '<p class="small subtle">Partial archives are kept as-is — the missing tail is a retrieval limit in the source, never silently filled in.</p></div></div>';
  }

  function detail(rep, ctx) {
    const partial = !rep.complete
      ? '<div class="notice">Partial report — the source retrieval stopped early (the archived text is capped), so this scan is incomplete by design.</div>'
      : '<div class="notice info">Complete report as archived by the weekly scan.</div>';
    return '<div class="view-inner">' +
      '<div class="row"><button class="btn ghost" data-action="rp-back">' + MC.icon('chevron-left') + 'All reports</button></div>' +
      '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Report</p><h2 class="panel-title">' + L(rep.title || 'Report') + '</h2></div>' +
      '<div class="panel-actions"><span class="badge ' + (rep.complete ? 'green' : 'amber') + '">' + (rep.complete ? 'Complete' : 'Partial') + '</span>' +
      '<span class="badge">' + L(rep.date ? MC.fmt.date(rep.date) : 'Undated') + '</span></div></div>' +
      '<div class="section-pad"><div class="stack">' + partial +
      (rep.source ? '<p class="small muted">Source: ' + L(rep.source) + '</p>' : '') +
      '<div class="prose">' + ctx.s.markdown(rep.text) + '</div>' +
      '<p class="small subtle">Reports are untrusted source text: rendered as sanitised text with allow-listed links only. Historical scans are never presented as newly verified facts.</p>' +
      '</div></div></div></div>';
  }

  MC.actions.register('rp-open', (el) => { MC.app.navigate(el.getAttribute('data-route')); });
  MC.actions.register('rp-back', () => { MC.app.navigate('reports'); });

  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const key = (ctx.params && ctx.params[0]) || '';
    if (key) {
      const rep = m.reports.find((r) => r.key === key);
      if (!rep) {
        ctx.setTitle('Report not found', 'Reports');
        el.innerHTML = '<div class="view-inner"><div class="empty-state">No report with key “' + L(key) + '”. ' +
          '<button class="btn" data-action="rp-back">Back to reports</button></div></div>';
        return;
      }
      ctx.setTitle(rep.title || 'Report', 'Radar archive · ' + (rep.date ? MC.fmt.date(rep.date) : 'undated'));
      el.innerHTML = detail(rep, ctx);
      return;
    }
    ctx.setTitle('Reports', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    el.innerHTML = '<div class="view-inner">' + charts(m) + archive(m) + '</div>';
  }

  MC.views.register({ id: 'reports', render });
})();
