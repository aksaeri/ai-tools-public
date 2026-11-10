#!/usr/bin/env node
// Turn an animated HTML page (a "composition") into a video, or into still
// frames for checking it. Headless Chrome draws each frame; ffmpeg encodes.
//
//   node render.js comp.html --out video.mp4          # the whole video
//   node render.js comp.html --out part.mp4 --from 4 --to 9
//   node render.js comp.html --sheet every=1 --out sheet.jpg     # contact sheet, one frame a second
//   node render.js comp.html --sheet 0.5,3,7.2 --out sheet.jpg   # ... or at chosen times
//   node render.js comp.html --strip 2.1:2.6 --out strip.jpg     # every frame of a moment
//   node render.js comp.html --frame 3.2 --out frame.png         # one full-size frame
//   node render.js comp.html --check [--json]                    # layout and pacing problems
//   node render.js video.mp4 --sheet every=2 --out sheet.jpg     # --sheet, --strip and --frame also read a finished video
//
// The page says how big and long it is on its <html> tag:
//   <html data-width="1920" data-height="1080" data-fps="30" data-duration="24.5">
// Sound comes from <audio src="..." data-start="3.2"> elements and from <video>
// elements that are not muted. data-role="voice" marks narration and
// data-role="music" a music bed: music is levelled under the voice and lowered
// while it speaks (see lib/mix.js). data-volume scales a track, data-fade-out="2"
// fades it out over the video's last 2 seconds, data-loop repeats a short one.
// The finished sound is brought to -14 LUFS; --loudness -16 changes that, --loudness off skips it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Browser } from "./lib/chrome.js";
import { VIRTUAL_TIME } from "./lib/virtual-time.js";
import { INSPECT, analyse } from "./lib/check.js";
import { MASTER_LUFS, buildMix, masterFilter, measure, mixWarnings } from "./lib/mix.js";

const USAGE =
  "Usage: node render.js comp.html (--out video.mp4 | --sheet every=1|t1,t2 | --strip a:b | --frame t | --check) " +
  "[--out file] [--from s] [--to s] [--workers n] [--crf 18] [--loudness -14|off] [--cols 6] [--w 480] [--json]";

export function parseArgs(argv) {
  const a = {
    comp: null, out: null, mode: "render", sheet: null, strip: null, frame: null,
    from: null, to: null, workers: null, crf: 18, cols: 6, w: 480, json: false,
    width: null, height: null, fps: null, duration: null, keepFrames: false, loudness: MASTER_LUFS,
  };
  const args = argv.slice(2);
  const num = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${flag} needs a number.\n${USAGE}`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${k} needs a value.\n${USAGE}`);
      return args[++i];
    };
    if (k === "--out") a.out = next();
    else if (k === "--sheet") { a.mode = "sheet"; a.sheet = next(); }
    else if (k === "--strip") { a.mode = "sheet"; a.strip = next(); }
    else if (k === "--frame") { a.mode = "frame"; a.frame = num(k, next()); }
    else if (k === "--check") a.mode = "check";
    else if (k === "--json") a.json = true;
    else if (k === "--keep-frames") a.keepFrames = true;
    else if (k === "--loudness") {
      const v = next();
      a.loudness = v === "off" ? null : num(k, v);
      if (a.loudness !== null && (a.loudness > -5 || a.loudness < -40)) throw new Error("--loudness needs a level between -40 and -5 (LUFS), or off.");
    }
    else if (["--from", "--to", "--workers", "--crf", "--cols", "--w", "--width", "--height", "--fps", "--duration"].includes(k)) {
      a[k.slice(2)] = num(k, next());
    } else if (k.startsWith("--")) throw new Error(`Unknown option "${k}".\n${USAGE}`);
    else if (!a.comp) a.comp = k;
    else throw new Error(`Unexpected argument "${k}".\n${USAGE}`);
  }
  if (!a.comp) throw new Error(`No composition file given.\n${USAGE}`);
  if (a.mode !== "check" && !a.out) throw new Error(`--out is needed.\n${USAGE}`);
  return a;
}

// Size, frame rate and length, from the <html data-*> attributes; flags win.
export function readMeta(html, args = {}) {
  const tag = (html.match(/<html\b[^>]*>/i) || [""])[0];
  const attr = (name) => {
    const m = tag.match(new RegExp(`data-${name}\\s*=\\s*["']?([0-9.]+)`, "i"));
    return m ? Number(m[1]) : null;
  };
  const meta = {
    width: args.width ?? attr("width") ?? 1920,
    height: args.height ?? attr("height") ?? 1080,
    fps: args.fps ?? attr("fps") ?? 30,
    duration: args.duration ?? attr("duration"),
  };
  if (meta.width % 2 || meta.height % 2) throw new Error("Width and height must be even numbers (the video encoder needs that).");
  if (meta.fps < 1 || meta.fps > 120) throw new Error("fps must be between 1 and 120.");
  return withFrames(meta);
}

// duration may still be unknown here: the page can set it (window.VIDEO_DURATION).
function withFrames(meta) {
  if (meta.duration > 0) meta.frames = Math.max(1, Math.round(meta.duration * meta.fps));
  return meta;
}

// Frame numbers for --sheet "every=1" | "0.5,3,7.2" and --strip "2.1:2.6".
export function sheetFrames({ sheet, strip }, meta) {
  const clamp = (f) => Math.min(meta.frames - 1, Math.max(0, f));
  let frames;
  if (strip) {
    const [a, b] = strip.split(":").map(Number);
    if (!(b >= a)) throw new Error('--strip needs "start:end" in seconds, such as 2.1:2.6');
    frames = [];
    for (let f = Math.round(a * meta.fps); f <= Math.round(b * meta.fps); f++) frames.push(clamp(f));
  } else if (/^every=/.test(sheet)) {
    const step = Number(sheet.slice(6));
    if (!(step > 0)) throw new Error('--sheet every=N needs a number of seconds, such as every=1');
    frames = [];
    for (let t = 0; t < meta.duration; t += step) frames.push(clamp(Math.round(t * meta.fps)));
    frames.push(meta.frames - 1);
  } else {
    frames = sheet.split(",").map((t) => clamp(Math.round(Number(t) * meta.fps)));
    if (frames.some(Number.isNaN)) throw new Error('--sheet needs times in seconds ("0.5,3,7.2") or "every=1"');
  }
  frames = [...new Set(frames)].sort((x, y) => x - y);
  if (frames.length > 400) throw new Error(`That is ${frames.length} frames; a sheet holds at most 400. Use a larger step or a shorter strip.`);
  return frames;
}

// Split frames 0..n-1 into contiguous chunks, one per worker.
export function chunks(list, n) {
  const size = Math.ceil(list.length / n);
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Wait for a promise, but no longer than ms. The timer is cleared so it can't
// keep the process alive after the work is done.
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((r) => { timer = setTimeout(r, ms); })]).finally(() => clearTimeout(timer));
}

function progress(msg) {
  process.stderr.write(msg + "\n");
}

async function openComp(compPath, meta) {
  const browser = await Browser.launch(meta);
  try {
    const page = await browser.newPage(meta);
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: VIRTUAL_TIME + "\n" + INSPECT });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: pathToFileURL(path.resolve(compPath)).href });
    await withTimeout(loaded, 30_000);
    await page.eval("window.__vt.ready()");
    return { browser, page };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// Draw the given frames (ascending frame numbers) and save each as an image.
// Time is stepped through every frame from 0, so pages that keep state between
// frames (canvas drawings, counters) come out right; only listed frames are painted.
async function capture(compPath, meta, frames, fileFor, { format = "jpeg", onFrame } = {}) {
  const { browser, page } = await openComp(compPath, meta);
  try {
    let done = -1;
    for (const f of frames) {
      await page.eval(`window.__vt.runTo(${f}, ${meta.fps}, ${done + 1})`);
      done = f;
      const shot = await page.send("Page.captureScreenshot", {
        format, ...(format === "jpeg" ? { quality: 95 } : {}), optimizeForSpeed: format === "jpeg",
      });
      fs.writeFileSync(fileFor(f), Buffer.from(shot.data, "base64"));
      onFrame?.(f);
    }
    const errors = [...(await page.eval("window.__vt.errors")), ...browser.consoleErrors.filter(Boolean)];
    return { errors };
  } finally {
    await browser.close();
  }
}

// Sound sources the page declares, with local file paths.
async function audioTracks(compPath, meta) {
  const { browser, page } = await openComp(compPath, meta);
  try {
    const raw = await page.eval(`(() => {
      const out = [];
      for (const a of document.querySelectorAll("audio")) {
        const src = a.currentSrc || a.src;
        if (src) out.push({ src, start: parseFloat(a.dataset.start || "0"), volume: parseFloat(a.dataset.volume || "1"), kind: "audio",
          role: a.dataset.role || "effect", duck: a.dataset.duck !== "off",
          fadeOut: parseFloat(a.dataset.fadeOut || "0"), loop: a.loop || a.hasAttribute("data-loop") });
      }
      for (const v of document.querySelectorAll("video")) {
        const src = v.currentSrc || v.src;
        if (src && !v.muted && !v.hasAttribute("muted")) {
          out.push({ src, start: parseFloat(v.dataset.start || "0"), volume: parseFloat(v.dataset.volume || "1"), kind: "video", role: "clip" });
        }
      }
      return out;
    })()`);
    const tracks = [];
    for (const t of raw) {
      if (!t.src.startsWith("file:")) throw new Error(`Sound must come from a local file, not ${t.src.slice(0, 80)}`);
      const file = fileURLToPath(t.src);
      if (!fs.existsSync(file)) throw new Error(`Sound file not found: ${file}`);
      if (t.kind === "video") {
        const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf-8" });
        if (!probe.stdout.trim()) continue; // a silent clip
      }
      tracks.push({ file, start: Math.max(0, t.start), volume: t.volume, role: t.role, duck: t.duck !== false, fadeOut: t.fadeOut || 0, loop: !!t.loop });
    }
    return tracks;
  } finally {
    await browser.close();
  }
}

function needFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" });
  if (r.error || r.status !== 0) throw new Error("ffmpeg was not found. Install it and make sure it is on the PATH.");
}

// The encode: frames from Chrome, plus the mixed sound (if any) with the
// master chain applied.
export function ffmpegArgs({ framesPattern, meta, mixWav, audioFilter, out, crf, seconds }) {
  const args = ["-y", "-v", "error", "-framerate", String(meta.fps), "-i", framesPattern];
  if (mixWav) args.push("-i", mixWav);
  const filters = ["[0:v]scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p[v]"];
  if (mixWav) filters.push(`[1:a]${audioFilter}[a]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[v]");
  if (mixWav) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart", "-t", String(seconds), out
  );
  return args;
}

async function renderVideo(args, meta) {
  needFfmpeg();
  const first = args.from != null ? Math.max(0, Math.round(args.from * meta.fps)) : 0;
  const last = args.to != null ? Math.min(meta.frames, Math.round(args.to * meta.fps)) : meta.frames;
  if (last <= first) throw new Error("--to must be later than --from.");
  const frames = Array.from({ length: last - first }, (_, i) => first + i);
  const workers = Math.max(1, Math.min(args.workers ?? Math.min(4, Math.floor(os.cpus().length / 2) || 1), frames.length));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genvideo-frames-"));
  const t0 = Date.now();
  try {
    const fileFor = (f) => path.join(tmp, `${String(f - first).padStart(6, "0")}.jpg`);
    let count = 0;
    const onFrame = () => {
      count += 1;
      if (count % Math.max(30, Math.round(frames.length / 10)) === 0) progress(`  ${count}/${frames.length} frames`);
    };
    progress(`Drawing ${frames.length} frames (${meta.width}x${meta.height}, ${meta.fps} fps) with ${workers} worker${workers > 1 ? "s" : ""}`);
    const [tracks, ...results] = await Promise.all([
      audioTracks(args.comp, meta),
      ...chunks(frames, workers).map((chunk) => capture(args.comp, meta, chunk, fileFor, { onFrame })),
    ]);
    const errors = [...new Set(results.flatMap((r) => r.errors))];
    const seconds = frames.length / meta.fps;
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    let mix = null;
    if (tracks.length) {
      progress(`Mixing ${tracks.length} sound track${tracks.length > 1 ? "s" : ""}`);
      mix = buildMix(tracks, meta, tmp);
    }
    progress("Encoding");
    const ff = spawnSync("ffmpeg", ffmpegArgs({
      framesPattern: path.join(tmp, "%06d.jpg"), meta, out: args.out, crf: args.crf, seconds,
      mixWav: mix?.mixWav,
      audioFilter: mix && masterFilter({ mixLufs: mix.mixLufs, target: args.loudness, from: first / meta.fps, seconds }),
    }), { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${(ff.stderr || "").slice(-600)}`);
    let sound = null;
    if (mix) {
      // Measure the finished file: it is the only way to know how it will sound.
      const done = measure(args.out);
      sound = { ...mix.report, loudness_lufs: done.lufs, true_peak_db: done.peak };
      delete sound.mix_lufs_before_master;
      const warnings = mixWarnings(sound, first === 0 && last === meta.frames ? args.loudness : null);
      if (warnings.length) sound.warnings = warnings;
    }
    return {
      success: true, video_path: path.resolve(args.out), seconds: Math.round(seconds * 1000) / 1000,
      frames: frames.length, fps: meta.fps, width: meta.width, height: meta.height,
      sound_tracks: tracks.length, ...(sound ? { sound } : {}), render_seconds: Math.round((Date.now() - t0) / 100) / 10,
      size_mb: Math.round((fs.statSync(args.out).size / 1048576) * 10) / 10,
      ...(errors.length ? { page_errors: errors.slice(0, 10) } : {}),
    };
  } finally {
    if (!args.keepFrames) fs.rmSync(tmp, { recursive: true, force: true });
    else progress(`Frames kept in ${tmp}`);
  }
}

const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv)$/i;

// Size, frame rate and length of a finished video file.
function videoMeta(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf-8" });
  if (r.error || r.status !== 0) throw new Error(`Could not read ${file} with ffprobe: ${(r.stderr || r.error?.message || "").slice(0, 200)}`);
  const d = JSON.parse(r.stdout);
  const st = d.streams?.[0];
  if (!st) throw new Error(`${file} has no video in it.`);
  const [n, den] = String(st.r_frame_rate).split("/").map(Number);
  return withFrames({ width: st.width, height: st.height, fps: den ? n / den : n, duration: Number(d.format.duration) });
}

// The same job as capture(), for a finished video: pull the frames out with ffmpeg.
function captureFromVideo(file, meta, frames, fileFor) {
  for (const f of frames) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(f / meta.fps), "-i", file, "-frames:v", "1", "-q:v", "2", fileFor(f)], { encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`ffmpeg could not read a frame at ${(f / meta.fps).toFixed(2)} s: ${(r.stderr || "").slice(-300)}`);
  }
  return { errors: [] };
}

// A contact sheet: small frames in a grid, each labelled with its time.
async function renderSheet(args, meta) {
  const frames = sheetFrames(args, meta);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genvideo-sheet-"));
  try {
    const fileFor = (f) => path.join(tmp, `${f}.jpg`);
    const { errors } = VIDEO_FILE.test(args.comp)
      ? captureFromVideo(args.comp, meta, frames, fileFor)
      : await capture(args.comp, meta, frames, fileFor);
    const cols = Math.min(args.cols, frames.length);
    const w = args.w;
    const h = Math.round((w * meta.height) / meta.width);
    const rows = Math.ceil(frames.length / cols);
    const label = 22;
    const gap = 6;
    const sheet = { width: cols * (w + gap) + gap, height: rows * (h + label + gap) + gap };
    const cells = frames.map((f) =>
      `<figure><img src="${pathToFileURL(fileFor(f)).href}" width="${w}" height="${h}"><figcaption>${(f / meta.fps).toFixed(2)} s</figcaption></figure>`
    ).join("");
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:${gap}px;background:#222;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:${gap}px;width:${sheet.width - 2 * gap}px}
      figure{margin:0}img{display:block}figcaption{font:13px/${label}px system-ui,sans-serif;color:#eee;height:${label}px}
    </style>${cells}`;
    const sheetHtml = path.join(tmp, "sheet.html");
    fs.writeFileSync(sheetHtml, html, "utf-8");
    const browser = await Browser.launch(sheet);
    try {
      const page = await browser.newPage(sheet);
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: pathToFileURL(sheetHtml).href });
      await withTimeout(loaded, 30_000);
      await page.eval("Promise.all([...document.images].map((i) => i.decode().catch(() => null)))");
      const png = /\.png$/i.test(args.out);
      const shot = await page.send("Page.captureScreenshot", { format: png ? "png" : "jpeg", ...(png ? {} : { quality: 90 }) });
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      fs.writeFileSync(args.out, Buffer.from(shot.data, "base64"));
    } finally {
      await browser.close();
    }
    return {
      success: true, sheet_path: path.resolve(args.out), frames: frames.length,
      times: frames.map((f) => Math.round((f / meta.fps) * 100) / 100),
      ...(errors.length ? { page_errors: errors.slice(0, 10) } : {}),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function renderFrame(args, meta) {
  const f = Math.min(meta.frames - 1, Math.max(0, Math.round(args.frame * meta.fps)));
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  const format = /\.jpe?g$/i.test(args.out) ? "jpeg" : "png";
  const { errors } = VIDEO_FILE.test(args.comp)
    ? captureFromVideo(args.comp, meta, [f], () => args.out)
    : await capture(args.comp, meta, [f], () => args.out, { format });
  return {
    success: true, frame_path: path.resolve(args.out), time: Math.round((f / meta.fps) * 1000) / 1000,
    ...(errors.length ? { page_errors: errors.slice(0, 10) } : {}),
  };
}

// Step through the whole video without drawing it, noting where every piece
// of text is four times a second, then report layout and pacing problems.
async function checkComp(args, meta) {
  const { browser, page } = await openComp(args.comp, meta);
  try {
    const every = Math.max(1, Math.round(meta.fps / 4));
    const samples = [];
    let done = -1;
    for (let f = 0; f < meta.frames; f += every) {
      await page.eval(`(async () => { for (let f = ${done + 1}; f <= ${f}; f++) await window.__vt.step(f * 1000 / ${meta.fps}, false); })()`);
      done = f;
      samples.push({ t: f / meta.fps, items: await page.eval("window.__vtInspect()") });
    }
    const errors = [...(await page.eval("window.__vt.errors")), ...browser.consoleErrors.filter(Boolean)];
    return analyse(samples, meta, every / meta.fps, errors);
  } finally {
    await browser.close();
  }
}

// Size and length of the composition. When the <html> tag gives no length,
// load the page once and ask it (stage.js works it out from the narration).
async function resolveMeta(args) {
  const meta = readMeta(fs.readFileSync(args.comp, "utf-8"), args);
  if (!(meta.duration > 0)) {
    const { browser, page } = await openComp(args.comp, meta);
    try {
      meta.duration = Number(await page.eval("window.VIDEO_DURATION || null"));
    } finally {
      await browser.close();
    }
    if (!(meta.duration > 0)) {
      throw new Error('The composition must say how long it is: <html data-duration="12.5"> (seconds), window.VIDEO_DURATION, or --duration.');
    }
    withFrames(meta);
  }
  return meta;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.comp)) throw new Error(`Composition not found: ${args.comp}`);
  const isVideo = VIDEO_FILE.test(args.comp);
  if (isVideo && (args.mode === "render" || args.mode === "check")) {
    throw new Error(`${path.basename(args.comp)} is a finished video. --check and rendering need the composition (the .html page). On a video, use --sheet, --strip or --frame.`);
  }
  if (isVideo) needFfmpeg();
  const meta = isVideo ? videoMeta(args.comp) : await resolveMeta(args);
  if (args.mode === "check") {
    const report = await checkComp(args, meta);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(report.text);
    return;
  }
  const result = args.mode === "sheet" ? await renderSheet(args, meta)
    : args.mode === "frame" ? await renderFrame(args, meta)
    : await renderVideo(args, meta);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  });
}
