import "./MapLegend.css";

// A compact legend instead of a paragraph of prose — a client scanning the
// map for the first time should be able to tell what a color means at a
// glance, not read a caption to find out.
export default function MapLegend({
  highlightLabel,
  showInventory,
  onToggleInventory,
}: {
  highlightLabel?: string;
  showInventory: boolean;
  onToggleInventory: () => void;
}) {
  return (
    <div className="map-legend">
      {highlightLabel && (
        <div className="map-legend-row">
          <span className="map-legend-dot map-legend-dot-highlight" />
          <span>{highlightLabel}'s shortlist</span>
        </div>
      )}
      <button
        type="button"
        className={"map-legend-row map-legend-row-toggle" + (showInventory ? "" : " is-off")}
        onClick={onToggleInventory}
        aria-pressed={showInventory}
        title={showInventory ? "Hide the rest of Adonmo's inventory" : "Show the rest of Adonmo's inventory"}
      >
        <span className="map-legend-dot map-legend-dot-default" />
        <span>Adonmo inventory</span>
        <span className="map-legend-toggle-state">{showInventory ? "Shown" : "Hidden"}</span>
      </button>
      <p className="map-legend-note">Google Maps 3D tiles (alpha) — not a production Google Maps feature yet.</p>
    </div>
  );
}
