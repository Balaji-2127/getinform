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

export function listCampaigns(): (Omit<CampaignRecord, "selections"> & { counts: Record<string, number> })[] {
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[];
  return rows.map((row) => {
    const record = rowToRecord(row);
    const counts = Object.fromEntries(Object.entries(record.selections).map(([city, ids]) => [city, ids.length]));
    return { id: record.id, clientName: record.clientName, campaignName: record.campaignName, createdAt: record.createdAt, counts };
  });
}
