/* MC.data — private data lane client.
   Modes: 'demo' (synthetic, in-memory) · 'local' (preview server on 127.0.0.1, Contents-compatible API)
          · 'github' (https://api.github.com Contents API, private repo).
   The token lives only in this closure for the session: never in storage, URLs, logs or exports. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});
  const GITHUB_API = 'https://api.github.com';
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
  const MAX_FILE = 5 * 1024 * 1024;

  let TOKEN = null;              // session memory only
  let cfg = { mode: 'demo', apiBase: null, owner: null, repo: null, branch: 'main' };
  const shas = {};               // path -> blob sha last read
  const docs = {};               // path -> last read JSON (merge base)
  const portraits = {};          // path -> data URL (memory only)
  const queues = {};             // path -> promise chain (serialise writes per file)
  const unsaved = [];            // {path, ops} kept while offline/failed
  let status = { state: 'demo', detail: 'Synthetic demo workspace — nothing is synced', at: null, lastLoad: null };
  const listeners = new Set();

  function setStatus(state, detail) {
    status = Object.assign({}, status, { state, detail: detail || '', at: new Date().toISOString() });
    for (const fn of listeners) { try { fn(status); } catch (e) { /* ignore */ } }
  }

  /* ---------- origin allowlist ---------- */
  function resolveBase(mode) {
    if (mode === 'github') return GITHUB_API;
    if (mode === 'local') {
      if (!LOCAL_HOSTS.includes(location.hostname)) throw new Error('Local data mode is only available on a 127.0.0.1 preview origin.');
      return location.origin + '/api';
    }
    throw new Error('Unknown mode');
  }
  function assertAllowed(url) {
    const u = new URL(url);
    const ok = (u.origin === GITHUB_API && cfg.mode === 'github') ||
      (cfg.mode === 'local' && u.origin === location.origin && LOCAL_HOSTS.includes(u.hostname) && u.pathname.startsWith('/api/'));
    if (!ok) throw new Error('Blocked request to non-allowlisted origin');
    if (/[?&](access_token|token)=/i.test(u.search)) throw new Error('Token must never travel in a URL');
  }
  const validName = (s) => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(s);
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  /* ---------- base64 utf-8 ---------- */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeBytes(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  /* ---------- HTTP ---------- */
  async function api(method, path, body) {
    if (!TOKEN) { setStatus('locked', 'Private data is locked — enter a token in Settings.'); const e = new Error('locked'); e.code = 'locked'; throw e; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline', 'Offline — changes are kept in this tab and are NOT saved.'); const e = new Error('offline'); e.code = 'offline'; throw e; }
    const url = cfg.apiBase + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' + encPath(path) +
      (method === 'GET' ? '?ref=' + encodeURIComponent(cfg.branch) : '');
    assertAllowed(url);
    let res;
    try {
      res = await fetch(url, {
        method, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN, 'X-GitHub-Api-Version': '2022-11-28' },
          body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { const err = new Error('network'); err.code = 'offline'; throw err; }
    if (res.status === 401 || res.status === 403) { const e = new Error('unauthorised'); e.code = 'auth'; e.status = res.status; throw e; }
    if (res.status === 404) { const e = new Error('not found'); e.code = 'notfound'; e.status = 404; throw e; }
    if (res.status === 409 || res.status === 422) { const e = new Error('sha conflict'); e.code = 'conflict'; e.status = res.status; throw e; }
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.code = 'http'; e.status = res.status; throw e; }
    return res.json();
  }
  async function getRaw(path) {
    const j = await api('GET', path);
    if (Array.isArray(j) || j.type !== 'file') throw new Error('not a file: ' + path);
    if (j.size > MAX_FILE) throw new Error('file too large: ' + path);
    shas[path] = j.sha;
    return { bytes: b64decodeBytes(j.content || ''), sha: j.sha };
  }
  async function getJSON(path) {
    const { bytes, sha } = await getRaw(path);
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    docs[path] = JSON.parse(JSON.stringify(doc));
    return { doc, sha };
  }
  async function putJSON(path, doc, sha, message) {
    const body = { message: message || ('Mission Control: update ' + path), content: b64encode(JSON.stringify(doc, null, 2) + '\n'), branch: cfg.branch };
    if (sha) body.sha = sha;
    const j = await api('PUT', path, body);
    shas[path] = j.content && j.content.sha; docs[path] = JSON.parse(JSON.stringify(doc));
    return shas[path];
  }

  /* ---------- load ---------- */
  async function loadAll() {
    if (cfg.mode === 'demo') {
      const b = (MC.demo && MC.demo.bundle) ? MC.demo.bundle() : { feeds: {}, user: {} };
      setStatus('demo', 'Synthetic demo workspace — nothing is synced');
      return b;
    }
    setStatus('loading', 'Loading private data…');
    try {
      const { doc: index } = await getJSON('feeds/meta/feeds-index.json');
      // Load feeds, meta, user lane and receipts; portraits load lazily; machine cursors are not for the browser.
      const files = (index.files || []).filter((f) => f && typeof f.path === 'string' && !f.path.includes('..') &&
        ['feed', 'meta', 'user', 'receipt'].includes(f.kind) && f.path !== 'feeds/meta/feeds-index.json');
      const bundle = { feeds: {}, user: {}, receipts: [], index };
      let i = 0; const errs = [];
      const worker = async () => {
        while (i < files.length) {
          const f = files[i++];
          try {
            const { doc } = await getJSON(f.path);
            if (f.kind === 'user') bundle.user[f.path] = doc;
            else if (f.kind === 'receipt') bundle.receipts.push(doc);
            else bundle.feeds[f.path] = doc;
          } catch (e) { if (e.code === 'auth' || e.code === 'locked') throw e; errs.push(f.path + ': ' + e.message); }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // user files absent from the index: read directly (may 404 on first run → blank)
      for (const spec of Object.values(MC.state.USER_FILES)) {
        if (bundle.user[spec.path]) continue;
        try { bundle.user[spec.path] = (await getJSON(spec.path)).doc; } catch (e) { if (e.code !== 'notfound') errs.push(spec.path + ': ' + e.message); }
      }
      status.lastLoad = new Date().toISOString();
      if (errs.length) setStatus('stale', errs.length + ' file(s) failed to load — showing what loaded. ' + errs.slice(0, 2).join('; '));
      else setStatus(unsaved.length ? 'failed' : 'synced', unsaved.length ? unsaved.length + ' unsaved change(s)' : 'Loaded ' + files.length + ' files · ' + MC.fmt.dateTime(status.lastLoad));
      bundle.portraitIndex = (index.files || []).filter((f) => f.kind === 'portrait');
      return bundle;
    } catch (e) {
      if (e.code === 'auth') setStatus('locked', 'Token rejected (401/403). Private data stays locked.');
      else if (e.code === 'offline') setStatus('offline', 'Offline — cannot load private data.');
      else if (e.code !== 'locked') setStatus('failed', 'Load failed: ' + e.message);
      throw e;
    }
  }

  async function portrait(path) {
    if (!path || cfg.mode === 'demo' || !TOKEN) return '';
    if (portraits[path]) return portraits[path];
    if (!/^portraits\/[A-Za-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$/.test(path)) return '';
    const { bytes } = await getRaw(path);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    portraits[path] = 'data:' + mime + ';base64,' + btoa(bin);
    return portraits[path];
  }

  /* ---------- save (op-based, SHA-conditional, merge on conflict) ---------- */
  function saveUser(path, ops, localDoc) {
    if (cfg.mode === 'demo') return Promise.resolve({ doc: localDoc, saved: false, demo: true });
    const run = () => doSave(path, ops);
    const q = (queues[path] || Promise.resolve()).then(run, run);
    queues[path] = q.catch(() => {});
    return q;
  }
  async function doSave(path, ops) {
    const { getPath, applyOps, same } = MC.ops;
    setStatus('saving', 'Saving ' + path + '…');
    let base = docs[path]; let sha = shas[path];
    if (!base) {
      try { const r = await getJSON(path); base = r.doc; sha = r.sha; }
      catch (e) { if (e.code === 'notfound') { base = blankFor(path); sha = null; } else return fail(path, ops, e); }
    }
    const basedOn = ops.map((op) => JSON.stringify(getPath(base, op.path) === undefined ? null : getPath(base, op.path)));
    let attempt = 0, doc = applyOps(JSON.parse(JSON.stringify(base)), ops), conflicts = 0;
    for (;;) {
      try {
        await putJSON(path, doc, sha);
        const left = unsaved.findIndex((u) => u.path === path); if (left >= 0) unsaved.splice(left, 1);
        setStatus(conflicts ? 'conflict' : 'synced', conflicts ? conflicts + ' concurrent change(s) to the same field kept the other writer’s value — review in Settings › Conflicts.' : 'Saved ' + path + ' · ' + MC.fmt.hm(new Date()));
        return { doc, saved: true, conflicts };
      } catch (e) {
        if (e.code !== 'conflict' || ++attempt > 3) return fail(path, ops, e);
        // Re-read the newer remote and re-apply only ops whose target did not change underneath us.
        let latest;
        try { const r = await getJSON(path); latest = r.doc; sha = r.sha; } catch (e2) { return fail(path, ops, e2); }
        if (latest.updatedAt && doc.updatedAt && latest.updatedAt > doc.updatedAt && !ops.length) return { doc: latest, saved: false };
        const merged = JSON.parse(JSON.stringify(latest));
        merged._conflicts = Array.isArray(merged._conflicts) ? merged._conflicts : [];
        const keepOps = [];
        ops.forEach((op, i) => {
          const theirs = getPath(latest, op.path);
          if (op.push || JSON.stringify(theirs === undefined ? null : theirs) === basedOn[i]) keepOps.push(op);
          else if (!same(theirs, op.delete ? undefined : op.value)) {
            conflicts++;
            merged._conflicts.push({ path: op.path, ours: op.delete ? null : op.value, theirs: theirs === undefined ? null : theirs, at: new Date().toISOString(), by: 'browser' });
          }
        });
        doc = applyOps(merged, keepOps);
      }
    }
  }
  function blankFor(path) {
    const spec = Object.values(MC.state.USER_FILES).find((s) => s.path === path);
    return spec ? spec.blank() : { version: 1, updatedAt: null };
  }
  function fail(path, ops, e) {
    unsaved.push({ path, ops, at: new Date().toISOString() });
    if (e.code === 'offline') setStatus('offline', 'Offline — ' + unsaved.length + ' change(s) NOT saved; they will retry when you reconnect.');
    else if (e.code === 'auth' || e.code === 'locked') setStatus('locked', 'Not saved: private data is locked.');
    else setStatus('failed', 'Not saved (' + e.message + '). ' + unsaved.length + ' change(s) pending.');
    const err = new Error('Not saved: ' + e.message); err.code = e.code; throw err;
  }
  async function retryUnsaved() {
    const items = unsaved.splice(0, unsaved.length);
    for (const u of items) { try { await saveUser(u.path, u.ops); } catch (e) { /* re-queued by fail() */ } }
  }
  window.addEventListener('online', () => { if (unsaved.length && TOKEN) retryUnsaved(); });
  window.addEventListener('offline', () => { if (cfg.mode !== 'demo') setStatus('offline', 'Offline — edits will not be saved until you reconnect.'); });

  /**
   * Diagnostic used by Settings › Test connection. Runs the same authenticated GETs the loader uses,
   * one at a time, and reports the exact step that fails. Never touches storage; the token stays in memory.
   * opts: {mode, owner, repo, branch, token} — same shape as connect(), but nothing is committed on failure.
   */
  async function diagnose(opts) {
    const steps = [];
    const prev = { cfg, token: TOKEN };
    try {
      const mode = opts.mode === 'local' ? 'local' : 'github';
      const apiBase = resolveBase(mode);
      const owner = mode === 'local' ? 'local' : String(opts.owner || '').trim();
      const repo = mode === 'local' ? 'private' : String(opts.repo || '').trim();
      const branch = String(opts.branch || 'main').trim();
      const tok = String(opts.token || '').trim();
      steps.push(['Token present', !!tok && tok.length >= 20 && !/\s/.test(tok), tok ? 'shape ok (' + tok.length + ' chars)' : 'no token typed']);
      if (!steps[steps.length - 1][1]) return { ok: false, steps };
      cfg = { mode, apiBase, owner, repo, branch }; TOKEN = tok;
      // 1. who is this token?
      try {
        const r = await fetch(GITHUB_API + '/user', { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN } });
        const j = r.ok ? await r.json() : {};
        steps.push(['Token recognised by GitHub', r.ok, r.ok ? ('signed in as ' + (j.login || '?')) : ('HTTP ' + r.status)]);
        if (!r.ok) return { ok: false, steps, code: 'auth' };
      } catch (e) { steps.push(['Token recognised by GitHub', false, 'network blocked: ' + e.message]); return { ok: false, steps, code: 'offline' }; }
      // 2. does this token see the repository, and can it write?
      try {
        const r = await fetch(GITHUB_API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN } });
        const j = r.ok ? await r.json() : {};
        const perms = j.permissions || {};
        steps.push(['Repository readable', r.ok, r.ok ? (owner + '/' + repo + (j.private ? ' (private)' : ' (PUBLIC — wrong repo?)')) : ('HTTP ' + r.status + (r.status === 404 ? ' — token not scoped to this repo' : ''))]);
        if (!r.ok) return { ok: false, steps, code: 'notfound' };
        steps.push(['Contents: read permission', j.permissions ? perms.pull === true : 'unknown', j.permissions ? ('pull=' + perms.pull) : 'not reported by GitHub for this token type']);
        steps.push(['Contents: read/write permission', j.permissions ? perms.push === true : 'unknown', j.permissions ? ('push=' + perms.push) : 'not reported by GitHub for this token type']);
        if (j.permissions && perms.push !== true) steps.push(['NOTE', false, 'Read-only token: the dashboard will load but cannot save edits']);
      } catch (e) { steps.push(['Repository readable', false, 'network error: ' + e.message]); return { ok: false, steps, code: 'offline' }; }
      // 3. is the data index there and does it list files?
      try {
        const r = await fetch(GITHUB_API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/feeds/meta/feeds-index.json?ref=' + encodeURIComponent(branch),
          { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN } });
        if (!r.ok) { steps.push(['Data index present (branch ' + branch + ')', false, 'HTTP ' + r.status]); return { ok: false, steps, code: r.status === 404 ? 'notfound' : 'http' }; }
        const j = await r.json();
        const txt = atob(String(j.content || '').replace(/\s/g, ''));
        let idx = null; try { idx = JSON.parse(new TextDecoder().decode(Uint8Array.from(txt, (c) => c.charCodeAt(0)))); } catch (e) { steps.push(['Data index parses', false, 'not valid JSON']); return { ok: false, steps }; }
        const files = (idx.files || []).filter((f) => ['feed', 'meta', 'user', 'receipt'].includes(f.kind));
        steps.push(['Data index present (branch ' + branch + ')', true, files.length + ' loadable files listed']);
        const agentFeed = files.some((f) => f.path === 'feeds/mausbot/agents.json');
        steps.push(['MausBot agent feed listed', agentFeed, agentFeed ? 'feeds/mausbot/agents.json' : 'missing — run the sync agent once']);
      } catch (e) { steps.push(['Data index present (branch ' + branch + ')', false, 'network error: ' + e.message]); return { ok: false, steps, code: 'offline' }; }
      return { ok: steps.every((s) => s[1] !== false || s[0] === 'NOTE'), steps };
    } finally {
      cfg = prev.cfg; TOKEN = prev.token;
    }
  }

  MC.data = {
    GITHUB_API, diagnose,
    status: () => Object.assign({}, status, { unsaved: unsaved.length }),
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    config: () => Object.assign({}, cfg, { hasToken: !!TOKEN }),
    /** Connect with an owner-typed token. Token is validated by shape, held in memory only. */
    connect(opts) {
      const mode = opts.mode === 'local' ? 'local' : 'github';
      const apiBase = resolveBase(mode);
      const owner = mode === 'local' ? 'local' : String(opts.owner || '').trim();
      const repo = mode === 'local' ? 'private' : String(opts.repo || '').trim();
      const branch = String(opts.branch || 'main').trim();
      if (!validName(owner) || !validName(repo) || !/^[A-Za-z0-9_./-]{1,100}$/.test(branch)) throw new Error('Owner, repository or branch is not valid.');
      const tok = String(opts.token || '').trim();
      if (!tok || tok.length < 20 || tok.length > 400 || /\s/.test(tok)) throw new Error('Token is missing or malformed.');
      TOKEN = tok;
      cfg = { mode, apiBase, owner, repo, branch };
      for (const k of Object.keys(shas)) delete shas[k];
      for (const k of Object.keys(docs)) delete docs[k];
      return MC.data.config();
    },
    /** Forget the token and every private byte held in memory. */
    lock() {
      TOKEN = null;
      for (const o of [shas, docs, portraits]) for (const k of Object.keys(o)) delete o[k];
      unsaved.splice(0, unsaved.length);
      cfg = Object.assign({}, cfg, { mode: 'demo' });
      setStatus('demo', 'Locked — private data cleared from memory; showing the synthetic workspace.');
    },
    loadAll, saveUser, portrait, retryUnsaved,
    _test: { assertAllowed, b64encode },
  };
})();
