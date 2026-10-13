// Records a real screen recording of the app being used, then muxes the
// narration onto it.
//
// The previous build captured one still per feature and panned across them.
// That was a slideshow — it never showed anybody using the product. This
// drives the live app (typing, uploading, flying the map, opening the modal,
// removing a property) while streaming frames out of Chrome over the
// DevTools Protocol, so what you see is genuinely happening.
//
// Frames are piped straight into ffmpeg rather than written to disk: at
// 1920x1080 a four-minute recording is well over a gigabyte of JPEGs, and
// this machine has already had a process reaped for memory pressure.
//
// Chrome runs headful because the 3D map tiles are WebGL and need a real GPU.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { steps, DEMO } from "./walkthrough.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const work = join(here, ".rec");
mkdirSync(work, { recursive: true });

const APP = process.env.APP_URL || "http://localhost:5173";
const PORT = 9333;
const W = 1920;
const H = 1080;
const FPS = 30;
const RAW = join(work, "raw.mp4");
const OUT = process.env.OUT || join(root, "public", "demo.mp4");

const log = (s) => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!CHROME) throw new Error("Chrome not found");

const env = readFileSync(join(root, ".env.local"), "utf8");
const PASSWORD = (env.match(/^SALES_LOGIN_PASSWORD=(.*)$/m) || [])[1]?.trim();
if (!PASSWORD) throw new Error("SALES_LOGIN_PASSWORD missing from .env.local");

const sheetPath = resolve(root, DEMO.sheet);
if (!existsSync(sheetPath)) throw new Error(`demo sheet missing: ${sheetPath}`);

// ------------------------------------------------------------------ chrome
const profile = join(tmpdir(), "getinform-rec-profile");
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    "--window-position=0,0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-infobars",
    "--hide-crash-restore-bubble",
    "--disable-features=Translate,InfobarsShown",
    "--autoplay-policy=no-user-gesture-required",
    // Keeps the renderer at full speed even if the window loses focus
    // or gets covered while the recording runs.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const p = (await r.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let seq = 0;
const pending = new Map();
const handlers = new Map();

ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method) {
    (handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
  }
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
}
const on = (method, fn) => handlers.set(method, [...(handlers.get(method) || []), fn]);

async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(`page threw: ${exceptionDetails.text}`);
  return result.value;
}

// ------------------------------------------------------- injected overlays
// A recording with no visible pointer is unreadable — the viewer sees fields
// fill themselves and panels open for no reason. Chrome's screencast does not
// capture the OS cursor, so the page gets its own: a dot that glides to each
// target and pulses on click. The caption bar is injected for the same
// reason it is drawn here rather than overlaid in ffmpeg afterwards — it has
// to change exactly when the action does, and only the driver knows when
// that is.
const OVERLAY = `(() => {
  if (document.getElementById('__demo_layer')) return 'exists';
  const style = document.createElement('style');
  style.textContent = \`
    #__demo_cursor {
      position: fixed; left: 0; top: 0; z-index: 2147483647;
      width: 26px; height: 26px; margin: -13px 0 0 -13px; pointer-events: none;
      transition: transform 600ms cubic-bezier(.23,1,.32,1);
      will-change: transform;
    }
    #__demo_cursor .dot {
      position: absolute; inset: 7px; border-radius: 50%;
      background: rgba(67,56,202,.95);
      box-shadow: 0 0 0 3px rgba(255,255,255,.95), 0 3px 10px rgba(0,0,0,.4);
    }
    #__demo_cursor .ring {
      position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid rgba(67,56,202,.9); opacity: 0; transform: scale(.4);
    }
    #__demo_cursor.click .ring { animation: __demo_ping 520ms cubic-bezier(.23,1,.32,1); }
    @keyframes __demo_ping {
      0% { opacity: .9; transform: scale(.4); }
      100% { opacity: 0; transform: scale(2.3); }
    }
    #__demo_caption {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646;
      pointer-events: none; padding: 150px 0 64px 86px;
      background: linear-gradient(to top, rgba(7,7,12,.93) 0%, rgba(7,7,12,.72) 45%, rgba(7,7,12,0) 100%);
      opacity: 0; transition: opacity 320ms ease;
      font-family: 'Inter Variable', Inter, system-ui, sans-serif;
    }
    #__demo_caption.on { opacity: 1; }
    #__demo_caption .inner { display: flex; align-items: center; gap: 20px; }
    #__demo_caption .bar { width: 6px; height: 50px; border-radius: 999px; background: linear-gradient(180deg,#818cf8,#4338ca); }
    #__demo_caption .txt { font-size: 42px; font-weight: 600; letter-spacing: -.022em; color: #fff; text-shadow: 0 2px 16px rgba(0,0,0,.6); }
  \`;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.id = '__demo_layer';
  layer.innerHTML =
    '<div id="__demo_cursor"><div class="ring"></div><div class="dot"></div></div>' +
    '<div id="__demo_caption"><div class="inner"><div class="bar"></div><div class="txt"></div></div></div>';
  document.body.appendChild(layer);
  window.__demoMove = (x, y) => {
    document.getElementById('__demo_cursor').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  };
  window.__demoClick = () => {
    const c = document.getElementById('__demo_cursor');
    c.classList.remove('click'); void c.offsetWidth; c.classList.add('click');
  };
  window.__demoCaption = (t) => {
    const el = document.getElementById('__demo_caption');
    el.querySelector('.txt').textContent = t || '';
    el.classList.toggle('on', !!t);
  };
  window.__demoMove(${W / 2}, ${H / 2});
  return 'ok';
})()`;

let lastCaption = "";
async function injectOverlay() {
  await evaluate(OVERLAY);
  if (lastCaption) await evaluate(`window.__demoCaption(${JSON.stringify(lastCaption)})`);
}

// --------------------------------------------------------------- driver
const rectOf = (expr) => evaluate(`(() => {
  const el = ${expr};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);

const sel = (s) => `document.querySelector(${JSON.stringify(s)})`;
const nth = (s, i) => `document.querySelectorAll(${JSON.stringify(s)})[${i}]`;
const byText = (s, t) => `[...document.querySelectorAll(${JSON.stringify(s)})].find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(t.toLowerCase())}))`;

let cursor = { x: W / 2, y: H / 2 };

async function moveToExpr(expr, label) {
  const p = await rectOf(expr);
  if (!p) throw new Error(`cannot locate ${label}`);
  cursor = p;
  await evaluate(`window.__demoMove(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  // Matches the cursor's own CSS transition so the click lands after it
  // arrives, not while it is still gliding.
  await sleep(680);
  return p;
}

// The ripple is the visual; the activation is a DOM click.
//
// Dispatching synthetic mouse events at coordinates looked more "real" but
// silently missed on several sidebar items — which is what made the
// inventory, insights, clients and reports steps all time out in the first
// recording. A DOM click cannot miss, and on screen it is indistinguishable.
async function clickExpr(expr, label) {
  await evaluate(`window.__demoClick()`);
  const ok = await evaluate(`(() => {
    const el = ${expr};
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`cannot click ${label}`);
  await sleep(260);
}

async function typeInto(expr, text, delay) {
  await evaluate(`(() => { const el = ${expr}; el.focus(); })()`);
  for (const ch of text) {
    await send("Input.insertText", { text: ch });
    await sleep(delay);
  }
}

async function waitFor(expression, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(`!!(${expression})`)) return;
    } catch {
      /* mid-navigation */
    }
    await sleep(200);
  }
  throw new Error(`timed out: ${expression.slice(0, 70)}`);
}

const jpegBytes = async () => {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 30 });
  return Buffer.from(data, "base64").length;
};

// Tiles stream in long after the map element exists; watch the encoded frame
// size flatten rather than trusting a fixed sleep.
// Budget deliberately tight. Waiting for the tiles to fully settle looks
// better frame-by-frame but costs 20-50s per map across the reel, and
// length is the thing that actually loses viewers.
async function waitForMap(extra = 1000, maxWait = 11000) {
  const deadline = Date.now() + maxWait;
  let last = 0;
  let stable = 0;
  await sleep(2500);
  while (Date.now() < deadline) {
    const size = await jpegBytes();
    if (last && Math.abs(size - last) / Math.max(size, 1) < 0.02 && size > 120_000) {
      if (++stable >= 2) break;
    } else stable = 0;
    last = size;
    await sleep(900);
  }
  await sleep(extra);
}

async function dismissGoogleBanner() {
  await evaluate(`(() => {
    for (const el of document.querySelectorAll('a,button,span,div')) {
      if (el.textContent.trim() === 'Dismiss' && el.offsetParent !== null) { el.click(); return 'ok'; }
    }
    return 'none';
  })()`).catch(() => {});
}

let campaignId = null;

const ctx = {
  password: PASSWORD,
  demo: DEMO,
  sheetPath,
  sleep,
  waitFor,
  waitForMap: async (extra) => {
    await dismissGoogleBanner();
    await waitForMap(extra);
    await dismissGoogleBanner();
  },
  moveTo: (s) => moveToExpr(sel(s), s),
  moveToNth: (s, i) => moveToExpr(nth(s, i), `${s}[${i}]`),
  moveToText: (s, t) => moveToExpr(byText(s, t), `${s}:${t}`),
  click: (s) => clickExpr(sel(s), s),
  clickNth: (s, i) => clickExpr(nth(s, i), `${s}[${i}]`),
  clickText: (s, t) => clickExpr(byText(s, t), `${s}:${t}`),
  typeText: (s, text, d = 80) => typeInto(sel(s), text, d),
  typeNth: (s, i, text, d = 80) => typeInto(nth(s, i), text, d),
  pressEscape: async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  },
  // A <select> cannot be driven by clicking — the dropdown is OS-rendered and
  // never appears in the screencast. Setting the value and firing `change` is
  // what React actually listens for anyway.
  selectOption: async (s, index) => {
    await evaluate(`(() => {
      const el = ${sel(s)};
      el.selectedIndex = ${index};
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(400);
  },
  attachFile: async (s, file) => {
    const { root: docRoot } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: docRoot.nodeId, selector: s });
    if (!nodeId) throw new Error(`file input not found: ${s}`);
    await send("DOM.setFileInputFiles", { nodeId, files: [file] });
  },
  stopTour: async () => {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('.campaign-banner-tour')].find(e => e.textContent.toLowerCase().includes('stop'));
      if (b) b.click();
    })()`).catch(() => {});
    await sleep(600);
  },
  // After an upload the app jumps to the campaign automatically, but only
  // when nothing needed reporting; otherwise it stays put so the warnings can
  // be read. Handle both rather than assuming the happy path.
  ensureCampaignOpen: async () => {
    const onMap = await evaluate(`!!document.querySelector('.cpg-map-frame')`);
    if (!onMap) {
      await moveToExpr(byText(".upload-open-btn", "open in campaigns"), "open in campaigns");
      await clickExpr(byText(".upload-open-btn", "open in campaigns"), "open in campaigns");
    }
    await waitFor(`document.querySelector('.cpg-map-frame')`, 40000);
    const list = await evaluate(`fetch('/api/campaigns').then(r => r.json())`);
    campaignId = list?.[0]?.id ?? null;
  },
  openClientLink: async () => {
    if (!campaignId) throw new Error("no campaign id captured");
    await send("Page.navigate", { url: `${APP}/campaign/${campaignId}` });
    await sleep(2500);
    await injectOverlay();
    await waitFor(`document.querySelector('.campaign-banner')`, 40000);
  },
  backToApp: async () => {
    await send("Page.navigate", { url: APP });
    await sleep(2500);
    await injectOverlay();
    await waitFor(`document.querySelector('.dash-shell')`, 40000);
  },
};

// -------------------------------------------------------------- recording

const frameDir = join(work, "frames");
mkdirSync(frameDir, { recursive: true });
const frameTimes = [];
let frames = 0;

let recording = false;

const TARGET_FPS = 18;
const FRAME_MS = 1000 / TARGET_FPS;

// Pulls frames on our own clock instead of waiting to be handed them.
//
// Chrome's screencast only emits when it decides to, and throttles hard when
// the window is occluded or backgrounded: measured at 2.0 fps here even with
// --disable-backgrounding-occluded-windows and Page.bringToFront, and it
// delivered literally zero frames across two complete recordings. Polling
// Page.captureScreenshot measured 23.8 fps on this same machine and cannot
// silently return nothing.
//
// Runs concurrently with the walkthrough: CDP multiplexes by request id, so
// these captures interleave with the step commands without blocking them.
async function captureLoop() {
  let stalled = 0;
  while (recording) {
    const started = Date.now();
    try {
      // Raced against a timeout, because a capture issued at the wrong moment
      // can get no response at all rather than an error — the promise just
      // stays pending. That silently froze the loop eight seconds into a run:
      // the walkthrough carried on to the end while nothing was being
      // recorded, and the final `await capture` then hung forever too.
      const shot = await Promise.race([
        sendCap("Page.captureScreenshot", { format: "jpeg", quality: 72, captureBeyondViewport: false }),
        sleep(2500).then(() => null),
      ]);
      if (shot) {
        const at = (Date.now() - t0) / 1000;
        const name = String(frames++).padStart(6, "0") + ".jpg";
        writeFileSync(join(frameDir, name), Buffer.from(shot.data, "base64"));
        frameTimes.push({ name, at });
        stalled = 0;
      } else if (++stalled === 1 || stalled % 20 === 0) {
        log(`  (capture stalled — ${stalled} dropped frames)`);
      }
    } catch {
      // A capture issued mid-navigation just fails; skip that frame.
    }
    const elapsed = Date.now() - started;
    if (elapsed < FRAME_MS) await sleep(FRAME_MS - elapsed);
  }
}

// --- dedicated capture channel ---------------------------------------
const capWs = new WebSocket(await debuggerUrl());
await new Promise((res, rej) => {
  capWs.addEventListener("open", res, { once: true });
  capWs.addEventListener("error", rej, { once: true });
});
let capSeq = 0;
const capPending = new Map();
capWs.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && capPending.has(msg.id)) {
    const { resolve: res, reject } = capPending.get(msg.id);
    capPending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
  }
});
function sendCap(method, params = {}) {
  const id = ++capSeq;
  capWs.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => capPending.set(id, { resolve: res, reject: rej }));
}

const marks = [];
let t0 = 0;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  log("opening app…");
  await send("Page.navigate", { url: APP });
  await sleep(3000);

  // Sign in headlessly *for the warm-up only*. The Chrome profile is reused
  // between runs, so without taking explicit control of the session the
  // recording could open already-logged-in and the walkthrough's sign-in
  // step would have no login screen left to show.
  await evaluate(`fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ${JSON.stringify(PASSWORD)} })
  }).then(r => r.json())`);
  await send("Page.navigate", { url: APP });
  await sleep(3000);
  await injectOverlay();
  await waitFor(`document.querySelector('.dash-shell')`, 40000);

  // Warm-up before the camera rolls. Market Insights aggregates all 21 city
  // files and Clients resolves a logo per client; cold, those took ~60s each
  // and timed out on camera in the first recording. Visiting them first puts
  // the data in the module cache and the logos in the server's cache, so the
  // recorded pass is quick instead of being dead air.
  log("warming slow pages (insights / clients / reports / inventory)…");
  for (const [text, ready] of [
    ["market insights", ".insights-bar-row"],
    ["clients", ".clients-card"],
    ["reports", ".reports-table"],
    ["inventory", ".dm-canvas"],
  ]) {
    try {
      await evaluate(`(() => {
        const el = [...document.querySelectorAll('.dash-nav-item')]
          .find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(text)}));
        if (el) el.click();
      })()`);
      await waitFor(`document.querySelector('${ready}')`, 90000);
      await sleep(700);
    } catch (err) {
      log(`  (warm-up ${text}: ${err.message})`);
    }
  }
  // Back to the dashboard so the recording opens where a rep would.
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('.dash-nav-item')]
      .find(e => e.textContent.trim().toLowerCase().includes('dashboard'));
    if (el) el.click();
  })()`).catch(() => {});
  await sleep(1500);

  // Sign back out so the recording genuinely opens on the login screen,
  // which is where a rep actually starts.
  log("signing out so the recording starts where a rep starts…");
  await evaluate(`fetch('/api/logout', { method: 'POST' }).then(r => r.json())`).catch(() => {});
  await send("Page.navigate", { url: APP });
  await sleep(3000);
  await injectOverlay();
  await waitFor(`document.querySelector('.login-card')`, 30000);
  await sleep(800);

  log(`recording ${steps.length} steps…\n`);
  await send("Page.bringToFront").catch(() => {});
  t0 = Date.now();
  recording = true;
  const capture = captureLoop();

  for (const step of steps) {
    const at = (Date.now() - t0) / 1000;
    marks.push({ id: step.id, at });
    lastCaption = step.caption || "";
    await injectOverlay();
    await evaluate(`window.__demoCaption(${JSON.stringify(lastCaption)})`).catch(() => {});

    const narrWav = join(here, "narration", `${step.id}.wav`);
    const narrSecs = existsSync(narrWav) ? durationOf(narrWav) : 0;

    const started = Date.now();
    try {
      await step.run(ctx);
    } catch (err) {
      log(`  !! ${step.id}: ${err.message}`);
    }
    // A step never ends before its own line does.
    const elapsed = (Date.now() - started) / 1000;
    if (narrSecs + 0.6 > elapsed) await sleep((narrSecs + 0.6 - elapsed) * 1000);

    log(`  ${step.id.padEnd(16)} @${at.toFixed(1).padStart(6)}s  (${((Date.now() - started) / 1000).toFixed(1)}s, voice ${narrSecs.toFixed(1)}s)`);
  }

  await evaluate(`window.__demoCaption('')`).catch(() => {});
  await sleep(1200);
  recording = false;
  await capture;
  log(`
${frames} frames captured (${(frames / Math.max(frameTimes.at(-1)?.at ?? 1, 1)).toFixed(1)} fps avg)`);
} finally {
  try {
    await send("Browser.close");
  } catch {
    /* already gone */
  }
  ws.close();
  capWs.close();
  chrome.kill();
}

// ------------------------------------------------------------- assemble
// A concat list carrying each frame's real on-screen duration. ffmpeg then
// resamples to a constant 30fps, holding each static frame for exactly as
// long as it was actually static, so picture and step clock cannot drift.
if (frameTimes.length < 10) throw new Error(`only ${frameTimes.length} frames captured`);

const listLines = [];
frameTimes.forEach((f, i) => {
  const next = i + 1 < frameTimes.length ? frameTimes[i + 1].at : f.at + 0.5;
  listLines.push(`file '${f.name}'`, `duration ${Math.max(next - f.at, 0.001).toFixed(4)}`);
});
// concat ignores the last entry's duration unless the file is repeated.
listLines.push(`file '${frameTimes[frameTimes.length - 1].name}'`);
const listFile = join(frameDir, "frames.txt");
writeFileSync(listFile, listLines.join("\n"));

log(`assembling ${frameTimes.length} frames…`);
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", listFile,
  "-vf", `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#07070C,format=yuv420p`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
  RAW,
], { stdio: ["ignore", "inherit", "inherit"] });

if (!existsSync(RAW) || statSync(RAW).size < 10000) throw new Error("recording failed to encode");

writeFileSync(join(work, "marks.json"), JSON.stringify(marks, null, 2));
log(`raw recording: ${(statSync(RAW).size / 1024 / 1024).toFixed(1)} MB  ${durationOf(RAW).toFixed(1)}s`);
log(`marks -> ${join(work, "marks.json")}\n`);
log(`now run:  node video/mux.mjs`);

function durationOf(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}
