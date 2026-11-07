/* View: Opportunities — tabs "Funding & opportunities" (Research Radar streams) and
   "PhD & publications" (weekly literature findings vs own manuscript progress).
   Every value is derived from MC.state.get() at render time; the score is re-derived with
   MC.score (RADAR_AUDIT §4) and stored editorial components are never edited here.
   Routes: opportunities | opportunities/funding | opportunities/funding/<key> | opportunities/phd[/<key>] */
(function () {
  'use strict';
  const MC = window.MC;
  const { esc, attr, link, markdown, excerpt } = MC.sanitize;
  const F = MC.fmt;

  const STREAMS = ['Funding', 'Conference', 'Journal CFP', 'Public talk', 'Association', 'My task'];
  const STREAM_BADGE = { Funding: 'green', Conference: 'blue', 'Journal CFP': 'purple', 'Public talk': 'amber', Association: 'dark', 'My task': '' };
  const REGIONS = ['UK', 'International', 'Global / online'];
  const STATUSES = ['Open', 'Conditional', 'Upcoming', 'Outreach', 'Watchlist', 'Verify', 'Closed'];
  const MODES = ['In person', 'Online', 'Hybrid', 'Research project', 'Flexible / unknown'];
  const ACTIVE = ['Interested', 'Maybe', 'Working on'];
  const WINDOWS = [['any', 'Any deadline'], ['overdue', 'Overdue'], ['7', '≤ 7 days'], ['14', '≤ 14 days'], ['30', '≤ 30 days'], ['60', '≤ 60 days'], ['none', 'No announced date']];
  const PUB_STAGES = ['draft', 'submitted', 'under review', 'revision', 'accepted', 'published'];
  // Field-level overrides — the Research Radar backup whitelist, so edits round-trip.
  const EDIT_FIELDS = [
    ['title', 'Title', 'text'], ['category', 'Stream', 'stream'], ['region', 'Region', 'region'], ['mode', 'Mode', 'mode'],
    ['status', 'Published status', 'status'], ['deadline', 'Deadline (date only)', 'date'], ['url', 'Official URL', 'url'],
    ['cost', 'Cost', 'text'], ['amount', 'Amount', 'text'], ['why', 'Why it matters', 'textarea'], ['action', 'Next action', 'textarea'],
    ['fit', 'Research fit (0–100)', 'num'], ['feasibility', 'Feasibility (0–100)', 'num'], ['value', 'Value (0–100)', 'num'], ['affordability', 'Affordability (0–100, blank = unknown)', 'num'],
  ];
  const DETAIL_FIELDS = [
    ['deadline', 'Deadline'], ['deadlineTime', 'Published deadline time'], ['deadlineNote', 'Deadline note'], ['opening', 'Expected opening'], ['openingNote', 'Opening note'],
    ['decision', 'Decision'], ['subsequent', 'Later stages'], ['amount', 'Amount'], ['duration', 'Duration'], ['cost', 'Cost'], ['budget', 'Planning allowance (not a quoted price)'],
    ['funding', 'Funding / waiver'], ['fundingDeadline', 'Funding deadline'], ['eligibility', 'Eligibility'], ['why', 'Why it matters'], ['action', 'Next action'],
    ['pitch', 'Possible talk title'], ['event', 'Event'], ['place', 'Place'], ['contact', 'Contact route'], ['globalTalent', 'Global Talent note'],
    ['change', 'Latest verified change'], ['verificationNotes', 'Verification notes'], ['evidence', 'Evidence'], ['related', 'Related record'],
    ['verified', 'Verified'], ['checkedAt', 'Checked'],
  ];
  const DATE_FIELDS = { deadline: 1, opening: 1, fundingDeadline: 1, verified: 1, checkedAt: 1 };

  const ui = { stream: 'all', region: 'all', status: 'all', stage: 'all', interest: 'all', win: 'any', q: '', archived: false, sort: 'score', mode: 'list', liveW: null };

  const model = () => MC.state.get();
  const wide = () => window.innerWidth >= 1200;
  const tier = () => MC.tier();
  const isUnknownCost = (c) => !c || /not (published|verified|confirmed)|unknown|\btbc\b|\btba\b|not yet/i.test(String(c));
  const recordUpdated = (r) => r.checkedAt || r.verified || (r.raw && (r.raw.updatedAt || r.raw.createdAt)) || '';
  const oppRoute = (key) => 'opportunities/funding/' + encodeURIComponent(key);
  const safeDomId = (key) => 'opp-' + String(key).replace(/[^A-Za-z0-9_-]/g, '_');

  /* ---------------- filtering / sorting ---------------- */
  function daysTo(r) { return r.deadline ? F.daysUntil(r.deadline) : null; }
  function passes(r, opts) {
    const o = opts || {};
    if (r.archived && !ui.archived) return false;
    if (!o.ignoreStream && ui.stream !== 'all' && (r.category || 'My task') !== ui.stream) return false;
    if (ui.region !== 'all' && r.region !== ui.region) return false;
    if (ui.status !== 'all' && MC.score.effectiveStatus(r) !== ui.status) return false;
    if (ui.stage !== 'all' && r.stage !== ui.stage) return false;
    if (ui.interest === 'active' && !ACTIVE.includes(r.stage)) return false;
    if (ui.interest !== 'all' && ui.interest !== 'active' && r.stage !== ui.interest) return false;
    const d = daysTo(r);
    if (ui.win === 'none' && r.deadline) return false;
    if (ui.win === 'overdue' && !(d != null && d < 0)) return false;
    if (/^\d+$/.test(ui.win) && !(d != null && d >= 0 && d <= +ui.win)) return false;
    if (ui.q) {
      const s = ui.q.toLowerCase();
      const hay = [r.title, r.id, r.category, r.region, r.why, r.eligibility, r.funding, r.cost, r.amount, r.notes, r.place, r.event, r.action].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }
  function sorted(list) {
    const w = model().weights;
    const arr = list.slice();
    if (ui.sort === 'deadline') arr.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title));
    else if (ui.sort === 'updated') arr.sort((a, b) => String(recordUpdated(b)).localeCompare(String(recordUpdated(a))) || a.title.localeCompare(b.title));
    else arr.sort((a, b) => { const x = MC.score.score(a, w), y = MC.score.score(b, w); return (y == null ? -1 : y) - (x == null ? -1 : x) || a.title.localeCompare(b.title); });
    return arr;
  }

  /* ---------------- small renderers ---------------- */
  function streamBadge(cat) { const c = cat || 'My task'; return '<span class="badge ' + (STREAM_BADGE[c] || '') + '">' + esc(c) + '</span>'; }
  function statusHtml(r) {
    const eff = MC.score.effectiveStatus(r);
    const cls = eff === 'Closed' ? 'red' : eff === 'Open' ? 'green' : eff === 'Conditional' || eff === 'Verify' ? 'amber' : 'blue';
    let h = '<span class="badge ' + cls + '">' + esc(eff || 'Unknown') + '</span>';
    if (eff !== r.status) h += ' <span class="badge red" title="Published status: ' + attr(r.status) + '. The deadline has passed, so it is treated as Closed for display and ranking; the source status is unchanged.">deadline passed · was ' + esc(r.status) + '</span>';
    return h;
  }
  function stageBadge(r) { return '<span class="badge ' + (ACTIVE.includes(r.stage) ? 'purple' : r.stage === 'Done' ? 'green' : '') + '" title="Your board stage">' + esc(r.stage || 'New') + '</span>'; }
  function deadlineHtml(r, compact) {
    if (!r.deadline) {
      return '<span class="muted">No announced date</span>' + (!compact && r.openingNote ? '<div class="small muted">' + esc(r.openingNote) + '</div>' : '');
    }
    const d = daysTo(r);
    const rel = d == null ? '' : d < 0 ? Math.abs(d) + ' days ago' : d === 0 ? 'today' : 'in ' + d + ' days';
    let h = '<span class="nowrap"><b>' + esc(F.date(r.deadline)) + '</b></span> <span class="small ' + (d != null && d < 0 ? 'text-red' : d != null && d <= 7 ? 'text-amber' : 'muted') + '">' + esc(rel) + '</span>';
    if (r.deadlineTime) h += '<div class="small" title="Published time, shown verbatim with its own time zone">' + esc(r.deadlineTime) + '</div>';
    else if (!compact) h += '<div class="small muted">Date only — no time published</div>';
    return h;
  }
  function costHtml(r) {
    const unknown = isUnknownCost(r.cost);
    return (unknown ? '<span class="badge amber" title="Unknown cost is not zero">Cost unknown — not free</span> ' : '') + (r.cost && !unknown ? esc(r.cost) : r.cost ? '<span class="small muted">' + esc(r.cost) + '</span>' : '');
  }
  function linksHtml(r) {
    const out = [];
    if (r.url) out.push(link(r.url, 'Official page'));
    if (r.secondaryUrl) out.push(link(r.secondaryUrl, 'Application portal'));
    if (r.costUrl) out.push(link(r.costUrl, 'Costs'));
    if (r.fundingUrl) out.push(link(r.fundingUrl, 'Funding route'));
    if (r.sources && typeof r.sources === 'object') for (const [k, v] of Object.entries(r.sources)) if (typeof v === 'string') out.push(link(v, k));
    return out.length ? '<span class="opp-links">' + out.join('<span class="sep">·</span>') + '</span>' : '<span class="small muted">No official link recorded</span>';
  }
  function verifiedHtml(r) {
    const v = r.verified ? 'Verified ' + F.date(r.verified) : 'Not verified';
    const c = r.checkedAt ? ' · checked ' + F.date(r.checkedAt) : '';
    return '<span class="small ' + (r.verified ? 'muted' : 'text-amber') + '">' + esc(v + c) + '</span>';
  }
  function flagBadges(r) {
    let h = '';
    if (r.previous) h += '<span class="badge" title="Found in an earlier weekly scan">Previously found</span>';
    if (r.source === 'manual') h += '<span class="badge purple">Your entry</span>';
    if (r.overridden && r.overridden.length) h += '<span class="badge blue" title="' + attr('Overridden: ' + r.overridden.join(', ')) + '">edited</span>';
    if (r.flags && r.flags.length) h += '<span class="badge red" title="The source changed a field you overrode">upstream changed</span>';
    if (r.archived) h += '<span class="badge dark">Archived</span>';
    return h;
  }
  function scoreHtml(r, open) {
    const w = model().weights;
    const b = MC.score.breakdown(r, w);
    const pill = b.unranked ? '<span class="score-pill unranked">Unranked</span>' : '<span class="score-pill">' + b.score + '</span>';
    const rows = b.components.map((c) => {
      const val = c.unknown ? '(unknown) 0' : String(c.value);
      const note = c.unknown && c.key === 'affordability' ? ' — unknown cost scores 0, never “free”' : '';
      return '<li><span class="bd-label">' + esc(c.label) + '</span><b>' + esc(val) + '/100</b><span class="small muted">w ' + c.weight + ' (' + c.pct + '%)' + esc(note) + '</span></li>';
    }).join('');
    const why = b.unranked
      ? (b.effectiveStatus === 'Closed' ? 'Unranked: closed (published Closed or deadline passed).' : 'Unranked: fit, feasibility or value is not scored.')
      : 'Overall ' + b.score + ' = round(Σ weight × component ÷ ' + b.weightSum + ')';
    return '<details class="score-bd"' + (open ? ' open' : '') + '><summary>' + pill + '<span class="small muted">breakdown</span></summary>' +
      '<ul class="bd-list">' + rows + '</ul><p class="small muted">' + esc(why) + '</p></details>';
  }

  /* ---------------- list / board ---------------- */
  function cardHtml(r) {
    return '<article class="card opp-card" data-key="' + attr(r.key) + '">' +
      '<div class="opp-card-head"><div class="meta-row opp-badges">' + streamBadge(r.category) + statusHtml(r) + stageBadge(r) + flagBadges(r) + '</div>' + scoreHtml(r, false) + '</div>' +
      '<h3><button class="linklike" data-action="opp-open" data-key="' + attr(r.key) + '">' + esc(r.title) + '</button></h3>' +
      '<p class="small">' + esc([r.region, r.mode].filter(Boolean).join(' · ')) + (r.amount ? ' · <b>' + esc(r.amount) + '</b>' : '') + '</p>' +
      '<dl class="kv compact">' +
        '<dt>Deadline</dt><dd>' + deadlineHtml(r, true) + '</dd>' +
        '<dt>Cost</dt><dd>' + costHtml(r) + '</dd>' +
        '<dt>Funding / waiver</dt><dd>' + esc(excerpt(r.funding || '—', 160)) + '</dd>' +
        '<dt>Eligibility</dt><dd>' + esc(excerpt(r.eligibility || '—', 160)) + '</dd>' +
      '</dl>' +
      '<div class="meta-row">' + linksHtml(r) + '<span class="spacer"></span>' + verifiedHtml(r) + '</div>' +
    '</article>';
  }
  function tableHtml(list) {
    const rows = list.map((r) =>
      '<tr>' +
        '<td data-label="Opportunity"><button class="linklike strong" data-action="opp-open" data-key="' + attr(r.key) + '">' + esc(r.title) + '</button>' +
          '<div class="meta-row">' + streamBadge(r.category) + flagBadges(r) + '</div>' +
          '<div class="small muted">' + esc([r.region, r.mode].filter(Boolean).join(' · ')) + '</div><div class="small">' + linksHtml(r) + '</div></td>' +
        '<td data-label="Status">' + statusHtml(r) + '<div style="margin-top:4px">' + stageBadge(r) + '</div></td>' +
        '<td data-label="Deadline">' + deadlineHtml(r, true) + '</td>' +
        '<td data-label="Cost / funding">' + costHtml(r) + (r.amount ? '<div class="small"><b>' + esc(r.amount) + '</b></div>' : '') + '<div class="small muted">' + esc(excerpt(r.funding || '', 110)) + '</div></td>' +
        '<td data-label="Eligibility"><span class="small">' + esc(excerpt(r.eligibility || '—', 140)) + '</span></td>' +
        '<td data-label="Score">' + scoreHtml(r, false) + '</td>' +
        '<td data-label="Verified">' + verifiedHtml(r) + '</td>' +
      '</tr>').join('');
    return '<div class="table-wrap"><table class="data collapse opp-table"><thead><tr><th>Opportunity</th><th>Status · stage</th><th>Deadline</th><th>Cost · funding</th><th>Eligibility</th><th>Score</th><th>Verified</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function boardHtml(list) {
    const stages = MC.state.RADAR_STAGES;
    return '<p class="small muted">Drag a card between columns, or focus a card and press ← / → (or use its stage menu) to move it.</p>' +
      '<div class="kanban opp-board">' + stages.map((st) => {
        const items = list.filter((r) => (r.stage || 'New') === st);
        return '<section class="kanban-col" data-drop-stage="' + attr(st) + '" aria-label="' + attr(st) + '">' +
          '<div class="kanban-col-head">' + esc(st) + '<span class="count">' + items.length + '</span></div>' +
          (items.length ? items.map((r) => {
            const sc = MC.score.score(r, model().weights);
            return '<div class="kanban-card" draggable="true" tabindex="0" id="' + attr(safeDomId(r.key)) + '" data-drag-key="' + attr(r.key) + '" data-board-card="' + attr(r.key) + '" aria-label="' + attr(r.title + ', stage ' + st + '. Use left and right arrow keys to move.') + '">' +
              '<div class="meta-row" style="margin-top:0">' + streamBadge(r.category) + '<span class="spacer"></span>' + (sc == null ? '<span class="score-pill unranked sm">–</span>' : '<span class="score-pill sm">' + sc + '</span>') + '</div>' +
              '<button class="linklike strong" data-action="opp-open" data-key="' + attr(r.key) + '">' + esc(r.title) + '</button>' +
              '<div class="small">' + deadlineHtml(r, true) + '</div>' +
              '<label class="small muted board-move">Stage <select data-stage-for="' + attr(r.key) + '" aria-label="Move to stage">' + stages.map((s) => '<option' + (s === st ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label>' +
            '</div>';
          }).join('') : '<div class="small muted empty-col">Nothing here</div>') +
        '</section>';
      }).join('') + '</div>';
  }

  /* ---------------- detail ---------------- */
  function fieldValueHtml(r, f) {
    const v = r[f];
    if (v == null || v === '') return null;
    if (f === 'deadline') return deadlineHtml(r, false);
    if (f === 'related') {
      const rel = model().opportunities.find((o) => o.id === v);
      return rel ? '<button class="linklike" data-action="opp-open" data-key="' + attr(rel.key) + '">' + esc(rel.title) + '</button>' : esc(v);
    }
    if (DATE_FIELDS[f] && F.isDateOnly(v)) return esc(F.date(v)) + ' <span class="small muted">(date only)</span>';
    if (f === 'cost') return costHtml(r);
    return esc(v);
  }
  function detailHtml(r, ctx) {
    const m = model();
    const ovr = r.overridden || [];
    const flags = r.flags || [];
    const rems = (m.reminders || []).filter((x) => x.key === r.key).sort((a, b) => a.date.localeCompare(b.date));
    const rows = DETAIL_FIELDS.map(([f, label]) => {
      const h = fieldValueHtml(r, f); if (h == null) return '';
      return '<dt>' + esc(label) + (ovr.includes(f) ? ' <span class="badge blue">overridden</span>' : '') + '</dt><dd>' + h + '</dd>';
    }).join('');
    const ovrRatings = ['fit', 'feasibility', 'value', 'affordability', 'title', 'category', 'region', 'mode', 'status', 'url'].filter((f) => ovr.includes(f));
    return '<div class="stack opp-detail">' +
      '<div class="row wrap"><button class="btn ghost" data-action="opp-close">' + MC.icon('chevron-left') + 'All opportunities</button><span class="spacer"></span>' +
        '<button class="btn" data-action="opp-edit" data-key="' + attr(r.key) + '">' + MC.icon('edit') + 'Edit fields</button>' +
        (r.archived ? '<button class="btn" data-action="opp-restore" data-key="' + attr(r.key) + '">' + MC.icon('refresh') + 'Restore</button>'
          : '<button class="btn danger" data-action="opp-archive" data-key="' + attr(r.key) + '">' + MC.icon('archive') + 'Archive</button>') +
      '</div>' +
      '<div><div class="meta-row opp-badges">' + streamBadge(r.category) + statusHtml(r) + stageBadge(r) + flagBadges(r) + '</div>' +
        '<h2 class="detail-title">' + esc(r.title) + (ovr.includes('title') ? ' <span class="badge blue">overridden</span>' : '') + '</h2>' +
        '<p class="small muted">' + esc([r.region, r.mode, r.source === 'radar' ? 'Research Radar · ' + r.id : 'Personal entry · ' + r.id].filter(Boolean).join(' · ')) + '</p>' +
        '<div class="small" style="margin-top:6px">' + linksHtml(r) + '</div></div>' +
      (flags.length ? flags.map((fl) =>
        '<div class="notice error"><b>Upstream changed “' + esc(fl.field) + '”.</b> You overrode it with <b>' + esc(JSON.stringify(fl.ours)) + '</b> against source value ' + esc(JSON.stringify(fl.was)) + '; the source now says <b>' + esc(JSON.stringify(fl.upstream)) + '</b>. Both values are kept until you choose.' +
        '<div class="row wrap" style="margin-top:8px"><button class="btn" data-action="opp-accept" data-key="' + attr(r.key) + '" data-field="' + attr(fl.field) + '">Accept upstream</button><button class="btn" data-action="opp-keep" data-key="' + attr(r.key) + '" data-field="' + attr(fl.field) + '">Keep mine</button></div></div>').join('') : '') +
      (ovrRatings.length ? '<p class="small muted">Your overrides: ' + esc(ovrRatings.join(', ')) + '. A source refresh will not overwrite them.</p>' : '') +
      '<div class="panel section-pad"><div class="row wrap"><b>Score</b><span class="spacer"></span><label class="small muted row">Your stage <select data-stage-for="' + attr(r.key) + '" aria-label="Personal stage">' + MC.state.RADAR_STAGES.map((s) => '<option' + (s === r.stage ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label></div>' + scoreHtml(r, true) + '</div>' +
      '<dl class="kv">' + rows + '</dl>' +
      '<div class="panel section-pad stack"><b>Notes</b><textarea id="opp-note" aria-label="Notes" placeholder="Private notes for this record">' + esc(r.notes || '') + '</textarea>' +
        '<div class="row"><button class="btn primary" data-action="opp-note-save" data-key="' + attr(r.key) + '">Save note</button></div></div>' +
      '<div class="panel section-pad stack"><b>Reminders</b>' +
        (rems.length ? '<ul class="plain-list">' + rems.map((x) => '<li class="row wrap"><span class="badge amber">' + esc(F.date(x.date)) + (x.time ? ' ' + esc(x.time) : ' · all day') + '</span><span>' + esc(x.title) + '</span><span class="spacer"></span><button class="btn ghost" data-action="opp-rem-remove" data-id="' + attr(x.id) + '" aria-label="Remove reminder">' + MC.icon('trash') + '</button></li>').join('') + '</ul>' : '<p class="small muted">No reminders. Reminders are your own dates — they never change the published deadline.</p>') +
        '<div class="form-grid"><label class="field"><span>Date</span><input type="date" id="opp-rem-date" value="' + attr(r.deadline && daysTo(r) > 0 ? F.addDays(r.deadline, -3 > -daysTo(r) ? -3 : 0) : F.today()) + '"></label>' +
        '<label class="field"><span>Time (optional)</span><input type="time" id="opp-rem-time"></label>' +
        '<label class="field full"><span>Reminder</span><input type="text" id="opp-rem-title" value="' + attr('Check: ' + r.title) + '"></label></div>' +
        '<div class="row"><button class="btn" data-action="opp-rem-add" data-key="' + attr(r.key) + '">' + MC.icon('bell') + 'Add reminder</button></div></div>' +
    '</div>';
  }

  /* ---------------- side panels ---------------- */
  function scanPanelHtml(m) {
    const meta = m.radarMeta || {};
    const ds = meta.dataset || {};
    const ls = ds.lastSearch || meta.lastSearch || null;
    const cov = ds.sourceCoverage || meta.sourceCoverage || null;
    const reps = (m.reports || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const ver = {};
    let noVer = 0;
    for (const r of m.opportunities) { if (r.source !== 'radar') continue; if (r.verified) ver[r.verified] = (ver[r.verified] || 0) + 1; else noVer++; }
    const verRows = Object.entries(ver).sort((a, b) => b[0].localeCompare(a[0]));
    const changes = Array.isArray(ds.changes) ? ds.changes.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
    return '<section class="panel" aria-label="Scan status"><div class="panel-head"><span class="panel-kicker">Research Radar</span><h3 class="panel-title">Scan status</h3></div><div class="section-pad stack">' +
      '<dl class="kv compact">' +
        '<dt>Data updated</dt><dd>' + (ds.updated ? esc(F.date(ds.updated)) : '<span class="muted">Not recorded</span>') + '</dd>' +
        '<dt>Next update</dt><dd>' + (ds.nextUpdate ? esc(ds.nextUpdate) + ' <span class="small muted">Europe/London (planned, not a guaranteed run)</span>' : '<span class="muted">Not recorded</span>') + '</dd>' +
        '<dt>Last full search</dt><dd>' + (ls && ls.completedAt ? esc(F.dateTime(ls.completedAt)) + ' <span class="badge ' + (ls.scope === 'all' ? 'green' : 'amber') + '">scope: ' + esc(ls.scope || '?') + '</span>' + (ls.summary ? '<div class="small muted">' + esc(ls.summary) + '</div>' : '') : '<span class="muted">No completed full search recorded</span>') + '</dd>' +
        (ds.coverage ? '<dt>Coverage</dt><dd class="small">' + esc(ds.coverage) + '</dd>' : '') +
        (ds.scoringNote ? '<dt>Scoring note</dt><dd class="small">' + esc(ds.scoringNote) + '</dd>' : '') +
      '</dl>' +
      (cov ? '<details><summary class="small"><b>Coverage &amp; limitations</b></summary><div class="small stack" style="margin-top:6px">' +
        (cov.streams ? '<div>Streams: ' + esc([].concat(cov.streams).join(', ')) + '</div>' : '') +
        (cov.horizonEnd ? '<div>Horizon to ' + esc(F.date(cov.horizonEnd)) + '</div>' : '') +
        (Array.isArray(cov.limitations) && cov.limitations.length ? '<ul class="plain-list bullets">' + cov.limitations.map((l) => '<li>' + esc(typeof l === 'string' ? l : JSON.stringify(l)) + '</li>').join('') + '</ul>' : '') +
      '</div></details>' : '<p class="small muted">No coverage statement in this feed.</p>') +
      '<div><b class="small">Current verification</b><ul class="plain-list small">' +
        (verRows.length ? verRows.map(([d, n]) => '<li class="row"><span>' + esc(F.date(d)) + '</span><span class="spacer"></span><span class="badge">' + n + ' record' + (n === 1 ? '' : 's') + '</span></li>').join('') : '') +
        '<li class="row"><span>Not verified</span><span class="spacer"></span><span class="badge ' + (noVer ? 'amber' : '') + '">' + noVer + '</span></li></ul></div>' +
      '<div><b class="small">Previous scans</b>' + (reps.length ? '<ul class="plain-list small">' + reps.map((rp) =>
        '<li class="row wrap"><button class="linklike" data-action="route" data-route="' + attr('reports/' + encodeURIComponent(rp.key)) + '">' + esc(rp.title || 'Report') + '</button><span class="spacer"></span>' +
        (rp.date ? '<span class="muted">' + esc(F.date(rp.date)) + '</span>' : '') + '<span class="badge ' + (rp.complete ? 'green' : 'amber') + '">' + (rp.complete ? 'complete' : 'partial') + '</span></li>').join('') + '</ul>'
        : '<p class="small muted">No scan reports in this feed.</p>') + '</div>' +
      (changes.length ? '<details><summary class="small"><b>Change log</b> (' + changes.length + ')</summary><ul class="plain-list small">' + changes.slice(0, 30).map((c) => '<li><span class="muted">' + esc(c.date ? F.date(c.date) : '') + '</span> ' + esc(c.text || '') + '</li>').join('') + '</ul></details>' : '') +
    '</div></section>';
  }
  function weightsPanelHtml(m) {
    const w = ui.liveW || m.weights;
    const sum = MC.score.KEYS.reduce((a, k) => a + (+w[k] || 0), 0);
    return '<section class="panel" aria-label="Scoring weights"><div class="panel-head"><span class="panel-kicker">Method</span><h3 class="panel-title">Scoring weights</h3>' +
      '<div class="panel-actions"><button class="btn ghost" data-action="opp-weights-reset">Reset defaults</button></div></div><div class="section-pad stack">' +
      '<p class="small muted">Score = round(Σ weight × component ÷ Σ weights). Urgency and support are recomputed from the deadline and support route; unknown cost scores 0.</p>' +
      MC.score.KEYS.map((k) => '<label class="weight-row"><span>' + esc(MC.score.LABELS[k]) + '</span><input type="range" min="0" max="50" step="1" id="opp-w-' + k + '" data-weight="' + k + '" value="' + (+w[k] || 0) + '" aria-label="' + attr(MC.score.LABELS[k] + ' weight') + '">' +
        '<output id="opp-wo-' + k + '">' + (+w[k] || 0) + ' · ' + (sum ? Math.round(((+w[k] || 0) / sum) * 100) : 0) + '%</output></label>').join('') +
    '</div></section>';
  }

  /* ---------------- funding tab ---------------- */
  function filtersHtml() {
    const opt = (v, l, cur) => '<option value="' + attr(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>';
    return '<details class="panel opp-filters"' + (tier() === 'mobile' ? '' : ' open') + '><summary>' + MC.icon('filter') + '<b>Filters</b><span class="small muted" id="opp-filter-summary"></span></summary>' +
      '<div class="section-pad form-grid opp-filter-grid">' +
        '<label class="field"><span>Search</span><input type="search" id="opp-q" data-filter="q" value="' + attr(ui.q) + '" placeholder="Title, eligibility, notes…"></label>' +
        '<label class="field"><span>Region</span><select data-filter="region">' + opt('all', 'All regions', ui.region) + REGIONS.map((x) => opt(x, x, ui.region)).join('') + '</select></label>' +
        '<label class="field"><span>Published status</span><select data-filter="status">' + opt('all', 'Any status', ui.status) + STATUSES.map((x) => opt(x, x, ui.status)).join('') + '</select></label>' +
        '<label class="field"><span>Board stage</span><select data-filter="stage">' + opt('all', 'Any stage', ui.stage) + MC.state.RADAR_STAGES.map((x) => opt(x, x, ui.stage)).join('') + '</select></label>' +
        '<label class="field"><span>Interest</span><select data-filter="interest">' + opt('all', 'Any', ui.interest) + opt('active', 'Active (Interested / Maybe / Working on)', ui.interest) + ACTIVE.concat(['Applied / pitched']).map((x) => opt(x, x, ui.interest)).join('') + '</select></label>' +
        '<label class="field"><span>Deadline</span><select data-filter="win">' + WINDOWS.map(([v, l]) => opt(v, l, ui.win)).join('') + '</select></label>' +
        '<label class="field"><span>Sort</span><select data-filter="sort">' + opt('score', 'Score (high first)', ui.sort) + opt('deadline', 'Deadline (soonest)', ui.sort) + opt('updated', 'Recently checked', ui.sort) + '</select></label>' +
        '<label class="field check-field"><span>Archived</span><span class="row"><input type="checkbox" data-filter="archived"' + (ui.archived ? ' checked' : '') + '> Show archived</span></label>' +
      '</div><div class="section-pad" style="padding-top:0"><button class="btn ghost" data-action="opp-clear">Clear filters</button></div></details>';
  }
  function resultsHtml() {
    const m = model();
    const base = m.opportunities.filter((r) => passes(r, { ignoreStream: true }));
    const counts = {}; for (const r of base) { const c = r.category || 'My task'; counts[c] = (counts[c] || 0) + 1; }
    const list = sorted(base.filter((r) => passes(r)));
    const showTable = !(tier() === 'mobile' || tier() === 'tablet') && !(wide() && currentKey && tier() !== 'monitor');
    const chips = '<div class="opp-chips" role="toolbar" aria-label="Streams">' +
      '<button class="chip' + (ui.stream === 'all' ? ' active' : '') + '" data-action="opp-stream" data-stream="all">All <span class="count">' + base.length + '</span></button>' +
      STREAMS.filter((s) => s !== 'My task' || counts[s]).map((s) => '<button class="chip' + (ui.stream === s ? ' active' : '') + '" data-action="opp-stream" data-stream="' + attr(s) + '"><span class="dot s-' + attr(s.replace(/\W+/g, '')) + '"></span>' + esc(s) + ' <span class="count">' + (counts[s] || 0) + '</span></button>').join('') +
    '</div>';
    const head = '<div class="toolbar"><span class="small muted">' + list.length + ' of ' + m.opportunities.filter((r) => ui.archived || !r.archived).length + ' records</span><span class="spacer"></span>' +
      '<div class="seg" role="tablist" aria-label="Layout"><button role="tab" data-action="opp-mode" data-mode="list" aria-selected="' + (ui.mode === 'list') + '">' + MC.icon('list') + ' List</button><button role="tab" data-action="opp-mode" data-mode="board" aria-selected="' + (ui.mode === 'board') + '">' + MC.icon('grid') + ' Board</button></div></div>';
    let body;
    if (!list.length) body = '<div class="empty-state">No opportunities match these filters.' + (m.opportunities.length ? ' <button class="linklike" data-action="opp-clear">Clear filters</button>' : ' This feed has no records yet.') + '</div>';
    else if (ui.mode === 'board') body = boardHtml(list);
    else if (showTable) body = tableHtml(list);
    else body = '<div class="grid-auto opp-cards">' + list.map(cardHtml).join('') + '</div>';
    return chips + head + body;
  }
  let currentKey = null;
  function fundingTab(root, ctx) {
    const m = ctx.model;
    const key = ctx.params[1] || null;
    currentKey = key;
    const rec = key ? m.opportunities.find((o) => o.key === key) : null;
    const missing = key && !rec ? '<div class="notice error">That opportunity was not found in the current data. <button class="linklike" data-action="opp-close">Back to the list</button></div>' : '';
    const listBlock = filtersHtml() + '<div id="opp-results" class="stack">' + resultsHtml() + '</div>';
    if (rec && !wide()) {
      root.insertAdjacentHTML('beforeend', detailHtml(rec, ctx));
      return;
    }
    const side = rec ? '<aside class="panel detail-pane section-pad" aria-label="Opportunity detail">' + detailHtml(rec, ctx) + '</aside>'
      : '<aside class="stack side-pane">' + scanPanelHtml(m) + weightsPanelHtml(m) + '</aside>';
    root.insertAdjacentHTML('beforeend', missing + '<div class="split opp-split"><div class="stack main-pane">' + listBlock + '</div>' + side + '</div>' +
      (rec ? '<div class="grid-2 opp-lower">' + scanPanelHtml(m) + weightsPanelHtml(m) + '</div>' : ''));
    updateFilterSummary(root);
  }
  function updateFilterSummary(root) {
    const el = (root || document).querySelector('#opp-filter-summary'); if (!el) return;
    const on = [];
    if (ui.q) on.push('“' + ui.q + '”');
    for (const k of ['region', 'status', 'stage', 'interest']) if (ui[k] !== 'all') on.push(ui[k]);
    if (ui.win !== 'any') on.push((WINDOWS.find((w) => w[0] === ui.win) || [0, ui.win])[1]);
    if (ui.archived) on.push('incl. archived');
    el.textContent = on.length ? ' · ' + on.join(' · ') : '';
  }
  function redrawResults() {
    const box = document.getElementById('opp-results'); if (!box) return;
    box.innerHTML = resultsHtml();
    updateFilterSummary();
  }

  /* ---------------- PhD & publications tab ---------------- */
  function liveBlockedNotes(m) {
    const L = m.ledger;
    const entries = [];
    let connected = false;
    const visit = (src, arr) => {
      for (const x of arr || []) {
        const t = typeof x === 'string' ? x : x && (x.what || x.item || x.reason || x.note || x.source || JSON.stringify(x));
        if (t) entries.push((src ? src + ': ' : '') + t);
      }
    };
    if (L && typeof L === 'object') {
      const srcs = Array.isArray(L) ? L : Array.isArray(L.sources) ? L.sources : [];
      for (const s of srcs) {
        if (!s || typeof s !== 'object') continue;
        if (/notion|uhi|phd/i.test(String(s.source || '')) && s.live === true) connected = true;
        visit(String(s.source || ''), s.liveBlocked);
      }
      visit('', L.liveBlocked);
    }
    const relevant = entries.filter((t) => /notion|uhi|phd|leeds|literature/i.test(t));
    return { connected, entries: relevant.length ? relevant : [] };
  }
  function pubStageBadge(stage) {
    const s = String(stage || '').toLowerCase();
    const cls = s === 'accepted' || s === 'published' ? 'green' : s === 'submitted' || s === 'under review' ? 'blue' : s === 'revision' ? 'amber' : '';
    return '<span class="badge ' + cls + '">' + esc(stage || 'stage not recorded') + '</span>';
  }
  function evidenceHtml(ev) {
    if (!ev) return '<span class="text-amber small">No evidence recorded</span>';
    if (/^https?:\/\//i.test(String(ev).trim())) return link(String(ev).trim(), 'Evidence');
    return '<span class="small">' + esc(ev) + '</span>';
  }
  function phdTab(root, ctx) {
    const m = ctx.model;
    const openKey = ctx.params[1] || null;
    const lb = liveBlockedNotes(m);
    const inputsOpp = m.opportunities.filter((o) => !o.archived && o.category === 'Journal CFP');
    const inputsTasks = m.items.filter((it) => it.source === 'manual' && !it.archived && /^(phd|publishing)$/i.test(it.category || ''));
    const manualPubs = m.items.filter((it) => it.source === 'manual' && /^publication$/i.test(it.category || '') && it.raw && it.raw.stage);
    const pubTasks = m.items.filter((it) => it.source === 'manual' && !it.archived && (/^publishing$/i.test(it.category || '') || (/^publication$/i.test(it.category || '') && !(it.raw && it.raw.stage))));
    const manuscripts = (m.publications || []).map((p) => Object.assign({ origin: 'feed' }, p))
      .concat(manualPubs.map((it) => ({ key: it.key, id: it.id, title: it.title, stage: it.raw.stage, stageDate: it.raw.stageDate || null, venue: it.raw.venue || '', evidence: it.raw.evidence || '', origin: 'manual', history: it.raw.history })));

    const lit = (m.phdReports || []).map((r) =>
      '<article class="card" id="' + attr(safeDomId(r.key)) + '"><div class="row wrap"><span class="badge purple">Literature</span>' + (r.date ? '<span class="badge">' + esc(F.date(r.date)) + '</span>' : '<span class="badge amber">undated</span>') +
      '<span class="small muted">Provenance: ' + esc(r.provenance || 'not recorded') + '</span></div>' +
      '<h3 style="margin-top:8px">' + esc(r.title) + '</h3>' +
      '<details' + (openKey === r.key ? ' open' : '') + '><summary class="small">Read digest</summary><div class="prose">' + markdown(r.text) + '</div></details></article>').join('');

    const manuscriptsHtml = manuscripts.length ? '<div class="grid-auto">' + manuscripts.map((p) => {
      const hist = Array.isArray(p.history) ? p.history.filter((h) => h && h.stage && h.date) : [];
      return '<article class="card"><div class="row wrap">' + pubStageBadge(p.stage) + '<span class="badge ' + (p.origin === 'manual' ? 'purple' : '') + '">' + (p.origin === 'manual' ? 'Your entry' : 'Publications feed') + '</span></div>' +
        '<h3 style="margin-top:8px">' + esc(p.title || 'Untitled manuscript') + '</h3>' +
        (p.venue ? '<p>' + esc(p.venue) + '</p>' : '') +
        '<dl class="kv compact"><dt>Stage date</dt><dd>' + (p.stageDate ? esc(F.date(p.stageDate)) : '<span class="muted">Not recorded (no date shown without a source)</span>') + '</dd>' +
        '<dt>Evidence</dt><dd>' + evidenceHtml(p.evidence) + '</dd></dl>' +
        (hist.length ? '<ol class="pub-history small">' + hist.map((h) => '<li>' + pubStageBadge(h.stage) + ' ' + esc(F.date(h.date)) + (h.evidence ? ' · ' + evidenceHtml(h.evidence) : '') + '</li>').join('') + '</ol>' : '') +
      '</article>';
    }).join('') + '</div>'
      : '<div class="empty-state"><b>No manuscripts recorded yet.</b><br>Add one with “Add manuscript” — it is saved as a manual entry (category “Publication”) with a stage (' + esc(PUB_STAGES.join(', ')) + '), the date that stage was reached and the evidence for it (e.g. a submission receipt). Only source-backed dates are shown; nothing is inferred.</div>';

    root.insertAdjacentHTML('beforeend',
      '<div class="split phd-split"><div class="stack main-pane">' +
      '<section class="panel" aria-labelledby="phd-lit-h"><div class="panel-head"><span class="panel-kicker">Section A</span><h3 class="panel-title" id="phd-lit-h">Weekly literature findings</h3></div><div class="section-pad stack">' +
        '<p class="small muted">Weekly Leeds UHI digests — what other people published. This is separate from your own manuscript progress below.</p>' +
        (lb.connected ? '' : '<div class="notice"><b>Live source not connected.</b> The Leeds UHI Notion research hub is live-blocked in this build, so the digests below are imported snapshots with provenance, not a live read.' +
          (lb.entries.length ? '<ul class="plain-list bullets">' + lb.entries.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') + '</div>') +
        (lit || '<div class="empty-state">No weekly literature digests imported yet.</div>') +
      '</div></section>' +
      '<section class="panel" aria-labelledby="phd-ms-h"><div class="panel-head"><span class="panel-kicker">Section B</span><h3 class="panel-title" id="phd-ms-h">My manuscript progress</h3><div class="panel-actions"><button class="btn" data-action="opp-pub-add">' + MC.icon('plus') + 'Add manuscript</button></div></div><div class="section-pad stack">' +
        '<p class="small muted">Your own manuscripts. Stages: ' + esc(PUB_STAGES.join(' → ')) + '. Only dates and outcomes with evidence are shown.</p>' +
        manuscriptsHtml +
        '<div><b class="small">Publication tasks</b>' + (pubTasks.length ? '<ul class="plain-list">' + pubTasks.map((t) =>
          '<li class="row wrap"><button class="linklike" data-action="route" data-route="' + attr('workflows/' + encodeURIComponent(t.key)) + '">' + esc(t.title) + '</button><span class="spacer"></span>' +
          (t.deadline ? '<span class="badge">' + esc(F.date(t.deadline)) + '</span>' : '<span class="small muted">no date</span>') + '<span class="badge">' + esc(MC.state.STATUS_LABEL[t.status] || t.status) + '</span></li>').join('') + '</ul>'
          : '<p class="small muted">No publication tasks. Add a task in Workflows with category “Publishing”.</p>') + '</div>' +
      '</div></section></div>' +
      '<aside class="stack side-pane"><section class="panel" aria-label="Relevant research inputs"><div class="panel-head"><span class="panel-kicker">Inputs</span><h3 class="panel-title">Relevant research inputs</h3></div><div class="section-pad stack">' +
        '<p class="small muted">Journal calls for papers from the Radar, plus your PhD / Publishing tasks.</p>' +
        (inputsOpp.length ? '<ul class="plain-list">' + inputsOpp.map((o) => '<li class="stack" style="gap:2px"><button class="linklike strong" data-action="opp-open" data-key="' + attr(o.key) + '">' + esc(o.title) + '</button><span class="small">' + statusHtml(o) + ' ' + deadlineHtml(o, true) + '</span></li>').join('') + '</ul>' : '<p class="small muted">No journal calls in the current feed.</p>') +
        (inputsTasks.length ? '<ul class="plain-list">' + inputsTasks.map((t) => '<li class="row wrap"><button class="linklike" data-action="route" data-route="' + attr('workflows/' + encodeURIComponent(t.key)) + '">' + esc(t.title) + '</button><span class="badge">' + esc(t.category) + '</span></li>').join('') + '</ul>' : '<p class="small muted">No PhD or Publishing tasks.</p>') +
      '</div></section></aside></div>');
    if (openKey) setTimeout(() => { const e = document.getElementById(safeDomId(openKey)); if (e) e.scrollIntoView({ block: 'start' }); }, 30);
  }

  /* ---------------- view ---------------- */
  MC.views.register({
    id: 'opportunities', label: 'Opportunities', icon: 'award',
    render(el, ctx) {
      const tab = ctx.params[0] === 'phd' ? 'phd' : 'funding';
      ctx.setTitle(tab === 'phd' ? 'PhD & publications' : 'Funding & opportunities', 'Opportunities');
      const root = document.createElement('div');
      root.className = 'view-inner opp-view';
      root.innerHTML = '<div class="toolbar"><div class="seg" role="tablist" aria-label="Opportunities sections">' +
        '<button role="tab" data-action="opp-tab" data-tab="funding" aria-selected="' + (tab === 'funding') + '">' + MC.icon('award') + ' Funding &amp; opportunities</button>' +
        '<button role="tab" data-action="opp-tab" data-tab="phd" aria-selected="' + (tab === 'phd') + '">' + MC.icon('book') + ' PhD &amp; publications</button></div>' +
        '<span class="spacer"></span>' + (tab === 'funding' ? '<button class="btn primary" data-action="opp-add">' + MC.icon('plus') + 'Add opportunity</button>' : '') + '</div>';
      el.appendChild(root);
      if (tab === 'phd') phdTab(root, ctx); else fundingTab(root, ctx);

      root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.matches('[data-filter="q"]')) { ui.q = t.value.trim(); redrawResults(); }
        else if (t.matches('[data-weight]')) {
          const w = {}; root.querySelectorAll('[data-weight]').forEach((i) => { w[i.getAttribute('data-weight')] = +i.value; });
          ui.liveW = w;
          const sum = MC.score.KEYS.reduce((a, k) => a + w[k], 0);
          for (const k of MC.score.KEYS) { const o = root.querySelector('#opp-wo-' + k); if (o) o.textContent = w[k] + ' · ' + (sum ? Math.round((w[k] / sum) * 100) : 0) + '%'; }
        }
      });
      root.addEventListener('change', (e) => {
        const t = e.target;
        const f = t.getAttribute('data-filter');
        if (f && f !== 'q') { ui[f] = t.type === 'checkbox' ? t.checked : t.value; redrawResults(); return; }
        if (t.matches('[data-weight]')) {
          const w = {}; root.querySelectorAll('[data-weight]').forEach((i) => { w[i.getAttribute('data-weight')] = +i.value; });
          ui.liveW = null;
          MC.state.setWeights(w).catch((err) => MC.app.toast(err.message, { error: true }));
          return;
        }
        const sk = t.getAttribute('data-stage-for');
        if (sk) MC.state.setStage(sk, t.value).then(() => MC.app.toast('Stage: ' + t.value)).catch((err) => MC.app.toast(err.message, { error: true }));
      });
      root.addEventListener('keydown', (e) => {
        const card = e.target.closest && e.target.closest('[data-board-card]');
        if (!card || e.target !== card || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const key = card.getAttribute('data-board-card');
        const rec = model().opportunities.find((o) => o.key === key); if (!rec) return;
        const st = MC.state.RADAR_STAGES, i = st.indexOf(rec.stage || 'New'), j = i + (e.key === 'ArrowRight' ? 1 : -1);
        if (j < 0 || j >= st.length) return;
        MC.state.setStage(key, st[j]).then(() => MC.app.toast('Moved to ' + st[j])).catch((err) => MC.app.toast(err.message, { error: true }));
      });
    },
  });

  /* ---------------- actions (registered at load) ---------------- */
  const A = MC.actions.register;
  const fail = (err) => MC.app.toast((err && err.message) || String(err), { error: true });
  A('opp-tab', (el) => MC.app.navigate('opportunities/' + el.getAttribute('data-tab')));
  A('opp-stream', (el) => { ui.stream = el.getAttribute('data-stream'); redrawResults(); });
  A('opp-mode', (el) => { ui.mode = el.getAttribute('data-mode'); redrawResults(); });
  A('opp-open', (el) => MC.app.navigate(oppRoute(el.getAttribute('data-key'))));
  A('opp-close', () => MC.app.navigate('opportunities/funding'));
  A('opp-clear', () => { Object.assign(ui, { stream: 'all', region: 'all', status: 'all', stage: 'all', interest: 'all', win: 'any', q: '', archived: false }); MC.app.render(); });
  A('opp-archive', (el) => { const k = el.getAttribute('data-key'); MC.app.confirm('Archive this record? It stays restorable and is hidden from the default list.', 'Archive').then((ok) => { if (ok) MC.state.archive(k).then(() => MC.app.toast('Archived'), fail); }); });
  A('opp-restore', (el) => MC.state.restore(el.getAttribute('data-key')).then(() => MC.app.toast('Restored'), fail));
  A('opp-accept', (el) => MC.state.acceptUpstream(el.getAttribute('data-key'), el.getAttribute('data-field')).then(() => MC.app.toast('Upstream value accepted'), fail));
  A('opp-keep', (el) => MC.state.keepMine(el.getAttribute('data-key'), el.getAttribute('data-field')).then(() => MC.app.toast('Kept your value'), fail));
  A('opp-note-save', (el) => { const t = document.getElementById('opp-note'); MC.state.setNote(el.getAttribute('data-key'), t ? t.value : '').then(() => MC.app.toast('Note saved'), fail); });
  A('opp-rem-add', (el) => {
    const date = (document.getElementById('opp-rem-date') || {}).value, time = (document.getElementById('opp-rem-time') || {}).value || null;
    const title = (document.getElementById('opp-rem-title') || {}).value || 'Reminder';
    if (!F.isDateOnly(date)) { MC.app.toast('Choose a date for the reminder.', { error: true }); return; }
    MC.state.addReminder({ key: el.getAttribute('data-key'), date, time, title }).then(() => MC.app.toast('Reminder added for ' + F.date(date)), fail);
  });
  A('opp-rem-remove', (el) => MC.state.removeReminder(el.getAttribute('data-id')).then(() => MC.app.toast('Reminder removed'), fail));
  A('opp-weights-reset', () => { ui.liveW = null; MC.state.setWeights(MC.score.DEFAULT_WEIGHTS).then(() => MC.app.toast('Default weights restored'), fail); });

  function fieldInput(id, kind, value) {
    const v = value == null ? '' : value;
    const sel = (opts) => '<select id="' + id + '"><option value="">—</option>' + opts.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + (v && !opts.includes(v) ? '<option selected>' + esc(v) + '</option>' : '') + '</select>';
    if (kind === 'stream') return sel(STREAMS);
    if (kind === 'region') return sel(REGIONS);
    if (kind === 'mode') return sel(MODES);
    if (kind === 'status') return sel(STATUSES);
    if (kind === 'date') return '<input type="date" id="' + id + '" value="' + attr(F.isDateOnly(v) ? v : '') + '">';
    if (kind === 'num') return '<input type="number" min="0" max="100" step="1" id="' + id + '" value="' + attr(v) + '">';
    if (kind === 'url') return '<input type="url" id="' + id + '" value="' + attr(v) + '" placeholder="https://">';
    if (kind === 'textarea') return '<textarea id="' + id + '">' + esc(v) + '</textarea>';
    return '<input type="text" id="' + id + '" value="' + attr(v) + '">';
  }
  function readField(root, id, kind) {
    const el = root.querySelector('#' + id); if (!el) return undefined;
    const raw = el.value.trim();
    if (kind === 'num') { if (raw === '') return null; const n = Math.round(+raw); return isNaN(n) ? null : Math.max(0, Math.min(100, n)); }
    if (kind === 'date') return F.isDateOnly(raw) ? raw : null;
    if (kind === 'url') return raw ? (MC.sanitize.safeUrl(raw) || null) : null;
    return raw === '' ? null : raw;
  }
  A('opp-edit', (el) => {
    const key = el.getAttribute('data-key');
    const r = model().opportunities.find((o) => o.key === key); if (!r) return;
    const ovr = r.overridden || [];
    MC.app.modal({
      title: 'Edit: ' + r.title, wide: true,
      body: '<p class="small muted">' + (r.source === 'manual' ? 'Your own entry — edited in place.' : 'Edits are saved as field-level overrides on top of the source record. A feed refresh never erases them; if the source later changes a field you edited, it is flagged so you can accept upstream or keep yours.') + ' Deadlines are dates only; enter the published time in your notes if needed.</p>' +
        '<div class="form-grid">' + EDIT_FIELDS.map(([f, label, kind]) => '<label class="field' + (kind === 'textarea' ? ' full' : '') + '"><span>' + esc(label) + (ovr.includes(f) ? ' · overridden' : '') + '</span>' + fieldInput('ed-' + f, kind, r[f]) + '</label>').join('') + '</div>',
      foot: '<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" id="ed-save">Save changes</button>',
      onMount(mod) {
        mod.querySelector('#ed-save').addEventListener('click', () => {
          const patch = {};
          for (const [f, , kind] of EDIT_FIELDS) {
            const v = readField(mod, 'ed-' + f, kind);
            if (v === undefined) continue;
            const cur = r[f] == null ? null : r[f];
            if (JSON.stringify(v) !== JSON.stringify(cur)) patch[f] = v;
          }
          if (patch.title === null) delete patch.title;
          if (!Object.keys(patch).length) { MC.app.closeModal(); MC.app.toast('No changes'); return; }
          let p;
          if (r.source === 'manual' && r.raw) {
            const top = {}; if ('title' in patch) top.title = patch.title;
            const opp = Object.assign({}, r.raw.opportunity || {}, patch); delete opp.title;
            if ('category' in patch) top.category = patch.category || 'My task';
            p = MC.state.updateManualTask(r.raw.id, Object.assign(top, { opportunity: opp }));
          } else p = MC.state.setOverride(key, patch);
          p.then(() => { MC.app.closeModal(); MC.app.toast('Saved ' + Object.keys(patch).length + ' field(s)'); }, fail);
        });
      },
    });
  });
  A('opp-add', () => {
    const fields = [['title', 'Title', 'text'], ['category', 'Stream', 'stream'], ['region', 'Region', 'region'], ['mode', 'Mode', 'mode'], ['status', 'Status', 'status'],
      ['deadline', 'Deadline (date only, leave blank if none announced)', 'date'], ['deadlineTime', 'Published deadline time (verbatim, with zone)', 'text'], ['url', 'Official URL', 'url'],
      ['cost', 'Cost (leave blank if unknown)', 'text'], ['funding', 'Funding / waiver', 'text'], ['amount', 'Amount', 'text'], ['eligibility', 'Eligibility', 'textarea'], ['why', 'Why it matters', 'textarea'], ['action', 'Next action', 'textarea'],
      ['fit', 'Research fit (0–100, optional)', 'num'], ['feasibility', 'Feasibility (0–100, optional)', 'num'], ['value', 'Value (0–100, optional)', 'num'], ['affordability', 'Affordability (0–100, blank = unknown)', 'num']];
    MC.app.modal({
      title: 'Add an opportunity', wide: true,
      body: '<p class="small muted">Saved as your own entry (not independently verified). Unscored entries stay Unranked; an unknown cost is never treated as free.</p><div class="form-grid">' +
        fields.map(([f, label, kind]) => '<label class="field' + (kind === 'textarea' ? ' full' : '') + '"><span>' + esc(label) + '</span>' + fieldInput('ad-' + f, kind, f === 'category' ? 'Funding' : f === 'status' ? 'Open' : f === 'region' ? 'UK' : null) + '</label>').join('') + '</div>',
      foot: '<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" id="ad-save">Add</button>',
      onMount(mod) {
        mod.querySelector('#ad-save').addEventListener('click', () => {
          const o = {};
          for (const [f, , kind] of fields) o[f] = readField(mod, 'ad-' + f, kind);
          if (!o.title) { MC.app.toast('A title is required.', { error: true }); return; }
          const category = STREAMS.includes(o.category) ? o.category : 'My task';
          const opportunity = { category, region: o.region, mode: o.mode, status: o.status || 'Open', deadline: o.deadline, deadlineTime: o.deadlineTime, url: o.url,
            cost: o.cost || 'Not published / not verified', funding: o.funding || 'Not confirmed', amount: o.amount, eligibility: o.eligibility || 'Your own entry; verify requirements',
            why: o.why, action: o.action, fit: o.fit, feasibility: o.feasibility, value: o.value, affordability: o.affordability, verified: null, created: F.today() };
          for (const k of Object.keys(opportunity)) if (opportunity[k] == null && !['fit', 'feasibility', 'value', 'affordability', 'deadline', 'verified'].includes(k)) delete opportunity[k];
          MC.state.addManualTask({ title: o.title, category, description: o.why || '', scheduleType: 'none', opportunity })
            .then((t) => { MC.app.closeModal(); MC.app.toast('Opportunity added'); MC.app.navigate(oppRoute('manual:' + t.id)); }, fail);
        });
      },
    });
  });
  A('opp-pub-add', () => {
    MC.app.modal({
      title: 'Add a manuscript',
      body: '<p class="small muted">Record only what you can evidence: the stage reached, the date it was reached and the evidence (for example a submission confirmation or decision letter). Leave the date blank if you do not have it — nothing is inferred.</p>' +
        '<div class="form-grid"><label class="field full"><span>Manuscript title</span><input type="text" id="pb-title"></label>' +
        '<label class="field"><span>Venue (journal / conference)</span><input type="text" id="pb-venue"></label>' +
        '<label class="field"><span>Stage</span><select id="pb-stage">' + PUB_STAGES.map((s) => '<option>' + esc(s) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Stage date (source-backed)</span><input type="date" id="pb-date"></label>' +
        '<label class="field full"><span>Evidence (text or https link)</span><input type="text" id="pb-evidence"></label></div>',
      foot: '<button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" id="pb-save">Add manuscript</button>',
      onMount(mod) {
        mod.querySelector('#pb-save').addEventListener('click', () => {
          const v = (id) => mod.querySelector('#' + id).value.trim();
          if (!v('pb-title')) { MC.app.toast('A title is required.', { error: true }); return; }
          if (!v('pb-evidence')) { MC.app.toast('Add the evidence for this stage.', { error: true }); return; }
          const stageDate = F.isDateOnly(v('pb-date')) ? v('pb-date') : null;
          MC.state.addManualTask({ title: v('pb-title'), category: 'Publication', description: 'Manuscript progress entry', scheduleType: 'none',
            stage: v('pb-stage'), stageDate, venue: v('pb-venue'), evidence: v('pb-evidence'), history: stageDate ? [{ stage: v('pb-stage'), date: stageDate, evidence: v('pb-evidence') }] : [] })
            .then(() => { MC.app.closeModal(); MC.app.toast('Manuscript added'); }, fail);
        });
      },
    });
  });
})();
