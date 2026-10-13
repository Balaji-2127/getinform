// Turns the raw 1920x1080 captures in video/shots/ into the images the Help
// page shows beside each FAQ answer.
//
// Two jobs: crop, and shrink. A full-screen screenshot dropped into a 700px
// answer column is unreadable — for questions about one specific control (the
// legend, the city picker, the export buttons) a tight crop of that control
// teaches far more than the whole window scaled to thumbnail size. And the
// raw PNGs are ~1 MB each; these ship in the app, so they go out as JPEGs at
// the width the column actually renders.
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
const out = join(here, "..", "public", "faq");
mkdirSync(out, { recursive: true });

// Rendered at ~700px in the answer column; 1000 wide keeps it crisp on a
// high-DPI screen without shipping a megabyte per question.
const WIDTH = 1000;

// source, output name, optional crop as [x, y, w, h] in the 1920x1080 frame
const IMAGES = [
  ["faq-campaign", "what-it-does", null],
  ["faq-upload", "create-campaign", [262, 150, 1420, 560]],
  ["faq-upload", "which-file", [262, 330, 700, 220]],
  ["faq-edit", "edit-shortlist", null],
  ["client-link", "client-view", null],
  // The legend plus the pins immediately around it — the whole point of the
  // question is telling the two colours apart.
  ["faq-campaign", "pins", [268, 840, 900, 240]],
  ["faq-tour", "guided-tour", null],
  // Just the city picker and the tour control sitting beside it.
  ["faq-campaign", "multi-city", [262, 160, 720, 78]],
  // The three export/share buttons in the page header.
  ["faq-campaign", "export", [1296, 94, 610, 56]],
  ["property-detail", "numbers", null],
  ["faq-areas", "saved-areas", null],
];

let total = 0;
for (const [src, name, crop] of IMAGES) {
  const input = join(shots, `${src}.png`);
  if (!existsSync(input)) {
    console.log(`  !! missing source ${src}.png — skipping ${name}`);
    continue;
  }
  const dest = join(out, `${name}.jpg`);
  const filters = [];
  if (crop) filters.push(`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`);
  filters.push(`scale=${WIDTH}:-2:flags=lanczos`);

  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", filters.join(","), "-q:v", "4", dest]);
  const kb = statSync(dest).size / 1024;
  total += kb;
  console.log(`  ${name.padEnd(18)} ${crop ? "crop" : "full"}  ${kb.toFixed(0).padStart(4)} KB`);
}

console.log(`\n${IMAGES.length} images -> public/faq/  (${(total / 1024).toFixed(1)} MB total)`);
