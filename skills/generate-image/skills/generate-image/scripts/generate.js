#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

// No style prefix by default (until 2026-10-26 a diagram style was prepended).
// --style adds one; --no-style is still accepted and does nothing.

const VALID_ASPECTS = new Set([
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
  "4:1", "1:4", "1:8", "8:1",
]);
const VALID_SIZES = new Set(["512", "1K", "2K", "4K"]);
const DEFAULT_ASPECT = "4:3";
const DEFAULT_SIZE = "1K";

// Reference images (--ref): sent inline with the prompt, so the model can edit a
// picture or keep a character or style across a series. Limits from the
// image-generation docs (checked 2026-11-10): flash and pro take 14 images
// per call; the docs give no number for lite and say it is not tuned for
// several. An inline request tops out near 20 MB, and base64 adds a third.
const MAX_REFS = 14;
const MAX_REF_BYTES = 14 * 1024 * 1024;
const REF_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif",
};

// A hung call is worse than a failed one: some callers run this unattended.
const FETCH_TIMEOUT_MS = 240_000;

// Image-model tiers (see https://ai.google.dev/gemini-api/docs/models).
// Keyed by short tier name; each maps to the stable (GA) model id.
// sizes/aspects: what the model accepts, from the image-generation docs
// (checked 2026-10-26). Omitted = anything in VALID_SIZES / VALID_ASPECTS.
const MODELS = {
  lite: {
    id: "gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    tier: "cheapest default — fast, 1K only; drafts, avatars, batches",
    sizes: new Set(["1K"]),
    aspects: new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]),
  },
  flash: {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2",
    tier: "balanced — good quality, 512 to 4K",
  },
  pro: {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    tier: "best — state-of-the-art, most contextual; final/hero/complex work",
    sizes: new Set(["1K", "2K", "4K"]),
  },
};
const DEFAULT_MODEL = "lite";

// USD per 1M tokens, from https://ai.google.dev/gemini-api/docs/pricing
// (standard tier, checked 2026-10-26, unchanged since 2026-09-19). Update
// when Google changes rates. Thinking tokens bill at the text-output rate.
const PRICES_CHECKED = "2026-10-26";
const PRICES = {
  "gemini-3.1-flash-lite-image": { input: 0.25, text_out: 1.5, image_out: 30 },
  "gemini-3.1-flash-image": { input: 0.5, text_out: 3, image_out: 60 },
  "gemini-3-pro-image": { input: 2, text_out: 12, image_out: 120 },
};

const USAGE_LOG = path.join(os.homedir(), "skills-output", "generate-image", "usage.jsonl");

// Actual cost from the API's usageMetadata. Returns null cost for unknown models.
function costFromUsage(modelId, usage) {
  const u = usage || {};
  const details = u.candidatesTokensDetails || [];
  const byModality = (m) =>
    details.filter((d) => d.modality === m).reduce((a, d) => a + (d.tokenCount || 0), 0);
  let imageOut = byModality("IMAGE");
  let textOut = byModality("TEXT");
  if (!details.length) {
    imageOut = u.candidatesTokenCount || 0; // no breakdown: assume all image
  } else {
    // Output tokens the breakdown doesn't itemise (seen on Lite: ~380/image).
    // Billed at the text-output rate, the higher-cost reading.
    textOut += Math.max(0, (u.candidatesTokenCount || 0) - imageOut - textOut);
  }
  const tokens = {
    input: u.promptTokenCount || 0,
    image_out: imageOut,
    text_out: textOut,
    thinking: u.thoughtsTokenCount || 0,
    total: u.totalTokenCount || 0,
  };
  const p = PRICES[modelId];
  if (!p) return { tokens, cost_usd: null, cost_basis: `no price for ${modelId}` };
  const cost =
    (tokens.input * p.input +
      (tokens.text_out + tokens.thinking) * p.text_out +
      tokens.image_out * p.image_out) / 1e6;
  return {
    tokens,
    cost_usd: Math.round(cost * 1e6) / 1e6,
    cost_basis: `API usageMetadata x list price (${PRICES_CHECKED})`,
  };
}

function logUsage(entry) {
  try {
    ensureDir(path.dirname(USAGE_LOG));
    fs.appendFileSync(USAGE_LOG, JSON.stringify(entry) + "\n");
  } catch {
    // logging must never break generation
  }
}

// Resolve a --model value that may be a tier keyword (lite/flash/pro) or a
// full model id. Unknown ids pass through unchanged (forward-compat for new
// models) rather than erroring.
function resolveModel(value) {
  if (!value) return MODELS[DEFAULT_MODEL];
  const key = String(value).toLowerCase();
  if (MODELS[key]) return MODELS[key];
  const byId = Object.values(MODELS).find((m) => m.id === value);
  if (byId) return byId;
  return { id: value, label: value, tier: "custom (passed through)" };
}

// Reject size/aspect combinations the model can't make, before paying for a call.
function checkModelSupports(modelInfo, aspect, size) {
  if (modelInfo.sizes && !modelInfo.sizes.has(size)) {
    throw new Error(
      `${modelInfo.label} (${modelInfo.id}) does not support size "${size}". ` +
      `It supports: ${[...modelInfo.sizes].join(", ")}. ` +
      `For other sizes use --model flash (512 to 4K) or --model pro (1K to 4K).`
    );
  }
  if (aspect !== "auto" && modelInfo.aspects && !modelInfo.aspects.has(aspect)) {
    throw new Error(
      `${modelInfo.label} (${modelInfo.id}) does not support aspect ratio "${aspect}". ` +
      `It supports: ${[...modelInfo.aspects].join(", ")}. For others use --model flash or --model pro.`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// GEMINI_API_KEY from the environment, or else from ~/.claude/.env.
function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const envPath = path.join(os.homedir(), ".claude", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `No GEMINI_API_KEY in the environment, and no key file at ${envPath}.\nSet GEMINI_API_KEY, or add GEMINI_API_KEY=<your-key> to that file.`
    );
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const match = trimmed.match(/^GEMINI_API_KEY\s*=\s*(.+)$/);
    if (match) {
      return match[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  throw new Error(
    `No GEMINI_API_KEY in the environment or in ${envPath}.\nSet GEMINI_API_KEY, or add GEMINI_API_KEY=<your-key> to that file.`
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let aspect = null; // null = DEFAULT_ASPECT, or follow the first --ref image
  let size = DEFAULT_SIZE;
  const refs = []; // paths of reference images
  let style = ""; // "" = no style prefix (default), "..." = custom style
  let model = null; // null = DEFAULT_MODEL; else tier keyword or full model id
  let tag = null; // free-text label for the usage log, e.g. "my-project/run-3"

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--aspect" && i + 1 < args.length) {
      aspect = args[++i];
    } else if (args[i] === "--size" && i + 1 < args.length) {
      size = args[++i];
    } else if (args[i] === "--style" && i + 1 < args.length) {
      style = args[++i];
    } else if (args[i] === "--no-style") {
      style = "";
    } else if ((args[i] === "--model" || args[i] === "--tier") && i + 1 < args.length) {
      model = args[++i];
    } else if (args[i] === "--tag" && i + 1 < args.length) {
      tag = args[++i];
    } else if ((args[i] === "--ref" || args[i] === "--image") && i + 1 < args.length) {
      refs.push(args[++i]);
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }

  const prompt = positional.join(" ").trim();
  if (!prompt) {
    throw new Error(
      'No prompt provided.\nUsage: node generate.js "description" [--model lite|flash|pro] [--aspect 4:3] [--size 1K] [--style "style directive"] [--ref image.png ...] [--tag label]'
    );
  }
  // With a reference image and no --aspect, the output follows the image's shape.
  if (aspect === null) aspect = refs.length ? "auto" : DEFAULT_ASPECT;
  if (aspect !== "auto" && !VALID_ASPECTS.has(aspect)) {
    throw new Error(
      `Invalid aspect ratio "${aspect}". Supported: ${[...VALID_ASPECTS].join(", ")}`
    );
  }
  if (!VALID_SIZES.has(size)) {
    throw new Error(
      `Invalid size "${size}". Supported: ${[...VALID_SIZES].join(", ")}`
    );
  }

  return { prompt, aspect, size, style, model, tag, refs };
}

// Read --ref files into inlineData parts. Throws on a missing file, an
// unsupported type, too many images or too many bytes.
function loadRefs(refs) {
  if (refs.length > MAX_REFS) {
    throw new Error(`Too many reference images (${refs.length}). The limit is ${MAX_REFS} per call.`);
  }
  let total = 0;
  const parts = [];
  for (const ref of refs) {
    const mimeType = REF_MIME[path.extname(ref).toLowerCase()];
    if (!mimeType) {
      throw new Error(
        `Unsupported reference image type: ${ref}. Use ${Object.keys(REF_MIME).join(", ")}.`
      );
    }
    if (!fs.existsSync(ref)) throw new Error(`Reference image not found: ${ref}`);
    const data = fs.readFileSync(ref);
    total += data.length;
    parts.push({ inlineData: { mimeType, data: data.toString("base64") } });
  }
  if (total > MAX_REF_BYTES) {
    throw new Error(
      `Reference images total ${(total / 1048576).toFixed(1)} MB; the limit is ` +
      `${MAX_REF_BYTES / 1048576} MB per call. Shrink them first (1024 px on the long side is plenty).`
    );
  }
  return parts;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Set once the request is known, so a failure anywhere after that is logged.
// Calls that already logged (with token counts) set failureLogged.
let failureLog = null;
let failureLogged = false;

async function main() {
  const { prompt, aspect, size, style, model, tag, refs } = parseArgs(process.argv);
  const modelInfo = resolveModel(model);
  // The fields other writers of this log use for a failed call.
  failureLog = {
    ts: new Date().toISOString(), model: modelInfo.id, aspect, size, tag,
    cwd: process.cwd(), tokens: null, cost_usd: null, success: false, image_path: null,
    ...(refs.length ? { refs: refs.length } : {}),
  };
  checkModelSupports(modelInfo, aspect, size);
  const refParts = loadRefs(refs);
  const apiKey = loadApiKey();

  const stylePrefix = style;
  const combinedPrompt = stylePrefix
    ? `${stylePrefix}\n\n${prompt}`
    : prompt;

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${modelInfo.id}:generateContent`;

  const body = {
    contents: [
      {
        parts: [...refParts, { text: combinedPrompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        ...(aspect === "auto" ? {} : { aspectRatio: aspect }),
        imageSize: size,
      },
    },
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`Gemini API call timed out after ${FETCH_TIMEOUT_MS / 1000} s`);
    }
    throw new Error(`Network error calling Gemini API: ${err.message}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Gemini API returned non-JSON (${response.status}): ${err.message}`);
  }

  if (!response.ok) {
    const msg =
      data?.error?.message || JSON.stringify(data?.error) || response.statusText;
    throw new Error(`Gemini API error (${response.status}): ${msg}`);
  }

  const { tokens, cost_usd, cost_basis } = costFromUsage(modelInfo.id, data.usageMetadata);
  const logBase = {
    ts: new Date().toISOString(), model: modelInfo.id, aspect, size, tag,
    cwd: process.cwd(), tokens, cost_usd, usage_raw: data.usageMetadata || null,
    ...(refs.length ? { refs: refs.length } : {}),
  };

  // Check for safety / block reasons
  if (data.promptFeedback?.blockReason) {
    logUsage({ ...logBase, success: false, image_path: null, blocked: data.promptFeedback.blockReason, error: `Prompt blocked by safety filter: ${data.promptFeedback.blockReason}` });
    failureLogged = true;
    throw new Error(
      `Prompt blocked by safety filter: ${data.promptFeedback.blockReason}`
    );
  }

  // Find the image part in the response
  const candidates = data.candidates || [];
  let imageData = null;
  let mimeType = "image/png";

  for (const candidate of candidates) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData && part.inlineData.mimeType?.startsWith("image/")) {
        imageData = part.inlineData.data;
        mimeType = part.inlineData.mimeType;
        break;
      }
    }
    if (imageData) break;
  }

  if (!imageData) {
    // Dump any text parts for debugging
    const textParts = [];
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) textParts.push(part.text);
      }
    }
    const extra = textParts.length
      ? `\nModel returned text: ${textParts.join("\n")}`
      : "";
    logUsage({ ...logBase, success: false, image_path: null, error: `No image data in Gemini response.${extra}` });
    failureLogged = true;
    throw new Error(`No image data in Gemini response.${extra}`);
  }

  // Save the image
  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const timestamp = Date.now();
  const screenshotsDir = path.join(os.homedir(), "skills-output", "generate-image");
  ensureDir(screenshotsDir);
  const outPath = path.join(screenshotsDir, `generated-${timestamp}.${ext}`);

  const buffer = Buffer.from(imageData, "base64");
  fs.writeFileSync(outPath, buffer);

  const result = {
    success: true,
    image_path: outPath,
    prompt_used: combinedPrompt,
    style_used: stylePrefix || "(none)",
    model: modelInfo.id,
    model_label: modelInfo.label,
    aspect_ratio: aspect,
    size,
    timestamp,
    tag,
    refs: refs.map((r) => path.resolve(r)),
    usage: tokens,
    cost_usd,
    cost_basis,
  };
  logUsage({ ...logBase, success: true, image_path: outPath });

  console.log(JSON.stringify(result, null, 2));
}

export { parseArgs, resolveModel, checkModelSupports, loadRefs, loadApiKey, costFromUsage, MODELS, DEFAULT_MODEL };

// Run only when called as a script, so tests can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    // Bad arguments never reach failureLog; anything after that is logged.
    if (failureLog && !failureLogged) logUsage({ ...failureLog, error: err.message });
    const result = {
      success: false,
      error: err.message,
    };
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  });
}
