import { config as loadEnv } from "dotenv";
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
loadEnv({ path: path.join(__dirname, "..", ".env.local") });
