import { CITIES, type CityId } from "./data/cities";
import "./CitySidebar.css";

export default function CitySidebar({
  activeCity,
  onSelect,
}: {
  activeCity: CityId;
  onSelect: (id: CityId) => void;
}) {
  return (
    <div className="city-sidebar">
      <div className="city-sidebar-brand">
        <img src="/adonmo-logo.jpeg" alt="" className="city-sidebar-logo" />
        <h1>ADONMO</h1>
      </div>
      <p className="city-sidebar-sub">Residential screen inventory</p>
      <nav>
        {CITIES.map((c) => (
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
