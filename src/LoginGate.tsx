import { useEffect, useRef, useState } from "react";
import { AlertIcon } from "./dashboard/icons";
import type { SessionUser } from "./auth";
import "./LoginGate.css";

// Google's sign-in button script ("Google Identity Services"). Loaded once,
// on the sign-in page only.
const GSI_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
// Local testing without Google: an email box that signs in directly. Only
// in a dev build with VITE_AUTH_DEV_LOGIN=1, and the server refuses it
// anyway unless it was started with AUTH_DEV_LOGIN=1 outside production.
const DEV_LOGIN = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEV_LOGIN === "1";

type GoogleId = {
  accounts: {
    id: {
      initialize: (opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};

function loadGsi(): Promise<GoogleId> {
  const w = window as unknown as { google?: GoogleId };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error("Google sign-in didn't load")));
    s.onerror = () => reject(new Error("Couldn't reach Google sign-in"));
    document.head.appendChild(s);
  });
}

// What the server said about this account, when it isn't a plain yes.
type Outcome = { kind: "pending" | "rejected" | "error"; message: string } | null;

export default function LoginGate({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  const finish = async (res: Response) => {
    const body = (await res.json().catch(() => null)) as { user?: SessionUser; status?: string; error?: string } | null;
    if (res.ok && body?.user) {
      onSuccess(body.user);
      return;
    }
    if (body?.status === "pending" || body?.status === "rejected") {
      setOutcome({ kind: body.status, message: body.error ?? "" });
    } else {
      setOutcome({ kind: "error", message: body?.error ?? "Sign-in failed — please try again." });
    }
  };

  useEffect(() => {
    if (!CLIENT_ID || !buttonRef.current) return;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !buttonRef.current) return;
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            setBusy(true);
            setOutcome(null);
            try {
              await finish(
                await fetch("/api/auth/google", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ credential }),
                }),
              );
            } catch {
              setOutcome({ kind: "error", message: "Could not reach the server" });
            } finally {
              setBusy(false);
            }
          },
        });
        google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: 300 });
      })
      .catch((e: Error) => !cancelled && setOutcome({ kind: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      await finish(
        await fetch("/api/auth/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: devEmail }),
        }),
      );
    } catch {
      setOutcome({ kind: "error", message: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-gate">
      <div className="login-card">
        <div className="login-brand">
          <img src="/adonmo-logo.jpeg" alt="" className="login-logo" />
          <h1>ADONMO</h1>
        </div>
        <p className="login-sub">Sign in with your work Google account. New here? Signing in sends your request to an admin.</p>

        {CLIENT_ID ? (
          <div className="login-google" aria-busy={busy}>
            <div ref={buttonRef} />
            {busy && <span className="login-checking">Checking…</span>}
          </div>
        ) : (
          <p className="login-error" role="alert">
            <AlertIcon size={15} /> Google sign-in isn't set up yet (VITE_GOOGLE_CLIENT_ID is missing).
          </p>
        )}

        {outcome && (
          <p className={"login-notice is-" + outcome.kind} role="alert">
            {outcome.kind === "error" && <AlertIcon size={15} />}
            <span>
              {outcome.kind === "pending" && <strong>Request sent. </strong>}
              {outcome.kind === "rejected" && <strong>Access declined. </strong>}
              {outcome.message}
            </span>
          </p>
        )}

        {DEV_LOGIN && (
          <form className="login-dev" onSubmit={devSignIn}>
            <span className="login-dev-title">Local testing only</span>
            <input type="email" placeholder="email@example.com" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-block" disabled={busy || !devEmail}>
              Sign in without Google
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
