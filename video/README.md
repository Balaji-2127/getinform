# Product walkthrough video

Builds `public/demo.mp4` — the narrated walkthrough shown on the **Help &
FAQs** page in the app. It is a real screen recording of the app being
driven: the typing, the upload, the map flights, the modal, the removal of a
property are all genuinely happening on screen.

```
walkthrough.mjs   the script: narration, captions, and the actions   <- edit this
  ├── narrate.mjs   narration -> narration/*.wav        (Windows SAPI)
  ├── record.mjs    drives the live app, streams frames -> .rec/raw.mp4
  │                                                    -> .rec/marks.json
  └── mux.mjs       raw + narration -> ../public/demo.mp4
                                    -> ../public/demo-poster.jpg
                                    -> ../src/dashboard/demoChapters.ts
```

## Rebuilding

The dev server must be running (`npm run dev`) — `record.mjs` drives the real
app at `http://localhost:5173`.

```bash
node video/narrate.mjs   # ~1 min
node video/record.mjs    # ~10 min, opens a Chrome window — don't touch it
node video/mux.mjs       # ~3 min
```

Only `mux.mjs` is needed after swapping audio.

## Replacing the narration with a real voice

The narration is currently Microsoft Zira, the Windows built-in voice. It is
clear but audibly synthetic — the known weak point of the video, and the
reason narration is kept as one file per step instead of a single track baked
into the recording.

To replace it: record each line from `narration/script.txt`, save each as
`narration/<step-id>.wav` keeping the existing filenames, and run
`node video/mux.mjs`.

**The new clips do not need to match the old lengths.** Each one is placed at
the offset `record.mjs` logged for its step, independently of every other
clip, so a longer or shorter take cannot shift the ones after it. Nothing
needs re-editing — and the screen recording does not need redoing.

The one thing to watch: a line much longer than the on-screen action it
describes will still be playing when the next step begins. `mux.mjs` warns
when a clip runs past the end of the recording; for the rest, keep roughly to
the pacing in `script.txt`.

To try the other installed voice instead:

```bash
NARRATION_VOICE="Microsoft Hazel Desktop" node video/narrate.mjs
node video/mux.mjs
```

## Notes on the pipeline

**Why this is a recording and not a slideshow.** The first build captured one
still per feature and panned across them. It looked fine frame by frame and
taught nothing, because it never showed anybody *using* the product. Every
step in `walkthrough.mjs` is now a real interaction against the running app.

**Why real Chrome, headful.** The 3D map tiles are WebGL and need a GPU.
Headless falls back to software rendering and the buildings either come out
flat or never arrive. Node 24 ships a WebSocket client, so driving it over
the DevTools Protocol needs no Playwright, no Puppeteer and no download.

**Why there is a drawn cursor.** Chrome's screencast does not capture the OS
pointer. Without one, the viewer sees fields filling themselves and panels
opening for no visible reason. `record.mjs` injects a cursor into the page
that glides to each target and pulses on click, so every action is legible.

**Why frames are piped, not saved.** At 1920×1080 a ten-minute recording is
several gigabytes of JPEGs. Frames go straight into ffmpeg's stdin and are
stamped by arrival time, then resampled to a constant 30fps — which is also
what keeps the recording in real time, since the screencast only emits a
frame when the page actually changes.

**Why the audio is normalised.** The first cut mixed narration without
`normalize=0`, so ffmpeg's `amix` divided every clip's level by the track
count and the result averaged −22.9 dB — quiet enough to read as silent on a
laptop. It is now mixed at full level and brought to −16 LUFS.

**Chapters are generated** from the same recorded marks the narration is
placed at, so the in-app chapter list cannot drift out of step with what is
on screen. Don't edit `src/dashboard/demoChapters.ts` by hand.

## What the recording touches

`record.mjs` signs in and **uploads a real campaign** (`Acme Retail — Festive
Launch`, from `multi_city_shortlist_test.xlsx`) so the upload flow can be
shown genuinely happening. That campaign persists in Firestore afterwards.
Every later mutation in the walkthrough — removing properties, adding one,
starring a locality — is performed against that demo campaign, never against
real client data.
