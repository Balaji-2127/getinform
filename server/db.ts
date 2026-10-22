import { randomUUID } from "node:crypto";
import { initializeApp, cert, getApps, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

// { [cityId]: mediaSiteId[] } — only cities that had at least one matched row.
export type CampaignSelections = Record<string, string[]>;

export type CampaignRecord = {
  id: string;
  clientName: string;
  campaignName: string;
  selections: CampaignSelections;
  createdAt: string;
  // How often the client link was opened, and how long it was on screen in
  // total. Only visits without a sales login count (see the campaigns
  // route), so these are the client's numbers, not the rep's. Missing on
  // campaigns nobody has opened yet.
  views?: number;
  viewSeconds?: number;
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

// Both bump a counter in place with FieldValue.increment, so two people
// with the link open at once can't overwrite each other's numbers. A
// missing campaign (deleted while the link was open) is just ignored.
export async function recordCampaignView(id: string): Promise<void> {
  await campaignsCol.doc(id).update({ views: FieldValue.increment(1) }).catch(() => {});
}

export async function addCampaignViewTime(id: string, seconds: number): Promise<void> {
  await campaignsCol.doc(id).update({ viewSeconds: FieldValue.increment(seconds) }).catch(() => {});
}

export async function listCampaigns(): Promise<(Omit<CampaignRecord, "selections"> & { counts: Record<string, number> })[]> {
  const snap = await campaignsCol.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => {
    const data = doc.data() as CampaignFields;
    // Tolerant of a doc without a usable selections map: one malformed
    // record shouldn't throw and take down every page that lists
    // campaigns (the dashboard home, Clients, Reports, global search).
    const counts = Object.fromEntries(
      Object.entries(data.selections ?? {}).map(([city, ids]) => [city, Array.isArray(ids) ? ids.length : 0]),
    );
    return {
      id: doc.id,
      clientName: data.clientName,
      campaignName: data.campaignName,
      createdAt: data.createdAt,
      counts,
      views: data.views ?? 0,
      viewSeconds: data.viewSeconds ?? 0,
    };
  });
}

// Every campaign's full selections — unlike listCampaigns() above (just
// per-city counts), this is what the "most shortlisted properties"
// aggregate (the Shortlists page) needs to actually see which property
// ids repeat across different campaigns.
export async function listCampaignsFull(): Promise<CampaignRecord[]> {
  const snap = await campaignsCol.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => {
    const data = doc.data() as CampaignFields;
    // Same reasoning as listCampaigns' own guard above — callers iterate
    // `selections` directly, so it has to be an object either way.
    return { id: doc.id, ...data, selections: data.selections ?? {} };
  });
}

/**
 * Deletes a campaign.
 *
 * Returns false when there was nothing to delete, so the route can answer
 * 404 rather than reporting success for an id that never existed.
 */
export async function deleteCampaign(id: string): Promise<boolean> {
  const ref = campaignsCol.doc(id);
  if (!(await ref.get()).exists) return false;
  await ref.delete();
  return true;
}
