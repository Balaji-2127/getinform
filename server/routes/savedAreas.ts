import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { listSavedAreas, saveArea, unsaveArea } from "../db.js";
import { SUPPORTED_CITIES } from "../inventoryLookup.js";

const router = Router();

// Backs the sidebar's "My Areas" — a rep explicitly starring a locality
// from Market Insights, persisted for real (shared across whoever's
// using the app, same as campaigns/clients — no per-user accounts exist
// here), not a fabricated list.
router.get("/saved-areas", requireAuth, (_req: Request, res: Response) => {
  res.json(listSavedAreas());
});

router.post("/saved-areas", requireAuth, (req: Request, res: Response) => {
  const { cityId, locality } = req.body ?? {};
  if (typeof cityId !== "string" || typeof locality !== "string" || !locality.trim()) {
    res.status(400).json({ error: "cityId and locality are required" });
    return;
  }
  if (!SUPPORTED_CITIES.includes(cityId as (typeof SUPPORTED_CITIES)[number])) {
    res.status(400).json({ error: "Unknown city" });
    return;
  }
  res.json(saveArea(cityId, locality.trim()));
});

router.delete("/saved-areas", requireAuth, (req: Request, res: Response) => {
  const { cityId, locality } = req.body ?? {};
  if (typeof cityId !== "string" || typeof locality !== "string") {
    res.status(400).json({ error: "cityId and locality are required" });
    return;
  }
  unsaveArea(cityId, locality);
  res.json({ ok: true });
});

export default router;
