import jsPDF from "jspdf";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";

type PropertyRow = { name: string; locality: string | null; zone: string | null; screens: number; households: number; monthlyAdBudget: number };
type CityGroup = { cityId: CityId; label: string; properties: PropertyRow[] };

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "campaign";
}

// Loads just the campaign's own matched properties per city — same
// lazy-loaded per-city JSON files the map already uses, no new backend
// endpoint needed, since this is already all public (to a logged-in rep)
// data assembled client-side.
async function gatherCampaignProperties(selections: Record<string, string[]>): Promise<CityGroup[]> {
  const groups: CityGroup[] = [];
  for (const city of CITIES) {
    const ids = selections[city.id];
    if (!ids || ids.length === 0) continue;
    const idSet = new Set(ids);
    const fc = await loadCityScreens(city.id);
    const properties: PropertyRow[] = fc.features
      .filter((f) => f.properties.mediaSiteId != null && idSet.has(f.properties.mediaSiteId))
      .map((f) => ({
        name: f.properties.name ?? "Untitled property",
        locality: f.properties.locality,
        zone: f.properties.zone,
        screens: f.properties.screens ?? 0,
        households: f.properties.households ?? 0,
        monthlyAdBudget: f.properties.monthlyAdBudget ?? 0,
      }));
    if (properties.length > 0) groups.push({ cityId: city.id, label: city.label, properties });
  }
  return groups;
}

// A downloadable one-pager (well, however many pages a big shortlist
// needs) for reps who need something to literally email or attach — the
// live share link covers "look at this interactively", this covers "I
// need a file". Built entirely client-side with jsPDF's own text/line
// primitives rather than pulling in a table-layout plugin for what's
// really just a handful of fixed columns.
export async function downloadCampaignPdf(clientName: string, campaignName: string, selections: Record<string, string[]>): Promise<void> {
  const cities = await gatherCampaignProperties(selections);
  const totals = cities.reduce(
    (acc, c) => {
      acc.properties += c.properties.length;
      for (const p of c.properties) {
        acc.screens += p.screens;
        acc.households += p.households;
        acc.budget += p.monthlyAdBudget;
      }
      return acc;
    },
    { properties: 0, screens: 0, households: 0, budget: 0 },
  );

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`${clientName} — ${campaignName}`, margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Campaign shortlist — generated ${new Date().toLocaleDateString()}`, margin, y);
  doc.setTextColor(0);
  y += 26;

  const stats: [string, string][] = [
    ["Properties", totals.properties.toLocaleString()],
    ["Screens", totals.screens.toLocaleString()],
    ["Households", totals.households.toLocaleString()],
    ["Ad budget/mo", `Rs ${totals.budget.toLocaleString()}`],
  ];
  const statWidth = (pageWidth - margin * 2) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = margin + i * statWidth;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(value, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(label, x, y + 14);
    doc.setTextColor(0);
  });
  y += 38;

  const colX = [margin, margin + 190, margin + 330, margin + 400, margin + 470];

  for (const city of cities) {
    ensureSpace(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${city.label} (${city.properties.length})`, margin, y);
    y += 16;

    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Property", colX[0], y);
    doc.text("Locality", colX[1], y);
    doc.text("Screens", colX[2], y);
    doc.text("Households", colX[3], y);
    doc.text("Budget/mo", colX[4], y);
    doc.setTextColor(0);
    y += 6;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;

    doc.setFont("helvetica", "normal");
    for (const p of city.properties) {
      ensureSpace(14);
      doc.text(truncate(p.name, 34), colX[0], y);
      doc.text(truncate(p.locality ?? "—", 24), colX[1], y);
      doc.text(String(p.screens), colX[2], y);
      doc.text(p.households.toLocaleString(), colX[3], y);
      doc.text(`Rs ${p.monthlyAdBudget.toLocaleString()}`, colX[4], y);
      y += 14;
    }
    y += 12;
  }

  doc.save(`${sanitizeFilename(clientName)}-${sanitizeFilename(campaignName)}.pdf`);
}
