/* Calendar view (UI-B — owns site/js/views/calendar.js + site/css/views-cal.css).
   Monday-first Month / Week / Agenda modes plus an Overdue mode, all in Europe/London.
   Event types (distinct colours + legend):
     schedule — projected occurrences of source/snapshot schedules (today forward ONLY —
                projections never run into the past; many same-day occurrences of one item
                are grouped into one "×N" event);
     plan     — dashboard plans (schedule.origin === 'plan': manual tasks, planned overrides);
     deadline — opportunity deadlines (all-day, date-only — never an invented time) and
                one-off manual task dates;
     run      — actual run history from model.runs (London day of startedAt||finishedAt;
                failed/missed visibly marked);
     reminder — user reminders (model.reminders).
   Archived items and enabled===false schedules are excluded from projections and listed
   in the side pane instead (unknown date / paused / not placeable / DST gaps).
   All content is derived from ctx.model on every render; only view UI state (mode, anchor
   day, selected day, filters) is module-level. Interactions go through data-action +
   MC.actions.register (unique "cal-" names) at file load; no inline handlers, no eval,
   no remote assets; every interpolation is escaped via MC.sanitize. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;

  /* ---------- static config ---------- */
  const TYPES = {
    schedule: { label: 'Source schedule', short: 'Schedules', cls: 't-schedule', badge: 'blue' },
    plan: { label: 'Dashboard plan', short: 'Plans', cls: 't-plan', badge: 'purple' },
    deadline: { label: 'Deadline · task date', short: 'Deadlines', cls: 't-deadline', badge: 'red' },
    run: { label: 'Run history', short: 'Runs', cls: 't-run', badge: 'green' },
    reminder: { label: 'Reminder', short: 'Reminders', cls: 't-reminder', badge: 'amber' },
  };
  const MODES = [
    { id: 'month', label: 'Month' },
    { id: 'week', label: 'Week' },
    { id: 'agenda', label: 'Agenda' },
    { id: 'overdue', label: 'Overdue' },
  ];
  const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const AGENDA_DAYS = 90;
  const OVERDUE_STAGES = ['Interested', 'Maybe', 'Working on'];
  const SOURCE_LABEL = { mausbot: 'MausBot', chatgpt: 'ChatGPT snapshot', manual: 'Manual', radar: 'Research Radar', receipt: 'Receipt' };
  const RUN_BAD = { failed: 'Failed', missed: 'Missed', cancelled: 'Cancelled' };

  /* ---------- module-level UI state (never content) ---------- */
  const UI = {
    mode: 'month',
    anchor: null, // YYYY-MM-DD the visible range is built around
    selected: null, // day shown in the side pane
    types: { schedule: true, plan: true, deadline: true, run: true, reminder: true },
    source: 'all', agent: 'all', stage: 'all', status: 'all', category: 'all',
  };
  let EVT = [];     // events addressable by data-id in the current render (detail modals)
  let RAW = [];     // ungrouped, filtered events of the visible range (ICS export)
  let DAYMAP = new Map(); // date → grouped filtered events
  let GAPSCACHE = []; // DST gaps reported for the displayed range
  let tierNow = 'laptop';
  let truncNote = false; // a projection hit MC.schedule's 500-occurrence cap

  /* ---------- small helpers ---------- */
  const isTime = (t) => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t.trim());
  const padTime = (t) => { const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : null; };
  const anchorKey = () => UI.anchor || MC.fmt.today();
  const addMonths = (key, n) => {
    const d = new Date(key.slice(0, 8) + '01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
  };
  const byWhen = (a, b) => (a.date + ' ' + (a.time || '99:99')).localeCompare(b.date + ' ' + (b.time || '99:99')) || String(a.title).localeCompare(String(b.title));

  function rangeFor(mode, a) {
    if (mode === 'month') {
      const first = a.slice(0, 8) + '01';
      const s = MC.fmt.weekStart(first);
      return { from: s, to: MC.fmt.addDays(s, 41) };
    }
    if (mode === 'week') {
      const s = MC.fmt.weekStart(a);
      return { from: s, to: MC.fmt.addDays(s, 6) };
    }
    return { from: a, to: MC.fmt.addDays(a, AGENDA_DAYS - 1) };
  }
  function spanLabel(from, to) {
    if (from.slice(0, 4) !== to.slice(0, 4)) return MC.fmt.date(from) + ' – ' + MC.fmt.date(to);
    if (from.slice(0, 7) !== to.slice(0, 7)) return MC.fmt.dateShort(from) + ' – ' + MC.fmt.dateShort(to) + ' ' + to.slice(0, 4);
    return String(Number(from.slice(8, 10))) + '–' + MC.fmt.dateShort(to) + ' ' + to.slice(0, 4);
  }
  function rangeLabel(mode, a, from, to, today) {
    if (mode === 'month') return MC.fmt.monthLabel(a.slice(0, 8) + '01');
    if (mode === 'week') return spanLabel(from, to);
    if (mode === 'agenda') return 'Next ' + AGENDA_DAYS + ' days · ' + spanLabel(from, to);
    return 'As of ' + MC.fmt.date(today);
  }
  /** "Europe/London · GMT", "· BST", or both when the range spans a clock change. */
  function zoneBadge(from, to) {
    const a = MC.fmt.zoneAbbr(MC.fmt.londonInstant(from, '12:00'));
    const b = MC.fmt.zoneAbbr(MC.fmt.londonInstant(to, '12:00'));
    return 'Europe/London · ' + (a === b ? a : a + ' / ' + b);
  }
  /** Shared origin wording — must clearly separate a source schedule projection from a dashboard plan. */
  function originWording(s) {
    const base = MC.schedule.originLabel(s); // schedule.js wording, shown verbatim
    if (s && s.origin === 'plan') return 'Dashboard plan — ' + base;
    const snap = s && s.origin === 'snapshot' ? 'saved snapshot, unverified — ' : '';
    return 'Source schedule (projection, not a run) — ' + snap + base;
  }
  function agentLabelFor(m, e) {
    if (e.agentId && m.agentById[e.agentId]) return m.agentById[e.agentId].name;
    if (e.source === 'chatgpt') return 'ChatGPT snapshot';
    return 'Unassigned';
  }
  function opts(pairs, cur) {
    return pairs.map((p) => '<option value="' + A(p[0]) + '"' + (String(cur) === String(p[0]) ? ' selected' : '') + '>' + L(p[1]) + '</option>').join('');
  }
  function routeForKey(key) {
    if (!key) return null;
    if (key.indexOf('radar:') === 0 || key.indexOf('radar-report:') === 0 || key.indexOf('phd:') === 0) return 'opportunities/funding/' + encodeURIComponent(key);
    return 'workflows/' + encodeURIComponent(key);
  }

  /* ---------- event builders (all derived from ctx.model) ---------- */
  function mkItemEvent(it, type, date, time, instant) {
    const t = time && isTime(time) ? padTime(time) : null;
    return {
      id: 'item:' + it.key + '@' + date + (t ? 'T' + t : ''),
      type, title: it.title || 'Untitled', date,
      time: t, allDay: !t, instant: instant || null,
      source: it.source || 'unknown', agentId: it.agentId || null,
      status: it.status || '', stage: undefined, category: it.category || '',
      itemKey: it.key, item: it, schedule: it.schedule || null,
      desc: it.description || '',
    };
  }
  function mkOppEvent(op, date) {
    return {
      id: 'opp:' + op.key + '@' + date,
      type: 'deadline', title: op.title || 'Deadline', date,
      time: null, allDay: true, instant: null, // date-only: never invent a time
      source: op.source || 'radar', agentId: null,
      status: op.status || '', stage: op.stage || '', category: op.category || '',
      oppKey: op.key, opp: op,
      effStatus: MC.score.effectiveStatus(op),
      deadlineTime: op.deadlineTime || '',
      desc: 'Deadline is date-only; no exact time is published' +
        (op.deadlineTime ? ' — the source lists: ' + op.deadlineTime : '') + '.',
    };
  }

  /** Ungrouped raw events for [from..to] (London day keys) + DST gaps. */
  function buildRaw(m, from, to, today) {
    const raw = [], gaps = [];
    const projFrom = from > today ? from : today; // projections never run into the past
    for (const it of m.items || []) {
      if (it.archived) continue;
      if (MC.schedule.isPaused(it)) continue; // paused items are listed separately
      const s = it.schedule || {};
      const kind = s.kind || 'none';
      const onceDate = kind === 'once' ? (s.date || (s.at ? MC.fmt.dayKey(s.at) : null)) : null;
      if (kind === 'none' || kind === 'interval' || (kind === 'once' && !onceDate)) continue; // not placeable → side list
      if (it.source === 'manual' && kind === 'once') {
        // one-off manual task date → a dated "deadline · task date" event
        if (onceDate < from || onceDate > to) continue;
        const time = s.at ? MC.fmt.hm(s.at) : s.time;
        const instant = s.at ? s.at : (isTime(time) ? MC.fmt.londonInstant(onceDate, padTime(time)).toISOString() : null);
        raw.push(mkItemEvent(it, 'deadline', onceDate, time, instant));
        continue;
      }
      if (projFrom > to) continue; // wholly-past range → nothing to project
      const type = s.origin === 'plan' ? 'plan' : 'schedule';
      const occ = MC.schedule.occurrences(it, projFrom, to);
      for (const o of occ) raw.push(mkItemEvent(it, type, o.date, o.time, o.instant));
      for (const g of occ.gaps || []) if (g.date >= from && g.date <= to) gaps.push(Object.assign({ item: it }, g));
      if (occ.truncated) truncNote = true;
    }
    for (const r of m.runs || []) { // actual history — never a projection
      const stamp = r.startedAt || r.finishedAt;
      if (!stamp) continue;
      const date = MC.fmt.dayKey(stamp);
      if (!date || date < from || date > to) continue;
      raw.push({
        id: 'run:' + r.key + '@' + date,
        type: 'run', title: r.routineName || 'Run', date,
        time: MC.fmt.hm(stamp) || null, allDay: false, instant: stamp,
        source: r.source || 'receipt', agentId: r.agentId || null,
        status: r.status || 'completed', stage: undefined, category: undefined,
        runKey: r.key, run: r,
        failed: !!RUN_BAD[r.status],
        desc: 'Actual run (history, not a projection) · status ' + (r.status || 'unknown') +
          (r.trigger ? ' · trigger ' + r.trigger : '') +
          (r.scheduledFor ? ' · scheduled for ' + MC.fmt.dateTime(r.scheduledFor) : ''),
      });
    }
    for (const rem of m.reminders || []) {
      if (!rem || !rem.date) continue;
      const date = MC.fmt.dayKey(rem.date);
      if (!date || date < from || date > to) continue;
      const time = isTime(rem.time) ? padTime(rem.time) : null;
      raw.push({
        id: 'rem:' + rem.id,
        type: 'reminder', title: rem.title || 'Reminder', date,
        time, allDay: !time, instant: time ? MC.fmt.londonInstant(date, time).toISOString() : null,
        source: 'manual', agentId: null, status: undefined, stage: undefined, category: undefined,
        reminderId: rem.id, reminder: rem, linkedKey: rem.key || null,
        desc: 'Reminder added in Mission Control.',
      });
    }
    for (const op of m.opportunities || []) {
      if (op.archived || !op.deadline) continue;
      const date = MC.fmt.dayKey(op.deadline);
      if (!date || date < from || date > to) continue;
      raw.push(mkOppEvent(op, date));
    }
    raw.sort(byWhen);
    return { raw, gaps };
  }

  /* ---------- filters ---------- */
  function pass(e) {
    if (!UI.types[e.type]) return false;
    if (UI.source !== 'all' && (e.source || 'none') !== UI.source) return false;
    if (UI.agent !== 'all' && (e.agentId || '') !== UI.agent) return false;
    if (UI.stage !== 'all' && e.stage !== undefined && (e.stage || '') !== UI.stage) return false;
    if (UI.status !== 'all' && e.status !== undefined && (e.status || '') !== UI.status) return false;
    if (UI.category !== 'all' && e.category !== undefined && (e.category || '') !== UI.category) return false;
    return true;
  }
  /** Overdue rows ignore the type toggles (the mode is the filter); other filters apply. */
  function overduePass(e) {
    if (UI.source !== 'all' && (e.source || 'none') !== UI.source) return false;
    if (UI.agent !== 'all' && (e.agentId || '') !== UI.agent) return false;
    if (UI.stage !== 'all' && (e.stage || '') !== UI.stage) return false;
    if (UI.status !== 'all' && (e.status || '') !== UI.status) return false;
    if (UI.category !== 'all' && (e.category || '') !== UI.category) return false;
    return true;
  }

  /** Group many same-day occurrences of one item into one ×N event (schedule/plan only). */
  function groupEvents(raw) {
    const out = [];
    const idx = new Map();
    for (const e of raw) {
      if ((e.type === 'schedule' || e.type === 'plan') && e.itemKey) {
        const k = e.itemKey + '@' + e.date;
        const g = idx.get(k);
        if (g) {
          g.count += 1;
          if (e.time) g.times.push(e.time);
          if (!g.instant && e.instant) g.instant = e.instant;
        } else {
          const c = Object.assign({}, e, { id: 'grp:' + e.itemKey + '@' + e.date, count: 1, times: e.time ? [e.time] : [] });
          idx.set(k, c);
          out.push(c);
        }
      } else out.push(e);
    }
    out.sort(byWhen);
    return out;
  }
  function byDay(events) {
    const map = new Map();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return map;
  }

  /* ---------- overdue (exact work-order rules) ---------- */
  function overdueEntries(m, today) {
    const out = [];
    for (const it of m.items || []) { // manual tasks with a past date, not completed, not archived
      if (it.archived || it.source !== 'manual') continue;
      const dk = it.deadline ? MC.fmt.dayKey(it.deadline) : (it.schedule && it.schedule.kind === 'once' && it.schedule.date ? it.schedule.date : null);
      if (!dk || dk >= today) continue;
      if ((it.status || '') === 'completed') continue;
      const e = mkItemEvent(it, 'deadline', dk, it.schedule && it.schedule.time, null);
      e.id = 'od:task:' + it.key;
      out.push({ date: dk, e });
    }
    for (const op of m.opportunities || []) { // personal stages only, past deadline, not archived
      if (op.archived || !op.deadline) continue;
      if (OVERDUE_STAGES.indexOf(op.stage || '') < 0) continue;
      const dk = MC.fmt.dayKey(op.deadline);
      if (!dk || dk >= today) continue;
      const e = mkOppEvent(op, dk);
      e.id = 'od:opp:' + op.key;
      out.push({ date: dk, e });
    }
    out.sort((a, b) => a.date.localeCompare(b.date)); // longest overdue first
    return out;
  }

  /* ---------- HTML: shared fragments ---------- */
  function cellTitle(e) {
    const tm = e.allDay ? '' : (e.time || '') + ' ';
    return tm + (e.failed ? '✕ ' : '') + (e.title || 'Untitled') + (e.count > 1 ? ' ×' + e.count : '');
  }
  function eventBtn(e, extraCls) {
    const t = TYPES[e.type];
    return '<button class="cal-event ' + t.cls + (e.failed ? ' ev-failed' : '') + (extraCls ? ' ' + extraCls : '') +
      '" data-action="cal-event" data-id="' + A(e.id) + '" title="' + A(cellTitle(e)) + '">' + L(cellTitle(e)) + '</button>';
  }
  function rowBadges(e) {
    const b = [];
    if (e.failed) b.push('<span class="badge red">' + L(RUN_BAD[e.status] || 'Failed') + '</span>');
    if (e.count > 1) b.push('<span class="badge">×' + e.count + '</span>');
    if (e.type === 'run' && !e.failed && e.status) b.push('<span class="badge green">' + L(e.status) + '</span>');
    if (e.effStatus && e.status && e.effStatus !== e.status) b.push('<span class="badge dark">' + L(e.status) + ' → ' + L(e.effStatus) + '</span>');
    else if (e.effStatus && !e.status) b.push('<span class="badge">' + L(e.effStatus) + '</span>');
    b.push('<span class="badge">' + L(TYPES[e.type].label) + '</span>');
    return '<span class="cal-row-meta">' + b.join('') + '</span>';
  }
  function rowEvent(e) {
    return '<button class="cal-row ' + TYPES[e.type].cls + (e.failed ? ' ev-failed' : '') +
      '" data-action="cal-event" data-id="' + A(e.id) + '">' +
      '<span class="tm">' + (e.allDay ? 'All day' : L(e.time || '')) + '</span>' +
      '<span class="tt">' + L(e.title) + (e.count > 1 ? ' <b>×' + e.count + '</b>' : '') + '</span>' +
      rowBadges(e) + '</button>';
  }
  function dayListHtml(evs) {
    return evs.length ? evs.map(rowEvent).join('') : '<p class="small muted" style="margin:4px 0">No events for the current filters.</p>';
  }

  /* ---------- HTML: month / week grid ---------- */
  function gridHtml(map, from, days, today, perCell, otherMonth) {
    let cells = DOWS.map((d) => '<div class="cal-dow" aria-hidden="true">' + d + '</div>').join('');
    for (let i = 0; i < days; i++) {
      const date = MC.fmt.addDays(from, i);
      const evs = map.get(date) || [];
      const shown = evs.slice(0, perCell);
      const more = evs.length - shown.length;
      const cls = 'cal-cell' + (otherMonth && date.slice(0, 7) !== otherMonth ? ' other' : '') + (date === today ? ' today' : '');
      const label = MC.fmt.date(date) + (evs.length ? ' · ' + MC.fmt.plural(evs.length, 'event') : '') + ' — open day';
      cells += '<div class="' + cls + '" role="button" tabindex="0" data-action="cal-day" data-date="' + A(date) + '" aria-label="' + A(label) + '">' +
        '<span class="num">' + Number(date.slice(8, 10)) + '</span>' +
        '<span class="evs">' + shown.map((e) => eventBtn(e)).join('') +
        (more > 0 ? '<button class="cal-more" data-action="cal-day" data-date="' + A(date) + '" title="Show all events for ' + A(MC.fmt.date(date)) + '">+' + more + ' more</button>' : '') +
        '</span></div>';
    }
    return '<div class="cal-grid' + (days === 7 ? ' cal-week' : '') + '">' + cells + '</div>';
  }

  /* ---------- HTML: mobile week strip + selected-day list ---------- */
  function weekStripHtml(rg, today) {
    let sel = UI.selected;
    if (!sel || sel < rg.from || sel > rg.to) sel = anchorKey() < rg.from || anchorKey() > rg.to ? rg.from : anchorKey();
    let btns = '';
    for (let i = 0; i < 7; i++) {
      const date = MC.fmt.addDays(rg.from, i);
      const n = (DAYMAP.get(date) || []).length;
      btns += '<button data-action="cal-strip" data-date="' + A(date) + '"' + (date === sel ? ' class="active"' : '') +
        ' aria-label="' + A(MC.fmt.date(date) + ', show day') + '"' + (date === today ? ' aria-current="date"' : '') + '>' +
        '<span class="dow">' + DOWS[i] + '</span><b>' + Number(date.slice(8, 10)) + '</b>' +
        (n ? '<span class="ct">' + n + '</span>' : '<span class="ct none">·</span>') + '</button>';
    }
    return '<div class="cal-strip" role="tablist" aria-label="Days of the week">' + btns + '</div>' +
      '<section class="agenda-day" style="margin-top:14px"><div class="agenda-date">' + L(MC.fmt.weekday(sel) + ' · ' + MC.fmt.date(sel)) + (sel === today ? ' — today' : '') + '</div>' +
      dayListHtml(DAYMAP.get(sel) || []) +
      '<button class="btn" data-action="cal-day" data-date="' + A(sel) + '">' + MC.icon('plus') + 'Add on this day</button></section>';
  }

  /* ---------- HTML: agenda list ---------- */
  function agendaHtml(map, from, to, today) {
    const days = [];
    for (let d = from; d <= to; d = MC.fmt.addDays(d, 1)) {
      const evs = map.get(d);
      if (evs && evs.length) days.push([d, evs]);
    }
    if (!days.length) return '<div class="empty-state">No events in this window for the current filters.</div>';
    return '<div class="cal-list">' + days.map((p) =>
      '<section class="agenda-day"><button class="agenda-date cal-date-btn" data-action="cal-day" data-date="' + A(p[0]) + '" title="Open this day">' +
      L(MC.fmt.weekday(p[0]) + ' · ' + MC.fmt.date(p[0])) + (p[0] === today ? ' — today' : '') + '</button>' +
      p[1].map(rowEvent).join('') + '</section>').join('') + '</div>';
  }

  /* ---------- HTML: overdue list ---------- */
  function overdueHtml(entries, today) {
    const head = '<div class="notice info">Overdue lists manual tasks (added in Mission Control) whose date is past and that are not completed, ' +
      'and opportunities at your stages Interested / Maybe / Working on whose deadline has passed. Event-type toggles do not apply here; the source, agent, stage, status and category filters do. ' +
      'ICS export in this mode covers the next ' + AGENDA_DAYS + ' days.</div>';
    if (!entries.length) return head + '<div class="empty-state">Nothing is overdue as of ' + L(MC.fmt.date(today)) + '.</div>';
    return head + '<div class="cal-list">' + entries.map((en) => {
      const e = en.e;
      const ago = MC.fmt.daysUntil(en.date);
      return '<button class="cal-row ' + TYPES[e.type].cls + '" data-action="cal-event" data-id="' + A(e.id) + '">' +
        '<span class="tm">' + (e.allDay ? 'All day' : L(e.time || '')) + '</span>' +
        '<span class="tt">' + L(e.title) + '</span>' +
        '<span class="cal-row-meta"><span class="badge red">' + L(MC.fmt.dateShort(en.date)) + ' · ' + Math.abs(ago) + ' day' + (Math.abs(ago) === 1 ? '' : 's') + ' ago</span>' +
        (e.stage ? '<span class="badge">' + L(e.stage) + '</span>' : '') +
        (e.status ? '<span class="badge">' + L(e.status) + '</span>' : '') +
        '<span class="badge">' + L(SOURCE_LABEL[e.source] || e.source) + '</span>' +
        '<span class="badge">' + L(TYPES[e.type].label) + '</span></span></button>';
    }).join('') + '</div>';
  }

  /* ---------- HTML: toolbar, legend, filters ---------- */
  function topHtml() {
    const od = UI.mode === 'overdue';
    return '<div class="toolbar cal-top">' +
      '<div class="seg" role="tablist" aria-label="Calendar mode">' + MODES.map((mo) =>
        '<button role="tab" data-action="cal-mode" data-mode="' + mo.id + '"' + (UI.mode === mo.id ? ' aria-selected="true"' : ' aria-selected="false"') + '>' + L(mo.label) + '</button>').join('') + '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn" data-action="cal-today" title="Back to today">Today</button>' +
      '<button class="icon-btn" data-action="cal-prev" aria-label="Previous"' + (od ? ' disabled' : '') + '>' + MC.icon('chevron-left') + '</button>' +
      '<button class="icon-btn" data-action="cal-next" aria-label="Next"' + (od ? ' disabled' : '') + '>' + MC.icon('chevron-right') + '</button>' +
      '<span class="cal-jump"><input type="date" data-action="cal-jump" value="' + A(anchorKey()) + '"' + (od ? ' disabled' : '') + ' aria-label="Jump to date"></span>' +
      '<button class="btn primary" data-action="cal-ics" title="Export the filtered events of the visible range">' + MC.icon('download') + 'Export ICS</button>' +
      '</div>';
  }
  function legendHtml(counts) {
    return '<div class="cal-legend" aria-hidden="true">' + Object.keys(TYPES).map((k) =>
      '<span class="lg' + (UI.types[k] ? '' : ' off') + '"><i class="lg-dot lg-' + k + '"></i>' + L(TYPES[k].label) +
      '<b>' + (counts[k] || 0) + '</b></span>').join('') + '</div>';
  }
  function typesSegHtml() {
    return '<div class="seg cal-types" aria-label="Show or hide event types">' + Object.keys(TYPES).map((k) =>
      '<button data-action="cal-f-type" data-type="' + k + '" aria-pressed="' + (UI.types[k] ? 'true' : 'false') + '"' + (UI.types[k] ? ' class="active"' : '') + ' title="' + A(TYPES[k].label) + '">' + L(TYPES[k].short) + '</button>').join('') + '</div>';
  }
  function filtersHtml(m) {
    const cats = [];
    const seen = {};
    for (const it of m.items || []) if (it.category && !seen[it.category]) { seen[it.category] = 1; cats.push(it.category); }
    for (const op of m.opportunities || []) if (op.category && !seen[op.category]) { seen[op.category] = 1; cats.push(op.category); }
    cats.sort();
    const statuses = ['queued', 'working', 'review', 'completed', 'failed', 'missed', 'cancelled'];
    return '<div class="cal-filters toolbar">' +
      '<div class="field"><span>Source</span><select data-action="cal-f-source" aria-label="Filter by source">' +
        opts([['all', 'All sources'], ['mausbot', 'MausBot'], ['chatgpt', 'ChatGPT snapshot'], ['manual', 'Manual'], ['radar', 'Research Radar'], ['receipt', 'Receipt']], UI.source) + '</select></div>' +
      '<div class="field"><span>Agent</span><select data-action="cal-f-agent" aria-label="Filter by agent">' +
        '<option value="all"' + (UI.agent === 'all' ? ' selected' : '') + '>All agents</option>' +
        '<option value=""' + (UI.agent === '' ? ' selected' : '') + '>Unassigned / snapshot</option>' +
        (m.agents || []).map((a) => '<option value="' + A(a.id) + '"' + (UI.agent === a.id ? ' selected' : '') + '>' + L(a.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span>Stage</span><select data-action="cal-f-stage" aria-label="Filter by opportunity stage">' +
        opts([['all', 'All stages']].concat(MC.state.RADAR_STAGES.map((s) => [s, s])), UI.stage) + '</select></div>' +
      '<div class="field"><span>Status</span><select data-action="cal-f-status" aria-label="Filter by status">' +
        opts([['all', 'All statuses']].concat(statuses.map((s) => [s, MC.state.STATUS_LABEL[s] || s])), UI.status) + '</select></div>' +
      '<div class="field"><span>Category</span><select data-action="cal-f-category" aria-label="Filter by category">' +
        opts([['all', 'All categories']].concat(cats.map((c) => [c, c])), UI.category) + '</select></div>' +
      '<button class="btn ghost" data-action="cal-f-clear" title="Reset all filters">Reset</button>' +
      '</div>';
  }

  /* ---------- HTML: side pane ---------- */
  function sidePanel(title, count, body) {
    return '<div class="panel"><div class="panel-head"><h2 class="panel-title">' + L(title) + '</h2>' +
      (count != null ? '<span class="badge">' + count + '</span>' : '') + '</div>' +
      '<div class="section-pad cal-side-body">' + body + '</div></div>';
  }
  function sideRow(rec, route, why, badgeText) {
    return '<button class="cal-side-item" data-action="route" data-route="' + A(route) + '" title="Open the record">' +
      '<span class="tt">' + L(rec.title || 'Untitled') + '</span>' +
      '<span class="why">' + L(why) + '</span>' +
      (badgeText ? '<span class="badge">' + L(badgeText) + '</span>' : '') + '</button>';
  }
  function sideListsHtml(m, gaps) {
    // Selected day
    const sel = UI.selected || MC.fmt.today();
    const selPanel = sidePanel('Selected day', null,
      '<div class="agenda-day"><div class="agenda-date">' + L(MC.fmt.weekday(sel) + ' · ' + MC.fmt.date(sel)) + (sel === MC.fmt.today() ? ' — today' : '') + '</div>' +
      dayListHtml(DAYMAP.get(sel) || []) +
      '<button class="btn" data-action="cal-day" data-date="' + A(sel) + '">' + MC.icon('plus') + 'Add on this day</button></div>');
    // Unknown date: opportunities without a deadline + unscheduled items — never placed on a day
    const unknown = [];
    for (const op of m.opportunities || []) {
      if (op.archived || op.deadline) continue;
      unknown.push(sideRow(op, 'opportunities/funding/' + encodeURIComponent(op.key),
        op.openingNote ? String(op.openingNote) : 'No deadline published yet.', op.stage || 'New'));
    }
    for (const it of m.items || []) {
      if (it.archived) continue;
      const s = it.schedule || {};
      const kind = s.kind || 'none';
      const unscheduled = kind === 'none' || (kind === 'once' && !s.at && !s.date);
      if (!unscheduled) continue;
      unknown.push(sideRow(it, 'workflows/' + encodeURIComponent(it.key), 'Not scheduled yet.', it.category || ''));
    }
    const unknownPanel = sidePanel('Unknown date', unknown.length,
      unknown.length ? '<div class="cal-side-list">' + unknown.join('') + '</div>' : '<p class="small muted">Everything in view has a date.</p>');
    // Paused schedules
    const paused = (m.items || []).filter((it) => !it.archived && MC.schedule.isPaused(it)).map((it) =>
      sideRow(it, 'workflows/' + encodeURIComponent(it.key),
        (it.schedule && it.schedule.label) || 'Schedule paused — excluded from projections.', SOURCE_LABEL[it.source] || it.source));
    const pausedPanel = sidePanel('Paused schedules', paused.length,
      paused.length ? '<div class="cal-side-list">' + paused.join('') + '</div>' : '<p class="small muted">No paused schedules.</p>');
    // Not calendar-placeable (interval and similar, still enabled)
    const unplaceable = (m.items || []).filter((it) => !it.archived && !MC.schedule.isPaused(it) && MC.schedule.isUnplaceable(it)).map((it) =>
      sideRow(it, 'workflows/' + encodeURIComponent(it.key),
        (it.schedule && it.schedule.kind === 'interval') ? 'Interval schedule — runs every N minutes; no fixed calendar slot.' : 'No calendar slot.', SOURCE_LABEL[it.source] || it.source));
    const unplaceablePanel = sidePanel('Not calendar-placeable', unplaceable.length,
      unplaceable.length ? '<div class="cal-side-list">' + unplaceable.join('') + '</div>' : '<p class="small muted">Nothing interval-based right now.</p>');
    // DST gaps reported by MC.schedule.occurrences().gaps
    const gapsPanel = gaps.length ? sidePanel('DST gaps', gaps.length,
      '<div class="cal-side-list">' + gaps.map((g) =>
        '<div class="cal-gap"><b>' + L(MC.fmt.date(g.date)) + ' ' + L(g.time || '') + '</b><span>' + L(g.item ? g.item.title + ' — ' : '') + L(g.reason || 'Skipped by the clock change.') + '</span></div>').join('') + '</div>') : '';
    return selPanel + unknownPanel + pausedPanel + unplaceablePanel + gapsPanel;
  }

  /* ---------- render ---------- */
  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    const today = MC.fmt.today();
    tierNow = ctx.tier || MC.tier();
    if (!UI.anchor) UI.anchor = today;
    if (!UI.selected) UI.selected = today;
    const a = anchorKey();
    const rg = rangeFor(UI.mode, a);
    const od = UI.mode === 'overdue';
    truncNote = false;

    let lookup = [], dispMap, mainHtml, counts, nShown;
    if (od) {
      // Display: the overdue rules. ICS in this mode: the next 90 days (filtered).
      const win = buildRaw(m, today, MC.fmt.addDays(today, AGENDA_DAYS - 1), today);
      RAW = win.raw.filter(pass);
      dispMap = byDay(groupEvents(RAW));
      const odEntries = overdueEntries(m, today).filter((en) => overduePass(en.e));
      lookup = groupEvents(RAW).concat(odEntries.map((en) => en.e));
      mainHtml = overdueHtml(odEntries, today);
      counts = countBy(win.raw);
      nShown = odEntries.length;
      GAPSCACHE = win.gaps;
    } else {
      const built = buildRaw(m, rg.from, rg.to, today);
      RAW = built.raw.filter(pass);
      const grouped = groupEvents(RAW);
      dispMap = byDay(grouped);
      lookup = grouped;
      mainHtml = UI.mode === 'month'
        ? gridHtml(dispMap, rg.from, 42, today, tierNow === 'monitor' ? 4 : 3, a.slice(0, 7))
        : UI.mode === 'week'
          ? (tierNow === 'mobile' ? weekStripHtml(rg, today) : gridHtml(dispMap, rg.from, 7, today, 6, null))
          : agendaHtml(dispMap, rg.from, rg.to, today);
      counts = countBy(built.raw);
      nShown = lookup.length; // displayed (same-day occurrences already grouped ×N)
      GAPSCACHE = built.gaps;
    }
    EVT = lookup;
    DAYMAP = dispMap;

    const zone = zoneBadge(rg.from, rg.to);
    const icsNote = od ? 'ICS: next ' + AGENDA_DAYS + ' days' : 'ICS: ' + spanLabel(rg.from, rg.to);

    ctx.setTitle('Calendar', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    el.innerHTML = '<div class="view-inner">' +
      topHtml() +
      '<div class="panel"><div class="panel-head">' +
        '<div><p class="panel-kicker">Calendar · Europe/London · Monday-first</p><h2 class="panel-title">' + L(rangeLabel(UI.mode, a, rg.from, rg.to, today)) + '</h2></div>' +
        '<div class="panel-actions"><span class="badge" title="All times are London time; both abbreviations are shown when the range crosses a GMT/BST change">' + L(zone) + '</span>' +
        '<span class="badge">' + nShown + ' shown</span>' +
        '<span class="badge" title="Range covered by the ICS export">' + L(icsNote) + '</span></div>' +
      '</div><div class="section-pad cal-body">' +
        '<div class="cal-legend-row">' + typesSegHtml() + legendHtml(counts) + '</div>' +
        filtersHtml(m) +
        (truncNote ? '<div class="notice">Very dense schedules were capped at ' + MC.schedule.CAP + ' projected occurrences per item (MC.schedule limit) — later occurrences in long windows may be missing.</div>' : '') +
      '</div></div>' +
      '<div class="cal-split"><section class="panel cal-main-panel" aria-label="Calendar">' +
        '<div class="section-pad">' + mainHtml + '</div>' +
      '</section>' +
      '<aside class="stack cal-side" aria-label="Calendar side lists">' + sideListsHtml(m, GAPSCACHE) + '</aside></div>' +
      '</div>';
  }
  function countBy(raw) {
    const c = { schedule: 0, plan: 0, deadline: 0, run: 0, reminder: 0 };
    for (const e of raw) if (c[e.type] != null) c[e.type] += 1;
    return c;
  }

  /* ---------- modals ---------- */
  function fieldRow(label, valueHtml) {
    return '<div class="cal-field"><span>' + L(label) + '</span><span>' + valueHtml + '</span></div>';
  }
  function openDetail(e) {
    const m = MC.state.get();
    const t = TYPES[e.type];
    const zone = e.instant ? MC.fmt.zoneAbbr(e.instant) : MC.fmt.zoneAbbr(MC.fmt.londonInstant(e.date, '12:00'));
    const when = e.instant
      ? MC.fmt.dateTime(e.instant) + (e.allDay ? ' · all day' : '')
      : MC.fmt.date(e.date) + ' (date only · ' + zone + ')';
    const whenExtra = e.count > 1
      ? ' <span class="small muted">Grouped: ' + e.count + ' occurrences this day at ' + L((e.times || []).join(', ')) + '.</span>'
      : (e.allDay && e.type === 'deadline' && !e.oppKey ? ' <span class="small muted">Date only — the task carries no time.</span>' : '');
    let scheduleRow = '';
    if (e.schedule && (e.itemKey || e.type === 'schedule' || e.type === 'plan')) {
      const s = e.schedule;
      scheduleRow = fieldRow('Schedule', L(s.label || MC.state.scheduleLabel(s)) +
        '<br><span class="small ' + (s.origin === 'plan' ? 'cal-plan-word' : 'cal-source-word') + '">' + L(originWording(s)) + '</span>' +
        (s.tzNote ? '<br><span class="small subtle">' + L(s.tzNote) + '</span>' : '') +
        (s.timeZone && s.kind === 'cron' ? '<br><span class="small subtle">Native cron zone: ' + L(s.timeZone) + '</span>' : ''));
    }
    let statusRow = '';
    if (e.type === 'run' && e.run) {
      statusRow = fieldRow('Run status', '<span class="badge ' + (e.failed ? 'red' : 'green') + '">' + L(e.run.status) + '</span>' +
        (e.failed ? ' <span class="small">Failed and missed runs are actual history — the failure is visible, never hidden.</span>' : ''));
    } else if (e.opp) {
      statusRow = fieldRow('Status', L(e.opp.status || '—') +
        (e.effStatus && e.effStatus !== e.opp.status ? ' <span class="small muted">→ effectively ' + L(e.effStatus) + ' (deadline passed)</span>' : ''));
    } else if (e.item && e.status) {
      statusRow = fieldRow('Status', L(MC.state.STATUS_LABEL[e.status] || e.status));
    }
    let srcRow = fieldRow('Source', L(SOURCE_LABEL[e.source] || e.source || 'Unknown') +
      (e.item && e.item.sourceRef ? '<br><span class="small subtle">' + L(e.item.sourceRef) + '</span>' : '') +
      (e.reminder ? '<br><span class="small subtle">Added ' + L(MC.fmt.dateTime(e.reminder.at)) + '</span>' : ''));
    const agentRow = fieldRow('Agent', L(agentLabelFor(m, e)));
    const stageRow = e.opp ? fieldRow('Stage', L(e.opp.stage || 'New') + (e.opp.evidence ? ' <span class="small subtle">' + L(e.opp.evidence) + '</span>' : '')) : '';
    const catRow = e.category ? fieldRow('Category', L(e.category)) : '';
    const dlRow = e.opp && e.deadlineTime ? fieldRow('Published time', '“' + L(e.deadlineTime) + '” <span class="small subtle">(shown verbatim — the calendar never invents a time)</span>') : '';
    const descRow = e.desc ? fieldRow('Notes', '<span class="small">' + L(String(e.desc).slice(0, 400)) + '</span>') : '';

    // Link back to the record
    let linkBtn = '';
    if (e.itemKey) linkBtn = '<button class="btn primary" data-action="route" data-route="workflows/' + A(encodeURIComponent(e.itemKey)) + '">Open in Workflows</button>';
    else if (e.oppKey) linkBtn = '<button class="btn primary" data-action="route" data-route="opportunities/funding/' + A(encodeURIComponent(e.oppKey)) + '">Open in Opportunities</button>';
    else if (e.runKey) linkBtn = '<button class="btn primary" data-action="route" data-route="results/' + A(encodeURIComponent(e.runKey)) + '">Open in Results</button>';
    else if (e.linkedKey) {
      const r = routeForKey(e.linkedKey);
      const exists = MC.state.item(e.linkedKey);
      if (r && exists) linkBtn = '<button class="btn" data-action="route" data-route="' + A(r) + '">Open linked record</button>';
    }
    const remBtn = e.reminder ? '<button class="btn danger" data-action="cal-reminder-remove" data-id="' + A(e.reminderId) + '">Remove reminder</button>' : '';

    MC.app.modal({
      title: t.label + ' · ' + MC.fmt.dateShort(e.date),
      body: '<div class="row wrap">' + '<span class="badge ' + t.badge + '">' + L(t.label) + '</span>' +
        (e.failed ? '<span class="badge red">' + L(RUN_BAD[e.status] || 'Failed') + '</span>' : '') +
        (e.count > 1 ? '<span class="badge">×' + e.count + ' same-day occurrences</span>' : '') +
        '<span class="badge">' + L(zone) + '</span>' + '</div>' +
        '<h3 class="cal-detail-title">' + L(e.title) + '</h3>' +
        fieldRow('When', L(when) + whenExtra) + scheduleRow + srcRow + agentRow + statusRow + stageRow + catRow + dlRow + descRow,
      foot: remBtn + linkBtn + '<button class="btn" data-action="close-modal">Close</button>',
    });
  }
  function openDayModal(date) {
    const evs = DAYMAP.get(date) || [];
    MC.app.modal({
      title: 'Day · ' + MC.fmt.date(date),
      wide: true,
      body: '<div class="cal-day-list">' + (evs.length ? evs.map(rowEvent).join('') : '<div class="empty-state">No events on this day for the current filters.</div>') + '</div>' +
        '<div class="separator"></div>' +
        '<div class="cal-addforms">' +
          '<div class="cal-addform"><p class="panel-kicker">Add reminder</p>' +
            '<label class="field"><span>Title</span><input type="text" id="cal-rem-title" maxlength="300" placeholder="e.g. Check the form"></label>' +
            '<label class="field"><span>Time (optional, Europe/London)</span><input type="time" id="cal-rem-time"></label>' +
            '<button type="button" class="btn primary" data-action="cal-add-reminder" data-date="' + A(date) + '">' + MC.icon('bell') + 'Add reminder</button>' +
            '<p class="small subtle">Reminders live in your user lane — feeds never overwrite them.</p></div>' +
          '<div class="cal-addform"><p class="panel-kicker">Add task on this date</p>' +
            '<label class="field"><span>Title</span><input type="text" id="cal-task-title" maxlength="300" placeholder="e.g. Draft the summary"></label>' +
            '<label class="field"><span>Time (optional, Europe/London)</span><input type="time" id="cal-task-time"></label>' +
            '<button type="button" class="btn primary" data-action="cal-add-task" data-date="' + A(date) + '">' + MC.icon('plus') + 'Add task</button>' +
            '<p class="small subtle">Creates a one-off manual task (a dashboard plan) dated ' + L(MC.fmt.date(date)) + '.</p></div>' +
        '</div>',
      foot: '<button class="btn" data-action="close-modal">Close</button>',
    });
  }

  /* ---------- ICS export ---------- */
  function toIcs(e) {
    const m = MC.state.get();
    const ev = {
      key: e.itemKey || e.oppKey || e.runKey || e.reminderId || e.id,
      title: e.title, date: e.date, time: e.time, allDay: !!e.allDay,
      type: e.type, typeLabel: TYPES[e.type].label,
      source: e.source || 'unknown', agent: agentLabelFor(m, e),
      description: e.desc || '',
    };
    if (e.schedule) ev.origin = originWording(e.schedule);
    if (e.deadlineTime) ev.deadlineTime = e.deadlineTime;
    if (e.type === 'run' && e.run && e.run.startedAt && e.run.finishedAt) {
      const mins = Math.round((Date.parse(e.run.finishedAt) - Date.parse(e.run.startedAt)) / 60000);
      if (mins > 0) ev.durationMin = mins;
    }
    return ev;
  }

  /* ---------- actions (registered once, at file load; unique cal- names) ---------- */
  const onChangeOnly = (fn) => (el, ev) => { if (ev && ev.type && ev.type !== 'change') return; fn(el); };

  MC.actions.register('cal-mode', (el) => { UI.mode = el.getAttribute('data-mode') || 'month'; MC.app.render(); });
  MC.actions.register('cal-today', () => {
    UI.anchor = MC.fmt.today(); UI.selected = UI.anchor;
    if (UI.mode === 'overdue') UI.mode = 'month';
    MC.app.render();
  });
  MC.actions.register('cal-prev', () => step(-1));
  MC.actions.register('cal-next', () => step(1));
  function step(n) {
    const a = anchorKey();
    UI.anchor = UI.mode === 'month' ? addMonths(a, n)
      : UI.mode === 'week' ? MC.fmt.addDays(a, 7 * n)
      : MC.fmt.addDays(a, AGENDA_DAYS * n);
    const rg = rangeFor(UI.mode, UI.anchor);
    if (UI.selected < rg.from || UI.selected > rg.to) UI.selected = UI.anchor;
    MC.app.render();
  }
  MC.actions.register('cal-jump', onChangeOnly((el) => {
    const v = el.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return;
    UI.anchor = v; UI.selected = v;
    MC.app.render();
  }));
  MC.actions.register('cal-strip', (el) => { UI.selected = el.getAttribute('data-date'); MC.app.render(); });
  MC.actions.register('cal-day', (el) => {
    const date = el.getAttribute('data-date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
    UI.selected = date;
    MC.app.render(); // re-render so the side pane follows, then open the day sheet
    openDayModal(date);
  });
  MC.actions.register('cal-event', (el) => {
    const id = el.getAttribute('data-id');
    const e = EVT.find((x) => x.id === id);
    if (!e) { MC.app.toast('That event is no longer in view — the calendar was recalculated.', { error: true }); MC.app.render(); return; }
    openDetail(e);
  });
  MC.actions.register('cal-f-type', (el) => {
    const k = el.getAttribute('data-type');
    if (k in UI.types) UI.types[k] = !UI.types[k];
    MC.app.render();
  });
  MC.actions.register('cal-f-source', onChangeOnly((el) => { UI.source = el.value; MC.app.render(); }));
  MC.actions.register('cal-f-agent', onChangeOnly((el) => { UI.agent = el.value; MC.app.render(); }));
  MC.actions.register('cal-f-stage', onChangeOnly((el) => { UI.stage = el.value; MC.app.render(); }));
  MC.actions.register('cal-f-status', onChangeOnly((el) => { UI.status = el.value; MC.app.render(); }));
  MC.actions.register('cal-f-category', onChangeOnly((el) => { UI.category = el.value; MC.app.render(); }));
  MC.actions.register('cal-f-clear', () => {
    UI.types = { schedule: true, plan: true, deadline: true, run: true, reminder: true };
    UI.source = 'all'; UI.agent = 'all'; UI.stage = 'all'; UI.status = 'all'; UI.category = 'all';
    MC.app.render();
  });
  MC.actions.register('cal-ics', () => {
    let events;
    if (UI.mode === 'overdue') {
      const t = MC.fmt.today();
      events = buildRaw(MC.state.get(), t, MC.fmt.addDays(t, AGENDA_DAYS - 1), t).raw.filter(pass);
    } else events = RAW;
    if (!events.length) { MC.app.toast('No events in the visible range match the filters — nothing exported.', { error: true }); return; }
    const res = MC.ics.download(events.map(toIcs), { name: 'Mission Control calendar' });
    MC.app.toast('Exported ' + MC.fmt.plural(res.count, 'event') + ' to ' + res.name + '.');
  });
  MC.actions.register('cal-reminder-remove', (el) => {
    const id = el.getAttribute('data-id');
    MC.app.confirm('Remove this reminder from the calendar?', 'Remove').then((ok) => {
      if (!ok) return;
      MC.state.removeReminder(id)
        .then(() => { MC.app.toast('Reminder removed.'); MC.app.closeModal(); })
        .catch((err) => MC.app.toast(err.message, { error: true }));
    });
  });
  MC.actions.register('cal-add-reminder', (el) => {
    const date = el.getAttribute('data-date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { MC.app.toast('That day is no longer valid.', { error: true }); return; }
    const titleEl = document.getElementById('cal-rem-title');
    const timeEl = document.getElementById('cal-rem-time');
    const title = ((titleEl && titleEl.value) || '').trim();
    if (!title) { MC.app.toast('Please give the reminder a title.', { error: true }); return; }
    const time = timeEl ? padTime(timeEl.value) : null;
    MC.state.addReminder({ date, time, title })
      .then(() => { MC.app.toast('Reminder added for ' + MC.fmt.date(date) + '.'); MC.app.closeModal(); })
      .catch((err) => MC.app.toast(err.message, { error: true }));
  });
  MC.actions.register('cal-add-task', (el) => {
    const date = el.getAttribute('data-date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { MC.app.toast('That day is no longer valid.', { error: true }); return; }
    const titleEl = document.getElementById('cal-task-title');
    const timeEl = document.getElementById('cal-task-time');
    const title = ((titleEl && titleEl.value) || '').trim();
    if (!title) { MC.app.toast('Please give the task a title.', { error: true }); return; }
    const time = timeEl ? padTime(timeEl.value) : null;
    MC.state.addManualTask({ title, scheduleType: 'once', date, time, category: 'General' })
      .then(() => { MC.app.toast('Task added on ' + MC.fmt.date(date) + '.'); MC.app.closeModal(); })
      .catch((err) => MC.app.toast(err.message, { error: true }));
  });

  MC.views.register({ id: 'calendar', render });
})();
