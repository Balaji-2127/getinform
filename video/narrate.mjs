// Generates one WAV per walkthrough step from walkthrough.mjs, using the
// Windows speech synthesiser (System.Speech / SAPI) via PowerShell. No cloud
// service and no API key — it runs entirely offline against the voices
// already installed.
//
// The voice on this machine is Microsoft Zira, which is clear but audibly
// synthetic. That is the known weak point of the video, which is exactly why
// narration lives in per-step files rather than being baked into the
// recording: drop a human-recorded WAV over any file in narration/ (same
// name, any length) and re-run mux.mjs — it re-measures every clip, so the
// narration re-places itself with no editing.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { steps } from "./walkthrough.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "narration");
mkdirSync(outDir, { recursive: true });

const VOICE = process.env.NARRATION_VOICE || "Microsoft Zira Desktop";
// Slightly under default pace: these SAPI voices run their words together at
// speed, and this is narration over a moving screen, not a podcast.
const RATE = process.env.NARRATION_RATE ?? "-1";

// The text goes through a temp file rather than being interpolated into the
// PowerShell command, so an apostrophe or em dash in the script can never
// break out of a quoted string.
const tmpTxt = join(outDir, "_line.txt");

console.log(`voice: ${VOICE}  rate: ${RATE}\n`);

let totalWords = 0;
for (const step of steps) {
  const wav = join(outDir, `${step.id}.wav`);
  writeFileSync(tmpTxt, step.say, "utf8");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText('${tmpTxt.replace(/\\/g, "\\\\")}', [System.Text.Encoding]::UTF8)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${VOICE}')
$s.Rate = ${RATE}
$s.SetOutputToWaveFile('${wav.replace(/\\/g, "\\\\")}')
$s.Speak($text)
$s.Dispose()
`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  const words = step.say.split(/\s+/).length;
  totalWords += words;
  console.log(`  ${step.id.padEnd(16)} ${String((statSync(wav).size / 1024).toFixed(0)).padStart(4)} KB  ${String(words).padStart(3)} words`);
}

// A plain-text version of exactly what is spoken, for whoever re-records
// these lines with a real voice. Step ids match the WAV filenames, so there
// is no ambiguity about which recording replaces which clip.
writeFileSync(
  join(outDir, "script.txt"),
  steps.map((s, i) => `[${String(i + 1).padStart(2, "0")}]  ${s.id}.wav\n${s.say}\n`).join("\n"),
  "utf8",
);
rmSync(tmpTxt, { force: true });

console.log(`\n${steps.length} narration files (${totalWords} words) -> ${outDir}`);
console.log(`script -> ${join(outDir, "script.txt")}`);
