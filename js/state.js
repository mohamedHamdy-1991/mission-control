/* MC.state — merged read model = source feeds (read-only) + user lane (browser edits).
   Feed refreshes never touch the user lane; overrides are field-level and carry the base value
   they were made against, so an upstream change to an overridden field is flagged, not lost. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const F = () => MC.fmt;

  const USER_FILES = {
    overrides: { path: 'user/overrides.json', blank: () => ({ version: 1, updatedAt: null, overrides: {}, _conflicts: [] }) },
    manualTasks: { path: 'user/manual-tasks.json', blank: () => ({ version: 1, updatedAt: null, tasks: [] }) },
    board: { path: 'user/board.json', blank: () => ({ version: 1, updatedAt: null, status: {}, stage: {}, archived: {} }) },
    notes: { path: 'user/notes.json', blank: () => ({ version: 1, updatedAt: null, notes: {} }) },
    reminders: { path: 'user/reminders.json', blank: () => ({ version: 1, updatedAt: null, reminders: [] }) },
    weights: { path: 'user/weights.json', blank: () => ({ version: 1, updatedAt: null, weights: { fit: 30, feasibility: 20, value: 20, urgency: 15, affordability: 10, support: 5 } }) },
  };
  const FEED_PATHS = {
    agents: 'feeds/mausbot/agents.json', routines: 'feeds/mausbot/routines.json', runs: 'feeds/mausbot/runs.json',
    assignments: 'feeds/mausbot/assignments.json', opportunities: 'feeds/radar/opportunities.json', reports: 'feeds/radar/reports.json',
    chatgptTasks: 'feeds/chatgpt/tasks.json', phdReports: 'feeds/phd/weekly-reports.json', publications: 'feeds/phd/publications.json',
    chatgptOpportunities: 'feeds/chatgpt/opportunities.json', chatgptCorroborations: 'feeds/chatgpt/corroborations.json',
    chatgptPhdReports: 'feeds/chatgpt/phd-reports.json',
    ledger: 'feeds/meta/ledger.json', manifest: 'feeds/meta/manifest.json', upstreamFlags: 'feeds/meta/upstream-flags.json',
  };
  const STATUSES = ['queued', 'working', 'review', 'completed'];
  const STATUS_LABEL = { queued: 'Queued', working: 'Working', review: 'Review', completed: 'Completed', failed: 'Failed', paused: 'Paused' };
  const RADAR_STAGES = ['New', 'Interested', 'Maybe', 'Working on', 'Applied / pitched', 'Done', 'Not for me'];
  const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pickArray = (obj, pref) => {
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object') return [];
    if (pref && Array.isArray(obj[pref])) return obj[pref];
    for (const k of Object.keys(obj)) if (k !== '_meta' && Array.isArray(obj[k])) return obj[k];
    return [];
  };
  const isoMs = (v) => (v == null || v === '' ? null : typeof v === 'number' ? new Date(v).toISOString() : String(v));

  /* ---------- op helpers (shared with data-client) ---------- */
  function getPath(o, path) { let c = o; for (const p of path) { if (c == null) return undefined; c = c[p]; } return c; }
  function applyOps(doc, ops) {
    for (const op of ops) {
      let c = doc;
      for (let i = 0; i < op.path.length - 1; i++) {
        const p = op.path[i];
        if (c[p] == null || typeof c[p] !== 'object') c[p] = typeof op.path[i + 1] === 'number' ? [] : {};
        c = c[p];
      }
      const last = op.path[op.path.length - 1];
      if (op.delete) { if (Array.isArray(c)) c.splice(last, 1); else delete c[last]; }
      else if (op.push) { if (!Array.isArray(c[last])) c[last] = []; c[last].push(clone(op.push)); }
      else c[last] = clone(op.value);
    }
    doc.updatedAt = new Date().toISOString();
    return doc;
  }
  MC.ops = { getPath, applyOps, clone, same };

  /* ---------- schedule normalisation ---------- */
  function normSchedule(raw, kindHint) {
    // MausBot store: {type:'daily',time,weekdays:[getDay 0=Sun]} | {type:'cron',expression,timeZone} | {type:'once',at}
    // Template/ChatGPT: scheduleType weekly/daily/once + days (0=Sun) + time + date
    // Manual: scheduleType + days (ISO 1..7) + time + date
    const s = { kind: 'none', days: [], time: null, date: null, at: null, cron: null, timeZone: MC.TZ, tzNote: '', verbatim: raw || null };
    if (!raw) return s;
    const type = raw.type || raw.scheduleType || raw.kind;
    const fromGetDay = (arr) => (arr || []).map((d) => (d === 0 ? 7 : +d)).filter((d) => d >= 1 && d <= 7).sort();
    if (type === 'daily' && Array.isArray(raw.weekdays)) {
      s.time = raw.time || null; s.days = fromGetDay(raw.weekdays);
      s.kind = s.days.length === 7 || s.days.length === 0 ? 'daily' : 'weekly';
      s.tzNote = 'Stored without a zone; evaluated in the MausBot server’s local time (Europe/London).';
    } else if (type === 'cron') {
      s.kind = 'cron'; s.cron = raw.expression || raw.cron || null; s.timeZone = raw.timeZone || MC.TZ;
    } else if (type === 'once') {
      s.kind = 'once'; s.at = isoMs(raw.at || raw.runAt || null);
      if (!s.at && raw.date) { s.date = raw.date; s.time = raw.time || null; }
    } else if (type === 'interval') {
      s.kind = 'interval'; s.tzNote = 'Interval schedules have no fixed calendar slot.';
    } else if (type === 'weekly' || type === 'daily') {
      s.kind = type; s.time = raw.time || null;
      const iso = kindHint === 'manual';
      s.days = type === 'daily' ? [] : (iso ? (raw.days || []).map(Number).filter((d) => d >= 1 && d <= 7) : fromGetDay(raw.days));
    } else if (type === 'once' || raw.date) {
      s.kind = 'once'; s.date = raw.date || null; s.time = raw.time || null;
    }
    return s;
  }
  function scheduleLabel(s) {
    if (!s || s.kind === 'none') return 'Unscheduled';
    const t = s.time ? ' ' + s.time : '';
    if (s.kind === 'daily') return 'Daily' + t;
    if (s.kind === 'weekly') return 'Weekly · ' + s.days.map((d) => DOW[d]).join(', ') + t;
    if (s.kind === 'cron') return 'Cron ' + (s.cron || '?') + ' (' + s.timeZone + ')';
    if (s.kind === 'once') return 'Once · ' + (s.at ? F().dateTime(s.at) : s.date ? F().date(s.date) + t : 'date unknown');
    if (s.kind === 'interval') return 'Interval';
    return s.kind;
  }

  /* ChatGPT schedule text parser: only used for liveStatus==='active' tasks (DATA_CONTRACT §7.3).
     Parses the verbatim ChatGPT schedule text to weekly/daily + time; anything else → null
     (the task is listed without projection). */
  const GPT_DAYS = [
    [/(\bsun\b|\bsundays?\b)/i, 7], [/(\bmon\b|\bmondays?\b)/i, 1], [/(\btue\b|\btues\b|\btuesdays?\b)/i, 2],
    [/(\bwed\b|\bwednesdays?\b)/i, 3], [/(\bthu\b|\bthur\b|\bthurs\b|\bthursdays?\b)/i, 4],
    [/(\bfri\b|\bfridays?\b)/i, 5], [/(\bsat\b|\bsaturdays?\b)/i, 6],
  ];
  function parseChatgptScheduleText(text) {
    if (!text || typeof text !== 'string') return null;
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!timeMatch) return null;
    const time = timeMatch[0].length === 4 ? '0' + timeMatch[0] : timeMatch[0];
    const daily = /\bdaily\b|\bevery\s+day\b|\bevery\s+morning\b|\bevery\s+evening\b|\bevery\s+night\b/i.test(text);
    const days = [];
    for (const [rx, n] of GPT_DAYS) if (rx.test(text) && !days.includes(n)) days.push(n);
    days.sort((a, b) => a - b);
    if (daily && days.length) return null; // ambiguous text — do not project
    if (daily) return { kind: 'daily', days: [], time };
    if (days.length) return { kind: 'weekly', days, time };
    return null;
  }

  /* ---------- store ---------- */
  let mode = 'demo';
  let feeds = {};
  let user = {};
  let receipts = [];
  let model = null;
  const subs = new Set();
  let pending = 0;

  function load(bundle, opts) {
    mode = (opts && opts.mode) || 'demo';
    feeds = {};
    for (const [name, path] of Object.entries(FEED_PATHS)) {
      const v = bundle.feeds ? (bundle.feeds[name] !== undefined ? bundle.feeds[name] : bundle.feeds[path]) : undefined;
      feeds[name] = v === undefined ? null : v;
    }
    user = {};
    for (const [name, spec] of Object.entries(USER_FILES)) {
      const v = bundle.user ? (bundle.user[name] !== undefined ? bundle.user[name] : bundle.user[spec.path]) : undefined;
      user[name] = Object.assign(spec.blank(), v || {});
    }
    receipts = Array.isArray(bundle.receipts) ? bundle.receipts : [];
    rebuild();
  }

  /* override helpers */
  const ov = (key) => (user.overrides.overrides || {})[key] || {};
  function applyOverrides(key, base) {
    const o = ov(key);
    const out = Object.assign({}, base);
    const overridden = [], flags = [];
    for (const [field, entry] of Object.entries(o)) {
      if (!entry || typeof entry !== 'object' || !('value' in entry)) continue;
      out[field] = entry.value; overridden.push(field);
      if ('baseValue' in entry && !same(entry.baseValue, base[field] === undefined ? null : base[field])) {
        flags.push({ key, field, kind: 'upstream-changed', was: entry.baseValue, upstream: base[field] === undefined ? null : base[field], ours: entry.value, at: entry.at });
      }
    }
    return { out, overridden, flags };
  }

  function rebuild() {
    const agentsRaw = pickArray(feeds.agents, 'agents');
    const routinesRaw = pickArray(feeds.routines, 'routines');
    const runsRaw = pickArray(feeds.runs, 'runs');
    const asgRaw = pickArray(feeds.assignments, 'assignments');
    const oppRaw = pickArray(feeds.opportunities, 'opportunities');
    const repRaw = pickArray(feeds.reports, 'reports');
    const gptRaw = pickArray(feeds.chatgptTasks, 'tasks');
    const phdRaw = pickArray(feeds.phdReports, 'reports');
    const pubRaw = pickArray(feeds.publications, 'publications');
    const board = user.board, notes = user.notes.notes || {};
    const flags = [];

    const agents = agentsRaw.map((a) => ({
      key: 'mausbot:agent:' + a.id, id: a.id, name: a.name || a.id, title: a.title || a.role || '',
      model: a.model || (a.modelSelection && a.modelSelection.model) || '', variant: a.variant || '',
      chiefOfStaff: !!a.chiefOfStaff, color: a.color || null,
      portrait: a.portrait || null, initials: ((a.portrait && a.portrait.initials) || a.initials || (a.name || '?').slice(0, 1)).toUpperCase(),
      portraitNote: (a.portrait && a.portrait.note) || '',
      counts: a.counts || {}, raw: a,
    }));
    const agentById = Object.fromEntries(agents.map((a) => [a.id, a]));

    const runs = runsRaw.map((r) => ({
      key: 'mausbot:run:' + r.id, id: r.id, source: 'mausbot', routineId: r.routineId, routineName: r.routineName || '',
      agentId: r.botId || r.agentId || null, status: r.status || 'completed', trigger: r.triggerSource || r.trigger || '',
      scheduledFor: isoMs(r.scheduledFor), startedAt: isoMs(r.startedAt), finishedAt: isoMs(r.finishedAt),
      output: typeof r.output === 'string' ? r.output : '', outputLen: r.outputLen != null ? r.outputLen : (r.output || '').length,
      outputTruncated: !!r.outputTruncated, report: r.report || r.reportState || null, raw: r,
    }));
    for (const rc of receipts) {
      if (!rc || !rc.receiptId) continue;
      if (rc.source === 'mausbot' && runs.some((x) => x.id === rc.runId)) continue; // already in the run feed
      runs.push({
        key: (rc.source || 'receipt') + ':run:' + (rc.runId || rc.receiptId), id: rc.runId || rc.receiptId, source: rc.source || 'receipt',
        routineId: rc.routineId || null, routineName: rc.title || rc.routineName || '', agentId: rc.agentId || null,
        status: rc.status || 'completed', trigger: 'receipt', scheduledFor: null, startedAt: isoMs(rc.startedAt), finishedAt: isoMs(rc.finishedAt),
        output: rc.summary || '', outputLen: (rc.summary || '').length, outputTruncated: false, links: rc.links || [], receipt: true, raw: rc,
      });
    }
    runs.sort((a, b) => String(b.finishedAt || b.startedAt || '').localeCompare(String(a.finishedAt || a.startedAt || '')));
    const runsByRoutine = {};
    for (const r of runs) if (r.routineId) (runsByRoutine[r.routineId] = runsByRoutine[r.routineId] || []).push(r);

    const items = [];
    const pushItem = (base) => {
      const key = base.key;
      const { out, overridden, flags: fl } = applyOverrides(key, base);
      flags.push(...fl);
      const b = board.status && board.status[key];
      out.status = (b && b.status) || out.status || 'queued';
      out.boardStatusAt = b ? b.at : null;
      out.archived = !!(board.archived && board.archived[key]) || !!base.archivedManual;
      out.notes = notes[key] ? notes[key].text : '';
      out.overridden = overridden; out.flags = fl;
      // schedule plan vs source
      const schedFields = ['scheduleTime', 'scheduleDays', 'scheduleDate'];
      if (overridden.some((f) => schedFields.includes(f)) && out.schedule) {
        out.sourceSchedule = base.schedule;
        out.schedule = Object.assign({}, base.schedule, {
          time: out.scheduleTime !== undefined ? out.scheduleTime : base.schedule.time,
          days: out.scheduleDays !== undefined ? out.scheduleDays : base.schedule.days,
          date: out.scheduleDate !== undefined ? out.scheduleDate : base.schedule.date,
          origin: 'plan',
        });
        if (out.schedule.kind === 'cron' || out.schedule.kind === 'once') { if (out.scheduleDate || out.scheduleTime) { out.schedule.kind = 'once'; out.schedule.at = null; } }
        out.schedule.label = scheduleLabel(out.schedule) + ' · dashboard plan';
      }
      if (out.agentId && agentById[out.agentId]) out.agentName = agentById[out.agentId].name;
      items.push(out);
    };

    for (const r of routinesRaw) {
      const sched = normSchedule(r.scheduleVerbatim || r.schedule, 'mausbot');
      sched.origin = 'source'; sched.enabled = r.enabled !== false; sched.nextRunAt = isoMs(r.nextRunAt);
      if (r.timeZone && sched.kind !== 'cron') sched.tzNote = sched.tzNote || r.timeZone;
      sched.label = scheduleLabel(sched) + (sched.enabled ? '' : ' · paused');
      const rr = runsByRoutine[r.id] || [];
      const live = rr.find((x) => x.status === 'running' || x.status === 'waiting');
      pushItem({
        key: 'mausbot:routine:' + r.id, id: r.id, source: 'mausbot', kind: 'routine', origin: 'source',
        title: r.name || r.id, description: r.promptSummary || '', agentId: r.botId || null, category: r.category || 'Routine',
        status: live ? 'working' : 'queued', priority: 'normal', schedule: sched, enabled: sched.enabled,
        deadline: null, tags: r.checks ? ['checks'] : [], link: '', sourceRef: 'OpenMausBot routines.json · ' + r.id,
        checkedAt: isoMs(r.checkedAt), ownerAuthored: r.ownerAuthored, runs: rr, lastRun: rr[0] || null, raw: r,
      });
    }
    for (const t of gptRaw) {
      // Registry contract (DATA_CONTRACT §7.4): liveStatus active|paused|unverified, route
      // github-inbox|notion-bridge|manual-import|blocked, scheduleSource = verbatim ChatGPT text.
      const live = t.liveStatus || 'unverified';
      const isLive = live === 'active' || live === 'paused';
      const gptSched = parseChatgptScheduleText(t.scheduleSource && t.scheduleSource.text);
      let sched;
      if (isLive && gptSched) {
        sched = gptSched; sched.origin = 'source'; sched.enabled = live === 'active';
        sched.tzNote = 'ChatGPT schedule text: "' + (t.scheduleSource.text || '') + '" (Europe/London; verified ' + (t.scheduleSource.verifiedAt || 'not recorded') + ').';
        sched.label = scheduleLabel(sched) + (live === 'active' ? ' · ChatGPT source schedule' : ' · ChatGPT schedule (task paused)');
      } else {
        sched = normSchedule({ scheduleType: t.scheduleType, days: t.days, time: t.time, date: t.date }, 'template');
        sched.origin = 'snapshot'; sched.enabled = false; // old snapshot projections are never shown as live
        sched.label = scheduleLabel(sched) + (isLive ? ' · ChatGPT task (schedule text not parseable — listed, not projected)' : ' · snapshot (unverified, not projected)');
      }
      pushItem({
        key: 'chatgpt:task:' + (t.taskId || t.id), id: t.taskId || t.id, source: 'chatgpt', kind: isLive ? 'chatgpt-task' : 'snapshot-task', origin: 'source',
        title: t.title, description: t.description || t.prompt || '', agentId: null,
        assignedLabel: isLive ? 'ChatGPT scheduled task (live)' : 'ChatGPT scheduled task (snapshot)',
        category: t.category || 'Research', status: t.status || 'queued', priority: t.priority || 'normal', schedule: sched, enabled: sched.enabled,
        deadline: null, tags: t.tags || [], link: '', prompt: t.prompt || '', deliverable: t.deliverable || '',
        liveStatus: live, route: t.route || 'blocked', routeLabel: t.routeLabel || '',
        lastVerifiedRun: t.lastVerifiedRun || null, scheduleSource: t.scheduleSource || null,
        confirmation: isLive ? 'live-verified' : (t.confirmation || 'historical-snapshot'),
        liveVerification: isLive ? 'verified ' + (t.scheduleSource && t.scheduleSource.verifiedAt || '') : (t.liveVerification || 'pending'),
        sourceRef: isLive ? ('ChatGPT Scheduled page · ' + (t.taskId || t.id)) : 'Saved ChatGPT task snapshot · ' + (t.templateId || t.id), raw: t,
      });
    }
    for (const t of user.manualTasks.tasks || []) {
      const sched = normSchedule({ scheduleType: t.scheduleType, days: t.days, time: t.time, date: t.date }, 'manual');
      sched.origin = 'plan'; sched.enabled = true; sched.label = scheduleLabel(sched) + ' · dashboard plan';
      pushItem({
        key: 'manual:' + t.id, id: t.id, source: 'manual', kind: 'task', origin: 'manual', title: t.title, description: t.description || '',
        agentId: t.agentId || null, category: t.category || 'General', status: t.status || 'queued', priority: t.priority || 'normal',
        schedule: sched, enabled: true, deadline: t.date || null, tags: t.tags || [], link: t.link || '', sourceRef: 'Manual task (Mission Control)',
        archivedManual: !!t.archived, createdAt: t.createdAt, updatedAt: t.updatedAt, raw: t,
      });
    }

    const opportunities = oppRaw.map((r) => {
      const key = 'radar:' + r.id;
      const { out, overridden, flags: fl } = applyOverrides(key, r);
      flags.push(...fl);
      const st = board.stage && board.stage[key];
      return Object.assign(out, {
        key, source: 'radar', kind: 'opportunity', origin: 'source', stage: (st && st.stage) || 'New',
        archived: !!(board.archived && board.archived[key]), notes: notes[key] ? notes[key].text : '', overridden, flags: fl, raw: r,
      });
    });
    for (const t of user.manualTasks.tasks || []) {
      if (!t.opportunity) continue;
      const key = 'manual:' + t.id;
      const st = board.stage && board.stage[key];
      opportunities.push(Object.assign({}, t.opportunity, {
        id: t.id, key, title: t.title, source: 'manual', kind: 'opportunity', origin: 'manual', stage: (st && st.stage) || 'New',
        archived: !!t.archived || !!(board.archived && board.archived[key]), notes: notes[key] ? notes[key].text : '', overridden: [], flags: [], raw: t,
        evidence: 'Personal entry — not independently verified',
      }));
    }
    // ChatGPT scan outputs (feeds/chatgpt/*): distinct from the Radar dataset, never merged into it.
    const corrobByRadar = {};
    for (const c of pickArray(feeds.chatgptCorroborations, 'corroborations')) {
      if (!c || !c.key) continue;
      (corrobByRadar[c.key] = corrobByRadar[c.key] || []).push(c);
    }
    for (const r of oppRaw) {
      const cs = corrobByRadar['radar:' + r.id];
      if (cs) { const o = opportunities.find((x) => x.key === 'radar:' + r.id); if (o) o.corroborations = cs; }
    }
    for (const o of pickArray(feeds.chatgptOpportunities, 'opportunities')) {
      const key = o.key || ('chatgpt-opp:' + (o.id || o.url));
      const st = board.stage && board.stage[key];
      opportunities.push(Object.assign({}, o, {
        key, id: o.id || key, source: 'chatgpt', kind: 'opportunity', origin: 'source', stage: (st && st.stage) || 'New',
        archived: !!(board.archived && board.archived[key]), notes: notes[key] ? notes[key].text : '', overridden: [], flags: [],
        raw: o, evidence: o.evidence || ('ChatGPT scan run · seen by ' + (o.seenBy || []).map((s) => s.taskId).join(', ')),
      }));
    }

    const reports = repRaw.map((r, i) => ({
      key: 'radar-report:' + (r.date || r.reportDate || i), idx: i, title: r.title, text: r.text || '', complete: r.complete !== false,
      date: r.date || r.reportDate || null, source: r.source || '', raw: r,
    })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const provText = (p) => {
      if (!p) return '';
      if (typeof p === 'string') return p;
      // private feed: {path, file, sha256, bytes, mtimeUtc}
      return [p.file || p.path, p.sha256 ? 'sha256 ' + String(p.sha256).slice(0, 12) + '…' : '', p.mtimeUtc ? 'file dated ' + F().date(p.mtimeUtc) : '']
        .filter(Boolean).join(' · ');
    };
    const phdReports = phdRaw.map((r, i) => ({
      key: 'phd:report:' + (r.id || r.date || i), id: r.id || r.date || String(i), title: r.title || ('Weekly Leeds UHI digest ' + (r.date || '')),
      date: r.date || null, text: r.text || r.markdown || '', provenance: provText(r.provenance || r.sourcePath), provenanceDetail: typeof r.provenance === 'object' ? r.provenance : null,
      kind: r.kind || 'literature', raw: r,
    })).concat(pickArray(feeds.chatgptPhdReports, 'reports').map((r) => ({
      key: 'phd:report:' + (r.key || r.id || r.date), id: r.id || r.date || r.key, title: r.title || 'Weekly literature report (ChatGPT)',
      date: r.date || null, text: r.markdown || r.text || '', provenance: provText(r.provenance),
      provenanceDetail: typeof r.provenance === 'object' ? r.provenance : null,
      kind: 'literature', source: 'chatgpt', runStatus: r.runStatus, raw: r,
    }))).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const publications = pubRaw.map((p) => Object.assign({ key: 'phd:pub:' + p.id }, p));

    const conflicts = [];
    for (const [name, doc] of Object.entries(user)) for (const c of doc._conflicts || []) conflicts.push(Object.assign({ file: name }, c));
    for (const f of pickArray(feeds.upstreamFlags, 'flags')) if (!flags.some((x) => x.key === f.key && x.field === f.field)) flags.push(Object.assign({ kind: 'upstream-changed' }, f));

    model = {
      mode, agents, agentById, items, runs, opportunities, reports, phdReports, publications,
      assignments: asgRaw, ledger: feeds.ledger, manifest: feeds.manifest, flags, conflicts,
      radarMeta: (feeds.opportunities && feeds.opportunities._meta) || null,
      feedMeta: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, (v && v._meta) || null])),
      reminders: user.reminders.reminders || [], weights: Object.assign(USER_FILES.weights.blank().weights, user.weights.weights || {}),
      feedsLoaded: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, v != null])),
      generatedAt: new Date().toISOString(),
    };
    emit();
  }

  function emit() { for (const fn of subs) { try { fn(model); } catch (e) { console.error(e); } } }

  /* ---------- writes ---------- */
  function write(file, ops) {
    const spec = USER_FILES[file]; if (!spec) throw new Error('unknown user file ' + file);
    applyOps(user[file], ops);
    rebuild();
    pending++; MC.state.pending = pending;
    const p = MC.data ? MC.data.saveUser(spec.path, ops, user[file]) : Promise.resolve({ doc: user[file], saved: false });
    return p.then((res) => {
      pending--; MC.state.pending = pending;
      if (res && res.doc) { user[file] = Object.assign(spec.blank(), res.doc); rebuild(); }
      return res;
    }, (err) => { pending--; MC.state.pending = pending; emit(); throw err; });
  }
  const now = () => new Date().toISOString();
  function findBase(key) {
    const it = model.items.find((x) => x.key === key) || model.opportunities.find((x) => x.key === key);
    return it ? (it.raw || {}) : {};
  }
  function baseFieldValue(key, field) {
    if (field === 'scheduleTime' || field === 'scheduleDays' || field === 'scheduleDate') {
      const it = model.items.find((x) => x.key === key); const s = it && (it.sourceSchedule || it.schedule);
      if (!s) return null; return field === 'scheduleTime' ? s.time : field === 'scheduleDays' ? s.days : s.date;
    }
    const b = findBase(key); return b[field] === undefined ? null : b[field];
  }

  const api = {
    STATUSES, STATUS_LABEL, RADAR_STAGES, USER_FILES, FEED_PATHS, DOW,
    load, get: () => model, subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    mode: () => mode, pending: 0, scheduleLabel, normSchedule,
    userDocs: () => clone(user),
    item(key) { return model.items.find((x) => x.key === key) || model.opportunities.find((x) => x.key === key) || model.runs.find((x) => x.key === key) || null; },

    /** Field-level override on a source record (manual tasks are edited in place instead). */
    setOverride(key, patch) {
      if (key.startsWith('manual:')) return api.updateManualTask(key.slice(7), patch);
      const ops = Object.entries(patch).map(([f, v]) => ({ path: ['overrides', key, f], value: { value: v, baseValue: baseFieldValue(key, f), at: now() } }));
      return write('overrides', ops);
    },
    clearOverride(key, field) { return write('overrides', [{ path: ['overrides', key, field], delete: true }]); },
    /** Accept upstream: drop the override so the source value shows again. */
    acceptUpstream(key, field) { return api.clearOverride(key, field); },
    /** Keep mine: re-base the override on the current upstream value (clears the flag). */
    keepMine(key, field) {
      const e = ov(key)[field]; if (!e) return Promise.resolve();
      return write('overrides', [{ path: ['overrides', key, field], value: { value: e.value, baseValue: baseFieldValue(key, field), at: now() } }]);
    },
    setStatus(key, status) {
      if (!STATUSES.includes(status)) throw new Error('bad status');
      return write('board', [{ path: ['status', key], value: { status, at: now() } }]);
    },
    setStage(key, stage) {
      if (!RADAR_STAGES.includes(stage)) throw new Error('bad stage');
      return write('board', [{ path: ['stage', key], value: { stage, at: now() } }]);
    },
    archive(key) { return write('board', [{ path: ['archived', key], value: { at: now() } }]); },
    restore(key) { return write('board', [{ path: ['archived', key], delete: true }]); },
    setNote(key, text) {
      return write('notes', text ? [{ path: ['notes', key], value: { text: String(text).slice(0, 20000), at: now() } }] : [{ path: ['notes', key], delete: true }]);
    },
    addManualTask(t) {
      const task = Object.assign({ id: 'manual-' + MC.uid().replace(/^-/, ''), title: 'Untitled task', description: '', agentId: null, category: 'General', status: 'queued',
        priority: 'normal', scheduleType: 'none', days: [], time: null, date: null, tags: [], link: '', createdAt: now(), updatedAt: now(), archived: false }, t || {});
      task.link = MC.sanitize.safeUrl(task.link || '') || '';
      const idx = (user.manualTasks.tasks || []).length;
      return write('manualTasks', [{ path: ['tasks', idx], value: task }]).then(() => task);
    },
    updateManualTask(id, patch) {
      const idx = (user.manualTasks.tasks || []).findIndex((t) => t.id === id);
      if (idx < 0) return Promise.reject(new Error('task not found'));
      const p = Object.assign({}, patch, { updatedAt: now() });
      if ('link' in p) p.link = MC.sanitize.safeUrl(p.link || '') || '';
      // address manual tasks by id path segment for merge stability
      return write('manualTasks', Object.entries(p).map(([f, v]) => ({ path: ['tasks', idx, f], value: v })));
    },
    addReminder(r) {
      const rem = { id: 'rem-' + MC.uid(), key: r.key || null, date: r.date, time: r.time || null, title: String(r.title || 'Reminder').slice(0, 300), at: now() };
      if (!F().isDateOnly(rem.date)) return Promise.reject(new Error('Reminder needs a date'));
      return write('reminders', [{ path: ['reminders', (user.reminders.reminders || []).length], value: rem }]).then(() => rem);
    },
    removeReminder(id) {
      const idx = (user.reminders.reminders || []).findIndex((r) => r.id === id);
      return idx < 0 ? Promise.resolve() : write('reminders', [{ path: ['reminders', idx], delete: true }]);
    },
    setWeights(w) {
      const clean = {};
      for (const k of ['fit', 'feasibility', 'value', 'urgency', 'affordability', 'support']) clean[k] = Math.max(0, Math.min(50, Math.round(+w[k] || 0)));
      return write('weights', [{ path: ['weights'], value: clean }]);
    },
    resolveConflict(file, index, choice) {
      const doc = user[file]; const c = doc && (doc._conflicts || [])[index]; if (!c) return Promise.resolve();
      const ops = [];
      if (choice === 'mine') ops.push({ path: c.path, value: c.ours });
      ops.push({ path: ['_conflicts', index], delete: true });
      return write(file, ops);
    },
    /** Replace user-lane docs from a validated backup (backup.js validates first). */
    replaceUserDocs(docs) {
      const jobs = [];
      for (const [name, doc] of Object.entries(docs)) {
        if (!USER_FILES[name]) continue;
        const ops = Object.keys(doc).filter((k) => k !== 'updatedAt').map((k) => ({ path: [k], value: doc[k] }));
        jobs.push(write(name, ops));
      }
      return Promise.all(jobs);
    },
    exportBackup() {
      return { app: 'Mission Control', kind: 'user-lane-backup', version: 1, exported: now(), mode, user: clone(user) };
    },
    search(q) {
      const s = String(q || '').trim().toLowerCase(); if (!s || !model) return [];
      const hit = (...xs) => xs.some((x) => x && String(x).toLowerCase().includes(s));
      const out = [];
      for (const a of model.agents) if (hit(a.name, a.title)) out.push({ key: a.key, title: a.name, sub: a.title, kind: 'Agent', route: 'agents/' + a.id });
      for (const it of model.items) if (hit(it.title, it.description, it.category, (it.tags || []).join(' '), it.agentName, it.notes)) out.push({ key: it.key, title: it.title, sub: it.schedule && it.schedule.label, kind: it.kind === 'routine' ? 'Routine' : it.kind === 'snapshot-task' ? 'ChatGPT snapshot' : 'Task', route: 'workflows/' + encodeURIComponent(it.key) });
      for (const o of model.opportunities) if (hit(o.title, o.category, o.region, o.why, o.eligibility, o.notes, o.id)) out.push({ key: o.key, title: o.title, sub: (o.category || '') + (o.deadline ? ' · ' + F().date(o.deadline) : ''), kind: 'Opportunity', route: 'opportunities/funding/' + encodeURIComponent(o.key) });
      for (const r of model.runs) if (hit(r.routineName, r.output)) out.push({ key: r.key, title: r.routineName || 'Run', sub: F().dateTime(r.finishedAt || r.startedAt), kind: 'Run', route: 'results/' + encodeURIComponent(r.key) });
      for (const r of model.reports) if (hit(r.title, r.text)) out.push({ key: r.key, title: r.title, sub: r.complete ? 'Complete report' : 'Partial report', kind: 'Radar report', route: 'reports/' + encodeURIComponent(r.key) });
      for (const r of model.phdReports) if (hit(r.title, r.text)) out.push({ key: r.key, title: r.title, sub: 'Weekly literature', kind: 'PhD', route: 'opportunities/phd/' + encodeURIComponent(r.key) });
      return out.slice(0, 80);
    },
  };
  MC.state = api;
})();
