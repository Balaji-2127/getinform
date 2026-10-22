import { useState } from "react";
import { AlertIcon, LockIcon } from "./dashboard/icons";
import "./LoginGate.css";

export default function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Login failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-gate">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <img src="/adonmo-logo.jpeg" alt="" className="login-logo" />
          <h1>ADONMO</h1>
        </div>
        <p className="login-sub">Sales access — enter the shared password to upload a campaign.</p>
        <label className="login-field">
          Password
          <span className="field-wrap login-field-wrap">
            <LockIcon size={15} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
            />
          </span>
        </label>
        {error && (
          <p className="login-error" role="alert">
            <AlertIcon size={15} /> {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting || !password}>
          {submitting ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
