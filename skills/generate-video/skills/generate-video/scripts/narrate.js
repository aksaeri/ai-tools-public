#!/usr/bin/env node
// Turn a narration script into speech, one sound file per line, and work out
// when each line starts so the pictures can be timed to the voice.
//
//   node narrate.js script.txt --out-dir audio [--voice pool|Walnut|Kore] [--style "warm, clear, lively pace"]
//        [--model flash|lite] [--start 0.5] [--gap 0.4] [--redo 03,07] [--tag label] [--dry-run]
//
// script.txt: one spoken line per line. Blank lines and lines starting with #
// are skipped. A line like "[pause 1.5]" adds silence before the next line.
// A .json script is an array of strings or { "id", "text", "style", "pause" }.
//
// Writes audio/01.wav, 02.wav, ..., audio/narration.json and audio/narration.js
// (window.NARRATION = [{ id, text, file, start, duration, end, words }, ...]).
// Lines whose text, voice and style have not changed are not generated again,
// unless named with --redo (each take sounds a little different, so a line the
// speech check flagged is worth one more try).
//
// Each line's sound file has the silence at its ends trimmed (so a line starts
// when its timeline says) and is brought to the same loudness, -20 LUFS (the
// voice gives each line back at a slightly different level). This needs ffmpeg.
//
// With a GROQ_API_KEY, each line is also transcribed to find when every word
// is spoken (so a picture can arrive on its word), and to catch words the
// voice got wrong. --no-words skips that.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";

import { loadKey, logUsage, round, fetchJson, sleep } from "./lib/common.js";
import { measure } from "./lib/mix.js";

const USAGE =
  'Usage: node narrate.js script.txt --out-dir audio [--voice pool|Walnut|Kore] [--style "calm, warm"] [--model flash|lite] ' +
  "[--start 0.5] [--gap 0.4] [--redo 03,07] [--no-words] [--tag label] [--dry-run]";

// USD per 1M tokens, from the Gemini API pricing page (checked 2026-11-10).
// Google has announced that both TTS prices double on 1 January 2027.
const MODELS = {
  flash: { id: "gemini-3.8-flash-tts", input: 0.5, audio_out: 9 },
  lite: { id: "gemini-3.8-flash-lite-tts", input: 0.5, audio_out: 6 },
};
const PRICES_CHECKED = "2026-11-10";
const PRICE_DOUBLES = Date.UTC(2027, 0, 1);
// The default, "pool", is one of the voices in assets/voices.json (chosen by ear
// in a blind test), picked at random (weighted by preference) for a new output folder and then kept for
// that folder, so a re-run doesn't re-voice every line. --voice also takes a
// pool name (Walnut), any of Google's thirty named voices (Kore, Charon, ...)
// or any library id.
const DEFAULT_VOICE = "pool";
const POOL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "voices.json");
const PARALLEL = 3;

export function loadPool(file = POOL_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf-8")).voices;
}

// -> { voice: library id, name: pool name or null, how: why this voice }
// prev is the last run's narration.json in this folder ({} if none).
export function pickVoice(asked, pool, prev = {}, rand = Math.random) {
  const byName = pool.find((v) => v.name.toLowerCase() === String(asked).toLowerCase());
  if (byName) return { voice: byName.id, name: byName.name, how: "asked for" };
  if (asked !== "pool") return { voice: asked, name: pool.find((v) => v.id === asked)?.name ?? null, how: "asked for" };
  // A folder keeps the voice it was first narrated in, whichever it was.
  if (prev.voice) return { voice: prev.voice, name: pool.find((v) => v.id === prev.voice)?.name ?? null, how: "kept from the last run in this folder" };
  // In proportion to each voice's weight (how often the listener preferred it), 1 if unset.
  const weights = pool.map((v) => (v.weight > 0 ? v.weight : 1));
  let r = rand() * weights.reduce((t, w) => t + w, 0);
  const v = pool.find((_, i) => (r -= weights[i]) < 0) ?? pool.at(-1);
  return { voice: v.id, name: v.name, how: "picked at random from the pool, weighted by preference" };
}
// Groq Whisper, for word times: $0.04 an hour of audio, each request billed as at least 10 s.
const WHISPER = { id: "whisper-large-v3-turbo", usdPerHour: 0.04, minSeconds: 10 };

export function parseArgs(argv) {
  const a = { script: null, outDir: null, voice: DEFAULT_VOICE, style: "", model: "flash", start: 0.5, gap: 0.4, tag: null, dryRun: false, words: true, redo: [] };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${k} needs a value.\n${USAGE}`);
      return args[++i];
    };
    if (k === "--out-dir") a.outDir = next();
    else if (k === "--voice") a.voice = next();
    else if (k === "--style") a.style = next();
    else if (k === "--model") a.model = next();
    else if (k === "--start") a.start = Number(next());
    else if (k === "--gap") a.gap = Number(next());
    else if (k === "--tag") a.tag = next();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--no-words") a.words = false;
    else if (k === "--redo") a.redo = next().split(",").map((x) => x.trim()).filter(Boolean);
    else if (k.startsWith("--")) throw new Error(`Unknown option "${k}".\n${USAGE}`);
    else if (!a.script) a.script = k;
    else throw new Error(`Unexpected argument "${k}".\n${USAGE}`);
  }
  if (!a.script) throw new Error(`No script file given.\n${USAGE}`);
  if (!a.outDir) throw new Error(`--out-dir is needed.\n${USAGE}`);
  if (!MODELS[a.model]) throw new Error(`Unknown model "${a.model}". Use flash or lite.`);
  if (!(a.start >= 0) || !(a.gap >= 0)) throw new Error("--start and --gap need a number of seconds, 0 or more.");
  return a;
}

// Script text or JSON -> [{ id, text, style, pause }]
export function parseScript(raw, isJson) {
  const lines = [];
  if (isJson) {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("A JSON script must be an array.");
    for (const item of arr) {
      const o = typeof item === "string" ? { text: item } : item;
      if (!o.text || !String(o.text).trim()) continue;
      lines.push({ id: o.id ?? null, text: String(o.text).trim(), style: o.style ?? null, pause: Number(o.pause) || 0 });
    }
  } else {
    let pause = 0;
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^\[pause\s+([0-9.]+)\s*s?\]$/i);
      if (m) { pause += Number(m[1]); continue; }
      lines.push({ id: null, text: t, style: null, pause });
      pause = 0;
    }
  }
  if (!lines.length) throw new Error("The script has no spoken lines.");
  lines.forEach((l, i) => { l.id = String(l.id ?? String(i + 1).padStart(2, "0")); });
  if (new Set(lines.map((l) => l.id)).size !== lines.length) throw new Error("Two script lines share an id.");
  if (lines.some((l) => !/^[\w-]+$/.test(l.id))) throw new Error("Line ids may only use letters, digits, - and _.");
  return lines;
}

// Seconds of sound in a WAV file. Throws if it isn't one.
export function wavSeconds(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let byteRate = 0;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      if (!byteRate) break;
      return Math.min(size, buf.length - off - 8) / byteRate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no sound data");
}

// Wrap raw 16-bit mono PCM (what older TTS models return) in a WAV header.
export function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Start times: the first line at `start`, each next one `gap` (plus its own
// pause) after the previous line ends.
export function timeline(lines, start, gap) {
  let t = start;
  return lines.map((l, i) => {
    t += i === 0 ? l.pause : gap + l.pause;
    const s = round(t, 3);
    t += l.duration;
    return {
      id: l.id, text: l.text, file: l.file, start: s, duration: round(l.duration, 3), end: round(t, 3),
      ...(l.words ? { words: l.words } : {}),
    };
  });
}

// Words as compared between script and transcript: lower case, letters and digits only.
// British and American spellings count as the same word (a transcript writes
// "color" for "colour").
export const norm = (w) => w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "")
  .replace(/our/g, "or").replace(/is(e|ed|es|ing|ation|ations)$/, "iz$1").replace(/ys(e|ed|es|ing)$/, "yz$1")
  .replace(/tre(s?)$/, "ter$1").replace(/ll(ed|ing|er|ers)$/, "l$1").replace(/ogue(s?)$/, "og$1")
  .replace(/ence$/, "ense").replace(/^grey/, "gray");

// Give every script word a time, from a transcript's word times. Words the
// transcript also has take its time; the rest are spaced between their
// neighbours. Returns { words: [{ w, t }], missed: [script words not heard] }.
export function alignWords(text, heard, duration) {
  // Tags like <short pause> are directions, not words.
  const script = text.replace(/<[^>]+>/g, " ").split(/\s+/).map((w) => ({ w: w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""), n: norm(w) })).filter((x) => x.n);
  const said = heard.map((h) => ({ n: norm(h.word), t: h.start })).filter((x) => x.n);
  // Longest common subsequence of the two word lists.
  const A = script.length, B = said.length;
  const L = Array.from({ length: A + 1 }, () => new Array(B + 1).fill(0));
  for (let i = A - 1; i >= 0; i--) {
    for (let j = B - 1; j >= 0; j--) {
      L[i][j] = script[i].n === said[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const t = new Array(A).fill(null);
  for (let i = 0, j = 0; i < A && j < B;) {
    if (script[i].n === said[j].n) { t[i] = said[j].t; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const missed = script.filter((_, i) => t[i] === null).map((x) => x.w);
  for (let i = 0; i < A; i++) {
    if (t[i] !== null) continue;
    let a = i - 1, b = i + 1;
    while (b < A && t[b] === null) b++;
    const t0 = a >= 0 ? t[a] : 0, t1 = b < A ? t[b] : duration;
    t[i] = t0 + ((t1 - t0) * (i - a)) / (b - a); // spread evenly across the gap
  }
  return { words: script.map((x, i) => ({ w: x.w, t: round(t[i], 2) })), missed };
}

const NUMBER_WORDS = new Set((
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen " +
  "eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion " +
  "first second third percent dollars dollar cents cent point and a").split(" "));

// Script words a plain transcript of the audio does not contain, in order.
// Numbers are left out: a transcript writes "36" where the script says "thirty-six".
export function notHeard(text, heardText) {
  const heard = heardText.split(/\s+/).filter(Boolean).map((word) => ({ word, start: 0 }));
  return alignWords(text, heard, 1).missed.filter((w) => {
    if (/\d/.test(w)) return false;
    return !w.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).every((part) => NUMBER_WORDS.has(part));
  });
}

// Two transcriptions of one line. The first is given the script as a hint, so
// its words match the script's spelling and their times can be used. The
// second gets no hint, so it reports what the voice actually said.
async function hearWords(file, text, key) {
  const call = async (hint) => {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
    form.append("model", WHISPER.id);
    form.append("response_format", "verbose_json");
    if (hint) {
      form.append("timestamp_granularities[]", "word");
      form.append("prompt", text.replace(/<[^>]+>/g, " ").slice(0, 800));
    }
    return fetchJson(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form },
      "Groq transcription"
    );
  };
  const [timed, plain] = await Promise.all([call(true), call(false)]);
  return { heard: timed.words || [], heardText: (plain.text || "").trim() };
}

// "trim-level-1" names the finishing step below; changing it re-makes every line.
const lineKey = (l, a) => crypto.createHash("sha256").update(JSON.stringify([l.text, l.style ?? a.style, a.voice, MODELS[a.model].id, "trim-level-1"])).digest("hex").slice(0, 16);

const VOICE_LUFS = -20;
const KEEP_SILENCE = 0.05; // seconds left at each end, so words don't start or stop abruptly
let haveFfmpeg = null;

// Trim the silence at both ends of a line and bring it to VOICE_LUFS.
// Returns what it did, or null when ffmpeg is missing (the file is left as it came).
export function finishLine(file) {
  if (haveFfmpeg === null) haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  if (!haveFfmpeg) return null;
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`ffmpeg failed on ${path.basename(file)}: ${(r.stderr || "").slice(-300)}`);
  };
  const before = wavSeconds(fs.readFileSync(file));
  const trimmed = file.replace(/\.wav$/, ".trim.wav");
  const cut = `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=${KEEP_SILENCE}`;
  run(["-i", file, "-af", `${cut},areverse,${cut},areverse`, "-c:a", "pcm_s16le", trimmed]);
  const m = measure(trimmed);
  // One fixed gain: to the target loudness, but never pushing the peak above -1.5 dB.
  let gain = m.lufs === null ? 0 : VOICE_LUFS - m.lufs;
  if (m.peak !== null) gain = Math.min(gain, -1.5 - m.peak);
  run(["-i", trimmed, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", file]);
  fs.rmSync(trimmed, { force: true });
  return { trimmed_seconds: round(before - wavSeconds(fs.readFileSync(file)), 2), gain_db: round(gain, 1) };
}

function price(model, usage) {
  const u = usage || {};
  const tokens = { input: u.promptTokenCount || 0, audio_out: u.candidatesTokenCount || 0, total: u.totalTokenCount || 0 };
  const k = Date.now() >= PRICE_DOUBLES ? 2 : 1;
  return {
    tokens,
    cost_usd: round((k * (tokens.input * model.input + tokens.audio_out * model.audio_out)) / 1e6),
    cost_basis: `API usageMetadata x list price (${PRICES_CHECKED}${k === 2 ? ", doubled from 2027-01-01 as announced" : ""})`,
  };
}

async function speak(line, a, key) {
  const model = MODELS[a.model];
  const style = line.style ?? a.style;
  const body = {
    contents: [{ role: "user", parts: [{ text: line.text, ...(style ? { speech_metadata: { style } } : {}) }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: a.voice } } },
  };
  // The TTS models allow about 10 requests a minute. When the limit is hit,
  // wait as long as the error says and try again, rather than fail the run.
  let data;
  for (let attempt = 1; ; attempt++) {
    try {
      data = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
        { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) },
        "Gemini TTS"
      );
      break;
    } catch (err) {
      if (attempt >= 4 || !/\((429|500|503)\)/.test(err.message)) throw err;
      const said = err.message.match(/retry in ([0-9.]+)\s*s/i);
      const wait = Math.min(75, said ? Math.ceil(Number(said[1])) + 2 : 20 * attempt);
      process.stderr.write(`  line ${line.id}: rate limit or busy, waiting ${wait} s (try ${attempt} of 3)\n`);
      await sleep(wait * 1000);
    }
  }
  const priced = price(model, data.usageMetadata);
  if (data.promptFeedback?.blockReason) {
    throw Object.assign(new Error(`Line ${line.id} was blocked: ${data.promptFeedback.blockReason}`), { priced });
  }
  const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw Object.assign(new Error(`No audio came back for line ${line.id}.`), { priced });
  let wav = Buffer.from(part.inlineData.data, "base64");
  if (wav.toString("ascii", 0, 4) !== "RIFF") wav = pcmToWav(wav);
  return { wav, ...priced };
}

async function main() {
  const a = parseArgs(process.argv);
  if (!fs.existsSync(a.script)) throw new Error(`Script not found: ${a.script}`);
  const lines = parseScript(fs.readFileSync(a.script, "utf-8"), /\.json$/i.test(a.script));
  const outDir = path.resolve(a.outDir);
  const manifestPath = path.join(outDir, "narration.json");
  let old = {}, prev = {};
  if (fs.existsSync(manifestPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const l of prev.lines || []) old[l.id] = l;
    } catch { old = {}; prev = {}; }
  }
  const picked = pickVoice(a.voice, loadPool(), prev);
  a.voice = picked.voice;
  for (const l of lines) {
    l.key = lineKey(l, a);
    l.file = `${l.id}.wav`;
    l.cached = old[l.id]?.key === l.key && fs.existsSync(path.join(outDir, l.file)) && !a.redo.includes(l.id);
  }
  const unknown = a.redo.filter((id) => !lines.some((l) => l.id === id));
  if (unknown.length) throw new Error(`--redo names no such line: ${unknown.join(", ")}. Lines are ${lines.map((l) => l.id).join(", ")}.`);
  const todo = lines.filter((l) => !l.cached);

  if (a.dryRun) {
    const chars = todo.reduce((s, l) => s + l.text.length, 0);
    // About 15 characters a second of speech, 25 audio tokens a second.
    const estimate = round((chars / 15) * 25 * MODELS[a.model].audio_out / 1e6, 4);
    console.log(JSON.stringify({
      dry_run: true, model: MODELS[a.model].id, voice: a.voice, voice_name: picked.name, voice_how: picked.how, lines: lines.length, to_generate: todo.length,
      unchanged: lines.length - todo.length, estimated_cost_usd: estimate, estimated_seconds: Math.round(chars / 15),
    }, null, 2));
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const key = todo.length ? loadKey("GEMINI_API_KEY") : null;
  let cost = 0;
  let finished = true; // false when ffmpeg is missing and lines were left untrimmed
  const failures = [];
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      const base = { ts: new Date().toISOString(), kind: "narrate", model: MODELS[a.model].id, voice: a.voice, tag: a.tag, cwd: process.cwd() };
      try {
        const r = await speak(l, a, key);
        fs.writeFileSync(path.join(outDir, l.file), r.wav);
        finished = finishLine(path.join(outDir, l.file)) && finished;
        cost += r.cost_usd;
        logUsage({ ...base, tokens: r.tokens, cost_usd: r.cost_usd, success: true, audio_path: path.join(outDir, l.file) });
      } catch (err) {
        cost += err.priced?.cost_usd || 0;
        failures.push(err.message);
        // Keep the old key, so the next run makes this line again.
        l.failed = true;
        l.key = old[l.id]?.key ?? null;
        logUsage({ ...base, tokens: err.priced?.tokens ?? null, cost_usd: err.priced?.cost_usd ?? null, success: false, audio_path: null, error: err.message });
      }
    }
  }));
  const again = "The lines that worked are saved. Run the same command again to make only the ones that failed.";
  const have = (l) => fs.existsSync(path.join(outDir, l.file));
  if (!lines.every(have)) {
    // No sound at all for some line, so no timeline can be made. Record what
    // exists, and remove the old timeline: it no longer matches the sound files.
    fs.writeFileSync(manifestPath, JSON.stringify({ incomplete: true, lines: lines.filter(have).map((l) => ({ id: l.id, text: l.text, file: l.file, key: l.key })) }, null, 2) + "\n", "utf-8");
    fs.rmSync(path.join(outDir, "narration.js"), { force: true });
    throw new Error(`${failures.length} of ${todo.length} lines failed: ${failures.slice(0, 3).map((m) => m.replace(/\.+$/, "")).join(" | ")}. ${again}`);
  }

  for (const l of lines) l.duration = wavSeconds(fs.readFileSync(path.join(outDir, l.file)));

  // Word times, and a check that the voice said what the script says.
  let wordsNote = null;
  const misheard = [];
  if (a.words) {
    let groq = null;
    try { groq = loadKey("GROQ_API_KEY"); } catch { wordsNote = "No GROQ_API_KEY, so word times were skipped: n03:word times won't work, only n03 and n03.end."; }
    if (groq) {
      // A failed line still has its previous sound file, so its previous word times still fit.
      const keep = (l) => (l.cached || l.failed) && old[l.id]?.words;
      const pending = lines.filter((l) => !keep(l) && !l.failed);
      for (const l of lines) if (keep(l)) l.words = old[l.id].words;
      const q = [...pending];
      const errors = [];
      await Promise.all(Array.from({ length: Math.min(PARALLEL, q.length) }, async () => {
        for (let l = q.shift(); l; l = q.shift()) {
          const base = { ts: new Date().toISOString(), kind: "narrate-words", model: WHISPER.id, tag: a.tag, cwd: process.cwd() };
          try {
            const { heard, heardText } = await hearWords(path.join(outDir, l.file), l.text, groq);
            const al = alignWords(l.text, heard, l.duration);
            l.words = al.words;
            const missing = notHeard(l.text, heardText);
            if (missing.length) misheard.push({ id: l.id, script: l.text, heard: heardText, not_heard: missing });
            l.heard = heardText;
            const c = round(2 * (Math.max(WHISPER.minSeconds, l.duration) / 3600) * WHISPER.usdPerHour);
            cost += c;
            logUsage({ ...base, tokens: null, cost_usd: c, success: true, audio_path: path.join(outDir, l.file) });
          } catch (err) {
            errors.push(err.message);
            logUsage({ ...base, tokens: null, cost_usd: null, success: false, audio_path: path.join(outDir, l.file), error: err.message });
          }
        }
      }));
      if (errors.length) wordsNote = `Word times failed for ${errors.length} line(s): ${errors[0]}`;
    }
  }
  const timed = timeline(lines, a.start, a.gap);
  const total = timed.at(-1).end;
  const manifest = {
    voice: a.voice, voice_name: picked.name, voice_how: picked.how, model: MODELS[a.model].id, style: a.style, start: a.start, gap: a.gap, total: round(total, 3),
    lines: timed.map((t, i) => ({ ...t, key: lines[i].key })),
    ...(misheard.length ? { check_these_lines: misheard } : {}),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  fs.writeFileSync(
    path.join(outDir, "narration.js"),
    `// Written by narrate.js. Do not edit: change the script and run narrate.js again.\nwindow.NARRATION = ${JSON.stringify(timed, null, 2)};\nwindow.NARRATION_END = ${round(total, 3)};\n`,
    "utf-8"
  );
  if (failures.length) {
    // The timeline above matches the sound files on disk; failed lines still hold their previous sound.
    throw new Error(`${failures.length} of ${todo.length} lines failed: ${failures.slice(0, 3).map((m) => m.replace(/\.+$/, "")).join(" | ")}. ${again}`);
  }
  console.log(JSON.stringify({
    success: true, out_dir: outDir, lines: timed.length, generated: todo.length, unchanged: lines.length - todo.length,
    narration_ends_at: round(total, 3), cost_usd: round(cost), voice: a.voice, voice_name: picked.name, voice_how: picked.how, model: MODELS[a.model].id,
    word_times: lines.every((l) => l.words) ? "yes" : (wordsNote || "skipped (--no-words)"),
    ...(finished ? {} : { note: "ffmpeg was not found, so lines were not trimmed or levelled. Install ffmpeg and run again with --redo for each line." }),
    ...(misheard.length ? { check_these_lines: misheard } : {}),
    timeline: timed.map((t) => ({ id: t.id, start: t.start, end: t.end, text: t.text.length > 60 ? t.text.slice(0, 57) + "..." : t.text })),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  });
}
