import { useEffect, useState } from "react";
import "./ClientLogo.css";

// Resolves the client's own logo dynamically (server-side: Gemini guesses
// their website domain by name, then Google's public favicon service
// serves the actual image — the same trick a company's own site uses for
// its header logo). Falls back to a plain initials badge whenever either
// step doesn't pan out, so a wrong/unknown client name never shows a
// broken image.
export default function ClientLogo({ clientName }: { clientName: string }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLogoUrl(null);
    setFailed(false);
    fetch(`/api/client-logo?name=${encodeURIComponent(clientName)}`)
      .then((r) => (r.ok ? r.json() : { logoUrl: null }))
      .then((data: { logoUrl: string | null }) => {
        if (!cancelled) setLogoUrl(data.logoUrl);
      })
      .catch(() => {
        if (!cancelled) setLogoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientName]);

  const initials = clientName.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div className="cl-badge">
      {logoUrl && !failed ? (
        <img src={logoUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="cl-initials">{initials}</span>
      )}
      <span className="cl-name">{clientName}</span>
    </div>
  );
}
