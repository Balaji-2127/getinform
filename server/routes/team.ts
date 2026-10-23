import { Router, type Request, type Response } from "express";
import { requireAdmin, isSettingsAdmin } from "./auth.js";
import { deleteUser, getUser, listUsers, upsertUser, type UserRole } from "../db.js";

const router = Router();

const ROLES: UserRole[] = ["admin", "sales"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The Team page: who can sign in, as what, and who is waiting to be let in.
// Admins only. Pending requests come first (they need an answer), then
// everyone else alphabetically. People listed in ADMIN_EMAILS are flagged so
// the page can explain why they can't be changed from here.
router.get("/team", requireAdmin, async (_req: Request, res: Response) => {
  const users = await listUsers();
  const rank = { pending: 0, approved: 1, rejected: 2 } as const;
  users.sort((a, b) => rank[a.status] - rank[b.status] || a.email.localeCompare(b.email));
  // Never send password hashes to the browser — only whether one is set.
  res.json(
    users.map(({ passwordHash, passwordChangedAt: _changed, ...u }) => ({ ...u, hasPassword: Boolean(passwordHash), fromSettings: isSettingsAdmin(u.email) })),
  );
});

// Adds someone in advance — approved straight away, so they can sign in the
// first time without waiting.
router.post("/team", requireAdmin, async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const role: UserRole = ROLES.includes(req.body?.role) ? req.body.role : "sales";
  if (!EMAIL.test(email)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  const now = new Date().toISOString();
  const existing = await getUser(email);
  const { passwordHash, passwordChangedAt: _changed, ...user } = await upsertUser(email, {
    role,
    status: "approved",
    decidedAt: now,
    decidedBy: req.user!.email,
    requestedAt: existing?.requestedAt ?? null,
  });
  res.json({ ...user, hasPassword: Boolean(passwordHash) });
});

// Approve or decline a request, or change someone's role.
router.put<{ email: string }>("/team/:email", requireAdmin, async (req, res) => {
  const email = req.params.email.toLowerCase();
  const existing = await getUser(email);
  if (!existing) {
    res.status(404).json({ error: "No such person" });
    return;
  }
  if (isSettingsAdmin(email)) {
    res.status(400).json({ error: "This admin is set in the app's settings (ADMIN_EMAILS) and can't be changed here." });
    return;
  }
  // Forgotten password: clear it (and end their sessions). Their next
  // sign-in with the team password asks them to choose a new one.
  if (req.body?.resetPassword === true) {
    await upsertUser(email, { passwordHash: null, passwordChangedAt: new Date().toISOString() });
    res.json({ email, hasPassword: false });
    return;
  }
  const status = ["approved", "rejected"].includes(req.body?.status) ? (req.body.status as "approved" | "rejected") : undefined;
  const role: UserRole | undefined = ROLES.includes(req.body?.role) ? req.body.role : undefined;
  // An admin can't demote or lock out themselves by accident; another admin
  // has to do it.
  if (email === req.user!.email && (status === "rejected" || role === "sales")) {
    res.status(400).json({ error: "You can't remove your own admin access." });
    return;
  }
  const now = new Date().toISOString();
  const { passwordHash, passwordChangedAt: _changed, ...user } = await upsertUser(email, {
    ...(status ? { status, decidedAt: now, decidedBy: req.user!.email } : {}),
    ...(role ? { role } : {}),
  });
  res.json({ ...user, hasPassword: Boolean(passwordHash) });
});

// Removes someone entirely. Their next request finds no record and their
// session ends; if they sign in again they start a fresh request.
router.delete<{ email: string }>("/team/:email", requireAdmin, async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (email === req.user!.email) {
    res.status(400).json({ error: "You can't remove yourself." });
    return;
  }
  if (isSettingsAdmin(email)) {
    res.status(400).json({ error: "This admin is set in the app's settings (ADMIN_EMAILS) and can't be removed here." });
    return;
  }
  if (!(await deleteUser(email))) {
    res.status(404).json({ error: "No such person" });
    return;
  }
  res.status(204).end();
});

export default router;
