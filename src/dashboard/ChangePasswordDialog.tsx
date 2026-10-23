import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import "./ChangePasswordDialog.css";

// From the account menu: change your own password. Needs the current one
// (or, if you've never set one — e.g. signed in with Google — just a new
// one). Other devices signed in as you are signed out afterwards.
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const showToast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError("The new passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't change your password");
      showToast("Password changed — other devices have been signed out");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cpw-overlay" onClick={() => !busy && onClose()}>
      <form className="cpw-card" role="dialog" aria-modal="true" aria-labelledby="cpw-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="cpw-title">Change password</h2>
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <label>
          New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="cpw-error">{error}</p>}
        <div className="cpw-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || next.length < 8 || !confirm}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
