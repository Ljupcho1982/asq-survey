# ASQ Survey

**Not affiliated with, endorsed by, or connected to Airports Council International.** ASQ and Airport
Service Quality are ACI's programme names. This is an independent tool that asks passengers about
their airport experience; it is not ACI's survey, it produces no ACI benchmark or ranking, and it
contains none of ACI's data.

---

A gate kiosk that asks departing passengers an Airport Service Quality style departures
questionnaire and emails every completed response out as structured data.

ACI's annual report tells you where the airport stood *last year*. This collects the same
instrument continuously, so the numbers between reports are directly comparable to the deck.

- Offline-first PWA, wrapped with Capacitor into an Android APK for tablets
- 31 service-quality items + 2 overall items + 5 emotions + crowd perception + 13 profiling
  questions + 2 open-ended, in English
- No backend, no API keys, no account: submissions go out through **FormSubmit.co**
- Every response is written to IndexedDB *before* any network call, so a Wi-Fi drop costs nothing

---

## Where responses go

Set this in Settings — tap the **logo five times** (quickly), PIN `1982` by default.

| Mode | What happens |
|---|---|
| **CSV file** *(default)* | Each response is appended as a row to a CSV file on the device |
| **Email** | Each response is emailed through FormSubmit |
| **Both** | Both, and a response only counts as delivered once each has taken it |

A response is written to IndexedDB **before** any of this is attempted, so nothing is ever lost if a
write or a send fails — it stays `pending` and is retried. The header badge shows the backlog.

### CSV file

Where the file lands depends on the platform, and Settings tells you which case you're in:

| Platform | Behaviour |
|---|---|
| **Android APK** | Appends to `Documents/ASQ/asq-responses.csv`. Automatic — nothing to set up. Pull it off over USB or with any file manager. |
| **Desktop Chrome / Edge** | Click **Choose the CSV file…** once and pick where it goes. Every later response appends to that same file, no further prompting. |
| **Firefox / Safari / iOS** | No append API exists, so each response re-downloads the whole CSV to your Downloads folder. Workable, but use Chrome or Edge if you can. |

The file opens straight in Excel: it starts with a UTF-8 BOM so `č`, `š` and `é` render correctly,
the header is written once, and columns come from a fixed question order — a skipped question leaves
an empty cell rather than shifting every column after it. Ratings are stored raw (`4`, or `na`).

On desktop the browser forgets file permission when it restarts, so Settings will say *needs
reconnecting* — one click restores it, and queued responses flush immediately.

### Email

1. Put your address in **Recipient** and Save.
2. Complete one survey. FormSubmit emails you a confirmation link — click it. Until you do,
   submissions stay queued rather than being lost; the app treats an unconfirmed address as a
   failure on purpose, because FormSubmit answers HTTP 200 with `success:"false"` in that state.
3. FormSubmit replies with a **random alias**. Paste that into Recipient in place of your address,
   so the plain address is no longer stored on a device sitting in a departure hall.

The recipient is deliberately **not** in any source file. It is typed in on the device.

Each email carries the same response three ways: a `Question → Answer` table (readable as-is, with
ratings as `4 — Very good`), `payload_json` for parsing, and `csv_header` + `csv_row` for pasting
into a spreadsheet. The subject is `ASQ SKP — <response id> — <date>`.

**Export CSV** in Settings writes everything currently stored to a file at any time, whatever the
delivery mode.

## Reading the results — the report tool

<https://ljupcho1982.github.io/asq-survey/report/> (source in `docs/report/`)

Drop in the CSV exports from every tablet. They are merged, duplicates dropped by `responseId`,
and the report is built **in your browser** — the files are never uploaded, which matters when the
free-text came from members of the public. It prints cleanly to PDF, and exports the aggregates as
a separate CSV for anyone who wants to check the arithmetic without receiving passenger comments.

It follows ACI's method so the numbers are comparable: means on the 1–5 scale, **N/A excluded rather
than counted as a low score**, and category averages weighted by each item's respondent count.

| Section | What it shows |
|---|---|
| Headline | Overall satisfaction and experience, % rating 4–5, score distribution |
| **What to fix first** | Items scored below your own average **and** named among a passenger's 3 most important |
| By category | The 8 ACI categories, weighted |
| Matters most | Q11 importance, beside your score on each item |
| All items | Every service item ranked, with n and N/A counts |
| By passenger type | Overall split by reason for travel, flight status, group, age |
| Emotions | The five emotions, plus crowd perception |
| Movement | Month-on-month, with the items that rose and fell most |
| Who answered | Full passenger profile and travel behaviour |
| Comments | Both open-ended questions, verbatim |

The **what to fix first** view is the part ACI's deck does not give you. An item can score badly and
still not be worth acting on — if passengers never named it important, fixing it changes nothing
they care about.

Every figure carries its base (`n`), and a report built on fewer than 30 responses says so.

## Kiosk behaviour

- **Idle reset** — 90 seconds of no interaction mid-survey discards the partial response and returns
  to the welcome screen, so one passenger's answers can never leak into the next one's. Configurable,
  with a 20-second floor.
- **Settings is gated** — five fast taps on the logo, then a PIN. A passenger cannot reach the
  recipient address by fumbling.
- **Wake lock** — the screen is held on and the lock is re-acquired whenever the app comes back to
  the foreground.
- **Offline queue** — the badge in the header shows how many responses are waiting. They flush
  automatically when the network returns, on a 60-second timer, and on demand from Settings. Sent
  responses are kept 30 days to back the CSV export, then pruned.
- **Locking the tablet down** — use Android's own screen pinning (Settings → Security → App
  pinning, then pin ASQ Survey from the recents view). No plugin involved.

## Commands

```bash
npm test
```

```bash
npm run serve
```

```bash
npm run apk
```

`serve` runs at <http://localhost:4211>. `apk` produces `ASQ-debug.apk`; it runs the selftest first
and refuses to build on a broken instrument.

### Shipping a new version

1. Bump `version` in `package.json` — `build-apk.ps1` stamps it into the service-worker cache name,
   which is what stops tablets pinning themselves to the previous build.
2. `npm run pages` — mirrors `www/` into `docs/app/`. The selftest fails if you skip this, because
   the browser version and the APK would then quietly disagree.
3. `npm test`, then `npm run apk`.
4. Commit and push; GitHub Pages serves from `docs/` on `main`.
5. `gh release create vX.Y.Z ASQ-debug.apk` — the download button on the page points at
   `releases/latest/download/ASQ-debug.apk`, so the link never needs editing.

`npm run qr` only needs rerunning if the Pages URL itself changes; it regenerates `docs/qr.png` and
then decodes it back to prove the code actually resolves.

## Layout

```
www/questionnaire.js   the instrument as data — 31 items, scales, profiling questions, the flow
www/store.js           settings + the IndexedDB submission queue
www/submit.js          payload, flatten, CSV, the FormSubmit POST, delivery routing
www/csv-sink.js        appending to a file: Capacitor / File System Access / download
www/app.js             the kiosk: screens, validation, idle reset, wake lock, settings
tools/selftest.js      126 checks, no network
android-res/           vector launcher icons (this machine has no SVG rasterizer)
```

`questionnaire.js` is the centre of gravity. Everything else derives from it — the screens, the email
fields, the CSV header and the tests — so correcting a wording is a one-line edit.

## Where the questions came from

Reconstructed from `ENG ASQ Annual report for MOT 2025.pdf`. Each of the 57 per-item ranking slides
carries ACI's verbatim Q10 text in its footer, and the slide-73 scorecard fixes the category
structure: 3 / 3 / 3 / 2 / 5 / 2 / 10 / 3 = 31 items. The profiling wording comes from the footers on
slides 68, 69 and 72. The selftest asserts those counts, so a future edit cannot quietly drift away
from ACI's structure.

**Two gaps, both flagged in the code:**

- **The 5 emotions.** Slide 4 says the questionnaire carries "5 emotions on a scale from 1 (not at
  all) to 5 (extremely)" but never names them, and ACI does not publish the instrument. The app ships
  Happy / Relaxed / Confident / Stressed / Frustrated as a placeholder in the `EMOTIONS` array in
  `questionnaire.js`. Replace those five labels when you have ACI's real wording — nothing else needs
  to change.
- **Q4, Q5, Q6, Q14, Q17, Q18** are never quoted anywhere in the deck, so the app does not ask them.
  The 13 profiling questions it does ask are the ones the report quotes verbatim.

One item, *Ease of making your connection with other flights*, is asked only of passengers who answer
Yes to Q2. The 2025 report shows it as N/A at SKP for exactly that reason — almost nobody connects
there.

## Data protection

The survey collects free text and demographics from members of the public. It records no name, seat
or booking reference, and the welcome screen says so. Responses live in the tablet's IndexedDB until
they are emailed, and for 30 days after. **Clear queue** in Settings deletes them immediately. Decide
who the recipient mailbox belongs to, and how long responses are retained there, before any tablet
goes airside.
