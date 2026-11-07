/* MC.ics — RFC 5545 export of calendar events (no network, no third-party code).
   - CRLF line endings, lines folded at 75 octets (continuations start with one space).
   - TEXT escaping: backslash, semicolon, comma, newline.
   - VTIMEZONE Europe/London (GMT standard / BST daylight, EU last-Sunday rules).
   - Date-only events: DTSTART;VALUE=DATE + DTEND;VALUE=DATE (next day) — never a guessed time.
   - Timed events: DTSTART;TZID=Europe/London:YYYYMMDDTHHMMSS (London wall clock).
   - UID stable from event key + date (+ time) + '@mission-control'.
   Event shape: {key, date:'YYYY-MM-DD', time:'HH:MM'|null, allDay, title, type, typeLabel,
                 source, agent?, description?, durationMin?} */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const CRLF = '\r\n';
  const PRODID = '-//Mission Control//Calendar//EN';

  const VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/London',
    'X-LIC-LOCATION:Europe/London',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  /** RFC 5545 TEXT escaping. */
  function escText(s) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function utf8Len(ch) {
    const c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  /** Fold one content line at 75 octets; continuation lines begin with a single space. */
  function fold(line) {
    const chars = Array.from(line);
    const out = [];
    let cur = '', len = 0, limit = 75;
    for (const ch of chars) {
      const n = utf8Len(ch);
      if (len + n > limit) { out.push(cur); cur = ' ' + ch; len = 1 + n; limit = 75; }
      else { cur += ch; len += n; }
    }
    out.push(cur);
    return out.join(CRLF);
  }
  const compactDate = (k) => k.replace(/-/g, '');
  function nextDay(k) { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  /** London wall-clock end = start + minutes (rolls the date when passing midnight). */
  function addWall(dayKey, hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    let total = h * 60 + m + minutes, day = dayKey;
    while (total >= 1440) { total -= 1440; day = nextDay(day); }
    return { day, time: String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0') };
  }
  const wallStamp = (day, hhmm) => compactDate(day) + 'T' + hhmm.replace(':', '') + '00';
  function utcStamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
  function uidFor(ev) {
    const base = String(ev.key || ev.title || 'event').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 160);
    return base + '-' + compactDate(ev.date) + (ev.time ? '-' + ev.time.replace(':', '') : '') + '@mission-control';
  }

  /**
   * Build a VCALENDAR string.
   * @param events array of event objects (shape above)
   * @param opts {name, now: Date} — `now` only used for DTSTAMP.
   */
  function build(events, opts) {
    const o = opts || {};
    const stamp = utcStamp(o.now instanceof Date ? o.now : new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + PRODID, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escText(o.name || 'Mission Control'), 'X-WR-TIMEZONE:Europe/London'].concat(VTIMEZONE);
    const seen = new Set();
    for (const ev of events || []) {
      if (!ev || !ev.date || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) continue; // unknown dates are never exported
      const uid = uidFor(ev);
      if (seen.has(uid)) continue;
      seen.add(uid);
      const allDay = ev.allDay || !ev.time;
      const descParts = ['Type: ' + (ev.typeLabel || ev.type || 'event'), 'Source: ' + (ev.source || 'unknown')];
      if (ev.agent) descParts.push('Agent: ' + ev.agent);
      if (ev.origin) descParts.push('Schedule: ' + ev.origin);
      if (allDay && ev.type === 'deadline') descParts.push('All-day marker; see official source for exact time');
      if (ev.deadlineTime) descParts.push('Published time: ' + ev.deadlineTime);
      if (ev.description) descParts.push(String(ev.description));
      lines.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp);
      if (allDay) {
        lines.push('DTSTART;VALUE=DATE:' + compactDate(ev.date), 'DTEND;VALUE=DATE:' + compactDate(nextDay(ev.date)));
      } else {
        const end = addWall(ev.date, ev.time, ev.durationMin > 0 ? ev.durationMin : 30);
        lines.push('DTSTART;TZID=Europe/London:' + wallStamp(ev.date, ev.time), 'DTEND;TZID=Europe/London:' + wallStamp(end.day, end.time));
      }
      lines.push('SUMMARY:' + escText(ev.title || 'Untitled'), 'DESCRIPTION:' + escText(descParts.join('\n')),
        'CATEGORIES:' + escText(ev.typeLabel || ev.type || 'Event'), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join(CRLF) + CRLF;
  }

  /** Build and download as mission-control-calendar-YYYY-MM-DD.ics (London date). */
  function download(events, opts) {
    const text = build(events, opts);
    const name = 'mission-control-calendar-' + MC.fmt.today() + '.ics';
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { name, text, count: (text.match(/BEGIN:VEVENT/g) || []).length };
  }

  MC.ics = { PRODID, build, download, escText, fold, uidFor };
})();
