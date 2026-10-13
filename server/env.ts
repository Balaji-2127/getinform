import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must be the very first thing this server imports — ES module static
// imports always fully evaluate before the importing module's own
// top-level code runs, so if index.ts loaded .env.local itself (after its
// router imports), every router's dependencies (db.ts included) would
// already have tried to read process.env variables that didn't exist
// yet. This was silently fine while db.ts fell back to a default path
// when DATA_DIR was unset; it stopped being fine once db.ts needed
// FIREBASE_SERVICE_ACCOUNT_JSON with no fallback at all.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENV_FILE = path.join(__dirname, "..", ".env.local");

loadEnv({ path: ENV_FILE });

let lastMtimeMs = mtimeOf(ENV_FILE);

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Re-reads .env.local when it has changed on disk. Development only.
 *
 * The dev API runs under `tsx watch`, which restarts on changes to imported
 * source files — but not on this one, because nothing imports it. The
 * `--include .env.local` flag in the dev:api script is meant to cover that
 * and does not: `.env.local`, `./.env.local` and `*.local` were all tested
 * against a real content change and none of them triggered a restart, while
 * Vite (which watches .env files itself) restarted every time.
 *
 * The result was a genuinely confusing failure: change SALES_LOGIN_PASSWORD,
 * and the server keeps authenticating against the value it loaded at boot
 * while the file says something else — so the new password is rejected as
 * incorrect with nothing to indicate why.
 *
 * Called at the point of use rather than on a timer, and gated to
 * development: in production the host's own environment is the source of
 * truth, there is no .env.local to read, and silently re-reading one would
 * be a surprise rather than a convenience.
 */
export function refreshEnvIfChanged(): void {
  if (process.env.NODE_ENV === "production") return;
  const mtimeMs = mtimeOf(ENV_FILE);
  if (mtimeMs === 0 || mtimeMs === lastMtimeMs) return;
  lastMtimeMs = mtimeMs;
  // override, or dotenv leaves the already-loaded (stale) values in place —
  // which is the whole bug this exists to fix.
  loadEnv({ path: ENV_FILE, override: true });
  console.log(".env.local changed — reloaded");
}
