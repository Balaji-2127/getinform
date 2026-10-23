import { createContext, useContext } from "react";

// Who is signed in, as GET /api/session reports it. Admins see every
// campaign and manage the Team page; sales see only their own campaigns.
export type SessionUser = {
  email: string;
  name: string | null;
  picture: string | null;
  role: "admin" | "sales";
  // Signed in with the team password and hasn't chosen their own yet.
  needsPassword?: boolean;
};

export const UserContext = createContext<SessionUser | null>(null);

// Only rendered inside the signed-in app, so a user is always there.
export function useUser(): SessionUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser must be used inside the signed-in app");
  return user;
}

// "Priya Sharma" -> "PS"; falls back to the email's first letter.
export function initials(user: SessionUser): string {
  const fromName = (user.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return fromName || user.email[0]!.toUpperCase();
}
