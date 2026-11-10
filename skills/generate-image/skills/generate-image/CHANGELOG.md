# generate-image changelog

## 2026-11-10

Additions only. Nothing existing changed, so callers need do nothing.

- **Reference images.** `--ref <file>`, repeatable up to 14, sends pictures along with the prompt: edit a photo, keep a character the same across a series, or combine images. Without `--aspect`, the result keeps the first reference image's shape. The success JSON gains `refs` (absolute paths), and the usage log gains `refs` (a count) on calls that used any; calls without `--ref` log exactly as before.
- **Video has its own skill now.** The routing table points video requests to generate-video.
- **Key from the environment.** `GEMINI_API_KEY` set in the environment is now used first; `~/.claude/.env` is the fallback, as before.
- **Cleanup script.** `scripts/cleanup.js` lists generated images older than 60 days, and deletes them only with `--delete`. It never touches `usage.jsonl`.

## 2026-10-26

The skill is for pictures now, not diagrams.

Changes callers may notice:

- **No default style.** Before, a call without `--style` or `--no-style` had a diagram style put in front of the prompt. Now the prompt goes to the model as written. `--no-style` still works and does nothing.
- **Default model is `lite`** (was `flash`). A caller that wants `flash` must now pass `--model flash`.
- **Default size is `1K`** (was `2K`).
- **Unsupported sizes and aspects fail before the call.** `lite` makes 1K only, and `pro` doesn't make 512. These used to reach Gemini and come back as a 400 error. A call that sends `--size 2K` without `--model` now fails until it adds `--model flash` or `--model pro`.
- **Failures are logged.** Every failed call now adds a line to `usage.jsonl` with `success: false`, `tokens: null`, `cost_usd: null` and an `error` field, the shape other writers of this log already use. Before, API and network errors left no trace.
- **240-second timeout** on the Gemini call. It used to wait indefinitely.

Unchanged: the flags, the JSON on stdout and its field names, the error JSON on stderr with exit code 1, the output folder, and the existing usage log fields.
