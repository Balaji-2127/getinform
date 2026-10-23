import "./env.js"; // must be the first import — see env.ts for why
// The Express app itself, with no listen() call, so it can run two ways:
// as a long-lived server (server/index.ts — local dev and Render) and as a
// Vercel serverless function (api/index.js), which hands requests to the
// exported app directly.
import express, { type Request, type Response, type NextFunction } from "express";
import cookieSession from "cookie-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter, { loadUser } from "./routes/auth.js";
import teamRouter from "./routes/team.js";
import campaignsRouter from "./routes/campaigns.js";
import brandingRouter from "./routes/branding.js";
import propertyImagesRouter from "./routes/propertyImages.js";
import searchRouter from "./routes/search.js";
import shortlistsRouter from "./routes/shortlists.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production — refusing to start with the dev-only default.");
}

// Same reasoning, and a worse failure mode without it. .env.local is not
// committed, so a deployed instance only has these if they were set in the
// host's own environment. With neither Google sign-in (GOOGLE_CLIENT_ID)
// nor the email + password stop-gap (SALES_LOGIN_PASSWORD) nobody could
// sign in at all, and the site would just look broken with nothing saying
// why.
if (isProduction && !process.env.GOOGLE_CLIENT_ID && !process.env.SALES_LOGIN_PASSWORD) {
  throw new Error(
    "Set GOOGLE_CLIENT_ID (Sign in with Google) or SALES_LOGIN_PASSWORD (email + password) in production — " +
      "otherwise nobody can sign in. Set them in the host's environment variables.",
  );
}
if (isProduction && !process.env.ADMIN_EMAILS) {
  console.warn("[auth] ADMIN_EMAILS is not set — only admins already recorded in the database can approve people.");
}

const app = express();
app.set("trust proxy", isProduction);
app.use(express.json());
app.use(
  cookieSession({
    name: "getinform-session",
    keys: [process.env.SESSION_SECRET ?? "dev-only-insecure-secret"],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
  }),
);

// Who's signed in, re-checked against their record on every request.
app.use("/api", loadUser);

app.use("/api", authRouter);
app.use("/api", teamRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api", brandingRouter);
app.use("/api", propertyImagesRouter);
app.use("/api", searchRouter);
app.use("/api", shortlistsRouter);

// Unknown /api paths have to 404 as JSON. Without this they fall through to
// the SPA catch-all below and resolve with index.html at HTTP 200, so a
// client fetch sails past its `res.ok` check and then blows up inside
// res.json() on an HTML body — a typo'd or removed endpoint would surface
// as an unexplained parse error rather than a plain 404.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

if (isProduction) {
  // Single-process deploy: this same server also serves the built SPA, and
  // falls back to index.html for any non-API path so the client-side
  // "/campaign/:id" route still resolves on a hard refresh or direct link.
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get("/*splat", (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// Keeps API error responses JSON (multer/body-parser failures included)
// instead of Express's default HTML error page.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected server error";
  res.status(400).json({ error: message });
});

export default app;
