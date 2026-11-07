/* MC core: namespace, registries, icons, Europe/London date helpers. Loaded first. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  MC.version = 'rc1';
  MC.TZ = 'Europe/London';

  /* ---- view + action registries ---- */
  const views = [];
  MC.views = {
    register(v) {
      if (!v || !v.id || typeof v.render !== 'function') throw new Error('bad view');
      const i = views.findIndex((x) => x.id === v.id);
      if (i >= 0) views[i] = v; else views.push(v);
    },
    get: (id) => views.find((v) => v.id === id),
    all: () => views.slice(),
  };
  const actions = {};
  MC.actions = {
    register(name, fn) { actions[name] = fn; },
    run(name, el, ev) { const f = actions[name]; if (f) { f(el, ev); return true; } return false; },
  };

  /* ---- icons (Feather-style paths from the template, see icons.js) ---- */
  MC.icon = function (name, cls) {
    const p = (MC.ICONS && (MC.ICONS[name] || MC.ICONS.grid)) || '';
    return '<svg class="icon-svg' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  };

  /* ---- uid ---- */
  MC.uid = function (prefix) {
    const r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return (prefix ? prefix + '-' : '') + r;
  };

  /* ---- dates, always rendered in Europe/London ---- */
  const dtf = (opts) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: MC.TZ }, opts));
  const fDate = dtf({ day: 'numeric', month: 'short', year: 'numeric' });
  const fDateShort = dtf({ day: 'numeric', month: 'short' });
  const fTime = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
  const fWeekday = dtf({ weekday: 'short' });
  const fParts = dtf({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const fZone = dtf({ timeZoneName: 'short' });

  function parts(d) {
    const o = {};
    for (const p of fParts.formatToParts(d)) o[p.type] = p.value;
    if (o.hour === '24') o.hour = '00';
    return o;
  }
  const isDateOnly = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  // Date-only strings are calendar days, never midnight instants: anchor at 12:00Z for arithmetic.
  const asDate = (v) => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(v);
    if (isDateOnly(v)) return new Date(v + 'T12:00:00Z');
    const d = new Date(v);
    return isNaN(d) ? null : d;
  };

  MC.fmt = {
    isDateOnly,
    asDate,
    /** London calendar day key YYYY-MM-DD for an instant (or passthrough for date-only). */
    dayKey(v) {
      if (isDateOnly(v)) return v;
      const d = asDate(v); if (!d) return null;
      const p = parts(d); return p.year + '-' + p.month + '-' + p.day;
    },
    today() { return MC.fmt.dayKey(new Date()); },
    hm(v) { const d = asDate(v); if (!d || isDateOnly(v)) return ''; return fTime.format(d); },
    date(v) { const d = asDate(v); return d ? fDate.format(d) : 'Unknown date'; },
    dateShort(v) { const d = asDate(v); return d ? fDateShort.format(d) : '—'; },
    weekday(v) { const d = asDate(v); return d ? fWeekday.format(d) : ''; },
    /** "7 Nov 2026, 15:04 GMT" — date-only values never get a time. */
    dateTime(v) {
      const d = asDate(v); if (!d) return 'Unknown';
      if (isDateOnly(v)) return fDate.format(d) + ' (date only)';
      const z = (fZone.formatToParts(d).find((p) => p.type === 'timeZoneName') || {}).value || '';
      return fDate.format(d) + ', ' + fTime.format(d) + ' ' + z;
    },
    zoneAbbr(v) { const d = asDate(v) || new Date(); return (fZone.formatToParts(d).find((p) => p.type === 'timeZoneName') || {}).value || ''; },
    /** whole days from London today to a date (date-only or instant); null if unknown. */
    daysUntil(v) {
      const k = MC.fmt.dayKey(v); if (!k) return null;
      const a = Date.parse(MC.fmt.today() + 'T12:00:00Z'), b = Date.parse(k + 'T12:00:00Z');
      return Math.round((b - a) / 86400000);
    },
    relative(v) {
      const n = MC.fmt.daysUntil(v); if (n == null) return 'no date';
      if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
      return n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago';
    },
    addDays(key, n) { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    /** ISO weekday 1=Mon..7=Sun for a day key. */
    isoDow(key) { const g = new Date(key + 'T12:00:00Z').getUTCDay(); return g === 0 ? 7 : g; },
    /** Monday of the week containing key. */
    weekStart(key) { return MC.fmt.addDays(key, 1 - MC.fmt.isoDow(key)); },
    monthLabel(key) { return dtf({ month: 'long', year: 'numeric' }).format(new Date(key + 'T12:00:00Z')); },
    /** UTC instant for a London wall-clock date+time (handles GMT/BST). */
    londonInstant(dayKey, hhmm) {
      const [h, m] = (hhmm || '00:00').split(':').map(Number);
      let guess = Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10), h, m);
      for (let i = 0; i < 2; i++) {
        const p = parts(new Date(guess));
        const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
        guess -= asUtc - Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10), h, m);
      }
      return new Date(guess);
    },
    plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); },
  };

  /* ---- layout tier (kept in sync by app.js) ---- */
  MC.tier = function () {
    const w = window.innerWidth;
    return w >= 1600 ? 'monitor' : w >= 1024 ? 'laptop' : w >= 768 ? 'tablet' : 'mobile';
  };
})();
