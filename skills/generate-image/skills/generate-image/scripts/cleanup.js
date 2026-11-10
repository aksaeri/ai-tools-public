#!/usr/bin/env node
// Remove old generated images from ~/skills-output/generate-image/.
//
//   node cleanup.js                    # list what would go (older than 60 days); deletes nothing
//   node cleanup.js --older-than 30    # same, with a different age in days
//   node cleanup.js --delete           # actually delete
//   node cleanup.js --json             # machine-readable summary
//
// Only touches files named generated-<timestamp>.<jpg|jpeg|png|webp> directly in
// the output folder. Never touches usage.jsonl, so cost history is kept; log rows
// for deleted images keep their image_path.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const OUT_DIR = path.join(os.homedir(), "skills-output", "generate-image");
const GENERATED = /^generated-\d+\.(jpg|jpeg|png|webp)$/i;
const DEFAULT_DAYS = 60;

function parseArgs(argv) {
  const a = { days: DEFAULT_DAYS, del: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--older-than") a.days = Number(argv[++i]);
    else if (argv[i] === "--delete") a.del = true;
    else if (argv[i] === "--dry-run") a.del = false;
    else if (argv[i] === "--json") a.json = true;
    else throw new Error(`Unknown option "${argv[i]}". Usage: node cleanup.js [--older-than DAYS] [--delete] [--json]`);
  }
  if (!Number.isFinite(a.days) || a.days < 1) {
    throw new Error("--older-than needs a number of days, 1 or more.");
  }
  return a;
}

// Generated images in dir last modified more than `days` days before `now`.
function findOld(dir, days, now = Date.now()) {
  if (!fs.existsSync(dir)) return [];
  const cutoff = now - days * 86400_000;
  const old = [];
  for (const name of fs.readdirSync(dir)) {
    if (!GENERATED.test(name)) continue;
    const file = path.join(dir, name);
    const st = fs.statSync(file);
    if (st.isFile() && st.mtimeMs < cutoff) old.push({ file, bytes: st.size, mtime: st.mtime });
  }
  return old.sort((x, y) => x.mtime - y.mtime);
}

function main() {
  const args = parseArgs(process.argv);
  const old = findOld(OUT_DIR, args.days);
  const mb = old.reduce((a, f) => a + f.bytes, 0) / 1048576;
  let deleted = 0;
  if (args.del) {
    for (const f of old) {
      fs.rmSync(f.file, { force: true });
      deleted += 1;
    }
  }
  const summary = {
    dir: OUT_DIR, older_than_days: args.days, found: old.length,
    mb: Math.round(mb * 10) / 10, deleted,
    oldest: old[0]?.mtime.toISOString().slice(0, 10) ?? null,
    newest: old.at(-1)?.mtime.toISOString().slice(0, 10) ?? null,
  };
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!old.length) {
    console.log(`No generated images older than ${args.days} days in ${OUT_DIR}`);
  } else if (args.del) {
    console.log(`Deleted ${deleted} images (${summary.mb} MB) older than ${args.days} days, made ${summary.oldest} to ${summary.newest}.`);
  } else {
    console.log(`${old.length} images (${summary.mb} MB) are older than ${args.days} days, made ${summary.oldest} to ${summary.newest}.`);
    console.log("Nothing deleted. Add --delete to remove them.");
  }
}

export { parseArgs, findOld };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
