import { Router, type Request, type Response } from "express";

const router = Router();

// Client name -> resolved domain (or null once we've tried and failed) —
// in-memory only, not persisted. Cheap enough: a campaign's client name is
// looked up once per server process lifetime, not once per page view.
const domainCache = new Map<string, string | null>();

const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// Asks Gemini for the client's own website domain — the same trick a
// company's own site uses for its header logo, just resolved dynamically
// instead of hardcoded, so any client name a sales rep uploads works, not
// just ones we've seen before.
async function resolveDomainViaGemini(clientName: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
  const prompt = `What is the primary official website domain for the company/brand named "${clientName}"? Reply with ONLY the bare domain (e.g. "example.com"), nothing else. If you are not confident which company this is, reply with exactly: unknown`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
    if (!text || text.includes("unknown") || !DOMAIN_PATTERN.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

router.get("/client-logo", async (req: Request, res: Response) => {
  const clientName = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!clientName) {
    res.status(400).json({ error: "Missing name" });
    return;
  }
  const key = clientName.toLowerCase();
  if (!domainCache.has(key)) {
    domainCache.set(key, await resolveDomainViaGemini(clientName));
  }
  const domain = domainCache.get(key) ?? null;
  // Google's own favicon service — no key needed, just a domain. (Tried
  // Clearbit's public logo endpoint first; it shut down December 2025 —
  // logo.clearbit.com no longer resolves at all. This one's Google's own
  // infrastructure, much less likely to just disappear.) The frontend
  // still needs its own onError fallback (an initials badge) for when
  // either step didn't pan out (wrong/no domain, or no favicon on file).
  res.json({ logoUrl: domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null });
});

export default router;
