import { useRef, useState } from "react";
import DemoPlayer, { type DemoPlayerHandle } from "./DemoPlayer";
import { DEMO_CHAPTERS, DEMO_DURATION } from "./demoChapters";
import { PlayIcon } from "./icons";
import "./CampaignsPage.css";
import "./HelpPage.css";

// The product walkthrough plus the questions a rep actually asks on their
// first week. Both live here rather than in a shared doc nobody opens:
// someone who is confused is already inside the app, and this is one click
// away in the sidebar.
//
// The video, its poster and the chapter offsets are all produced by
// video/render.mjs from video/scenes.mjs — see video/README.md. The chapter
// list is generated, so re-cutting the film cannot leave these links
// pointing at the wrong moment.

// `img` is optional on purpose: the "some rows didn't match" question is
// about an error state, and staging a fake failure just to have a picture
// beside it would teach the wrong thing. Text alone is the honest answer.
type Faq = { q: string; a: string; img?: string; alt?: string };

const FAQS: Faq[] = [
  {
    q: "What does this actually do?",
    a: "It turns a client's shortlist into a 3D map they can explore. You upload the same inventory sheet you already work from, and it produces a link showing exactly the properties you've shortlisted for that client, highlighted against the rest of your inventory.",
    img: "/faq/what-it-does.jpg",
    alt: "A campaign on the 3D map: the client's shortlisted properties in blue, the rest of the inventory in green",
  },
  {
    q: "How do I create a campaign?",
    a: "Click \"Upload campaign sheet\" in the sidebar. Enter the client name and campaign name, pick your .xlsx file, and upload. Every row is matched against live inventory by its Media Site Id, and you land straight on the map with the results highlighted.",
    img: "/faq/create-campaign.jpg",
    alt: "The new campaign form with the client name and campaign name filled in",
  },
  {
    q: "What file should I upload?",
    a: "The master inventory workbook, with the property rows you don't want deleted. One sheet per city, named like \"Property List - Hyderabad\", and each sheet needs its \"Media Site Id\" column. Only .xlsx is accepted, up to 4 MB.",
    img: "/faq/which-file.jpg",
    alt: "The shortlisted properties field, which accepts a .xlsx file",
  },
  {
    q: "It says some rows didn't match. What went wrong?",
    a: "A row only counts if its Media Site Id exists in that city's inventory. The usual causes are an out-of-date master sheet, a renamed sheet tab, or a missing \"Media Site Id\" column header. The upload screen lists exactly which sheets had a problem and why — it stays on that screen when there's something to read rather than jumping you to the map.",
  },
  {
    q: "Can I change a shortlist after uploading?",
    a: "Yes. Open the campaign and click \"Edit shortlist\". You can remove properties or search and add new ones from any city, including a city the campaign didn't originally cover. No re-upload needed.",
    img: "/faq/edit-shortlist.jpg",
    alt: "The Edit shortlist dialog, listing the campaign's properties by city with a Remove button on each",
  },
  {
    q: "What does my client see? Do they need a login?",
    a: "No login, no account, nothing to install. \"Copy client link\" gives you one URL that opens their campaign full-screen with their own logo on it. They only see their shortlist highlighted; the rest of your inventory shows as context and they can hide it entirely from the legend.",
    img: "/faq/client-view.jpg",
    alt: "The client-facing link: a full-screen map carrying the client's own logo",
  },
  {
    q: "What do the blue and green pins mean?",
    a: "Blue is this client's shortlist. Green is the rest of the Adonmo inventory, shown for context so a client can see what else is nearby. Selecting a pin deepens its own colour rather than turning it blue — blue only ever means \"targeted for you\".",
    img: "/faq/pins.jpg",
    alt: "The map legend: a blue pin marks the client's shortlist, a green pin the rest of the inventory",
  },
  {
    q: "What is the guided tour?",
    a: "\"Tour the shortlist\" flies the camera from property to property on its own, pausing on each one with its screens, households and budget. It's built for live calls: start it and talk over it. Clicking anything stops it, and you can resume from where it paused.",
    img: "/faq/guided-tour.jpg",
    alt: "The guided tour part-way through, with the camera settled on one property and its details open",
  },
  {
    q: "Can one campaign cover several cities?",
    a: "Yes. Upload a sheet with several city tabs filled in and the campaign covers all of them. A city dropdown appears above the map, listing only the cities that campaign actually has properties in.",
    img: "/faq/multi-city.jpg",
    alt: "The city picker that appears above the map when a campaign covers more than one city",
  },
  {
    q: "How do I send something by email?",
    a: "\"Download PDF\" on a campaign gives you a shortlist document grouped by city, with screens, households and budget per property. Reports exports your full campaign history as CSV. For anything interactive, send the client link instead.",
    img: "/faq/export.jpg",
    alt: "The campaign header buttons: Edit shortlist, Download PDF and Copy client link",
  },
  {
    q: "Where do the numbers come from?",
    a: "From the same per-city inventory data the map draws. Totals on every page are computed live from it, not snapshotted. Screen-level figures (per-screen impressions and budget) are an even split of a property's totals — the source data tracks a screen count per property, not individual screens.",
    img: "/faq/numbers.jpg",
    alt: "A property's detail panel showing screens, households, impressions and monthly ad budget",
  },
];

export default function HelpPage() {
  const playerRef = useRef<DemoPlayerHandle>(null);
  const [open, setOpen] = useState<number | null>(0);
  const [active, setActive] = useState<string | null>(null);

  const jumpTo = (at: number, id: string) => {
    setActive(id);
    // A chapter click is a user gesture, so playing straight away is allowed.
    playerRef.current?.seekTo(at, true);
  };

  return (
    <div className="cpg-page help-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">HELP &amp; FAQS</span>
          <h1>How the application works</h1>
          <p>
            A {Math.round(DEMO_DURATION / 60)}-minute walkthrough of the whole product — creating a campaign, editing it, adding
            cities, and sending it to a client. Use the ←/→ keys or the 10-second buttons to skip, and the chapters to jump
            straight to a section. Plus answers to the questions that come up most.
          </p>
        </div>
      </div>

      <div className="help-grid">
        <div className="help-video-card">
          <DemoPlayer
            ref={playerRef}
            src="/demo.mp4"
            poster="/demo-poster.jpg"
            chapters={DEMO_CHAPTERS}
            onTime={(t) => {
              // Keeps the chapter list in step however the viewer moved —
              // skip buttons, keyboard, or dragging the timeline.
              const current = [...DEMO_CHAPTERS].reverse().find((c) => t >= c.at);
              setActive(current?.id ?? null);
            }}
          />
        </div>

        <div className="help-chapters">
          <span className="help-chapters-title">Chapters</span>
          {DEMO_CHAPTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"help-chapter" + (active === c.id ? " is-active" : "")}
              onClick={() => jumpTo(c.at, c.id)}
            >
              <PlayIcon size={11} />
              <span className="help-chapter-label">{c.label}</span>
              <span className="help-chapter-time">{formatTime(c.at)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="help-faq">
        <h2>Frequently asked</h2>
        {FAQS.map((f, i) => (
          <div key={f.q} className={"help-faq-item" + (open === i ? " is-open" : "")}>
            <button type="button" className="help-faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>{f.q}</span>
              <span className="help-faq-chevron" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
            {open === i && (
              <div className="help-faq-body">
                <p className="help-faq-a">{f.a}</p>
                {f.img && (
                  <figure className="help-faq-fig">
                    {/* Lazy — otherwise eleven screenshots sitting behind
                        collapsed answers all download on page load. */}
                    <img src={f.img} alt={f.alt ?? ""} loading="lazy" />
                  </figure>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
