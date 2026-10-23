import { Router, type Request, type Response } from "express";
import { requireAuth, canAccessCampaign } from "./auth.js";
import { listCampaignsFull } from "../db.js";
import { getCityFeatures, SUPPORTED_CITIES, type CityId } from "../inventoryLookup.js";

const router = Router();

// Which clients already have this property, or properties in the same
// locality, in one of their campaigns — the property panel's "Nearby
// clients" tab. Built from real campaign selections: a rep looking at a
// building can see who has already bought into that neighbourhood, which is
// both a selling point ("Ola is already here") and a conflict check.
router.get("/properties/nearby-clients", requireAuth, async (req: Request, res: Response) => {
  const cityId = typeof req.query.cityId === "string" ? req.query.cityId : "";
  const mediaSiteId = typeof req.query.mediaSiteId === "string" ? req.query.mediaSiteId : "";
  if (!SUPPORTED_CITIES.includes(cityId as CityId) || !mediaSiteId) {
    res.status(400).json({ error: "cityId and mediaSiteId are required" });
    return;
  }

  const features = getCityFeatures(cityId as CityId);
  const target = features.find((f) => f.properties.mediaSiteId === mediaSiteId);
  if (!target) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const locality = target.properties.locality;
  const localityById = new Map(features.map((f) => [f.properties.mediaSiteId, f.properties.locality]));

  const results: { campaignId: string; clientName: string; campaignName: string; thisProperty: boolean; sameLocality: number }[] = [];
  // Only campaigns this person may see: a salesperson learns about their
  // own clients here, never another rep's.
  for (const c of (await listCampaignsFull()).filter((c) => canAccessCampaign(req.user, c))) {
    const ids = c.selections[cityId] ?? [];
    const thisProperty = ids.includes(mediaSiteId);
    // Without a locality on the target there is nothing to compare against,
    // so only an exact match can count.
    const sameLocality = locality ? ids.filter((id) => id !== mediaSiteId && localityById.get(id) === locality).length : 0;
    if (thisProperty || sameLocality > 0) {
      results.push({ campaignId: c.id, clientName: c.clientName, campaignName: c.campaignName, thisProperty, sameLocality });
    }
  }
  // Clients on this exact building first, then by how much of the area they hold.
  results.sort((a, b) => Number(b.thisProperty) - Number(a.thisProperty) || b.sameLocality - a.sameLocality);
  res.json({ locality, clients: results });
});

export default router;
