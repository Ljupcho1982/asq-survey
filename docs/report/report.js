/* report.js — rendering the report.
 *
 * Every number shown carries its base (n). An airport average built from nine
 * people is a different object from one built from nine hundred, and a report
 * that hides which one you are looking at invites bad decisions.
 */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  let responses = [];

  /* ------------------------------------------------------------- utilities */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function fmt(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    return Number(n).toFixed(dp === undefined ? 2 : dp);
  }

  function date(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? String(iso).slice(0, 10) : d.toISOString().slice(0, 10);
  }

  /* Colour follows the same 1–5 ramp as the kiosk's rating buttons, so a score
     means the same thing visually in both places. */
  function scoreClass(mean) {
    if (mean === null || mean === undefined) return "s-none";
    if (mean >= 4.5) return "s5";
    if (mean >= 4.0) return "s4";
    if (mean >= 3.5) return "s3";
    if (mean >= 3.0) return "s2";
    return "s1";
  }

  function section(title, note) {
    const s = el("section", "block");
    s.appendChild(el("h2", null, title));
    if (note) s.appendChild(el("p", "note", note));
    return s;
  }

  function bar(pct, cls) {
    const wrap = el("div", "bar");
    const fill = el("span", cls || "");
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    wrap.appendChild(fill);
    return wrap;
  }

  function table(headers, rows, opts) {
    const o = opts || {};
    const t = el("table", o.cls || "");
    const thead = el("thead"), tr = el("tr");
    headers.forEach((h) => {
      const th = el("th", typeof h === "object" && h.numeric ? "num" : null,
        typeof h === "object" ? h.label : h);
      tr.appendChild(th);
    });
    thead.appendChild(tr); t.appendChild(thead);
    const tbody = el("tbody");
    rows.forEach((cells) => {
      const r = el("tr");
      cells.forEach((c) => {
        if (c && c.nodeType) { const td = el("td"); td.appendChild(c); r.appendChild(td); return; }
        const isObj = c && typeof c === "object";
        const td = el("td", isObj ? (c.cls || null) : null,
          isObj ? String(c.text) : (c === null || c === undefined ? "—" : String(c)));
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    t.appendChild(tbody);
    /* Wrapped so a wide table scrolls inside its own box. Without this the whole
       page scrolls sideways on a narrow screen and the headings drift off. */
    const wrap = el("div", "table-wrap");
    wrap.appendChild(t);
    return wrap;
  }

  /* ---------------------------------------------------------------- blocks */

  function renderHeadline(rep, root) {
    const s = rep.summary;
    const head = el("section", "headline");

    const title = el("div", "headline-title");
    title.appendChild(el("h2", null,
      (s.airports.join(", ") || "Airport") + " — Passenger Satisfaction"));
    title.appendChild(el("p", "note",
      s.n + " response" + (s.n === 1 ? "" : "s") + " · " + date(s.from) + " to " + date(s.to) +
      (s.gates.length ? " · gate " + s.gates.join(", ") : "")));
    head.appendChild(title);

    const tiles = el("div", "tiles");
    function tile(label, value, sub, cls) {
      const t = el("div", "tile " + (cls || ""));
      t.appendChild(el("div", "tile-value", value));
      t.appendChild(el("div", "tile-label", label));
      if (sub) t.appendChild(el("div", "tile-sub", sub));
      return t;
    }
    tiles.appendChild(tile("Overall satisfaction", fmt(s.overall.mean),
      "out of 5 · n=" + s.overall.n, scoreClass(s.overall.mean)));
    tiles.appendChild(tile("Overall experience", fmt(s.experience.mean),
      "out of 5 · n=" + s.experience.n, scoreClass(s.experience.mean)));
    tiles.appendChild(tile("Rated good or better",
      s.overall.top2 === null ? "—" : fmt(s.overall.top2, 1) + "%",
      "gave 4 or 5", "s-neutral"));
    tiles.appendChild(tile("Responses", String(s.n),
      s.medianDuration ? "median " + Math.round(s.medianDuration / 60) + " min to complete" : "",
      "s-neutral"));
    head.appendChild(tiles);

    if (s.n < 30) {
      head.appendChild(el("p", "caution",
        "Fewer than 30 responses — treat these figures as indicative. ACI requires several " +
        "hundred per quarter before an airport's score is considered comparable."));
    }

    const dist = el("div", "dist");
    dist.appendChild(el("h3", null, "How the overall score was given"));
    rep.summary.distribution.forEach((d) => {
      const row = el("div", "dist-row");
      row.appendChild(el("span", "dist-label", d.label));
      row.appendChild(bar(d.pct, "s" + d.value));
      row.appendChild(el("span", "dist-pct", fmt(d.pct, 1) + "%"));
      row.appendChild(el("span", "dist-n", "n=" + d.n));
      dist.appendChild(row);
    });
    head.appendChild(dist);
    root.appendChild(head);
  }

  function renderCategories(rep, root) {
    if (!rep.categories.length) return;
    const s = section("Satisfaction by category",
      "Each category is the average of its items, weighted by how many people rated each one — " +
      "the same method ACI uses.");
    const rows = rep.categories.map((c) => [
      c.name,
      { text: fmt(c.mean), cls: "num strong " + scoreClass(c.mean) },
      bar((c.mean / 5) * 100, scoreClass(c.mean)),
      { text: c.n, cls: "num dim" }
    ]);
    s.appendChild(table(["Category", { label: "Score", numeric: true }, "", { label: "Ratings", numeric: true }],
      rows, { cls: "cat-table" }));
    root.appendChild(s);
  }

  function renderItems(rep, root) {
    if (!rep.items.length) return;
    const s = section("All service items, best to worst",
      "N/A means the passenger said they did not use it — those are excluded from the average " +
      "rather than counted as a low score.");
    const rows = rep.items.map((i) => [
      i.label,
      { text: fmt(i.mean), cls: "num strong " + scoreClass(i.mean) },
      bar((i.mean / 5) * 100, scoreClass(i.mean)),
      { text: i.top2 === null ? "—" : fmt(i.top2, 0) + "%", cls: "num dim" },
      { text: i.n, cls: "num dim" },
      { text: i.na || "", cls: "num dim" }
    ]);
    s.appendChild(table(
      ["Service item", { label: "Score", numeric: true }, "",
       { label: "4–5", numeric: true }, { label: "n", numeric: true }, { label: "N/A", numeric: true }],
      rows, { cls: "item-table" }));
    root.appendChild(s);
  }

  function renderPriority(rep, root) {
    const top = rep.priority.filter((p) => p.score > 0).slice(0, 8);
    if (!top.length) return;
    const s = section("What to fix first",
      "Items where passengers score you below your own average AND named the item among their " +
      "three most important. Something scoring badly that nobody cares about is not the " +
      "priority — this is the part ACI's report does not give you.");
    const rows = top.map((p, n) => [
      { text: n + 1, cls: "num rank" },
      p.label,
      { text: fmt(p.mean), cls: "num strong " + scoreClass(p.mean) },
      { text: fmt(p.gap, 2), cls: "num " + (p.gap < 0 ? "neg" : "pos") },
      { text: fmt(p.importance, 0) + "%", cls: "num" },
      { text: p.n, cls: "num dim" }
    ]);
    s.appendChild(table(
      ["#", "Service item", { label: "Score", numeric: true },
       { label: "vs avg", numeric: true }, { label: "Called important", numeric: true },
       { label: "n", numeric: true }],
      rows, { cls: "prio-table" }));
    root.appendChild(s);
  }

  function renderImportance(rep, root) {
    const top = rep.importance.items.filter((i) => i.n > 0).slice(0, 8);
    if (!top.length) return;
    const byId = new Map(rep.items.map((i) => [i.id, i]));
    const s = section("What passengers said matters most",
      "Each passenger picked their three most important items. Base: " +
      rep.importance.base + " who answered.");
    const rows = top.map((i, n) => {
      const stat = byId.get(i.id);
      return [
        { text: n + 1, cls: "num rank" },
        i.label,
        bar(i.pct, "s-imp"),
        { text: fmt(i.pct, 0) + "%", cls: "num" },
        { text: stat ? fmt(stat.mean) : "—",
          cls: "num strong " + (stat ? scoreClass(stat.mean) : "s-none") }
      ];
    });
    s.appendChild(table(["#", "Service item", "", { label: "Named by", numeric: true },
      { label: "Your score", numeric: true }], rows, { cls: "imp-table" }));
    root.appendChild(s);
  }

  function renderSegments(rep, root) {
    const defs = [
      ["Reason for travel", rep.segments.reason],
      ["Flight status", rep.segments.flight],
      ["Travelling with", rep.segments.group],
      ["Age", rep.segments.age]
    ].filter((d) => d[1] && d[1].length);
    if (!defs.length) return;

    const s = section("Overall satisfaction by passenger type",
      "Where one group scores well below the others, the cause is usually specific and fixable.");
    const grid = el("div", "grid2");
    defs.forEach(([label, seg]) => {
      const card = el("div", "card");
      card.appendChild(el("h3", null, label));
      const rows = seg.map((g) => [
        g.key,
        { text: fmt(g.mean), cls: "num strong " + scoreClass(g.mean) },
        bar((g.mean / 5) * 100, scoreClass(g.mean)),
        { text: g.n, cls: "num dim" }
      ]);
      card.appendChild(table(["", { label: "Score", numeric: true }, "", { label: "n", numeric: true }], rows));
      grid.appendChild(card);
    });
    s.appendChild(grid);
    root.appendChild(s);
  }

  function renderEmotions(rep, root) {
    const rated = rep.emotions.filter((e) => e.n > 0);
    if (!rated.length) return;
    const s = section("How passengers felt",
      "Rated 1 (not at all) to 5 (extremely), right at the end of the journey through the airport. " +
      "The wording of these five is a placeholder until ACI's own list is available.");
    const rows = rated.map((e) => [
      e.label,
      { text: fmt(e.mean), cls: "num strong" },
      bar((e.mean / 5) * 100, "s-emo"),
      { text: e.n, cls: "num dim" }
    ]);
    s.appendChild(table(["Emotion", { label: "Score", numeric: true }, "", { label: "n", numeric: true }], rows));

    if (rep.crowd && rep.crowd.n) {
      s.appendChild(el("p", "note",
        "Perception of crowding averaged " + fmt(rep.crowd.mean) +
        " on a 1 (not at all crowded) to 5 (very crowded) scale, from " + rep.crowd.n + " responses."));
    }
    root.appendChild(s);
  }

  function renderTrend(rep, root) {
    const t = rep.trend;
    if (!t.series.length || t.series.length < 2) return;
    const s = section("Movement over time",
      "Comparing " + t.currMonth + " against " + t.prevMonth + ".");

    const rows = t.series.map((m) => [
      m.month,
      { text: fmt(m.mean), cls: "num strong " + scoreClass(m.mean) },
      bar((m.mean / 5) * 100, scoreClass(m.mean)),
      { text: m.n, cls: "num dim" }
    ]);
    s.appendChild(table(["Month", { label: "Overall", numeric: true }, "", { label: "n", numeric: true }], rows));

    if (t.deltas && t.deltas.length) {
      const moved = t.deltas.filter((d) => Math.abs(d.delta) >= 0.1);
      const up = moved.slice(0, 5);
      const down = moved.slice(-5).reverse();
      const grid = el("div", "grid2");
      [["Improved most", up], ["Fell most", down]].forEach(([label, list]) => {
        if (!list.length) return;
        const card = el("div", "card");
        card.appendChild(el("h3", null, label));
        card.appendChild(table(["Item", { label: "Was", numeric: true },
          { label: "Now", numeric: true }, { label: "Δ", numeric: true }],
          list.map((d) => [d.label, { text: fmt(d.prev), cls: "num dim" },
            { text: fmt(d.curr), cls: "num strong" },
            { text: (d.delta > 0 ? "+" : "") + fmt(d.delta),
              cls: "num " + (d.delta > 0 ? "pos" : "neg") }])));
        grid.appendChild(card);
      });
      s.appendChild(grid);
    }
    root.appendChild(s);
  }

  function renderProfile(rep, root) {
    const defs = [
      ["Gender", rep.profile.gender], ["Age", rep.profile.age],
      ["Reason for travel", rep.profile.reason], ["Travelling with", rep.profile.group],
      ["Return trips (12 months)", rep.profile.trips], ["Mode of transport", rep.profile.transport],
      ["Airport parking", rep.profile.parking], ["Mode of check-in", rep.profile.checkin],
      ["Arrival before departure", rep.profile.arrival], ["Connecting", rep.profile.connection],
      ["Flight status", rep.profile.status]
    ].filter((d) => d[1] && d[1].base > 0);
    if (!defs.length) return;

    const s = section("Who answered", "Passenger profile and travel behaviour.");
    const grid = el("div", "grid3");
    defs.forEach(([label, b]) => {
      const card = el("div", "card");
      card.appendChild(el("h3", null, label));
      const rows = b.rows.map((r) => [
        r.key, bar(r.pct, "s-prof"),
        { text: fmt(r.pct, 0) + "%", cls: "num" }
      ]);
      card.appendChild(table(["", "", ""], rows, { cls: "tight" }));
      card.appendChild(el("p", "base", "n=" + b.base + (b.multi ? " · multiple answers allowed" : "")));
      grid.appendChild(card);
    });
    s.appendChild(grid);
    root.appendChild(s);
  }

  function renderComments(rep, root) {
    if (!rep.comments.length) return;
    const s = section("What passengers wrote",
      rep.comments.length + " comment" + (rep.comments.length === 1 ? "" : "s") + ", verbatim.");
    Q.OPEN_ENDED.forEach((q) => {
      const list = rep.comments.filter((c) => c.question === q.id);
      if (!list.length) return;
      s.appendChild(el("h3", null, q.label));
      const ul = el("ul", "comments");
      list.forEach((c) => {
        const li = el("li");
        li.appendChild(el("span", "c-text", c.text));
        li.appendChild(el("span", "c-meta", date(c.at) + (c.gate ? " · gate " + c.gate : "")));
        ul.appendChild(li);
      });
      s.appendChild(ul);
    });
    root.appendChild(s);
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    const root = $("report");
    root.innerHTML = "";
    if (!responses.length) return;

    const rep = Stats.build(responses);
    renderHeadline(rep, root);
    renderPriority(rep, root);
    renderCategories(rep, root);
    renderImportance(rep, root);
    renderItems(rep, root);
    renderSegments(rep, root);
    renderEmotions(rep, root);
    renderTrend(rep, root);
    renderProfile(rep, root);
    renderComments(rep, root);

    root.appendChild(el("p", "generated",
      "Generated " + new Date().toISOString().slice(0, 16).replace("T", " ") +
      " from " + responses.length + " response" + (responses.length === 1 ? "" : "s") +
      ". Not an ACI benchmark."));

    $("dropzone").hidden = true;
    $("topActions").hidden = false;
    window.__report = rep;
  }

  /* ----------------------------------------------------------- file intake */

  function showWarnings(list) {
    const box = $("warnings");
    box.innerHTML = "";
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("strong", null, "Note"));
    const ul = el("ul");
    list.forEach((w) => ul.appendChild(el("li", null, w)));
    box.appendChild(ul);
  }

  function readFile(file) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(Parse.parseFile(String(fr.result), file.name));
      fr.onerror = () => resolve({ responses: [], warnings: [file.name + ": could not be read"] });
      fr.readAsText(file, "utf-8");
    });
  }

  async function addFiles(files) {
    const list = Array.from(files).filter((f) => /\.csv$/i.test(f.name));
    if (!list.length) { showWarnings(["No .csv files in that selection."]); return; }
    const sets = await Promise.all(list.map(readFile));
    /* Existing responses are folded back in as a set, so "Add more files" merges
       with what is already loaded instead of replacing it. */
    const existing = { responses: responses, warnings: [] };
    const merged = Parse.merge([existing].concat(sets));
    responses = merged.responses;
    showWarnings(merged.warnings);
    if (!responses.length) showWarnings(merged.warnings.concat(["No responses could be read."]));
    render();
  }

  $("pickBtn").addEventListener("click", () => $("fileInput").click());
  $("addBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "drop" || e.relatedTarget === null) document.body.classList.remove("dragging");
    }));
  document.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  $("printBtn").addEventListener("click", () => window.print());

  /* Aggregates, not raw responses — this is the file you hand to someone who
     wants to check the arithmetic without receiving passenger free-text. */
  $("xlsBtn").addEventListener("click", () => {
    const rep = window.__report;
    if (!rep) return;
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [["Section", "Item", "Score", "n", "N/A", "% 4-5", "% named important"].join(",")];
    lines.push(["Overall", "Overall Satisfaction", rep.summary.overall.mean,
      rep.summary.overall.n, "", rep.summary.overall.top2, ""].map(esc).join(","));
    lines.push(["Overall", "Overall Experience", rep.summary.experience.mean,
      rep.summary.experience.n, "", rep.summary.experience.top2, ""].map(esc).join(","));
    rep.categories.forEach((c) =>
      lines.push(["Category", c.name, c.mean, c.n, "", "", ""].map(esc).join(",")));
    const impBy = new Map(rep.importance.items.map((i) => [i.id, i.pct]));
    rep.items.forEach((i) =>
      lines.push(["Item", i.label, i.mean, i.n, i.na, i.top2, impBy.get(i.id) || 0].map(esc).join(",")));
    rep.emotions.forEach((e) =>
      lines.push(["Emotion", e.label, e.mean, e.n, "", "", ""].map(esc).join(",")));

    const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "asq-aggregates-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  /* Exposed for the verification pass. */
  window.__loadCsvText = (text, name) => {
    const merged = Parse.merge([{ responses: responses, warnings: [] },
                                Parse.parseFile(text, name || "test.csv")]);
    responses = merged.responses;
    showWarnings(merged.warnings);
    render();
    return { n: responses.length, warnings: merged.warnings };
  };
})();
