// Post-production: turns the raw screen recording into the finished video.
//
//   raw recording ─▶ smooth cursor + click rings ─▶ camera zooms ─▶ step labels
//                 ─▶ intro / outro cards ─▶ fades
//   narration (placed at each step's recorded offset) + music bed ducked under
//   the voice ─▶ loudness-normalised mix
//
// Why the cursor and labels are drawn here and not in the page: the recording
// captures the screen at ~12-16 fps (as fast as Chrome hands frames over), so
// anything animated *in the page* stutters at that rate. Drawing the cursor
// here, from the logged movements, makes it glide at a true 30 fps on a gently
// curved path — the single most obvious difference between a recording that
// looks staged and one that looks like someone using the app.
//
// Inputs (all produced by the other scripts — see README.md):
//   .rec/raw.mp4 .rec/marks.json .rec/events.json   record.mjs
//   narration/*.wav                                  narrate.mjs
//   graphics/*.png                                   graphics.mjs
//   music/bed.mp3                                    (generated once, tracked)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { steps } from "./walkthrough.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const work = join(here, ".rec");
const gfx = join(here, "graphics");
const OUT = process.env.OUT || join(root, "public", "demo.mp4");
mkdirSync(dirname(OUT), { recursive: true });

const W = 1920;
const H = 1080;
const FPS = 30;

for (const f of ["raw.mp4", "marks.json", "events.json"]) {
  if (!existsSync(join(work, f))) throw new Error(`missing .rec/${f} — run record.mjs first`);
}
for (const f of ["cursor.png", "ring-s.png", "ring-l.png", "intro.png", "outro.png", "labels.json"]) {
  if (!existsSync(join(gfx, f))) throw new Error(`missing graphics/${f} — run graphics.mjs first`);
}

const probe = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

let DUR = probe(join(work, "raw.mp4"));
let RAW = "raw.mp4";
const marks = JSON.parse(readFileSync(join(work, "marks.json"), "utf8"));
const events = JSON.parse(readFileSync(join(work, "events.json"), "utf8"));
const labelFiles = JSON.parse(readFileSync(join(gfx, "labels.json"), "utf8"));
const musicPath = join(here, "music", "bed.mp3");
const hasMusic = existsSync(musicPath);

// The voice starts a beat after the step does, so it lands just after the
// thing it describes appears instead of on the same frame as the cut.
const LEAD = 0.3;

// ------------------------------------------------------------ dead air
// The recording runs in real time, so it includes every second the app spent
// saving or loading a map — up to ten seconds of a completely still screen
// after the voice has finished. Those stretches are cut here. The frames on
// either side of a cut are identical, so the cut itself is invisible.
//
// Never cut: anything the drawn cursor or camera is doing (the page sits
// still while the overlay cursor glides, so it looks "frozen" to ffmpeg), the
// start of each step, the intro, the closing step — and never so much that a
// step gets shorter than its own narration.
{
  const STILL_MIN = 0.8; // only stretches at least this long count as still
  const KEEP_HEAD = 0.45; // a beat of the settled screen before the cut
  const KEEP_TAIL = 0.3; // and after it
  const VOICE_PAD = 0.7; // breathing room left after each line

  const fd = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", "raw.mp4", "-vf", `freezedetect=n=0.002:d=${STILL_MIN}`, "-map", "0:v", "-f", "null", "-"],
    { cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).stderr;
  const starts = [...fd.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...fd.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const still = starts.map((a, i) => [a + KEEP_HEAD, (ends[i] ?? DUR) - KEEP_TAIL]);

  const busy = [[0, 4.5], [marks.at(-1).at - 0.2, DUR]];
  for (const e of events) {
    const len = e.type === "move" ? e.dur : e.type === "click" ? 0.8 : 1.1;
    busy.push([e.t - 0.1, e.t + len + 0.15]);
  }
  for (const m of marks) busy.push([m.at - 0.2, m.at + 1.2]);

  // still minus busy
  let pieces = still;
  for (const [ba, bb] of busy) {
    pieces = pieces.flatMap(([a, b]) => (bb <= a || ba >= b ? [[a, b]] : [[a, ba], [bb, b]]));
  }
  pieces = pieces.filter(([a, b]) => b - a >= 0.3);

  const cuts = [];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : DUR;
    const wav = join(here, "narration", `${m.id}.wav`);
    const voice = existsSync(wav) ? probe(wav) : 0;
    let budget = end - m.at - (LEAD + voice + VOICE_PAD);
    const mine = pieces
      .filter(([a, b]) => a >= m.at && b <= end)
      .sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
    for (const [a, b] of mine) {
      if (budget < 0.3) break;
      const take = Math.min(b - a, budget);
      cuts.push([a, a + take]);
      budget -= take;
    }
  });
  cuts.sort((x, y) => x[0] - y[0]);
  const removed = cuts.reduce((n, [a, b]) => n + b - a, 0);

  if (removed > 0.5) {
    const remap = (t) => {
      let out = t;
      for (const [a, b] of cuts) {
        if (t >= b) out -= b - a;
        else if (t > a) out -= t - a;
      }
      return out;
    };
    for (const m of marks) m.at = remap(m.at);
    for (const e of events) e.t = remap(e.t);

    const keep = cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y", "-i", "raw.mp4",
        "-vf", `fps=${FPS},select='not(${keep})',setpts=N/${FPS}/TB`,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "tight.mp4",
      ],
      { cwd: work, stdio: ["ignore", "inherit", "inherit"] },
    );
    RAW = "tight.mp4";
    DUR = probe(join(work, RAW));
  }
  console.log(`dead air: ${cuts.length} still stretches cut, ${removed.toFixed(1)}s removed`);
}

const narration = marks
  .map((m) => ({ ...m, wav: join(here, "narration", `${m.id}.wav`) }))
  .filter((m) => existsSync(m.wav))
  .map((m) => ({ ...m, secs: probe(m.wav) }));

const lastLine = narration.at(-1);
const voiceEnds = lastLine ? lastLine.at + LEAD + lastLine.secs : DUR - 4;
const INTRO_UNTIL = 3.4; // intro card holds, then fades away over the dashboard
const OUTRO_FROM = Math.min(voiceEnds + 0.6, DUR - 1.2);
// Enough for the outro card to fade in and be read, then end.
DUR = Math.min(DUR, OUTRO_FROM + 3.6);

console.log(`recording ${DUR.toFixed(1)}s · ${narration.length} lines · voice ends ${voiceEnds.toFixed(1)}s · music ${hasMusic ? "yes" : "no"}`);

// ------------------------------------------------------------ cursor track
// Per-frame cursor position from the logged glides. Each glide follows a
// shallow curve rather than a ruler-straight line — hands don't move in
// straight lines — with an ease-in-out so it accelerates off the start and
// settles onto the target.
const CURSOR_SCALE = 1.35;
const HOTSPOT = 6 * CURSOR_SCALE; // the arrow's tip within its image
const moves = events.filter((e) => e.type === "move").sort((a, b) => a.t - b.t);
const clicks = events.filter((e) => e.type === "click").map((e) => e.t).sort((a, b) => a - b);

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function cursorAt(t) {
  let pos = moves.length ? moves[0].from : { x: W / 2, y: H / 2 };
  for (const m of moves) {
    if (m.t > t) break;
    const p = Math.min(1, (t - m.t) / m.dur);
    if (p >= 1) {
      pos = m.to;
      continue;
    }
    const e = ease(p);
    const dx = m.to.x - m.from.x;
    const dy = m.to.y - m.from.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Control point offset perpendicular to the path by ~10% of its length.
    const bend = Math.min(80, dist * 0.1);
    const cx = (m.from.x + m.to.x) / 2 + (-dy / dist) * bend;
    const cy = (m.from.y + m.to.y) / 2 + (dx / dist) * bend;
    const u = 1 - e;
    pos = {
      x: u * u * m.from.x + 2 * u * e * cx + e * e * m.to.x,
      y: u * u * m.from.y + 2 * u * e * cy + e * e * m.to.y,
    };
    break;
  }
  return pos;
}

// Rings are always present in the graph but parked off-screen except for the
// moment after each click — cheaper and simpler than toggling visibility.
const ringActive = (t, from, to) => clicks.some((c) => t >= c + from && t < c + to);

const cmdLines = [];
let last = "";
for (let i = 0; i <= Math.ceil(DUR * FPS); i++) {
  const t = i / FPS;
  const p = cursorAt(t);
  const cx = Math.round(p.x - HOTSPOT);
  const cy = Math.round(p.y - HOTSPOT);
  const rs = ringActive(t, 0, 0.14) ? [Math.round(p.x - 32), Math.round(p.y - 32)] : [-200, -200];
  const rl = ringActive(t, 0.1, 0.34) ? [Math.round(p.x - 32), Math.round(p.y - 32)] : [-200, -200];
  const key = `${cx},${cy},${rs},${rl}`;
  if (key === last) continue;
  last = key;
  cmdLines.push(
    `${t.toFixed(4)} overlay@cur x ${cx}, overlay@cur y ${cy}, overlay@rs x ${rs[0]}, overlay@rs y ${rs[1]}, overlay@rl x ${rl[0]}, overlay@rl y ${rl[1]};`,
  );
}
writeFileSync(join(work, "cursor.cmd"), cmdLines.join("\n"));

// ------------------------------------------------------------ camera
// Each focus event eases the camera to a zoom and centre over ZOOM_T seconds.
// Written as a running sum of eased deltas rather than nested conditionals,
// so the expression stays linear in the number of camera moves.
const ZOOM_T = 0.9;
const focus = events.filter((e) => e.type === "focus").sort((a, b) => a.t - b.t);
let state = { zoom: 1, cx: W / 2, cy: H / 2 };
const terms = { zoom: [], cx: [], cy: [] };
for (const f of focus) {
  const target = { zoom: f.zoom, cx: f.zoom === 1 ? W / 2 : f.cx, cy: f.zoom === 1 ? H / 2 : f.cy };
  const s = `st(0,clip((it-${f.t.toFixed(3)})/${ZOOM_T},0,1));ld(0)*ld(0)*(3-2*ld(0))`;
  for (const k of ["zoom", "cx", "cy"]) {
    const d = target[k] - state[k];
    if (Math.abs(d) > 1e-3) terms[k].push(`${d.toFixed(4)}*(${s})`);
  }
  state = target;
}
const expr = (base, list) => (list.length ? `${base}+${list.join("+")}` : `${base}`);
const Z = expr(1, terms.zoom);
const CX = expr(W / 2, terms.cx);
const CY = expr(H / 2, terms.cy);
const useCamera = focus.length > 0;

// ------------------------------------------------------------ labels
// Consecutive steps with the same label become one label segment, so a label
// doesn't blink off and on between two steps that share it.
const segments = [];
marks.forEach((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].at : OUTRO_FROM;
  if (!m.label) return;
  const prev = segments.at(-1);
  if (prev && prev.label === m.label && Math.abs(prev.end - m.at) < 0.01) prev.end = end;
  else segments.push({ label: m.label, start: m.at, end });
});
for (const s of segments) {
  s.start = Math.max(s.start + 0.25, INTRO_UNTIL + 0.6);
  s.end = Math.min(s.end - 0.15, OUTRO_FROM);
}
const visibleSegments = segments.filter((s) => s.end - s.start > 0.8);

// ------------------------------------------------------------ graph
const inputs = [
  "-i", RAW,
  "-loop", "1", "-framerate", String(FPS), "-i", join(gfx, "cursor.png"),
  "-loop", "1", "-framerate", String(FPS), "-i", join(gfx, "ring-s.png"),
  "-loop", "1", "-framerate", String(FPS), "-i", join(gfx, "ring-l.png"),
  "-loop", "1", "-framerate", String(FPS), "-t", String(DUR), "-i", join(gfx, "intro.png"),
  "-loop", "1", "-framerate", String(FPS), "-t", String(DUR), "-i", join(gfx, "outro.png"),
];
const labelBase = 6;
for (const s of visibleSegments) {
  inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(DUR), "-i", join(gfx, labelFiles[s.label]));
}
const voiceBase = labelBase + visibleSegments.length;
for (const n of narration) inputs.push("-i", n.wav);
const musicIdx = voiceBase + narration.length;
if (hasMusic) inputs.push("-stream_loop", "-1", "-i", musicPath);

const f = [];
// 1) cursor and click rings onto the recording, positioned per frame.
f.push(`[1:v]scale=iw*${CURSOR_SCALE}:ih*${CURSOR_SCALE}:flags=lanczos[cur]`);
f.push(`[0:v]sendcmd=f=cursor.cmd,format=yuv420p[base]`);
f.push(`[base][2:v]overlay@rs=x=-200:y=-200:eval=frame[r1]`);
f.push(`[r1][3:v]overlay@rl=x=-200:y=-200:eval=frame[r2]`);
f.push(`[r2][cur]overlay@cur=x=${W / 2}:y=${H / 2}:eval=frame[withcur]`);

// 2) camera. Upscaled first so zoompan's whole-pixel positioning moves in
//    half-pixel steps at output size — otherwise a slow zoom visibly judders.
if (useCamera) {
  f.push(
    `[withcur]scale=${W * 2}:${H * 2}:flags=lanczos,` +
      `zoompan=z='${Z}':` +
      `x='clip((${CX})*2-iw/zoom/2,0,iw-iw/zoom)':` +
      `y='clip((${CY})*2-ih/zoom/2,0,ih-ih/zoom)':` +
      `d=1:s=${W}x${H}:fps=${FPS}[cam]`,
  );
} else {
  f.push(`[withcur]null[cam]`);
}

// 3) step labels (after the camera, so they don't zoom with the page).
let v = "cam";
visibleSegments.forEach((s, i) => {
  const idx = labelBase + i;
  f.push(
    `[${idx}:v]format=rgba,fade=t=in:st=${s.start.toFixed(2)}:d=0.35:alpha=1,fade=t=out:st=${(s.end - 0.35).toFixed(2)}:d=0.35:alpha=1[lab${i}]`,
  );
  f.push(`[${v}][lab${i}]overlay=48:${H - 128}[l${i}]`);
  v = `l${i}`;
});

// 4) intro holds then dissolves into the dashboard; outro dissolves in at the end.
f.push(`[4:v]format=rgba,fade=t=out:st=${INTRO_UNTIL}:d=0.9:alpha=1[intro]`);
f.push(`[5:v]format=rgba,fade=t=in:st=${OUTRO_FROM.toFixed(2)}:d=0.9:alpha=1[outro]`);
f.push(`[${v}][intro]overlay=0:0[vi]`);
f.push(`[vi][outro]overlay=0:0,fade=t=in:st=0:d=0.5,fade=t=out:st=${(DUR - 0.7).toFixed(2)}:d=0.7,format=yuv420p[v]`);

// 5) audio: narration at its offsets; music levelled, then ducked under it.
narration.forEach((n, i) => {
  const ms = Math.round((n.at + LEAD) * 1000);
  f.push(`[${voiceBase + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[n${i}]`);
});
// normalize=0: the lines never overlap, and amix's default would divide each
// by the track count — the bug that made the first cut sound silent.
f.push(`${narration.map((_, i) => `[n${i}]`).join("")}amix=inputs=${narration.length}:normalize=0:dropout_transition=0,apad[voice]`);

if (hasMusic) {
  f.push(`[voice]asplit=2[voiceout][key]`);
  // The bed swings across ~11 LU on its own; levelled first so it sits at one
  // steady, low level, then pushed down a further ~9 dB whenever the voice is
  // speaking and eased back up in the gaps — the way a producer would ride it.
  f.push(
    `[${musicIdx}:a]atrim=0:${DUR.toFixed(2)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `loudnorm=I=-27:TP=-6:LRA=5,` +
      `afade=t=in:st=0:d=1.5,afade=t=out:st=${(DUR - 3).toFixed(2)}:d=3[bed]`,
  );
  f.push(`[bed][key]sidechaincompress=threshold=0.015:ratio=7:attack=25:release=450:makeup=1[ducked]`);
  f.push(`[voiceout][ducked]amix=inputs=2:normalize=0:duration=first[mix]`);
} else {
  f.push(`[voice]anull[mix]`);
}
f.push(`[mix]atrim=0:${DUR.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`);

writeFileSync(join(work, "graph.txt"), f.join(";\n"));

console.log("rendering… (the camera pass is the slow part)");
const t0 = Date.now();
execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputs,
    "-/filter_complex", "graph.txt",
    "-map", "[v]", "-map", "[a]",
    "-t", DUR.toFixed(2),
    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k",
    OUT,
  ],
  { cwd: work, stdio: ["ignore", "inherit", "inherit"] },
);
console.log(`  rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// Poster: a frame from the intro card, so the player shows the title before
// anyone presses play rather than a black rectangle.
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1.5", "-i", OUT, "-frames:v", "1", "-q:v", "3", join(root, "public", "demo-poster.jpg")]);

// Chapters from the same marks the narration was placed at, merged where
// consecutive steps share a label, so the list can't drift from the cut.
const chapters = [];
for (const m of marks) {
  if (!m.label) continue;
  if (chapters.at(-1)?.label === m.label) continue;
  chapters.push({ id: m.id, at: Number(m.at.toFixed(2)), label: m.label });
}
writeFileSync(
  join(root, "src", "dashboard", "demoChapters.ts"),
  `// GENERATED by video/mux.mjs — do not edit by hand.\n` +
    `// Regenerate with: node video/mux.mjs\n` +
    `export type DemoChapter = { id: string; at: number; label: string };\n\n` +
    `export const DEMO_DURATION = ${DUR.toFixed(2)};\n\n` +
    `export const DEMO_CHAPTERS: DemoChapter[] = ${JSON.stringify(chapters, null, 2)};\n`,
  "utf8",
);

const dur = probe(OUT);
console.log(`\n${OUT}\n${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB  ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}`);
console.log(`chapters -> src/dashboard/demoChapters.ts (${chapters.length})`);
console.log(`steps without narration: ${steps.filter((s) => !narration.some((n) => n.id === s.id)).map((s) => s.id).join(", ") || "none"}`);
