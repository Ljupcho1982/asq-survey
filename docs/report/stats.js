/* stats.js — the aggregations behind the report.
 *
 * Deliberately mirrors how ACI reports SKP, so your numbers can sit beside
 * theirs: means on the 1–5 scale, N/A excluded rather than counted as zero,
 * category averages weighted by each item's respondent count, and the score
 * distribution as Excellent/Very Good/Good/Fair/Poor.
 */
"use strict";

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("../app/questionnaire.js") : root.Q
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof self !== "undefined" ? self : this, function (Q) {

  function round(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return null;
    const f = Math.pow(10, dp === undefined ? 2 : dp);
    return Math.round(n * f) / f;
  }

  /* A rating counts only if it is a real 1–5. "N/A — did not use" is an absence
     of experience, not a low score; averaging it in would punish an airport for
     a shop the passenger never visited. */
  function ratings(responses, id) {
    const out = [];
    responses.forEach((r) => {
      const v = r.answers[id];
      if (typeof v === "number" && v >= 1 && v <= 5) out.push(v);
    });
    return out;
  }

  function naCount(responses, id) {
    return responses.filter((r) => r.answers[id] === Q.NOT_APPLICABLE).length;
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function itemStat(responses, id, label) {
    const vals = ratings(responses, id);
    return {
      id: id,
      label: label,
      n: vals.length,
      na: naCount(responses, id),
      mean: round(mean(vals)),
      /* Share rating it 4 or 5 — the "top two box" ACI reports alongside means. */
      top2: vals.length ? round(vals.filter((v) => v >= 4).length / vals.length * 100, 1) : null,
      bottom2: vals.length ? round(vals.filter((v) => v <= 2).length / vals.length * 100, 1) : null
    };
  }

  function itemStats(responses) {
    return Q.ITEMS.map((i) => Object.assign(itemStat(responses, i.id, i.short), { cat: i.cat }))
      .filter((s) => s.n > 0 || s.na > 0);
  }

  /* "Average scores by category are based on the average scores of all items
     within the category, weighted by their number of respondents" — ACI, slide 73. */
  function categoryStats(responses) {
    return Q.CATEGORIES.map((c) => {
      const items = Q.itemsIn(c.id).map((i) => itemStat(responses, i.id, i.short))
        .filter((s) => s.n > 0);
      const totalN = items.reduce((a, s) => a + s.n, 0);
      const weighted = totalN
        ? items.reduce((a, s) => a + s.mean * s.n, 0) / totalN
        : null;
      return { id: c.id, name: c.name, n: totalN, items: items, mean: round(weighted) };
    }).filter((c) => c.n > 0);
  }

  function distribution(responses, id) {
    const vals = ratings(responses, id);
    const labels = { 5: "Excellent", 4: "Very good", 3: "Good", 2: "Fair", 1: "Poor" };
    return [5, 4, 3, 2, 1].map((v) => ({
      value: v,
      label: labels[v],
      n: vals.filter((x) => x === v).length,
      pct: vals.length ? round(vals.filter((x) => x === v).length / vals.length * 100, 1) : 0
    }));
  }

  /* Overall satisfaction split by a profiling answer, the way ACI's slide 71
     breaks it down by reason for travel, flight status and so on. */
  function bySegment(responses, profileId, overallId) {
    const id = overallId || "overall_satisfaction";
    const groups = new Map();
    responses.forEach((r) => {
      const raw = r.answers[profileId];
      if (raw === undefined) return;
      const keys = Array.isArray(raw) ? raw : [raw];
      keys.forEach((k) => {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      });
    });
    const p = Q.profile(profileId);
    const order = p && p.options ? p.options : Array.from(groups.keys());
    return order.filter((k) => groups.has(k)).map((k) => {
      const rs = groups.get(k);
      const vals = ratings(rs, id);
      return { key: k, n: rs.length, rated: vals.length, mean: round(mean(vals)) };
    });
  }

  /* How often each item was named among a passenger's 3 most important. */
  function importance(responses) {
    const answered = responses.filter((r) => Array.isArray(r.answers.q11_important) &&
                                             r.answers.q11_important.length);
    const counts = new Map();
    answered.forEach((r) => r.answers.q11_important.forEach((id) => {
      counts.set(id, (counts.get(id) || 0) + 1);
    }));
    return {
      base: answered.length,
      items: Q.ITEMS.map((i) => ({
        id: i.id,
        label: i.short,
        n: counts.get(i.id) || 0,
        pct: answered.length ? round((counts.get(i.id) || 0) / answered.length * 100, 1) : 0
      })).sort((a, b) => b.n - a.n)
    };
  }

  /* The analysis ACI's deck does not give you: an item is only worth acting on
     if passengers care about it AND you score badly. Priority is the gap from
     the mean satisfaction, amplified by how often the item was called important. */
  function actionPriority(responses) {
    const imp = importance(responses);
    const impBy = new Map(imp.items.map((i) => [i.id, i.pct]));
    const stats = itemStats(responses).filter((s) => s.n > 0);
    if (!stats.length) return [];
    const overall = mean(stats.map((s) => s.mean));
    return stats.map((s) => ({
      id: s.id,
      label: s.label,
      mean: s.mean,
      n: s.n,
      importance: impBy.get(s.id) || 0,
      gap: round(s.mean - overall),
      score: round((overall - s.mean) * (impBy.get(s.id) || 0), 2)
    })).sort((a, b) => b.score - a.score);
  }

  function emotions(responses) {
    return Q.EMOTIONS.map((e) => itemStat(responses, e.id, e.label));
  }

  /* Counts for a profiling question, in the questionnaire's own option order so
     age bands and the like never come out shuffled. */
  function profileBreakdown(responses, profileId) {
    const p = Q.profile(profileId);
    const counts = new Map();
    let base = 0;
    responses.forEach((r) => {
      const raw = r.answers[profileId];
      if (raw === undefined) return;
      base++;
      (Array.isArray(raw) ? raw : [raw]).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    });
    const order = (p && p.options ? p.options : Array.from(counts.keys()))
      .filter((k) => counts.has(k));
    Array.from(counts.keys()).forEach((k) => { if (!order.includes(k)) order.push(k); });
    return {
      base: base,
      multi: !!(p && p.type === "multi"),
      rows: order.map((k) => ({
        key: k, n: counts.get(k),
        pct: base ? round(counts.get(k) / base * 100, 1) : 0
      }))
    };
  }

  function comments(responses) {
    const out = [];
    responses.forEach((r) => {
      Q.OPEN_ENDED.forEach((o) => {
        const t = r.answers[o.id];
        if (typeof t === "string" && t.trim()) {
          out.push({ question: o.id, label: o.label, text: t.trim(),
                     at: r.meta.submittedAt, gate: r.meta.gate });
        }
      });
    });
    return out;
  }

  function month(iso) { return String(iso || "").slice(0, 7); }

  /* Period-on-period movement. With one month of data there is nothing to
     compare, and inventing a baseline would be worse than saying so. */
  function trend(responses) {
    const months = Array.from(new Set(responses.map((r) => month(r.meta.submittedAt))))
      .filter(Boolean).sort();
    const series = months.map((m) => {
      const rs = responses.filter((r) => month(r.meta.submittedAt) === m);
      return { month: m, n: rs.length, mean: round(mean(ratings(rs, "overall_satisfaction"))) };
    });
    if (months.length < 2) return { series: series, deltas: null };

    const prev = responses.filter((r) => month(r.meta.submittedAt) === months[months.length - 2]);
    const curr = responses.filter((r) => month(r.meta.submittedAt) === months[months.length - 1]);
    const deltas = Q.ITEMS.map((i) => {
      const a = mean(ratings(prev, i.id)), b = mean(ratings(curr, i.id));
      if (a === null || b === null) return null;
      return { id: i.id, label: i.short, prev: round(a), curr: round(b), delta: round(b - a) };
    }).filter(Boolean).sort((x, y) => y.delta - x.delta);

    return { series: series, deltas: deltas,
             prevMonth: months[months.length - 2], currMonth: months[months.length - 1] };
  }

  function summary(responses) {
    const dates = responses.map((r) => r.meta.submittedAt).filter(Boolean).sort();
    const durations = responses.map((r) => Number(r.meta.durationSeconds))
      .filter((n) => Number.isFinite(n) && n > 0);
    const airports = Array.from(new Set(responses.map((r) => r.meta.airport).filter(Boolean)));
    const gates = Array.from(new Set(responses.map((r) => r.meta.gate).filter(Boolean)));
    const overall = itemStat(responses, "overall_satisfaction", "Overall Satisfaction");
    const experience = itemStat(responses, "overall_experience", "Overall Experience");
    return {
      n: responses.length,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
      airports: airports,
      gates: gates,
      medianDuration: durations.length
        ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
      overall: overall,
      experience: experience,
      distribution: distribution(responses, "overall_satisfaction")
    };
  }

  function build(responses) {
    return {
      summary: summary(responses),
      categories: categoryStats(responses),
      items: itemStats(responses).sort((a, b) => (b.mean || 0) - (a.mean || 0)),
      importance: importance(responses),
      priority: actionPriority(responses),
      emotions: emotions(responses),
      crowd: itemStat(responses, Q.CROWD.id, "Perception of crowd"),
      segments: {
        reason: bySegment(responses, "q3_reason"),
        flight: bySegment(responses, "q15_flight_status"),
        group: bySegment(responses, "q13_group"),
        age: bySegment(responses, "q19_age")
      },
      profile: {
        gender: profileBreakdown(responses, "q20_gender"),
        age: profileBreakdown(responses, "q19_age"),
        group: profileBreakdown(responses, "q13_group"),
        trips: profileBreakdown(responses, "q16_return_trips"),
        transport: profileBreakdown(responses, "q7_transport"),
        parking: profileBreakdown(responses, "q8_parking"),
        checkin: profileBreakdown(responses, "q9_checkin_mode"),
        arrival: profileBreakdown(responses, "q12_arrival_time"),
        reason: profileBreakdown(responses, "q3_reason"),
        connection: profileBreakdown(responses, "q2_connection"),
        status: profileBreakdown(responses, "q15_flight_status")
      },
      trend: trend(responses),
      comments: comments(responses)
    };
  }

  return {
    round, mean, ratings, naCount, itemStat, itemStats, categoryStats, distribution,
    bySegment, importance, actionPriority, emotions, profileBreakdown, comments, trend,
    summary, build
  };
});
