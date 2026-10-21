import { CITIES } from "../data/cities";
import type { CampaignReviewSummary } from "../review";

export type CampaignListItem = {
  id: string;
  clientName: string;
  campaignName: string;
  createdAt: string;
  counts: Record<string, number>;
  // Times the client opened the share link, and total seconds it was on
  // their screen. Sales logins don't count toward either.
  views: number;
  viewSeconds: number;
  // The client's review on their link, or null if they haven't started one.
  review: CampaignReviewSummary | null;
};

// What the client changed that's still waiting to be applied: "1 removed ·
// 2 added · 3 comments", or "" if nothing. Counts only what still differs
// from the shortlist, so it empties once the team applies the changes.
export function reviewChanges(review: CampaignReviewSummary | null): string {
  if (!review) return "";
  const parts = [
    review.removedCount > 0 && `${review.removedCount} removed`,
    review.addedCount > 0 && `${review.addedCount} added`,
    review.commentCount > 0 && `${review.commentCount} ${review.commentCount === 1 ? "comment" : "comments"}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "";
}

// One line for a campaign's review status, for exports: "Approved · 1 added",
// "8 removed · 3 comments", or "" when the client hasn't touched it.
export function reviewLabel(review: CampaignReviewSummary | null): string {
  if (!review) return "";
  const changes = reviewChanges(review);
  if (review.status === "approved") return changes ? `Approved · ${changes}` : "Approved";
  return changes;
}

// "45s", "4m 12s", "1h 05m".
export function formatViewTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

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
