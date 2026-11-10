#!/usr/bin/env node
// Make a piece of background music with Google's Lyria.
//
//   node music.js "warm felt piano and soft pads, calm and curious, 80 bpm" [--seconds 55]
//        [--plain] [--clip] [--vocals] [--out music.mp3] [--tag label] [--dry-run]
//
// A full piece costs 8 cents; --clip makes a 30-second piece for 4 cents.
// By default the piece is asked for as a bed to sit under a speaking voice:
// steady, sparse, no lead melody, no builds. --plain sends only your words,
// for music that is the main thing. The length asked for with --seconds goes
// into the prompt, so it is roughly kept, not exactly: ask for the video's
// length plus about 8 seconds and let the renderer trim and fade it.
// Music is instrumental unless --vocals is given.
// A note of the prompt, date and terms is saved beside the file.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { OUT_DIR, loadKey, logUsage, fetchJson } from "./lib/common.js";

const USAGE =
  'Usage: node music.js "the music: instruments, mood, tempo" [--seconds 55] [--plain] [--clip] [--vocals] [--out music.mp3] [--tag label] [--dry-run]';

// USD per piece, from the Gemini API pricing page (checked 2026-11-10).
const MODELS = {
  full: { id: "lyria-3.5", usd: 0.08 },
  clip: { id: "lyria-3-clip-preview", usd: 0.04 },
};

export function parseArgs(argv) {
  const a = { prompt: "", seconds: null, clip: false, vocals: false, plain: false, out: null, tag: null, dryRun: false };
  const args = argv.slice(2);
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${k} needs a value.\n${USAGE}`);
      return args[++i];
    };
    if (k === "--seconds") a.seconds = Number(next());
    else if (k === "--clip") a.clip = true;
    else if (k === "--vocals") a.vocals = true;
    else if (k === "--plain") a.plain = true;
    else if (k === "--out") a.out = next();
    else if (k === "--tag") a.tag = next();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k.startsWith("--")) throw new Error(`Unknown option "${k}".\n${USAGE}`);
    else words.push(k);
  }
  a.prompt = words.join(" ").trim();
  if (!a.prompt) throw new Error(`No description of the music given.\n${USAGE}`);
  if (a.seconds !== null && !(a.seconds >= 5 && a.seconds <= 240)) throw new Error("--seconds needs a number from 5 to 240.");
  if (a.clip && a.seconds !== null) throw new Error("--clip always makes 30 seconds; leave --seconds out.");
  return a;
}

const stamp = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// The text sent to the model. Lyria takes its length and shape from the words,
// including [m:ss - m:ss] sections, so the ending can be placed.
export function buildPrompt(a) {
  const parts = [a.prompt.replace(/[.\s]+$/, "") + "."];
  if (!a.plain) {
    parts.push("An underscore to sit under a speaking voice: steady pulse, sparse, repetitive and even in energy, with no lead melody, no solos, and no builds, drops or big swells.");
  }
  if (a.seconds) {
    if (!a.plain && a.seconds >= 20) {
      parts.push(`[0:00 - 0:04] soft fade-in. [0:04 - ${stamp(a.seconds - 6)}] steady bed. [${stamp(a.seconds - 6)} - ${stamp(a.seconds)}] resolve to a held final chord and let it ring out.`);
    }
    parts.push(`About ${a.seconds} seconds long, with a clear ending.`);
  }
  if (!a.vocals) parts.push("Instrumental only, no vocals.");
  return parts.join(" ");
}

const TERMS =
  "Generated with Google Lyria. Under the Gemini API terms Google claims no ownership of it, but may generate similar music for others. " +
  "It carries an inaudible SynthID watermark marking it as AI-made. YouTube lists AI-generated music among things to disclose when uploading.";

async function main() {
  const a = parseArgs(process.argv);
  const model = a.clip ? MODELS.clip : MODELS.full;
  const prompt = buildPrompt(a);
  if (a.dryRun) {
    console.log(JSON.stringify({ dry_run: true, model: model.id, estimated_cost_usd: model.usd, prompt }, null, 2));
    return;
  }
  const base = { ts: new Date().toISOString(), kind: "music", model: model.id, tag: a.tag, cwd: process.cwd(), tokens: null };
  try {
    const key = loadKey("GEMINI_API_KEY");
    const data = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
      {
        method: "POST", timeoutMs: 300_000,
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
      "Gemini music"
    );
    if (data.promptFeedback?.blockReason) throw new Error(`The description was blocked: ${data.promptFeedback.blockReason}`);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const audio = parts.find((p) => p.inlineData?.data);
    if (!audio) {
      const said = parts.filter((p) => p.text).map((p) => p.text).join(" ").slice(0, 300);
      throw new Error(`No music came back.${said ? ` The model said: ${said}` : ""}`);
    }
    const ext = /wav/i.test(audio.inlineData.mimeType || "") ? "wav" : "mp3";
    const outPath = path.resolve(a.out || path.join(OUT_DIR, `music-${Date.now()}.${ext}`));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(audio.inlineData.data, "base64"));
    // Kept beside the music: what was asked for, when, and on what terms.
    fs.writeFileSync(outPath + ".source.json", JSON.stringify({ made: new Date().toISOString().slice(0, 10), model: model.id, prompt, terms: TERMS }, null, 2) + "\n", "utf-8");
    logUsage({ ...base, cost_usd: model.usd, success: true, audio_path: outPath });
    console.log(JSON.stringify({
      success: true, audio_path: outPath, model: model.id, prompt_used: prompt, tag: a.tag,
      cost_usd: model.usd, cost_basis: "list price per piece (2026-11-10)", terms: TERMS,
    }, null, 2));
  } catch (err) {
    logUsage({ ...base, cost_usd: null, success: false, audio_path: null, error: err.message });
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  });
}
