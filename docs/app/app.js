/* app.js — the kiosk.
 *
 * One device, passenger after passenger. Three things follow from that and
 * shape most of the code below:
 *   • a partial response must never leak into the next passenger's answers, so
 *     walking away triggers a hard reset (see startIdleTimer);
 *   • the recipient address must not be reachable by a curious passenger, so
 *     Settings is behind five taps and a PIN;
 *   • the screen must not sleep, so a wake lock is held and re-acquired.
 */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const screenEl   = $("screen");
  const navEl      = $("nav");
  const backBtn    = $("backBtn");
  const nextBtn    = $("nextBtn");
  const hintEl     = $("hint");
  const progressEl = $("progress");
  const fillEl     = $("progressFill");
  const ptextEl    = $("progressText");
  const badgeEl    = $("queueBadge");

  let settings = Store.loadSettings();
  const adapter = Store.idbAdapter();
  const queue = Store.makeQueue(adapter);
  const sink = CsvSink.make(adapter);

  let answers = {};
  let index = 0;                 /* position in Q.SCREENS */
  let startedAt = null;
  let idleTimer = null;
  let thanksTimer = null;
  let wakeLock = null;

  /* ------------------------------------------------------------ wake lock */

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      /* The lock is dropped whenever the tab is backgrounded, so it has to be
         taken again on every return to visibility, not just once at startup. */
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) { /* denied or unsupported — the tablet's own display timeout applies */ }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !wakeLock) acquireWakeLock();
  });

  /* ----------------------------------------------------------- idle reset */

  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  function startIdleTimer() {
    clearIdle();
    const screen = Q.SCREENS[index];
    /* Welcome and thank-you are resting states — nothing to abandon there. */
    if (!screen || screen.kind === "welcome" || screen.kind === "thanks") return;
    if (!$("settingsPane").hidden) return;
    idleTimer = setTimeout(() => { resetToWelcome(); }, Math.max(20, settings.idleSeconds) * 1000);
  }

  ["pointerdown", "keydown", "input"].forEach((ev) =>
    document.addEventListener(ev, () => { if (idleTimer) startIdleTimer(); }, true));

  function resetToWelcome() {
    clearIdle();
    if (thanksTimer) { clearTimeout(thanksTimer); thanksTimer = null; }
    answers = {};
    startedAt = null;
    index = 0;
    render();
  }

  /* ------------------------------------------------------- screen helpers */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* Items the passenger is actually asked. Connection quality is meaningless to
     someone who did not connect, and ACI reports it as N/A at SKP for that reason. */
  function visibleItems(catId) {
    return Q.itemsIn(catId).filter((i) => !i.connectingOnly || answers.q2_connection === "Yes");
  }

  function activeScreens() {
    return Q.SCREENS.filter((s) => s.kind !== "rating" || visibleItems(s.category).length > 0);
  }

  /* A row of 1–5 buttons plus an explicit opt-out. Without the opt-out, someone
     who never went near a shop has to either lie or leave a hole. */
  function scaleRow(id, scale, current, opts) {
    const o = opts || {};
    const row = el("div", "scale" + (o.wide ? " scale-wide" : ""));
    scale.forEach((s) => {
      const b = el("button", "opt scale-opt v" + s.value);
      b.type = "button";
      b.innerHTML = '<span class="opt-num">' + s.value + '</span>' +
                    '<span class="opt-label">' + s.label + "</span>";
      if (String(current) === String(s.value)) b.classList.add("on");
      b.addEventListener("click", () => { answers[id] = s.value; render(true); });
      row.appendChild(b);
    });
    if (o.allowNA) {
      const na = el("button", "opt scale-opt na", "N/A");
      na.type = "button";
      na.title = "Did not use";
      if (current === Q.NOT_APPLICABLE) na.classList.add("on");
      na.addEventListener("click", () => { answers[id] = Q.NOT_APPLICABLE; render(true); });
      row.appendChild(na);
    }
    return row;
  }

  function optionButtons(id, options, multi) {
    const wrap = el("div", "options");
    options.forEach((opt) => {
      const b = el("button", "opt chip", opt);
      b.type = "button";
      const cur = answers[id];
      const on = multi ? Array.isArray(cur) && cur.includes(opt) : cur === opt;
      if (on) b.classList.add("on");
      b.addEventListener("click", () => {
        if (multi) {
          const list = Array.isArray(answers[id]) ? answers[id].slice() : [];
          const at = list.indexOf(opt);
          if (at >= 0) list.splice(at, 1); else list.push(opt);
          answers[id] = list;
        } else {
          answers[id] = answers[id] === opt ? undefined : opt;
        }
        render(true);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* --------------------------------------------------------- screen bodies */

  function renderWelcome() {
    const w = el("div", "welcome");
    w.appendChild(el("h2", "welcome-title", "How was your airport experience today?"));
    w.appendChild(el("p", "welcome-sub",
      "It takes about four minutes, and it shapes what gets fixed here next."));
    const start = el("button", "btn start", "Start");
    start.addEventListener("click", () => {
      startedAt = Date.now();
      index = 1;
      render();
    });
    w.appendChild(start);
    w.appendChild(el("p", "consent",
      "Answers are anonymous. No name, seat or booking is recorded, and responses " +
      "are used only to measure service quality at this airport."));
    screenEl.appendChild(w);
  }

  function renderProfileScreen(screen) {
    screen.questions.forEach((qid) => {
      const p = Q.profile(qid);
      if (!p) return;
      const block = el("div", "qblock");
      block.appendChild(el("h3", "qlabel", p.label));
      if (p.type === "text") {
        const inp = el("input", "text-input");
        inp.type = "text";
        inp.placeholder = p.placeholder || "";
        inp.value = answers[qid] || "";
        inp.addEventListener("input", () => {
          answers[qid] = inp.value.trim();
          updateNav();
        });
        block.appendChild(inp);
      } else {
        block.appendChild(optionButtons(qid, p.options, p.type === "multi"));
        if (p.type === "multi") block.appendChild(el("p", "qnote", "Select all that apply."));
      }
      screenEl.appendChild(block);
    });
  }

  function renderRatingScreen(screen) {
    screenEl.appendChild(el("p", "screen-note",
      "Rate each one from Poor to Excellent, or tap N/A if you did not use it."));
    visibleItems(screen.category).forEach((item) => {
      const block = el("div", "qblock rating");
      block.appendChild(el("h3", "qlabel", item.label));
      block.appendChild(scaleRow(item.id, Q.SAT_SCALE, answers[item.id], { allowNA: true }));
      screenEl.appendChild(block);
    });
  }

  function renderOverall() {
    Q.OVERALL.forEach((o) => {
      const block = el("div", "qblock rating");
      block.appendChild(el("h3", "qlabel", o.label));
      block.appendChild(scaleRow(o.id, Q.SAT_SCALE, answers[o.id], { wide: true }));
      screenEl.appendChild(block);
    });
  }

  function renderImportance() {
    const p = Q.profile("q11_important");
    const chosen = Array.isArray(answers.q11_important) ? answers.q11_important : [];
    screenEl.appendChild(el("p", "screen-note", p.label));

    Q.CATEGORIES.forEach((cat) => {
      const items = visibleItems(cat.id);
      if (!items.length) return;
      const group = el("div", "imp-group");
      group.appendChild(el("h3", "imp-cat", cat.name));
      const wrap = el("div", "options");
      items.forEach((item) => {
        const b = el("button", "opt chip", item.short);
        b.type = "button";
        const on = chosen.includes(item.id);
        if (on) b.classList.add("on");
        /* Cap at 3 by disabling rather than silently dropping the oldest pick —
           a chip that goes dead is legible; one that vanishes is not. */
        if (!on && chosen.length >= p.max) b.classList.add("disabled");
        b.addEventListener("click", () => {
          const list = (Array.isArray(answers.q11_important) ? answers.q11_important : []).slice();
          const at = list.indexOf(item.id);
          if (at >= 0) list.splice(at, 1);
          else if (list.length < p.max) list.push(item.id);
          answers.q11_important = list;
          render(true);
        });
        wrap.appendChild(b);
      });
      group.appendChild(wrap);
      screenEl.appendChild(group);
    });
  }

  function renderEmotions() {
    screenEl.appendChild(el("p", "screen-note",
      "Right now, at the end of your journey through this airport, how much do you feel…"));
    Q.EMOTIONS.forEach((e) => {
      const block = el("div", "qblock rating");
      block.appendChild(el("h3", "qlabel", e.label));
      block.appendChild(scaleRow(e.id, Q.EMOTION_SCALE, answers[e.id], {}));
      screenEl.appendChild(block);
    });
  }

  function renderCrowd() {
    const block = el("div", "qblock rating");
    block.appendChild(el("h3", "qlabel", Q.CROWD.label));
    block.appendChild(scaleRow(Q.CROWD.id, Q.CROWD_SCALE, answers[Q.CROWD.id], { wide: true }));
    screenEl.appendChild(block);
  }

  function renderOpen() {
    Q.OPEN_ENDED.forEach((o) => {
      const block = el("div", "qblock");
      block.appendChild(el("h3", "qlabel", o.label));
      const ta = el("textarea", "text-area");
      ta.rows = 4;
      ta.maxLength = 1000;
      ta.value = answers[o.id] || "";
      ta.addEventListener("input", () => { answers[o.id] = ta.value; });
      block.appendChild(ta);
      screenEl.appendChild(block);
    });
    screenEl.appendChild(el("p", "qnote", "Optional — leave blank if you would rather not."));
  }

  function renderThanks() {
    const w = el("div", "welcome");
    w.appendChild(el("h2", "welcome-title", "Thank you."));
    w.appendChild(el("p", "welcome-sub", "Your response has been recorded. Safe travels."));
    const again = el("button", "btn start", "Done");
    again.addEventListener("click", resetToWelcome);
    w.appendChild(again);
    screenEl.appendChild(w);
    thanksTimer = setTimeout(resetToWelcome, Math.max(2, settings.thanksSeconds) * 1000);
  }

  /* ------------------------------------------------------------ validation
   * Ratings are never forced: a passenger who will not rate the shops should be
   * able to move on, and a coerced 3 is worse data than a blank. Only the two
   * questions that route the rest of the survey are required.
   */
  function blockingReason() {
    const screen = Q.SCREENS[index];
    if (!screen) return null;
    if (screen.id === "trip" && !answers.q2_connection) {
      return "Please answer whether you are connecting — it decides what we ask next.";
    }
    if (screen.kind === "importance") {
      const n = (answers.q11_important || []).length;
      if (n !== 3) return "Please pick exactly 3 — " + n + " selected.";
    }
    return null;
  }

  /* ---------------------------------------------------------------- render */

  function updateNav() {
    const screen = Q.SCREENS[index];
    const flow = activeScreens();
    const pos = flow.indexOf(screen);
    const resting = screen.kind === "welcome" || screen.kind === "thanks";

    navEl.hidden = resting;
    progressEl.hidden = resting;
    if (!resting) {
      /* The welcome and thank-you screens are not steps the passenger walks. */
      const total = flow.length - 2;
      const step = pos;
      fillEl.style.width = Math.round((step / total) * 100) + "%";
      ptextEl.textContent = "Step " + step + " of " + total;
      backBtn.disabled = pos <= 1;
      const last = screen.kind === "open";
      nextBtn.textContent = last ? "Submit" : "Next";
      const reason = blockingReason();
      nextBtn.disabled = !!reason;
      hintEl.textContent = reason || "";
    }
  }

  /* keepScroll: a tap on an option re-renders the screen, and without this the
     list would jump back to the top every time an answer is given. */
  function render(keepScroll) {
    const y = keepScroll ? screenEl.scrollTop : 0;
    const screen = Q.SCREENS[index];
    screenEl.innerHTML = "";

    if (screen.title) screenEl.appendChild(el("h2", "screen-title", screen.title));

    switch (screen.kind) {
      case "welcome":    renderWelcome(); break;
      case "profile":    renderProfileScreen(screen); break;
      case "rating":     renderRatingScreen(screen); break;
      case "overall":    renderOverall(); break;
      case "importance": renderImportance(); break;
      case "emotions":   renderEmotions(); break;
      case "crowd":      renderCrowd(); break;
      case "open":       renderOpen(); break;
      case "thanks":     renderThanks(); break;
    }

    updateNav();
    screenEl.scrollTop = y;
    startIdleTimer();
    refreshBadge();
  }

  /* -------------------------------------------------------------- stepping */

  function step(delta) {
    const flow = activeScreens();
    const pos = flow.indexOf(Q.SCREENS[index]);
    const nextScreen = flow[pos + delta];
    if (!nextScreen) return;
    index = Q.SCREENS.indexOf(nextScreen);
    render();
  }

  backBtn.addEventListener("click", () => step(-1));

  nextBtn.addEventListener("click", async () => {
    if (blockingReason()) return;
    if (Q.SCREENS[index].kind === "open") { await submitResponse(); return; }
    step(1);
  });

  /* ------------------------------------------------------------- submitting */

  /* Routing lives in submit.js so the selftest can drive it; see makeDeliverer. */
  const deliverOne = Submit.makeDeliverer(sink, () => settings, {
    persist: (record) => adapter.put(record),
    allPayloads: async () => (await queue.all()).map((r) => r.payload)
  });

  async function submitResponse() {
    nextBtn.disabled = true;
    nextBtn.textContent = "Saving…";
    const payload = Submit.buildPayload(answers, settings, { startedAt: startedAt });

    /* Written to disk first, sent second. If the network is down — or the
       recipient was never configured — the response is already safe. */
    await queue.enqueue(payload);

    index = Q.SCREENS.findIndex((s) => s.kind === "thanks");
    render();

    try { await queue.flush(deliverOne); } catch (e) { /* stays pending, retried later */ }
    refreshBadge();
  }

  /* ------------------------------------------------------------ queue badge */

  async function refreshBadge() {
    try {
      const c = await queue.counts();
      if (c.pending > 0) {
        badgeEl.hidden = false;
        badgeEl.textContent = c.pending + " waiting to send";
      } else {
        badgeEl.hidden = true;
      }
      const stat = $("queueStat");
      if (stat) stat.textContent = "Queue: " + c.pending + " pending · " + c.sent + " sent";
    } catch (e) { /* IndexedDB unavailable — the survey still runs */ }
  }

  window.addEventListener("online", async () => {
    try { await queue.flush(deliverOne); } catch (e) { /* still offline */ }
    refreshBadge();
  });
  setInterval(async () => {
    if (!navigator.onLine) return;
    try { await queue.flush(deliverOne); } catch (e) { /* nothing to do */ }
    refreshBadge();
  }, 60000);

  /* --------------------------------------------------------------- settings */

  const pane = $("settingsPane");
  let brandTaps = 0, brandTapAt = 0;

  $("brand").addEventListener("click", () => {
    const now = Date.now();
    brandTaps = now - brandTapAt < 1200 ? brandTaps + 1 : 1;
    brandTapAt = now;
    if (brandTaps >= 5) { brandTaps = 0; openSettings(); }
  });

  function openSettings() {
    clearIdle();
    pane.hidden = false;
    $("pinStep").hidden = false;
    $("settingsStep").hidden = true;
    $("pinErr").hidden = true;
    $("pinInput").value = "";
    $("pinInput").focus();
  }

  function closeSettings() {
    pane.hidden = true;
    startIdleTimer();
  }

  /* Shows only the fields the chosen delivery actually needs, and reports where
     the CSV will land — which differs per platform, so it is read from the sink
     rather than described in prose the operator has to translate. */
  async function refreshDeliveryUI() {
    const mode = $("setDelivery").value;
    $("csvBox").hidden = mode === "email";
    $("emailBox").hidden = mode === "csv";

    if (mode === "email") return;
    const pending = Object.assign({}, settings, { csvFileName: $("setCsvName").value.trim() });
    const where = await sink.describe(pending);
    const m = sink.mode();

    $("csvPickBtn").hidden = m !== "fsaccess";
    $("csvOpenBtn").hidden = m === "capacitor";

    if (m === "capacitor") {
      $("csvWhere").textContent = "Responses are appended to " + where +
        " on this tablet. Copy it off over USB, or with any file manager.";
    } else if (m === "fsaccess") {
      $("csvWhere").textContent = where
        ? "Appending to " + where + ". The file stays where you put it."
        : "No file chosen yet — pick one and every response will be appended to it.";
      $("csvPickBtn").textContent = where ? "Change the CSV file…" : "Choose the CSV file…";
    } else {
      $("csvWhere").textContent = "This browser cannot append to a file, so each response " +
        "re-downloads the full CSV to your Downloads folder. Chrome or Edge can write to one " +
        "file properly.";
    }
  }

  $("setDelivery").addEventListener("change", refreshDeliveryUI);

  $("csvPickBtn").addEventListener("click", async () => {
    try {
      const name = await sink.connect(Object.assign({}, settings,
        { csvFileName: $("setCsvName").value.trim() }));
      if (name) $("setCsvName").value = name;
      $("queueMsg").textContent = "CSV file connected.";
    } catch (e) {
      /* An AbortError just means the operator closed the picker. */
      if (e.name !== "AbortError") $("queueMsg").textContent = "Could not connect: " + e.message;
    }
    refreshDeliveryUI();
  });

  $("csvOpenBtn").addEventListener("click", () => $("exportBtn").click());

  $("pinCancel").addEventListener("click", closeSettings);
  $("pinOk").addEventListener("click", () => {
    if ($("pinInput").value !== String(settings.pin)) { $("pinErr").hidden = false; return; }
    $("pinStep").hidden = true;
    $("settingsStep").hidden = false;
    $("setDelivery").value = settings.delivery || "csv";
    $("setCsvName").value = settings.csvFileName || "asq-responses.csv";
    $("setRecipient").value = settings.recipient || "";
    refreshDeliveryUI();
    $("setAirport").value   = settings.airport || "";
    $("setTerminal").value  = settings.terminal || "";
    $("setGate").value      = settings.gate || "";
    $("setIdle").value      = settings.idleSeconds;
    $("setThanks").value    = settings.thanksSeconds;
    $("setPin").value       = settings.pin;
    refreshBadge();
  });
  $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pinOk").click(); });

  $("settingsClose").addEventListener("click", closeSettings);
  $("settingsSave").addEventListener("click", async () => {
    settings = Store.saveSettings({
      delivery: $("setDelivery").value,
      csvFileName: $("setCsvName").value.trim() || Store.DEFAULT_SETTINGS.csvFileName,
      recipient: $("setRecipient").value.trim(),
      airport: $("setAirport").value.trim(),
      terminal: $("setTerminal").value.trim(),
      gate: $("setGate").value.trim(),
      idleSeconds: Number($("setIdle").value) || Store.DEFAULT_SETTINGS.idleSeconds,
      thanksSeconds: Number($("setThanks").value) || Store.DEFAULT_SETTINGS.thanksSeconds,
      pin: $("setPin").value.trim() || Store.DEFAULT_SETTINGS.pin
    });
    $("brandSub").textContent = settings.airport
      ? settings.airport + (settings.terminal ? " · " + settings.terminal : "")
      : "Airport Service Quality";

    /* Create the file now rather than on the first submission — an Android
       permission dialog belongs in front of the operator, not a passenger. */
    if (settings.delivery !== "email") {
      try {
        const r = await sink.probe(settings);
        if (r === "created") $("queueMsg").textContent = "CSV file created.";
      } catch (e) {
        $("queueMsg").textContent = "Could not write the CSV file: " + e.message;
        refreshDeliveryUI();
        return;                       /* stay open so the problem is dealt with now */
      }
    }
    closeSettings();
  });

  $("flushBtn").addEventListener("click", async () => {
    const msg = $("queueMsg");
    msg.textContent = "Sending…";
    try {
      const r = await queue.flush(deliverOne);
      msg.textContent = "Sent " + r.sent + ", " + r.remaining + " still pending" +
        (r.failed ? " (last attempt failed)" : "") + ".";
    } catch (e) {
      msg.textContent = "Could not send: " + e.message;
    }
    refreshBadge();
  });

  $("exportBtn").addEventListener("click", async () => {
    const records = await queue.all();
    const csv = Submit.csvDocument(records.map((r) => r.payload));
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "asq-" + (settings.airport || "responses") + "-" +
                 new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $("queueMsg").textContent = "Exported " + records.length + " response(s).";
  });

  $("clearBtn").addEventListener("click", async () => {
    const c = await queue.counts();
    if (c.pending > 0 &&
        !confirm(c.pending + " response(s) have not been emailed yet. Clear anyway?")) return;
    if (!confirm("Delete all stored responses on this device?")) return;
    const n = await queue.clear();
    $("queueMsg").textContent = "Cleared " + n + " record(s).";
    refreshBadge();
  });

  /* ------------------------------------------------------------------ boot */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  $("brandSub").textContent = settings.airport
    ? settings.airport + (settings.terminal ? " · " + settings.terminal : "")
    : "Airport Service Quality";

  acquireWakeLock();
  queue.prune().catch(() => {});
  render();

  /* Exposed for the browser-driven checks in the verification pass. */
  window.__asq = {
    get answers() { return answers; },
    get settings() { return settings; },
    queue: queue,
    goto(id) { index = Q.SCREENS.findIndex((s) => s.id === id); render(); },
    fill() {
      Q.ITEMS.forEach((i) => { answers[i.id] = 4; });
      Q.OVERALL.forEach((o) => { answers[o.id] = 5; });
      Q.EMOTIONS.forEach((e) => { answers[e.id] = 3; });
      answers.q2_connection = "No";
      answers.q3_reason = "Business";
      answers.crowd = 2;
      answers.q11_important = ["arr_ease", "thr_wayfinding", "sec_ease"];
      render();
    }
  };
})();
