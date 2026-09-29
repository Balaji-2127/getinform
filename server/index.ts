import express, { type Request, type Response, type NextFunction } from "express";
import cookieSession from "cookie-session";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import campaignsRouter from "./routes/campaigns.js";
import brandingRouter from "./routes/branding.js";
import propertyImagesRouter from "./routes/propertyImages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same .env.local the Vite frontend reads VITE_GOOGLE_MAPS_API_KEY from —
// this process just also needs SALES_LOGIN_PASSWORD/SESSION_SECRET/PORT
// from it, since only Vite's dev server loads .env files automatically.
loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production — refusing to start with the dev-only default.");
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
