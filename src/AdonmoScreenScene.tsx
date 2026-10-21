import "./AdonmoScreenScene.css";

// A real-looking moment for the client: a photo of a society lift lobby
// with residents watching an Adonmo screen, and the client's own ad
// playing on it. The photo (public/lobby-screen.jpg) was generated with a
// blank screen; the ad is laid over the screen area in HTML so it can
// carry whichever client is looking, and so the name stays crisp text.

// Where the screen's display area sits in the photo, as fractions of the
// image. Measured from the blank panel in the source image (an
// axis-aligned rectangle: x 386-733, y 277-476 of 1200x896), then grown by
// a few pixels on every side so the overlay also covers the JPEG colour
// bleed at the panel's edge. A new photo means new numbers here.
const SCREEN = { left: 31.8, top: 30.4, width: 29.7, height: 23.3 };

// Picks a font size (in px, at the card's width) and, if it comes to it, a
// shortened label so the client's name always fits the screen. Names
// range from "Ola" to a 40-character legal entity, so neither a fixed size
// nor a fixed character cap works: scale down first, and only cut the name
// once it would otherwise drop below legible. Widths are estimated (Inter
// bold runs ~0.62em per character) rather than measured; the screen clips
// its contents anyway, so an outlier is cropped, never spilling onto the
// bezel.
const SCREEN_TEXT_WIDTH_PX = 70;
function fitBrand(name: string, maxSize: number, minSize: number): { text: string; size: number } {
  const text = name.trim() || "Your brand";
  const perChar = 0.62;
  const size = Math.min(maxSize, SCREEN_TEXT_WIDTH_PX / (text.length * perChar));
  if (size >= minSize) return { text, size };
  const maxChars = Math.floor(SCREEN_TEXT_WIDTH_PX / (minSize * perChar)) - 1;
  return { text: text.slice(0, Math.max(1, maxChars)).trimEnd() + "…", size: minSize };
}

// Just the photo, fixed on the map — no card chrome, caption or close
// button, so it reads as a window into a real lobby rather than a widget.
export default function AdonmoScreenScene({ clientName }: { clientName: string }) {
  const hero = fitBrand(clientName, 12, 7);
  const small = fitBrand(clientName, 8.5, 6);

  return (
    <aside className="screen-scene" aria-label="How your ad looks on an Adonmo screen">
      <div className="screen-scene-photo">
        <img className="screen-scene-art" src="/lobby-screen.jpg" alt="Residents in a lift lobby watching an Adonmo screen" width={800} height={597} />

        {/* The ad, laid exactly over the screen in the photo. */}
        <div
          className="screen-scene-screen"
          style={{ left: `${SCREEN.left}%`, top: `${SCREEN.top}%`, width: `${SCREEN.width}%`, height: `${SCREEN.height}%` }}
          aria-hidden="true"
        >
          <div className="screen-scene-slide is-brand">
            <span className="screen-scene-hero" style={{ fontSize: hero.size }}>
              {hero.text}
            </span>
            <span className="screen-scene-line">Now in your society</span>
          </div>
          <div className="screen-scene-slide is-light">
            <span className="screen-scene-kicker">Say hello to</span>
            <span className="screen-scene-hero" style={{ fontSize: hero.size }}>
              {hero.text}
            </span>
            <span className="screen-scene-cta">Know more</span>
          </div>
          <div className="screen-scene-slide is-dark">
            <span className="screen-scene-qr" />
            <span className="screen-scene-hero" style={{ fontSize: small.size }}>
              {small.text}
            </span>
            <span className="screen-scene-line is-tiny">Scan to know more</span>
          </div>
          {/* A faint sheen so the overlay reads as a lit panel, not a sticker. */}
          <div className="screen-scene-glass" />
        </div>
      </div>
    </aside>
  );
}
