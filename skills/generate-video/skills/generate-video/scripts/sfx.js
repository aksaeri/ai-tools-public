#!/usr/bin/env node
// Sound effects for a composed video: made from scratch with ffmpeg, or found
// in a free library.
//
//   node sfx.js make whoosh --out sfx/whoosh.wav [--variant 2]   # synthesise one
//   node sfx.js make all --out-dir sfx                           # synthesise the whole set
//   node sfx.js find "page turn" --out sfx/page.mp3 [--max-seconds 6] [--dry-run]
//   node sfx.js list
//
// "make" needs only ffmpeg: no network, no key, nothing to credit, and the
// same sound every time. "find" searches Openverse (no key needed) for
// recordings released as CC0 (public domain, no credit required) and saves the
// first short one, with a note of where it came from.
//
// The set has been listened to and approved by a person (November 2026). The
// agent placing them still can't hear the result: use few, each with a cause
// on screen, and tell the user the finished mix was not listened to.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { fetchJson } from "./lib/common.js";

const USAGE =
  "Usage: node sfx.js make <name|all> (--out file.wav | --out-dir dir) [--variant 1|2|3]\n" +
  '       node sfx.js find "what to look for" --out file.mp3 [--max-seconds 6] [--dry-run]\n' +
  "       node sfx.js list";

// A band of noise that sweeps up and back down: something passing by.
function whoosh({ d, peak, f0, f1, f2, seed }) {
  const fc = `if(lt(pts/sr,${peak}),${f0}*pow(${f1}/${f0},pts/sr/${peak}),${f1}*pow(${f2}/${f1},(pts/sr-${peak})/${(d - peak).toFixed(3)}))`;
  const band = `exp(-pow(log((b+1)*sr/(2*nb)/(${fc})),2)/0.18)`;
  return {
    src: `anoisesrc=c=pink:d=${d}:r=48000:a=0.9:seed=${seed}`,
    af: `afftfilt=real='re*${band}':imag='im*${band}':win_size=1024,` +
      `volume=eval=frame:volume='if(lt(t,${peak}),pow(t/${peak},2),exp(-(t-${peak})/0.09))',` +
      "aformat=channel_layouts=stereo,apulsator=hz=0.65:offset_l=0:offset_r=0.5:amount=0.6,volume=6dB",
  };
}

// Each recipe: what it is for, and how to make it. Peaks sit around -15 dB,
// about 10 dB under narration, so an effect never competes with the voice.
export const SOUNDS = {
  whoosh: {
    use: "a panel, card or scene sliding or changing size. Rotate the three variants; the same one on every move is a giveaway.",
    variants: [
      () => whoosh({ d: 0.75, peak: 0.42, f0: 350, f1: 2600, f2: 1300, seed: 11 }),
      () => whoosh({ d: 0.6, peak: 0.32, f0: 500, f1: 3200, f2: 1500, seed: 23 }),
      () => whoosh({ d: 0.9, peak: 0.5, f0: 280, f1: 2000, f2: 900, seed: 37 }),
    ],
  },
  tick: {
    use: "a digit changing, a list item or a typed character arriving. At most one every 60 ms.",
    variants: [() => ({
      src: "aevalsrc='0.5*sin(2*PI*2800*t)*exp(-t/0.005)+0.6*(random(0)*2-1)*exp(-t/0.0018)':d=0.06:s=48000",
      af: "highpass=f=1500,volume=-14dB",
    })],
  },
  pop: {
    use: "a number, badge or icon landing.",
    variants: [
      () => ({ src: "aevalsrc='sin(2*PI*(400*t+(450/2)*t*t/0.045*lt(t,0.045)+450*(t-0.0225)*gte(t,0.045)))*exp(-t/0.03)':d=0.25:s=48000", af: "volume=-16dB" }),
      () => ({ src: "aevalsrc='sin(2*PI*(520*t+(520/2)*t*t/0.04*lt(t,0.04)+520*(t-0.02)*gte(t,0.04)))*exp(-t/0.028)':d=0.25:s=48000", af: "volume=-16dB" }),
    ],
  },
  thud: {
    use: "something heavy landing; the one big point. A low drop with a short knock on top, so it still reads on a phone speaker.",
    variants: [() => ({
      src: "aevalsrc='sin(2*PI*(42*t+68*0.07*(1-exp(-t/0.07))))*exp(-t/0.09)+0.22*(random(0)*2-1)*exp(-t/0.012)':d=0.6:s=48000",
      af: "lowpass=f=2400,volume=-10dB",
    })],
  },
  puff: {
    use: "a soft burst: snow, dust, a cushion, something landing in something soft.",
    variants: [() => ({
      src: "anoisesrc=c=pink:d=0.45:r=48000:a=0.9:seed=5",
      af: "volume=eval=frame:volume='min(t/0.012,1)*exp(-t/0.085)',lowpass=f=2600,highpass=f=120,volume=2dB",
    })],
  },
  riser: {
    use: "the second and a half before the one big reveal. It ends hard, on the reveal. Once per video.",
    variants: [() => ({
      src: "anoisesrc=c=pink:d=1.5:r=48000:a=0.9:seed=7",
      af: "afftfilt=real='re*lt((b+1)*sr/(2*nb),300*pow(7000/300,pts/sr/1.5))':imag='im*lt((b+1)*sr/(2*nb),300*pow(7000/300,pts/sr/1.5))':win_size=1024," +
        "volume=eval=frame:volume='pow(t/1.5,3)',afade=t=out:st=1.47:d=0.03,volume=-6dB",
    })],
  },
  chime: {
    use: "done, success, a tick in a box. The most synthetic-sounding of the set; use sparingly.",
    variants: [() => ({
      src: "aevalsrc='(sin(2*PI*784*t)+0.35*sin(2*PI*1568*t)*exp(-t/0.2)+0.2*sin(2*PI*2164*t)*exp(-t/0.12))*exp(-t/0.35)*0.4+gte(t,0.11)*(sin(2*PI*1046.5*(t-0.11))+0.35*sin(2*PI*2093*(t-0.11))*exp(-(t-0.11)/0.2))*exp(-(t-0.11)/0.45)*0.45':d=1.6:s=48000",
      af: "volume=-14dB",
    })],
  },
};

export function parseArgs(argv) {
  const a = { cmd: argv[2], what: null, out: null, outDir: null, variant: 1, maxSeconds: 6, dryRun: false };
  const args = argv.slice(3);
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${k} needs a value.\n${USAGE}`);
      return args[++i];
    };
    if (k === "--out") a.out = next();
    else if (k === "--out-dir") a.outDir = next();
    else if (k === "--variant") a.variant = Number(next());
    else if (k === "--max-seconds") a.maxSeconds = Number(next());
    else if (k === "--dry-run") a.dryRun = true;
    else if (k.startsWith("--")) throw new Error(`Unknown option "${k}".\n${USAGE}`);
    else words.push(k);
  }
  a.what = words.join(" ").trim();
  if (!["make", "find", "list"].includes(a.cmd)) throw new Error(USAGE);
  if (a.cmd !== "list" && !a.what) throw new Error(`Say which sound.\n${USAGE}`);
  if (a.cmd === "make" && a.what !== "all" && !SOUNDS[a.what]) {
    throw new Error(`No sound called "${a.what}". There are: ${Object.keys(SOUNDS).join(", ")}. For anything else, use "find".`);
  }
  if (a.cmd === "make" && a.what === "all" && !a.outDir) throw new Error("make all needs --out-dir.");
  if (a.cmd === "make" && a.what !== "all" && !a.out) throw new Error("make needs --out.");
  if (a.cmd === "find" && !a.out && !a.dryRun) throw new Error("find needs --out.");
  return a;
}

function make(name, variant, out) {
  const list = SOUNDS[name].variants;
  const recipe = list[(Math.max(1, variant) - 1) % list.length]();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", recipe.src, "-af", `${recipe.af},aformat=channel_layouts=stereo`, "-ar", "48000", "-c:a", "pcm_s16le", out], { encoding: "utf-8" });
  if (r.error) throw new Error("ffmpeg was not found. Install it and make sure it is on the PATH.");
  if (r.status !== 0) throw new Error(`ffmpeg could not make "${name}": ${(r.stderr || "").slice(-300)}`);
  return path.resolve(out);
}

// Openverse results -> the first one that is short enough and has a file to fetch.
export function pick(results, maxSeconds) {
  return (results || []).find((r) => r.url && r.license === "cc0" && r.duration > 150 && r.duration <= maxSeconds * 1000) || null;
}

async function find(a) {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(a.what)}&license=cc0&page_size=20`;
  const data = await fetchJson(url, { headers: { "User-Agent": "generate-video-skill" }, timeoutMs: 30_000 }, "Openverse");
  const hit = pick(data.results, a.maxSeconds);
  if (!hit) {
    return { success: false, error: `Nothing public-domain and under ${a.maxSeconds} s was found for "${a.what}" (${data.result_count ?? 0} results in all). Try other words, a larger --max-seconds, or "make".` };
  }
  const info = {
    title: hit.title, by: hit.creator, licence: "CC0 1.0 (public domain; no credit required)",
    seconds: Math.round(hit.duration / 100) / 10, page: hit.foreign_landing_url, file_url: hit.url, searched_for: a.what,
  };
  if (a.dryRun) return { dry_run: true, would_save: info };
  const r = await fetch(hit.url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return { success: false, error: `Found "${hit.title}" but could not download it (${r.status}).` };
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  // Kept beside the sound, so anyone can check where it came from.
  fs.writeFileSync(out + ".source.json", JSON.stringify(info, null, 2) + "\n", "utf-8");
  return { success: true, audio_path: out, ...info };
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.cmd === "list") {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(SOUNDS).map(([k, v]) => [k, { variants: v.variants.length, use: v.use }])), null, 2));
    return;
  }
  if (a.cmd === "make") {
    const made = [];
    if (a.what === "all") {
      for (const [name, s] of Object.entries(SOUNDS)) {
        s.variants.forEach((_, i) => made.push(make(name, i + 1, path.join(a.outDir, s.variants.length > 1 ? `${name}-${i + 1}.wav` : `${name}.wav`))));
      }
    } else made.push(make(a.what, a.variant, a.out));
    console.log(JSON.stringify({ success: true, made, note: "Use few, each with a cause on screen. You can't hear how they sit in the video, so tell the user the finished sound was not listened to." }, null, 2));
    return;
  }
  const result = await find(a);
  if (result.success === false) throw new Error(result.error);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  });
}
