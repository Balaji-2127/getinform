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
// Accent: the audience is Indian sales reps, and Achird's default read came
// across as American. The notes now ask for a South Indian English accent
// and the request sets languageCode en-IN. Every male voice was re-auditioned
// with that direction and rated by Gemini for accent; Umbriel was the most
// consistently Indian (9/10, ~1/10 American traits) and the one most often
// placed as South Indian, while still rating as a real person. Pushing the
// accent harder in the notes starts to sound put-on, so it stays natural.
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
const VOICE = process.env.NARRATION_VOICE || "Umbriel";
const LANGUAGE = process.env.NARRATION_LANGUAGE || "en-IN";
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
const MAX_TRIES = 6;

// Google's documented "director's notes" structure: the model performs the
// TRANSCRIPT section and treats everything above it as direction. Kept
// deliberately plain — a more emotive version of these notes caused the
// ad-libbing described above, without sounding any more human.
const direct = (line) => `# AUDIO PROFILE: Product specialist from Hyderabad, originally from Chennai
## THE SCENE: Sitting beside a new sales colleague in the Hyderabad office, walking them through the tool on a laptop.
### DIRECTOR'S NOTES
Accent: a genuine South Indian English accent, like a Tamil or Telugu professional speaking English at work. Syllable-timed rhythm with even stress, retroflex t and d, clearly pronounced r, crisp consonants, and the gentle rising-falling South Indian intonation. Natural and authentic, never exaggerated or comic.
Style: warm, friendly, confident, genuinely conversational. Not a narrator, not an advert.
Pacing: slow and deliberate, like explaining something to a new colleague for the first time — about 135 words a minute. Pause briefly at every comma and full stop, and say button names clearly. "Tour" rhymes with "poor" — never "two".
#### TRANSCRIPT
${line}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(model, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Dropped connections (ECONNRESET and the like) are retried too.
      if (attempt < 5) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
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
      speechConfig: { languageCode: LANGUAGE, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
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
const words = (s) => s.toLowerCase().replace(/short list/g, "shortlist").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
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

console.log(`voice: ${VOICE} (${MODEL}, ${LANGUAGE})\n`);
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
  let slowestClean = null; // { secs, path } — fallback if every clean take is rushed
  for (let attempt = 1; attempt <= MAX_TRIES && !accepted; attempt++) {
    await synthesize(step.say, take);
    const heard = await transcribe(take);
    const { recall, precision } = score(step.say, heard);
    // Names like "Adonmo" get transcribed inconsistently, so this allows a
    // couple of mismatched words rather than demanding a perfect match.
    const secs = probe(take);
    const wpm = (words(step.say).length / secs) * 60;
    // Umbriel sometimes rattles a line off at 220+ wpm. Past what pacing can
    // gently slow (TARGET_WPM / MAX_STRETCH) a rushed take is re-asked for
    // rather than stretched further, which would start to sound processed.
    // The last try is kept regardless so a run can't fail on speed alone.
    const tooFast = wpm > TARGET_WPM / MAX_STRETCH && attempt < MAX_TRIES;
    accepted = recall >= 0.92 && precision >= 0.92 && !tooFast;
    console.log(
      `  ${step.id.padEnd(14)} try ${attempt}  ${secs.toFixed(1).padStart(5)}s  ${wpm.toFixed(0).padStart(3)} wpm  ` +
        `recall ${(recall * 100).toFixed(0)}% precision ${(precision * 100).toFixed(0)}%  ${accepted ? "ok" : tooFast && recall >= 0.92 && precision >= 0.92 ? "TOO FAST" : "REJECTED"}`,
    );
    if (!accepted && !tooFast) console.log(`      heard: ${heard}`);
    if (tooFast && recall >= 0.92 && precision >= 0.92 && (!slowestClean || secs > slowestClean.secs)) {
      slowestClean = { secs, path: take + ".best.wav" };
      writeFileSync(slowestClean.path, readFileSync(take));
    }
    if (accepted) {
      const p = settlePace(take, wav, step.say);
      if (p.tempo < 1) console.log(`      paced ${p.wpm.toFixed(0)} -> ${p.finalWpm.toFixed(0)} wpm`);
      total += probe(wav);
    }
  }
  if (!accepted && slowestClean) {
    writeFileSync(take, readFileSync(slowestClean.path));
    const p = settlePace(take, wav, step.say);
    console.log(`      kept the slowest clean take: ${p.wpm.toFixed(0)} -> ${p.finalWpm.toFixed(0)} wpm`);
    total += probe(wav);
    accepted = true;
  }
  if (slowestClean) rmSync(slowestClean.path, { force: true });
  if (!accepted) throw new Error(`${step.id}: no clean take after ${MAX_TRIES} tries — check the line, then rerun with ONLY=${step.id}`);
}

writeFileSync(
  join(outDir, "script.txt"),
  steps.map((s, i) => `[${String(i + 1).padStart(2, "0")}]  ${s.id}.wav\n${s.say}\n`).join("\n"),
  "utf8",
);
for (const f of ["_line.txt"]) if (existsSync(join(outDir, f))) rmSync(join(outDir, f));
if (!ONLY.length) console.log(`\n${total.toFixed(1)}s of narration -> ${outDir}`);
