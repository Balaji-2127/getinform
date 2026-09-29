import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";

const router = Router();

function passwordMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The login password is a single shared secret (no per-user accounts to
// lock out), so a per-IP attempt cap is what stands between it and an
// offline brute-force script. In-memory is fine for this app's
// single-process deploy; a restart just resets everyone's count.
const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_ATTEMPT_LIMIT;
}

router.post("/login", (req: Request, res: Response) => {
  if (isRateLimited(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many attempts — try again later" });
    return;
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const expected = process.env.SALES_LOGIN_PASSWORD ?? "";
  if (!expected || !passwordMatches(password, expected)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  if (req.session) req.session.loggedIn = true;
  res.json({ loggedIn: true });
});

router.post("/logout", (req: Request, res: Response) => {
  req.session = null;
  res.json({ loggedIn: false });
});

router.get("/session", (req: Request, res: Response) => {
  res.json({ loggedIn: Boolean(req.session?.loggedIn) });
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.loggedIn) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export default router;
