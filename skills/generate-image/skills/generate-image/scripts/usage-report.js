#!/usr/bin/env node
// Summarise ~/skills-output/generate-image/usage.jsonl (written by generate.js).
//
//   node usage-report.js                       # totals by day, tag and model
//   node usage-report.js --since 2026-09-01    # only calls on/after a date
//   node usage-report.js --tag my-project      # only tags containing this text
//   node usage-report.js --json                # machine-readable totals

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG = path.join(os.homedir(), "skills-output", "generate-image", "usage.jsonl");

function parseArgs(argv) {
  const a = { since: null, tag: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--since") a.since = argv[++i];
    else if (argv[i] === "--tag") a.tag = argv[++i];
    else if (argv[i] === "--json") a.json = true;
  }
  return a;
}

function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) ?? "(none)";
    const g = m.get(k) || { calls: 0, images: 0, cost_usd: 0, unpriced: 0 };
    g.calls += 1;
    if (r.success) g.images += 1;
    if (typeof r.cost_usd === "number") g.cost_usd += r.cost_usd;
    else if (r.success || r.tokens) g.unpriced += 1; // failures with no tokens cost nothing
    m.set(k, g);
  }
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(LOG)) {
    console.log(`No usage log yet at ${LOG}`);
    return;
  }
  let rows = fs.readFileSync(LOG, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (args.since) rows = rows.filter((r) => r.ts >= args.since);
  if (args.tag) rows = rows.filter((r) => (r.tag || "").includes(args.tag));

  const sections = {
    day: group(rows, (r) => r.ts.slice(0, 10)),
    tag: group(rows, (r) => r.tag),
    model: group(rows, (r) => r.model),
  };
  const total = group(rows, () => "total")[0]?.[1] || { calls: 0, images: 0, cost_usd: 0, unpriced: 0 };

  if (args.json) {
    const obj = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Object.fromEntries(v)]));
    console.log(JSON.stringify({ total, ...obj }, null, 2));
    return;
  }
  const fmt = (g) =>
    `${String(g.calls).padStart(5)} calls ${String(g.images).padStart(5)} images  $${g.cost_usd.toFixed(4)}` +
    (g.unpriced ? `  (${g.unpriced} unpriced)` : "");
  for (const [name, entries] of Object.entries(sections)) {
    console.log(`\nBy ${name}`);
    for (const [k, g] of entries) console.log(`  ${k.padEnd(44)} ${fmt(g)}`);
  }
  console.log(`\nTotal ${"".padEnd(42)} ${fmt(total)}`);
  console.log("\nCosts are API token counts x list price; check against Google's billing page occasionally.");
}

main();
