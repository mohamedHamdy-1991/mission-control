/* MC.demo — SYNTHETIC workspace for the public build. Every name, record and link here is fictional.
   Shapes mirror the private feeds exactly (one array per feed + _meta), so every view is exercised
   without any private content. Dates are relative to today so the calendar is always populated.
   Includes deliberate edge cases: paused schedule, cron monthly, once, failed/missed runs,
   date-only deadlines, unknown deadlines, a past deadline, an upstream-changed override,
   and an untrusted-text record (injection probe) that must render inert. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});

  function bundle() {
    const F = MC.fmt, T = F.today(), d = (n) => F.addDays(T, n);
    const at = (n, hm) => F.londonInstant(d(n), hm).toISOString();
    const meta = (source, counts) => ({ source: 'synthetic:' + source, generatedAt: new Date().toISOString(), synthetic: true, counts });

    const agents = [
      { id: 'demo-agent-orbit', name: 'Orbit', title: 'Chief of staff (demo)', model: 'demo-model', chiefOfStaff: true, color: '#7c97d5' },
      { id: 'demo-agent-quill', name: 'Quill', title: 'Literature scout (demo)', model: 'demo-model', color: '#55a69b' },
      { id: 'demo-agent-ledger', name: 'Ledger', title: 'Funding analyst (demo)', model: 'demo-model', color: '#d5a565' },
      { id: 'demo-agent-forge', name: 'Forge', title: 'Research software (demo)', model: 'demo-model', color: '#8660b2' },
      { id: 'demo-agent-echo', name: 'Echo', title: 'Content editor (demo)', model: 'demo-model', color: '#d76d75' },
      { id: 'demo-agent-sage', name: 'Sage', title: 'Quality check (demo)', model: 'demo-model', color: '#759add' },
    ];
    const routines = [
      { id: 'demo-r-brief', name: 'Morning brief (demo)', botId: 'demo-agent-orbit', schedule: { type: 'daily', time: '07:30', weekdays: [0, 1, 2, 3, 4, 5, 6] }, enabled: true, nextRunAt: at(1, '07:30'), promptSummary: 'Summarise yesterday’s synthetic runs and today’s plan.' },
      { id: 'demo-r-lit', name: 'Weekly literature scan (demo)', botId: 'demo-agent-quill', schedule: { type: 'daily', time: '08:30', weekdays: [1] }, enabled: true, promptSummary: 'Collect five illustrative papers for the demo workspace.' },
      { id: 'demo-r-fund', name: 'Funding radar (demo)', botId: 'demo-agent-ledger', schedule: { type: 'daily', time: '08:00', weekdays: [1, 4] }, enabled: true, promptSummary: 'Check fictional calls and update the demo opportunity list.' },
      { id: 'demo-r-month', name: 'Monthly reset (demo)', botId: 'demo-agent-orbit', schedule: { type: 'cron', expression: '30 9 1 * *', timeZone: 'Europe/London' }, enabled: true, promptSummary: 'First-of-month review (cron schedule example).' },
      { id: 'demo-r-once', name: 'One-off submission check (demo)', botId: 'demo-agent-ledger', schedule: { type: 'once', at: Date.parse(at(9, '09:00')) }, enabled: true, promptSummary: 'A single future run (once schedule example).' },
      { id: 'demo-r-paused', name: 'Social ideas (paused demo)', botId: 'demo-agent-echo', schedule: { type: 'daily', time: '09:00', weekdays: [2] }, enabled: false, promptSummary: 'Paused routine — must not produce future calendar occurrences.' },
      { id: 'demo-r-watch', name: 'Hourly watch (demo)', botId: 'demo-agent-orbit', schedule: { type: 'cron', expression: '0 9-18 * * *', timeZone: 'Europe/London' }, enabled: true, checks: ['runs'], checkedAt: Date.now() - 1800e3, promptSummary: 'Checks that find nothing leave no run (heartbeat only).' },
    ];
    const runs = [
      { id: 'demo-run-1', routineId: 'demo-r-brief', routineName: 'Morning brief (demo)', botId: 'demo-agent-orbit', status: 'completed', triggerSource: 'schedule', scheduledFor: at(0, '07:30'), startedAt: at(0, '07:30'), finishedAt: at(0, '07:32'), output: '**Demo brief.** Three synthetic tasks progressed; one review is waiting. See [the example docs](https://example.org/demo).', outputLen: 120 },
      { id: 'demo-run-2', routineId: 'demo-r-lit', routineName: 'Weekly literature scan (demo)', botId: 'demo-agent-quill', status: 'completed', triggerSource: 'schedule', scheduledFor: at(-3, '08:30'), startedAt: at(-3, '09:41'), finishedAt: at(-3, '09:47'), output: 'Five illustrative papers listed (synthetic). Start was 71 minutes late — the host was asleep.', outputLen: 92 },
      { id: 'demo-run-3', routineId: 'demo-r-fund', routineName: 'Funding radar (demo)', botId: 'demo-agent-ledger', status: 'failed', triggerSource: 'schedule', scheduledFor: at(-2, '08:00'), startedAt: at(-2, '08:00'), finishedAt: at(-2, '08:04'), output: 'Demo failure: source page timed out.', outputLen: 36 },
      { id: 'demo-run-4', routineId: 'demo-r-brief', routineName: 'Morning brief (demo)', botId: 'demo-agent-orbit', status: 'missed', triggerSource: 'schedule', scheduledFor: at(-5, '07:30'), startedAt: null, finishedAt: at(-4, '19:30'), output: '', outputLen: 0 },
      { id: 'demo-run-5', routineId: 'demo-r-brief', routineName: 'Morning brief (demo)', botId: 'demo-agent-orbit', status: 'completed', triggerSource: 'schedule', scheduledFor: at(-1, '07:30'), startedAt: at(-1, '07:30'), finishedAt: at(-1, '07:33'), output: 'Untrusted-text probe: <script>alert(1)</script> <img src=x onerror=alert(2)> [click](javascript:alert(3)) [data](data:text/html;base64,PHNjcmlwdD4=) — all of this must show as plain text.', outputLen: 170 },
    ];
    const assignments = [
      { id: 'demo-a-1', requester_run_id: 'demo-run-1', assignee_bot_id: 'demo-agent-sage', status: 'completed', created_at: at(0, '07:31') },
      { id: 'demo-a-2', requester_run_id: 'demo-run-2', assignee_bot_id: 'demo-agent-forge', status: 'running', created_at: at(-3, '09:45') },
    ];
    const chatgptTasks = [
      { taskId: 'demo-task-funding', templateId: 'demo-funding', id: 'demo-funding', title: 'Example funding scan (demo)', description: 'Fictional live ChatGPT task in the demo.', category: 'Opportunities', status: 'queued', priority: 'high', scheduleType: 'weekly', days: [1], time: '08:00', tags: ['Demo'], liveStatus: 'active', route: 'github-inbox', routeLabel: 'Writes a run payload to the private inbox', scheduleSource: { text: 'Mondays at 08:00', timezone: 'Europe/London', verifiedAt: d(-1) }, destination: 'Fictional destination', lastVerifiedRun: null },
      { taskId: 'demo-task-lit', templateId: 'demo-literature', id: 'demo-literature', title: 'Example literature scan (demo)', description: 'Fictional live ChatGPT task in the demo.', category: 'PhD', status: 'queued', priority: 'medium', scheduleType: 'weekly', days: [1], time: '08:30', tags: ['Demo'], liveStatus: 'unverified', route: 'blocked', routeLabel: 'Not connected yet', scheduleSource: { text: 'Weekly on Mondays', timezone: 'Europe/London', verifiedAt: null } },
    ];
    const opp = (o) => Object.assign({ region: 'UK', mode: 'Online', cost: 'Not published / not verified', funding: 'Not confirmed', eligibility: 'Fictional eligibility text', why: 'Synthetic record for the demo.', action: 'Nothing — demo only.', evidence: 'Synthetic', url: 'https://example.org/opportunity', checkedAt: T, verified: T, fit: 60, feasibility: 50, value: 55, affordability: null }, o);
    const opportunities = [
      opp({ id: 'demo-fund-a', title: 'Example Early-Career Fellowship (demo)', category: 'Funding', status: 'Open', deadline: d(6), deadlineTime: '16:00 UK', amount: 'Up to £10,000 (fictional)', fit: 85, feasibility: 60, value: 80, affordability: 100, fundingDeadline: d(6) }),
      opp({ id: 'demo-fund-b', title: 'Example Travel Grant (demo)', category: 'Funding', status: 'Conditional', deadline: d(25), fit: 70, feasibility: 70, value: 50, affordability: 90, related: 'demo-conf-a' }),
      opp({ id: 'demo-fund-c', title: 'Example Large Grant (demo, no date yet)', category: 'Funding', status: 'Upcoming', deadline: null, openingNote: 'Anticipated next spring (fictional)', region: 'International' }),
      opp({ id: 'demo-conf-a', title: 'Example Urban Climate Conference (demo)', category: 'Conference', status: 'Open', deadline: d(40), mode: 'Hybrid', cost: '£250 registration (fictional)', funding: 'Fee waiver for students on request (fictional)', affordability: 60, region: 'International' }),
      opp({ id: 'demo-conf-past', title: 'Example Workshop (demo, deadline passed)', category: 'Conference', status: 'Open', deadline: d(-3) }),
      opp({ id: 'demo-cfp-a', title: 'Example Special Issue CFP (demo)', category: 'Journal CFP', status: 'Verify', deadline: d(75), region: 'Global / online' }),
      opp({ id: 'demo-talk-a', title: 'Example Public Lecture Call (demo)', category: 'Public talk', status: 'Outreach', deadline: null, mode: 'In person' }),
      opp({ id: 'demo-assoc-a', title: 'Example Seminar Network (demo)', category: 'Association', status: 'Watchlist', deadline: null, fit: 40, feasibility: 80, value: 40 }),
    ];
    const reports = [
      { title: 'Opportunity scan — demo week 2', date: d(-2), complete: true, source: 'Synthetic', text: '## Summary\n- Two fictional calls added\n- One fictional call closed\n\nSee [example source](https://example.org/scan).' },
      { title: 'Opportunity scan — demo week 1', date: d(-9), complete: false, source: 'Synthetic', text: 'Partial demo report (retrieval limit example).' },
    ];
    const phdReports = [
      { id: 'demo-lit-2', date: d(-2), title: 'Weekly literature digest — demo week 2', kind: 'literature', provenance: 'synthetic', text: '### Picks\n1. Fictional paper on street-canyon heat\n2. Fictional paper on sensor calibration\n\nNo real citations in the demo.' },
      { id: 'demo-lit-1', date: d(-9), title: 'Weekly literature digest — demo week 1', kind: 'literature', provenance: 'synthetic', text: 'Three fictional papers summarised.' },
    ];
    const publications = [
      { id: 'demo-pub-1', title: 'Example manuscript A (demo)', stage: 'draft', stageDate: d(-20), venue: 'Fictional Journal', evidence: 'Synthetic' },
      { id: 'demo-pub-2', title: 'Example manuscript B (demo)', stage: 'submitted', stageDate: d(-45), venue: 'Fictional Proceedings', evidence: 'Synthetic' },
    ];
    const ledger = { _meta: meta('ledger', {}), sources: [
      { source: 'Demo workspace', imported: agents.length + routines.length + runs.length + opportunities.length, withheld: [], liveBlocked: [], note: 'Synthetic content only — connect a private data repository in Settings to see real data.' },
    ] };

    return {
      feeds: {
        agents: { _meta: meta('agents', { agents: agents.length }), agents },
        routines: { _meta: meta('routines', { routines: routines.length }), routines },
        runs: { _meta: meta('runs', { runs: runs.length }), runs },
        assignments: { _meta: meta('assignments', { assignments: assignments.length }), assignments },
        opportunities: { _meta: Object.assign(meta('opportunities', { opportunities: opportunities.length }), { dataset: { updated: d(-2), nextUpdate: d(5) + ' 08:00', lastSearch: { completedAt: at(-2, '10:00'), scope: 'all', summary: 'Synthetic scan' } } }), opportunities },
        reports: { _meta: meta('reports', { reports: reports.length }), reports },
        chatgptTasks: { _meta: meta('chatgpt', { tasks: chatgptTasks.length }), tasks: chatgptTasks },
        phdReports: { _meta: meta('phd', { reports: phdReports.length }), reports: phdReports },
        publications: { _meta: meta('publications', { publications: publications.length }), publications },
        ledger,
      },
      user: {
        manualTasks: { version: 1, updatedAt: null, tasks: [
          { id: 'manual-demo-1', title: 'Draft slides for a fictional seminar', description: 'Demo manual task.', agentId: 'demo-agent-echo', category: 'Outreach', status: 'working', priority: 'high', scheduleType: 'once', days: [], time: '14:00', date: d(2), tags: ['demo'], link: '', createdAt: at(-1, '10:00'), updatedAt: at(-1, '10:00'), archived: false },
          { id: 'manual-demo-2', title: 'Overdue demo task', description: 'Shows in the overdue view.', agentId: null, category: 'Admin', status: 'queued', priority: 'normal', scheduleType: 'once', days: [], time: null, date: d(-4), tags: [], link: '', createdAt: at(-8, '10:00'), updatedAt: at(-8, '10:00'), archived: false },
        ] },
        board: { version: 1, updatedAt: null, status: { 'mausbot:routine:demo-r-lit': { status: 'review', at: at(-1, '12:00') } }, stage: { 'radar:demo-fund-a': { stage: 'Working on', at: at(-1, '12:00') } }, archived: {} },
        notes: { version: 1, updatedAt: null, notes: { 'radar:demo-fund-a': { text: 'Demo note: ask a fictional supervisor.', at: at(-1, '12:00') } } },
        reminders: { version: 1, updatedAt: null, reminders: [{ id: 'rem-demo-1', key: 'radar:demo-fund-b', date: d(3), time: '09:00', title: 'Check travel grant form (demo)', at: at(-1, '12:00') }] },
        overrides: { version: 1, updatedAt: null, _conflicts: [], overrides: {
          // Overridden against an older base value → shows the "upstream changed" flag.
          'radar:demo-fund-b': { deadline: { value: d(20), baseValue: d(30), at: at(-6, '10:00') } },
        } },
        weights: { version: 1, updatedAt: null, weights: { fit: 30, feasibility: 20, value: 20, urgency: 15, affordability: 10, support: 5 } },
      },
      receipts: [
        { receiptId: 'demo-receipt-1', source: 'codex', runId: 'demo-codex-run-1', title: 'Weekly opportunity scan (demo receipt)', status: 'completed', finishedAt: at(-2, '10:05'), summary: 'Synthetic receipt from a scheduled cloud task.', links: [] },
      ],
    };
  }
  MC.demo = { bundle };
})();
