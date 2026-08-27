import { useEffect, useRef, useState } from "react";
import "./Google3DView.css";

const HYDERABAD = { lon: 78.4867, lat: 17.385, height: 400 };

export default function Google3DView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!activeKey || !containerRef.current) return;
    let cancelled = false;
    let viewer: import("cesium").Viewer | undefined;

    setStatus("loading");
    setErrorMsg(null);

    (async () => {
      // Loaded dynamically: Cesium is a big dependency and this view only
      // needs it once someone actually supplies a key.
      const Cesium = await import("cesium");

      if (cancelled || !containerRef.current) return;

      viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        timeline: false,
        animation: false,
        globe: false, // the photorealistic tileset replaces the default globe imagery
      });

      try {
        const tileset = await Cesium.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${activeKey}`,
        );
        if (cancelled) return;
        viewer.scene.primitives.add(tileset);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            HYDERABAD.lon,
            HYDERABAD.lat,
            HYDERABAD.height,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(-20),
            pitch: Cesium.Math.toRadians(-30),
          },
        });
        setStatus("idle");
      } catch (err) {
        if (cancelled) return;
        console.error("[Google3DView] failed to load 3D Tiles:", err);
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Failed to load Google Photorealistic 3D Tiles — check the API key and that the Map Tiles API is enabled.",
        );
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [activeKey]);

  if (!activeKey) {
    return (
      <div className="google3d-gate">
        <div className="google3d-card">
          <h2>Google Photorealistic 3D Tiles</h2>
          <p>
            This renders real building meshes from Google's aerial photogrammetry — no manual
            modeling. It needs your own Google Cloud API key with the{" "}
            <strong>Map Tiles API</strong> enabled and billing turned on; Google's free monthly
            quota covers light testing.
          </p>
          <p className="google3d-note">
            The key is used only in your browser, sent directly to Google — it isn't stored or
            sent anywhere else.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (apiKey.trim()) setActiveKey(apiKey.trim());
            }}
          >
            <input
              type="text"
              placeholder="Paste your Google Maps Platform API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="google3d-input"
            />
            <button type="submit" className="google3d-submit" disabled={!apiKey.trim()}>
              Load 3D Tiles
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {status === "loading" && <div className="google3d-status">Loading photorealistic tiles…</div>}
      {status === "error" && (
        <div className="google3d-status google3d-status-error">
          {errorMsg}
          <button
            type="button"
            className="google3d-retry"
            onClick={() => {
              setActiveKey(null);
              setStatus("idle");
            }}
          >
            Try a different key
          </button>
        </div>
      )}
    </div>
  );
}
