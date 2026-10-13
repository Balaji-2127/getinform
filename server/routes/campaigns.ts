import { Router, type Request, type Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { requireAuth } from "./auth.js";
import { getKnownMediaSiteIds, type CityId } from "../inventoryLookup.js";
import { SHEET_NAME_TO_CITY } from "../sheetMapping.js";
import { insertCampaign, getCampaign, listCampaigns, updateCampaignSelections, deleteCampaign, type CampaignSelections } from "../db.js";
import { SUPPORTED_CITIES } from "../inventoryLookup.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".xlsx")) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx files are supported"));
    }
  },
});

const router = Router();

const MEDIA_SITE_ID_HEADER = "Media Site Id";

async function parseWorkbook(
  buffer: Buffer,
): Promise<{ selections: CampaignSelections; skippedSheets: string[]; warnings: string[] }> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled Buffer typing predates the current @types/node Buffer
  // generic, so it's a real Buffer at runtime under an incompatible type.
  await workbook.xlsx.load(buffer as never);

  const selections: CampaignSelections = {};
  const skippedSheets: string[] = [];
  // Every other way a recognized city sheet can come up empty — wrong
  // header spelling, or a header that's found but whose rows don't match
  // this city's known inventory (e.g. an out-of-date master sheet). Both
  // used to fail silently: the sheet just vanished from the campaign with
  // no explanation, indistinguishable from "the rep genuinely shortlisted
  // nothing in that city". A sales rep uploading a real sheet needs to
  // know their data didn't make it, not just see it missing.
  const warnings: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const cityId: CityId | undefined = SHEET_NAME_TO_CITY[worksheet.name];
    if (!cityId) {
      if (worksheet.name.startsWith("Property List")) skippedSheets.push(worksheet.name);
      continue;
    }

    let mediaSiteIdCol = -1;
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      if (String(cell.value).trim() === MEDIA_SITE_ID_HEADER) mediaSiteIdCol = colNumber;
    });
    if (mediaSiteIdCol === -1) {
      warnings.push(`"${worksheet.name}": no "${MEDIA_SITE_ID_HEADER}" column found — this sheet was skipped.`);
      continue;
    }

    const knownIds = getKnownMediaSiteIds(cityId);
    const matched = new Set<string>(selections[cityId]);
    let rowsWithId = 0;
    worksheet.eachRow((row, rowNumber) => {
      // Row 1 is the header; the master template's row 2 is an instruction
      // row ("Kindly shortlist your properties...") with no Media Site Id,
      // so it's naturally skipped here without special-casing it.
      if (rowNumber === 1) return;
      const raw = row.getCell(mediaSiteIdCol).value;
      const id = typeof raw === "string" ? raw.trim() : raw != null ? String(raw).trim() : "";
      if (!id) return;
      rowsWithId++;
      if (knownIds.has(id)) matched.add(id);
    });

    if (matched.size > 0) {
      selections[cityId] = [...matched];
    } else if (rowsWithId > 0) {
      warnings.push(
        `"${worksheet.name}": found ${rowsWithId} row(s) with a Media Site Id, but none matched known ${cityId} inventory.`,
      );
    }
  }

  return { selections, skippedSheets, warnings };
}

router.get("/", requireAuth, async (_req: Request, res: Response) => {
  res.json(await listCampaigns());
});

router.post("/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  const file = req.file;
  const clientName = typeof req.body?.clientName === "string" ? req.body.clientName.trim() : "";
  const campaignName = typeof req.body?.campaignName === "string" ? req.body.campaignName.trim() : "";

  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  if (!clientName || !campaignName) {
    res.status(400).json({ error: "Client name and campaign name are required" });
    return;
  }

  let parsed: { selections: CampaignSelections; skippedSheets: string[]; warnings: string[] };
  try {
    parsed = await parseWorkbook(file.buffer);
  } catch {
    res.status(400).json({ error: "Could not read this file as an Excel workbook" });
    return;
  }

  if (Object.keys(parsed.selections).length === 0) {
    res.status(400).json({
      error: "No shortlisted properties matched the known inventory. Check the sheet names and the Media Site Id column.",
      skippedSheets: parsed.skippedSheets,
      warnings: parsed.warnings,
    });
    return;
  }

  const record = await insertCampaign({ clientName, campaignName, selections: parsed.selections });
  res.json({
    campaignId: record.id,
    shareUrl: `/campaign/${record.id}`,
    matched: Object.fromEntries(Object.entries(parsed.selections).map(([city, ids]) => [city, ids.length])),
    skippedSheets: parsed.skippedSheets,
    warnings: parsed.warnings,
  });
});

// Re-uploading a sheet into a campaign that already exists.
//
// The need this answers: a campaign was built from a two-city sheet, the
// client then wants two more cities, and starting a second campaign would
// split one pitch across two share links. This grows the existing one
// instead, so the link already sent to the client keeps working and simply
// shows more.
//
// `mode` decides what the sheet means:
//   merge   (default) — the sheet adds to what's there. Cities already in
//                       the campaign keep their properties; new cities and
//                       new properties are added. This is the common case.
//   replace           — the sheet becomes the whole shortlist, so properties
//                       dropped from the sheet are dropped from the campaign.
//
// Merging is the default because it is the safe direction: adding something
// unwanted can be undone from Edit shortlist, whereas a replace silently
// discards every property the new sheet happens to omit.
router.post<{ id: string }>("/:id/upload", requireAuth, upload.single("file"), async (req, res) => {
  const existing = await getCampaign(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const mode = req.body?.mode === "replace" ? "replace" : "merge";

  let parsed: { selections: CampaignSelections; skippedSheets: string[]; warnings: string[] };
  try {
    parsed = await parseWorkbook(file.buffer);
  } catch {
    res.status(400).json({ error: "Could not read this file as an Excel workbook" });
    return;
  }

  if (Object.keys(parsed.selections).length === 0) {
    res.status(400).json({
      error: "No shortlisted properties matched the known inventory. Check the sheet names and the Media Site Id column.",
      skippedSheets: parsed.skippedSheets,
      warnings: parsed.warnings,
    });
    return;
  }

  const before = existing.selections ?? {};
  const merged: CampaignSelections = mode === "replace" ? {} : Object.fromEntries(Object.entries(before).map(([c, ids]) => [c, [...ids]]));

  let added = 0;
  for (const [cityId, ids] of Object.entries(parsed.selections)) {
    const set = new Set(merged[cityId] ?? []);
    for (const id of ids) {
      if (!set.has(id)) added++;
      set.add(id);
    }
    merged[cityId] = [...set];
  }

  const record = await updateCampaignSelections(req.params.id, merged);
  if (!record) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const countsOf = (sel: CampaignSelections) => Object.fromEntries(Object.entries(sel).map(([c, ids]) => [c, ids.length]));
  const beforeCounts = countsOf(before);
  res.json({
    mode,
    added,
    // Cities the campaign did not cover until this upload — the headline
    // outcome when someone is extending a campaign into new cities.
    newCities: Object.keys(merged).filter((c) => !(c in beforeCounts)),
    before: beforeCounts,
    after: countsOf(merged),
    matched: countsOf(parsed.selections),
    skippedSheets: parsed.skippedSheets,
    warnings: parsed.warnings,
    selections: record.selections,
  });
});

// Adds a single property to an existing campaign — the Inventory page's
// "Add to campaign" button. Server-side rather than the client fetching the
// selections, appending and PUTting them back, because that read-modify-write
// would silently drop an edit made in another tab between the read and the
// write. Here the append happens against what is stored right now.
router.post<{ id: string }>("/:id/properties", requireAuth, async (req, res) => {
  const { cityId, mediaSiteId } = req.body ?? {};
  if (typeof cityId !== "string" || typeof mediaSiteId !== "string") {
    res.status(400).json({ error: "cityId and mediaSiteId are required" });
    return;
  }
  if (!SUPPORTED_CITIES.includes(cityId as CityId)) {
    res.status(400).json({ error: "Unknown city" });
    return;
  }
  if (!getKnownMediaSiteIds(cityId as CityId).has(mediaSiteId)) {
    res.status(400).json({ error: "That property isn't in this city's inventory" });
    return;
  }
  const existing = await getCampaign(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const selections: CampaignSelections = { ...(existing.selections ?? {}) };
  const ids = selections[cityId] ?? [];
  // Idempotent: adding something already shortlisted reports that rather
  // than storing a duplicate.
  const alreadyIn = ids.includes(mediaSiteId);
  if (!alreadyIn) selections[cityId] = [...ids, mediaSiteId];
  const record = alreadyIn ? existing : await updateCampaignSelections(req.params.id, selections);
  res.json({ added: !alreadyIn, newCity: !alreadyIn && ids.length === 0, selections: record?.selections ?? selections });
});

router.get<{ id: string }>("/:id", async (req, res) => {
  const record = await getCampaign(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ clientName: record.clientName, campaignName: record.campaignName, selections: record.selections });
});

// Replaces a campaign's shortlist wholesale (the "edit shortlist" flow —
// add/remove properties without re-uploading a sheet). Each city's id
// list is filtered down to that city's own known inventory, and unknown
// city keys are dropped outright — defensive since this is a client-
// supplied body, not something the server generated itself.
router.put<{ id: string }>("/:id/selections", requireAuth, async (req, res) => {
  const existing = await getCampaign(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const body = req.body?.selections;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Missing selections" });
    return;
  }
  const cleaned: CampaignSelections = {};
  for (const cityId of SUPPORTED_CITIES) {
    const ids = body[cityId];
    if (!Array.isArray(ids)) continue;
    const known = getKnownMediaSiteIds(cityId);
    // Deduped as well as filtered — a repeated id would otherwise be stored
    // twice, inflating this city's count everywhere it's displayed (the
    // campaign list, Reports, the map banner) and double-counting the same
    // property in the "most shortlisted" aggregate.
    const kept = [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)))];
    if (kept.length > 0) cleaned[cityId] = kept;
  }
  const record = await updateCampaignSelections(req.params.id, cleaned);
  if (!record) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ selections: record.selections });
});

// Removing a campaign for good. Authenticated, because the client-facing
// GET above deliberately isn't — a shared link must open without a login,
// but nobody holding that link should be able to delete what it points at.
router.delete<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const deleted = await deleteCampaign(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ deleted: true });
});

export default router;
