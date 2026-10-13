// Generates one WAV per walkthrough step with Gemini's speech model, then
// checks each one by transcribing it back before accepting it.
//
// Why Gemini: the previous narration was Microsoft Zira, the Windows built-in
// voice, and it was the single biggest reason the video read as machine-made.
// The project already has a GEMINI_API_KEY (it powers the client-logo lookup),
// and that key has access to Google's current speech models, which sound like
// a person talking rather than a voice assistant.
//
// Voice choice was tested, not guessed. Each candidate read the same line and
// had Gemini rate it, calibrated first against Zira (which scored 3-4).
// Achird on gemini-3.8-flash-tts scored highest and most consistently.
//
// Why every clip is transcribed back: style direction is sent in the same
// text as the line, and if the model misreads the structure it *speaks the
// direction aloud* — the first test did exactly that. A more expressive
// direction also made it ad-lib ("Okay, so...") words that aren't in the
// script. Both would wreck a video timed line by line, and neither is
// detectable from the file size or duration. So each clip's transcript is
// compared to the script and the clip is regenerated if it doesn't match.
//
// Usage:  node video/narrate.mjs               all steps
//         ONLY=05-map node video/narrate.mjs   just one
//         NARRATION_VOICE=Algieba node video/narrate.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { steps } from "./walkthrough.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(here, "narration");
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(root, ".env.local"), "utf8");
const KEY = (env.match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("GEMINI_API_KEY missing from .env.local — it's needed for the voice-over");

const MODEL = process.env.NARRATION_MODEL || "gemini-3.8-flash-tts";
const VOICE = process.env.NARRATION_VOICE || "Achird";
const CHECK_MODEL = "gemini-2.5-flash";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
// Rebuild the paced clips from the stored takes without calling the API.
const PACE_ONLY = process.env.PACE_ONLY === "1";
const takesDir = join(outDir, "takes");
mkdirSync(takesDir, { recursive: true });

// The model reads quickly — accepted takes came back at up to ~220 words a
// minute, where relaxed conversational speech sits around 150-170. A rushed
// read is a large part of what makes narration sound generated, so anything
// faster than this is slowed with a pitch-preserving time stretch. Capped at
// 12%: beyond that the stretch itself starts to become audible.
const TARGET_WPM = 172;
const MAX_STRETCH = 0.88;
const MAX_TRIES = 4;

// Google's documented "director's notes" structure: the model performs the
// TRANSCRIPT section and treats everything above it as direction. Kept
// deliberately plain — a more emotive version of these notes caused the
// ad-libbing described above, without sounding any more human.
const direct = (line) => `# AUDIO PROFILE: Product specialist
## THE SCENE: Sitting beside a new sales colleague, walking them through the tool on a laptop.
### DIRECTOR'S NOTES
Style: warm, relaxed, confident, genuinely conversational. Not a narrator, not an advert.
Pacing: calm and unhurried, around 150 words a minute, with small natural breaths between sentences.
#### TRANSCRIPT
${line}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(model, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    // Rate limits and transient 5xx are retried with backoff; anything else
    // is a real problem and should stop the run.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`${model} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
}

async function synthesize(line, wavPath) {
  const data = await api(MODEL, {
    contents: [{ parts: [{ text: direct(line) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  });
  const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline) throw new Error("no audio in response");
  const buf = Buffer.from(inline.data, "base64");
  const raw = wavPath + ".raw";
  // Some models return a WAV, others bare 24kHz 16-bit PCM — handle both.
  const isWav = buf.subarray(0, 4).toString() === "RIFF";
  writeFileSync(raw, buf);
  // Trim leading and trailing silence so each clip starts on its first word:
  // the offsets in record.mjs assume the voice begins when the clip does.
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...(isWav ? [] : ["-f", "s16le", "-ar", "24000", "-ac", "1"]),
    "-i", raw,
    "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse",
    "-ar", "24000", "-ac", "1",
    wavPath,
  ]);
  rmSync(raw, { force: true });
}

async function transcribe(wavPath) {
  const data = await api(CHECK_MODEL, {
    contents: [{ parts: [
      { inlineData: { mimeType: "audio/wav", data: readFileSync(wavPath).toString("base64") } },
      { text: "Transcribe this audio exactly, word for word. Output only the transcript." },
    ] }],
  });
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() ?? "";
}

// Word-level overlap between script and transcript, both ways: low recall
// means words were dropped, low precision means words were *added* — the
// spoken-instruction and ad-lib failures both show up as poor precision.
const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}
function score(script, heard) {
  const s = words(script);
  const h = words(heard);
  const common = lcs(s, h);
  return { recall: common / s.length, precision: h.length ? common / h.length : 0 };
}

function settlePace(take, out, script) {
  const secs = probe(take);
  const wpm = (words(script).length / secs) * 60;
  const tempo = wpm > TARGET_WPM ? Math.max(MAX_STRETCH, TARGET_WPM / wpm) : 1;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", take, "-af", `atempo=${tempo.toFixed(4)}`, "-ar", "24000", "-ac", "1", out]);
  return { tempo, wpm, finalWpm: (words(script).length / probe(out)) * 60 };
}

const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

console.log(`voice: ${VOICE} (${MODEL})\n`);
let total = 0;
for (const step of steps) {
  if (ONLY.length && !ONLY.includes(step.id)) continue;
  const wav = join(outDir, `${step.id}.wav`);
  const take = join(takesDir, `${step.id}.wav`);
  if (PACE_ONLY) {
    if (!existsSync(take)) throw new Error(`no stored take for ${step.id} — run without PACE_ONLY first`);
    const p = settlePace(take, wav, step.say);
    console.log(`  ${step.id.padEnd(14)} ${p.wpm.toFixed(0)} -> ${p.finalWpm.toFixed(0)} wpm  (tempo ${p.tempo.toFixed(2)})`);
    total += probe(wav);
    continue;
  }
  let accepted = false;
  for (let attempt = 1; attempt <= MAX_TRIES && !accepted; attempt++) {
    await synthesize(step.say, take);
    const heard = await transcribe(take);
    const { recall, precision } = score(step.say, heard);
    // Names like "Adonmo" get transcribed inconsistently, so this allows a
    // couple of mismatched words rather than demanding a perfect match.
    accepted = recall >= 0.92 && precision >= 0.92;
    const secs = probe(take);
    const wpm = (words(step.say).length / secs) * 60;
    console.log(
      `  ${step.id.padEnd(14)} try ${attempt}  ${secs.toFixed(1).padStart(5)}s  ${wpm.toFixed(0).padStart(3)} wpm  ` +
        `recall ${(recall * 100).toFixed(0)}% precision ${(precision * 100).toFixed(0)}%  ${accepted ? "ok" : "REJECTED"}`,
    );
    if (!accepted) console.log(`      heard: ${heard}`);
    if (accepted) {
      const p = settlePace(take, wav, step.say);
      if (p.tempo < 1) console.log(`      paced ${p.wpm.toFixed(0)} -> ${p.finalWpm.toFixed(0)} wpm`);
      total += probe(wav);
    }
  }
  if (!accepted) throw new Error(`${step.id}: no clean take after ${MAX_TRIES} tries — check the line, then rerun with ONLY=${step.id}`);
}

writeFileSync(
  join(outDir, "script.txt"),
  steps.map((s, i) => `[${String(i + 1).padStart(2, "0")}]  ${s.id}.wav\n${s.say}\n`).join("\n"),
  "utf8",
);
for (const f of ["_line.txt"]) if (existsSync(join(outDir, f))) rmSync(join(outDir, f));
if (!ONLY.length) console.log(`\n${total.toFixed(1)}s of narration -> ${outDir}`);
