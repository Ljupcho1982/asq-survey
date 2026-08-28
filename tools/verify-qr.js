/* Decodes docs/qr.png and fails if it does not carry the expected URL. A QR
 * nobody can read back is worse than no QR at all: it looks right and goes
 * nowhere. Run: node tools/verify-qr.js [url]
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

const expected = process.argv[2] || "https://ljupcho1982.github.io/asq-survey/";
const file = path.join(__dirname, "..", "docs", "qr.png");

const png = PNG.sync.read(fs.readFileSync(file));
const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

if (!code) { console.error("FAIL: nothing decodes from docs/qr.png"); process.exit(1); }
if (code.data !== expected) {
  console.error('FAIL: QR carries "' + code.data + '", expected "' + expected + '"');
  process.exit(1);
}
console.log("ok: QR decodes to " + code.data);
