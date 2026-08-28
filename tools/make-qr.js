/* The QR on the download page. Only needs regenerating if the Pages URL itself
 * changes — the Releases asset name is stable, so a new version does not need a
 * new code. Run: node tools/make-qr.js [url]
 */
const path = require("path");
const QRCode = require("qrcode");

const url = process.argv[2] || "https://ljupcho1982.github.io/asq-survey/";
const out = path.join(__dirname, "..", "docs", "qr.png");

QRCode.toFile(out, url, {
  width: 528,          // 4x the 132px it renders at, so it stays sharp on retina
  margin: 2,
  color: { dark: "#0d1b2aff", light: "#ffffffff" },
  errorCorrectionLevel: "M"
}).then(() => {
  console.log("wrote docs/qr.png -> " + url);
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
