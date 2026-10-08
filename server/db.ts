import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Defaults to a folder next to the compiled server (fine for local dev,
// where the whole checkout is already persistent) — but a real deploy on
// a host with a persistent disk (Render/Railway/etc.) should point
// DATA_DIR at that disk's mount path instead. Left as a path under the
// build output directory, campaign data would vanish on every redeploy,
// since dist-server itself isn't guaranteed to survive one.
const dataDir = process.env.DATA_DIR ?? path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    selections TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Backs the sidebar's "Recent Searches" — one row per search *result a
// rep actually clicked* (not every keystroke; that would just be noise),
// so this is a real, if small, log of what people went looking for and
// found, not a demo stand-in. No per-user accounts exist in this app
// (everyone shares one login), so this is shared across whoever's using
// it, same as campaigns/clients already are.
db.exec(`
  CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    result_type TEXT NOT NULL,
    result_label TEXT NOT NULL,
    result_sub TEXT,
    city_id TEXT,
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Backs the sidebar's "My Areas" — a rep explicitly starring a locality
// (from Market Insights) to keep an eye on, not a fabricated list.
db.exec(`
  CREATE TABLE IF NOT EXISTS saved_areas (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL,
    locality TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(city_id, locality)
  )
`);

// { [cityId]: mediaSiteId[] } — only cities that had at least one matched row.
export type CampaignSelections = Record<string, string[]>;

export type CampaignRecord = {
  id: string;
  clientName: string;
  campaignName: string;
  selections: CampaignSelections;
  createdAt: string;
};

type CampaignRow = {
  id: string;
  client_name: string;
  campaign_name: string;
  selections: string;
  created_at: string;
};

function rowToRecord(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    clientName: row.client_name,
    campaignName: row.campaign_name,
    selections: JSON.parse(row.selections) as CampaignSelections,
    createdAt: row.created_at,
  };
}

export function insertCampaign(input: {
  clientName: string;
  campaignName: string;
  selections: CampaignSelections;
}): CampaignRecord {
  const record: CampaignRecord = {
    id: randomUUID(),
    clientName: input.clientName,
    campaignName: input.campaignName,
    selections: input.selections,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO campaigns (id, client_name, campaign_name, selections, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(record.id, record.clientName, record.campaignName, JSON.stringify(record.selections), record.createdAt);
  return record;
}

export function getCampaign(id: string): CampaignRecord | null {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
  return row ? rowToRecord(row) : null;
}

// Used by the "edit shortlist" flow (add/remove properties on an existing
// campaign) — replaces the whole selections map rather than patching one
// city at a time, since the caller already has the full updated shape.
export function updateCampaignSelections(id: string, selections: CampaignSelections): CampaignRecord | null {
  const result = db.prepare("UPDATE campaigns SET selections = ? WHERE id = ?").run(JSON.stringify(selections), id);
  if (result.changes === 0) return null;
  return getCampaign(id);
}

export function listCampaigns(): (Omit<CampaignRecord, "selections"> & { counts: Record<string, number> })[] {
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[];
  return rows.map((row) => {
    const record = rowToRecord(row);
    const counts = Object.fromEntries(Object.entries(record.selections).map(([city, ids]) => [city, ids.length]));
    return { id: record.id, clientName: record.clientName, campaignName: record.campaignName, createdAt: record.createdAt, counts };
  });
}

// Every campaign's full selections — unlike listCampaigns() above (just
// per-city counts), this is what the "most shortlisted properties"
// aggregate (the Shortlists page) needs to actually see which property
// ids repeat across different campaigns.
export function listCampaignsFull(): CampaignRecord[] {
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[];
  return rows.map(rowToRecord);
}

export type SearchHistoryEntry = {
  id: string;
  query: string;
  resultType: "campaign" | "property";
  resultLabel: string;
  resultSub: string | null;
  cityId: string | null;
  targetId: string;
  createdAt: string;
};

type SearchHistoryRow = {
  id: string;
  query: string;
  result_type: string;
  result_label: string;
  result_sub: string | null;
  city_id: string | null;
  target_id: string;
  created_at: string;
};

function searchRowToEntry(row: SearchHistoryRow): SearchHistoryEntry {
  return {
    id: row.id,
    query: row.query,
    resultType: row.result_type as "campaign" | "property",
    resultLabel: row.result_label,
    resultSub: row.result_sub,
    cityId: row.city_id,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

export function recordSearch(input: {
  query: string;
  resultType: "campaign" | "property";
  resultLabel: string;
  resultSub?: string | null;
  cityId?: string | null;
  targetId: string;
}): SearchHistoryEntry {
  const entry: SearchHistoryEntry = {
    id: randomUUID(),
    query: input.query,
    resultType: input.resultType,
    resultLabel: input.resultLabel,
    resultSub: input.resultSub ?? null,
    cityId: input.cityId ?? null,
    targetId: input.targetId,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO search_history (id, query, result_type, result_label, result_sub, city_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(entry.id, entry.query, entry.resultType, entry.resultLabel, entry.resultSub, entry.cityId, entry.targetId, entry.createdAt);
  return entry;
}

export function listRecentSearches(limit = 25): SearchHistoryEntry[] {
  const rows = db.prepare("SELECT * FROM search_history ORDER BY created_at DESC LIMIT ?").all(limit) as SearchHistoryRow[];
  return rows.map(searchRowToEntry);
}

export type SavedArea = { id: string; cityId: string; locality: string; createdAt: string };

type SavedAreaRow = { id: string; city_id: string; locality: string; created_at: string };

function savedAreaRowToRecord(row: SavedAreaRow): SavedArea {
  return { id: row.id, cityId: row.city_id, locality: row.locality, createdAt: row.created_at };
}

export function listSavedAreas(): SavedArea[] {
  const rows = db.prepare("SELECT * FROM saved_areas ORDER BY created_at DESC").all() as SavedAreaRow[];
  return rows.map(savedAreaRowToRecord);
}

// Idempotent — starring an already-saved area just returns it rather
// than erroring, since the UI treats this as a plain toggle.
export function saveArea(cityId: string, locality: string): SavedArea {
  const existing = db.prepare("SELECT * FROM saved_areas WHERE city_id = ? AND locality = ?").get(cityId, locality) as SavedAreaRow | undefined;
  if (existing) return savedAreaRowToRecord(existing);
  const record: SavedArea = { id: randomUUID(), cityId, locality, createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO saved_areas (id, city_id, locality, created_at) VALUES (?, ?, ?, ?)").run(record.id, record.cityId, record.locality, record.createdAt);
  return record;
}

export function unsaveArea(cityId: string, locality: string): void {
  db.prepare("DELETE FROM saved_areas WHERE city_id = ? AND locality = ?").run(cityId, locality);
}
