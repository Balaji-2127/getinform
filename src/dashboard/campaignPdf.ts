import jsPDF from "jspdf";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";

type PropertyRow = {
  name: string;
  locality: string | null;
  zone: string | null;
  screens: number;
  households: number;
  impressions: number;
  monthlyAdBudget: number;
  // The property's own market value in crore — how premium the homes are.
  priceCr: number | null;
};
type CityGroup = { cityId: CityId; label: string; properties: PropertyRow[] };

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "campaign";
}

// Indian digit grouping (16,37,500). "Rs" rather than "₹": the PDF's
// built-in Helvetica has no rupee glyph and would print a blank box.
const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const rs = (n: number) => `Rs ${num(n)}`;

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
    // A few properties appear more than once in the inventory files under
    // the same id; the first row stands for each, as on the map — otherwise
    // the PDF's count and totals came out higher than the map's.
    const seen = new Set<string>();
    const properties: PropertyRow[] = fc.features
      .filter((f) => {
        const id = f.properties.mediaSiteId;
        if (id == null || !idSet.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((f) => ({
        name: f.properties.name ?? "Untitled property",
        locality: f.properties.locality,
        zone: f.properties.zone,
        screens: f.properties.screens ?? 0,
        households: f.properties.households ?? 0,
        impressions: f.properties.impressionsPerMonth ?? 0,
        monthlyAdBudget: f.properties.monthlyAdBudget ?? 0,
        priceCr: f.properties.priceCr,
      }))
      // Most premium properties first (highest property value), so the
      // most affluent societies lead each city's table. Same value:
      // alphabetical. Properties with no recorded value go last.
      .sort((a, b) => (b.priceCr ?? -1) - (a.priceCr ?? -1) || a.name.localeCompare(b.name));
    if (properties.length > 0) groups.push({ cityId: city.id, label: city.label, properties });
  }
  return groups;
}

type LoadedImage = { dataUrl: string; format: "PNG" | "JPEG"; width: number; height: number };

// An image as a data URL plus its pixel size (to keep its proportions in
// the PDF). Null if it can't be loaded — every logo here is optional.
async function loadImage(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    return { dataUrl, format: blob.type.includes("png") ? "PNG" : "JPEG", ...size };
  } catch {
    return null;
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

// Palette — the app's own indigo, so the PDF reads as the same product.
const INK = "#111827";
const MUTED = "#6b7280";
const BRAND_DEEP = "#312e81";
const BRAND = "#4338ca";
const BRAND_SOFT = "#eef2ff";
const BRAND_LINE = "#c7d2fe";
// The map pins' blue — the same as the shortlist pins on the live map.
const BRAND_PIN = "#2563eb";
const ZEBRA = "#f8fafc";

// A branded proposal-style PDF of the shortlist, for reps who need a file
// to email or attach — the live share link covers "look at this
// interactively", this covers "I need a document". Adonmo's logo on one
// side of the header and the client's on the other; then the headline
// numbers, and a table per city. Built entirely client-side with jsPDF's
// own drawing primitives rather than a table-layout plugin.
export async function downloadCampaignPdf(
  clientName: string,
  campaignName: string,
  selections: Record<string, string[]>,
  shareUrl?: string | null,
  campaignId?: string | null,
): Promise<void> {
  const [cities, adonmoLogo, clientLogo] = await Promise.all([
    gatherCampaignProperties(selections),
    loadImage("/adonmo-logo.jpeg"),
    loadImage(`/api/client-logo-image?name=${encodeURIComponent(clientName)}`),
  ]);
  // One map picture per city, every shortlisted property pinned. Optional:
  // a city whose map can't be fetched just gets its table.
  const maps = new Map<CityId, LoadedImage>();
  if (campaignId) {
    await Promise.all(
      cities.map(async (c) => {
        const img = await loadImage(`/api/campaigns/${campaignId}/map-snapshot.png?city=${c.cityId}`);
        if (img) maps.set(c.cityId, img);
      }),
    );
  }
  const totals = cities.reduce(
    (acc, c) => {
      acc.properties += c.properties.length;
      for (const p of c.properties) {
        acc.screens += p.screens;
        acc.households += p.households;
        acc.impressions += p.impressions;
        acc.budget += p.monthlyAdBudget;
      }
      return acc;
    },
    { properties: 0, screens: 0, households: 0, impressions: 0, budget: 0 },
  );

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const right = pageWidth - margin;
  const footerTop = pageHeight - 34;
  let y = margin;

  // A logo centred in a white rounded tile, or the name's initials when
  // there's no logo to show.
  const logoTile = (img: LoadedImage | null, name: string, x: number, top: number, size: number) => {
    doc.setFillColor("#ffffff");
    doc.roundedRect(x, top, size, size, 10, 10, "F");
    if (img) {
      const pad = size * 0.14;
      const box = size - pad * 2;
      const scale = Math.min(box / img.width, box / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.addImage(img.dataUrl, img.format, x + (size - w) / 2, top + (size - h) / 2, w, h);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size * 0.36);
      doc.setTextColor(BRAND);
      doc.text(initials(name), x + size / 2, top + size / 2 + size * 0.12, { align: "center" });
    }
  };

  // ---- first-page header band ----------------------------------------------
  const bandHeight = 120;
  doc.setFillColor(BRAND_DEEP);
  doc.rect(0, 0, pageWidth, bandHeight, "F");
  // A diagonal sweep of the lighter indigo across the right half — a bit of
  // shape so the band isn't a flat slab.
  doc.setFillColor(BRAND);
  doc.triangle(pageWidth * 0.45, bandHeight, pageWidth, 0, pageWidth, bandHeight, "F");
  doc.setFillColor("#6366f1");
  doc.rect(0, bandHeight, pageWidth, 4, "F");

  const tile = 58;
  const tileTop = (bandHeight - tile) / 2;
  // Adonmo, left.
  logoTile(adonmoLogo, "Adonmo", margin, tileTop, tile);
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("ADONMO", margin + tile + 14, tileTop + 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(BRAND_LINE);
  doc.text("Digital screens in residential communities", margin + tile + 14, tileTop + 42);

  // The client, right.
  logoTile(clientLogo, clientName, right - tile, tileTop, tile);
  const clientTextRight = right - tile - 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(BRAND_LINE);
  doc.text("PREPARED FOR", clientTextRight, tileTop + 16, { align: "right", charSpace: 1 });
  doc.setFontSize(18);
  doc.setTextColor("#ffffff");
  doc.text(truncate(clientName, 22), clientTextRight, tileTop + 38, { align: "right" });

  // ---- title ------------------------------------------------------------------
  y = bandHeight + 44;
  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(truncate(campaignName, 40), margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  const generated = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`Campaign shortlist  ·  ${cities.map((c) => c.label).join(", ")}  ·  ${generated}`, margin, y);
  if (shareUrl) {
    y += 16;
    doc.setTextColor(BRAND);
    doc.setFont("helvetica", "bold");
    doc.textWithLink("View every property on the interactive 3D map  >", margin, y, { url: shareUrl });
  }
  y += 24;

  // ---- headline numbers ------------------------------------------------------
  const stats: [string, string][] = [
    ["Properties", num(totals.properties)],
    ["Screens", num(totals.screens)],
    ["Households", num(totals.households)],
    ["Impressions/mo", num(totals.impressions)],
    ["Ad budget/mo", rs(totals.budget)],
  ];
  const gap = 8;
  const cardWidth = (right - margin - gap * (stats.length - 1)) / stats.length;
  const cardHeight = 56;
  stats.forEach(([label, value], i) => {
    const x = margin + i * (cardWidth + gap);
    const highlight = i === stats.length - 1;
    doc.setFillColor(highlight ? BRAND : BRAND_SOFT);
    doc.roundedRect(x, y, cardWidth, cardHeight, 8, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(value.length > 11 ? 12 : 15);
    doc.setTextColor(highlight ? "#ffffff" : BRAND_DEEP);
    doc.text(value, x + 10, y + 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(highlight ? BRAND_LINE : BRAND);
    doc.text(label.toUpperCase(), x + 10, y + 42, { charSpace: 0.4 });
  });
  y += cardHeight + 30;

  // ---- tables -------------------------------------------------------------------
  // Columns: [header, x, align]. Numbers are right-aligned so their digits
  // line up.
  const cols = {
    rank: { x: margin + 8, align: "left" as const },
    name: { x: margin + 28, align: "left" as const },
    locality: { x: margin + 168, align: "left" as const },
    value: { x: margin + 300, align: "right" as const },
    screens: { x: margin + 348, align: "right" as const },
    households: { x: margin + 410, align: "right" as const },
    budget: { x: right - 8, align: "right" as const },
  };
  const rowHeight = 19;

  const tableHeader = () => {
    doc.setFillColor("#f1f5f9");
    doc.rect(margin, y - 13, right - margin, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    const head: [keyof typeof cols, string][] = [
      ["rank", "#"],
      ["name", "PROPERTY"],
      ["locality", "LOCALITY"],
      ["value", "PROPERTY VALUE"],
      ["screens", "SCREENS"],
      ["households", "HOUSEHOLDS"],
      ["budget", "BUDGET/MO"],
    ];
    for (const [key, label] of head) doc.text(label, cols[key].x, y, { align: cols[key].align, charSpace: 0.3 });
    y += rowHeight;
  };

  // Continuation pages get a slim version of the header band.
  const newPage = (cityLabel: string) => {
    doc.addPage();
    doc.setFillColor(BRAND_DEEP);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor("#ffffff");
    doc.text("ADONMO", margin, 21);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(BRAND_LINE);
    doc.text(truncate(`${clientName} — ${campaignName}`, 60), right, 21, { align: "right" });
    y = 64;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(`${cityLabel} (continued)`, margin, y);
    y += 22;
    tableHeader();
  };

  // Map pictures span the text width; 640x400 source, so 1.6:1.
  const mapWidth = right - margin;
  const mapHeight = Math.round(mapWidth / 1.6);

  for (const city of cities) {
    const map = maps.get(city.cityId);
    // Keep a city's heading (and its map) with at least its first few rows.
    if (y + 34 + (map ? mapHeight + 14 : 0) + 20 + rowHeight * 3 > footerTop) {
      doc.addPage();
      y = margin + 10;
    }
    const cityBudget = city.properties.reduce((s, p) => s + p.monthlyAdBudget, 0);
    doc.setFillColor(BRAND);
    doc.roundedRect(margin, y - 14, 6, 20, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(INK);
    doc.text(city.label, margin + 14, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(MUTED);
    doc.text(
      `${num(city.properties.length)} ${city.properties.length === 1 ? "property" : "properties"}  ·  ${rs(cityBudget)} / month  ·  sorted by property value`,
      right,
      y,
      { align: "right" },
    );
    y += 22;

    if (map) {
      // Rounded corners via a clipped path, then a hairline frame.
      doc.saveGraphicsState();
      doc.roundedRect(margin, y - 14, mapWidth, mapHeight, 8, 8, null);
      doc.clip();
      doc.discardPath();
      doc.addImage(map.dataUrl, map.format, margin, y - 14, mapWidth, mapHeight);
      doc.restoreGraphicsState();
      doc.setDrawColor("#e5e7eb");
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, y - 14, mapWidth, mapHeight, 8, 8, "S");
      // Legend chip on the map.
      doc.setFillColor("#ffffff");
      doc.roundedRect(margin + 10, y - 4, 118, 18, 9, 9, "F");
      doc.setFillColor(BRAND_PIN);
      doc.circle(margin + 20, y + 5, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(INK);
      doc.text(`${truncate(clientName, 14)}'s shortlist`, margin + 28, y + 8);
      y += mapHeight + 14;
    }

    tableHeader();

    city.properties.forEach((p, i) => {
      if (y + rowHeight > footerTop) newPage(city.label);
      if (i % 2 === 1) {
        doc.setFillColor(ZEBRA);
        doc.rect(margin, y - 13, right - margin, rowHeight, "F");
      }
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor("#9ca3af");
      doc.text(String(i + 1), cols.rank.x, y);
      doc.setTextColor(INK);
      doc.setFont("helvetica", "bold");
      doc.text(truncate(p.name, 26), cols.name.x, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor("#374151");
      doc.text(truncate(p.locality ?? "—", 17), cols.locality.x, y);
      doc.text(p.priceCr != null ? `Rs ${p.priceCr} Cr` : "—", cols.value.x, y, { align: "right" });
      doc.text(num(p.screens), cols.screens.x, y, { align: "right" });
      doc.text(num(p.households), cols.households.x, y, { align: "right" });
      doc.setTextColor(INK);
      doc.text(rs(p.monthlyAdBudget), cols.budget.x, y, { align: "right" });
      y += rowHeight;
    });

    // City total.
    if (y + rowHeight > footerTop) newPage(city.label);
    doc.setFillColor(BRAND_SOFT);
    doc.rect(margin, y - 13, right - margin, rowHeight + 2, "F");
    doc.setDrawColor(BRAND_LINE);
    doc.setLineWidth(0.8);
    doc.line(margin, y - 13, right, y - 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(BRAND_DEEP);
    doc.text(`Total — ${city.label}`, cols.name.x, y + 1);
    doc.text(num(city.properties.reduce((s, p) => s + p.screens, 0)), cols.screens.x, y + 1, { align: "right" });
    doc.text(num(city.properties.reduce((s, p) => s + p.households, 0)), cols.households.x, y + 1, { align: "right" });
    doc.text(rs(cityBudget), cols.budget.x, y + 1, { align: "right" });
    y += rowHeight + 28;
  }

  // ---- footer on every page -------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor("#e5e7eb");
    doc.setLineWidth(0.6);
    doc.line(margin, footerTop + 8, right, footerTop + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#9ca3af");
    doc.text("Adonmo  ·  adonmo.live", margin, footerTop + 22);
    doc.text("Figures are monthly estimates from Adonmo's inventory data.", pageWidth / 2, footerTop + 22, { align: "center" });
    doc.text(`Page ${i} of ${pages}`, right, footerTop + 22, { align: "right" });
  }

  doc.save(`${sanitizeFilename(clientName)}-${sanitizeFilename(campaignName)}.pdf`);
}
