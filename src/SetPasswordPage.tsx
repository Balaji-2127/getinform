import { useState } from "react";
import { AlertIcon, LockIcon } from "./dashboard/icons";
import type { SessionUser } from "./auth";
import "./LoginGate.css";

// Shown right after someone signs in with the team password for the first
// time (or after an admin reset theirs): they choose their own password
// before they can open anything. From then on only that password opens
// their account — the team password no longer does.
export default function SetPasswordPage({
  user,
  onDone,
  onSignOut,
}: {
  user: SessionUser;
  onDone: (user: SessionUser) => void;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const body = (await res.json().catch(() => null)) as { user?: SessionUser; error?: string } | null;
      if (!res.ok || !body?.user) throw new Error(body?.error ?? "Couldn't save your password");
      onDone(body.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-gate">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/adonmo-logo.jpeg" alt="" className="login-logo" />
          <h1>ADONMO</h1>
        </div>
        <p className="login-sub">
          Welcome, <strong>{user.email}</strong>. Choose your own password — from now on you'll sign in with it, and the team password
          won't open your account.
        </p>
        <label className="login-field">
          New password
          <span className="field-wrap login-field-wrap">
            <LockIcon size={15} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
          </span>
        </label>
        <label className="login-field">
          Confirm password
          <span className="field-wrap login-field-wrap">
            <LockIcon size={15} />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" autoComplete="new-password" />
          </span>
        </label>
        {error && (
          <p className="login-error" role="alert">
            <AlertIcon size={15} /> {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || password.length < 8 || !confirm}>
          {busy ? "Saving…" : "Save password and continue"}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </form>
    </div>
  );
}
