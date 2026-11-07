/* MC.schedule — projected occurrences for normalised schedules, evaluated in Europe/London
   (UTC supported for cron `timeZone`). Occurrences are projections of the stored schedule —
   they are NEVER presented as actual runs (run history comes from model.runs only).
   Rules:
   - enabled === false → no future occurrences (callers show paused items separately).
   - kind interval → not calendar-placeable (empty result; callers list separately).
   - cron: 5 fields minute hour dom month dow; *, lists, ranges, steps; dow 0/7 = Sunday;
     standard dom/dow OR semantics when both are restricted.
   - DST: a local time that does not exist on the spring-forward day (e.g. 01:30 on the last
     Sunday of March) is skipped and reported in the returned array's `gaps`; the autumn
     overlap produces a single occurrence. Instants come from MC.fmt.londonInstant.
   - Hard cap of 500 occurrences per item (`truncated` flag on the returned array). */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const CAP = 500;

  /* ---------- small helpers ---------- */
  function dayKeysBetween(fromKey, toKey) {
    const out = [];
    if (!fromKey || !toKey || fromKey > toKey) return out;
    const d = new Date(fromKey + 'T12:00:00Z');
    while (true) {
      const k = d.toISOString().slice(0, 10);
      out.push(k);
      if (k >= toKey) break;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }
  const pad = (n) => String(n).padStart(2, '0');

  /** London wall-clock hh:mm of an instant. */
  function londonParts(instant) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const o = {};
    for (const p of f.formatToParts(instant)) o[p.type] = p.value;
    if (o.hour === '24') o.hour = '00';
    return o;
  }

  /**
   * Instant for a London (or UTC) wall-clock date+time, or null when the local time does not
   * exist (spring-forward gap). The londonInstant result is verified against the requested
   * wall clock; a mismatch means the time was skipped by the DST transition.
   */
  function wallInstant(dayKey, hhmm, tz) {
    const [h, m] = (hhmm || '00:00').split(':').map(Number);
    if (tz === 'UTC' || tz === 'Etc/UTC' || tz === 'GMT') {
      return new Date(Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10), h, m));
    }
    const instant = MC.fmt.londonInstant(dayKey, hhmm);
    const p = londonParts(instant);
    if (+p.hour !== h || +p.minute !== m) return null; // nonexistent local time (spring forward)
    return instant;
  }

  /* ---------- cron ---------- */
  /** Parse one cron field (star, "5", "1-5", step "x/y", list "1,9-17/2") to sorted unique numbers. */
  function parseField(expr, min, max) {
    const set = new Set();
    for (const part of String(expr).split(',')) {
      const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
      if (!m) return null;
      let a, b;
      if (m[1] === '*') { a = min; b = max; }
      else if (m[1].includes('-')) { const [x, y] = m[1].split('-').map(Number); a = x; b = y; }
      else { a = b = +m[1]; }
      if (a < min || b > max || a > b) return null;
      const step = m[2] ? +m[2] : 1;
      if (step < 1) return null;
      for (let v = a; v <= b; v += step) set.add(v);
    }
    return [...set].sort((x, y) => x - y);
  }
  /** Parse a 5-field expression → {minutes,hours,days,months,dows} or null. dow 7 ≡ 0 (Sunday). */
  function parseCron(expr) {
    const f = String(expr || '').trim().split(/\s+/);
    if (f.length !== 5) return null;
    const minutes = parseField(f[0], 0, 59), hours = parseField(f[1], 0, 23),
      daysM = parseField(f[2], 1, 31), months = parseField(f[3], 1, 12), dows = parseField(f[4], 0, 7);
    if (!minutes || !hours || !daysM || !months || !dows) return null;
    return {
      minutes, hours, months,
      dom: daysM, dow: dows.map((d) => (d === 7 ? 0 : d)).filter((d, i, a) => a.indexOf(d) === i).sort((x, y) => x - y),
      domStarred: /^\*$/.test(f[2]), dowStarred: /^\*$/.test(f[4]),
    };
  }
  function cronDayMatches(c, dayKey) {
    if (!c.months.includes(+dayKey.slice(5, 7))) return false;
    const dom = +dayKey.slice(8, 10);
    const dow = new Date(dayKey + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
    const domOK = c.dom.includes(dom), dowOK = c.dow.includes(dow);
    if (c.domStarred && c.dowStarred) return true;
    if (!c.domStarred && c.dowStarred) return domOK;
    if (c.domStarred && !c.dowStarred) return dowOK;
    return domOK || dowOK; // standard cron OR semantics when both restricted
  }

  /* ---------- origin labelling ---------- */
  function originLabel(schedule) {
    const s = schedule || {};
    if (s.origin === 'plan') return 'dashboard plan';
    if (s.origin === 'snapshot') return 'source schedule (saved snapshot, unverified)';
    return 'projected from source schedule';
  }

  /* ---------- occurrences ---------- */
  /**
   * @param item merged item (uses item.schedule) or a raw normalised schedule object.
   * @param fromKey inclusive YYYY-MM-DD (London days); @param toKey inclusive.
   * @returns array of {date, time:'HH:MM'|null, instant:ISO|null, allDay:bool}, sorted by date.
   *          Non-enumerable extras: .gaps [{date,time,reason}], .truncated bool, .kind.
   */
  function occurrences(item, fromKey, toKey) {
    const s = (item && item.schedule) || item || {};
    const out = [], gaps = [];
    let truncated = false;
    const add = (date, time, instant) => {
      if (date < fromKey || date > toKey) return;
      if (out.length >= CAP) { truncated = true; return; }
      out.push({ date, time: time || null, instant: instant || null, allDay: !time });
    };
    if (s && s.enabled !== false && s.kind && s.kind !== 'none' && s.kind !== 'interval') {
      const tz = s.timeZone === 'UTC' || s.timeZone === 'Etc/UTC' || s.timeZone === 'GMT' ? 'UTC' : 'Europe/London';
      if (s.kind === 'once') {
        if (s.at) {
          const date = MC.fmt.dayKey(s.at), time = MC.fmt.hm(s.at);
          add(date, time, s.at);
        } else if (s.date) {
          let instant = null;
          if (s.time) {
            instant = wallInstant(s.date, s.time, tz);
            if (!instant) gaps.push({ date: s.date, time: s.time, reason: 'Local time does not exist on this day (DST spring-forward); occurrence skipped.' });
          }
          add(s.date, s.time || null, instant);
        }
      } else if (s.kind === 'daily') {
        for (const dayKey of dayKeysBetween(fromKey, toKey)) {
          if (!s.time) { add(dayKey, null, null); continue; }
          const instant = wallInstant(dayKey, s.time, tz);
          if (!instant) { gaps.push({ date: dayKey, time: s.time, reason: 'Local time does not exist on this day (DST spring-forward); occurrence skipped.' }); continue; }
          add(dayKey, s.time, instant.toISOString());
        }
      } else if (s.kind === 'weekly') {
        const days = (s.days || []).map(Number).filter((d) => d >= 1 && d <= 7);
        if (!days.length && s.time == null) { /* nothing placeable */ }
        else for (const dayKey of dayKeysBetween(fromKey, toKey)) {
          if (!days.length || days.includes(MC.fmt.isoDow(dayKey))) {
            if (!s.time) { add(dayKey, null, null); continue; }
            const instant = wallInstant(dayKey, s.time, tz);
            if (!instant) { gaps.push({ date: dayKey, time: s.time, reason: 'Local time does not exist on this day (DST spring-forward); occurrence skipped.' }); continue; }
            add(dayKey, s.time, instant.toISOString());
          }
        }
      } else if (s.kind === 'cron') {
        const c = parseCron(s.cron);
        if (c) {
          outer:
          for (const dayKey of dayKeysBetween(fromKey, toKey)) {
            if (!cronDayMatches(c, dayKey)) continue;
            for (const h of c.hours) for (const m of c.minutes) {
              const time = pad(h) + ':' + pad(m);
              let instant;
              if (tz === 'UTC') {
                instant = new Date(Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10), h, m));
              } else {
                instant = wallInstant(dayKey, time, tz);
                if (!instant) { gaps.push({ date: dayKey, time, reason: 'Local time does not exist on this day (DST spring-forward); occurrence skipped.' }); continue; }
              }
              if (out.length >= CAP) { truncated = true; break outer; }
              add(dayKey, time, instant.toISOString());
            }
            if (truncated) break;
          }
        }
      }
    }
    out.sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
    Object.defineProperty(out, 'gaps', { value: gaps });
    Object.defineProperty(out, 'truncated', { value: truncated });
    Object.defineProperty(out, 'kind', { value: s.kind || 'none' });
    return out;
  }

  /** Paused/disabled or not-calendar-placeable items, for the separate lists. */
  function isPaused(item) { return !!(item && item.schedule && item.schedule.enabled === false) || item && item.enabled === false; }
  function isUnplaceable(item) {
    const s = item && item.schedule;
    return !!s && (s.kind === 'interval' || s.kind === 'none');
  }

  MC.schedule = { CAP, occurrences, parseCron, originLabel, isPaused, isUnplaceable, dayKeysBetween, wallInstant };
})();
