// Renders the overlay graphics mux.mjs composites onto the recording:
// the cursor, the click rings, the step labels, and the intro/outro cards.
//
// They're HTML screenshotted by headless Chrome (no WebGL involved, so
// headless is fine here) rather than drawn by ffmpeg, so they use the app's
// real Inter font and token colours and look like part of the product.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { steps } from "./walkthrough.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(here, "graphics");
const tmp = join(here, ".tmp-graphics");
mkdirSync(outDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!CHROME) throw new Error("Chrome not found");

const fontDir = join(root, "node_modules/@fontsource-variable/inter/files").replace(/\\/g, "/");
const logo = join(root, "public/adonmo-logo.jpeg").replace(/\\/g, "/");
const FONT = `@font-face { font-family: 'Inter'; font-weight: 100 900; font-display: block;
  src: url('file:///${fontDir}/inter-latin-wght-normal.woff2') format('woff2-variations'); }`;

function render(name, w, h, body, css, { transparent = true } = {}) {
  const html = join(tmp, `${name}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${FONT}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: transparent;
  font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
${css}</style><body>${body}</body>`);
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${w},${h}`,
    `--default-background-color=${transparent ? "00000000" : "FF07070C"}`,
    "--virtual-time-budget=3000",
    `--screenshot=${join(outDir, `${name}.png`)}`,
    `file:///${html.replace(/\\/g, "/")}`,
  ], { stdio: "ignore" });
  console.log(`  ${name}.png  ${w}x${h}`);
}

// ---- cursor ---------------------------------------------------------------
// An ordinary arrow pointer. The previous recording used a blue dot, which
// is the first thing that makes a screen recording look staged: nobody's
// computer has a dot. The tip sits exactly at (6,6) — mux.mjs offsets by that
// so the point of the arrow, not the image corner, lands on the target.
render("cursor", 44, 52,
  `<svg width="44" height="52" viewBox="0 0 44 52" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#000" flood-opacity="0.35"/></filter></defs>
    <path filter="url(#s)" d="M6 6 L6 36.5 L13.4 29.6 L18.2 40.4 L23.1 38.2 L18.4 27.6 L28.6 27.6 Z"
      fill="#111827" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
  </svg>`, "");

// ---- click rings ----------------------------------------------------------
// Two sizes shown one after the other read as a single expanding ripple.
for (const [name, size, alpha] of [["ring-s", 34, 0.55], ["ring-l", 58, 0.3]]) {
  render(name, 64, 64,
    `<div style="position:absolute;left:${32 - size / 2}px;top:${32 - size / 2}px;width:${size}px;height:${size}px;
      border-radius:50%;border:3px solid rgba(67,56,202,${alpha});background:rgba(99,102,241,${alpha * 0.35})"></div>`, "");
}

// ---- step labels ----------------------------------------------------------
// Small and quiet: a reminder of where you are, not a headline. The old
// full-width caption bars read as a template; this sits in a corner.
const labels = [...new Set(steps.map((s) => s.label).filter(Boolean))];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
for (const label of labels) {
  render(`label-${slug(label)}`, 760, 80,
    `<div class="chip"><span class="dot"></span>${label}</div>`,
    `.chip { position:absolute; left:8px; top:12px; display:inline-flex; align-items:center; gap:12px;
       padding:13px 22px 13px 18px; border-radius:999px; background:rgba(17,24,39,0.82);
       color:#fff; font-size:22px; font-weight:600; letter-spacing:-0.01em;
       box-shadow:0 6px 20px rgba(0,0,0,0.25); white-space:nowrap; }
     .dot { width:10px; height:10px; border-radius:50%; background:#818cf8; box-shadow:0 0 0 4px rgba(129,140,248,0.25); }`);
}

// ---- intro / outro --------------------------------------------------------
const CARD_CSS = `
body { background: radial-gradient(120% 90% at 50% 0%, #1e1b4b 0%, rgba(30,27,75,0) 60%), #07070c;
  color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
.logo { width:88px; height:88px; border-radius:22px; object-fit:cover; margin-bottom:40px; box-shadow:0 16px 48px rgba(0,0,0,.6); }
h1 { font-size:92px; font-weight:700; letter-spacing:-0.035em; line-height:1.04; }
h2 { font-size:64px; font-weight:700; letter-spacing:-0.03em; line-height:1.1; max-width:1400px; }
p { margin-top:24px; font-size:30px; font-weight:400; color:#a5b4fc; letter-spacing:-0.01em; }
.rule { margin-top:40px; width:72px; height:4px; border-radius:999px; background:linear-gradient(90deg,#6366f1,#a5b4fc); }`;
render("intro", 1920, 1080,
  `<img class="logo" src="file:///${logo}"><h1>Adonmo</h1><p>Product walkthrough</p><div class="rule"></div>`, CARD_CSS, { transparent: false });
render("outro", 1920, 1080,
  `<img class="logo" src="file:///${logo}"><h2>You're ready to build your first campaign.</h2>
   <p>Watch again any time under Help &amp; FAQs</p><div class="rule"></div>`, CARD_CSS, { transparent: false });

rmSync(tmp, { recursive: true, force: true });
writeFileSync(join(outDir, "labels.json"), JSON.stringify(Object.fromEntries(labels.map((l) => [l, `label-${slug(l)}.png`])), null, 2));
console.log(`\n${labels.length} labels + cursor, rings, intro, outro -> ${outDir}`);
