/* MC.score — Research Radar scoring reproduced verbatim from notes/RADAR_AUDIT.md §4.
   The score is derived, never stored: score = round(Σ(weight×component) / Σweight).
   Components fit/feasibility/value/affordability come from the record (null → 0 contribution);
   urgency is recomputed from deadline bands (London today, noon anchor via MC.fmt.daysUntil);
   support = 80 iff fundingDeadline || related || id ∈ the private feed's scoringSupportIds, else 0.
   Unranked (null) when fit/feasibility/value is null or the effective status is Closed.
   Stored editorial components are NEVER mutated here. */
(function () {
  'use strict';
  const MC = (window.MC = window.MC || {});

  const DEFAULT_WEIGHTS = { fit: 30, feasibility: 20, value: 20, urgency: 15, affordability: 10, support: 5 };
  const KEYS = ['fit', 'feasibility', 'value', 'urgency', 'affordability', 'support'];
  const LABELS = {
    fit: 'Research fit', feasibility: 'Feasibility', value: 'Academic / professional value',
    urgency: 'Deadline urgency', affordability: 'Affordability', support: 'Support route',
  };
  // Editorially stored 0–100 ratings; null means "unknown", shown as (unknown), contributes 0.
  const EDITORIAL = ['fit', 'feasibility', 'value', 'affordability'];
  const DEMOTABLE = ['Open', 'Upcoming', 'Conditional', 'Verify'];
  // Record ids with a built-in support route are private data: they come from the private Radar feed
  // (_meta.dataset.scoringSupportIds), never from this public file. setSupportIds() exists for tests.
  let overrideIds = null;
  function supportIds() {
    if (overrideIds) return overrideIds;
    const m = MC.state && MC.state.get && MC.state.get();
    const ids = m && m.radarMeta && m.radarMeta.dataset && m.radarMeta.dataset.scoringSupportIds;
    return Array.isArray(ids) ? ids : [];
  }

  /** days until deadline from London "today" (noon anchor) — null when the deadline is unknown. */
  function days(r) { return MC.fmt.daysUntil(r && r.deadline); }

  /**
   * Component values, 0–100 each. Mirrors dist/app.js values() exactly:
   *   urgency: null or past → 0; ≤7 → 100; ≤14 → 90; ≤30 → 75; ≤60 → 50; else 25.
   *   support: 80 iff fundingDeadline || related || id ∈ scoringSupportIds; else 0.
   * @param r record; @param today optional YYYY-MM-DD override (defaults to London today).
   */
  function values(r, today) {
    const d = today ? (function () {
      const a = Date.parse(todayKey(today) + 'T12:00:00Z'), b = Date.parse(String(r.deadline).slice(0, 10) + 'T12:00:00Z');
      return isNaN(b) ? null : Math.round((b - a) / 86400000);
    })() : MC.fmt.daysUntil(r && r.deadline);
    return {
      fit: r.fit == null ? 0 : r.fit,
      feasibility: r.feasibility == null ? 0 : r.feasibility,
      value: r.value == null ? 0 : r.value,
      affordability: r.affordability == null ? 0 : r.affordability,
      urgency: d === null || d < 0 ? 0 : d <= 7 ? 100 : d <= 14 ? 90 : d <= 30 ? 75 : d <= 60 ? 50 : 25,
      support: (r && (r.fundingDeadline || r.related)) || (r && supportIds().includes(r.id)) ? 80 : 0,
    };
  }
  function todayKey(t) { return String(t).slice(0, 10); }

  /**
   * Dynamic closure: a past deadline demotes Open/Upcoming/Conditional/Verify to Closed for
   * display, filtering and scoring. 'My task' records are exempt. Published status untouched.
   */
  function effectiveStatus(r, today) {
    if (!r) return '';
    if (r.category === 'My task') return r.status;
    const d = today ? (function () {
      const b = Date.parse(String(r.deadline).slice(0, 10) + 'T12:00:00Z');
      return isNaN(b) ? null : Math.round((b - Date.parse(todayKey(today) + 'T12:00:00Z')) / 86400000);
    })() : MC.fmt.daysUntil(r.deadline);
    return r.deadline && d != null && d < 0 && DEMOTABLE.includes(r.status) ? 'Closed' : r.status;
  }

  /** Rounded 0–100 integer, or null = Unranked (null editorial core, or effectively Closed). */
  function score(r, weights, today) {
    const w = weights || (MC.state && MC.state.get() ? MC.state.get().weights : null) || DEFAULT_WEIGHTS;
    if (r.fit == null || r.feasibility == null || r.value == null || effectiveStatus(r, today) === 'Closed') return null;
    const v = values(r, today);
    let sum = 0;
    for (const k of KEYS) sum += (w[k] == null ? DEFAULT_WEIGHTS[k] : w[k]);
    if (!sum) return 0;
    let n = 0;
    for (const k of KEYS) n += (w[k] == null ? DEFAULT_WEIGHTS[k] : w[k]) * v[k];
    return Math.round(n / sum);
  }

  /** Full breakdown for the <details> panel: all six components /100 with (unknown) markers. */
  function breakdown(r, weights, today) {
    const w = weights || (MC.state && MC.state.get() ? MC.state.get().weights : null) || DEFAULT_WEIGHTS;
    const v = values(r, today);
    const total = score(r, weights, today);
    let sum = 0;
    for (const k of KEYS) sum += (w[k] == null ? DEFAULT_WEIGHTS[k] : w[k]);
    const components = KEYS.map((k) => {
      const weight = w[k] == null ? DEFAULT_WEIGHTS[k] : w[k];
      const unknown = EDITORIAL.includes(k) && (r[k] == null);
      const contribution = sum ? Math.round((weight * v[k]) / sum) : 0;
      return { key: k, label: LABELS[k], value: v[k], unknown, weight, pct: sum ? Math.round((weight / sum) * 100) : 0, contribution };
    });
    return { score: total, unranked: total == null, components, weightSum: sum, effectiveStatus: effectiveStatus(r, today) };
  }

  MC.score = { setSupportIds(ids) { overrideIds = Array.isArray(ids) ? ids.slice() : null; }, supportIds, DEFAULT_WEIGHTS, KEYS, LABELS, values, score, effectiveStatus, breakdown };
})();
