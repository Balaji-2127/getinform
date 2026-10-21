import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { SUPPORTED_CITIES, getCityFeatures, type CityId, type ScreenFeature } from "../inventoryLookup.js";

const router = Router();

// The AI Assistant turns a sales rep's plain-English brief ("40 societies in
// Gachibowli and Kondapur, 500+ households, under 10 lakh a month") into a
// real shortlist. Gemini only ever reads the brief and writes a filter — it
// never picks properties itself. Every property returned comes from the
// inventory files by ordinary filtering and ranking below, so nothing in a
// plan can be invented, and the same brief always gives the same shortlist.

const CITY_LABELS: Record<CityId, string> = {
  bengaluru: "Bengaluru (Bangalore)",
  hyderabad: "Hyderabad (incl. Secunderabad, Cyberabad)",
  mumbai: "Mumbai (incl. Thane, Navi Mumbai)",
  ncr: "NCR (Delhi, Gurgaon/Gurugram, Noida, Greater Noida, Faridabad, Ghaziabad)",
  ahmedabad: "Ahmedabad",
  bhuvaneshwar: "Bhubaneswar",
  chennai: "Chennai",
  coimbatore: "Coimbatore",
  indore: "Indore",
  jaipur: "Jaipur",
  kochi: "Kochi (Cochin)",
  kolkata: "Kolkata",
  lucknow: "Lucknow",
  pune: "Pune (incl. Pimpri-Chinchwad)",
  tirupati: "Tirupati",
  chandigarh: "Chandigarh (incl. Mohali, Panchkula)",
  kanpur: "Kanpur",
  nellore: "Nellore",
  surat: "Surat",
  vijaywada: "Vijayawada",
  vishakapatnam: "Visakhapatnam (Vizag)",
};

const SORTS = ["reach", "value", "households", "premium", "cheapest"] as const;
type SortBy = (typeof SORTS)[number];

export type PlanSpec = {
  cities: CityId[];
  areas: string[];
  minHouseholds: number | null;
  minScreens: number | null;
  maxBudgetPerProperty: number | null;
  totalBudget: number | null;
  maxProperties: number | null;
  minPropertyValueCr: number | null;
  maxBuildingAge: number | null;
  sortBy: SortBy;
};

// When a brief gives neither a count nor a budget, a plan still needs a
// sensible size — big enough to be a real pitch, small enough to review.
const DEFAULT_PLAN_SIZE = 25;
const MAX_PLAN_SIZE = 500;

// ---- Gemini -------------------------------------------------------------------

async function gemini<T>(prompt: string, schema: object): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AssistantError("The AI Assistant isn't configured on this server (GEMINI_API_KEY is missing).");
  const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
  let lastError = "";
  // Two tries: Gemini occasionally answers 429/5xx under load.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema },
      }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      try {
        return JSON.parse(text) as T;
      } catch {
        lastError = "unreadable response";
      }
    } else {
      lastError = res ? `HTTP ${res.status}` : "network error";
      if (res && res.status < 500 && res.status !== 429) break;
    }
  }
  console.error(`[assistant] Gemini failed: ${lastError}`);
  throw new AssistantError("The AI service didn't respond properly — try again in a moment.");
}

class AssistantError extends Error {}

const nullableNumber = { type: "number", nullable: true };

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    clarification: { type: "string", nullable: true },
    spec: {
      type: "object",
      properties: {
        cities: { type: "array", items: { type: "string", enum: [...SUPPORTED_CITIES] } },
        areas: { type: "array", items: { type: "string" } },
        minHouseholds: nullableNumber,
        minScreens: nullableNumber,
        maxBudgetPerProperty: nullableNumber,
        totalBudget: nullableNumber,
        maxProperties: nullableNumber,
        minPropertyValueCr: nullableNumber,
        maxBuildingAge: nullableNumber,
        sortBy: { type: "string", enum: [...SORTS] },
      },
      required: ["cities", "areas", "sortBy"],
    },
  },
  required: ["reply", "spec"],
};

function specPrompt(message: string, previous: PlanSpec | null): string {
  return `You help sales reps at Adonmo, which sells ads on digital screens inside residential apartment societies in India. Turn the rep's request into a search filter over Adonmo's property inventory.

Each property (a residential society) has: city, locality, zone, number of screens, households, impressions per month, monthly ad budget in rupees (the price of advertising there for a month), property value in crore (how premium the homes are), and building age in years.

Cities available (use these ids exactly):
${SUPPORTED_CITIES.map((id) => `- ${id}: ${CITY_LABELS[id]}`).join("\n")}

Rules:
- "spec.cities": the city ids the request is about. Infer the city from well-known localities and landmarks even when the city isn't named (Kondapur, Gachibowli, Hitech City -> hyderabad; Whitefield, Koramangala -> bengaluru; Andheri, Powai -> mumbai; Gurgaon, Noida -> ncr; Hinjewadi, Baner -> pune). Empty only if no city can be inferred at all.
- "spec.areas": neighbourhoods, localities, zones or landmarks named in the request, exactly as written (e.g. "Gachibowli", "near Hitech City" -> "Hitech City", "Whitefield"). Empty means the whole city.
- Money: 1 lakh = 100000, 1 crore = 10000000; "10L" = 1000000; "5k" = 5000. All budgets are per month in rupees.
- "totalBudget": the total monthly spend for the whole shortlist. "maxBudgetPerProperty": a cap on any single property's monthly cost.
- "maxProperties": how many properties/societies they want. Null if not stated.
- "minPropertyValueCr": use for words like premium, luxury, affluent, high-end, HNI (luxury ~ 3+, premium/affluent ~ 1.5+). Otherwise null.
- "maxBuildingAge": for "new", "newly built" (~5) etc. Otherwise null.
- "sortBy": "reach" (most impressions — default), "value" (most impressions per rupee: cost-effective, best value, efficient), "households" (biggest societies, most families), "premium" (most affluent), "cheapest" (lowest cost).
- If this is a follow-up, start from the previous filter and change only what the new message asks for (e.g. "make it 30", "drop Kondapur", "only premium ones", "also add Pune").
- "reply": one or two short, friendly sentences saying what you'll search for, in plain English. Never state counts, totals or property names — the system computes those.
- "clarification": a short question only if the request is not about finding properties at all or no city can be inferred; otherwise null.

${previous ? `Previous filter (this is a follow-up):\n${JSON.stringify(previous)}\n\n` : ""}Rep's message:
${message}`;
}

// ---- matching areas to the inventory --------------------------------------------

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchesArea(f: ScreenFeature, area: string): boolean {
  const a = norm(area);
  if (!a) return false;
  const p = f.properties;
  return [p.locality, p.zone, p.name].some((field) => {
    const v = norm(field);
    return v.length > 0 && (v.includes(a) || (v.length >= 4 && a.includes(v)));
  });
}

// Areas the inventory has no exact match for ("Hitech City", "near the
// airport") go back to Gemini with the city's real locality names, to be
// mapped onto the ones that cover that area.
async function mapUnknownAreas(unknown: string[], cities: CityId[]): Promise<Record<string, string[]>> {
  const localities = new Set<string>();
  for (const c of cities) {
    for (const f of getCityFeatures(c)) {
      if (f.properties.locality) localities.add(`${f.properties.locality}${f.properties.zone ? ` (${f.properties.zone})` : ""}`);
    }
  }
  const known = [...localities].sort();
  const result = await gemini<{ mappings: { area: string; localities: string[] }[] }>(
    `A sales rep asked for properties in these areas of ${cities.map((c) => CITY_LABELS[c]).join(", ")}: ${JSON.stringify(unknown)}.
None of them is spelled like a locality in our inventory. For each one, list the localities from the list below that are in or immediately around it (at most 8, closest first). Use the exact text before any parenthesis. If an area is genuinely not near any of them, return an empty list for it.

Known localities (zone in parentheses):
${known.join("\n")}`,
    {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: { area: { type: "string" }, localities: { type: "array", items: { type: "string" } } },
            required: ["area", "localities"],
          },
        },
      },
      required: ["mappings"],
    },
  );
  const knownLocalities = new Set([...localities].map((l) => norm(l.replace(/\s*\(.*\)$/, ""))));
  const out: Record<string, string[]> = {};
  for (const m of result.mappings ?? []) {
    const original = unknown.find((u) => norm(u) === norm(m.area)) ?? m.area;
    // Only names that really exist — a model's guess at a locality we don't
    // have would otherwise silently match nothing.
    out[original] = (m.localities ?? []).filter((l) => knownLocalities.has(norm(l))).slice(0, 8);
  }
  return out;
}

// ---- building the shortlist -----------------------------------------------------

function cleanSpec(raw: Partial<PlanSpec> | undefined): PlanSpec {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const cities = Array.isArray(raw?.cities) ? raw.cities.filter((c): c is CityId => (SUPPORTED_CITIES as readonly string[]).includes(c)) : [];
  return {
    cities: [...new Set(cities)],
    areas: Array.isArray(raw?.areas) ? raw.areas.filter((a): a is string => typeof a === "string" && a.trim() !== "").map((a) => a.trim()).slice(0, 20) : [],
    minHouseholds: num(raw?.minHouseholds),
    minScreens: num(raw?.minScreens),
    maxBudgetPerProperty: num(raw?.maxBudgetPerProperty),
    totalBudget: num(raw?.totalBudget),
    maxProperties: num(raw?.maxProperties) ? Math.min(Math.round(raw!.maxProperties!), MAX_PLAN_SIZE) : null,
    minPropertyValueCr: num(raw?.minPropertyValueCr),
    maxBuildingAge: num(raw?.maxBuildingAge),
    sortBy: SORTS.includes(raw?.sortBy as SortBy) ? (raw!.sortBy as SortBy) : "reach",
  };
}

type PlanItem = {
  cityId: CityId;
  mediaSiteId: string;
  name: string;
  locality: string | null;
  zone: string | null;
  households: number;
  screens: number;
  impressions: number;
  budget: number;
  valueCr: number | null;
};

function score(item: PlanItem, sortBy: SortBy): number {
  switch (sortBy) {
    case "value":
      return item.budget > 0 ? item.impressions / item.budget : 0;
    case "households":
      return item.households;
    case "premium":
      return item.valueCr ?? 0;
    case "cheapest":
      return -item.budget;
    default:
      return item.impressions;
  }
}

function buildPlan(spec: PlanSpec, areaTerms: Map<string, string[]>) {
  const candidates: PlanItem[] = [];
  // A few properties appear more than once in the inventory files under the
  // same id; the first row stands for each, as elsewhere in the app.
  const seen = new Set<string>();
  for (const cityId of spec.cities) {
    for (const f of getCityFeatures(cityId)) {
      const p = f.properties;
      if (!p.mediaSiteId || seen.has(p.mediaSiteId)) continue;
      seen.add(p.mediaSiteId);
      if (spec.areas.length > 0 && !spec.areas.some((a) => (areaTerms.get(a) ?? [a]).some((term) => matchesArea(f, term)))) continue;
      if (spec.minHouseholds && (p.households ?? 0) < spec.minHouseholds) continue;
      if (spec.minScreens && (p.screens ?? 0) < spec.minScreens) continue;
      if (spec.maxBudgetPerProperty && (p.monthlyAdBudget ?? Infinity) > spec.maxBudgetPerProperty) continue;
      if (spec.minPropertyValueCr && (p.priceCr ?? 0) < spec.minPropertyValueCr) continue;
      if (spec.maxBuildingAge && (p.buildingAge ?? Infinity) > spec.maxBuildingAge) continue;
      candidates.push({
        cityId,
        mediaSiteId: p.mediaSiteId,
        name: p.name ?? p.mediaSiteId,
        locality: p.locality,
        zone: p.zone,
        households: p.households ?? 0,
        screens: p.screens ?? 0,
        impressions: p.impressionsPerMonth ?? 0,
        budget: p.monthlyAdBudget ?? 0,
        valueCr: p.priceCr,
      });
    }
  }

  // With a total budget and plain "most reach", the reach the budget can
  // buy is what matters, so properties are picked by impressions per rupee.
  // Picking the biggest first would spend the budget on two or three
  // expensive societies and leave the rest of it unusable.
  const pickBy: SortBy = spec.totalBudget && spec.sortBy === "reach" ? "value" : spec.sortBy;
  candidates.sort((a, b) => score(b, pickBy) - score(a, pickBy) || a.name.localeCompare(b.name));
  const limit = spec.maxProperties ?? (spec.totalBudget ? MAX_PLAN_SIZE : DEFAULT_PLAN_SIZE);
  const items: PlanItem[] = [];
  let spent = 0;
  for (const c of candidates) {
    if (items.length >= limit) break;
    // A property that would go over budget is skipped rather than ending
    // the plan: a cheaper one further down may still fit.
    if (spec.totalBudget && spent + c.budget > spec.totalBudget) continue;
    items.push(c);
    spent += c.budget;
  }
  // Shown in the order asked for, whatever order they were picked in.
  items.sort((a, b) => score(b, spec.sortBy) - score(a, spec.sortBy) || a.name.localeCompare(b.name));

  const totals = items.reduce(
    (t, i) => ({
      properties: t.properties + 1,
      screens: t.screens + i.screens,
      households: t.households + i.households,
      impressions: t.impressions + i.impressions,
      budget: t.budget + i.budget,
    }),
    { properties: 0, screens: 0, households: 0, impressions: 0, budget: 0 },
  );
  return { items, totals, candidateCount: candidates.length };
}

// ---- routes ---------------------------------------------------------------------

router.post("/assistant/plan", requireAuth, async (req: Request, res: Response) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 2000) : "";
  if (!message) {
    res.status(400).json({ error: "Type what you're looking for" });
    return;
  }
  const previous = req.body?.previous ? cleanSpec(req.body.previous) : null;

  try {
    const parsed = await gemini<{ reply?: string; clarification?: string | null; spec?: Partial<PlanSpec> }>(specPrompt(message, previous), SPEC_SCHEMA);
    const spec = cleanSpec(parsed.spec);
    if (spec.cities.length === 0) {
      res.json({
        reply: parsed.clarification || parsed.reply || "Which city should I look in?",
        needsCity: true,
        spec,
      });
      return;
    }

    // Each requested area -> the terms it's matched by: itself if the
    // inventory knows it, otherwise the nearby localities Gemini maps it to.
    const areaTerms = new Map<string, string[]>();
    const unknown: string[] = [];
    for (const area of spec.areas) {
      const known = spec.cities.some((c) => getCityFeatures(c).some((f) => matchesArea(f, area)));
      if (known) areaTerms.set(area, [area]);
      else unknown.push(area);
    }
    const mappedAreas: { area: string; localities: string[] }[] = [];
    if (unknown.length > 0) {
      const mapped = await mapUnknownAreas(unknown, spec.cities).catch(() => ({}) as Record<string, string[]>);
      for (const area of unknown) {
        const localities = mapped[area] ?? [];
        areaTerms.set(area, localities);
        mappedAreas.push({ area, localities });
      }
    }

    const plan = buildPlan(spec, areaTerms);
    res.json({ reply: parsed.reply ?? "", spec, mappedAreas, ...plan });
  } catch (e) {
    res.status(502).json({ error: e instanceof AssistantError ? e.message : "Something went wrong — try again." });
  }
});

// A short pitch email for a shortlist, written from its real numbers.
router.post("/assistant/pitch", requireAuth, async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const clientName = str(b.clientName);
  if (!clientName) {
    res.status(400).json({ error: "Client name is required" });
    return;
  }
  const facts = {
    client: clientName,
    campaign: str(b.campaignName),
    shareLink: str(b.shareUrl, 500),
    cities: Array.isArray(b.cities) ? b.cities.filter((c: unknown) => typeof c === "string").slice(0, 21) : [],
    topLocalities: Array.isArray(b.localities) ? b.localities.filter((c: unknown) => typeof c === "string").slice(0, 8) : [],
    properties: Number(b.totals?.properties) || 0,
    screens: Number(b.totals?.screens) || 0,
    households: Number(b.totals?.households) || 0,
    impressionsPerMonth: Number(b.totals?.impressions) || 0,
    monthlyBudgetRupees: Number(b.totals?.budget) || 0,
  };
  try {
    const email = await gemini<{ subject: string; body: string }>(
      `Write a short, warm, professional sales email from an Adonmo sales rep to the brand ${clientName}, sharing a shortlist of residential societies for digital screen advertising (Adonmo runs ad screens inside apartment societies, reaching families where they live).

Use only these facts, and write money in Indian style (lakh, crore, ₹ with Indian digit grouping):
${JSON.stringify(facts, null, 2)}

- Under 150 words. Plain text, no markdown. Indian business English.
- Mention the number of societies, households and monthly impressions, the cities and a few localities.
${facts.shareLink ? "- Invite them to open the interactive map at the share link, where they can keep or remove properties, comment, and approve the shortlist." : "- Say an interactive map link will follow."}
- End with a clear next step (a quick call this week) and sign off as "[Your name], Adonmo".`,
      { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] },
    );
    res.json(email);
  } catch (e) {
    res.status(502).json({ error: e instanceof AssistantError ? e.message : "Something went wrong — try again." });
  }
});

export default router;
