import { CITIES, type City, type CityId } from "./data/cities";
import "./CitySidebar.css";

export default function CitySidebar({
  activeCity,
  onSelect,
  cities = CITIES,
  hideBrand,
}: {
  activeCity: CityId;
  onSelect: (id: CityId) => void;
  // A campaign only ever covers some cities — picking one with nothing
  // shortlisted in it would just show an empty, unhighlighted map, so
  // MapExperience scopes this down to the campaign's own cities instead
  // of always offering all four. Defaults to every city for the plain,
  // no-campaign case.
  cities?: City[];
  // The dashboard's embedded view already has its own header with the
  // Adonmo logo — this drops the redundant logo/name block there, keeping
  // just the functional city-switch buttons (still needed for a
  // multi-city campaign, unlike the old blanket hide-the-whole-thing
  // behavior this replaced).
  hideBrand?: boolean;
}) {
  return (
    <div className="city-sidebar">
      {!hideBrand && (
        <>
          <div className="city-sidebar-brand">
            <img src="/adonmo-logo.jpeg" alt="" className="city-sidebar-logo" />
            <h1>ADONMO</h1>
          </div>
          <p className="city-sidebar-sub">Residential screen inventory</p>
        </>
      )}
      <nav>
        {cities.map((c) => (
          <button
            key={c.id}
            type="button"
            className={"city-button" + (c.id === activeCity ? " is-active" : "")}
            onClick={() => onSelect(c.id)}
          >
            {c.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
