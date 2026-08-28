/* selftest.js — the instrument, the payload and the queue, without a network.
 *
 * node tools/selftest.js
 */
"use strict";

const path = require("path");
const www = (f) => path.join(__dirname, "..", "www", f);
const Q = require(www("questionnaire.js"));
const Store = require(www("store.js"));
const Submit = require(www("submit.js"));
const CsvSink = require(www("csv-sink.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + extra : "")); }
}
function group(name) { console.log("\n" + name); }

/* ------------------------------------------------------- the instrument */

group("Questionnaire — shape");

ok("exactly 31 satisfaction items", Q.ITEMS.length === 31, Q.ITEMS.length);
ok("2 overall items", Q.OVERALL.length === 2, Q.OVERALL.length);
ok("5 emotions", Q.EMOTIONS.length === 5, Q.EMOTIONS.length);
ok("13 profiling questions", Q.PROFILE.length === 13, Q.PROFILE.length);
ok("2 open-ended questions", Q.OPEN_ENDED.length === 2, Q.OPEN_ENDED.length);

const ids = Q.ITEMS.map((i) => i.id);
ok("item ids are unique", new Set(ids).size === ids.length,
  ids.filter((id, i) => ids.indexOf(id) !== i).join(", "));

const allIds = ids
  .concat(Q.OVERALL.map((o) => o.id))
  .concat(Q.EMOTIONS.map((e) => e.id))
  .concat(Q.PROFILE.map((p) => p.id))
  .concat(Q.OPEN_ENDED.map((o) => o.id))
  .concat([Q.CROWD.id]);
ok("no id collides across sections", new Set(allIds).size === allIds.length,
  allIds.filter((id, i) => allIds.indexOf(id) !== i).join(", "));

ok("every item has a label and a short name",
  Q.ITEMS.every((i) => i.label && i.short),
  Q.ITEMS.filter((i) => !i.label || !i.short).map((i) => i.id).join(", "));

ok("every item belongs to a declared category",
  Q.ITEMS.every((i) => Q.CATEGORIES.some((c) => c.id === i.cat)),
  Q.ITEMS.filter((i) => !Q.CATEGORIES.some((c) => c.id === i.cat)).map((i) => i.id).join(", "));

group("Questionnaire — category counts match the ACI scorecard");

/* Slide 73 of the 2025 report groups the 31 items exactly this way. */
const EXPECTED = { arrival: 3, checkin: 3, security: 3, border: 2, shopping: 5,
                   gate: 2, terminal: 10, atmosphere: 3 };
Object.keys(EXPECTED).forEach((cat) => {
  const n = Q.itemsIn(cat).length;
  ok(cat + " has " + EXPECTED[cat] + " items", n === EXPECTED[cat], n);
});
ok("counts sum to 31",
  Object.values(EXPECTED).reduce((a, b) => a + b, 0) === Q.ITEMS.length);

group("Questionnaire — scales and lookups");

ok("satisfaction scale is 1..5", Q.SAT_SCALE.map((s) => s.value).join() === "1,2,3,4,5");
ok("emotion scale is 1..5", Q.EMOTION_SCALE.map((s) => s.value).join() === "1,2,3,4,5");
ok("crowd scale is 1..5", Q.CROWD_SCALE.map((s) => s.value).join() === "1,2,3,4,5");
ok("crowd ends match the report's T2/B2 footnote",
  Q.CROWD_SCALE[0].label === "Not at all crowded" && Q.CROWD_SCALE[4].label === "Very crowded");
ok("item() finds by id", Q.item("thr_wifi") && Q.item("thr_wifi").short === "Wi-Fi service quality");
ok("item() returns null for an unknown id", Q.item("nope") === null);
ok("labelFor() names a rating item", Q.labelFor("sec_wait") === "Waiting time: Security screening");
ok("labelFor() prefixes emotions", Q.labelFor("emo_happy") === "Emotion: Happy");
ok("labelFor() falls back to the raw id", Q.labelFor("mystery") === "mystery");

ok("exactly one item is connection-only",
  Q.ITEMS.filter((i) => i.connectingOnly).length === 1,
  Q.ITEMS.filter((i) => i.connectingOnly).map((i) => i.id).join(", "));

group("Questionnaire — screens");

ok("one rating screen per category",
  Q.SCREENS.filter((s) => s.kind === "rating").length === Q.CATEGORIES.length);
ok("flow starts at welcome and ends at thanks",
  Q.SCREENS[0].kind === "welcome" && Q.SCREENS[Q.SCREENS.length - 1].kind === "thanks");
ok("screen ids are unique",
  new Set(Q.SCREENS.map((s) => s.id)).size === Q.SCREENS.length);
ok("every profile screen names real questions",
  Q.SCREENS.filter((s) => s.kind === "profile")
    .every((s) => s.questions.every((qid) => Q.profile(qid))));

group("Question order");

const order = Q.questionOrder();
ok("order has no duplicates", new Set(order).size === order.length,
  order.filter((id, i) => order.indexOf(id) !== i).join(", "));
ok("order covers every rating item", Q.ITEMS.every((i) => order.includes(i.id)));
ok("order covers every emotion", Q.EMOTIONS.every((e) => order.includes(e.id)));
ok("order covers every profiling question", Q.PROFILE.every((p) => order.includes(p.id)));
ok("order covers crowd and both open-ended",
  order.includes("crowd") && Q.OPEN_ENDED.every((o) => order.includes(o.id)));
ok("order is stable across calls", Q.questionOrder().join() === order.join());

/* --------------------------------------------------------- the importance cap */

group("Importance picker");

const q11 = Q.profile("q11_important");
ok("Q11 exists and caps at 3", q11 && q11.type === "importance" && q11.max === 3);

/* The cap is enforced in app.js by disabling further chips; this mirrors that rule
   so a change to `max` cannot silently drift away from the ACI instrument. */
function pick(list, id, max) {
  const out = list.slice();
  const at = out.indexOf(id);
  if (at >= 0) out.splice(at, 1);
  else if (out.length < max) out.push(id);
  return out;
}
let chosen = [];
["arr_ease", "chk_wait", "sec_ease", "thr_wifi"].forEach((id) => { chosen = pick(chosen, id, q11.max); });
ok("a 4th pick is refused", chosen.length === 3, chosen.join(", "));
ok("the 4th item is not in the selection", !chosen.includes("thr_wifi"));
chosen = pick(chosen, "arr_ease", q11.max);
ok("tapping a chosen item removes it", chosen.length === 2 && !chosen.includes("arr_ease"));

/* --------------------------------------------------------------- payloads */

group("Payload");

const settings = { recipient: "test@example.org", airport: "SKP", terminal: "T1", gate: "A3" };

function fullAnswers() {
  const a = {};
  Q.ITEMS.forEach((i, n) => { a[i.id] = (n % 5) + 1; });
  Q.OVERALL.forEach((o) => { a[o.id] = 5; });
  Q.EMOTIONS.forEach((e) => { a[e.id] = 3; });
  a.q1_destination = "Vienna";
  a.q2_connection = "No";
  a.q3_reason = "Business";
  a.q7_transport = "Taxi/Limo";
  a.q8_parking = "Not used";
  a.q9_checkin_mode = ["Online / Mobile check-in", "Check-in desk with airline staff"];
  a.q12_arrival_time = "2 hrs – 3 hrs";
  a.q13_group = ["Alone"];
  a.q15_flight_status = "On time";
  a.q16_return_trips = "3-5";
  a.q19_age = "35-44";
  a.q20_gender = "Female";
  a.q11_important = ["arr_ease", "thr_wayfinding", "sec_ease"];
  a.crowd = 2;
  a.open_liked = 'Fast security. Staff said "good morning", nice touch.';
  a.open_improve = "More seats near gate A3,\nand cheaper coffee.";
  return a;
}

const full = Submit.buildPayload(fullAnswers(), settings, { startedAt: Date.now() - 210000 });

ok("response id is present and non-empty", !!full.meta.responseId && full.meta.responseId.length > 5,
  full.meta.responseId);
ok("two response ids differ", Submit.responseId() !== Submit.responseId());
ok("submittedAt is ISO", /^\d{4}-\d{2}-\d{2}T/.test(full.meta.submittedAt), full.meta.submittedAt);
ok("kiosk context is carried", full.meta.airport === "SKP" && full.meta.terminal === "T1" &&
  full.meta.gate === "A3");
ok("duration is recorded in seconds", full.meta.durationSeconds >= 209 && full.meta.durationSeconds <= 212,
  full.meta.durationSeconds);
/* fullAnswers() says q2_connection "No", so the connection item is dropped: 30 + 2. */
ok("ratings hold 30 items + 2 overall for a non-connecting passenger",
  Object.keys(full.ratings).length === 32, Object.keys(full.ratings).length);
ok("a stale connection rating is dropped when Q2 says No",
  full.ratings.thr_connection === undefined, full.ratings.thr_connection);

{
  /* Same answers, Q2 flipped — the item comes back rather than being lost. */
  const a = fullAnswers();
  a.q2_connection = "Yes";
  const connecting = Submit.buildPayload(a, settings, {});
  ok("a connecting passenger keeps all 31 items + 2 overall",
    Object.keys(connecting.ratings).length === 33, Object.keys(connecting.ratings).length);
  ok("the connection rating survives when Q2 says Yes",
    connecting.ratings.thr_connection !== undefined);
}

ok("the payload reports the package version",
  Submit.APP_VERSION === require(path.join(__dirname, "..", "package.json")).version,
  Submit.APP_VERSION + " vs package.json " +
    require(path.join(__dirname, "..", "package.json")).version);
ok("emotions hold 5", Object.keys(full.emotions).length === 5);
ok("open-ended text survives verbatim", full.openEnded.open_improve.includes("\n"));

group("Flatten — the readable email");

const flat = Submit.flatten(full);
ok("one field per question in the order", Object.keys(flat).length === order.length,
  Object.keys(flat).length + " vs " + order.length);
ok("field keys are human names, not ids", Object.keys(flat).includes("Wi-Fi service quality"));
ok("no raw id leaks into the keys", !Object.keys(flat).some((k) => /^[a-z]{3}_/.test(k)),
  Object.keys(flat).filter((k) => /^[a-z]{3}_/.test(k)).join(", "));
ok("a rating reads as number and word", /^\d — /.test(flat["Overall Satisfaction"]),
  flat["Overall Satisfaction"]);
ok("an emotion reads on its own scale", flat["Emotion: Happy"] === "3 — Moderately",
  flat["Emotion: Happy"]);
ok("crowd reads on its own scale", flat["Perception of crowd"] === "2 — Not crowded",
  flat["Perception of crowd"]);
ok("a multi-select is joined", flat["Q13 With whom are you travelling today?"] === "Alone",
  flat["Q13 With whom are you travelling today?"]);
ok("importance shows item names, not ids",
  flat[Q.labelFor("q11_important")].includes("Ease of finding way"),
  flat[Q.labelFor("q11_important")]);

ok("N/A is spelled out", Submit.formatAnswer("thr_wifi", Q.NOT_APPLICABLE) === "N/A — did not use");
ok("a missing answer is an empty string", Submit.formatAnswer("thr_wifi", undefined) === "");

group("payload_json round-trip");

const fields = Submit.buildFields(full);
ok("_subject names the airport and the id",
  fields._subject.includes("SKP") && fields._subject.includes(full.meta.responseId),
  fields._subject);
ok("captcha is disabled", fields._captcha === "false");
ok("table template is requested", fields._template === "table");
ok("payload_json reparses deep-equal to the payload",
  JSON.stringify(JSON.parse(fields.payload_json)) === JSON.stringify(full));

group("CSV");

const header = Submit.csvHeader();
const row = Submit.csvRow(full);
function cells(line) {
  /* A minimal RFC-4180 splitter — enough to count columns through quoted commas. */
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
ok("header and row have the same column count",
  cells(header).length === cells(row).length,
  cells(header).length + " vs " + cells(row).length);
ok("columns = 6 meta + every question",
  cells(header).length === Submit.META_COLUMNS.length + order.length, cells(header).length);
ok("header starts with responseId", cells(header)[0] === "responseId");
ok("CSV holds raw values, not the pretty ones",
  cells(row)[Submit.META_COLUMNS.length + order.indexOf("overall_satisfaction")] === "5");

/* A partly-filled response is the realistic case — a passenger who skips the
   shops must not shift every column after them. */
const sparse = Submit.buildPayload(
  { q3_reason: "Leisure", overall_satisfaction: 4, crowd: 5,
    open_improve: 'He said "no", then, oddly, "yes"' },
  settings, {});
const sparseRow = Submit.csvRow(sparse);
ok("a sparse row has the same column count as the header",
  cells(sparseRow).length === cells(header).length,
  cells(sparseRow).length + " vs " + cells(header).length);
ok("a skipped question leaves an empty cell",
  cells(sparseRow)[Submit.META_COLUMNS.length + order.indexOf("thr_wifi")] === "");
ok("the answered cell is still in its own column",
  cells(sparseRow)[Submit.META_COLUMNS.length + order.indexOf("overall_satisfaction")] === "4");
ok("embedded quotes and commas survive the round-trip",
  cells(sparseRow)[Submit.META_COLUMNS.length + order.indexOf("open_improve")]
    === 'He said "no", then, oddly, "yes"');
ok("a newline in free text stays inside one quoted cell",
  cells(Submit.csvRow(full))[Submit.META_COLUMNS.length + order.indexOf("open_improve")]
    .includes("\n"));

const doc = Submit.csvDocument([full, sparse]);
ok("a document is header + one line per response", doc.trim().split(/\r\n(?=[^"]*(?:"[^"]*"[^"]*)*$)/).length >= 3,
  doc.trim().split("\r\n").length);
ok("document starts with the header", doc.startsWith(header));

group("Endpoint");

ok("endpoint targets the FormSubmit ajax path",
  Submit.endpointFor("a@b.org") === "https://formsubmit.co/ajax/a%40b.org",
  Submit.endpointFor("a@b.org"));
ok("an alias uses the identical path",
  Submit.endpointFor("f7a1c9b2") === "https://formsubmit.co/ajax/f7a1c9b2");
ok("surrounding whitespace is trimmed",
  Submit.endpointFor("  a@b.org  ") === "https://formsubmit.co/ajax/a%40b.org");

/* ----------------------------------------------------------------- settings */

group("Settings");

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v)
  };
}
const ls = fakeStorage();
ok("defaults ship with a blank recipient", Store.loadSettings(ls).recipient === "",
  JSON.stringify(Store.loadSettings(ls).recipient));
ok("defaults name SKP", Store.loadSettings(ls).airport === "SKP");
/* CSV is the default because it needs no setup at all — email additionally
   requires an address and a confirmation click before anything is delivered. */
ok("delivery defaults to the CSV file", Store.loadSettings(ls).delivery === "csv",
  Store.loadSettings(ls).delivery);
ok("a default CSV file name is set", /\.csv$/.test(Store.loadSettings(ls).csvFileName),
  Store.loadSettings(ls).csvFileName);
Store.saveSettings({ recipient: "ops@example.org" }, ls);
ok("a saved value persists", Store.loadSettings(ls).recipient === "ops@example.org");
ok("saving one field keeps the others", Store.loadSettings(ls).airport === "SKP");
const broken = { getItem: () => "{not json", setItem: () => {} };
ok("corrupt storage falls back to defaults rather than throwing",
  Store.loadSettings(broken).airport === "SKP");

/* -------------------------------------------------------------- the queue */

group("Queue — state machine");

(async function queueTests() {
  const q = Store.makeQueue(Store.memoryAdapter());

  const p1 = Submit.buildPayload({ overall_satisfaction: 3 }, settings, {});
  p1.meta.submittedAt = "2026-08-01T10:00:00.000Z";
  const p2 = Submit.buildPayload({ overall_satisfaction: 4 }, settings, {});
  p2.meta.submittedAt = "2026-08-01T09:00:00.000Z";   /* older */
  const p3 = Submit.buildPayload({ overall_satisfaction: 5 }, settings, {});
  p3.meta.submittedAt = "2026-08-01T11:00:00.000Z";

  await q.enqueue(p1);
  await q.enqueue(p2);
  await q.enqueue(p3);

  let c = await q.counts();
  ok("enqueue lands as pending", c.pending === 3 && c.sent === 0, JSON.stringify(c));

  const queued = await q.pending();
  ok("pending is oldest-first",
    queued.map((r) => r.payload.meta.submittedAt).join() ===
    [p2, p1, p3].map((p) => p.meta.submittedAt).join(),
    queued.map((r) => r.payload.meta.submittedAt).join());

  await q.markSent(p2.meta.responseId);
  c = await q.counts();
  ok("markSent moves one across", c.pending === 2 && c.sent === 1, JSON.stringify(c));
  const sentRec = (await q.sentRecords())[0];
  ok("a sent record carries a timestamp", !!sentRec.sentAt, sentRec.sentAt);

  await q.markFailed(p1.meta.responseId, new Error("network down"));
  const stillPending = await q.pending();
  const failed = stillPending.find((r) => r.id === p1.meta.responseId);
  ok("a failure keeps the record pending", !!failed);
  ok("a failure increments attempts", failed.attempts === 1, failed.attempts);
  ok("a failure records the reason", failed.lastError === "network down", failed.lastError);

  group("Queue — flush");

  const sentOrder = [];
  const r1 = await q.flush(async (payload) => { sentOrder.push(payload.meta.submittedAt); });
  ok("flush drains everything pending", r1.sent === 2 && r1.remaining === 0, JSON.stringify(r1));
  ok("flush sends oldest-first",
    sentOrder.join() === [p1, p3].map((p) => p.meta.submittedAt).join(), sentOrder.join());

  const q2 = Store.makeQueue(Store.memoryAdapter());
  await q2.enqueue(Submit.buildPayload({ overall_satisfaction: 1 }, settings, {}));
  await q2.enqueue(Submit.buildPayload({ overall_satisfaction: 2 }, settings, {}));
  let calls = 0;
  const r2 = await q2.flush(async () => { calls++; throw new Error("offline"); });
  ok("a failing flush sends nothing", r2.sent === 0, JSON.stringify(r2));
  ok("a failing flush stops after the first error rather than burning the backlog",
    calls === 1, calls);
  ok("everything stays pending after a failed flush", r2.remaining === 2, r2.remaining);
  const after = await q2.pending();
  ok("only the attempted record has attempts incremented",
    after.filter((r) => r.attempts === 1).length === 1,
    after.map((r) => r.attempts).join());

  const r3 = await q2.flush(async () => { /* back online */ });
  ok("a later flush delivers the backlog", r3.sent === 2 && r3.remaining === 0, JSON.stringify(r3));

  group("Queue — retention");

  const q3 = Store.makeQueue(Store.memoryAdapter());
  const old = Submit.buildPayload({ overall_satisfaction: 3 }, settings, {});
  old.meta.submittedAt = "2026-01-01T00:00:00.000Z";
  await q3.enqueue(old);
  await q3.markSent(old.meta.responseId, "2026-01-01T00:00:00.000Z");
  const fresh = Submit.buildPayload({ overall_satisfaction: 3 }, settings, {});
  await q3.enqueue(fresh);
  const removed = await q3.prune("2026-08-28T00:00:00.000Z");
  ok("prune drops sent records past the retention window", removed === 1, removed);
  ok("prune never touches a pending record", (await q3.counts()).pending === 1);

  const q4 = Store.makeQueue(Store.memoryAdapter());
  await q4.enqueue(Submit.buildPayload({}, settings, {}));
  ok("clear empties the store", (await q4.clear()) === 1 && (await q4.all()).length === 0);

  group("Send guard");

  try {
    await Submit.send(full, { recipient: "" }, async () => ({ ok: true }));
    ok("an unset recipient is refused", false);
  } catch (e) {
    ok("an unset recipient is refused before any network call",
      /No recipient/.test(e.message), e.message);
  }

  try {
    await Submit.send(full, settings, async () => ({
      ok: true, json: async () => ({ success: "false", message: "not confirmed" })
    }));
    ok("an unconfirmed address is treated as a failure", false);
  } catch (e) {
    /* FormSubmit answers HTTP 200 with success:"false" until the address is
       confirmed — trusting the status code alone would silently drop responses. */
    ok("HTTP 200 with success:false is treated as a failure", /not confirmed/.test(e.message),
      e.message);
  }

  try {
    await Submit.send(full, settings, async () => ({ ok: false, status: 429 }));
    ok("a non-2xx response is a failure", false);
  } catch (e) {
    ok("a non-2xx response is a failure", /429/.test(e.message), e.message);
  }

  const okBody = await Submit.send(full, settings, async (url, init) => {
    ok("send POSTs JSON to the right endpoint",
      url === "https://formsubmit.co/ajax/test%40example.org" && init.method === "POST" &&
      init.headers["Content-Type"] === "application/json");
    ok("the body carries payload_json", !!JSON.parse(init.body).payload_json);
    return { ok: true, json: async () => ({ success: "true" }) };
  });
  ok("a successful send resolves", okBody && String(okBody.success) === "true");

  group("Delivery routing");

  function fakeSink() {
    const rows = [];
    return { rows, async append(payload) { rows.push(payload.meta.responseId); } };
  }

  {
    /* csv-only never touches the mail path — so a kiosk with no recipient set
       still delivers, which is the whole point of the CSV mode. */
    const sink = fakeSink();
    let mailed = 0;
    const deliver = Submit.makeDeliverer(sink, () => ({ delivery: "csv" }),
      { send: async () => { mailed++; } });
    const rec = { id: "a", csvWritten: false };
    await deliver(full, rec);
    ok("csv mode writes the row", sink.rows.length === 1);
    ok("csv mode sends no email", mailed === 0);
    ok("csv mode marks the row written", rec.csvWritten === true);
  }

  {
    const sink = fakeSink();
    let mailed = 0;
    const deliver = Submit.makeDeliverer(sink, () => ({ delivery: "email" }),
      { send: async () => { mailed++; } });
    await deliver(full, { id: "b", csvWritten: false });
    ok("email mode writes no CSV row", sink.rows.length === 0);
    ok("email mode sends the email", mailed === 1);
  }

  {
    /* The case that would corrupt the file: CSV succeeds, email fails, the queue
       retries. The row must be written exactly once across both attempts. */
    const sink = fakeSink();
    let attempts = 0;
    const deliver = Submit.makeDeliverer(sink, () => ({ delivery: "both" }), {
      send: async () => { attempts++; if (attempts < 3) throw new Error("offline"); },
      persist: async () => {}
    });
    const rec = { id: "c", csvWritten: false };

    for (let i = 0; i < 3; i++) { try { await deliver(full, rec); } catch (e) { /* retry */ } }

    ok("both mode retried the email until it succeeded", attempts === 3, attempts);
    ok("the CSV row was written exactly once across 3 attempts", sink.rows.length === 1,
      sink.rows.length);
    ok("the record remembers the row went out", rec.csvWritten === true);
  }

  {
    /* If the CSV write itself fails, nothing is marked and no email goes either —
       a half-delivered response would be worse than a retried one. */
    const failing = { async append() { throw new Error("disk full"); } };
    let mailed = 0;
    const deliver = Submit.makeDeliverer(failing, () => ({ delivery: "both" }),
      { send: async () => { mailed++; } });
    const rec = { id: "d", csvWritten: false };
    let threw = null;
    try { await deliver(full, rec); } catch (e) { threw = e.message; }
    ok("a failed CSV write propagates", threw === "disk full", threw);
    ok("a failed CSV write is not marked written", rec.csvWritten === false);
    ok("a failed CSV write skips the email", mailed === 0);
  }

  group("CSV sink");

  /* No window and no Capacitor here, so the sink must fall back rather than
     throw — the same path Firefox and iOS take. */
  ok("falls back to download when no filesystem API exists",
    CsvSink.mode() === "download", CsvSink.mode());
  ok("a BOM is prepended so Excel reads UTF-8", CsvSink.BOM === "﻿");

  /* The header goes in once, when the file is empty; every later response is a
     bare row. Both branches build on csvHeader/csvRow, so the shape is checked
     here even though the write itself needs a browser. */
  const firstWrite = CsvSink.BOM + Submit.csvHeader() + "\r\n" + Submit.csvRow(full) + "\r\n";
  const laterWrite = Submit.csvRow(sparse) + "\r\n";
  ok("the first write carries the header", firstWrite.includes("responseId,submittedAt"));
  ok("a later write carries no header", !laterWrite.includes("responseId,submittedAt"));
  ok("appending the two yields a 2-row file",
    (firstWrite + laterWrite).trimEnd().split("\r\n")
      .filter((l) => !l.startsWith("responseId") && !l.startsWith(CsvSink.BOM + "responseId"))
      .length >= 2);

  /* --------------------------------------------------------- the Pages copy
   * The web layer lives in www/, in docs/app/ (Pages) and inside the APK. If
   * docs/app/ drifts, the public page and the APK quietly disagree — so this
   * fails the build rather than letting the two versions diverge in silence.
   */
  group("Pages mirror");

  const fs = require("fs");
  const wwwDir = path.join(__dirname, "..", "www");
  const docsDir = path.join(__dirname, "..", "docs", "app");

  if (!fs.existsSync(docsDir)) {
    ok("docs/app/ exists — run `npm run pages`", false, "missing");
  } else {
    const wwwFiles = fs.readdirSync(wwwDir).sort();
    const docFiles = fs.readdirSync(docsDir).sort();
    ok("docs/app/ has the same files as www/", wwwFiles.join() === docFiles.join(),
      "www: " + wwwFiles.join(" ") + " | docs: " + docFiles.join(" "));
    const drifted = wwwFiles.filter((f) =>
      docFiles.includes(f) &&
      fs.readFileSync(path.join(wwwDir, f)).toString() !==
      fs.readFileSync(path.join(docsDir, f)).toString());
    ok("no file in docs/app/ lags behind www/", drifted.length === 0,
      drifted.join(", ") + " — run `npm run pages`");
  }

  /* ------------------------------------------------------------------ done */
  console.log("\n" + (fail === 0 ? "OK" : "FAILED") + " — " + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
