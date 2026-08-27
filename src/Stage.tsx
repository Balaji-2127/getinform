import Map3D from "./Map3D";
import Custom3DView from "./Custom3DView";
import Google3DView from "./Google3DView";
import type { OptionId } from "./OptionsPanel";

export default function Stage({ activeId }: { activeId: OptionId }) {
  switch (activeId) {
    case "overlay":
      return <Map3D mode="overlay" />;
    case "osm":
      return <Map3D mode="osmgap" />;
    case "custom3d":
      return <Custom3DView />;
    case "google3d":
      return <Google3DView />;
    default:
      return <Map3D mode="overlay" />;
  }
}
