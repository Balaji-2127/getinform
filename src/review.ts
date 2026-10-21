// The client's verdict on a shortlist, made on their share link and read
// back by the sales team. Mirrors server/db.ts's CampaignReview.
export type CampaignReview = {
  // mediaSiteIds the client would drop from the shortlist.
  removed: string[];
  // Properties from the rest of the inventory the client wants on the
  // shortlist, by city: { cityId: mediaSiteId[] }. Missing on older reviews.
  added?: Record<string, string[]>;
  // mediaSiteId -> the client's note on that property.
  comments: Record<string, string>;
  status: "in_review" | "approved";
  approvedAt: string | null;
  approvedBy: string | null;
  // An overall note left when approving.
  note: string | null;
  updatedAt: string;
};

// Counts only, as GET /api/campaigns lists them.
export type CampaignReviewSummary = {
  status: CampaignReview["status"];
  removedCount: number;
  addedCount: number;
  commentCount: number;
  approvedAt: string | null;
  approvedBy: string | null;
};

// What the map needs to show a review: which shortlisted pins to draw as
// removed, and — on the client's link, where they can change it — what to
// call when they do. The sales team's own view passes no callbacks, so the
// property panel shows the client's choices read-only.
export type MapReview = {
  removed: Set<string>;
  // Every city's additions together — ids are unique across cities.
  added: Set<string>;
  comments: Record<string, string>;
  // Who is looking, for the panel's wording ("You removed this" on the
  // client's link, "Client removed this" for the sales team).
  audience: "client" | "team";
  // Set while the shortlist is approved: the client has to choose "Make
  // changes" first, so an approved shortlist can't drift by a stray click.
  locked?: boolean;
  onSetRemoved?: (mediaSiteId: string, removed: boolean) => void;
  onSetAdded?: (cityId: string, mediaSiteId: string, added: boolean) => void;
  onComment?: (mediaSiteId: string, comment: string) => void;
};
