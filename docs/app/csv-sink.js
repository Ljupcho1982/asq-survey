/* csv-sink.js — appending each response to a CSV file on disk.
 *
 * Three environments, three ways to reach a filesystem, one interface:
 *
 *   capacitor  the Android APK. Writes to Documents/ASQ/<name>.csv, which shows
 *              up over USB and in any file manager. Fully automatic.
 *   fsaccess   desktop Chrome/Edge. The operator picks the file once; the handle
 *              is kept in IndexedDB and reused, so later responses append with
 *              no further prompting.
 *   download   Firefox, Safari, iOS — no append API exists, so the file is
 *              rebuilt and re-downloaded from the stored responses instead.
 *
 * The header is written exactly once, when the file is empty or absent.
 */
"use strict";

(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./submit.js") : root.Submit
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CsvSink = api;
})(typeof self !== "undefined" ? self : this, function (Submit) {

  const HANDLE_KEY = "csvFile";
  const DIR = "ASQ";
  const BOM = "﻿";   /* without it Excel renders é and č as mojibake */

  function cap() {
    const C = typeof window !== "undefined" && window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    const fs = C.Plugins && C.Plugins.Filesystem;
    return fs || null;
  }

  function hasFsAccess() {
    return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
  }

  function mode() {
    if (cap()) return "capacitor";
    if (hasFsAccess()) return "fsaccess";
    return "download";
  }

  /* ------------------------------------------------------------- capacitor */

  function capPath(settings) {
    return DIR + "/" + (settings.csvFileName || "asq-responses.csv");
  }

  async function capAppend(settings, rows) {
    const fs = cap();
    const path = capPath(settings);
    const opts = { path: path, directory: "DOCUMENTS", encoding: "utf8" };

    let exists = true;
    try { await fs.stat({ path: path, directory: "DOCUMENTS" }); }
    catch (e) { exists = false; }

    if (!exists) {
      /* mkdir is not idempotent across plugin versions, so a second call on an
         existing folder is expected and ignored. */
      try { await fs.mkdir({ path: DIR, directory: "DOCUMENTS", recursive: true }); }
      catch (e) { /* already there */ }
      await fs.writeFile(Object.assign({}, opts,
        { data: BOM + Submit.csvHeader() + "\r\n" + rows.join("\r\n") + "\r\n" }));
      return;
    }
    await fs.appendFile(Object.assign({}, opts, { data: rows.join("\r\n") + "\r\n" }));
  }

  async function capDescribe(settings) {
    return "Documents/" + capPath(settings);
  }

  /* -------------------------------------------------------------- fsaccess */

  async function storedHandle(adapter) {
    try { return (await adapter.getHandle(HANDLE_KEY)) || null; } catch (e) { return null; }
  }

  /* Permission on a stored handle does not survive a browser restart, and asking
     for it again requires a user gesture — hence `prompt`, which is only true
     when this is called from a click. */
  async function ensurePermission(handle, prompt) {
    if (!handle.queryPermission) return true;
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (!prompt) return false;
    return (await handle.requestPermission(opts)) === "granted";
  }

  async function fsAppend(adapter, rows) {
    const handle = await storedHandle(adapter);
    if (!handle) throw new Error("No CSV file chosen yet — open Settings and pick one.");
    if (!(await ensurePermission(handle, false))) {
      throw new Error("Lost write access to the CSV file — reconnect it in Settings.");
    }
    const file = await handle.getFile();
    const size = file.size;
    const writable = await handle.createWritable({ keepExistingData: true });
    const body = (size === 0 ? BOM + Submit.csvHeader() + "\r\n" : "") + rows.join("\r\n") + "\r\n";
    /* Positioned at the end rather than truncating — createWritable() otherwise
       starts an empty file and every earlier response would vanish. */
    await writable.write({ type: "write", position: size, data: body });
    await writable.close();
  }

  async function fsConnect(adapter, settings) {
    const handle = await window.showSaveFilePicker({
      suggestedName: settings.csvFileName || "asq-responses.csv",
      types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }]
    });
    if (!(await ensurePermission(handle, true))) throw new Error("Write access was declined.");
    await adapter.putHandle(HANDLE_KEY, handle);
    return handle.name;
  }

  async function fsDescribe(adapter) {
    const handle = await storedHandle(adapter);
    if (!handle) return null;
    const granted = await ensurePermission(handle, false);
    return handle.name + (granted ? "" : " (needs reconnecting)");
  }

  /* -------------------------------------------------------------- download */

  /* No append API here, so the whole file is regenerated from what is stored and
     handed to the browser. That means one download per response, which is why
     this is the last resort rather than the default. */
  function downloadAll(payloads, settings) {
    const csv = Submit.csvDocument(payloads);
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = settings.csvFileName || "asq-responses.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ------------------------------------------------------------------ API */

  function make(adapter) {
    return {
      mode: mode,

      /* Whether a response can be written right now without asking anything. */
      async isReady(settings) {
        const m = mode();
        if (m === "capacitor") return true;
        if (m === "download") return true;
        const handle = await storedHandle(adapter);
        return !!handle && (await ensurePermission(handle, false));
      },

      /* Called from a click — picks the file on desktop; a no-op elsewhere. */
      async connect(settings) {
        if (mode() !== "fsaccess") return null;
        return fsConnect(adapter, settings);
      },

      async describe(settings) {
        const m = mode();
        if (m === "capacitor") return capDescribe(settings);
        if (m === "fsaccess") return fsDescribe(adapter);
        return "downloaded to your browser's Downloads folder";
      },

      async disconnect() {
        try { await adapter.removeHandle(HANDLE_KEY); } catch (e) { /* nothing stored */ }
      },

      /* Appends one response. Rejects if it could not be written, which leaves
         the record pending in the queue rather than losing it. */
      async append(payload, settings, allPayloads) {
        const row = Submit.csvRow(payload);
        const m = mode();
        if (m === "capacitor") return capAppend(settings, [row]);
        if (m === "fsaccess") return fsAppend(adapter, [row]);
        downloadAll(allPayloads || [payload], settings);
      }
    };
  }

  return { make, mode, HANDLE_KEY, BOM };
});
