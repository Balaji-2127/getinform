// Screenshots every page at desktop and phone width, for a review pass.
//
// Not part of the video pipeline — this exists so the UI can be judged by
// looking at it rather than by reading the CSS and hoping. Phone width in
// particular had never been checked.
//
// Usage: node video/audit.mjs            (both widths, all pages)
//        WIDTHS=mobile node video/audit.mjs
//        ONLY=insights,reports node video/audit.mjs
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(here, "audit");
mkdirSync(outDir, { recursive: true });

const APP = process.env.APP_URL || "http://localhost:5173";
const PORT = 9666;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(s + "\n");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!CHROME) throw new Error("Chrome not found");

const env = readFileSync(join(root, ".env.local"), "utf8");
const PASSWORD = (env.match(/^SALES_LOGIN_PASSWORD=(.*)$/m) || [])[1]?.trim();
if (!PASSWORD) throw new Error("SALES_LOGIN_PASSWORD missing");

const ALL_WIDTHS = [
  { name: "desktop", width: 1920, height: 1080 },
  // A common small phone viewport — the narrowest thing a rep would
  // realistically open this on.
  { name: "mobile", width: 430, height: 932 },
];
const widthFilter = (process.env.WIDTHS || "").split(",").map((s) => s.trim()).filter(Boolean);
const WIDTHS = widthFilter.length ? ALL_WIDTHS.filter((w) => widthFilter.includes(w.name)) : ALL_WIDTHS;

const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), "getinform-audit")}`,
  "--window-size=1920,1080",
  "--window-position=0,0",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
  "about:blank",
], { stdio: "ignore" });

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const p = (await r.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error("DevTools endpoint never came up");
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: r, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : r(msg.result);
  }
});
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej })); };

async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function waitFor(expr, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await evaluate(`!!(${expr})`)) return true; } catch { /* navigating */ }
    await sleep(200);
  }
  return false;
}

// Matches on the title attribute too: below 640px the sidebar collapses and
// the nav buttons render icon-only, so there is no text content to match.
const clickNav = (text) => evaluate(`(() => {
  const want = ${JSON.stringify(text)};
  const el = [...document.querySelectorAll('.dash-nav-item')].find(e => {
    const label = (e.textContent.trim() || e.getAttribute('title') || e.getAttribute('aria-label') || '').toLowerCase();
    return label.includes(want);
  });
  if (!el) return false;
  el.click();
  return true;
})()`);

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
}

// Pages to walk. `ready` is what proves the page actually rendered; `after`
// is extra settle time for anything that loads a map.
const PAGES = [
  { id: "dashboard", nav: "dashboard", ready: ".dash-home-grid", after: 1200 },
  { id: "inventory", nav: "inventory", ready: ".dm-canvas", after: 7000 },
  { id: "clients", nav: "clients", ready: ".clients-card, .cpg-empty", after: 1500 },
  { id: "insights", nav: "market insights", ready: ".insights-bar-row, .insights-panel", after: 2500 },
  { id: "reports", nav: "reports", ready: ".reports-table, .cpg-empty", after: 1200 },
  { id: "help", nav: "help", ready: ".help-faq-item", after: 1500 },
  { id: "areas", nav: "my areas", ready: ".mya-card, .cpg-empty", after: 1500 },
  { id: "shortlists", nav: "shortlists", ready: ".slp-list, .cpg-empty", after: 1500 },
  { id: "recent", nav: "recent searches", ready: ".rsp-list, .cpg-empty", after: 1500 },
];

try {
  await send("Page.enable");
  await send("Runtime.enable");

  await send("Page.navigate", { url: APP });
  await sleep(2500);
  await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);

  for (const w of WIDTHS) {
    log(`\n--- ${w.name} ${w.width}x${w.height} ---`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: w.width, height: w.height, deviceScaleFactor: 1,
      mobile: w.name === "mobile",
    });
    await send("Page.navigate", { url: APP });
    await sleep(2500);
    if (!(await waitFor(`document.querySelector('.dash-shell')`, 40000))) {
      log("  !! dashboard shell never appeared");
      continue;
    }

    for (const page of PAGES) {
      if (ONLY.length && !ONLY.includes(page.id)) continue;
      try {
        if (!(await clickNav(page.nav))) throw new Error("nav item not found");
        const ok = await waitFor(`document.querySelector('${page.ready}')`, 60000);
        await sleep(page.after);
        await shot(`${w.name}-${page.id}`);
        // Horizontal overflow is the classic small-screen failure and is
        // invisible in a screenshot that happens to crop it, so measure it.
        const overflow = await evaluate(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        log(`  ${page.id.padEnd(11)} ${ok ? "ok " : "?? "} ${overflow > 0 ? `OVERFLOWS by ${overflow}px` : ""}`);
      } catch (err) {
        log(`  ${page.id.padEnd(11)} !! ${err.message}`);
      }
    }
  }
  log("\naudit complete -> video/audit/");
} finally {
  try { await send("Browser.close"); } catch { /* gone */ }
  ws.close();
  chrome.kill();
}
