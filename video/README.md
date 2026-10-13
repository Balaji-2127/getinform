# Product walkthrough video

Builds `public/demo.mp4` — the narrated walkthrough on the **Help & FAQs**
page. It is a real screen recording of the app being driven: the typing, the
upload, the map flights and the edits are all genuinely happening on screen.
It opens on the dashboard, already signed in — no login, no password field.

```
walkthrough.mjs   the script: narration, step labels, and the actions   <- edit this
  ├── narrate.mjs   narration -> narration/*.wav          (Gemini TTS)
  ├── graphics.mjs  cursor, click rings, labels, intro/outro -> graphics/*.png
  ├── record.mjs    drives the live app -> .rec/raw.mp4, marks.json, events.json
  └── mux.mjs       raw + graphics + narration + music/bed.mp3
                      -> ../public/demo.mp4
                      -> ../public/demo-poster.jpg
                      -> ../src/dashboard/demoChapters.ts
```

## Rebuilding

The dev server must be running (`npm run dev`) — `record.mjs` drives the real
app at `http://localhost:5173`. `narrate.mjs` needs `GEMINI_API_KEY` in
`.env.local`.

```bash
node video/narrate.mjs    # ~2 min — only when the narration text changes
node video/graphics.mjs   # seconds — only when labels or cards change
node video/record.mjs     # ~4 min, opens a Chrome window — don't touch it
node video/mux.mjs        # ~3 min
```

After changing only narration or graphics, re-run `mux.mjs` — no need to
re-record.

## Narration

Voice **Achird** on `gemini-3.8-flash-tts`, chosen by blind comparison
against the other Gemini voices and models. Override with
`NARRATION_VOICE=Algieba` / `NARRATION_MODEL=...`.

Each line is checked before it is kept: the take is transcribed and compared
word-for-word with the script, and re-generated (up to 4 tries) if the model
added, dropped or changed words. Silence is trimmed and any take faster than
~172 words a minute is gently slowed (never below 0.88×).

- `ONLY=05-map,07-edit node video/narrate.mjs` — redo just those lines.
- `PACE_ONLY=1 node video/narrate.mjs` — re-pace from the saved raw takes in
  `narration/takes/` (gitignored) without calling the API.

To use a human voice instead, record each line from `narration/script.txt` to
`narration/<step-id>.wav` and run `mux.mjs`. Clips are placed at their own
step's recorded offset, so a longer or shorter take never shifts the others.

## Post-production (mux.mjs)

- **Dead air is cut** — the recording runs in real time, so it includes every
  second the app spent saving or loading a map. Stretches where the screen is
  completely still are removed (the frames either side are identical, so the
  cut is invisible), but never during a cursor move, click or zoom, and never
  so much that a step gets shorter than its narration. This took the cut from
  3:10 to 2:40.
- **Cursor** — an ordinary arrow drawn at a smooth 30 fps from the logged
  moves (eased curve, not a straight line), with a soft ripple on clicks.
  The page itself draws nothing, so the recording has no stutter.
- **Camera** — gentle eased zoom onto whatever the step is about
  (`c.focus(selector, zoom)` / `c.unfocus()` in `walkthrough.mjs`).
- **Step labels** — a small chip, bottom-left, fades in per section.
- **Intro / outro cards**, then a light music bed (`music/bed.mp3`) leveled
  well under the voice and ducked further whenever someone is speaking.
  Final mix is brought to −16 LUFS.
- **Chapters** are generated from the same recorded marks, so the in-app
  chapter list can't drift from what's on screen. Don't edit
  `src/dashboard/demoChapters.ts` by hand.

## The player

`src/dashboard/DemoPlayer.tsx` — custom controls over the `<video>`:
play/pause, −10 s / +10 s buttons, a scrubbable timeline with chapter ticks
and hover preview, volume, speed (0.75–1.5×), fullscreen. Keyboard: Space/K,
←/J and →/L (10 s), ↑/↓ volume, M mute, F fullscreen, 0–9 jump.

## Notes

**Why real Chrome, headful.** The 3D map is WebGL and needs a GPU; headless
falls back to software rendering and the buildings come out flat or never
load. It's driven over the DevTools Protocol with Node's built-in WebSocket —
no Playwright or Puppeteer.

**Google's "alpha channel" banner** is dismissed from inside the page the
moment it appears, so it never makes it into a frame.

## What the recording touches

`record.mjs` uploads a real demo campaign (`Acme Retail — Festive Launch`)
so the upload flow genuinely happens, performs every later edit against that
campaign only, and **deletes it at the end of the run**. Real client
campaigns are never modified.
