// Tests for gdocs_suggest.js pure helpers. Run: node --test scripts/
// No deps — uses the Node built-in test runner.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tokenize,
  diffHunks,
  formatComment,
  docText,
  locate,
  paragraphEnd,
  buildCommentRequests,
  buildBelowRequests,
  buildSuggestRequests,
  validatePlan,
  assertSafe,
  styleAt,
  preservedCheck,
  buildUndoRequests,
  MAX_SUGGEST_DELETE,
  inferLost,
  RED,
} from "./gdocs_suggest.js";

// Minimal documents.get (includeTabsContent) shape: one tab, body text from index 1.
function fakeDoc(paragraphs, { suggested = [] } = {}) {
  const content = [{ endIndex: 1, sectionBreak: {} }];
  let i = 1;
  for (const raw of paragraphs) {
    const p = typeof raw === "string" ? { text: raw } : raw;
    const text = p.text + "\n";
    const run = { textRun: { content: text, textStyle: p.red ? { foregroundColor: RED } : {} }, startIndex: i, endIndex: i + text.length };
    if (suggested.includes(p.text)) run.textRun.suggestedInsertionIds = ["suggest.x"];
    if (p.suggestionId) run.textRun.suggestedInsertionIds = [p.suggestionId];
    content.push({ startIndex: i, endIndex: i + text.length,
      paragraph: { elements: [run], paragraphStyle: { namedStyleType: p.style ?? "NORMAL_TEXT" } } });
    i += text.length;
  }
  return { tabs: [{ tabProperties: { tabId: "t.0" }, documentTab: { body: { content } } }] };
}

// Apply hunks to the old string, for checking diffHunks reproduces the new string.
function applyHunks(old, hunks) {
  let out = old;
  for (const h of [...hunks].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, h.start) + h.insert + out.slice(h.end);
  }
  return out;
}

// --- tokenize ---------------------------------------------------------------

test("tokenize: words, punctuation and spaces are separate tokens", () => {
  assert.deepEqual(tokenize("decisions. We"), ["decisions", ".", " ", "We"]);
});

test("tokenize: apostrophes and hyphens stay inside a word", () => {
  assert.deepEqual(tokenize("don’t self-select"), ["don’t", " ", "self-select"]);
});

// --- diffHunks: whole words only ------------------------------------------

test("diffHunks: reproduces the new text", () => {
  const old = "The results shows that most organisations has not yet adopted formal risk assessments.";
  const neu = "The results show that most organisations have not yet adopted formal risk assessments.";
  assert.equal(applyHunks(old, diffHunks(old, neu)), neu);
});

test("diffHunks: strikes whole words, never part of a word", () => {
  const old = "The results shows that most organisations has not yet adopted formal risk assessments.";
  const neu = "The results show that most organisations have not yet adopted formal risk assessments.";
  const hunks = diffHunks(old, neu);
  assert.deepEqual(hunks.map(h => [old.slice(h.start, h.end), h.insert]), [["shows", "show"], ["has", "have"]]);
});

test("diffHunks: changing case of a word replaces the whole word", () => {
  const old = "about the decisions. We started";
  const neu = "about the decisions, which we started";
  const hunks = diffHunks(old, neu);
  for (const h of hunks) {
    const before = old[h.start - 1] ?? " ";
    const after = old[h.end] ?? " ";
    // a struck range never begins or ends inside a word
    assert.ok(!(/\w/.test(before) && /\w/.test(old[h.start] ?? "")), `starts mid-word: ${JSON.stringify(h)}`);
    assert.ok(!(/\w/.test(after) && /\w/.test(old[h.end - 1] ?? "")), `ends mid-word: ${JSON.stringify(h)}`);
  }
  assert.equal(applyHunks(old, hunks), neu);
});

test("diffHunks: changes separated by one or two words merge into one suggestion", () => {
  const old = "Data was collected between March and June.";
  const neu = "Two coders collected data between March and June.";
  const hunks = diffHunks(old, neu);
  assert.equal(hunks.length, 1);
  assert.equal(old.slice(hunks[0].start, hunks[0].end), "Data was collected");
  assert.equal(hunks[0].insert, "Two coders collected data");
});

test("diffHunks: heavy rewrite collapses into few suggestions", () => {
  const old = "Data was collected between March and June, and it was analysed using thematic analysis by two coders independently.";
  const neu = "Two coders collected data between March and June and analysed it independently using thematic analysis.";
  const hunks = diffHunks(old, neu);
  assert.equal(applyHunks(old, hunks), neu);
  assert.ok(hunks.length <= 4, `expected ≤4 hunks, got ${hunks.length}`);
});

test("diffHunks: pure deletion of a doubled word", () => {
  const old = "Its important to note that the the survey had a response rate of 34%.";
  const neu = "The survey had a response rate of 34%.";
  const hunks = diffHunks(old, neu);
  assert.equal(applyHunks(old, hunks), neu);
  assert.equal(hunks.length, 1);
});

test("diffHunks: curly vs straight apostrophe is not an edit", () => {
  const old = "The team’s results shows growth.";
  const neu = "The team's results show growth.";
  const hunks = diffHunks(old, neu);
  assert.deepEqual(hunks.map(h => old.slice(h.start, h.end)), ["shows"]);
});

test("diffHunks: identical text gives no hunks", () => {
  assert.deepEqual(diffHunks("Same text.", "Same text."), []);
});

// --- formatComment -----------------------------------------------------------

test("formatComment: adds [Claude] prefix", () => {
  assert.equal(formatComment("This needs a source.").content, "[Claude] This needs a source.");
});

test("formatComment: does not double the prefix", () => {
  assert.equal(formatComment("[Claude] This needs a source.").content, "[Claude] This needs a source.");
});

test("formatComment: one-sentence lead then detail is accepted", () => {
  const r = formatComment("Say when the board meets.\n\nIf it meets in November, Q4 leaves three weeks. Readers will want that.");
  assert.equal(r.error, undefined);
});

test("formatComment: two sentences in the first paragraph is an error", () => {
  const r = formatComment("This needs a source. It is a strong claim.");
  assert.match(r.error, /one sentence/);
});

test("formatComment: abbreviations don't count as sentence ends", () => {
  assert.equal(formatComment("Name the framework, e.g. Risk Taxonomy v2, here.").error, undefined);
});

test("formatComment: empty text is an error", () => {
  assert.match(formatComment("   ").error, /empty/);
});

test("formatComment: over 2048 UTF-8 bytes is an error", () => {
  assert.match(formatComment("A point.\n\n" + "x".repeat(2100)).error, /2048/);
});

// --- docText / locate -------------------------------------------------------

test("docText: string offsets equal document indexes", () => {
  const t = docText(fakeDoc(["Hello world.", "Second para."]));
  assert.equal(t.text.slice(1, 13), "Hello world.");
  assert.equal(t.text.indexOf("Second"), 14);
});

test("locate: finds a unique match and returns document indexes", () => {
  const t = docText(fakeDoc(["Hello world.", "Second para."]));
  assert.deepEqual(locate(t, "world"), { start: 7, end: 12 });
});

test("locate: matches straight quotes against curly quotes in the doc", () => {
  const t = docText(fakeDoc(["The team’s results."]));
  assert.deepEqual(locate(t, "team's"), { start: 5, end: 11 });
});

test("locate: no match is an error", () => {
  assert.throws(() => locate(docText(fakeDoc(["Hello."])), "absent"), /not found/);
});

test("locate: more than one match is an error asking for more context", () => {
  assert.throws(() => locate(docText(fakeDoc(["the cat", "the dog"])), "the"), /2 times/);
});

test("locate: refuses text inside a pending suggestion", () => {
  const t = docText(fakeDoc(["Plain.", "Pending text."], { suggested: ["Pending text."] }));
  assert.throws(() => locate(t, "Pending"), /pending suggestion/);
});

test("locate: suggest/below targets may not cross paragraphs", () => {
  const t = docText(fakeDoc(["End of one.", "Start of two."]));
  assert.throws(() => locate(t, "one.\nStart", { singleParagraph: true }), /paragraph/);
});

test("paragraphEnd: index of the newline closing the paragraph", () => {
  const t = docText(fakeDoc(["Hello world.", "Second."]));
  assert.equal(paragraphEnd(t, 7), 13);
});

// --- request builders ---------------------------------------------------------

test("buildCommentRequests: insertComment over the located range with tab id", () => {
  const reqs = buildCommentRequests({ start: 7, end: 12 }, "[Claude] Hi.", "t.0");
  assert.deepEqual(reqs, [{ insertComment: { range: { startIndex: 7, endIndex: 12, tabId: "t.0" }, content: "[Claude] Hi." } }]);
});

test("buildBelowRequests: new paragraph after the anchor paragraph, red, emphasis cleared", () => {
  const reqs = buildBelowRequests(13, "Red text.", "t.0");
  assert.deepEqual(reqs[0], { insertText: { location: { index: 13, tabId: "t.0" }, text: "\nRed text." } });
  const style = reqs[1].updateTextStyle;
  assert.deepEqual(style.range, { startIndex: 14, endIndex: 23, tabId: "t.0" });
  assert.deepEqual(style.textStyle, { foregroundColor: RED });
  // emphasis is cleared so the paragraph's own style shows through; font, size and spacing are never set
  assert.match(style.fields, /foregroundColor/);
  assert.match(style.fields, /bold/);
  assert.match(style.fields, /link/);
  assert.doesNotMatch(style.fields, /fontFamily|fontSize|lineSpacing/);
});

test("buildSuggestRequests: hunks applied from the end, inserted words red", () => {
  // paragraph text starts at doc index 10
  const old = "The results shows that most organisations has not";
  const neu = "The results show that most organisations have not";
  const reqs = buildSuggestRequests(10, old, neu, "t.0");
  const kinds = reqs.map(r => Object.keys(r)[0]);
  assert.deepEqual(kinds, ["insertText", "updateTextStyle", "deleteContentRange", "insertText", "updateTextStyle", "deleteContentRange"]);
  // last hunk ("has" at offset 42) comes first
  assert.equal(reqs[0].insertText.location.index, 10 + old.indexOf("has") + 3);
  assert.equal(reqs[0].insertText.text, "have");
  assert.deepEqual(reqs[2].deleteContentRange.range, { startIndex: 10 + old.indexOf("has"), endIndex: 10 + old.indexOf("has") + 3, tabId: "t.0" });
  assert.deepEqual(reqs[1].updateTextStyle.textStyle, { foregroundColor: RED });
});

// --- validatePlan -----------------------------------------------------------

test("validatePlan: accepts the three item types", () => {
  const plan = [
    { type: "comment", quote: "world", text: "Needs a source." },
    { type: "below", after: "Hello", text: "Red text." },
    { type: "suggest", find: "shows", replace: "show" },
  ];
  assert.deepEqual(validatePlan(plan), []);
});

test("validatePlan: reports missing fields and unknown types", () => {
  const errs = validatePlan([{ type: "comment", text: "x" }, { type: "redline" }]);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /quote/);
  assert.match(errs[1], /type/);
});

test("locate: occurrence picks the nth match when the text repeats", () => {
  const t = docText(fakeDoc(["Owner: TBC", "Date: TBC"]));
  assert.deepEqual(locate(t, "TBC", { occurrence: 2 }), { start: 18, end: 21 });
});

test("locate: occurrence past the last match is an error", () => {
  assert.throws(() => locate(docText(fakeDoc(["TBC", "TBC"])), "TBC", { occurrence: 3 }), /only 2/);
});


// --- deletion protection ------------------------------------------------------

test("assertSafe: direct edits may insert, colour and comment", () => {
  assert.doesNotThrow(() => assertSafe([
    { insertText: { location: { index: 5 }, text: "\nRed." } },
    { updateTextStyle: { range: { startIndex: 6, endIndex: 10 }, textStyle: {}, fields: "foregroundColor" } },
    { updateParagraphStyle: { range: { startIndex: 6, endIndex: 10 }, paragraphStyle: {}, fields: "namedStyleType" } },
    { insertComment: { range: { startIndex: 1, endIndex: 4 }, content: "[Claude] Hi." } },
  ], "EDIT"));
});

test("assertSafe: a direct edit may never delete text", () => {
  assert.throws(() => assertSafe([{ deleteContentRange: { range: { startIndex: 1, endIndex: 900 } } }], "EDIT"), /refused/);
});

test("assertSafe: bulk replace and other request types are refused", () => {
  assert.throws(() => assertSafe([{ replaceAllText: { containsText: { text: "a" }, replaceText: "" } }], "EDIT"), /refused/);
  assert.throws(() => assertSafe([{ deleteParagraphBullets: {} }], "SUGGEST"), /refused/);
});

test("assertSafe: suggested deletions are allowed up to the size limit", () => {
  assert.doesNotThrow(() => assertSafe([{ deleteContentRange: { range: { startIndex: 10, endIndex: 10 + MAX_SUGGEST_DELETE } } }], "SUGGEST"));
  assert.throws(() => assertSafe([{ deleteContentRange: { range: { startIndex: 10, endIndex: 11 + MAX_SUGGEST_DELETE } } }], "SUGGEST"), /refused/);
});

test("styleAt: named style of the paragraph containing an index", () => {
  const t = docText(fakeDoc([{ text: "Next steps", style: "HEADING_2" }, "Body."]));
  assert.equal(styleAt(t, 3), "HEADING_2");
  assert.equal(styleAt(t, 13), "NORMAL_TEXT");
});

test("buildBelowRequests: red text under a heading becomes normal text", () => {
  const reqs = buildBelowRequests(11, "Red text.", "t.0", { fromHeading: true });
  const ps = reqs.find(r => r.updateParagraphStyle)?.updateParagraphStyle;
  assert.ok(ps, "expected an updateParagraphStyle request");
  assert.deepEqual(ps.paragraphStyle, { namedStyleType: "NORMAL_TEXT" });
  assert.deepEqual(ps.range, { startIndex: 12, endIndex: 21, tabId: "t.0" });
});

test("buildBelowRequests: under a normal paragraph, paragraph style is left alone", () => {
  assert.equal(buildBelowRequests(11, "Red text.", "t.0").some(r => r.updateParagraphStyle), false);
});

test("preservedCheck: passes when only Claude's red paragraphs were added", () => {
  const before = "￼Intro.\nBody text.\n";
  const after = "￼Intro.\nRed version.\nBody text.\n";
  assert.equal(preservedCheck(before, after, ["Red version."]).ok, true);
});

test("preservedCheck: fails and shows where when original text went missing", () => {
  const before = "￼Intro.\nBody text that matters.\n";
  const after = "￼Intro.\nRed version.\n";
  const r = preservedCheck(before, after, ["Red version."]);
  assert.equal(r.ok, false);
  assert.match(r.message, /Body text that matters/);
});

test("buildUndoRequests: removes Claude's comments, pending suggestions and red paragraphs", () => {
  const t = docText(fakeDoc([
    "Anchor paragraph.",
    { text: "Red version.", red: true },
    { text: "Pending", suggestionId: "suggest.a" },
    "Last.",
  ]));
  const journal = { comments: ["c1"], suggestions: ["suggest.a", "suggest.gone"], below: ["Red version."] };
  const { requests, warnings } = buildUndoRequests(journal, t, { liveComments: ["c1"] });
  assert.deepEqual(requests.filter(r => r.deleteComment), [{ deleteComment: { commentId: "c1" } }]);
  // only suggestions still in the doc are rejected
  assert.deepEqual(requests.filter(r => r.rejectSuggestion), [{ rejectSuggestion: { suggestionId: "suggest.a" } }]);
  // deletes the red text plus the newline after it, so the anchor keeps its own paragraph end
  const del = requests.find(r => r.deleteContentRange).deleteContentRange.range;
  assert.equal(t.text.slice(del.startIndex, del.endIndex), "Red version.\n");
  assert.equal(warnings.length, 0);
});

test("buildUndoRequests: red text a person has since edited is left alone, with a warning", () => {
  const t = docText(fakeDoc(["Anchor.", { text: "Red version, edited by a person.", red: true }]));
  const { requests, warnings } = buildUndoRequests({ comments: [], suggestions: [], below: ["Red version."] }, t, { liveComments: [] });
  assert.equal(requests.length, 0);
  assert.match(warnings[0], /not found/);
});

test("buildUndoRequests: text that matches but is no longer red is left alone", () => {
  const t = docText(fakeDoc(["Anchor.", "Red version.", "End."]));
  const { requests, warnings } = buildUndoRequests({ comments: [], suggestions: [], below: ["Red version."] }, t, { liveComments: [] });
  assert.equal(requests.length, 0);
  assert.match(warnings[0], /no longer red/);
});

test("buildUndoRequests: every request it builds passes the undo safety check", () => {
  const t = docText(fakeDoc(["Anchor.", { text: "Red version.", red: true }, "End."]));
  const { requests } = buildUndoRequests({ comments: [], suggestions: [], below: ["Red version."] }, t, { liveComments: [] });
  assert.doesNotThrow(() => assertSafe(requests, "UNDO", { allowedDeletes: ["Red version."] }));
});


test("inferLost: a step whose reply was lost is reconstructed from the doc", () => {
  const t = docText(fakeDoc([{ text: "Old", suggestionId: "suggest.theirs" }, { text: "New", suggestionId: "suggest.ours" }]));
  const journal = {
    steps: [{ step: "comments", status: "sending" }, { step: "suggestions", status: "failed" }],
    plan: [{ type: "comment", quote: "x", text: "Needs a source." }],
    comments: [], suggestions: [], suggestionsBefore: ["suggest.theirs"],
  };
  const live = [
    { id: "c-ours", content: "[Claude] Needs a source." },
    { id: "c-human", content: "Needs a source." },
  ];
  const fixed = inferLost(journal, t, live);
  assert.deepEqual(fixed.comments, ["c-ours"]);
  assert.deepEqual(fixed.suggestions, ["suggest.ours"]);
  assert.equal(fixed.inferred.length, 2);
});

test("inferLost: completed steps are trusted as recorded", () => {
  const t = docText(fakeDoc([{ text: "New", suggestionId: "suggest.other" }]));
  const journal = { steps: [{ step: "suggestions", status: "done" }], plan: [], comments: [], suggestions: ["suggest.a"], suggestionsBefore: [] };
  const fixed = inferLost(journal, t, []);
  assert.deepEqual(fixed.suggestions, ["suggest.a"]);
  assert.equal(fixed.inferred.length, 0);
});

test("buildBelowRequests: paragraph style is set before the colour, which it would otherwise wipe", () => {
  const kinds = buildBelowRequests(11, "Red text.", "t.0", { fromHeading: true }).map(r => Object.keys(r)[0]);
  assert.deepEqual(kinds, ["insertText", "updateParagraphStyle", "updateTextStyle"]);
});
