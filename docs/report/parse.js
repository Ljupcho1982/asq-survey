/* parse.js — turning kiosk CSV files back into responses.
 *
 * The kiosk writes columns in Q.questionOrder() with Q.labelFor() as the header,
 * so the mapping back is exact rather than guessed. Columns are matched by
 * header NAME, not position: a file written by an older build with fewer
 * questions still loads, and its missing answers simply come back empty.
 */
"use strict";

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("../app/questionnaire.js") : root.Q
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Parse = api;
})(typeof self !== "undefined" ? self : this, function (Q) {

  const META = ["responseId", "submittedAt", "airport", "terminal", "gate", "durationSeconds"];

  /* --------------------------------------------------------------- RFC 4180
   * Hand-rolled because free-text answers legitimately contain commas, quotes
   * and newlines, and a naive split on those destroys the row silently.
   */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false, i = 0;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;          /* the BOM we write for Excel */

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
  }

  /* Header name → question id, built from the questionnaire itself. */
  function headerMap() {
    const map = new Map();
    Q.questionOrder().forEach((id) => map.set(Q.labelFor(id), id));
    return map;
  }

  const MULTI = new Set(["q9_checkin_mode", "q13_group", "q11_important"]);

  function coerce(id, raw) {
    const v = (raw === undefined || raw === null) ? "" : String(raw).trim();
    if (v === "") return undefined;
    if (MULTI.has(id)) return v.split(";").map((s) => s.trim()).filter(Boolean);
    if (v === Q.NOT_APPLICABLE) return Q.NOT_APPLICABLE;

    const numeric = Q.item(id) || Q.OVERALL.some((o) => o.id === id) ||
                    Q.EMOTIONS.some((e) => e.id === id) || id === Q.CROWD.id;
    if (numeric) {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return v;
  }

  /* Returns { responses, warnings }. Never throws on a malformed file — a
     half-readable export is still worth reporting on, so problems are collected
     and shown rather than aborting the load. */
  function parseFile(text, fileName) {
    const warnings = [];
    const rows = parseCsv(text);
    if (!rows.length) return { responses: [], warnings: ["" + fileName + ": file is empty"] };

    const header = rows[0].map((h) => h.trim());
    if (header[0] !== "responseId") {
      return { responses: [],
        warnings: [fileName + ": not an ASQ export (first column is \"" + header[0] + "\")"] };
    }

    const map = headerMap();
    const unknown = [];
    const cols = header.map((name, idx) => {
      if (idx < META.length && name === META[idx]) return { kind: "meta", key: name };
      const id = map.get(name);
      if (id) return { kind: "answer", id: id };
      unknown.push(name);
      return null;
    });
    if (unknown.length) {
      warnings.push(fileName + ": " + unknown.length +
        " column(s) not recognised and ignored — " + unknown.slice(0, 3).join(", ") +
        (unknown.length > 3 ? "…" : ""));
    }

    const responses = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.some((c) => c !== "")) continue;
      const meta = {}, answers = {};
      cells.forEach((cell, idx) => {
        const col = cols[idx];
        if (!col) return;
        if (col.kind === "meta") { meta[col.key] = cell.trim(); return; }
        const val = coerce(col.id, cell);
        if (val !== undefined) answers[col.id] = val;
      });
      if (!meta.responseId) { warnings.push(fileName + ": row " + (r + 1) + " has no responseId"); continue; }
      responses.push({ meta: meta, answers: answers, source: fileName });
    }
    return { responses: responses, warnings: warnings };
  }

  /* Several tablets produce several files, and the same file gets exported more
     than once — so responseId decides identity, not arrival order. */
  function merge(sets) {
    const byId = new Map();
    let duplicates = 0;
    const warnings = [];
    sets.forEach((set) => {
      warnings.push.apply(warnings, set.warnings);
      set.responses.forEach((r) => {
        if (byId.has(r.meta.responseId)) { duplicates++; return; }
        byId.set(r.meta.responseId, r);
      });
    });
    const responses = Array.from(byId.values())
      .sort((a, b) => String(a.meta.submittedAt).localeCompare(String(b.meta.submittedAt)));
    if (duplicates) {
      warnings.push(duplicates + " duplicate response(s) skipped — same responseId seen twice.");
    }
    return { responses: responses, warnings: warnings, duplicates: duplicates };
  }

  return { parseCsv, parseFile, merge, headerMap, coerce, META };
});
