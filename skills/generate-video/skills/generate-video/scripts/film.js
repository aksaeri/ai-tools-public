#!/usr/bin/env node
// Make a short realistic clip with a video model: people, places, action.
//
//   node film.js "a red fox trots across a frozen lake at sunset" [--seconds 5] [--resolution 720p]
//        [--aspect 16:9] [--image first-frame.jpg] [--last-frame end.jpg] [--ref look.jpg ...]
//        [--model omni|wan|seedance|<id>] [--tag label] [--out clip.mp4] [--dry-run]
//
// Default model: Gemini Omni 1.2 Flash through the Gemini API (GEMINI_API_KEY).
// Model ids with a slash (alibaba/wan-3.0, bytedance/seedance-2.5, ...) go
// through OpenRouter (OPENROUTER_API_KEY). Keys are read from ~/.claude/.env.
// --dry-run checks the request and prints the estimated cost without calling.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { OUT_DIR, loadKey, logUsage, round, fetchJson, sleep } from "./lib/common.js";

const USAGE =
  'Usage: node film.js "what happens in the clip" [--seconds 5] [--resolution 720p] [--aspect 16:9] ' +
  "[--image first.jpg] [--last-frame end.jpg] [--ref look.jpg ...] [--model omni|wan|seedance|<id>] " +
  "[--tag label] [--out clip.mp4] [--dry-run]";

const ALIASES = {
  omni: "gemini-omni-1.2-flash",
  wan: "alibaba/wan-3.0",
  seedance: "bytedance/seedance-2.5",
};
const DEFAULT_MODEL = "omni";

// Gemini Omni 1.2 Flash, from the Gemini API docs and pricing page (checked 2026-11-10).
// Video is billed by output tokens at a fixed rate per second for each resolution.
const OMNI = {
  id: "gemini-omni-1.2-flash",
  seconds: [3, 15],
  resolutions: { "360p": 1931, "720p": 5792, "1080p": 8688, "4k": 17376 }, // tokens per second
  aspects: ["16:9", "9:16"],
  maxRefs: 6,
  usdPerM: { input: 1.5, video_out: 12, text_out: 9 },
};
const PRICES_CHECKED = "2026-11-10";

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const POLL_MS = 5000;
const MAX_WAIT_MS = 10 * 60_000;

export function parseArgs(argv) {
  const a = {
    prompt: "", seconds: 5, resolution: "720p", aspect: "16:9", image: null, lastFrame: null,
    refs: [], model: DEFAULT_MODEL, tag: null, out: null, dryRun: false,
  };
  const args = argv.slice(2);
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${k} needs a value.\n${USAGE}`);
      return args[++i];
    };
    if (k === "--seconds" || k === "--duration") a.seconds = Number(next());
    else if (k === "--resolution") a.resolution = next();
    else if (k === "--aspect") a.aspect = next();
    else if (k === "--image") a.image = next();
    else if (k === "--last-frame") a.lastFrame = next();
    else if (k === "--ref") a.refs.push(next());
    else if (k === "--model") a.model = next();
    else if (k === "--tag") a.tag = next();
    else if (k === "--out") a.out = next();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k.startsWith("--")) throw new Error(`Unknown option "${k}".\n${USAGE}`);
    else words.push(k);
  }
  a.prompt = words.join(" ").trim();
  if (!a.prompt) throw new Error(`No prompt given.\n${USAGE}`);
  if (!Number.isInteger(a.seconds) || a.seconds < 1) throw new Error("--seconds needs a whole number of seconds.");
  a.resolution = a.resolution.toLowerCase();
  if (a.lastFrame && !a.image) throw new Error("--last-frame needs --image (the first frame) as well.");
  if (a.refs.length && a.image) throw new Error("Use --image (start from this picture) or --ref (look like these pictures), not both.");
  return a;
}

// Which service a --model value goes to, and its full id.
export function resolveModel(value) {
  const id = ALIASES[String(value).toLowerCase()] || value;
  return { id, route: id.includes("/") ? "openrouter" : "gemini" };
}

function readImage(file) {
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type: ${file}. Use ${Object.keys(IMAGE_MIME).join(", ")}.`);
  if (!fs.existsSync(file)) throw new Error(`Image not found: ${file}`);
  const data = fs.readFileSync(file);
  if (data.length > MAX_IMAGE_BYTES) throw new Error(`${file} is ${(data.length / 1048576).toFixed(1)} MB; shrink it below 14 MB first.`);
  return { mime, b64: data.toString("base64") };
}

// ---------------------------------------------------------------------------
// Gemini API (Interactions): Omni
// ---------------------------------------------------------------------------

export function checkOmni(a) {
  const [lo, hi] = OMNI.seconds;
  if (a.seconds < lo || a.seconds > hi) throw new Error(`Omni makes clips of ${lo} to ${hi} seconds; got ${a.seconds}.`);
  if (!(a.resolution in OMNI.resolutions)) {
    throw new Error(`Omni does not support resolution "${a.resolution}". It supports: ${Object.keys(OMNI.resolutions).join(", ")}.`);
  }
  if (!OMNI.aspects.includes(a.aspect)) {
    throw new Error(`Omni does not support aspect ratio "${a.aspect}". It supports: ${OMNI.aspects.join(", ")}. For others try --model wan.`);
  }
  if (a.refs.length > OMNI.maxRefs) throw new Error(`Omni takes at most ${OMNI.maxRefs} reference images; got ${a.refs.length}.`);
  if (a.lastFrame && a.seconds > 10) throw new Error("A first and last frame only work for clips of 3 to 10 seconds.");
}

export function omniEstimate(a) {
  return round((OMNI.resolutions[a.resolution] * a.seconds * OMNI.usdPerM.video_out) / 1e6, 4);
}

export function omniBody(a, model) {
  const images = [a.image, a.lastFrame, ...a.refs].filter(Boolean).map(readImage);
  const input = images.length
    ? [...images.map((im) => ({ type: "image", data: im.b64, mime_type: im.mime })), { type: "text", text: a.prompt }]
    : a.prompt;
  const task = a.refs.length ? "reference_to_video" : a.image ? "image_to_video" : null;
  return {
    model: model.id,
    input,
    response_format: { type: "video", duration: `${a.seconds}s`, resolution: a.resolution, aspect_ratio: a.aspect },
    ...(task ? { generation_config: { video_config: { task } } } : {}),
    background: true, // generation can outlast one HTTP request
    store: true, // background mode needs it
  };
}

export function omniCost(usage) {
  const u = usage || {};
  const video = (u.output_tokens_by_modality || []).filter((m) => m.modality === "video").reduce((s, m) => s + (m.tokens || 0), 0);
  const otherOut = Math.max(0, (u.total_output_tokens || 0) - video) + (u.total_thought_tokens || 0);
  const tokens = { input: u.total_input_tokens || 0, video_out: video, text_out: otherOut, total: u.total_tokens || 0 };
  const p = OMNI.usdPerM;
  return {
    tokens,
    cost_usd: round((tokens.input * p.input + tokens.video_out * p.video_out + tokens.text_out * p.text_out) / 1e6),
    cost_basis: `API usage x list price (${PRICES_CHECKED})`,
  };
}

async function runGemini(a, model, body) {
  const key = loadKey("GEMINI_API_KEY");
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  const base = "https://generativelanguage.googleapis.com/v1beta/interactions";
  let d = await fetchJson(base, { method: "POST", headers, body: JSON.stringify(body) }, "Gemini API");
  const t0 = Date.now();
  while (d.status === "in_progress" || d.status === "queued" || d.status === "pending") {
    if (Date.now() - t0 > MAX_WAIT_MS) throw new Error(`The clip was not ready after ${MAX_WAIT_MS / 60000} minutes (interaction ${d.id}).`);
    await sleep(POLL_MS);
    d = await fetchJson(`${base}/${d.id}`, { headers }, "Gemini API");
  }
  const priced = omniCost(d.usage);
  if (d.status !== "completed") {
    const why = d.error?.message || d.status_message || JSON.stringify(d.error ?? {}).slice(0, 300);
    throw Object.assign(new Error(`Gemini did not make the clip (status ${d.status}): ${why}`), { priced });
  }
  let video = null;
  const texts = [];
  for (const step of d.steps || []) {
    if (step.type !== "model_output") continue;
    for (const c of step.content || []) {
      if (c.type === "video") video = c;
      else if (c.type === "text" && c.text) texts.push(c.text);
    }
  }
  if (!video) {
    const extra = texts.length ? ` The model said: ${texts.join(" ").slice(0, 400)}` : " The prompt may have been blocked by a safety filter.";
    throw Object.assign(new Error(`No video in the response.${extra}`), { priced });
  }
  let bytes;
  if (video.data) bytes = Buffer.from(video.data, "base64");
  else if (video.uri) {
    const r = await fetch(video.uri, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw Object.assign(new Error(`Could not download the clip (${r.status}).`), { priced });
    bytes = Buffer.from(await r.arrayBuffer());
  } else throw Object.assign(new Error("The response held a video with no data."), { priced });
  return { bytes, ...priced };
}

// ---------------------------------------------------------------------------
// OpenRouter: every other model
// ---------------------------------------------------------------------------

// Check the request against OpenRouter's public model list (a free call) and
// estimate the cost where the price is per second.
export function checkOpenRouter(a, model, listing) {
  const m = (listing.data || []).find((x) => x.id === model.id);
  if (!m) {
    const some = (listing.data || []).map((x) => x.id).slice(0, 12).join(", ");
    throw new Error(`OpenRouter has no video model "${model.id}". Some it has: ${some}`);
  }
  const bad = (what, got, ok) => new Error(`${m.name} does not support ${what} "${got}". It supports: ${ok.join(", ")}.`);
  if (m.supported_durations?.length && !m.supported_durations.includes(a.seconds)) throw bad("a length of", a.seconds, m.supported_durations.slice().sort((x, y) => x - y));
  const resolutions = (m.supported_resolutions || []).map((r) => r.toLowerCase());
  if (resolutions.length && !resolutions.includes(a.resolution)) throw bad("resolution", a.resolution, resolutions);
  if (m.supported_aspect_ratios?.length && !m.supported_aspect_ratios.includes(a.aspect)) throw bad("aspect ratio", a.aspect, m.supported_aspect_ratios);
  if (a.refs.length) throw new Error("--ref is only supported on the default model (omni). Use --image for a first frame.");
  const frames = m.supported_frame_images || [];
  if (a.image && !frames.includes("first_frame")) throw new Error(`${m.name} cannot start from an image.`);
  if (a.lastFrame && !frames.includes("last_frame")) throw new Error(`${m.name} cannot end on a given image.`);
  const sku = m.pricing_skus || {};
  const perSecond = sku[`duration_seconds_with_audio_${a.resolution}`] ?? sku[`duration_seconds_${a.resolution}`] ?? sku.duration_seconds_with_audio ?? sku.duration_seconds;
  return { estimate: perSecond ? round(Number(perSecond) * a.seconds, 4) : null, audio: m.generate_audio === true };
}

export function openRouterBody(a, model, audio) {
  const frame = (file, frame_type) => {
    const im = readImage(file);
    return { type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` }, frame_type };
  };
  const frames = [a.image && frame(a.image, "first_frame"), a.lastFrame && frame(a.lastFrame, "last_frame")].filter(Boolean);
  return {
    model: model.id, prompt: a.prompt, duration: a.seconds, resolution: a.resolution, aspect_ratio: a.aspect,
    ...(audio ? { generate_audio: true } : {}),
    ...(frames.length ? { frame_images: frames } : {}),
  };
}

async function runOpenRouter(a, model, body) {
  const key = loadKey("OPENROUTER_API_KEY");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "generate-video skill" };
  const base = "https://openrouter.ai/api/v1/videos";
  let d = await fetchJson(base, { method: "POST", headers, body: JSON.stringify(body) }, "OpenRouter");
  const id = d.id;
  const t0 = Date.now();
  while (d.status === "pending" || d.status === "in_progress") {
    if (Date.now() - t0 > MAX_WAIT_MS) throw new Error(`The clip was not ready after ${MAX_WAIT_MS / 60000} minutes (job ${id}).`);
    await sleep(POLL_MS);
    d = await fetchJson(`${base}/${id}`, { headers }, "OpenRouter");
  }
  const cost = typeof d.usage?.cost === "number" ? d.usage.cost : null;
  const priced = { tokens: null, cost_usd: cost, cost_basis: cost === null ? "OpenRouter reported no cost" : "charge reported by OpenRouter" };
  if (d.status !== "completed") {
    const why = d.error?.message || d.error || d.status;
    throw Object.assign(new Error(`OpenRouter did not make the clip (status ${d.status}): ${typeof why === "string" ? why : JSON.stringify(why)}`), { priced });
  }
  const r = await fetch(`${base}/${id}/content?index=0`, { headers, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw Object.assign(new Error(`Could not download the clip (${r.status}).`), { priced });
  return { bytes: Buffer.from(await r.arrayBuffer()), ...priced };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let failureLog = null;

async function main() {
  const a = parseArgs(process.argv);
  const model = resolveModel(a.model);
  // A dry run attempts nothing, so its failures are not logged.
  failureLog = a.dryRun ? null : {
    ts: new Date().toISOString(), kind: "film", model: model.id, seconds: a.seconds, resolution: a.resolution,
    aspect: a.aspect, tag: a.tag, cwd: process.cwd(), tokens: null, cost_usd: null, success: false, video_path: null,
  };

  let body, estimate;
  if (model.route === "gemini") {
    checkOmni(a);
    estimate = omniEstimate(a);
    body = omniBody(a, model);
  } else {
    const listing = await fetchJson("https://openrouter.ai/api/v1/videos/models", {}, "OpenRouter model list");
    const checked = checkOpenRouter(a, model, listing);
    estimate = checked.estimate;
    body = openRouterBody(a, model, checked.audio);
  }

  if (a.dryRun) {
    const shown = JSON.parse(JSON.stringify(body, (k, v) => (typeof v === "string" && v.length > 300 ? `<${v.length} characters>` : v)));
    console.log(JSON.stringify({ dry_run: true, route: model.route, model: model.id, estimated_cost_usd: estimate, request: shown }, null, 2));
    return;
  }

  const t0 = Date.now();
  const made = model.route === "gemini" ? await runGemini(a, model, body) : await runOpenRouter(a, model, body);
  const outPath = path.resolve(a.out || path.join(OUT_DIR, `clip-${Date.now()}.mp4`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, made.bytes);

  logUsage({ ...failureLog, tokens: made.tokens, cost_usd: made.cost_usd, success: true, video_path: outPath });
  console.log(JSON.stringify({
    success: true, video_path: outPath, model: model.id, route: model.route, seconds: a.seconds,
    resolution: a.resolution, aspect_ratio: a.aspect, prompt_used: a.prompt, tag: a.tag,
    cost_usd: made.cost_usd, cost_basis: made.cost_basis, estimated_cost_usd: estimate,
    elapsed_seconds: Math.round((Date.now() - t0) / 1000), size_mb: round(made.bytes.length / 1048576, 1),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    if (failureLog) {
      logUsage({ ...failureLog, tokens: err.priced?.tokens ?? null, cost_usd: err.priced?.cost_usd ?? null, error: err.message });
    }
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  });
}
