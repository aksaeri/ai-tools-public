#!/usr/bin/env node
// gdocs-suggest: comment on, add red text to, and suggest edits in a Google Doc
// through the `gws` CLI (Google Docs API). Usage: node gdocs_suggest.js --help

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RED = { color: { rgbColor: { red: 1, green: 0, blue: 0 } } }; // #FF0000
export const PREFIX = "[Claude]";
const PLACEHOLDER = "￼"; // stands in for chips, images, footnote marks, table structure
const MAX_COMMENT_BYTES = 2048;
const MERGE_GAP_WORDS = 2; // changes separated by this many unchanged words or fewer become one suggestion
export const MAX_SUGGEST_DELETE = 500; // longest single suggested deletion, in characters
const HEADINGS = new Set(["TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"]);
const JOURNAL_DIR = join(homedir(), ".gdocs-suggest", "journal");
const BACKUP_FOLDER = "gdocs-suggest backups";

// --- text helpers --------------------------------------------------------------

// Same-length normalisation, so offsets in the normalised string match the original.
const norm = s => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ");

const TOKEN = /[\p{L}\p{N}_]+(?:['’ʼ-][\p{L}\p{N}_]+)*|\s+|[^\p{L}\p{N}_\s]/gu;
const isWord = tok => /[\p{L}\p{N}_]/u.test(tok);

export function tokenize(s) {
  return s.match(TOKEN) ?? [];
}

// Word-level diff of old → new. Returns [{start, end, insert}] with offsets into `old`.
// Every range starts and ends on a token boundary, so whole words are struck, never parts.
export function diffHunks(oldText, newText) {
  const a = tokenize(oldText), b = tokenize(newText);
  const na = a.map(norm), nb = b.map(norm);
  const n = a.length, m = b.length;

  // LCS table over tokens (paragraph-sized inputs, so O(n·m) is fine)
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = na[i] === nb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);

  // Walk into runs: {eq: true, old: [tokens]} or {eq: false, old: [...], neu: [...]}
  const runs = [];
  const push = (eq, oldTok, newTok) => {
    const last = runs[runs.length - 1];
    if (last && last.eq === eq) {
      if (oldTok !== null) last.old.push(oldTok);
      if (!eq && newTok !== null) last.neu.push(newTok);
    } else {
      runs.push({ eq, old: oldTok !== null ? [oldTok] : [], neu: !eq && newTok !== null ? [newTok] : [] });
    }
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && na[i] === nb[j]) { push(true, a[i], null); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { push(false, null, b[j]); j++; }
    else { push(false, a[i], null); i++; }
  }

  // Turn change runs into hunks, merging across short unchanged gaps.
  const hunks = [];
  let offset = 0, gap = null;
  for (const run of runs) {
    const oldStr = run.old.join("");
    if (run.eq) {
      gap = { start: offset, text: oldStr, words: run.old.filter(isWord).length };
    } else {
      const prev = hunks[hunks.length - 1];
      if (prev && gap && prev.end === gap.start && gap.words <= MERGE_GAP_WORDS) {
        prev.end = offset + oldStr.length;
        prev.insert += gap.text + run.neu.join("");
      } else {
        hunks.push({ start: offset, end: offset + oldStr.length, insert: run.neu.join("") });
      }
      gap = null;
    }
    offset += oldStr.length;
  }

  // Trim whitespace common to both sides, so suggestions don't swallow neighbouring spaces.
  for (const h of hunks) {
    while (h.end > h.start && h.insert && /\s/.test(oldText[h.start]) && oldText[h.start] === h.insert[0]) {
      h.start++; h.insert = h.insert.slice(1);
    }
    while (h.end > h.start && h.insert && /\s/.test(oldText[h.end - 1]) && oldText[h.end - 1] === h.insert.at(-1)) {
      h.end--; h.insert = h.insert.slice(0, -1);
    }
  }
  return hunks.filter(h => h.end > h.start || h.insert);
}

// --- comments --------------------------------------------------------------------

const ABBREV = /\b(e\.g|i\.e|etc|vs|cf|al|Dr|Mr|Mrs|Ms|Prof|No|Fig|approx|U\.S|U\.K)\.$/i;

function sentenceCount(par) {
  let count = 0;
  const re = /[.!?]+["'”’)\]]*(\s+|$)/g;
  let m;
  while ((m = re.exec(par))) {
    if (ABBREV.test(par.slice(0, m.index + 1))) continue;
    count++;
  }
  return Math.max(count, 1);
}

// Prefix "[Claude] " and check the shape: one sentence, or a one-sentence first paragraph then detail.
export function formatComment(text) {
  let body = String(text ?? "").trim();
  if (body.startsWith(PREFIX)) body = body.slice(PREFIX.length).trim();
  if (!body) return { error: "comment is empty" };
  const content = `${PREFIX} ${body}`;
  if (Buffer.byteLength(content, "utf8") > MAX_COMMENT_BYTES)
    return { content, error: `comment is over ${MAX_COMMENT_BYTES} UTF-8 bytes; shorten the detail` };
  const lead = body.split(/\n\s*\n/)[0].trim();
  if (sentenceCount(lead) > 1)
    return {
      content,
      error: `comment must open with one sentence; put detail in a second paragraph after a blank line. First paragraph was: "${lead}"`,
    };
  return { content };
}

// --- document text and locating ------------------------------------------------

function findTab(tabs, tabId) {
  for (const tab of tabs ?? []) {
    if (!tabId || tab.tabProperties?.tabId === tabId) return tab;
    const child = findTab(tab.childTabs, tabId);
    if (child) return child;
  }
  return null;
}

// Flatten a tab's body into a string where string offset === document index.
export function docText(doc, tabId) {
  const tab = findTab(doc.tabs, tabId);
  if (!tab) throw new Error(tabId ? `tab ${tabId} not found` : "document has no tabs in the response");
  const content = tab.documentTab.body.content;
  const size = content[content.length - 1].endIndex;
  const chars = new Array(size).fill(PLACEHOLDER);
  const pending = new Uint8Array(size);
  const red = new Uint8Array(size);
  const paras = [];
  const suggestionIds = new Set();

  const walk = elements => {
    for (const el of elements ?? []) {
      if (el.paragraph) {
        paras.push({ start: el.startIndex, end: el.endIndex, style: el.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT" });
        for (const pe of el.paragraph.elements) {
          const tr = pe.textRun;
          if (!tr) continue;
          const ids = [...(tr.suggestedInsertionIds ?? []), ...(tr.suggestedDeletionIds ?? [])];
          ids.forEach(id => suggestionIds.add(id));
          const isRed = isRedStyle(tr.textStyle);
          for (let k = 0; k < tr.content.length; k++) {
            chars[pe.startIndex + k] = tr.content[k];
            if (ids.length) pending[pe.startIndex + k] = 1;
            if (isRed) red[pe.startIndex + k] = 1;
          }
        }
      } else if (el.table) {
        for (const row of el.table.tableRows) for (const cell of row.tableCells) walk(cell.content);
      } else if (el.tableOfContents) {
        walk(el.tableOfContents.content);
      }
    }
  };
  walk(content);
  return { text: chars.join(""), pending, red, paras, suggestionIds, tabId: tab.tabProperties?.tabId };
}

const isRedStyle = st => {
  const c = st?.foregroundColor?.color?.rgbColor;
  return Boolean(c) && (c.red ?? 0) > 0.9 && (c.green ?? 0) < 0.1 && (c.blue ?? 0) < 0.1;
};

// Named paragraph style (NORMAL_TEXT, HEADING_2, ...) of the paragraph containing `index`.
export function styleAt(t, index) {
  return t.paras.find(p => index >= p.start && index < p.end)?.style ?? "NORMAL_TEXT";
}

// Find `needle` exactly once; returns document indexes {start, end}.
// `occurrence` (1-based) picks one match when the text repeats and can't be quoted uniquely.
export function locate(t, needle, { singleParagraph = false, textOnly = false, occurrence } = {}) {
  const hay = norm(t.text), pin = norm(needle);
  if (!pin) throw new Error("search text is empty");
  const hits = [];
  for (let k = hay.indexOf(pin); k !== -1; k = hay.indexOf(pin, k + 1)) hits.push(k);
  const short = JSON.stringify(needle.length > 60 ? needle.slice(0, 57) + "..." : needle);
  if (hits.length === 0) throw new Error(`${short} not found in the document`);
  if (occurrence) {
    if (occurrence > hits.length) throw new Error(`${short} occurrence ${occurrence} asked for, but it appears only ${hits.length} times`);
  } else if (hits.length > 1) {
    throw new Error(`${short} appears ${hits.length} times; quote more surrounding words, or add "occurrence": n (1 = first from the top)`);
  }
  const start = hits[(occurrence ?? 1) - 1], end = start + pin.length;
  const span = t.text.slice(start, end);
  if (singleParagraph && span.includes("\n")) throw new Error(`${short} crosses a paragraph break; target one paragraph at a time`);
  if (textOnly && span.includes(PLACEHOLDER))
    throw new Error(`${short} contains a chip, image, footnote mark or table edge; edit the text around it instead`);
  for (let k = start; k < end; k++)
    if (t.pending[k]) throw new Error(`${short} overlaps a pending suggestion; resolve that suggestion first`);
  return { start, end };
}

// Index of the newline that closes the paragraph containing `index`.
export function paragraphEnd(t, index) {
  return t.text.indexOf("\n", index);
}

// --- request builders -------------------------------------------------------------

const range = (startIndex, endIndex, tabId) => ({ startIndex, endIndex, ...(tabId ? { tabId } : {}) });

export function buildCommentRequests(loc, content, tabId) {
  return [{ insertComment: { range: range(loc.start, loc.end, tabId), content } }];
}

// Inline emphasis cleared on red text so it does not inherit bold/links from the end of the anchor
// paragraph. Font, size and spacing are never touched: they come from the paragraph's own style.
const CLEARED = "bold,italic,underline,strikethrough,smallCaps,backgroundColor,link,baselineOffset";

// Under a heading the new paragraph is set to Normal text, so Claude's note doesn't become a heading.
// That has to come before the colour: setting a named style resets the text's own formatting.
export function buildBelowRequests(paraEndIndex, text, tabId, { fromHeading = false } = {}) {
  const start = paraEndIndex + 1;
  const normal = fromHeading
    ? [{ updateParagraphStyle: { range: range(start, start + text.length, tabId), paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } }]
    : [];
  return [
    { insertText: { location: { index: paraEndIndex, ...(tabId ? { tabId } : {}) }, text: "\n" + text } },
    ...normal,
    {
      updateTextStyle: {
        range: range(start, start + text.length, tabId),
        textStyle: { foregroundColor: RED },
        fields: `foregroundColor,${CLEARED}`,
      },
    },
  ];
}

// Requests for one find/replace, as suggestions. `at` is the doc index where `oldText` begins.
// Hunks run last-to-first so earlier indexes stay valid; a suggested deletion keeps its index space.
// `colour` is RED, or null to clear the colour so inserted words take the paragraph's own (--black-suggestions).
// `uncolour` also suggests clearing the colour of the whole found span, sent first while its indexes still
// hold; with find === replace that is the only request (recolouring stray red text an earlier run left).
export function buildSuggestRequests(at, oldText, newText, tabId, { colour = RED, uncolour = false } = {}) {
  const reqs = [];
  if (uncolour)
    reqs.push({ updateTextStyle: { range: range(at, at + oldText.length, tabId), textStyle: {}, fields: "foregroundColor" } });
  for (const h of diffHunks(oldText, newText).reverse()) {
    const s = at + h.start, e = at + h.end;
    if (h.insert) {
      reqs.push({ insertText: { location: { index: e, ...(tabId ? { tabId } : {}) }, text: h.insert } });
      reqs.push({
        updateTextStyle: { range: range(e, e + h.insert.length, tabId), textStyle: colour ? { foregroundColor: colour } : {}, fields: "foregroundColor" },
      });
    }
    if (e > s) reqs.push({ deleteContentRange: { range: range(s, e, tabId) } });
  }
  return reqs;
}

// --- deletion protection ------------------------------------------------------------

// Request types each kind of batch may send. Direct edits can only add text, colour it and comment;
// deleting is possible only as a suggestion (which leaves the text in place until someone accepts it)
// or, in undo, of text Claude itself added.
const ALLOWED = {
  EDIT: new Set(["insertText", "updateTextStyle", "updateParagraphStyle", "insertComment"]),
  SUGGEST: new Set(["insertText", "updateTextStyle", "deleteContentRange"]),
  UNDO: new Set(["deleteContentRange", "rejectSuggestion", "deleteComment"]),
};

export function assertSafe(requests, mode, { allowedDeletes = [] } = {}) {
  const maxUndo = Math.max(0, ...allowedDeletes.map(x => x.length + 1));
  for (const r of requests) {
    const kind = Object.keys(r)[0];
    if (!ALLOWED[mode]?.has(kind)) throw new Error(`safety check refused a ${kind} request in ${mode} mode; nothing was sent`);
    if (kind === "deleteContentRange") {
      const { startIndex, endIndex } = r.deleteContentRange.range;
      const len = endIndex - startIndex;
      const limit = mode === "SUGGEST" ? MAX_SUGGEST_DELETE : maxUndo;
      if (len > limit) throw new Error(`safety check refused deleting ${len} characters (limit ${limit} in ${mode} mode); nothing was sent`);
    }
  }
}

// After a run: the doc with all suggestions hidden must equal the doc before, plus Claude's red paragraphs.
export function preservedCheck(before, after, inserted) {
  let rest = after;
  for (const text of inserted) {
    const k = rest.indexOf("\n" + text);
    if (k === -1) return { ok: false, message: `Claude's red paragraph is missing: "${text.slice(0, 60)}"` };
    rest = rest.slice(0, k) + rest.slice(k + 1 + text.length);
  }
  if (rest === before) return { ok: true };
  let k = 0;
  while (k < before.length && before[k] === rest[k]) k++;
  const clip = s => s.slice(Math.max(0, k - 30), k + 60).replace(/\uFFFC/g, "").replace(/\n/g, " / ");
  return { ok: false, message: `original text changed. Before: "…${clip(before)}…"  Now: "…${clip(rest)}…"` };
}

// Requests that remove what one run added, from its journal and the doc as it is now.
export function buildUndoRequests(journal, t, { liveComments = [] } = {}) {
  const requests = [], warnings = [], deletes = [];
  for (const text of journal.below ?? []) {
    const needle = "\n" + text + "\n";
    const hits = [];
    for (let k = t.text.indexOf(needle); k !== -1; k = t.text.indexOf(needle, k + 1)) hits.push(k);
    const short = JSON.stringify(text.length > 50 ? text.slice(0, 47) + "..." : text);
    if (!hits.length) { warnings.push(`red paragraph ${short} not found as written; someone may have edited it, so it was left alone`); continue; }
    if (hits.length > 1) { warnings.push(`red paragraph ${short} appears ${hits.length} times; left alone`); continue; }
    const s = hits[0] + 1; // first character of the red text
    let allRed = true;
    for (let k = s; k < s + text.length; k++) if (!t.red[k]) allRed = false;
    if (!allRed) { warnings.push(`paragraph ${short} is no longer red; someone may have accepted it, so it was left alone`); continue; }
    // Delete the text and the newline after it, so the anchor paragraph keeps its own paragraph end.
    // At the very end of the body that last newline can't be deleted, so take the one before instead.
    const atEnd = s + text.length === t.text.length - 1;
    deletes.push(atEnd ? [s - 1, s + text.length] : [s, s + text.length + 1]);
  }
  for (const [a, b] of deletes.sort((x, y) => y[0] - x[0]))
    requests.push({ deleteContentRange: { range: range(a, b, t.tabId) } });
  for (const id of journal.suggestions ?? [])
    if (t.suggestionIds.has(id)) requests.push({ rejectSuggestion: { suggestionId: id } });
  for (const id of journal.comments ?? [])
    if (liveComments.includes(id)) requests.push({ deleteComment: { commentId: id } });
  return { requests, warnings };
}

// If a step's reply never arrived (connection dropped after Google applied it), the journal has no
// ids for it. Recover them from the doc: comments whose text exactly matches a planned [Claude]
// comment, and suggestions that appeared since the step began.
export function inferLost(journal, t, liveComments) {
  const status = name => journal.steps.find(x => x.step === name)?.status;
  const lost = name => status(name) && status(name) !== "done";
  const fixed = { ...journal, comments: [...journal.comments], suggestions: [...journal.suggestions], inferred: [] };
  if (lost("comments")) {
    const planned = new Set(journal.plan.filter(i => i.type === "comment").map(i => formatComment(i.text).content));
    for (const c of liveComments)
      if (planned.has(c.content) && !fixed.comments.includes(c.id)) {
        fixed.comments.push(c.id);
        fixed.inferred.push(`comment ${c.id} (matches a planned comment)`);
      }
  }
  if (lost("suggestions")) {
    const before = new Set(journal.suggestionsBefore ?? []);
    for (const id of t.suggestionIds)
      if (!before.has(id) && !fixed.suggestions.includes(id)) {
        fixed.suggestions.push(id);
        fixed.inferred.push(`suggestion ${id} (appeared during the run)`);
      }
  }
  return fixed;
}

// --- plan ----------------------------------------------------------------------

const REQUIRED = { comment: ["quote", "text"], below: ["after", "text"], suggest: ["find", "replace"] };

export function validatePlan(plan) {
  if (!Array.isArray(plan)) return ["plan must be a JSON array of items"];
  const errs = [];
  plan.forEach((item, n) => {
    const fields = REQUIRED[item?.type];
    if (!fields) return errs.push(`item ${n + 1}: type must be one of ${Object.keys(REQUIRED).join(", ")}`);
    const missing = fields.filter(f => typeof item[f] !== "string" || (f !== "replace" && !item[f].trim()));
    if (missing.length) errs.push(`item ${n + 1} (${item.type}): missing ${missing.join(", ")}`);
  });
  return errs;
}

// --- gws -------------------------------------------------------------------------

function gws(args, body) {
  const full = ["gws", ...args, ...(body ? ["--json", JSON.stringify(body)] : [])];
  const r = spawnSync(full[0], full.slice(1), { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run gws: ${r.error.message}`);
  let out;
  try {
    out = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  } catch {
    throw new Error(`gws returned non-JSON output:\n${r.stdout}\n${r.stderr}`);
  }
  if (out.error || r.status) throw new Error(out.error?.message ?? r.stderr ?? "gws failed");
  return out;
}

const docIdOf = s => s.match(/\/d\/([\w-]+)/)?.[1] ?? s;

// SUGGESTIONS_INLINE shows pending suggestions as text; PREVIEW_WITHOUT_SUGGESTIONS shows the doc
// as if every pending suggestion were rejected, which is what the before/after check compares.
function readDoc(documentId, suggestionsViewMode = "SUGGESTIONS_INLINE") {
  return gws(["docs", "documents", "get", "--params",
    JSON.stringify({ documentId, includeTabsContent: true, suggestionsViewMode })]);
}

// Send one batch pinned to the revision we read; if a collaborator edited in between, re-read and rebuild.
// `mode` is EDIT, SUGGEST or UNDO; every batch passes assertSafe before it is sent.
function sendBatch(documentId, build, mode, { attempts = 3, allowedDeletes } = {}) {
  for (let k = 1; ; k++) {
    const doc = readDoc(documentId);
    const requests = build(doc);
    if (!requests.length) return { replies: [] };
    assertSafe(requests, mode, { allowedDeletes });
    const writeMode = mode === "SUGGEST" ? "SUGGEST" : "EDIT";
    try {
      return gws(["docs", "documents", "batchUpdate", "--params", JSON.stringify({ documentId })],
        { requests, writeControl: { requiredRevisionId: doc.revisionId, writeMode } });
    } catch (err) {
      if (k >= attempts || !/revision/i.test(err.message)) throw err;
    }
  }
}

// --- commands ---------------------------------------------------------------------

function locateItem(t, item) {
  const occurrence = item.occurrence;
  if (item.type === "comment") return locate(t, item.quote, { occurrence });
  if (item.type === "below") return locate(t, item.after, { singleParagraph: true, occurrence });
  return locate(t, item.find, { singleParagraph: true, textOnly: true, occurrence });
}

function preview(t, item, loc) {
  if (item.type === "comment") return `comment on "${t.text.slice(loc.start, loc.end)}": ${formatComment(item.text).content}`;
  if (item.type === "below") return `red text below paragraph containing "${item.after}":\n    ${item.text}`;
  const old = t.text.slice(loc.start, loc.end);
  let shown = old;
  if (item.uncolour && old === item.replace) return `suggest: uncolour "${old}"`;
  for (const h of diffHunks(old, item.replace).reverse())
    shown = shown.slice(0, h.start) + (h.end > h.start ? `[-${old.slice(h.start, h.end)}]` : "") +
      (h.insert ? `[+${h.insert}]` : "") + shown.slice(h.end);
  return `suggest: ${shown}`;
}

function apply(documentId, plan, { tabId, dryRun, noBackup, blackSuggestions }) {
  const errs = validatePlan(plan);
  plan.filter(i => i.type === "comment").forEach(i => {
    const r = formatComment(i.text);
    if (r.error) errs.push(`comment on "${i.quote}": ${r.error}`);
  });
  const t0 = docText(readDoc(documentId), tabId);
  const located = [];
  for (const item of plan) {
    try { located.push({ item, loc: locateItem(t0, item) }); }
    catch (e) { errs.push(`${item.type}: ${e.message}`); }
  }
  const edits = located.filter(x => x.item.type !== "comment").sort((x, y) => x.loc.start - y.loc.start);
  for (let k = 1; k < edits.length; k++)
    if (edits[k].loc.start < edits[k - 1].loc.end)
      errs.push(`"${edits[k].item.find ?? edits[k].item.after}" overlaps another edit; combine them into one item`);
  if (errs.length) throw new Error("plan not applied, nothing was changed:\n  - " + errs.join("\n  - "));

  if (dryRun) {
    for (const { item, loc } of located) console.log(`- ${preview(t0, item, loc)}`);
    console.log(`\nDry run: ${plan.length} items checked against the document; nothing was changed.`);
    return;
  }

  const doc0 = readDoc(documentId, "PREVIEW_WITHOUT_SUGGESTIONS");
  const journal = {
    documentId, title: doc0.title, url: `https://docs.google.com/document/d/${documentId}/edit`,
    startedAt: new Date().toISOString(), tabId: t0.tabId, plan,
    before: { revisionId: doc0.revisionId, text: docText(doc0, tabId).text },
    backup: null, steps: [], comments: [], suggestions: [], below: [], verified: null,
  };
  const journalPath = saveJournal(journal);
  if (!noBackup) {
    journal.backup = backupCopy(documentId, doc0.title);
    saveJournal(journal, journalPath);
  }
  console.log(`Journal: ${journalPath}`);
  if (journal.backup) console.log(`Backup copy: ${journal.backup.url}`);

  const byType = type => plan.filter(i => i.type === type);
  const tab = t0.tabId;
  const summary = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const undoHint = `To remove everything this run added: node ${process.argv[1]} undo ${journalPath}`;
  // Each kind of change is one atomic batch. The journal records each step before and after it is
  // sent, so a dropped connection still leaves a record of what may have landed.
  const step = (label, fn) => {
    const entry = { step: label, status: "sending", at: new Date().toISOString() };
    journal.steps.push(entry);
    saveJournal(journal, journalPath);
    try {
      fn();
      entry.status = "done";
    } catch (e) {
      entry.status = "failed";
      entry.error = e.message;
      const done = summary.length ? `Already applied: ${summary.join(", ")}.` : "Nothing was applied.";
      throw new Error(`${label} failed: ${e.message}\n${done}\n${undoHint}`);
    } finally {
      saveJournal(journal, journalPath);
    }
  };

  // Comments first: they don't move any text, and they anchor to the text as it stands now.
  const comments = byType("comment");
  if (comments.length) step("comments", () => {
    const res = sendBatch(documentId, doc => {
      const t = docText(doc, tabId);
      return comments.flatMap(i => buildCommentRequests(locateItem(t, i), formatComment(i.text).content, tab));
    }, "EDIT");
    const ids = res.replies.map(r => r.insertComment?.commentThread?.commentId).filter(Boolean);
    journal.comments.push(...ids);
    summary.push(plural(ids.length, "comment"));
  });

  // Red text below paragraphs, applied bottom-up so earlier positions don't move.
  const below = byType("below");
  if (below.length) step("red text", () => {
    journal.below.push(...below.map(i => i.text)); // recorded first: undo finds them by text if the reply is lost
    sendBatch(documentId, doc => {
      const t = docText(doc, tabId);
      return below
        .map(i => ({ i, end: paragraphEnd(t, locateItem(t, i).start) }))
        .sort((x, y) => y.end - x.end)
        .flatMap(({ i, end }) => buildBelowRequests(end, i.text, tab, { fromHeading: HEADINGS.has(styleAt(t, end)) }));
    }, "EDIT");
    summary.push(plural(below.length, "red addition"));
  });

  // Inline edits as real suggestions, bottom-up.
  const suggest = byType("suggest");
  if (suggest.length) step("suggestions", () => {
    const res = sendBatch(documentId, doc => {
      const t = docText(doc, tabId);
      journal.suggestionsBefore = [...t.suggestionIds]; // lets undo spot ours if the reply is lost
      saveJournal(journal, journalPath);
      return suggest
        .map(i => ({ i, loc: locateItem(t, i) }))
        .sort((x, y) => y.loc.start - x.loc.start)
        .flatMap(({ i, loc }) => buildSuggestRequests(loc.start, t.text.slice(loc.start, loc.end), i.replace, tab,
          { colour: blackSuggestions ? null : RED, uncolour: !!i.uncolour }));
    }, "SUGGEST");
    const ids = [...new Set((res.suggestionResponses ?? []).flatMap(r => r.createdSuggestionIds ?? []))];
    journal.suggestions.push(...ids);
    summary.push(plural(ids.length, "suggestion"));
  });

  // Check nothing of the original was lost: hide all suggestions, take out Claude's red paragraphs,
  // and the text must match what was there before.
  const after = docText(readDoc(documentId, "PREVIEW_WITHOUT_SUGGESTIONS"), tabId).text;
  const check = preservedCheck(journal.before.text, after, journal.below);
  journal.verified = check.ok ? "original text intact" : check.message;
  saveJournal(journal, journalPath);

  console.log(`Applied: ${summary.join(", ")}.`);
  console.log(journal.url);
  if (check.ok) {
    console.log("Checked: the original text is intact.");
  } else {
    console.log(`WARNING: ${check.message}`);
    console.log("If a collaborator was typing in the doc this may be their edit; otherwise undo this run.");
    console.log(undoHint);
    if (journal.backup) console.log(`Backup copy from just before this run: ${journal.backup.url}`);
    process.exitCode = 2;
  }
}

// --- backup and journal -------------------------------------------------------------

// Copy the doc into a "gdocs-suggest backups" folder in My Drive before any change is written.
function backupCopy(documentId, title) {
  const q = `name = '${BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
  let folder = gws(["drive", "files", "list", "--params", JSON.stringify({ q, fields: "files(id)" })]).files?.[0]?.id;
  if (!folder)
    folder = gws(["drive", "files", "create", "--params", JSON.stringify({ fields: "id" })],
      { name: BACKUP_FOLDER, mimeType: "application/vnd.google-apps.folder", parents: ["root"] }).id;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const copy = gws(["drive", "files", "copy", "--params", JSON.stringify({ fileId: documentId, supportsAllDrives: true, fields: "id,name" })],
    { name: `${title} (before Claude edits ${stamp} UTC)`, parents: [folder] });
  return { id: copy.id, name: copy.name, url: `https://docs.google.com/document/d/${copy.id}/edit` };
}

function saveJournal(journal, path) {
  mkdirSync(JOURNAL_DIR, { recursive: true });
  const file = path ?? join(JOURNAL_DIR, `${journal.documentId}_${journal.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(journal, null, 2));
  return file;
}

function latestJournal(documentId) {
  let files = [];
  try { files = readdirSync(JOURNAL_DIR).filter(f => f.startsWith(documentId + "_")).sort(); } catch {}
  for (const f of files.reverse()) {
    const j = JSON.parse(readFileSync(join(JOURNAL_DIR, f), "utf8"));
    if (!j.undone) return join(JOURNAL_DIR, f);
  }
  throw new Error(`no journal found for ${documentId} in ${JOURNAL_DIR}`);
}

// Remove exactly what one run added. Leaves collaborators' edits, and any red text a person has
// changed or accepted, in place.
function undo(target) {
  const path = target.endsWith(".json") ? target : latestJournal(docIdOf(target));
  const journal = JSON.parse(readFileSync(path, "utf8"));
  if (journal.undone) throw new Error(`this run was already undone at ${journal.undone}`);
  const { documentId } = journal;
  const unsure = journal.steps.filter(x => x.status === "sending");
  if (unsure.length) console.log(`Note: the run stopped during "${unsure.map(x => x.step).join(", ")}"; anything from that step that can't be matched is reported below.`);
  const live = gws(["drive", "comments", "list", "--params", JSON.stringify({ fileId: documentId, fields: "comments(id,content,deleted)" })]);
  const liveList = (live.comments ?? []).filter(c => !c.deleted);
  const liveComments = liveList.map(c => c.id);
  let warnings = [], inferred = [];
  sendBatch(documentId, doc => {
    const t = docText(doc, journal.tabId);
    const fixed = inferLost(journal, t, liveList);
    inferred = fixed.inferred;
    const built = buildUndoRequests(fixed, t, { liveComments });
    warnings = built.warnings;
    return built.requests;
  }, "UNDO", { allowedDeletes: journal.below });
  for (const x of inferred) console.log(`Recovered from the doc: ${x}`);
  for (const w of warnings) console.log(`Left alone: ${w}`);
  const now = docText(readDoc(documentId, "PREVIEW_WITHOUT_SUGGESTIONS"), journal.tabId).text;
  journal.undone = new Date().toISOString();
  saveJournal(journal, path);
  if (now === journal.before.text) {
    console.log("Undone: the document text matches how it was before the run.");
  } else {
    console.log("Undone what could be matched, but the text differs from before the run (collaborator edits, or items left alone above).");
    console.log(preservedCheck(journal.before.text, now, []).message);
    if (journal.backup) console.log(`Backup copy from just before the run: ${journal.backup.url}`);
  }
  console.log(journal.url);
}

// Print the doc's paragraphs with pending suggestions as [+ins] / [-del] and red text as {red: ...}.
function read(documentId, { tabId }) {
  const doc = readDoc(documentId);
  const tab = findTab(doc.tabs, tabId);
  console.log(`# ${doc.title}  (tab ${tab.tabProperties?.tabId ?? "?"}: ${tab.tabProperties?.title ?? ""})\n`);
  const walk = elements => {
    for (const el of elements ?? []) {
      if (el.paragraph) {
        let line = "";
        for (const pe of el.paragraph.elements) {
          const tr = pe.textRun;
          if (!tr) { line += PLACEHOLDER; continue; }
          let s = tr.content.replace(/\n$/, "");
          if (!s) continue;
          if (isRedStyle(tr.textStyle)) s = `{red: ${s}}`;
          if (tr.suggestedInsertionIds?.length) s = `[+${s}]`;
          if (tr.suggestedDeletionIds?.length) s = `[-${s}]`;
          line += s;
        }
        if (line) console.log(line + "\n");
      } else if (el.table) {
        for (const row of el.table.tableRows) for (const cell of row.tableCells) walk(cell.content);
      }
    }
  };
  walk(tab.documentTab.body.content);
  const c = gws(["drive", "comments", "list", "--params",
    JSON.stringify({ fileId: documentId, fields: "comments(content,quotedFileContent,resolved,author/displayName)" })]);
  const open = (c.comments ?? []).filter(x => !x.resolved);
  if (open.length) {
    console.log("## Open comments\n");
    for (const x of open) console.log(`- on "${x.quotedFileContent?.value ?? ""}" (${x.author?.displayName}): ${x.content}`);
  }
}

const HELP = `gdocs-suggest: comment on, add red text to, and suggest edits in a Google Doc via gws.

  node gdocs_suggest.js read  <doc-id-or-url> [--tab <tabId>]
  node gdocs_suggest.js apply <doc-id-or-url> <plan.json> [--tab <tabId>] [--dry-run] [--no-backup] [--black-suggestions]
  node gdocs_suggest.js undo  <journal.json | doc-id-or-url>

plan.json is an array of items:
  {"type": "comment", "quote": "exact text to pin to", "text": "One sentence.\\n\\nOptional detail."}
  {"type": "below",   "after": "text in the paragraph", "text": "Red paragraph added underneath."}
  {"type": "suggest", "find": "exact text to change", "replace": "new text"}
Any item may add "occurrence": n to pick the nth match of text that repeats.

Every quote/after/find must appear exactly once in the tab (or set "occurrence"). The whole plan is checked
before anything is written; --dry-run shows what would happen without writing.
--black-suggestions leaves suggested insertions uncoloured instead of red; a suggest item with
"uncolour": true (find may equal replace) also suggests clearing stray red from the found text.

Protection: before writing, apply copies the doc to a "gdocs-suggest backups" folder in My Drive
(skip with --no-backup) and starts a journal in ~/.gdocs-suggest/journal. Direct edits can only add
text, colour it and comment; text is only ever removed as a suggestion. After writing, it checks the
original text is intact. undo removes the run's comments, pending suggestions and red paragraphs.`;

function main(argv) {
  const [cmd, doc, ...rest] = argv;
  const opt = { tabId: undefined, dryRun: rest.includes("--dry-run"), noBackup: rest.includes("--no-backup"),
    blackSuggestions: rest.includes("--black-suggestions") };
  const t = rest.indexOf("--tab");
  if (t !== -1) opt.tabId = rest[t + 1];
  if (!cmd || cmd === "--help" || cmd === "-h" || !doc) return console.log(HELP);
  if (cmd === "read") return read(docIdOf(doc), opt);
  if (cmd === "undo") return undo(doc);
  if (cmd === "apply") {
    const file = rest.find(a => !a.startsWith("--") && a !== opt.tabId);
    if (!file) throw new Error("apply needs a plan.json file");
    return apply(docIdOf(doc), JSON.parse(readFileSync(file, "utf8")), opt);
  }
  console.log(HELP);
  process.exitCode = 1;
}

// realpath both sides: the skill is usually reached through a symlink in ~/.claude/skills
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
