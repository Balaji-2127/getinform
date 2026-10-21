import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES, type CityId } from "../data/cities";
import { copyToClipboard } from "../copyToClipboard";
import { useToast } from "./Toast";
import { AiIcon, ArrowRightIcon, CheckIcon, CloseIcon, LinkIcon, PlusIcon } from "./icons";
import "./AssistantPage.css";

type SortBy = "reach" | "value" | "households" | "premium" | "cheapest";

type PlanSpec = {
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

type PlanResponse = {
  reply: string;
  spec: PlanSpec;
  needsCity?: boolean;
  mappedAreas?: { area: string; localities: string[] }[];
  items?: PlanItem[];
  candidateCount?: number;
};

type Turn =
  | { role: "user"; id: number; text: string }
  | { role: "assistant"; id: number; plan: PlanResponse }
  | { role: "error"; id: number; text: string };

const EXAMPLES = [
  "40 societies in Gachibowli and Kondapur with 500+ households",
  "Luxury apartments in Gurgaon, ₹10 lakh a month",
  "Best value for money near Whitefield, 25 properties",
  "Biggest societies in Pune, under ₹40,000 each",
];

const SORT_LABELS: Record<SortBy, string> = {
  reach: "Most impressions",
  value: "Best value",
  households: "Most households",
  premium: "Most premium",
  cheapest: "Lowest cost",
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const cityLabel = (id: string) => CITIES.find((c) => c.id === id)?.label ?? id;

// Describe a brief in plain English, get a real shortlist back. The server
// has Gemini turn the words into filters and then picks the properties from
// the inventory itself, so every row here is a real property with its real
// numbers. Follow-ups ("make it 30", "only premium") refine the last plan.
export default function AssistantPage({ onOpenCampaign }: { onOpenCampaign: (campaignId: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The filter the next message refines — the most recent real plan.
  const lastSpec = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.role === "assistant" && !t.plan.needsCity) return t.plan.spec;
    }
    return null;
  }, [turns]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", id: nextId.current++, text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, previous: lastSpec }),
      });
      const body = (await res.json().catch(() => null)) as (PlanResponse & { error?: string }) | null;
      if (!res.ok || !body) {
        const error = res.status === 401 ? "Your session has expired — log in again." : body?.error ?? "Something went wrong — try again.";
        setTurns((t) => [...t, { role: "error", id: nextId.current++, text: error }]);
      } else {
        setTurns((t) => [...t, { role: "assistant", id: nextId.current++, plan: body }]);
      }
    } catch {
      setTurns((t) => [...t, { role: "error", id: nextId.current++, text: "Couldn't reach the server — check your connection." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="ast-page">
      <div className="ast-header">
        <div>
          <span className="cpg-eyebrow">AI ASSISTANT</span>
          <h1>Describe the campaign, get the shortlist</h1>
          <p>Name the city, areas, budget, audience or size — every property suggested is real inventory with its real numbers.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="ast-btn" onClick={() => setTurns([])} disabled={busy}>
            <PlusIcon size={14} /> New plan
          </button>
        )}
      </div>

      <div className="ast-thread">
        {turns.length === 0 && (
          <div className="ast-empty">
            <span className="ast-empty-icon">
              <AiIcon size={22} />
            </span>
            <p>Try one of these, or write your own:</p>
            <div className="ast-examples">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="ast-example" onClick={() => send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ast-msg is-user">
              {t.text}
            </div>
          ) : t.role === "error" ? (
            <div key={t.id} className="ast-msg is-error">
              {t.text}
            </div>
          ) : (
            <div key={t.id} className="ast-msg is-assistant">
              <p className="ast-reply">{t.plan.reply}</p>
              {!t.plan.needsCity && <PlanCard plan={t.plan} onOpenCampaign={onOpenCampaign} />}
            </div>
          ),
        )}

        {busy && (
          <div className="ast-msg is-assistant ast-thinking" aria-live="polite">
            <span className="ast-dot" />
            <span className="ast-dot" />
            <span className="ast-dot" />
            Finding properties…
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      <form
        className="ast-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={2}
          maxLength={2000}
          placeholder={lastSpec ? "Refine it — e.g. \"make it 30\", \"only premium\", \"add Kondapur\"" : "e.g. 40 societies in Gachibowli with 500+ households, under ₹5 lakh a month"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="ast-btn is-primary" disabled={busy || !input.trim()}>
          Send <ArrowRightIcon size={14} />
        </button>
      </form>
    </div>
  );
}

function PlanCard({ plan, onOpenCampaign }: { plan: PlanResponse; onOpenCampaign: (campaignId: string) => void }) {
  const showToast = useToast();
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ clientName: "", campaignName: "" });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ campaignId: string; clientName: string; campaignName: string } | null>(null);
  const [pitch, setPitch] = useState<{ subject: string; body: string } | null>(null);
  const [pitching, setPitching] = useState(false);

  const { spec } = plan;
  const items = (plan.items ?? []).filter((i) => !dropped.has(i.mediaSiteId));
  const totals = items.reduce(
    (t, i) => ({ screens: t.screens + i.screens, households: t.households + i.households, impressions: t.impressions + i.impressions, budget: t.budget + i.budget }),
    { screens: 0, households: 0, impressions: 0, budget: 0 },
  );
  const multiCity = new Set(items.map((i) => i.cityId)).size > 1;
  const shareUrl = created ? `${window.location.origin}/campaign/${created.campaignId}` : null;

  const chips = [
    spec.cities.map(cityLabel).join(", "),
    spec.areas.length > 0 && spec.areas.join(", "),
    spec.minHouseholds && `${num(spec.minHouseholds)}+ households`,
    spec.minScreens && `${num(spec.minScreens)}+ screens`,
    spec.maxBudgetPerProperty && `≤ ${inr(spec.maxBudgetPerProperty)} each`,
    spec.totalBudget && `${inr(spec.totalBudget)}/mo total`,
    spec.maxProperties && `${num(spec.maxProperties)} properties`,
    spec.minPropertyValueCr && `homes ₹${spec.minPropertyValueCr} Cr+`,
    spec.maxBuildingAge && `≤ ${spec.maxBuildingAge} yrs old`,
    SORT_LABELS[spec.sortBy],
  ].filter(Boolean) as string[];

  const notes: string[] = [];
  for (const m of plan.mappedAreas ?? []) {
    notes.push(
      m.localities.length > 0
        ? `"${m.area}" isn't a locality name in the inventory, so I used the localities around it: ${m.localities.join(", ")}.`
        : `I couldn't find "${m.area}" or anywhere near it in the inventory.`,
    );
  }
  const found = plan.items?.length ?? 0;
  if (spec.maxProperties && found < spec.maxProperties) {
    notes.push(
      (plan.candidateCount ?? 0) < spec.maxProperties
        ? `Only ${plan.candidateCount} ${plan.candidateCount === 1 ? "property matches" : "properties match"} these filters.`
        : `The budget covers ${found} of the ${spec.maxProperties} asked for.`,
    );
  }

  const createCampaign = async () => {
    if (!form.clientName.trim() || !form.campaignName.trim()) return;
    const selections: Record<string, string[]> = {};
    for (const i of items) (selections[i.cityId] ??= []).push(i.mediaSiteId);
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: form.clientName.trim(), campaignName: form.campaignName.trim(), selections }),
      });
      const body = (await res.json().catch(() => null)) as { campaignId?: string; error?: string } | null;
      if (!res.ok || !body?.campaignId) throw new Error(body?.error ?? "Couldn't create the campaign");
      setCreated({ campaignId: body.campaignId, clientName: form.clientName.trim(), campaignName: form.campaignName.trim() });
      setCreating(false);
      showToast("Campaign created");
    } catch (e) {
      showToast((e as Error).message || "Couldn't create the campaign", "error");
    } finally {
      setSaving(false);
    }
  };

  const writePitch = async () => {
    if (!created) return;
    setPitching(true);
    try {
      const localityCounts = new Map<string, number>();
      for (const i of items) if (i.locality) localityCounts.set(i.locality, (localityCounts.get(i.locality) ?? 0) + 1);
      const res = await fetch("/api/assistant/pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: created.clientName,
          campaignName: created.campaignName,
          shareUrl,
          cities: [...new Set(items.map((i) => cityLabel(i.cityId)))],
          localities: [...localityCounts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l),
          totals: { properties: items.length, ...totals },
        }),
      });
      const body = (await res.json().catch(() => null)) as { subject?: string; body?: string; error?: string } | null;
      if (!res.ok || !body?.body) throw new Error(body?.error ?? "Couldn't write the email");
      setPitch({ subject: body.subject ?? "", body: body.body });
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setPitching(false);
    }
  };

  if (found === 0) {
    return (
      <div className="ast-plan">
        <div className="ast-chips">
          {chips.map((c) => (
            <span key={c} className="ast-chip">
              {c}
            </span>
          ))}
        </div>
        {notes.map((n) => (
          <p key={n} className="ast-note">
            {n}
          </p>
        ))}
        <p className="ast-note">No properties match. Try loosening a filter — for example a lower household count or a bigger budget.</p>
      </div>
    );
  }

  return (
    <div className="ast-plan">
      <div className="ast-chips">
        {chips.map((c) => (
          <span key={c} className="ast-chip">
            {c}
          </span>
        ))}
      </div>
      {notes.map((n) => (
        <p key={n} className="ast-note">
          {n}
        </p>
      ))}

      <div className="ast-stats">
        <Stat label="Properties" value={num(items.length)} />
        <Stat label="Screens" value={num(totals.screens)} />
        <Stat label="Households" value={num(totals.households)} />
        <Stat label="Impressions/mo" value={num(totals.impressions)} />
        <Stat label="Budget/mo" value={inr(totals.budget)} />
      </div>

      <div className="ast-table-wrap">
        <table className="ast-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Locality</th>
              {multiCity && <th>City</th>}
              <th className="is-num">Households</th>
              <th className="is-num">Impressions/mo</th>
              <th className="is-num">Budget/mo</th>
              {!created && <th aria-hidden="true" />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.mediaSiteId}>
                <td className="is-strong">{i.name}</td>
                <td className="is-muted">{i.locality ?? "—"}</td>
                {multiCity && <td className="is-muted">{cityLabel(i.cityId)}</td>}
                <td className="is-num">{num(i.households)}</td>
                <td className="is-num">{num(i.impressions)}</td>
                <td className="is-num">{inr(i.budget)}</td>
                {!created && (
                  <td>
                    <button
                      type="button"
                      className="ast-row-remove"
                      title={`Remove ${i.name}`}
                      aria-label={`Remove ${i.name}`}
                      onClick={() => setDropped((d) => new Set(d).add(i.mediaSiteId))}
                    >
                      <CloseIcon size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!created && !creating && (
        <div className="ast-actions">
          <button type="button" className="ast-btn is-primary" disabled={items.length === 0} onClick={() => setCreating(true)}>
            <PlusIcon size={14} /> Create campaign from these {items.length}
          </button>
          {dropped.size > 0 && (
            <button type="button" className="ast-btn" onClick={() => setDropped(new Set())}>
              Undo removals ({dropped.size})
            </button>
          )}
        </div>
      )}

      {creating && (
        <form
          className="ast-create"
          onSubmit={(e) => {
            e.preventDefault();
            void createCampaign();
          }}
        >
          <input
            type="text"
            placeholder="Client name (e.g. Audi)"
            value={form.clientName}
            maxLength={100}
            autoFocus
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          />
          <input
            type="text"
            placeholder="Campaign name (e.g. Q4 launch)"
            value={form.campaignName}
            maxLength={100}
            onChange={(e) => setForm({ ...form, campaignName: e.target.value })}
          />
          <button type="submit" className="ast-btn is-primary" disabled={saving || !form.clientName.trim() || !form.campaignName.trim()}>
            {saving ? "Creating…" : "Create"}
          </button>
          <button type="button" className="ast-btn" disabled={saving} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {created && (
        <div className="ast-created">
          <span className="ast-created-label">
            <CheckIcon size={14} /> Created "{created.clientName} — {created.campaignName}"
          </span>
          <div className="ast-actions">
            <button type="button" className="ast-btn" onClick={() => onOpenCampaign(created.campaignId)}>
              Open campaign <ArrowRightIcon size={13} />
            </button>
            <button
              type="button"
              className="ast-btn"
              onClick={async () => {
                if (shareUrl && (await copyToClipboard(shareUrl))) showToast("Client link copied");
                else showToast("Couldn't copy the link", "error");
              }}
            >
              <LinkIcon size={14} /> Copy client link
            </button>
            <button type="button" className="ast-btn is-primary" disabled={pitching} onClick={writePitch}>
              <AiIcon size={14} /> {pitching ? "Writing…" : pitch ? "Rewrite pitch email" : "Write pitch email"}
            </button>
          </div>
        </div>
      )}

      {pitch && (
        <div className="ast-pitch">
          <div className="ast-pitch-head">
            <strong>Subject: {pitch.subject}</strong>
            <button
              type="button"
              className="ast-btn"
              onClick={async () => {
                if (await copyToClipboard(`Subject: ${pitch.subject}\n\n${pitch.body}`)) showToast("Email copied");
                else showToast("Couldn't copy", "error");
              }}
            >
              Copy email
            </button>
          </div>
          <p className="ast-pitch-body">{pitch.body}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ast-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
