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

## First run

1. Open the app, tap the **logo five times** (within a second of each other), enter the PIN — the
   default is `1982`, change it in the same screen.
2. Put your address in **Recipient**, set **Airport** / **Terminal** / **Gate**, and Save.
3. Complete one survey. FormSubmit emails you a confirmation link — click it. Until you do,
   submissions stay queued rather than being lost; the app treats an unconfirmed address as a
   failure on purpose, because FormSubmit answers HTTP 200 with `success:"false"` in that state.
4. FormSubmit replies with a **random alias**. Paste that into Recipient in place of your address,
   so the plain address is no longer stored on a device sitting in a departure hall.

The recipient is deliberately **not** in any source file. It is typed in on the device.

## What arrives in your inbox

One email per response, carrying the same data three ways:

| Part | For |
|---|---|
| A `Question → Answer` table | Reading it as an email, no tooling needed |
| `payload_json` | The full nested response, for parsing |
| `csv_header` + `csv_row` | Pasting straight into Excel |

Ratings read as `4 — Very good` in the table and as a bare `4` in the CSV. Columns come from a fixed
question order, so a skipped question leaves an empty cell instead of shifting every column after it.

The subject line is `ASQ SKP — <response id> — <date>`.

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
www/submit.js          payload, flatten, CSV, the FormSubmit POST
www/app.js             the kiosk: screens, validation, idle reset, wake lock, settings
tools/selftest.js      106 checks, no network
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
