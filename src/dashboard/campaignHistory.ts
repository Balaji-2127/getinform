import { CITIES } from "../data/cities";

export type CampaignListItem = {
  id: string;
  clientName: string;
  campaignName: string;
  createdAt: string;
  counts: Record<string, number>;
};

export type ClientGroup = {
  clientName: string;
  campaigns: CampaignListItem[];
  totalProperties: number;
  cities: string[];
  lastCreatedAt: string;
};

export function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

export function fetchCampaigns(): Promise<CampaignListItem[]> {
  return fetch("/api/campaigns")
    .then((r) => (r.ok ? (r.json() as Promise<CampaignListItem[]>) : []))
    .catch(() => []);
}

// Built entirely from real campaign history (GET /api/campaigns, the same
// endpoint the upload page's "Past campaigns" list already uses) — no
// fabricated client-relationship or CRM data, just campaigns grouped by
// the client name a rep typed in at upload time. Shared by ClientsPage
// and the Dashboard home page's "Top clients" widget.
export function groupByClient(campaigns: CampaignListItem[]): ClientGroup[] {
  const groups: ClientGroup[] = [];
  const byKey = new Map<string, ClientGroup>();

  for (const c of campaigns) {
    const key = c.clientName.trim().toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { clientName: c.clientName, campaigns: [], totalProperties: 0, cities: [], lastCreatedAt: c.createdAt };
      byKey.set(key, group);
      groups.push(group);
    }
    group.campaigns.push(c);
    if (c.createdAt > group.lastCreatedAt) group.lastCreatedAt = c.createdAt;
    for (const [city, count] of Object.entries(c.counts)) {
      group.totalProperties += count;
      if (count > 0 && !group.cities.includes(city)) group.cities.push(city);
    }
  }

  groups.sort((a, b) => (a.lastCreatedAt < b.lastCreatedAt ? 1 : -1));
  for (const g of groups) g.campaigns.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return groups;
}
