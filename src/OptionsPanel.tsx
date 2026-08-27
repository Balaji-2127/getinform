import { useState } from "react";
import "./OptionsPanel.css";

export type OptionId = "overlay" | "google3d" | "custom3d" | "osm";

type Option = {
  id: OptionId;
  label: string;
  recommended?: boolean;
  tagline: string;
  what: string;
  pros: string[];
  cons: string[];
  cost: string;
  effort: string;
  bestFor: string;
};

// Grounded in a live check against OpenStreetMap: a real Hyderabad gated
// community has 351 building footprints, but only 2 carry a height/levels
// tag. That's the actual ceiling on "detail inside a gated community" —
// it's a data problem, not a rendering problem. These options are ranked
// by how directly each one fixes that.
const OPTIONS: Option[] = [
  {
    id: "overlay",
    label: "Your Own Data",
    recommended: true,
    tagline: "Keep MapLibre. Add real tower data per community.",
    what:
      "Add a second GeoJSON layer on top of the current map: real tower footprints, heights, and names for each gated community you track, traced from builder site plans, RERA filings, or satellite imagery.",
    pros: [
      "Fully accurate — real tower heights and names, not guesses",
      "Free, and reuses the MapLibre setup already working",
      "You control clicks/popups — show unit info, price, availability per tower",
      "Fits your existing floor-plan and site-plan work directly",
    ],
    cons: [
      "Manual effort — one community at a time",
      "Doesn't cover communities you haven't traced yet",
    ],
    cost: "$0",
    effort: "Medium — ~30–60 min per community",
    bestFor: "The actual product: accurate views of communities you track",
  },
  {
    id: "google3d",
    label: "Google 3D Tiles",
    tagline: "Real building meshes, generated automatically.",
    what:
      "Google Photorealistic 3D Tiles render actual building shapes from aerial photogrammetry — real silhouettes, not extruded boxes — with zero manual modeling. Needs CesiumJS or deck.gl instead of plain MapLibre.",
    pros: [
      "No manual tracing — coverage generates itself",
      "Real building silhouettes, roofs, and rooftop detail",
      "Visually impressive for flythrough-style views",
    ],
    cons: [
      "Paid beyond a free monthly quota",
      "Coverage/detail is inconsistent in Indian tier-2 suburbs",
      "No per-tower data — can't click and get unit info",
      "Means leaving MapLibre for a heavier globe-based engine",
    ],
    cost: "Free tier, then pay-as-you-go",
    effort: "Medium–high — new rendering engine",
    bestFor: "Visual \"wow\" flythroughs, not per-unit real estate data",
  },
  {
    id: "custom3d",
    label: "Custom 3D Models",
    tagline: "Model the flagship communities properly.",
    what:
      "For the handful of communities that deserve it, build real 3D models (glTF) of each tower and clubhouse — from CAD/architectural plans — and geo-anchor them precisely, rendered with Three.js / react-three-fiber.",
    pros: [
      "Highest possible fidelity — actual tower shapes, amenities, layout",
      "Directly reuses your floor-plan / architectural-plan work",
      "Can support a real walkthrough view, not just a top-down block",
    ],
    cons: [
      "Highest effort — needs real 3D modeling per building",
      "Only realistic for a small number of flagship projects",
      "Separate scene/engine from the main map",
    ],
    cost: "$0 tooling, but real modeling time",
    effort: "High — per flagship community",
    bestFor: "A handful of hero communities, not bulk coverage",
  },
  {
    id: "osm",
    label: "Improve OSM",
    tagline: "Fix it at the source, for good.",
    what:
      "OpenStreetMap is editable by anyone. Trace accurate footprints and add height/building:levels tags for the communities you track, using the iD editor — referencing satellite imagery and known floor counts.",
    pros: [
      "Free and permanent — benefits every tool built on OSM, including this one",
      "No app code changes — flows straight into the existing MapLibre pipeline",
    ],
    cons: [
      "Takes days–weeks to propagate into served vector tiles",
      "Still manual, one building at a time",
      "OSM's tag schema can't hold custom data like price or availability",
    ],
    cost: "$0",
    effort: "Medium — per community, reusable by anyone",
    bestFor: "A background effort alongside Option 1, not a standalone fix",
  },
];

export default function OptionsPanel({
  activeId,
  onChange,
}: {
  activeId: OptionId;
  onChange: (id: OptionId) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = OPTIONS.find((o) => o.id === activeId) ?? OPTIONS[0];

  return (
    <div className="options-panel-root">
      <button
        type="button"
        className="options-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide options" : "Compare options"}
      </button>

      {open && (
        <div className="options-panel" role="region" aria-label="Building-detail options">
          <div className="options-panel-header">
            <h2>Getting real detail inside a gated community</h2>
            <p>
              OSM building data is the ceiling, not the map library. A live check found 351
              building footprints in one Hyderabad community — only 2 had height data. Click a
              tab to see each approach rendered live.
            </p>
          </div>

          <div className="options-tabs" role="tablist">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                role="tab"
                aria-selected={o.id === activeId}
                className={"options-tab" + (o.id === activeId ? " is-active" : "")}
                onClick={() => onChange(o.id)}
              >
                {o.label}
                {o.recommended && <span className="options-tab-badge">Recommended</span>}
              </button>
            ))}
          </div>

          <div className="options-tabpanel" role="tabpanel">
            <p className="options-tagline">{active.tagline}</p>
            <p className="options-what">{active.what}</p>

            <div className="options-grid">
              <div>
                <h3>Pros</h3>
                <ul className="options-pros">
                  {active.pros.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Cons</h3>
                <ul className="options-cons">
                  {active.cons.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="options-meta">
              <div>
                <span className="options-meta-label">Cost</span>
                <span>{active.cost}</span>
              </div>
              <div>
                <span className="options-meta-label">Effort</span>
                <span>{active.effort}</span>
              </div>
              <div>
                <span className="options-meta-label">Best for</span>
                <span>{active.bestFor}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
