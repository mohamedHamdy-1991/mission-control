/* Settings view (UI-A): data connection (GitHub private repo / local preview), live sync status in
   plain language, conflicts + upstream flags resolution, source coverage ledger (defensive),
   backup export/import (incl. one-time Research Radar import), shortcut + portrait policy notes. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const { esc: L, attr: A } = MC.sanitize;

  let mode = 'github'; // connection form mode

  const isLocalHost = () => location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  const STATUS_TEXT = {
    demo: ['Demo — not connected', 'You are viewing the synthetic demo workspace. Nothing is synced and nothing leaves this tab; any edits live only in this tab’s memory.'],
    loading: ['Loading…', 'Private data is being fetched from your repository. Values may be a moment behind.'],
    synced: ['Synced', 'The last load and every save succeeded. This page reflects what is currently in your private repository.'],
    saving: ['Saving…', 'Your change is being written to the private repository. It is NOT saved yet — wait for “Synced”.'],
    offline: ['Offline — not saved', 'No network right now. Changes made in this state are kept in this tab and are NOT saved; they retry automatically when you reconnect.'],
    failed: ['Not saved', 'The last save or load did not complete. Unsaved change(s) are still in this tab. Check the connection or token, then press Refresh.'],
    locked: ['Locked', 'No token (or a rejected one). Private data has been cleared from memory; the synthetic demo workspace is shown instead.'],
    stale: ['Stale — partly loaded', 'Some files failed to load, so what you see may be out of date. Refresh to try again; the failure reasons are listed above the status.'],
    conflict: ['Conflict — needs review', 'Another writer changed the same field you changed. Nothing was silently overwritten: your edit and theirs are both kept below for you to choose.'],
  };

  /* re-render when connection status changes while Settings is on screen (registered once) */
  MC.data.onStatus(() => {
    if (String(location.hash).indexOf('#/settings') === 0 && !document.querySelector('.modal-backdrop')) MC.app.render();
  });

  /* ---------- panels ---------- */
  function statusPanel() {
    const st = MC.data.status();
    const cfg = MC.data.config();
    const head = STATUS_TEXT[st.state] || [st.state, 'Current connection state: ' + st.state + '.'];
    const unsaved = st.unsaved ? '<div class="notice error">You have <b>' + st.unsaved + ' unsaved change(s)</b> held in this tab. They are NOT in the repository yet.</div>' : '';
    const detail = st.detail && st.state !== 'demo' ? '<p class="small muted">' + L(st.detail) + '</p>' : '';
    const where = cfg.mode === 'github' ? L(cfg.owner + '/' + cfg.repo + ' @ ' + cfg.branch) :
      cfg.mode === 'local' ? 'Local preview server (this machine only)' : 'Not connected';
    const lastLoad = st.lastLoad ? L(MC.fmt.dateTime(st.lastLoad)) : 'Never in this session';
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Live status</p><h2 class="panel-title">Data connection status</h2></div>' +
      '<div class="panel-actions"><span class="sync-chip" data-state="' + A(st.state) + '"><span class="dot"></span><span class="label">' + L(head[0]) + '</span></span></div></div>' +
      '<div class="section-pad"><div class="stack">' + unsaved +
      '<p class="prose">' + L(head[1]) + '</p>' + detail +
      '<div class="wf-info">' +
      '<div class="wf-field"><span class="wf-field-l">Connected to</span><span class="wf-field-v">' + where + (cfg.hasToken ? ' · token in memory' : '') + '</span></div>' +
      '<div class="wf-field"><span class="wf-field-l">Last full load</span><span class="wf-field-v">' + lastLoad + '</span></div>' +
      '</div></div></div></div>';
  }
  function connectPanel() {
    const local = isLocalHost();
    const seg = '<div class="seg" role="group" aria-label="Connection mode">' +
      '<button data-action="st-mode" data-v="github"' + (mode === 'github' ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>GitHub private repo</button>' +
      (local ? '<button data-action="st-mode" data-v="local"' + (mode === 'local' ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>Local preview server</button>' : '') + '</div>';
    const form = mode === 'github'
      ? '<div class="form-grid">' +
        '<div class="field"><span>Owner</span><input type="text" id="st-owner" autocomplete="off" placeholder="your-username"></div>' +
        '<div class="field"><span>Repository</span><input type="text" id="st-repo" autocomplete="off" placeholder="mission-control-data"></div>' +
        '<div class="field"><span>Branch</span><input type="text" id="st-branch" value="main" autocomplete="off"></div>' +
        '<div class="field full"><span>Token (password field — never stored, never exported)</span>' +
        '<input type="password" id="st-token" autocomplete="new-password" spellcheck="false" placeholder="github_pat_…"></div></div>'
      : '<p class="small muted">Local mode talks to the preview server on this machine (127.0.0.1) — the token is the one printed when the server started. Nothing leaves this computer.</p>' +
        '<div class="field"><span>Token (from the preview server)</span><input type="password" id="st-token" autocomplete="new-password" spellcheck="false" placeholder="preview token"></div>';
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Connect</p><h2 class="panel-title">Private data connection</h2></div></div>' +
      '<div class="section-pad"><div class="stack">' + seg + form +
      '<div class="row wrap">' +
      '<button class="btn primary" data-action="st-connect">' + MC.icon('key') + 'Connect</button>' +
      '<button class="btn" data-action="st-test">' + MC.icon('search') + 'Test connection</button>' +
      '<button class="btn" data-action="refresh">Refresh data</button>' +
      '<button class="btn danger" data-action="st-lock">' + MC.icon('x') + 'Lock &amp; clear memory</button></div>' +
      '<p class="small muted" id="st-error" role="alert"></p>' +
      '<div id="st-diag" class="stack" aria-live="polite"></div>' +
      '<div class="notice info"><b>Token guidance.</b> Create a <b>fine-grained, expiring</b> personal access token scoped to the data repository <b>only</b>, with <b>Contents: read and write</b> and nothing else. The token is typed by you into this page, held in this tab’s memory only, and is never stored, logged, exported or sent anywhere except <code>api.github.com</code>. Locking the app clears it. Nobody can recover it from a backup — backups never contain tokens.</div>' +
      (local ? '' : '<p class="small subtle">“Local preview server” is only offered on a 127.0.0.1/localhost origin; this page is served from “' + L(location.hostname || 'this origin') + '”.</p>') +
      '</div></div></div>';
  }
  function conflictsPanel(m) {
    const docs = MC.state.userDocs();
    const rows = [];
    for (const [file, doc] of Object.entries(docs)) {
      (doc._conflicts || []).forEach((c, index) => rows.push(Object.assign({ file, index }, c)));
    }
    const flags = m.flags || [];
    if (!rows.length && !flags.length) return '';
    const cRows = rows.map((c) => {
      const sv = (v) => L(v === null || v === undefined ? '—' : typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80));
      return '<div class="card"><b>' + L(c.file) + '</b> · <span class="mono">' + L((c.path || []).join(' › ')) + '</span>' +
        '<p class="small muted">Yours: “' + sv(c.ours) + '” · Theirs (already in the file): “' + sv(c.theirs) + '” · ' + L(MC.fmt.dateTime(c.at)) + '</p>' +
        '<div class="row"><button class="btn" data-action="st-conflict" data-file="' + A(c.file) + '" data-index="' + c.index + '" data-choice="mine">Keep mine</button>' +
        '<button class="btn" data-action="st-conflict" data-file="' + A(c.file) + '" data-index="' + c.index + '" data-choice="theirs">Use theirs</button></div></div>';
    }).join('');
    const title = (key) => { const it = MC.state.item(key); return it ? it.title : key; };
    const fRows = flags.map((f) => {
      const sv = (v) => L(v === null || v === undefined ? '—' : typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80));
      return '<div class="card"><b>' + L(title(f.key)) + '</b> · field “' + L(f.field) + '”' +
        '<p class="small muted">Upstream now: “' + sv(f.upstream) + '” · Your saved value: “' + sv(f.ours) + '” (based on “' + sv(f.was) + '”)</p>' +
        '<div class="row"><button class="btn" data-action="st-accept" data-key="' + A(f.key) + '" data-field="' + A(f.field) + '">Accept upstream</button>' +
        '<button class="btn" data-action="st-keep" data-key="' + A(f.key) + '" data-field="' + A(f.field) + '">Keep mine</button></div></div>';
    }).join('');
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Needs your decision</p><h2 class="panel-title">Conflicts &amp; upstream changes</h2></div></div>' +
      '<div class="section-pad"><div class="stack">' +
      (rows.length ? '<h3 class="panel-title">Concurrent edits</h3>' + cRows : '<p class="small subtle">No concurrent-edit conflicts.</p>') +
      '<div class="separator"></div>' +
      (flags.length ? '<h3 class="panel-title">Upstream changed under your edits</h3>' + fRows : '<p class="small subtle">No upstream changes to your overridden fields.</p>') +
      '</div></div></div>';
  }
  function ledgerRows(ledger) {
    if (!ledger) return [];
    if (Array.isArray(ledger)) return ledger;
    if (Array.isArray(ledger.sources)) return ledger.sources;
    const out = [];
    for (const [k, v] of Object.entries(ledger)) {
      if (k === '_meta' || !v || typeof v !== 'object') continue;
      out.push(Object.assign({ source: k }, v));
    }
    return out;
  }
  function num(v) { return (v == null || v === '' ? '—' : String(v)); }
  function listish(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join('; ');
    if (typeof v === 'object') return Object.entries(v).map(([k, n]) => k + (typeof n === 'number' ? ': ' + n : ': ' + JSON.stringify(n))).join('; ');
    return String(v);
  }
  function ledgerPanel(m) {
    const sources = ledgerRows(m.ledger);
    const rows = sources.map((s) => {
      const withheld = listish(s.withheld || s.withheldByReason);
      const live = listish(s.liveBlocked || s.liveBlockedByReason);
      return '<tr><td data-label="Source">' + L(s.source || s.name || 'Unknown source') + '</td>' +
        '<td data-label="Imported">' + L(num(s.imported != null ? s.imported : s.counts && s.counts.imported)) + '</td>' +
        '<td data-label="Deduplicated">' + L(num(s.deduplicated != null ? s.deduplicated : s.dedupe != null ? s.dedupe : s.counts && s.counts.deduplicated)) + '</td>' +
        '<td data-label="Withheld">' + L(num(Array.isArray(s.withheld) ? s.withheld.length : (s.withheldCount != null ? s.withheldCount : (withheld ? '' : '—')))) +
        (withheld ? '<div class="small muted">by reason: ' + L(withheld) + '</div>' : '') + '</td>' +
        '<td data-label="Live-blocked">' + L(num(Array.isArray(s.liveBlocked) ? s.liveBlocked.length : (s.liveBlockedCount != null ? s.liveBlockedCount : (live ? '' : '—')))) +
        (live ? '<div class="small muted">' + L(live) + '</div>' : '') + '</td>' +
        '<td data-label="Note">' + L(s.note || '') + '</td></tr>';
    }).join('');
    const meta = (m.ledger && m.ledger._meta) || null;
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">What was imported</p><h2 class="panel-title">Source coverage</h2></div>' +
      (meta && meta.generatedAt ? '<div class="panel-actions"><span class="badge">Generated ' + L(MC.fmt.dateTime(meta.generatedAt)) + '</span></div>' : '') + '</div>' +
      '<div class="section-pad"><div class="table-wrap"><table class="data collapse"><thead><tr><th>Source</th><th>Imported</th><th>Deduplicated</th><th>Withheld</th><th>Live-blocked</th><th>Note</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6">No import ledger in this workspace.</td></tr>') + '</tbody></table></div>' +
      '<p class="small subtle">Sensitive content is never printed — withheld items are counted by reason only. “Live-blocked” sources (for example Notion pages) keep a dated snapshot instead of a live feed.</p></div></div>';
  }
  function backupPanel() {
    return '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Your data</p><h2 class="panel-title">Backup &amp; restore</h2></div></div>' +
      '<div class="section-pad"><div class="stack">' +
      '<div class="row wrap"><button class="btn primary" data-action="st-export">' + MC.icon('download') + 'Export backup (JSON)</button>' +
      '<label class="btn" for="st-import">' + MC.icon('upload') + 'Import backup (JSON)<input type="file" id="st-import" accept=".json,application/json" data-action="st-import" class="sr-file"></label></div>' +
      '<p class="small muted">The export contains your user lane only — manual tasks, notes, overrides, board stages, reminders and weights. It never contains source feeds, portraits or your access token. In a connected (non-demo) workspace you are warned first, because the file carries private content: keep it private.</p>' +
      '<p class="small muted">Import validates every record before anything is written, refuses files over 10 MB, and asks before replacing newer data with an older backup. A <b>Research Radar</b> browser backup (<code>research-radar-board-*.json</code>) can be imported once to bring in its notes, board stages, reminders, hidden flags, personal edits, custom entries and scoring weights as dashboard data — the Radar site itself is never modified.</p>' +
      '</div></div></div>';
  }
  function helpPanel() {
    const kbd = (k) => '<kbd class="kbd">' + L(k) + '</kbd>';
    return '<div class="grid-auto" style="--min:300px">' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Keyboard shortcuts</h2></div><div class="section-pad"><div class="stack">' +
      '<p>' + kbd('/') + ' Search everything</p>' +
      '<p>' + kbd('n') + ' New task</p>' +
      '<p>' + kbd('f') + ' Full screen</p>' +
      '<p>' + kbd('Esc') + ' Close dialog</p>' +
      '<p>' + kbd('[') + ' / ' + kbd(']') + ' or ' + kbd('←') + ' / ' + kbd('→') + ' — move the focused board card between columns</p>' +
      '<p>' + kbd('Enter') + ' Open the focused card</p>' +
      '</div></div></div>' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Display</h2></div><div class="section-pad"><div class="stack">' +
      '<p class="small muted">Light/dark theme and full screen live on the navigation rail (and the “More” sheet on tablet/mobile). The app fills the whole screen and adapts from ultrawide monitors down to phones; full screen is hidden where the browser does not support it.</p>' +
      '<div class="row wrap"><button class="btn" data-action="toggle-theme">Toggle light / dark</button>' +
      (document.fullscreenEnabled ? '<button class="btn" data-action="fullscreen">Toggle full screen</button>' : '<span class="badge">Full screen unsupported here</span>') + '</div>' +
      '</div></div></div>' +
      '<div class="panel"><div class="panel-head"><h2 class="panel-title">Portrait policy</h2></div><div class="section-pad"><div class="stack">' +
      '<p class="small muted">Agent portraits are fetched only from your private data lane over an authenticated connection, decoded in memory, and never cached to disk or included in backups or the public build. Creator and Reviewer use initials by design. Without a connection you see initials cards — never stock images.</p>' +
      '</div></div></div></div>';
  }

  /* ---------- actions ---------- */
  MC.actions.register('st-mode', (el) => { mode = el.getAttribute('data-v') || 'github'; MC.app.render(); });
  MC.actions.register('st-connect', () => {
    const err = document.getElementById('st-error');
    const say = (msg) => { if (err) err.textContent = msg; };
    say('');
    const token = (document.getElementById('st-token') || {}).value || '';
    const opts = { mode, token };
    if (mode === 'github') {
      opts.owner = (document.getElementById('st-owner') || {}).value || '';
      opts.repo = (document.getElementById('st-repo') || {}).value || '';
      opts.branch = (document.getElementById('st-branch') || {}).value || 'main';
    }
    if (!token.trim()) { say('Enter a token first. It stays in this tab’s memory only.'); return; }
    say('Connecting…');
    MC.app.connect(opts).then(() => {
      say('');
      MC.app.toast('Connected. Private data loaded.');
      MC.app.render();
    }).catch((e) => {
      const why = e && e.code === 'auth' ? 'The token was rejected (401/403). Check the token, its expiry and that it is scoped to this repository with Contents read/write.'
        : e && e.code === 'offline' ? 'Network unreachable — check the connection and try again.'
        : e && e.code === 'notfound' ? 'Repository or branch not found — check owner, repository and branch (the token needs access to it).'
        : (e && e.message) || 'Connection failed.';
      say(why);
      MC.app.toast('Connection failed.', { error: true });
    });
  });
  MC.actions.register('st-test', () => {
    const say = (msg) => { const err = document.getElementById('st-error'); if (err) err.textContent = msg; };
    const box = document.getElementById('st-diag');
    const token = (document.getElementById('st-token') || {}).value || '';
    const opts = { mode, token };
    if (mode === 'github') {
      opts.owner = (document.getElementById('st-owner') || {}).value || '';
      opts.repo = (document.getElementById('st-repo') || {}).value || '';
      opts.branch = (document.getElementById('st-branch') || {}).value || 'main';
    }
    if (box) box.innerHTML = '<p class="small muted">Testing…</p>';
    say('');
    MC.data.diagnose(opts).then((r) => {
      if (!box) return;
      const rows = r.steps.map((s) => {
        const [label, ok, detail] = s;
        const cls = ok === true ? 'green' : ok === false ? 'red' : 'amber';
        const word = ok === true ? 'pass' : ok === false ? 'fail' : 'note';
        return '<li><span class="badge ' + cls + '">' + word + '</span> <b>' + L(label) + '</b> <span class="small muted">' + L(detail || '') + '</span></li>';
      }).join('');
      box.innerHTML = '<div class="panel"><div class="panel-head"><div><p class="panel-kicker">Diagnostic</p><h2 class="panel-title">' +
        (r.ok ? 'Connection ready — press Connect' : 'Connection blocked') + '</h2></div></div>' +
        '<div class="section-pad"><ul class="plain-list">' + rows + '</ul>' +
        (r.ok ? '<p class="small muted">Everything the dashboard needs is reachable. Press <b>Connect</b> to load your agents, routines and runs.</p>'
              : '<p class="small muted">Fix the first failing row above, then test again. Nothing has been saved or sent anywhere but api.github.com.</p>') +
        '</div></div>';
    }).catch((e) => { if (box) box.innerHTML = '<p class="small muted">Diagnostic failed: ' + L(e.message) + '</p>'; });
  });
  MC.actions.register('st-lock', (el, ev) => {
    MC.app.confirm('Lock now? The token and every private byte in this tab are cleared and the synthetic demo workspace is shown. Unsaved changes are discarded.', 'Lock & clear').then((ok) => {
      if (ok) MC.app.lock();
    });
  });
  MC.actions.register('st-conflict', (el) => {
    const file = el.getAttribute('data-file'), index = +el.getAttribute('data-index'), choice = el.getAttribute('data-choice');
    MC.state.resolveConflict(file, index, choice)
      .then(() => MC.app.toast(choice === 'mine' ? 'Kept your value.' : 'Kept the other writer’s value.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('st-accept', (el) => {
    const key = el.getAttribute('data-key'), f = el.getAttribute('data-field');
    MC.state.acceptUpstream(key, f).then(() => MC.app.toast('Upstream value accepted.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('st-keep', (el) => {
    const key = el.getAttribute('data-key'), f = el.getAttribute('data-field');
    MC.state.keepMine(key, f).then(() => MC.app.toast('Kept your value; re-based on the new upstream data.'))
      .catch((e) => MC.app.toast(e.message, { error: true }));
  });
  MC.actions.register('st-export', () => { MC.backup.exportJSON(); });
  MC.actions.register('st-import', (el) => {
    const f = el.files && el.files[0];
    if (!f) return;
    MC.backup.importFile(f).finally(() => { el.value = ''; });
  });

  /* ---------- render ---------- */
  function render(el, ctx) {
    const m = ctx.model || MC.state.get();
    ctx.setTitle('Settings', MC.state.mode() === 'demo' ? 'Synthetic demo workspace' : 'Mohamed’s workspace');
    el.innerHTML = '<div class="view-inner">' +
      statusPanel() + connectPanel() + conflictsPanel(m) + ledgerPanel(m) + backupPanel() + helpPanel() +
      '</div>';
  }

  MC.views.register({ id: 'settings', render });
})();
