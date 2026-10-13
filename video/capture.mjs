// Captures every still the video needs by driving a real Chrome over the
// DevTools Protocol. Node 24 ships a WebSocket client, so this needs no
// dependencies at all — no Playwright, no Puppeteer, no browser download.
//
// Chrome runs *headful* on purpose. The centrepiece of this product is
// Google's 3D Maps tiles, which are WebGL and need a real GPU; headless
// falls back to software rendering and the buildings either come out flat
// or never load. A Chrome window will appear on screen while this runs.
//
// Clicks are issued as scripted DOM clicks found by visible text rather than
// as mouse events at coordinates: text survives a layout change, coordinates
// silently start clicking the wrong thing.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const shotDir = join(here, "shots");
mkdirSync(shotDir, { recursive: true });

const APP = process.env.APP_URL || "http://localhost:5173";
const PORT = 9222;
const W = 1920;
const H = 1080;

const log = (s) => process.stdout.write(s + "\n");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!CHROME) throw new Error("Chrome not found");

// Read the shared login password straight out of .env.local. Never logged.
const env = readFileSync(join(root, ".env.local"), "utf8");
const PASSWORD = (env.match(/^SALES_LOGIN_PASSWORD=(.*)$/m) || [])[1]?.trim();
if (!PASSWORD) throw new Error("SALES_LOGIN_PASSWORD missing from .env.local");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- launch
const profile = join(tmpdir(), "getinform-video-profile");
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
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
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
const events = new Map();

ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method && events.has(msg.method)) {
    events.get(msg.method).forEach((fn) => fn(msg.params));
    events.delete(msg.method);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method, timeout = 30000) {
  return Promise.race([
    new Promise((resolve) => {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(resolve);
    }),
    sleep(timeout),
  ]);
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(`page threw: ${exceptionDetails.text}`);
  return result.value;
}

// ---------------------------------------------------------------- helpers
const clickByText = (selector, text) => evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'OK';
})()`);

async function click(selector, text, label) {
  const r = await clickByText(selector, text);
  if (r !== "OK") throw new Error(`could not click ${label ?? text} (${selector})`);
}

async function waitFor(expression, { timeout = 25000, label = expression } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Google's "alpha channel ... for development purposes only" ribbon sits
// across the top of every map. Harmless in the app, but in a video meant to
// sell the product it is the first thing a viewer reads. It's dismissible,
// so dismiss it — the app already reclaims the space via its own
// MutationObserver (see useGoogleBannerOffset).
async function dismissGoogleBanner() {
  await evaluate(`(() => {
    for (const el of document.querySelectorAll('a,button,span,div')) {
      if (el.textContent.trim() === 'Dismiss' && el.offsetParent !== null) { el.click(); return 'OK'; }
    }
    return 'none';
  })()`);
  await sleep(500);
}

const jpegBytes = async () => {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 35 });
  return Buffer.from(data, "base64").length;
};

// Waits until the rendered frame stops changing.
//
// The first version of this waited for the <gmp-map-3d> element and then
// slept a fixed guess. That element exists the instant React mounts it, long
// before a single map tile has arrived, so two shots came out as a black
// rectangle with a spinner. This instead watches the actual output: encode
// the frame as a cheap JPEG and watch its size, which climbs steeply while
// tiles stream in and then flattens. Two consecutive stable readings, plus a
// floor the frame has to clear so an empty page can't qualify as "stable".
async function waitForStableFrame({ minWait = 3500, maxWait = 60000, floor = 0, label = "frame" } = {}) {
  await sleep(minWait);
  const deadline = Date.now() + maxWait;
  let last = 0;
  let stable = 0;
  while (Date.now() < deadline) {
    const size = await jpegBytes();
    const settled = last > 0 && Math.abs(size - last) / Math.max(size, 1) < 0.015;
    if (settled && size >= floor) {
      if (++stable >= 2) return size;
    } else {
      stable = 0;
    }
    last = size;
    await sleep(1200);
  }
  log(`      (${label}: never fully settled — capturing as-is)`);
  return last;
}

async function shot(name, { settle = 800 } = {}) {
  // Dismissed here rather than once after navigation: Google injects the
  // ribbon asynchronously once the Maps script loads, so an early call can
  // run before it exists, and a full page load brings it back. Doing it
  // immediately before the capture is the only point that always works.
  await dismissGoogleBanner();
  await sleep(settle);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const buf = Buffer.from(data, "base64");
  writeFileSync(join(shotDir, `${name}.png`), buf);
  log(`  ok  ${name}.png  (${(buf.length / 1024).toFixed(0)} KB)`);
}

// A map scene is only ready once the tiles have actually painted. The floor
// is set well above what a blank page encodes to at this JPEG quality.
const MAP_FLOOR = 150_000;

const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

async function scene(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.includes(o))) return;
  try {
    log(`${name}…`);
    await fn();
  } catch (err) {
    // One stubborn screen shouldn't cost the whole run — the render step
    // reports anything missing and the rest of the video still builds.
    log(`  !!  ${name} failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------- run
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // --- sign in -----------------------------------------------------------
  // Posting to the session endpoint rather than typing into the form: the
  // form is a controlled React input, so a scripted value assignment needs
  // the native setter plus a synthetic event to register at all. The session
  // cookie is the only thing actually needed.
  log("signing in…");
  await send("Page.navigate", { url: APP });
  await once("Page.loadEventFired");
  await evaluate(`fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ${JSON.stringify(PASSWORD)} })
  }).then(r => r.json())`);

  await send("Page.navigate", { url: APP });
  await once("Page.loadEventFired");
  await waitFor(`document.querySelector('.dash-shell')`, { label: "dashboard shell" });
  await waitFor(`document.querySelector('.stat-card-value')`, { label: "dashboard stats", timeout: 40000 });
  await sleep(1000);

  const campaigns = await evaluate(`fetch('/api/campaigns').then(r => r.json())`);
  if (!campaigns?.length) throw new Error("no campaigns exist to feature in the video");
  const featured = campaigns[0];
  if (ONLY.length) log(`(only: ${ONLY.join(", ")})`);
  log(`featuring: ${featured.clientName} — ${featured.campaignName}\n`);

  await scene("upload", async () => {
    await click(".dash-upload-btn", "upload campaign sheet", "upload button");
    await waitFor(`document.querySelector('.upload-form')`, { label: "upload form" });
    await evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const inputs = [...document.querySelectorAll('.upload-form input')].filter(i => i.type !== 'file');
      ['Licious', 'Bengaluru launch'].forEach((v, i) => {
        if (!inputs[i]) return;
        set.call(inputs[i], v);
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      });
    })()`);
    await shot("upload");
  });

  await scene("campaign-map", async () => {
    await click(".dash-nav-item", "dashboard", "dashboard nav");
    await waitFor(`document.querySelector('.dash-home-campaign-list button')`, { label: "recent campaigns" });
    await click(".dash-home-campaign-list button", "open", "open campaign");
    await waitFor(`document.querySelector('.cpg-map-frame')`, { label: "campaign map frame" });
    await dismissGoogleBanner();
    await waitForStableFrame({ minWait: 6000, floor: MAP_FLOOR, label: "campaign map" });
    await shot("campaign-map");
  });

  await scene("campaign-tour", async () => {
    const r = await clickByText(".campaign-banner-tour", "tour the shortlist");
    if (r !== "OK") throw new Error("tour button not present");
    // Let it fly to a property and settle, so the frame shows a property
    // filled in rather than a mid-flight blur.
    await sleep(7000);
    await waitForStableFrame({ minWait: 1500, maxWait: 20000, floor: MAP_FLOOR, label: "tour" });
    await shot("campaign-tour", { settle: 300 });
  });

  await scene("client-link", async () => {
    await send("Page.navigate", { url: `${APP}/campaign/${featured.id}` });
    await once("Page.loadEventFired");
    await waitFor(`document.querySelector('.campaign-banner')`, { label: "client campaign banner", timeout: 40000 });
    await dismissGoogleBanner();
    await waitForStableFrame({ minWait: 8000, floor: MAP_FLOOR, label: "client map" });
    await shot("client-link");
  });

  await scene("inventory", async () => {
    await send("Page.navigate", { url: APP });
    await once("Page.loadEventFired");
    await waitFor(`document.querySelector('.dash-shell')`, { label: "dashboard shell" });
    await click(".dash-nav-item", "inventory", "inventory nav");
    await waitFor(`document.querySelector('.dm-canvas')`, { label: "inventory map" });
    await dismissGoogleBanner();
    await waitForStableFrame({ minWait: 8000, floor: MAP_FLOOR, label: "inventory map" });
    await shot("inventory");
  });

  // Selecting a property through the real search path, because clicking a
  // 3D marker means hitting a WebGL-painted pin at a camera-dependent pixel.
  await scene("search + property-detail", async () => {
    await evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const el = document.querySelector('.gs-bar input');
      el.focus();
      set.call(el, '7 Hills');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('.gs-result')`, { label: "search results", timeout: 20000 });
    await shot("search", { settle: 500 });

    await evaluate(`(() => {
      const groups = [...document.querySelectorAll('.gs-group')];
      const g = groups.find(x => x.textContent.toLowerCase().includes('propert')) || groups[groups.length - 1];
      g.querySelector('.gs-result').click();
    })()`);
    await waitFor(`document.querySelector('.pdp-panel:not(.pdp-empty)')`, { label: "property panel", timeout: 40000 });
    await waitForStableFrame({ minWait: 6000, floor: MAP_FLOOR, label: "property map" });
    await shot("property-detail");
  });

  for (const [navText, ready, name] of [
    ["market insights", ".insights-bar-row", "insights"],
    ["clients", ".clients-card", "clients"],
    ["reports", ".reports-table", "reports"],
  ]) {
    await scene(name, async () => {
      await click(".dash-nav-item", navText, `${name} nav`);
      await waitFor(`document.querySelector('${ready}')`, { label: name, timeout: 45000 });
      // These are plain data pages — no tiles, so a short settle is enough.
      await waitForStableFrame({ minWait: 1500, maxWait: 12000, label: name });
      await shot(name);
    });
  }

  // Not used in the video — this is a verification shot of the page the
  // video is embedded in, so a broken player or a mis-sized frame shows up
  // here rather than only when someone opens the app.
  await scene("help", async () => {
    await click(".dash-nav-item", "help", "help nav");
    await waitFor(`document.querySelector('.help-video')`, { label: "help video player" });
    // Don't gate on readyState: the player uses preload="metadata" and the
    // file is ~26 MB, so the first byte can take a while. The poster frame is
    // what this shot is checking anyway.
    await sleep(3000);
    await shot("help-page");
  });

  // ---- stills for the in-app FAQ ---------------------------------------
  // The Help page answers each question with a screenshot beside the text.
  // These are captured from the same live app as everything else, then
  // cropped and downscaled into public/faq/ by faq-images.mjs.
  await scene("faq-upload", async () => {
    await send("Page.navigate", { url: APP });
    await once("Page.loadEventFired");
    await waitFor(`document.querySelector('.dash-shell')`, { label: "shell" });
    await click(".dash-upload-btn", "upload campaign sheet", "upload button");
    await waitFor(`document.querySelector('.upload-form')`, { label: "upload form" });
    await evaluate(`(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const inputs = [...document.querySelectorAll('.upload-form input')].filter(i => i.type !== 'file');
      ['Acme Retail', 'Festive Launch'].forEach((v, i) => {
        if (!inputs[i]) return;
        set.call(inputs[i], v);
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      });
    })()`);
    await shot("faq-upload");
  });

  // The multi-city demo campaign: one shot that also supplies the crops for
  // the pins, the city switcher and the export buttons.
  await scene("faq-campaign", async () => {
    await click(".dash-nav-item", "dashboard", "dashboard nav");
    await waitFor(`document.querySelector('.dash-home-campaign-list button')`, { label: "recent campaigns" });
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('.dash-home-campaign-list li')]
        .find(li => li.textContent.includes('Acme Retail'));
      (row || document.querySelector('.dash-home-campaign-list li')).querySelector('button').click();
    })()`);
    await waitFor(`document.querySelector('.cpg-map-frame')`, { label: "campaign map" });
    await waitForStableFrame({ minWait: 6000, floor: MAP_FLOOR, label: "campaign map" });
    await shot("faq-campaign");
  });

  await scene("faq-tour", async () => {
    const r = await clickByText(".campaign-banner-tour", "tour the shortlist");
    if (r !== "OK") throw new Error("tour button missing");
    await sleep(7000);
    await waitForStableFrame({ minWait: 1500, maxWait: 18000, floor: MAP_FLOOR, label: "tour" });
    await shot("faq-tour", { settle: 300 });
  });

  await scene("faq-edit", async () => {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('.campaign-banner-tour')].find(e => e.textContent.toLowerCase().includes('stop'));
      if (b) b.click();
    })()`);
    await sleep(600);
    await click(".cpg-copy-link-btn", "edit shortlist", "edit shortlist");
    await waitFor(`document.querySelector('.esm-card')`, { label: "edit modal" });
    await sleep(1500);
    await shot("faq-edit");
    await evaluate(`document.querySelector('.esm-cancel-btn')?.click()`);
    await sleep(600);
  });

  await scene("faq-areas", async () => {
    await click(".dash-nav-item", "my areas", "my areas nav");
    await waitFor(`document.querySelector('.mya-card') || document.querySelector('.cpg-empty')`, { label: "my areas", timeout: 40000 });
    await sleep(1500);
    await shot("faq-areas");
  });


  // Verification shot: an FAQ answer expanded, so a broken image path or a
  // mis-sized figure shows up here rather than only when someone opens it.
  await scene("faq-open", async () => {
    await send("Page.navigate", { url: APP });
    await once("Page.loadEventFired");
    await waitFor(`document.querySelector('.dash-shell')`, { label: "shell" });
    await click(".dash-nav-item", "help", "help nav");
    await waitFor(`document.querySelector('.help-faq-item')`, { label: "faq" });
    // Open the pins question — its image is a crop, so it exercises the
    // tightest layout case.
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('.help-faq-q')]
        .find(b => b.textContent.toLowerCase().includes('blue and green'));
      item.click();
      item.scrollIntoView({ block: 'center' });
    })()`);
    await waitFor(`document.querySelector('.help-faq-fig img')?.complete`, { label: "faq image loaded", timeout: 20000 });
    await sleep(900);
    await shot("faq-open");
  });


  log("\ncapture complete.");
} finally {
  try {
    await send("Browser.close");
  } catch {
    /* already gone */
  }
  ws.close();
  chrome.kill();
}
