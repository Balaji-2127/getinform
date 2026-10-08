import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { listCampaignsFull } from "../db.js";
import { getCityFeatures, type CityId } from "../inventoryLookup.js";

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

export default router;
