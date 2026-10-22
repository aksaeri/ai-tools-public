# gdocs-suggest: a brief for rebuilding it

This describes a Claude Code skill that reviews and edits Google Docs so that every word Claude adds stays visibly Claude's. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is one Node script (about 710 lines, plus 390 lines of tests) and a SKILL.md that tells Claude how to use it.

## What it does

You ask Claude to copyedit, comment on, or fill the gaps in a Google Doc. Claude reads the doc, writes a plan of changes, checks the plan against the doc, then writes it. Each change takes one of three forms:

| Form | What appears in the doc | Used for |
|---|---|---|
| Comment | A margin comment pinned to the exact words, starting `[Claude]` | Questions, flags, reasons |
| Red text below | A new paragraph in red under the original, which stays untouched in black | Rewrites, filled `{TBC}` markers, drafted additions |
| Suggestion | A real Suggesting-mode edit, with inserted words in red | Small fixes: grammar, word choice, cuts |

Red text and the `[Claude]` prefix are the only signs that Claude wrote something, because comments and suggestions appear under the signed-in user's name.

## Components

1. **A command-line script** with three commands:
   - `read <doc>` prints each paragraph, with pending suggestions as `[+ins]`/`[-del]`, red text as `{red: …}`, and open comments. Claude plans from this output, never from memory.
   - `apply <doc> plan.json [--dry-run]` checks the whole plan, then writes it.
   - `undo <doc>` removes exactly what the last run added.
2. **A Google Workspace command-line client.** The original uses `gws` (`@googleworkspace/cli`), which handles sign-in. Any client that can call the Docs and Drive APIs as the user would do.
3. **SKILL.md**, which teaches Claude the plan format, when to use each form, and the rules below.

## The plan

A JSON list. Each item quotes the doc exactly:

```json
[
  {"type": "comment", "quote": "the most comprehensive resource of its kind",
   "text": "This claim needs a source, or softer wording.\n\nReaders will check a claim this strong."},
  {"type": "below", "after": "Funding: {add detail on the two grants}",
   "text": "Funding: two grants, one for the repository and one for the governance mapping."},
  {"type": "suggest", "find": "The results shows that most organisations has not",
   "replace": "The results show that most organisations have not"}
]
```

When a quote appears more than once and can't be lengthened (a table cell holding only "TBC"), the item adds `"occurrence": n`, counted from the top.

## How each form maps to the Docs API

All writes go through `documents.batchUpdate`.

- **Comment:** an `insertComment` request with the quoted range and the text. Comments must open with one sentence; detail goes in a second paragraph after a blank line. The script rejects anything else, so the margin stays skimmable.
- **Red text below:** `insertText` of a newline plus the text at the end of the paragraph, then `updateTextStyle` to set the colour to red. The same request clears bold, italic, underline, links and background, so the new text doesn't inherit them from the end of the paragraph. Font, size and spacing are never set, so the text takes the paragraph's own style. Under a heading it first sets the new paragraph to Normal text.
- **Suggestion:** the same requests sent with `writeControl.writeMode: SUGGEST`. The script diffs `find` against `replace` word by word, strikes whole words only, merges changes one or two words apart, and sends the pieces last to first so earlier positions stay valid.
- **Concurrency:** every batch is pinned to the revision just read (`writeControl.requiredRevisionId`). If a collaborator edits in between, the script re-reads and rebuilds, up to three tries.

Pinned comments and suggest-mode writes were marked "Developer Preview" by Google in October 2026. Check that they work on your account with a scratch doc first.

## Rules worth keeping

1. Check the whole plan before writing anything. If one quote is missing or appears twice, change nothing and list what to fix.
2. Never delete the author's text directly. Direct edits may only insert text, colour it and add comments. Deletion happens only as a suggestion, capped at 500 characters each. A safety check refuses any batch that breaks this, before it is sent.
3. Back up first. Copy the doc to a "backups" folder in the user's Drive, and keep a journal on disk of what the run is about to do.
4. Verify after writing. Re-read the doc with every pending suggestion hidden (`suggestionsViewMode: PREVIEW_WITHOUT_SUGGESTIONS`) and confirm the original text is still there character for character, apart from the red paragraphs. If not, warn and stop.
5. Make undo exact. Undo removes only this run's comments, pending suggestions and red paragraphs, and leaves collaborators' edits alone. If the connection dropped mid-run, it works out what was added from the doc itself.
6. Match the document's typography in new text, such as curly quotes.
7. Use red text, not a dense run of suggestions, when most of a sentence changes. That's easier to review.

## When not to use it

- Final versions about to go out, since the red text and `[Claude]` labels are meant to be cleaned up by a person.
- Heavy restructuring, such as moving sections or rebuilding tables. Plan that in chat instead.

## Rebuilding it

- Start with `read` and the plan checker. They need no write access, and the plan format is the part worth getting right.
- Then add the three request builders, the safety check and the after-write check, before you point it at a real document.
- The colour, the `[Claude]` prefix and the one-sentence rule are constants, so change them to suit your own conventions.
