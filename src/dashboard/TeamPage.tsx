import { useEffect, useState } from "react";
import { useUser } from "../auth";
import { useToast } from "./Toast";
import { CheckIcon, CloseIcon, PlusIcon, TrashIcon } from "./icons";
import "./CampaignsPage.css";
import "./TeamPage.css";

export type TeamMember = {
  email: string;
  name: string | null;
  picture: string | null;
  role: "admin" | "sales";
  status: "approved" | "pending" | "rejected";
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  lastLoginAt: string | null;
  // Listed in the ADMIN_EMAILS setting: always an admin, not editable here.
  fromSettings: boolean;
  // Has chosen their own password (never the password itself).
  hasPassword: boolean;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

// Admins only. Who can sign in, as what, and who is waiting to be let in.
// Anyone who signs in with Google for the first time appears under
// "Requests" until an admin approves or declines them; an admin can also
// add someone in advance so their first sign-in just works.
export default function TeamPage({ onChanged }: { onChanged?: () => void }) {
  const me = useUser();
  const showToast = useToast();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"sales" | "admin">("sales");

  const load = () =>
    fetch("/api/team")
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't load the team");
        return r.json() as Promise<TeamMember[]>;
      })
      .then((list) => {
        setMembers(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  // Every change goes through here: run it, refresh the list, tell the
  // shell (for the pending badge), and say what happened.
  const act = async (key: string, request: () => Promise<Response>, done: string) => {
    setBusy(key);
    try {
      const res = await request();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "That didn't work — try again");
      }
      await load();
      onChanged?.();
      showToast(done);
      return true;
    } catch (e) {
      showToast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const put = (email: string, body: object) =>
    fetch(`/api/team/${encodeURIComponent(email)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const pending = members?.filter((m) => m.status === "pending") ?? [];
  const approved = members?.filter((m) => m.status === "approved") ?? [];
  const declined = members?.filter((m) => m.status === "rejected") ?? [];

  const label = (m: TeamMember) => m.name ?? m.email;

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">TEAM</span>
          <h1>Team &amp; access</h1>
          <p>Approve who can sign in. Sales see only their own campaigns; admins see everything and manage this page.</p>
        </div>
      </div>

      {error && <p className="team-error">{error}</p>}

      <section className="team-card">
        <header className="team-card-head">
          <h2>Requests</h2>
          {pending.length > 0 && <span className="team-count">{pending.length}</span>}
        </header>
        {members === null ? (
          <p className="team-empty">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="team-empty">No one is waiting. New people appear here when they first sign in with Google.</p>
        ) : (
          <ul className="team-list">
            {pending.map((m) => (
              <li key={m.email} className="team-row is-pending">
                <Person m={m} />
                <span className="team-meta">Asked {when(m.requestedAt)}</span>
                <span className="team-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy !== null}
                    onClick={() => act(m.email, () => put(m.email, { status: "approved", role: "sales" }), `${label(m)} can now sign in`)}
                  >
                    <CheckIcon size={13} /> Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy !== null}
                    onClick={() => act(m.email, () => put(m.email, { status: "rejected" }), `Declined ${label(m)}`)}
                  >
                    <CloseIcon size={13} /> Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="team-card">
        <header className="team-card-head">
          <h2>Members</h2>
          <span className="team-count is-muted">{approved.length}</span>
        </header>

        <form
          className="team-add"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act(
              "add",
              () => fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: newEmail, role: newRole }) }),
              `${newEmail.trim()} added — they can sign in now`,
            );
            if (ok) setNewEmail("");
          }}
        >
          <input type="email" placeholder="Add someone by email, e.g. ravi@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as "sales" | "admin")} aria-label="Role">
            <option value="sales">Sales</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !newEmail.trim()}>
            <PlusIcon size={14} /> Add
          </button>
        </form>

        <ul className="team-list">
          {approved.map((m) => {
            const isMe = m.email === me.email;
            return (
              <li key={m.email} className="team-row">
                <Person m={m} you={isMe} />
                <span className="team-meta">
                  Last sign-in {when(m.lastLoginAt)}
                  <span className={"team-pw" + (m.hasPassword ? " is-set" : "")}>{m.hasPassword ? "Own password set" : "No own password yet"}</span>
                </span>
                <span className="team-actions">
                  {m.fromSettings ? (
                    <span className="team-role-fixed" title="Set in the app's settings (ADMIN_EMAILS)">
                      Admin · set in settings
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      disabled={busy !== null || isMe}
                      aria-label={`Role for ${label(m)}`}
                      onChange={(e) => act(m.email, () => put(m.email, { role: e.target.value }), `${label(m)} is now ${e.target.value === "admin" ? "an admin" : "sales"}`)}
                    >
                      <option value="sales">Sales</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  {m.hasPassword && !isMe && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy !== null}
                      title="For a forgotten password: they sign in with the team password again and choose a new one"
                      onClick={() =>
                        act(m.email, () => put(m.email, { resetPassword: true }), `Password reset — ${label(m)} will choose a new one at next sign-in`)
                      }
                    >
                      Reset password
                    </button>
                  )}
                  {!m.fromSettings && !isMe && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm team-remove"
                      disabled={busy !== null}
                      title={`Remove ${label(m)}`}
                      aria-label={`Remove ${label(m)}`}
                      onClick={() =>
                        act(m.email, () => fetch(`/api/team/${encodeURIComponent(m.email)}`, { method: "DELETE" }), `${label(m)} removed — their access has ended`)
                      }
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {declined.length > 0 && (
        <section className="team-card">
          <header className="team-card-head">
            <h2>Declined</h2>
            <span className="team-count is-muted">{declined.length}</span>
          </header>
          <ul className="team-list">
            {declined.map((m) => (
              <li key={m.email} className="team-row">
                <Person m={m} />
                <span className="team-meta">Declined {when(m.decidedAt)}</span>
                <span className="team-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy !== null}
                    onClick={() => act(m.email, () => put(m.email, { status: "approved", role: "sales" }), `${label(m)} can now sign in`)}
                  >
                    Approve instead
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Person({ m, you }: { m: TeamMember; you?: boolean }) {
  return (
    <span className="team-person">
      {m.picture ? <img src={m.picture} alt="" className="team-avatar" referrerPolicy="no-referrer" /> : <span className="team-avatar is-blank">{(m.name ?? m.email)[0]!.toUpperCase()}</span>}
      <span className="team-person-text">
        <span className="team-name">
          {m.name ?? m.email}
          {you && <span className="team-you">You</span>}
          {m.role === "admin" && m.status === "approved" && <span className="team-badge">Admin</span>}
        </span>
        {m.name && <span className="team-email">{m.email}</span>}
      </span>
    </span>
  );
}
