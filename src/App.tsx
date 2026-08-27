import { useState } from "react";
import InventoryMap from "./InventoryMap";
import CitySidebar from "./CitySidebar";
import type { CityId } from "./data/cities";

function App() {
  const [activeCity, setActiveCity] = useState<CityId>("hyderabad");

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <InventoryMap cityId={activeCity} />
      <CitySidebar activeCity={activeCity} onSelect={setActiveCity} />
    </div>
  );
}

export default App;
