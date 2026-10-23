import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { refreshEnvIfChanged } from "../env.js";
import { getUser, upsertUser, type UserRecord, type UserRole } from "../db.js";

// Who is signed in, as every route sees it (req.user). Set by loadUser on
// each request from the session cookie and the person's current record, so
// removing someone or changing their role takes effect on their very next
// request, not when their 30-day cookie runs out.
export type SessionUser = { email: string; name: string | null; picture: string | null; role: UserRole };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const router = Router();

// Emails listed in ADMIN_EMAILS (comma-separated) are always approved
// admins. That is how the very first admin gets in — there's nobody yet to
// approve them — and a safety net so the people who own the deployment can
// never lock themselves out from the Team page.
function settingsAdmins(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSettingsAdmin(email: string): boolean {
  return settingsAdmins().has(email.toLowerCase());
}

type Identity = { email: string; name: string | null; picture: string | null };

// The decision for a verified Google identity: settings admins and approved
// people get a session; anyone else is recorded as a pending request (once)
// for an admin to approve, or told they were turned down.
async function signIn(req: Request, res: Response, who: Identity) {
  const email = who.email.toLowerCase();
  const now = new Date().toISOString();
  const existing = await getUser(email);
  let user: UserRecord;

  if (isSettingsAdmin(email)) {
    user = await upsertUser(email, {
      name: who.name,
      picture: who.picture,
      role: "admin",
      status: "approved",
      lastLoginAt: now,
      requestedAt: existing?.requestedAt ?? now,
    });
  } else if (existing?.status === "approved") {
    // A password sign-in carries no name or photo; keep the ones Google gave.
    user = await upsertUser(email, { name: who.name ?? existing.name, picture: who.picture ?? existing.picture, lastLoginAt: now });
  } else if (existing?.status === "rejected") {
    req.session = null;
    res.status(403).json({ status: "rejected", error: "Your access request was declined. Ask your admin if this is a mistake." });
    return;
  } else {
    // New, or already waiting: (re)record the request, keeping when it was
    // first made so the admin sees the real waiting time.
    await upsertUser(email, { name: who.name, picture: who.picture, status: "pending", requestedAt: existing?.requestedAt ?? now });
    req.session = null;
    res.status(403).json({ status: "pending", error: "Your request has been sent. You'll be able to sign in once an admin approves it." });
    return;
  }

  if (req.session) {
    req.session.email = email;
    // From the old shared-password login; meaningless now.
    delete req.session.loggedIn;
  }
  res.json({ loggedIn: true, user: { email, name: user.name, picture: user.picture, role: user.role } satisfies SessionUser });
}

// ---- email + shared password (until Google sign-in is set up) ---------------
// A stop-gap so per-person access can go live before the Google client id
// exists: the person gives their email and the team's shared password, and
// the same approval rules apply — only approved emails get in, a new email
// becomes a request for an admin. It proves knowledge of the password, not
// ownership of the email, so it's switched off by removing
// SALES_LOGIN_PASSWORD once Google sign-in is on.

function passwordMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Per-IP attempt cap: the password is shared, so this is what stands
// between it and a brute-force script. In-memory, so a restart resets it.
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

router.post("/auth/password", async (req: Request, res: Response) => {
  refreshEnvIfChanged();
  const expected = process.env.SALES_LOGIN_PASSWORD ?? "";
  if (!expected) {
    res.status(404).json({ error: "Password sign-in is turned off — use Sign in with Google." });
    return;
  }
  if (isRateLimited(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many attempts — try again in 15 minutes." });
    return;
  }
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Enter your work email address." });
    return;
  }
  if (!passwordMatches(password, expected)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  loginAttempts.delete(req.ip ?? "unknown");
  await signIn(req, res, { email, name: null, picture: null });
});

// Which sign-in methods this server offers, so the login page shows the
// right ones without a rebuild when the settings change.
router.get("/auth/methods", (_req: Request, res: Response) => {
  refreshEnvIfChanged();
  res.json({ google: Boolean(process.env.GOOGLE_CLIENT_ID), password: Boolean(process.env.SALES_LOGIN_PASSWORD) });
});

let googleClient: OAuth2Client | null = null;

// "Sign in with Google": the browser gets a signed ID token from Google and
// sends it here. It's checked against Google's keys and this app's own
// client id (so a token minted for some other website is refused), and the
// email must be one Google has verified.
router.post("/auth/google", async (req: Request, res: Response) => {
  refreshEnvIfChanged();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: "Google sign-in isn't configured on this server yet (GOOGLE_CLIENT_ID is missing)." });
    return;
  }
  const credential = typeof req.body?.credential === "string" ? req.body.credential : "";
  if (!credential) {
    res.status(400).json({ error: "Missing Google credential" });
    return;
  }
  try {
    googleClient ??= new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) {
      res.status(401).json({ error: "Google didn't confirm this email address." });
      return;
    }
    await signIn(req, res, { email: p.email, name: p.name ?? null, picture: p.picture ?? null });
  } catch {
    res.status(401).json({ error: "That Google sign-in couldn't be verified — please try again." });
  }
});

// Local testing only: signs in as any email without Google, so the
// approval and visibility rules can be exercised end to end on a laptop.
// Exists only when AUTH_DEV_LOGIN=1 *and* this isn't production or Vercel —
// it's never registered on the live site, whatever the settings say.
if (process.env.AUTH_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  router.post("/auth/dev-login", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    await signIn(req, res, { email, name: typeof req.body?.name === "string" ? req.body.name : null, picture: null });
  });
}

router.post("/logout", (req: Request, res: Response) => {
  req.session = null;
  res.json({ loggedIn: false });
});

router.get("/session", (req: Request, res: Response) => {
  res.json(req.user ? { loggedIn: true, user: req.user } : { loggedIn: false });
});

// Runs before every route (see app.ts): turns the session cookie into
// req.user, re-reading the person's record each time so a removal or a
// role change applies immediately. A cookie for someone no longer approved
// is cleared.
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const email = typeof req.session?.email === "string" ? req.session.email : null;
  if (!email) return next();
  try {
    const record = await getUser(email);
    const admin = isSettingsAdmin(email);
    if (admin || record?.status === "approved") {
      req.user = { email, name: record?.name ?? null, picture: record?.picture ?? null, role: admin ? "admin" : (record?.role ?? "sales") };
    } else {
      req.session = null;
    }
  } catch (e) {
    return next(e);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Only an admin can do that" });
    return;
  }
  next();
}

// Whether this person may see or change a campaign: admins see everything;
// a salesperson sees only campaigns they own.
export function canAccessCampaign(user: SessionUser | undefined, campaign: { ownerEmail?: string | null }): boolean {
  if (!user) return false;
  return user.role === "admin" || (campaign.ownerEmail ?? "").toLowerCase() === user.email;
}

export default router;
