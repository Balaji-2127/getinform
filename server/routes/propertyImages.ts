import { Router, type Request, type Response } from "express";

const router = Router();

type ImageResult = { url: string; thumbnailUrl: string; sourcePage: string };

// Query -> resolved images (or an empty list once we've tried and found
// nothing) — in-memory only, same lifetime/reasoning as branding.ts's
// domainCache: a given property is looked up once per server process, not
// once per panel open.
const cache = new Map<string, ImageResult[]>();

// Real per-property photos aren't in our own data (Drive API access is
// blocked on this Cloud project, and the folder links in the source sheet
// aren't fully public either). Google's own Custom Search JSON API turned
// out to be closed to new Cloud projects entirely (confirmed via direct
// testing — 403 "This project does not have the access", a known
// discontinued-for-new-customers state, unrelated to enabling the API or
// billing). Serper.dev is a plug-and-play substitute: it proxies real
// Google Images results, needs only an API key (free-tier signup, no
// Cloud project/billing setup), for "<property name>, <locality>" — the
// same results a sales rep would get typing that into Google Images by
// hand.
async function searchImages(query: string): Promise<ImageResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 6 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      images?: { imageUrl?: string; thumbnailUrl?: string; link?: string }[];
    };
    return (data.images ?? [])
      .filter((item): item is { imageUrl: string; thumbnailUrl?: string; link?: string } => Boolean(item.imageUrl))
      .map((item) => ({
        url: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl ?? item.imageUrl,
        sourcePage: item.link ?? item.imageUrl,
      }));
  } catch {
    return [];
  }
}

router.get("/property-images", async (req: Request, res: Response) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const location = typeof req.query.location === "string" ? req.query.location.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Missing name" });
    return;
  }
  const query = location ? `${name}, ${location}` : name;
  const key = query.toLowerCase();
  if (!cache.has(key)) {
    cache.set(key, await searchImages(query));
  }
  res.json({ images: cache.get(key) });
});

export default router;
