/* MC.backup — user-lane JSON backup (export/import) and the one-time Research Radar browser-backup import.
   Owned by UI-A. Rules: never include tokens; validate every shape before anything is written; refuse
   to replace newer data with an older backup unless the owner explicitly confirms; source feeds are
   never touched (only the user lane: overrides, manual tasks, board, notes, reminders, weights). */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});

  const MAX_BYTES = 10 * 1024 * 1024;
  const KEY_RE = /^[a-zA-Z0-9:_-]{1,200}$/;          // Mission Control merged-view keys
  const RADAR_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;      // Research Radar record ids (RADAR_AUDIT §7)
  const FIELD_RE = /^[a-zA-Z0-9_]{1,60}$/;
  const BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const RADAR_CATS = ['Funding', 'Conference', 'Journal CFP', 'Public talk', 'Association', 'My task'];
  const RADAR_FIELDS = ['title', 'category', 'stage', 'deadline', 'reminder', 'region', 'mode', 'status', 'url', 'cost', 'amount', 'why', 'action', 'notes', 'fit', 'feasibility', 'value', 'affordability', 'deleted'];
  const RADAR_EDIT_FIELDS = RADAR_FIELDS.filter((f) => !['stage', 'notes', 'deleted', 'reminder'].includes(f));
  const RATING_FIELDS = ['fit', 'feasibility', 'value', 'affordability'];
  const MARKER = 'meta:radar-backup-import';
  const SECRET_KEY = /^(token|access_token|accesstoken|authorization|password|secret|api_?key|bearer)$/i;
  const TASK_FIELDS = ['id', 'title', 'description', 'agentId', 'category', 'status', 'priority', 'scheduleType', 'days', 'time', 'date', 'tags', 'link', 'createdAt', 'updatedAt', 'archived', 'opportunity'];
  const PRIORITIES = ['low', 'normal', 'medium', 'high', 'urgent'];
  const SCHED_TYPES = ['none', 'once', 'daily', 'weekly'];

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const okKey = (k) => typeof k === 'string' && KEY_RE.test(k) && !BAD.has(k);
  const okRadarId = (k) => typeof k === 'string' && RADAR_ID_RE.test(k) && !BAD.has(k);
  const okField = (k) => typeof k === 'string' && FIELD_RE.test(k) && !BAD.has(k);
  const prim = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v));
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n || 20000) : '');
  const when = (v) => (typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v)) ? v : null);
  const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T12:00:00Z'));
  const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const now = () => new Date().toISOString();

  const app = () => MC.app || {};
  const toast = (m, o) => { if (app().toast) app().toast(m, o); };
  const confirmBox = (m, ok) => (app().confirm ? app().confirm(m, ok) : Promise.resolve(window.confirm(m)));
  const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };

  /* ---------------- export ---------------- */
  /** Deep copy that drops any key that looks like a credential. Tokens are never in the user lane; this is belt and braces. */
  function scrub(v, depth) {
    if ((depth || 0) > 40) return null;
    if (Array.isArray(v)) return v.map((x) => scrub(x, (depth || 0) + 1));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) { if (SECRET_KEY.test(k) || BAD.has(k)) continue; o[k] = scrub(x, (depth || 0) + 1); }
      return o;
    }
    return v;
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function exportJSON() {
    const data = scrub(MC.state.exportBackup());
    data.note = 'User lane only (overrides, manual tasks, board, notes, reminders, weights). Source feeds and access tokens are never included.';
    if (MC.state.mode() !== 'demo') {
      const ok = await confirmBox('This file will contain your PRIVATE dashboard edits — notes, manual tasks, overrides and reminders. It never contains your access token. Keep it somewhere private and do not share or publish it. Download now?', 'Download private backup');
      if (!ok) return null;
    }
    const name = 'mission-control-backup-' + MC.fmt.today() + '.json';
    const text = JSON.stringify(data, null, 2);
    download(name, text);
    toast('Backup downloaded: ' + name + (MC.state.mode() === 'demo' ? ' (synthetic demo data)' : ''));
    return { name, bytes: text.length, data };
  }

  /* ---------------- import: entry ---------------- */
  function fail(msg) { toast(msg, { error: true, ms: 6000 }); return { ok: false, error: msg }; }
  async function importFile(file) {
    if (!file) return fail('No file chosen.');
    if (file.size > MAX_BYTES) return fail('File is larger than 10 MB — import refused.');
    let obj;
    try {
      const text = await file.text();
      if (text.length > MAX_BYTES) return fail('File is larger than 10 MB — import refused.');
      obj = JSON.parse(text);
    } catch (e) { return fail('Not valid JSON: ' + e.message); }
    return importObject(obj);
  }
  async function importObject(obj) {
    if (!isObj(obj)) return fail('The file must contain a JSON object.');
    if (obj.app === 'Mission Control') return importMissionControl(obj);
    if (obj.app === 'Research Radar') return importRadar(obj);
    return fail('Unrecognised file: expected a Mission Control backup (app "Mission Control") or a Research Radar board backup (app "Research Radar").');
  }

  /* ---------------- (a) Mission Control backup ---------------- */
  function cleanOverrides(doc, skip) {
    const out = {};
    if (!isObj(doc.overrides)) { if (doc.overrides !== undefined) bump(skip, 'overrides: not an object'); return out; }
    for (const [key, fields] of Object.entries(doc.overrides)) {
      if (!okKey(key) || !isObj(fields)) { bump(skip, 'override: invalid key or shape'); continue; }
      const f2 = {};
      for (const [f, e] of Object.entries(fields)) {
        if (!okField(f) || !isObj(e) || !('value' in e)) { bump(skip, 'override field: invalid'); continue; }
        const okVal = (v) => prim(v) || (Array.isArray(v) && v.length <= 50 && v.every(prim));
        if (!okVal(e.value) || ('baseValue' in e && !okVal(e.baseValue))) { bump(skip, 'override field: unsupported value'); continue; }
        const entry = { value: typeof e.value === 'string' ? str(e.value) : e.value, at: when(e.at) || now() };
        if ('baseValue' in e) entry.baseValue = typeof e.baseValue === 'string' ? str(e.baseValue) : e.baseValue;
        f2[f] = entry;
      }
      if (Object.keys(f2).length) out[key] = f2;
    }
    return out;
  }
  function cleanOpportunity(o) {
    if (!isObj(o)) return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!okField(k) || !prim(v)) continue;
      out[k] = typeof v === 'string' ? str(v) : v;
    }
    if ('url' in out) out.url = MC.sanitize.safeUrl(String(out.url || '')) || '';
    return out;
  }
  function cleanTask(t, skip) {
    if (!isObj(t) || !okKey(t.id) || typeof t.title !== 'string' || !t.title.trim()) { bump(skip, 'manual task: missing id/title or invalid id'); return null; }
    const o = {};
    for (const k of TASK_FIELDS) if (k in t) o[k] = t[k];
    o.title = str(o.title, 500);
    o.description = str(o.description);
    o.agentId = typeof o.agentId === 'string' && okKey(o.agentId) ? o.agentId : null;
    o.category = str(o.category, 120) || 'General';
    o.status = MC.state.STATUSES.includes(o.status) ? o.status : 'queued';
    o.priority = PRIORITIES.includes(o.priority) ? o.priority : 'normal';
    o.scheduleType = SCHED_TYPES.includes(o.scheduleType) ? o.scheduleType : 'none';
    o.days = Array.isArray(o.days) ? o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
    o.time = isTime(o.time) ? o.time : null;
    o.date = isDay(o.date) ? o.date : null;
    o.tags = Array.isArray(o.tags) ? o.tags.filter((x) => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 30) : [];
    o.link = MC.sanitize.safeUrl(String(o.link || '')) || '';
    o.createdAt = when(o.createdAt) || now();
    o.updatedAt = when(o.updatedAt) || now();
    o.archived = o.archived === true;
    if ('opportunity' in o) { const op = cleanOpportunity(o.opportunity); if (op) o.opportunity = op; else delete o.opportunity; }
    return o;
  }
  function cleanMap(src, skip, label, valFn) {
    const out = {};
    if (src === undefined) return out;
    if (!isObj(src)) { bump(skip, label + ': not an object'); return out; }
    for (const [k, v] of Object.entries(src)) {
      if (!okKey(k)) { bump(skip, label + ': invalid key'); continue; }
      const c = valFn(v);
      if (c == null) { bump(skip, label + ': invalid value'); continue; }
      out[k] = c;
    }
    return out;
  }
  function validateMissionControl(obj) {
    const S = MC.state;
    if (obj.version !== 1) throw new Error('Unsupported Mission Control backup version (expected 1).');
    if (!isObj(obj.user)) throw new Error('Backup has no "user" object.');
    const skip = {}, docs = {}, counts = {};
    for (const name of Object.keys(obj.user)) if (!S.USER_FILES[name]) bump(skip, 'unknown section "' + String(name).slice(0, 40) + '"');
    const u = obj.user;
    const has = (n) => isObj(u[n]);
    if (has('overrides')) {
      docs.overrides = { version: 1, overrides: cleanOverrides(u.overrides, skip) };
      counts.overrides = Object.keys(docs.overrides.overrides).length;
    }
    if (has('manualTasks')) {
      const arr = Array.isArray(u.manualTasks.tasks) ? u.manualTasks.tasks : [];
      if (!Array.isArray(u.manualTasks.tasks)) bump(skip, 'manualTasks.tasks: not an array');
      const seen = new Set(), tasks = [];
      for (const t of arr.slice(0, 5000)) { const c = cleanTask(t, skip); if (!c) continue; if (seen.has(c.id)) { bump(skip, 'manual task: duplicate id'); continue; } seen.add(c.id); tasks.push(c); }
      docs.manualTasks = { version: 1, tasks }; counts.manualTasks = tasks.length;
    }
    if (has('board')) {
      const b = u.board;
      docs.board = {
        version: 1,
        status: cleanMap(b.status, skip, 'board status', (v) => (isObj(v) && S.STATUSES.includes(v.status) ? { status: v.status, at: when(v.at) || now() } : null)),
        stage: cleanMap(b.stage, skip, 'board stage', (v) => (isObj(v) && S.RADAR_STAGES.includes(v.stage) ? { stage: v.stage, at: when(v.at) || now() } : null)),
        archived: cleanMap(b.archived, skip, 'archive flag', (v) => (isObj(v) || v === true ? { at: (isObj(v) && when(v.at)) || now() } : null)),
      };
      counts.board = Object.keys(docs.board.status).length + Object.keys(docs.board.stage).length + Object.keys(docs.board.archived).length;
    }
    if (has('notes')) {
      docs.notes = { version: 1, notes: cleanMap(u.notes.notes, skip, 'note', (v) => (isObj(v) && typeof v.text === 'string' ? { text: str(v.text), at: when(v.at) || now() } : null)) };
      counts.notes = Object.keys(docs.notes.notes).length;
    }
    if (has('reminders')) {
      const arr = Array.isArray(u.reminders.reminders) ? u.reminders.reminders : [];
      const rems = [];
      for (const r of arr.slice(0, 5000)) {
        if (!isObj(r) || !okKey(r.id) || !isDay(r.date)) { bump(skip, 'reminder: invalid id or date'); continue; }
        rems.push({ id: r.id, key: okKey(r.key) ? r.key : null, date: r.date, time: isTime(r.time) ? r.time : null, title: str(r.title, 300) || 'Reminder', at: when(r.at) || now() });
      }
      docs.reminders = { version: 1, reminders: rems }; counts.reminders = rems.length;
    }
    if (has('weights')) {
      const w = isObj(u.weights.weights) ? u.weights.weights : {};
      const clean = {};
      for (const k of ['fit', 'feasibility', 'value', 'urgency', 'affordability', 'support']) clean[k] = Math.max(0, Math.min(50, Math.round(+w[k] || 0)));
      docs.weights = { version: 1, weights: clean }; counts.weights = 1;
    }
    if (!Object.keys(docs).length) throw new Error('Backup contains no recognised user-lane sections.');
    return { docs, counts, skip, incomingAt: Object.fromEntries(Object.keys(docs).map((n) => [n, when(u[n].updatedAt)])) };
  }
  async function importMissionControl(obj) {
    let v;
    try { v = validateMissionControl(obj); } catch (e) { return fail('Backup rejected: ' + e.message); }
    const current = MC.state.userDocs();
    const older = [];
    for (const [name, at] of Object.entries(v.incomingAt)) {
      const cur = current[name] && current[name].updatedAt;
      if (at && cur && Date.parse(at) < Date.parse(cur)) older.push(name + ' (backup ' + MC.fmt.dateTime(at) + ' vs current ' + MC.fmt.dateTime(cur) + ')');
    }
    const skipped = Object.values(v.skip).reduce((a, b) => a + b, 0);
    const c = v.counts;
    const msg = 'Replace your dashboard edits with this backup' + (obj.exported ? ' (exported ' + MC.fmt.dateTime(obj.exported) + ')' : '') + '? ' +
      'Sections: ' + Object.keys(v.docs).join(', ') + '. ' +
      (c.manualTasks != null ? c.manualTasks + ' manual task(s); ' : '') + (c.overrides != null ? c.overrides + ' overridden record(s); ' : '') +
      (c.board != null ? c.board + ' board entr(ies); ' : '') + (c.notes != null ? c.notes + ' note(s); ' : '') + (c.reminders != null ? c.reminders + ' reminder(s); ' : '') +
      (skipped ? skipped + ' invalid entr(ies) will be skipped. ' : '') + 'Source feeds are not affected.' +
      (obj.mode === 'demo' && MC.state.mode() !== 'demo' ? ' WARNING: this backup was exported from the synthetic demo workspace.' : '');
    if (!(await confirmBox(msg, 'Import backup'))) return { ok: false, cancelled: true };
    if (older.length && !(await confirmBox('This backup is OLDER than the data currently loaded for: ' + older.join('; ') + '. Importing will replace newer edits with older ones. Continue only if you are sure.', 'Replace newer data'))) {
      return { ok: false, cancelled: true, older };
    }
    try { await MC.state.replaceUserDocs(v.docs); }
    catch (e) { return fail('Import applied in this tab but NOT saved: ' + e.message); }
    toast('Backup imported: ' + Object.keys(v.docs).join(', ') + (skipped ? ' · ' + skipped + ' skipped' : ''));
    return { ok: true, kind: 'mission-control', counts: c, skipped: v.skip, older };
  }

  /* ---------------- (b) Research Radar browser backup (one-time) ---------------- */
  function radarValue(field, v) {
    if (!prim(v)) return { bad: 'unsupported value type' };
    if (field === 'deleted') return { v: v === true };
    if (field === 'deadline' || field === 'reminder') return v === null || isDay(v) ? { v } : { bad: 'invalid date (' + field + ')' };
    if (RATING_FIELDS.includes(field)) return v === null || (typeof v === 'number' && v >= 0 && v <= 100) ? { v } : { bad: 'rating out of range (' + field + ')' };
    if (field === 'category') return RADAR_CATS.includes(v) ? { v } : { bad: 'category not allowed' };
    if (field === 'url') { if (v === null || v === '') return { v: '' }; const u = MC.sanitize.safeUrl(String(v)); return u ? { v: u } : { bad: 'unsafe link' }; }
    if (v !== null && typeof v !== 'string') return { bad: 'expected text (' + field + ')' };
    return { v: v === null ? null : str(v) };
  }
  function pickRadar(o, warn) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!RADAR_FIELDS.includes(k)) continue; // whitelist: everything else (evidence, sources, created…) is dropped
      const r = radarValue(k, v);
      if (r.bad) { warn(r.bad); continue; }
      out[k] = r.v;
    }
    return out;
  }
  async function importRadar(obj) {
    const S = MC.state, F = MC.fmt;
    if (obj.version !== 1) return fail('Research Radar backup rejected: version must be 1.');
    if (obj.overrides !== undefined && !isObj(obj.overrides)) return fail('Research Radar backup rejected: "overrides" must be an object.');
    if (obj.custom !== undefined && !Array.isArray(obj.custom)) return fail('Research Radar backup rejected: "custom" must be an array.');
    if (obj.weights !== undefined && !isObj(obj.weights)) return fail('Research Radar backup rejected: "weights" must be an object.');
    const overrides = obj.overrides || {}, custom = obj.custom || [];
    const exported = when(obj.exported) || 'unknown';

    const docs = S.userDocs();
    const prev = docs.notes && docs.notes.notes && docs.notes.notes[MARKER];
    if (prev) {
      const same = exported !== 'unknown' && prev.text && String(prev.text).indexOf('exported ' + exported) >= 0;
      const ok = await confirmBox((same ? 'This exact Research Radar backup (exported ' + exported + ') was ALREADY imported. ' : 'A Research Radar backup was already imported. ') +
        'Previous import: ' + String(prev.text || '').slice(0, 300) + '. Importing again re-applies notes, stages and edits on top of anything you have changed since; custom entries already present are skipped. Continue?', 'Import again');
      if (!ok) return { ok: false, cancelled: true, reason: 'already-imported' };
    }

    const okCustom = custom.filter((c) => isObj(c)).length;
    const pre = 'Import the Research Radar browser backup' + (exported !== 'unknown' ? ' exported ' + F.dateTime(exported) : '') + '? ' +
      ovEntries(overrides).length + ' record overlay(s) (notes, board stages, hidden flags, reminders, personal edits) and ' + okCustom + ' custom entr(ies). ' +
      'Edits are stored as dashboard overrides — the Radar source data is not changed. This is meant as a one-time import.';
    if (!(await confirmBox(pre, 'Import Radar backup'))) return { ok: false, cancelled: true };

    const imported = {}, skipped = {}, warnings = [];
    const opps = S.get().opportunities;
    const radarById = Object.fromEntries(opps.filter((o) => o.source === 'radar').map((o) => [o.id, o]));
    const step = async (label, fn) => { try { await fn(); bump(imported, label); } catch (e) { bump(skipped, 'save failed (' + label + '): ' + e.message); } };

    const applyOverlay = async (key, rec, o, label) => {
      if (typeof o.notes === 'string' && o.notes.trim()) await step('notes', () => S.setNote(key, o.notes));
      if (typeof o.stage === 'string' && o.stage) {
        if (S.RADAR_STAGES.includes(o.stage)) await step('stages', () => S.setStage(key, o.stage));
        else { warnings.push('Unknown stage "' + o.stage.slice(0, 40) + '" on ' + label + ' — mapped to "New".'); await step('stages', () => S.setStage(key, 'New')); }
      }
      if (o.deleted === true) await step('archived (hidden in Radar)', () => S.archive(key));
      if (o.reminder) await step('reminders', () => S.addReminder({ key, date: o.reminder, title: 'Reminder: ' + String((rec && rec.title) || o.title || label).slice(0, 200) }));
    };

    for (const [id, raw] of ovEntries(overrides)) {
      if (!okRadarId(id)) { bump(skipped, 'invalid record id'); continue; }
      if (!isObj(raw)) { bump(skipped, 'overlay is not an object'); continue; }
      const o = pickRadar(raw, (why) => bump(skipped, 'field skipped: ' + why));
      const isCustomId = custom.some((c) => isObj(c) && c.id === id);
      if (isCustomId) continue; // custom entries carry their own overlay below
      const key = 'radar:' + id;
      const rec = radarById[id];
      const patch = {};
      for (const f of RADAR_EDIT_FIELDS) {
        if (!(f in o)) continue;
        const base = rec ? (rec.raw || {})[f] : undefined;
        if (rec && JSON.stringify(base === undefined ? null : base) === JSON.stringify(o[f])) continue; // unchanged: no override
        patch[f] = o[f];
      }
      if (Object.keys(patch).length) {
        if (!rec) bump(skipped, 'personal edits for a record not in the current Radar feed', Object.keys(patch).length);
        else await step('records with personal edits', () => S.setOverride(key, patch));
      }
      if (!rec) warnings.push('Record "' + id + '" is not in the current Radar feed — its notes/stage/reminder were kept by key so they appear if it returns.');
      await applyOverlay(key, rec, o, id);
    }

    const existingIds = new Set(((S.userDocs().manualTasks || {}).tasks || []).map((t) => t.id));
    for (const c of custom) {
      if (!isObj(c)) { bump(skipped, 'custom entry is not an object'); continue; }
      if (!okRadarId(c.id)) { bump(skipped, 'custom entry: invalid id'); continue; }
      if (typeof c.title !== 'string' || !c.title.trim()) { bump(skipped, 'custom entry: missing title'); continue; }
      if (!RADAR_CATS.includes(c.category)) { bump(skipped, 'custom entry: category not allowed'); continue; }
      if (existingIds.has(c.id)) { bump(skipped, 'custom entry already imported'); continue; }
      const ovr = isObj(overrides[c.id]) ? overrides[c.id] : {};
      const o = pickRadar(Object.assign({}, c, ovr), (why) => bump(skipped, 'field skipped: ' + why));
      const opportunity = { evidence: 'Restored personal entry (Research Radar browser backup)', verified: null, funding: 'Not confirmed', eligibility: 'Your own entry; verify requirements', importedFrom: 'Research Radar browser backup ' + exported };
      for (const f of RADAR_EDIT_FIELDS) if (f in o && f !== 'title') opportunity[f] = o[f];
      await step('custom entries', () => S.addManualTask({
        id: c.id, title: str(o.title || c.title, 500), description: str(o.why || ''), category: o.category || c.category, status: 'queued', priority: 'normal',
        scheduleType: 'none', days: [], time: null, date: null, tags: ['Research Radar import'], link: o.url || '', opportunity,
      }));
      existingIds.add(c.id);
      await applyOverlay('manual:' + c.id, null, o, c.title);
    }

    if (obj.weights) {
      const w = {};
      for (const k of ['fit', 'feasibility', 'value', 'urgency', 'affordability', 'support']) {
        const n = Number(obj.weights[k]);
        if (!isFinite(n)) { w[k] = S.get().weights[k]; continue; }
        if (n < 0 || n > 50) warnings.push('Weight "' + k + '" was ' + n + ' — clamped to 0–50.');
        w[k] = Math.max(0, Math.min(50, Math.round(n)));
      }
      await step('scoring weights', () => S.setWeights(w));
    }

    const markerOk = await (async () => { try { await S.setNote(MARKER, 'Research Radar backup exported ' + exported + ' · imported ' + now()); return true; } catch (e) { bump(skipped, 'import marker could not be saved'); return false; } })();

    const summary = { ok: true, kind: 'research-radar', exported, marker: markerOk, imported, skipped, warnings };
    showSummary(summary);
    return summary;
  }
  function ovEntries(o) { return Object.entries(o || {}); }

  function showSummary(sum) {
    const esc = MC.sanitize.esc;
    const list = (o) => { const e = Object.entries(o || {}); return e.length ? '<ul>' + e.map(([k, v]) => '<li>' + esc(k) + ': <b>' + esc(v) + '</b></li>').join('') + '</ul>' : '<p class="muted">None.</p>'; };
    const body = '<div class="prose">' +
      '<p>Research Radar backup exported <b>' + esc(sum.exported === 'unknown' ? 'at an unknown time' : MC.fmt.dateTime(sum.exported)) + '</b>.</p>' +
      '<h4>Imported</h4>' + list(sum.imported) +
      '<h4>Skipped (by reason)</h4>' + list(sum.skipped) +
      ((sum.warnings || []).length ? '<h4>Warnings</h4><ul>' + sum.warnings.slice(0, 40).map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<p class="muted small">The import is recorded so a second import of the same file asks first. Edits are dashboard overrides; the Radar source data was not changed.</p></div>';
    if (app().modal) app().modal({ title: 'Research Radar import summary', body, foot: '<button class="btn primary" data-action="close-modal">Done</button>' });
    toast('Research Radar backup imported.');
  }

  MC.backup = { exportJSON, importFile, importObject, MARKER, _test: { validateMissionControl, scrub, okKey, okRadarId } };
})();
