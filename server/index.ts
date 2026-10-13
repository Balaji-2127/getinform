import "./env.js"; // must be the first import — see env.ts for why
import express, { type Request, type Response, type NextFunction } from "express";
import cookieSession from "cookie-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import campaignsRouter from "./routes/campaigns.js";
import brandingRouter from "./routes/branding.js";
import propertyImagesRouter from "./routes/propertyImages.js";
import searchRouter from "./routes/search.js";
import savedAreasRouter from "./routes/savedAreas.js";
import shortlistsRouter from "./routes/shortlists.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production — refusing to start with the dev-only default.");
}

// Same reasoning, and a worse failure mode without it. .env.local is not
// committed, so a deployed instance only has this if it was set in the
// host's own environment. When it is missing the login route compares
// against an empty string and answers "Incorrect password" to every attempt
// — a misconfigured deploy is then indistinguishable from a typo, and the
// only symptom is that nobody can get in and nothing says why.
if (isProduction && !process.env.SALES_LOGIN_PASSWORD) {
  throw new Error(
    "SALES_LOGIN_PASSWORD must be set in production — without it every login is rejected as incorrect. " +
      "Set it in the host's environment variables (it is not read from .env.local, which is never deployed).",
  );
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

app.use("/api", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api", brandingRouter);
app.use("/api", propertyImagesRouter);
app.use("/api", searchRouter);
app.use("/api", savedAreasRouter);
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

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
