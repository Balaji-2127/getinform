import { Router, type Request, type Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { requireAuth } from "./auth.js";
import { getKnownMediaSiteIds, getCityFeatures, type CityId } from "../inventoryLookup.js";
import { SHEET_NAME_TO_CITY } from "../sheetMapping.js";
import {
  insertCampaign,
  getCampaign,
  listCampaigns,
  updateCampaignSelections,
  deleteCampaign,
  recordCampaignView,
  addCampaignViewTime,
  saveCampaignReview,
  type CampaignSelections,
  type CampaignReview,
} from "../db.js";
import { SUPPORTED_CITIES } from "../inventoryLookup.js";

const upload = multer({
  storage: multer.memoryStorage(),
  // 4 MB: Vercel caps a request body at 4.5 MB, so anything larger would be
  // cut off before reaching this handler. Mirrors src/uploadLimit.ts.
  limits: { fileSize: 4 * 1024 * 1024 },
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

// A request body's { cityId: mediaSiteId[] } reduced to real inventory:
// unknown cities and ids dropped, duplicates removed, empty cities left out.
function cleanSelections(body: unknown): CampaignSelections {
  const cleaned: CampaignSelections = {};
  if (!body || typeof body !== "object") return cleaned;
  for (const cityId of SUPPORTED_CITIES) {
    const ids = (body as Record<string, unknown>)[cityId];
    if (!Array.isArray(ids)) continue;
    const known = getKnownMediaSiteIds(cityId);
    // Deduped as well as filtered — a repeated id would otherwise be stored
    // twice, inflating this city's count everywhere it's displayed (the
    // campaign list, Reports, the map banner) and double-counting the same
    // property in the "most shortlisted" aggregate.
    const kept = [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)))];
    if (kept.length > 0) cleaned[cityId] = kept;
  }
  return cleaned;
}

// A campaign from a shortlist that already exists as data rather than a
// sheet — what the AI Assistant's "Create campaign" button sends.
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const clientName = typeof req.body?.clientName === "string" ? req.body.clientName.trim() : "";
  const campaignName = typeof req.body?.campaignName === "string" ? req.body.campaignName.trim() : "";
  if (!clientName || !campaignName) {
    res.status(400).json({ error: "Client name and campaign name are required" });
    return;
  }
  const selections = cleanSelections(req.body?.selections);
  if (Object.keys(selections).length === 0) {
    res.status(400).json({ error: "No known properties in this shortlist" });
    return;
  }
  const record = await insertCampaign({ clientName, campaignName, selections });
  res.json({ campaignId: record.id, shareUrl: `/campaign/${record.id}` });
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

// A map picture of one city's shortlist for the campaign PDF: Google's
// Static Maps image with a blue pin on every shortlisted property, framed
// to fit them all. Fetched here rather than in the browser because the PDF
// needs the image bytes, and Google doesn't allow cross-origin reads of
// them. Needs the Maps Static API enabled on the key's Google Cloud project
// — until it is, this answers 502 and the PDF simply leaves the map out.
const STATIC_MAP_MAX_MARKERS = 600; // keeps the URL well inside Google's 16 KB limit

router.get<{ id: string }>("/:id/map-snapshot.png", requireAuth, async (req, res) => {
  const cityId = req.query.city as string;
  if (!(SUPPORTED_CITIES as readonly string[]).includes(cityId)) {
    res.status(400).json({ error: "Unknown city" });
    return;
  }
  const campaign = await getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) {
    res.status(502).json({ error: "Maps key not configured" });
    return;
  }
  const wanted = new Set(campaign.selections?.[cityId] ?? []);
  const seen = new Set<string>();
  const points: string[] = [];
  for (const f of getCityFeatures(cityId as CityId)) {
    const id = f.properties.mediaSiteId;
    if (!id || !wanted.has(id) || seen.has(id)) continue;
    seen.add(id);
    const [lng, lat] = f.geometry.coordinates;
    points.push(`${lat.toFixed(5)},${lng.toFixed(5)}`);
    if (points.length >= STATIC_MAP_MAX_MARKERS) break;
  }
  if (points.length === 0) {
    res.status(404).json({ error: "No properties in this city" });
    return;
  }
  // Pins get smaller as the shortlist grows, so a 100-property map stays
  // readable instead of becoming one blue blob.
  const size = points.length > 80 ? "tiny" : points.length > 30 ? "small" : "mid";
  const params = new URLSearchParams({ size: "640x400", scale: "2", maptype: "roadmap", key });
  params.append("markers", `color:0x2563eb|size:${size}|${points.join("|")}`);
  // Hide Google's own business pins so only the shortlist stands out.
  params.append("style", "feature:poi|visibility:off");
  try {
    const upstream = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, {
      headers: { Referer: `${req.protocol}://${req.get("host")}/` },
    });
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) {
      const detail = (await upstream.text()).slice(0, 200);
      console.error(`[map-snapshot] Static Maps ${upstream.status}: ${detail}`);
      res.status(502).json({ error: "Map image unavailable", detail });
      return;
    }
    res.set("Content-Type", type);
    res.set("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).json({ error: "Map image unavailable" });
  }
});

router.get<{ id: string }>("/:id", async (req, res) => {
  const record = await getCampaign(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  // Counts as the client opening their link only without a sales login:
  // the Campaigns tab loads campaigns through this same route, and a rep
  // checking their own link shouldn't look like the client did. Link
  // previews (WhatsApp, email) never get here — they fetch the page, not
  // this API, which only runs once the app itself is loaded in a browser.
  // The client's page re-reads the campaign every few seconds to pick up
  // the team's decisions (?poll=1); those reads aren't fresh opens.
  if (!req.session?.loggedIn && req.query.poll !== "1") await recordCampaignView(record.id);
  res.json({ clientName: record.clientName, campaignName: record.campaignName, selections: record.selections, review: record.review ?? null });
});

// The client's review, saved from the share link — public, like the link
// itself. The page sends the whole review every time (it autosaves as the
// client clicks), so this replaces rather than merges. Only ids actually on
// the shortlist are kept, and every text field is length-capped, since
// anyone holding the link can call this.
const MAX_COMMENT_CHARS = 1000;
const MAX_NAME_CHARS = 80;

router.put<{ id: string }>("/:id/review", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const onShortlist = new Set(Object.values(campaign.selections ?? {}).flat());
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const removedIn: unknown = req.body?.removed;
  const removed = Array.isArray(removedIn)
    ? [...new Set(removedIn.filter((id): id is string => typeof id === "string" && onShortlist.has(id)))]
    : [];
  // Additions: real inventory in one of the campaign's own cities (the only
  // cities the client's map shows), and not already on the shortlist.
  const added: Record<string, string[]> = {};
  const addedIn: unknown = req.body?.added;
  if (addedIn && typeof addedIn === "object") {
    for (const cityId of SUPPORTED_CITIES) {
      const ids = (addedIn as Record<string, unknown>)[cityId];
      if (!Array.isArray(ids) || !campaign.selections?.[cityId]?.length) continue;
      const known = getKnownMediaSiteIds(cityId);
      const kept = [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id) && !onShortlist.has(id)))];
      if (kept.length > 0) added[cityId] = kept;
    }
  }
  const commentable = new Set([...onShortlist, ...Object.values(added).flat()]);
  const comments: Record<string, string> = {};
  const commentsIn: unknown = req.body?.comments;
  if (commentsIn && typeof commentsIn === "object") {
    for (const [id, value] of Object.entries(commentsIn as Record<string, unknown>)) {
      const comment = text(value, MAX_COMMENT_CHARS);
      if (commentable.has(id) && comment) comments[id] = comment;
    }
  }

  const approving = req.body?.status === "approved";
  const now = new Date().toISOString();
  const review: CampaignReview = {
    removed,
    added,
    comments,
    status: approving ? "approved" : "in_review",
    // Re-sending an already-approved review (the page saving again with
    // nothing changed) keeps the original sign-off time.
    approvedAt: approving ? (campaign.review?.status === "approved" ? campaign.review.approvedAt : now) : null,
    approvedBy: approving ? text(req.body?.approvedBy, MAX_NAME_CHARS) || null : null,
    note: text(req.body?.note, MAX_COMMENT_CHARS) || null,
    updatedAt: now,
  };
  // The team's earlier answers are theirs, not the client's to resend:
  // kept for requests the client still makes, dropped for ones withdrawn.
  const stillAsked = new Set([...removed, ...Object.values(added).flat()]);
  const resolved = Object.fromEntries(Object.entries(campaign.review?.resolved ?? {}).filter(([id]) => stillAsked.has(id)));
  if (Object.keys(resolved).length > 0) review.resolved = resolved;
  await saveCampaignReview(campaign.id, review);
  res.json({ review });
});

// The sales team answering the client's requests. Accepted removals leave
// the shortlist and accepted additions join it; declined ones are only
// recorded. Either way the request stops counting as pending.
router.put<{ id: string }>("/:id/review/decisions", requireAuth, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign?.review) {
    res.status(404).json({ error: "No client review on this campaign" });
    return;
  }
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const accept = new Set(ids(req.body?.accept));
  const decline = new Set(ids(req.body?.decline));
  const review = { ...campaign.review, resolved: { ...(campaign.review.resolved ?? {}) } };
  const selections: CampaignSelections = Object.fromEntries(Object.entries(campaign.selections ?? {}).map(([c, v]) => [c, [...v]]));
  const removedSet = new Set(review.removed);
  let changed = false;

  for (const id of accept) {
    if (removedSet.has(id)) {
      for (const city of Object.keys(selections)) {
        const kept = selections[city].filter((x) => x !== id);
        if (kept.length !== selections[city].length) changed = true;
        if (kept.length > 0) selections[city] = kept;
        else delete selections[city];
      }
      review.resolved[id] = "accepted";
      continue;
    }
    const city = Object.entries(review.added ?? {}).find(([, list]) => list.includes(id))?.[0];
    if (city && !selections[city]?.includes(id) && getKnownMediaSiteIds(city as CityId).has(id)) {
      selections[city] = [...(selections[city] ?? []), id];
      review.resolved[id] = "accepted";
      changed = true;
    }
  }
  for (const id of decline) {
    if (removedSet.has(id) || Object.values(review.added ?? {}).flat().includes(id)) review.resolved[id] = "declined";
  }
  if (Object.keys(selections).length === 0) {
    res.status(400).json({ error: "That would leave the shortlist empty — edit it instead" });
    return;
  }
  if (changed) await updateCampaignSelections(campaign.id, selections);
  await saveCampaignReview(campaign.id, review);
  res.json({ selections, review });
});

// Time the client link spent on screen, reported by the page in small
// slices (see ClientCampaignView). Each slice is capped so one bad or
// tampered request can't add hours; a real slice is at most ~30 seconds.
const MAX_VIEW_SLICE_SECONDS = 60;

router.post<{ id: string }>("/:id/view-time", async (req, res) => {
  const seconds = Number(req.body?.seconds);
  if (!req.session?.loggedIn && Number.isFinite(seconds) && seconds > 0) {
    await addCampaignViewTime(req.params.id, Math.min(Math.round(seconds), MAX_VIEW_SLICE_SECONDS));
  }
  res.status(204).end();
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
  const cleaned = cleanSelections(body);
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
