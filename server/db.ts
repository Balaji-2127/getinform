import { randomUUID } from "node:crypto";
import { initializeApp, cert, getApps, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firestore instead of a local SQLite file: this server runs on hosts
// (Render's free tier, etc.) whose filesystem is ephemeral — a container
// restart or redeploy wipes a local database file entirely, with no way
// around it short of a paid plan + attached disk. Firestore is a real
// managed database reached over the network, so persistence doesn't
// depend on which container happens to be running.
function loadServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set — see .env.example / PRODUCTION_SERVICES.md for how to create a Firebase project and generate one.",
    );
  }
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the full downloaded service-account file's contents as one value.");
  }
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

const db = getFirestore();
const campaignsCol = db.collection("campaigns");
const searchHistoryCol = db.collection("searchHistory");
const savedAreasCol = db.collection("savedAreas");

// { [cityId]: mediaSiteId[] } — only cities that had at least one matched row.
export type CampaignSelections = Record<string, string[]>;

export type CampaignRecord = {
  id: string;
  clientName: string;
  campaignName: string;
  selections: CampaignSelections;
  createdAt: string;
};

type CampaignFields = Omit<CampaignRecord, "id">;

export async function insertCampaign(input: {
  clientName: string;
  campaignName: string;
  selections: CampaignSelections;
}): Promise<CampaignRecord> {
  const record: CampaignRecord = {
    id: randomUUID(),
    clientName: input.clientName,
    campaignName: input.campaignName,
    selections: input.selections,
    createdAt: new Date().toISOString(),
  };
  const { id, ...fields } = record;
  await campaignsCol.doc(id).set(fields satisfies CampaignFields);
  return record;
}

export async function getCampaign(id: string): Promise<CampaignRecord | null> {
  const snap = await campaignsCol.doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as CampaignFields) };
}

// Used by the "edit shortlist" flow (add/remove properties on an existing
// campaign) — replaces the whole selections map rather than patching one
// city at a time, since the caller already has the full updated shape.
export async function updateCampaignSelections(id: string, selections: CampaignSelections): Promise<CampaignRecord | null> {
  const ref = campaignsCol.doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ selections });
  return { id: ref.id, ...(snap.data() as CampaignFields), selections };
}

export async function listCampaigns(): Promise<(Omit<CampaignRecord, "selections"> & { counts: Record<string, number> })[]> {
  const snap = await campaignsCol.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => {
    const data = doc.data() as CampaignFields;
    const counts = Object.fromEntries(Object.entries(data.selections).map(([city, ids]) => [city, ids.length]));
    return { id: doc.id, clientName: data.clientName, campaignName: data.campaignName, createdAt: data.createdAt, counts };
  });
}

// Every campaign's full selections — unlike listCampaigns() above (just
// per-city counts), this is what the "most shortlisted properties"
// aggregate (the Shortlists page) needs to actually see which property
// ids repeat across different campaigns.
export async function listCampaignsFull(): Promise<CampaignRecord[]> {
  const snap = await campaignsCol.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as CampaignFields) }));
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

type SearchHistoryFields = Omit<SearchHistoryEntry, "id">;

// Backs the sidebar's "Recent Searches" — one row per search *result a
// rep actually clicked* (not every keystroke; that would just be noise),
// so this is a real, if small, log of what people went looking for and
// found, not a demo stand-in. No per-user accounts exist in this app
// (everyone shares one login), so this is shared across whoever's using it.
export async function recordSearch(input: {
  query: string;
  resultType: "campaign" | "property";
  resultLabel: string;
  resultSub?: string | null;
  cityId?: string | null;
  targetId: string;
}): Promise<SearchHistoryEntry> {
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
  const { id, ...fields } = entry;
  await searchHistoryCol.doc(id).set(fields satisfies SearchHistoryFields);
  return entry;
}

export async function listRecentSearches(limit = 25): Promise<SearchHistoryEntry[]> {
  const snap = await searchHistoryCol.orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as SearchHistoryFields) }));
}

export type SavedArea = { id: string; cityId: string; locality: string; createdAt: string };

type SavedAreaFields = Omit<SavedArea, "id">;

// Backs the sidebar's "My Areas" — a rep explicitly starring a locality
// (from Market Insights) to keep an eye on, not a fabricated list.
export async function listSavedAreas(): Promise<SavedArea[]> {
  const snap = await savedAreasCol.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as SavedAreaFields) }));
}

// Idempotent — starring an already-saved area just returns it rather
// than erroring, since the UI treats this as a plain toggle. Firestore
// has no unique-constraint equivalent to SQL's UNIQUE(city_id, locality),
// so uniqueness is enforced here: look up by both fields first, only
// create a new doc if nothing matched.
export async function saveArea(cityId: string, locality: string): Promise<SavedArea> {
  const existing = await savedAreasCol.where("cityId", "==", cityId).where("locality", "==", locality).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    return { id: doc.id, ...(doc.data() as SavedAreaFields) };
  }
  const record: SavedArea = { id: randomUUID(), cityId, locality, createdAt: new Date().toISOString() };
  const { id, ...fields } = record;
  await savedAreasCol.doc(id).set(fields satisfies SavedAreaFields);
  return record;
}

export async function unsaveArea(cityId: string, locality: string): Promise<void> {
  const snap = await savedAreasCol.where("cityId", "==", cityId).where("locality", "==", locality).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}
