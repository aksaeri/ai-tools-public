---
name: generate-image
description: Generate raster images with Google's Gemini image models (Nano Banana) - scenes, illustrations, characters, avatars and icons, product or food photos, card and book art. Use when the user wants a picture only an image model can make. Not for diagrams, charts or flowcharts (draw those as SVG or HTML), cover or abstract generative art (draw those in code), or video (the generate-video skill).
allowed-tools:
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/generate.js *)
---

# generate-image

Turns a text prompt into a picture with Google's Gemini image models (the Nano Banana family) and saves it to disk. Defaults to the cheapest model at 1K.

**If `local.md` exists next to this file, read it first.** It holds this machine's own notes: where the skill's source lives, and who related work is handed to.

## Is this the right tool?

| The user wants | Use |
|---|---|
| A scene, illustration, character, avatar, icon, photo-style image, card or book art | **This skill** |
| A diagram, flowchart, taxonomy, framework, chart or labelled explainer | Draw it yourself as SVG or HTML. You get exact text and layout, and it can be edited. |
| Cover art, an abstract header, generative or algorithmic art | Draw it in code (canvas, p5.js, SVG): an image model is the wrong tool. `local.md` may name a session that does this. |
| A video: a realistic clip, or an explainer or animation | The **generate-video** skill. It uses this skill for the still pictures a video needs. |

## Usage

```bash
node ${CLAUDE_SKILL_DIR}/scripts/generate.js "what to draw" [--model lite|flash|pro] [--aspect 4:3] [--size 1K] [--style "style directive"] [--ref image.png ...] [--tag label]
```

**Always run it in the background** (`run_in_background: true`). A call takes 10 to 60 seconds. When it finishes, read the JSON for `image_path` and look at the image with the **Read** tool before showing it to the user.

## Options

- `--model`: `lite` (default), `flash`, `pro`, or a full model id. See **Choosing a model**.
- `--aspect`: aspect ratio, default `4:3`. `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9` work on every model; `4:1`, `1:4`, `1:8`, `8:1` need `flash` or `pro`.
- `--size`: resolution, default `1K`. `lite` makes 1K only; `flash` makes `512`, `1K`, `2K`, `4K`; `pro` makes `1K`, `2K`, `4K`.
- `--style`: a style directive put before the prompt. Use it to keep a series consistent (below).
- `--ref`: a reference image to edit or to draw from. Repeat it for several (up to 14). See **Reference images**.
- `--tag`: a label for the usage log, such as `my-project/run-3`.
- `--no-style`: accepted for older callers; does nothing now, because there is no default style.

A size or aspect the model can't make fails at once with a message naming the model to use, before any call is paid for.

## Choosing a model

| Model | Id | Cost at 1K | Use for |
|---|---|---|---|
| `lite` *(default)* | `gemini-3.1-flash-lite-image` | about 3 cents | Drafts, avatars, icons, batches, most one-off pictures. 1K only. |
| `flash` | `gemini-3.1-flash-image` | about 7 cents | Better detail and prompt-following; anything above 1K or below; wide banners (4:1, 8:1). |
| `pro` | `gemini-3-pro-image` | about 13 cents (24 at 4K) | Final or published images, photorealism, complex scenes, text that must render correctly. |

Start with `lite` unless the request says otherwise. Move up when the user wants a final version, a larger size, a hard composition or legible text in the image, and say which model you used so they can redo it at another level cheaply. Ask first before a large batch on `pro`.

## Writing the prompt

There is no built-in style: the model gets your prompt as written, plus `--style` if you pass one. So describe the picture fully: subject, setting, composition, lighting, medium (photo, watercolour, flat vector, 3D render) and mood. Say "no text" if you don't want lettering; image models add it freely.

## A series that matches

For several images that belong together (card fronts, book scenes, a set of avatars), write one style directive of two or three sentences covering medium, palette and mood. Pass the same `--style` to every call and vary only the prompt.

```bash
STYLE="Soft gouache illustration for a children's book. Warm muted palette of ochre, sage and dusty blue. Gentle side light, simple shapes, no text."

node ${CLAUDE_SKILL_DIR}/scripts/generate.js "a fox reading under a lamp" --style "$STYLE" --aspect 2:3
node ${CLAUDE_SKILL_DIR}/scripts/generate.js "a hedgehog crossing a stream on stones" --style "$STYLE" --aspect 2:3
```

## Reference images

Pass `--ref <file>` to give the model a picture to work from (png, jpg, webp; 14 MB in total). Three uses:

- **Edit a picture.** Say what to change and what to keep: "make it winter, with snow on the rock; keep the fox, its pose and the camera angle exactly the same". Without `--aspect`, the result keeps the shape of the first reference image.
- **Keep a character or object the same across a series.** Generate or pick one good image of the character, then pass it as `--ref` to every later call and describe the new scene. Say "the same fox as in the reference image".
- **Combine or restyle.** Pass several images and say what each is for: "put the mug from the first image on the desk in the second".

```bash
node ${CLAUDE_SKILL_DIR}/scripts/generate.js "the same fox as in the reference image, now trotting across a frozen lake at sunset" --ref fox.jpg --aspect 16:9
```

`lite` handles one reference image well. For several references, or a face that must stay recognisable, use `--model flash` or `--model pro`. Each reference image adds about a twentieth of a cent to the call.

## Output

Saves to `~/skills-output/generate-image/generated-<timestamp>.<jpg|png>`.

On success, prints one JSON object to stdout: `success: true`, `image_path` (absolute), `prompt_used`, `style_used`, `model`, `model_label`, `aspect_ratio`, `size`, `timestamp`, `tag`, `refs`, `usage` (token counts), `cost_usd`, `cost_basis`. Nothing else is printed to stdout; callers parse it whole.

On failure, prints `{"success": false, "error": "..."}` to stderr and exits 1. A call that gets no answer within 240 seconds fails with a timeout.

## Cost and the usage log

- Every call that gets past argument checks adds one line to `~/skills-output/generate-image/usage.jsonl`, failures included (they carry an `error` field). Other tools may write to the same file in the same format, so keep the field names unchanged.
- `cost_usd` is the API's token counts times Google's list price. Use it for budgets.
- `node ${CLAUDE_SKILL_DIR}/scripts/usage-report.js [--since YYYY-MM-DD] [--tag text] [--json]` totals spend by day, tag and model.
- Prices are in the `PRICES` table at the top of `scripts/generate.js` (source: https://ai.google.dev/gemini-api/docs/pricing, checked 2026-10-26).

## Cleaning up old images

Nothing removes old images on its own. `node ${CLAUDE_SKILL_DIR}/scripts/cleanup.js` lists generated images older than 60 days and deletes nothing; add `--delete` to remove them, or `--older-than 30` to change the age. It never touches `usage.jsonl`. Only run it with `--delete` when the user asks: an image a session made and never copied elsewhere exists only in that folder.

## Setup

Needs `GEMINI_API_KEY`, in the environment or in `~/.claude/.env`. The script reads it itself.

## Changes

See `CHANGELOG.md` in this folder.
