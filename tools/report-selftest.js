/* report-selftest.js — the CSV round-trip and the aggregations, without a browser.
 *
 * The load-bearing property is the round-trip: a response written by the kiosk
 * must come back out of its own CSV unchanged. Everything the report says rests
 * on that, so it is tested against real Submit.csvRow output rather than
 * hand-written CSV.
 *
 * node tools/report-selftest.js
 */
"use strict";

const path = require("path");
const www = (f) => path.join(__dirname, "..", "www", f);
const rep = (f) => path.join(__dirname, "..", "docs", "report", f);

const Q = require(www("questionnaire.js"));
const Submit = require(www("submit.js"));
const Parse = require(rep("parse.js"));
const Stats = require(rep("stats.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + extra : "")); }
}
function group(name) { console.log("\n" + name); }

const settings = { airport: "SKP", terminal: "T1", gate: "A3" };

function makeResponse(over, when) {
  const a = Object.assign({
    q1_destination: "Vienna", q2_connection: "No", q3_reason: "Business",
    q7_transport: "Taxi/Limo", q8_parking: "Not used",
    q9_checkin_mode: ["Online / Mobile check-in"],
    q12_arrival_time: "2 hrs – 3 hrs", q13_group: ["Alone"],
    q15_flight_status: "On time", q16_return_trips: "3-5",
    q19_age: "35-44", q20_gender: "Female",
    q11_important: ["arr_ease", "thr_wayfinding", "sec_ease"],
    crowd: 2, overall_satisfaction: 4, overall_experience: 4
  }, over || {});
  Q.ITEMS.forEach((i) => { if (a[i.id] === undefined) a[i.id] = 4; });
  Q.EMOTIONS.forEach((e) => { if (a[e.id] === undefined) a[e.id] = 3; });
  const p = Submit.buildPayload(a, settings, {});
  if (when) p.meta.submittedAt = when;
  return p;
}

/* ------------------------------------------------------------- CSV parsing */

group("CSV parsing");

const rfc = Parse.parseCsv('a,b,c\r\n1,"two, with comma","he said ""hi"""\r\n2,"line\nbreak",z\r\n');
ok("splits rows and columns", rfc.length === 3 && rfc[0].length === 3, JSON.stringify(rfc[0]));
ok("a quoted comma stays in one cell", rfc[1][1] === "two, with comma", rfc[1][1]);
ok("doubled quotes unescape", rfc[1][2] === 'he said "hi"', rfc[1][2]);
ok("a quoted newline stays in one cell", rfc[2][1] === "line\nbreak", JSON.stringify(rfc[2][1]));
ok("a BOM is stripped", Parse.parseCsv("﻿a,b\r\n1,2\r\n")[0][0] === "a");
ok("an empty file yields no rows", Parse.parseCsv("").length === 0);
ok("a file with no trailing newline still yields its last row",
  Parse.parseCsv("a,b\r\n1,2")[1][1] === "2");

/* ---------------------------------------------------------- the round-trip */

group("Round-trip — kiosk CSV back into responses");

const p1 = makeResponse({
  overall_satisfaction: 5, thr_wifi: Q.NOT_APPLICABLE, sec_wait: 2,
  open_liked: 'Fast security. Staff said "good morning", nice touch.',
  open_improve: "More seats near gate A3,\nand cheaper coffee."
}, "2026-07-14T08:30:00.000Z");

const doc = Submit.csvDocument([p1]);
const loaded = Parse.parseFile(doc, "kiosk.csv");

ok("no warnings on a clean export", loaded.warnings.length === 0, loaded.warnings.join(" | "));
ok("one response comes back", loaded.responses.length === 1, loaded.responses.length);

const r1 = loaded.responses[0];
ok("responseId survives", r1.meta.responseId === p1.meta.responseId);
ok("airport and gate survive", r1.meta.airport === "SKP" && r1.meta.gate === "A3");
ok("a rating comes back as a number", r1.answers.overall_satisfaction === 5,
  JSON.stringify(r1.answers.overall_satisfaction));
ok("a low rating is not lost", r1.answers.sec_wait === 2, r1.answers.sec_wait);
ok("N/A comes back as N/A, not 0", r1.answers.thr_wifi === Q.NOT_APPLICABLE, r1.answers.thr_wifi);
ok("a multi-select comes back as an array",
  Array.isArray(r1.answers.q13_group) && r1.answers.q13_group[0] === "Alone",
  JSON.stringify(r1.answers.q13_group));
ok("the importance picks come back as 3 ids",
  Array.isArray(r1.answers.q11_important) && r1.answers.q11_important.length === 3,
  JSON.stringify(r1.answers.q11_important));
ok("quotes and commas in free text survive",
  r1.answers.open_liked === 'Fast security. Staff said "good morning", nice touch.',
  r1.answers.open_liked);
ok("a newline in free text survives",
  r1.answers.open_improve === "More seats near gate A3,\nand cheaper coffee.",
  JSON.stringify(r1.answers.open_improve));
ok("every rating in the payload is recovered",
  Object.keys(p1.ratings).every((id) => r1.answers[id] !== undefined),
  Object.keys(p1.ratings).filter((id) => r1.answers[id] === undefined).join(", "));

group("Bad input");

const notOurs = Parse.parseFile("name,email\r\nBob,b@x.com\r\n", "wrong.csv");
ok("a foreign CSV is rejected, not misread", notOurs.responses.length === 0 &&
  /not an ASQ export/.test(notOurs.warnings[0]), notOurs.warnings[0]);
ok("an empty file is reported", /empty/.test(Parse.parseFile("", "e.csv").warnings[0]));

const extra = Submit.csvHeader() + ",Some Future Question\r\n" +
  Submit.csvRow(p1) + ",whatever\r\n";
const withExtra = Parse.parseFile(extra, "newer.csv");
ok("an unknown column is ignored rather than fatal", withExtra.responses.length === 1);
ok("the unknown column is reported", /not recognised/.test(withExtra.warnings[0] || ""),
  withExtra.warnings[0]);
ok("known answers still load alongside an unknown column",
  withExtra.responses[0].answers.overall_satisfaction === 5);

group("Merging several tablets");

const p2 = makeResponse({ overall_satisfaction: 3 }, "2026-07-15T09:00:00.000Z");
const p3 = makeResponse({ overall_satisfaction: 2 }, "2026-07-13T09:00:00.000Z");
const merged = Parse.merge([
  Parse.parseFile(Submit.csvDocument([p1, p2]), "gateA.csv"),
  Parse.parseFile(Submit.csvDocument([p2, p3]), "gateB.csv")   /* p2 exported twice */
]);
ok("responses from several files combine", merged.responses.length === 3, merged.responses.length);
ok("a response exported twice is counted once", merged.duplicates === 1, merged.duplicates);
ok("the duplicate is reported", /duplicate/.test(merged.warnings.join(" ")));
ok("merged responses are in date order",
  merged.responses.map((r) => r.meta.submittedAt).join() ===
  ["2026-07-13T09:00:00.000Z", "2026-07-14T08:30:00.000Z", "2026-07-15T09:00:00.000Z"].join(),
  merged.responses.map((r) => r.meta.submittedAt).join());

/* ------------------------------------------------------------- statistics */

group("Statistics — means and N/A");

const rs = [
  { meta: {}, answers: { overall_satisfaction: 5, thr_wifi: 2 } },
  { meta: {}, answers: { overall_satisfaction: 3, thr_wifi: Q.NOT_APPLICABLE } },
  { meta: {}, answers: { overall_satisfaction: 4 } }
];
ok("mean ignores missing answers",
  Stats.itemStat(rs, "overall_satisfaction").mean === 4, Stats.itemStat(rs, "overall_satisfaction").mean);
const wifi = Stats.itemStat(rs, "thr_wifi");
ok("N/A is excluded from the mean, not counted as a low score", wifi.mean === 2, wifi.mean);
ok("N/A is counted separately", wifi.na === 1 && wifi.n === 1, JSON.stringify(wifi));
ok("an item nobody rated has a null mean, not 0",
  Stats.itemStat(rs, "atm_ambience").mean === null, Stats.itemStat(rs, "atm_ambience").mean);
ok("top2 counts 4s and 5s",
  Stats.itemStat(rs, "overall_satisfaction").top2 === 66.7,
  Stats.itemStat(rs, "overall_satisfaction").top2);

group("Statistics — categories");

const catRs = [
  { meta: {}, answers: { bor_wait: 4, bor_staff: 2 } },
  { meta: {}, answers: { bor_wait: 4 } }                       /* only one item rated */
];
const border = Stats.categoryStats(catRs).find((c) => c.id === "border");
/* Weighted by respondents, as ACI does: (4*2 + 2*1) / 3 = 3.33, not (4+2)/2 = 3. */
ok("a category average is weighted by respondent count", border.mean === 3.33, border.mean);
ok("the category carries its total base", border.n === 3, border.n);
ok("a category nobody rated is omitted",
  !Stats.categoryStats(catRs).some((c) => c.id === "shopping"));

group("Statistics — distribution and segments");

const dist = Stats.distribution(rs, "overall_satisfaction");
ok("distribution runs Excellent to Poor", dist.map((d) => d.value).join() === "5,4,3,2,1");
ok("distribution percentages are of those who rated", dist[0].pct === 33.3, dist[0].pct);

const segRs = [
  { meta: {}, answers: { q3_reason: "Business", overall_satisfaction: 5 } },
  { meta: {}, answers: { q3_reason: "Business", overall_satisfaction: 3 } },
  { meta: {}, answers: { q3_reason: "Leisure", overall_satisfaction: 4 } }
];
const seg = Stats.bySegment(segRs, "q3_reason");
ok("segments follow the questionnaire's option order",
  seg.map((s) => s.key).join() === "Business,Leisure", seg.map((s) => s.key).join());
ok("a segment mean is right", seg[0].mean === 4 && seg[0].n === 2, JSON.stringify(seg[0]));
ok("an unused option is dropped", !seg.some((s) => s.key === "Personal"));

const multiRs = [{ meta: {}, answers: { q13_group: ["Alone", "With friend(s) or relative(s)"],
                                        overall_satisfaction: 4 } }];
ok("a multi-select response counts in each of its groups",
  Stats.bySegment(multiRs, "q13_group").length === 2);

group("Statistics — importance and priority");

const impRs = [
  { meta: {}, answers: { q11_important: ["sec_wait", "arr_ease", "thr_wifi"], sec_wait: 2, arr_ease: 5, thr_wifi: 5 } },
  { meta: {}, answers: { q11_important: ["sec_wait", "arr_ease", "atm_clean"], sec_wait: 2, arr_ease: 5, atm_clean: 5 } },
  { meta: {}, answers: { q11_important: ["sec_wait", "gat_seats", "atm_clean"], sec_wait: 1, gat_seats: 5, atm_clean: 5 } }
];
const imp = Stats.importance(impRs);
ok("importance is based only on those who answered Q11", imp.base === 3, imp.base);
ok("the most-named item leads", imp.items[0].id === "sec_wait", imp.items[0].id);
ok("its percentage is right", imp.items[0].pct === 100, imp.items[0].pct);

const prio = Stats.actionPriority(impRs);
/* Security waiting is both the worst-scoring and the most-named — it must top
   the list, ahead of items that merely score badly or are merely important. */
ok("action priority puts the important-and-weak item first",
  prio[0].id === "sec_wait", prio[0].id);
ok("priority carries the gap from the average", prio[0].gap < 0, prio[0].gap);
ok("a strong, important item is not flagged for action",
  prio.find((p) => p.id === "arr_ease").score < prio[0].score);

group("Statistics — trend");

const oneMonth = [makeResponse({}, "2026-07-01T00:00:00.000Z")]
  .map((p) => ({ meta: p.meta, answers: Object.assign({}, p.ratings, p.profile) }));
ok("a single month reports no deltas rather than inventing a baseline",
  Stats.trend(oneMonth).deltas === null);

const twoMonths = [
  { meta: { submittedAt: "2026-06-05T00:00:00.000Z" }, answers: { overall_satisfaction: 3, sec_wait: 2 } },
  { meta: { submittedAt: "2026-07-05T00:00:00.000Z" }, answers: { overall_satisfaction: 5, sec_wait: 4 } }
];
const tr = Stats.trend(twoMonths);
ok("two months produce a series", tr.series.length === 2, tr.series.length);
ok("months are compared newest against previous",
  tr.prevMonth === "2026-06" && tr.currMonth === "2026-07",
  tr.prevMonth + " -> " + tr.currMonth);
ok("an improving item shows a positive delta",
  tr.deltas.find((d) => d.id === "sec_wait").delta === 2,
  JSON.stringify(tr.deltas.find((d) => d.id === "sec_wait")));

group("Report assembly");

const full = Stats.build(merged.responses);
ok("the summary counts every response", full.summary.n === 3, full.summary.n);
ok("the summary spans the real date range",
  full.summary.from === "2026-07-13T09:00:00.000Z" &&
  full.summary.to === "2026-07-15T09:00:00.000Z");
ok("the airport is picked up from the data", full.summary.airports.join() === "SKP");
ok("all 8 categories are present when everything was rated",
  full.categories.length === 8, full.categories.length);
ok("items are ranked best first",
  full.items.every((s, i, a) => i === 0 || (a[i - 1].mean || 0) >= (s.mean || 0)));
ok("comments are collected with their question",
  full.comments.length === 2 && full.comments[0].question === "open_liked",
  full.comments.length);
ok("emotions come through", full.emotions.length === 5);
ok("a report on zero responses does not throw",
  Stats.build([]).summary.n === 0 && Stats.build([]).categories.length === 0);

console.log("\n" + (fail === 0 ? "OK" : "FAILED") + " — " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
