// Shared by film.js and narrate.js: API keys, the output folder and the usage log.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OUT_DIR = path.join(os.homedir(), "skills-output", "generate-video");
export const USAGE_LOG = path.join(OUT_DIR, "usage.jsonl");

// Read one key from ~/.claude/.env without printing it.
export function loadKey(name) {
  const envPath = path.join(os.homedir(), ".claude", ".env");
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing API key file: ${envPath}\nAdd ${name}=<your-key> to that file.`);
  }
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.trim().match(new RegExp(`^${name}\\s*=\\s*(.+)$`));
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  throw new Error(`${name} not found in ${envPath}\nAdd ${name}=<your-key> to that file.`);
}

// One line per call, failures included. Same core fields as generate-image's
// log (ts, model, tag, cwd, cost_usd, success), plus kind: "film" | "narrate".
export function logUsage(entry) {
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG), { recursive: true });
    fs.appendFileSync(USAGE_LOG, JSON.stringify(entry) + "\n");
  } catch {
    // logging must never break generation
  }
}

export function round(n, places = 6) {
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

// fetch with a time limit and JSON parsing; throws a readable error.
export async function fetchJson(url, { timeoutMs = 120_000, ...init } = {}, what = "API") {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error(`${what} call timed out after ${timeoutMs / 1000} s`);
    throw new Error(`Network error calling ${what}: ${err.message}`);
  }
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`${what} returned non-JSON (${response.status}): ${err.message}`);
  }
  if (!response.ok) {
    const e = data?.error;
    const msg = (typeof e === "string" ? e : e?.message) || JSON.stringify(e ?? data).slice(0, 400);
    throw new Error(`${what} error (${response.status}): ${msg}`);
  }
  return data;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
