/* Mirrors www/ into docs/app/ so the kiosk also runs in a browser from GitHub
 * Pages.
 *
 * The web layer exists in THREE copies: www/ (the source), docs/app/ (Pages) and
 * the one baked into the APK. Skip this step and the page and the APK start
 * quietly disagreeing — which is why selftest.js fails when docs/app/ lags www/.
 *
 * node tools/sync-pages.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "www");
const dst = path.join(root, "docs", "app");

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  n++;
}
console.log("synced " + n + " files -> docs/app/");
