import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { listCampaigns, recordSearch, listRecentSearches } from "../db.js";
import { SUPPORTED_CITIES, getCityFeatures } from "../inventoryLookup.js";

const router = Router();

const MAX_CAMPAIGNS = 8;
const MAX_PROPERTIES = 12;

// Backs the dashboard's topbar search — previously a non-functional
// placeholder. Searches campaigns/clients (from the campaigns table) and
// properties/localities (across every city's own inventory file) in one
// call, so the one search box covers everything the placeholder text
// promised. Runs server-side rather than shipping all 21 cities' data to
// the browser just to filter it client-side.
router.get("/search", requireAuth, (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (!q) {
    res.json({ campaigns: [], properties: [] });
    return;
  }

  const campaigns = listCampaigns()
    .filter((c) => c.clientName.toLowerCase().includes(q) || c.campaignName.toLowerCase().includes(q))
    .slice(0, MAX_CAMPAIGNS)
    .map((c) => ({ id: c.id, clientName: c.clientName, campaignName: c.campaignName, createdAt: c.createdAt }));

  const properties: { cityId: string; mediaSiteId: string; name: string; locality: string | null; zone: string | null }[] = [];
  for (const cityId of SUPPORTED_CITIES) {
    if (properties.length >= MAX_PROPERTIES) break;
    for (const f of getCityFeatures(cityId)) {
      if (properties.length >= MAX_PROPERTIES) break;
      const p = f.properties;
      if (!p.mediaSiteId || !p.name) continue;
      const haystack = `${p.name} ${p.locality ?? ""} ${p.zone ?? ""}`.toLowerCase();
      if (haystack.includes(q)) {
        properties.push({ cityId, mediaSiteId: p.mediaSiteId, name: p.name, locality: p.locality, zone: p.zone });
      }
    }
  }

  res.json({ campaigns, properties });
});

// Logs a search *result the rep actually clicked* — called once, right
// when GlobalSearch opens that result, not on every keystroke. Backs the
// sidebar's "Recent Searches", a real log of what people went looking
// for and found rather than a placeholder.
router.post("/search-history", requireAuth, (req: Request, res: Response) => {
  const { query, resultType, resultLabel, resultSub, cityId, targetId } = req.body ?? {};
  if (
    typeof query !== "string" ||
    (resultType !== "campaign" && resultType !== "property") ||
    typeof resultLabel !== "string" ||
    typeof targetId !== "string"
  ) {
    res.status(400).json({ error: "Invalid search history entry" });
    return;
  }
  const entry = recordSearch({
    query,
    resultType,
    resultLabel,
    resultSub: typeof resultSub === "string" ? resultSub : null,
    cityId: typeof cityId === "string" ? cityId : null,
    targetId,
  });
  res.json(entry);
});

router.get("/search-history", requireAuth, (_req: Request, res: Response) => {
  res.json(listRecentSearches());
});

export default router;
