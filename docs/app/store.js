/* store.js — settings, and the durable submission queue.
 *
 * The queue is the reason a response can't be lost: every submission is written
 * to IndexedDB as `pending` BEFORE any network call, and only flips to `sent`
 * once FormSubmit has actually accepted it. A gate tablet on airport Wi-Fi will
 * drop out mid-survey; that must cost nothing.
 *
 * The state machine is kept free of IndexedDB so the selftest can drive it with
 * a plain in-memory adapter — makeQueue(adapter) is the whole seam.
 */
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== "undefined" ? self : this, function () {

  const SETTINGS_KEY = "asq.settings";
  const DB_NAME = "asq";
  const DB_VERSION = 2;              /* v2 adds the `handles` store for the CSV file */
  const STORE = "submissions";
  const HANDLES = "handles";
  const KEEP_SENT_DAYS = 30;

  const DEFAULT_SETTINGS = {
    /* Where completed responses go. "csv" writes them to a file on disk and needs
       nothing else set up; "email" sends them through FormSubmit; "both" does
       each and only counts a response delivered once both succeed. */
    delivery: "csv",
    csvFileName: "asq-responses.csv",
    /* Deliberately blank. The recipient is typed in on the device rather than
       committed to a file — see README, "First run". */
    recipient: "",
    airport: "SKP",
    terminal: "",
    gate: "",
    pin: "1982",
    idleSeconds: 90,
    thanksSeconds: 6
  };

  /* ------------------------------------------------------------- settings */

  function loadSettings(storage) {
    const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return Object.assign({}, DEFAULT_SETTINGS);
    try {
      const raw = s.getItem(SETTINGS_KEY);
      return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(next, storage) {
    const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const merged = Object.assign(loadSettings(s), next);
    if (s) { try { s.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch (e) { /* full or private mode */ } }
    return merged;
  }

  /* -------------------------------------------------------- queue (pure-ish)
   * adapter: { all(), put(record), remove(id) } — each may return a promise.
   */
  function makeQueue(adapter) {
    async function enqueue(payload) {
      const record = {
        id: payload.meta.responseId,
        status: "pending",
        attempts: 0,
        createdAt: payload.meta.submittedAt,
        lastError: null,
        sentAt: null,
        payload: payload
      };
      await adapter.put(record);
      return record;
    }

    async function pending() {
      const all = await adapter.all();
      /* Oldest first: a queue that drains newest-first reorders the responses in
         the recipient's inbox and makes a backlog look like a burst of new ones. */
      return all.filter((r) => r.status === "pending")
                .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }

    async function counts() {
      const all = await adapter.all();
      return {
        pending: all.filter((r) => r.status === "pending").length,
        sent: all.filter((r) => r.status === "sent").length
      };
    }

    async function markSent(id, at) {
      const all = await adapter.all();
      const rec = all.find((r) => r.id === id);
      if (!rec) return null;
      rec.status = "sent";
      rec.sentAt = at || new Date().toISOString();
      rec.lastError = null;
      await adapter.put(rec);
      return rec;
    }

    async function markFailed(id, error) {
      const all = await adapter.all();
      const rec = all.find((r) => r.id === id);
      if (!rec) return null;
      /* Stays `pending` on purpose — a failure is a retry, not a dead letter. */
      rec.attempts += 1;
      rec.lastError = String(error && error.message ? error.message : error);
      await adapter.put(rec);
      return rec;
    }

    /* send(payload, record) resolves on delivery and rejects otherwise. The
       record is passed so a partially-delivered response (CSV written, email
       still failing) can remember what already went out and not repeat it. */
    async function flush(send) {
      const queue = await pending();
      let sent = 0, failed = 0;
      for (const rec of queue) {
        try {
          await send(rec.payload, rec);
          await markSent(rec.id);
          sent++;
        } catch (err) {
          await markFailed(rec.id, err);
          failed++;
          /* One dead connection means the rest will fail too — stop rather than
             burning through the whole backlog incrementing attempts. */
          break;
        }
      }
      return { sent, failed, remaining: (await pending()).length };
    }

    async function sentRecords() {
      const all = await adapter.all();
      return all.filter((r) => r.status === "sent")
                .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }

    async function all() { return adapter.all(); }

    /* Sent responses back the CSV export; after a month they are just bulk. */
    async function prune(now) {
      const cutoff = (now ? new Date(now) : new Date()).getTime() - KEEP_SENT_DAYS * 864e5;
      const records = await adapter.all();
      let removed = 0;
      for (const r of records) {
        if (r.status === "sent" && new Date(r.sentAt || r.createdAt).getTime() < cutoff) {
          await adapter.remove(r.id);
          removed++;
        }
      }
      return removed;
    }

    async function clear() {
      const records = await adapter.all();
      for (const r of records) await adapter.remove(r.id);
      return records.length;
    }

    return { enqueue, pending, counts, markSent, markFailed, flush, sentRecords, all, prune, clear };
  }

  /* --------------------------------------------------------- memory adapter */

  function memoryAdapter() {
    const map = new Map();
    return {
      async all() { return Array.from(map.values()).map((r) => JSON.parse(JSON.stringify(r))); },
      async put(record) { map.set(record.id, JSON.parse(JSON.stringify(record))); },
      async remove(id) { map.delete(id); }
    };
  }

  /* ------------------------------------------------------ IndexedDB adapter */

  function idbAdapter() {
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
          /* A FileSystemFileHandle is structured-cloneable but not serialisable,
             so it has to live in IndexedDB rather than localStorage. */
          if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
        };
        req.onsuccess = () => {
          const db = req.result;
          /* Another tab holding this database open would block the NEXT version
             bump forever. Yielding here means an upgrade can always proceed. */
          db.onversionchange = () => db.close();
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        /* Without this the promise never settles: an older connection elsewhere
           blocks the upgrade, open() fires neither success nor error, and every
           queue call hangs silently — the app looks alive but stores nothing.
           A rejection instead leaves the response pending and surfaces the
           reason. Retried on the next flush; closing the other tab clears it. */
        req.onblocked = () => {
          dbPromise = null;
          reject(new Error("Storage upgrade blocked — close other tabs running ASQ Survey."));
        };
      });
      /* A failed open must not be cached, or the app never recovers. */
      dbPromise = dbPromise.catch((e) => { dbPromise = null; throw e; });
      return dbPromise;
    }

    function tx(mode, fn) {
      return open().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }));
    }

    function handleTx(mode, fn) {
      return open().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(HANDLES, mode);
        const req = fn(t.objectStore(HANDLES));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }));
    }

    return {
      all() { return tx("readonly", (s) => s.getAll()).then((r) => r || []); },
      put(record) { return tx("readwrite", (s) => s.put(record)); },
      remove(id) { return tx("readwrite", (s) => s.delete(id)); },
      getHandle(key) { return handleTx("readonly", (s) => s.get(key)); },
      putHandle(key, value) { return handleTx("readwrite", (s) => s.put(value, key)); },
      removeHandle(key) { return handleTx("readwrite", (s) => s.delete(key)); }
    };
  }

  return {
    DEFAULT_SETTINGS, SETTINGS_KEY, KEEP_SENT_DAYS,
    loadSettings, saveSettings, makeQueue, memoryAdapter, idbAdapter
  };
});
