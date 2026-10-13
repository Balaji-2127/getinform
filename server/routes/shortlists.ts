import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { listCampaignsFull } from "../db.js";
import { getCityFeatures, SUPPORTED_CITIES, type CityId } from "../inventoryLookup.js";

const router = Router();

type PopularProperty = {
  cityId: string;
  mediaSiteId: string;
  name: string;
  locality: string | null;
  zone: string | null;
  count: number;
  clients: string[];
};

// Backs the sidebar's "Shortlists" page — not just another list of
// campaigns (Reports and Clients already cover that), but a real
// aggregate over every campaign's actual selections: which properties
// get picked across *multiple* different campaigns. A property several
// different clients have independently shortlisted is a genuinely
// useful signal (strong inventory), computed from real data, not
// invented.
router.get("/shortlists/popular", requireAuth, async (_req: Request, res: Response) => {
  const campaigns = await listCampaignsFull();

  // cityId -> mediaSiteId -> { count, clients }
  const tally = new Map<string, Map<string, { count: number; clients: Set<string> }>>();
  for (const campaign of campaigns) {
    for (const [cityId, ids] of Object.entries(campaign.selections)) {
      let cityTally = tally.get(cityId);
      if (!cityTally) {
        cityTally = new Map();
        tally.set(cityId, cityTally);
      }
      for (const id of ids) {
        let entry = cityTally.get(id);
        if (!entry) {
          entry = { count: 0, clients: new Set() };
          cityTally.set(id, entry);
        }
        entry.count += 1;
        entry.clients.add(campaign.clientName);
      }
    }
  }

  const results: PopularProperty[] = [];
  for (const [cityId, cityTally] of tally) {
    // A city key we don't have an inventory file for (a stale id left in an
    // old campaign, say) would make getCityFeatures throw ENOENT and 500
    // this whole page — skip it and still report every other city.
    if (!SUPPORTED_CITIES.includes(cityId as CityId)) continue;
    const featureById = new Map(getCityFeatures(cityId as CityId).map((f) => [f.properties.mediaSiteId, f.properties]));
    for (const [mediaSiteId, entry] of cityTally) {
      const props = featureById.get(mediaSiteId);
      if (!props) continue;
      results.push({
        cityId,
        mediaSiteId,
        name: props.name ?? "Untitled property",
        locality: props.locality,
        zone: props.zone,
        count: entry.count,
        clients: [...entry.clients],
      });
    }
  }

  results.sort((a, b) => b.count - a.count);
  res.json(results.slice(0, 30));
});

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
  for (const c of await listCampaignsFull()) {
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
