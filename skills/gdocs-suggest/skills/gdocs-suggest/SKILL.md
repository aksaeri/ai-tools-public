---
name: gdocs-suggest
description: Use when asked to review, copyedit, comment on, mark up, redline or suggest changes in a Google Doc, or to fill {TBC}, [add detail] or similar placeholders in one, so that AI-written text stays visibly separate from the author's text. Requires the gws CLI.
allowed-tools:
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/gdocs_suggest.js *)
metadata:
  platforms:
  - claude-code
  platforms_notes: Needs the gws CLI (@googleworkspace/cli) signed in to the Google account that can edit the doc. Pinned comments and suggestions use Docs API features Google marks as Developer Preview (seen working 2026-10-06).
  complexity: medium
  prereqs:
  - Node 18+
  - gws CLI, authenticated (gws drive files list should work)
  provenance:
    author: aksaeri
    written: 2026-10
    last_revised: 2026-10
    last_tested: 2026-10
    endorsement: Built 2026-10-06 after the Docs API gained pinned comments and suggest-mode writes. Replaces an August 2026 attempt that drove Suggesting mode through the browser (worked, but took 11+ minutes per doc). 48 unit tests; tested live on six scratch docs, including undo after a simulated dropped connection.
---

# gdocs-suggest

Claude marks up a Google Doc in three ways, so a reader can always tell Claude's words from the author's:

| Type | What appears in the doc | Use for |
|---|---|---|
| `comment` | A margin comment pinned to the quoted text, starting `[Claude]` | Questions, flags, reasons |
| `below` (default for new text) | A new paragraph in red (#FF0000) directly under the paragraph | Rewrites shown beside the original, filling `{TBC}`-style markers, drafted additions |
| `suggest` | Real Suggesting-mode edits (accept/reject), inserted words in red | Light inline copyedits: grammar, word choice, cuts |

Red text and the `[Claude]` prefix are the AI markers. Comments and suggestions carry the signed-in user's name, so never remove them.

## Workflow

1. Read the doc: `node ${CLAUDE_SKILL_DIR}/scripts/gdocs_suggest.js read <doc-url-or-id>`. It prints each paragraph, with pending suggestions as `[+ins]`/`[-del]`, red text as `{red: …}`, and open comments.
2. Write a plan file (JSON array) in your scratchpad. Copy `quote`/`after`/`find` strings exactly from the `read` output, with enough words to be unique. When the text repeats and can't be extended (a table cell holding only "TBC"), add `"occurrence": n`, counting from the top of the doc.
3. Check it: `… apply <doc> plan.json --dry-run`. Fix every error it lists. Nothing is written if any item fails.
4. Apply: `… apply <doc> plan.json`. It backs up the doc, writes, then checks the original text is intact. Run `read` again and confirm the result before reporting back.
5. If the result is wrong, or apply stopped partway: `… undo <doc>` removes exactly what the run added. Tell the user the backup copy link from the apply output.

## Protection

- Only change Docs through this script. Never send your own `gws docs documents batchUpdate` to a doc you're reviewing: the script's safety check (no direct deletions, suggested deletions capped at 500 characters) only covers its own requests.
- Every apply copies the doc to "gdocs-suggest backups" in My Drive first and keeps a journal in `~/.gdocs-suggest/journal/`. Use `--no-backup` only for scratch docs.
- Exit code 2 with `WARNING: original text changed` means the post-write check failed. Stop, show the user the warning, and offer `undo`. A collaborator typing at the same moment can also cause it.

```json
[
  {"type": "comment", "quote": "the most comprehensive resource of its kind",
   "text": "This claim needs a source, or softer wording.\n\nReaders will check a claim this strong, and no citation is given."},
  {"type": "below", "after": "Funding: {add detail on the two grants}",
   "text": "Funding: two grants, one for the repository and one for the governance mapping."},
  {"type": "suggest", "find": "The results shows that most organisations has not",
   "replace": "The results show that most organisations have not"}
]
```

## Writing each type

- **Comments** are one sentence, or a one-sentence first paragraph, a blank line (`\n\n`), then detail. The script adds `[Claude] ` and rejects a first paragraph with two sentences. Quote the smallest span the comment is about.
- **Below** text is plain prose only. Don't style it, add labels or prefixes like "Suggested:". The script colours it red and it takes the paragraph's own font and spacing; under a heading it becomes Normal text. For a multi-paragraph addition, separate paragraphs with `\n`. Leave the original paragraph and any `{TBC}` marker in place, because the author deletes what they don't keep.
- **Suggest**: `find` is the original wording (one paragraph, no chips or footnote marks), `replace` is the whole corrected span. The script diffs them word by word and strikes whole words only. Changes one or two words apart merge into a single suggestion. When most of a sentence changes, use `below` instead, because a dense run of suggestions is hard to review.

While pending, Google shows suggested words in its suggestion colour; they turn red when accepted.

## Choosing a type

- Asked to "copyedit" or "fix the grammar": `suggest` for small fixes, `comment` for anything needing the author's judgement.
- Asked to "rewrite", "tighten" or "draft" a passage, or to fill a placeholder: `below`.
- Never make direct, uncoloured edits to the author's text.
- Match the doc's typography in new text: if `read` shows curly apostrophes and quotes (’ “ ”), use them too.

## Common mistakes

| Symptom | Fix |
|---|---|
| `appears N times` | Quote more surrounding words |
| `not found` | Copy from `read` output, not from memory; the doc may use curly quotes or have changed |
| `overlaps a pending suggestion` | Someone has an open suggestion there; comment instead |
| `overlaps another edit` | Merge the two items into one `find`/`replace` |
| Comment rejected for two sentences | Move the second sentence after a blank line |
| Retry fails on revision | The doc is being edited heavily; wait and rerun the same plan |
| `… failed: … Already applied: …` | A later step was rejected after earlier ones landed. Remove the applied items from the plan before rerunning, or they will be added twice |
