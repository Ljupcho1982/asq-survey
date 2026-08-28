/* submit.js — turning a filled-in survey into an email.
 *
 * Every response is sent in three shapes at once, because the recipient wants
 * different things at different times:
 *   • flattened "Question → Answer" fields, which FormSubmit's table template
 *     renders as a readable email you can act on without tooling;
 *   • payload_json, the complete nested response, for machine parsing;
 *   • csv_header + csv_row, stable-ordered, for pasting into Excel.
 *
 * The column order comes from Q.questionOrder(), never from the answers, so an
 * unanswered question leaves an empty cell instead of shifting every column
 * after it.
 */
"use strict";

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./questionnaire.js") : root.Q
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Submit = api;
})(typeof self !== "undefined" ? self : this, function (Q) {

  const ENDPOINT = "https://formsubmit.co/ajax/";
  /* Kept in step with package.json by the selftest — a payload that misreports
     which build produced it is worse than one with no version at all. */
  const APP_VERSION = "1.1.0";

  /* ------------------------------------------------------------------ ids */

  function responseId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    /* Capacitor's WebView is modern enough for randomUUID, but a plain http://
       origin in a browser is not a secure context and loses crypto entirely. */
    return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* -------------------------------------------------------------- payload */

  function buildPayload(answers, settings, timing) {
    const t = timing || {};
    const ratings = {};
    /* A passenger can rate the connection item, go Back, and change Q2 to "No".
       The screen then hides the item but the answer is still in memory — so it
       is dropped here rather than shipping a rating for a connection that never
       happened. The UI gate alone is not enough. */
    const connecting = answers.q2_connection === "Yes";
    Q.ITEMS.forEach((i) => {
      if (i.connectingOnly && !connecting) return;
      if (answers[i.id] !== undefined) ratings[i.id] = answers[i.id];
    });
    Q.OVERALL.forEach((o) => { if (answers[o.id] !== undefined) ratings[o.id] = answers[o.id]; });

    const emotions = {};
    Q.EMOTIONS.forEach((e) => { if (answers[e.id] !== undefined) emotions[e.id] = answers[e.id]; });

    const profile = {};
    Q.PROFILE.forEach((p) => { if (answers[p.id] !== undefined) profile[p.id] = answers[p.id]; });

    const open = {};
    Q.OPEN_ENDED.forEach((o) => { if (answers[o.id]) open[o.id] = answers[o.id]; });

    return {
      meta: {
        responseId: responseId(),
        submittedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        survey: "ACI ASQ Departures (self-hosted)",
        airport: settings.airport || "",
        terminal: settings.terminal || "",
        gate: settings.gate || "",
        durationSeconds: t.startedAt ? Math.round((Date.now() - t.startedAt) / 1000) : null
      },
      profile: profile,
      ratings: ratings,
      emotions: emotions,
      crowd: answers[Q.CROWD.id] !== undefined ? answers[Q.CROWD.id] : null,
      openEnded: open
    };
  }

  /* -------------------------------------------------------------- flatten */

  /* One answer, as it should read in an email: a rating becomes "4 — Very good"
     rather than a bare number nobody can interpret at a glance. */
  function formatAnswer(id, value) {
    if (value === undefined || value === null || value === "") return "";
    if (Array.isArray(value)) {
      return value.map((v) => (Q.item(v) ? Q.item(v).short : v)).join("; ");
    }
    if (value === Q.NOT_APPLICABLE) return "N/A — did not use";

    const isRating = Q.item(id) || Q.OVERALL.some((o) => o.id === id);
    if (isRating) {
      const s = Q.SAT_SCALE.find((x) => x.value === Number(value));
      return s ? s.value + " — " + s.label : String(value);
    }
    if (Q.EMOTIONS.some((e) => e.id === id)) {
      const s = Q.EMOTION_SCALE.find((x) => x.value === Number(value));
      return s ? s.value + " — " + s.label : String(value);
    }
    if (id === Q.CROWD.id) {
      const s = Q.CROWD_SCALE.find((x) => x.value === Number(value));
      return s ? s.value + " — " + s.label : String(value);
    }
    return String(value);
  }

  function flatten(payload) {
    const answers = Object.assign({}, payload.profile, payload.ratings, payload.emotions,
      payload.openEnded, { crowd: payload.crowd });
    const out = {};
    Q.questionOrder().forEach((id) => {
      out[Q.labelFor(id)] = formatAnswer(id, answers[id]);
    });
    return out;
  }

  /* ------------------------------------------------------------------ CSV */

  function csvEscape(v) {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const META_COLUMNS = ["responseId", "submittedAt", "airport", "terminal", "gate", "durationSeconds"];

  function csvHeader() {
    return META_COLUMNS.concat(Q.questionOrder().map((id) => Q.labelFor(id)))
      .map(csvEscape).join(",");
  }

  /* Raw values, not the pretty ones — a spreadsheet wants 4, not "4 — Very good". */
  function csvRow(payload) {
    const answers = Object.assign({}, payload.profile, payload.ratings, payload.emotions,
      payload.openEnded, { crowd: payload.crowd });
    const meta = META_COLUMNS.map((k) => payload.meta[k]);
    const cells = Q.questionOrder().map((id) => {
      const v = answers[id];
      if (v === undefined || v === null) return "";
      return Array.isArray(v) ? v.join("; ") : v;
    });
    return meta.concat(cells).map(csvEscape).join(",");
  }

  function csvDocument(payloads) {
    return [csvHeader()].concat(payloads.map(csvRow)).join("\r\n") + "\r\n";
  }

  /* --------------------------------------------------------- FormSubmit body */

  function buildFields(payload) {
    const date = String(payload.meta.submittedAt).slice(0, 10);
    return Object.assign({
      _subject: "ASQ " + (payload.meta.airport || "response") + " — " +
                payload.meta.responseId + " — " + date,
      _template: "table",
      _captcha: "false"
    }, flatten(payload), {
      payload_json: JSON.stringify(payload),
      csv_header: csvHeader(),
      csv_row: csvRow(payload)
    });
  }

  /* recipient is either a plain address or the random alias FormSubmit hands back
     after confirmation — the endpoint is identical, which is what makes swapping
     in the alias a one-field change in Settings. */
  function endpointFor(recipient) {
    return ENDPOINT + encodeURIComponent(String(recipient || "").trim());
  }

  async function send(payload, settings, fetchImpl) {
    const recipient = (settings && settings.recipient || "").trim();
    if (!recipient) throw new Error("No recipient set — open Settings and add one.");
    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(null) : null);
    if (!doFetch) throw new Error("No fetch available in this environment.");

    const res = await doFetch(endpointFor(recipient), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(buildFields(payload))
    });
    if (!res.ok) throw new Error("FormSubmit returned HTTP " + res.status);

    /* FormSubmit answers 200 with {"success":"false"} when the address has not
       been confirmed yet, so the status code alone is not proof of delivery. */
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON body still counts as accepted */ }
    if (body && String(body.success) === "false") {
      throw new Error(body.message || "FormSubmit rejected the submission.");
    }
    return body;
  }

  /* ------------------------------------------------------------- delivery
   * Routes one response to whichever channels are configured. A response counts
   * as delivered only when every configured channel took it — so in "both" mode
   * a working CSV write plus a failing email leaves the record pending and it is
   * retried. That retry must NOT append the row a second time, which is what
   * `csvWritten` on the record is for.
   *
   * sink: { append(payload, settings, allPayloads) }
   * deps.allPayloads(): everything stored, for the download fallback that has to
   * rebuild the whole file.
   */
  function makeDeliverer(sink, getSettings, deps) {
    const d = deps || {};
    const sendFn = d.send || send;
    const persist = d.persist || (async () => {});
    const allPayloads = d.allPayloads || (async () => []);

    return async function deliver(payload, record) {
      const settings = getSettings();
      const mode = settings.delivery || "csv";

      if (mode !== "email" && !(record && record.csvWritten)) {
        await sink.append(payload, settings, await allPayloads());
        if (record) {
          record.csvWritten = true;
          /* Remembered before the email is attempted, so a crash between the two
             still cannot duplicate the row. */
          try { await persist(record); } catch (e) { /* retried next flush */ }
        }
      }

      if (mode !== "csv") await sendFn(payload, settings);
    };
  }

  return {
    ENDPOINT, APP_VERSION, META_COLUMNS,
    responseId, buildPayload, formatAnswer, flatten,
    csvEscape, csvHeader, csvRow, csvDocument,
    buildFields, endpointFor, send, makeDeliverer
  };
});
