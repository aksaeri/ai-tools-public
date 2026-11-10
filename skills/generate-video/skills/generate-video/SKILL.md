---
name: generate-video
description: Make a video and hand back an mp4. Two routes - a video model for short realistic clips (people, places, action, "a 5-second video of X doing Y"), or a video Claude composes itself from an animated HTML page with narration (explainers, product mockups, concept tours, data stories, narratives over generated or edited images). Use when the user asks for a video, clip, animation, explainer, trailer or motion graphic. Not for still images (generate-image) or for transcribing video (transcribe).
allowed-tools:
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/film.js *)
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/narrate.js *)
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/render.js *)
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/music.js *)
- Bash(node ${CLAUDE_SKILL_DIR}/scripts/sfx.js *)
---

# generate-video

Two ways to make a video. Choose first; they share almost nothing.

## Which route

Ask what carries the video: **footage that has to look real**, or **information and designed pictures**.

| The video is mainly | Route | Why |
|---|---|---|
| Realistic people, animals, places, action. A short film or a shot from one. "A 5-second video of X doing Y I can share." | **Film**: a video model makes it | Only a model can make footage. Costs about 7 cents a second. Clips are 3 to 15 seconds. |
| An explanation, a concept tour, a product mockup or demo, a data story, a title sequence, kinetic text, a narrative told over still images or edited photos | **Compose**: you build it as an animated HTML page and render it | You control every word, number, layout and timing exactly, at any length, and can revise one detail without redoing the rest. Costs a few cents of narration. |
| Both: an explainer that needs a few real-looking shots, or a story over generated pictures | **Compose, with filmed clips and generated images placed inside it** | The composition is the edit; `film.js` and the generate-image skill supply the footage and stills. |

Signs you picked wrong: a video model asked for text, charts, a real product's interface or exact timing gets them wrong. A composition asked for a believable person or animal looks like a cartoon.

If the request could be either ("make a video about our launch"), ask one question: should it look filmed, or designed? Otherwise pick, and say which route you took.

## Film: a clip from a video model

```bash
node ${CLAUDE_SKILL_DIR}/scripts/film.js "what happens in the clip" [--seconds 5] [--resolution 720p] [--aspect 16:9] [--image first-frame.jpg] [--last-frame end.jpg] [--ref look.jpg ...] [--model omni] [--tag label] [--out clip.mp4] [--dry-run]
```

**Run it in the background** (`run_in_background: true`): a clip takes 30 to 90 seconds. It prints one JSON object with `video_path` and `cost_usd`. Then check the clip before showing it: `node ${CLAUDE_SKILL_DIR}/scripts/render.js clip.mp4 --sheet every=1 --out sheet.jpg` makes a contact sheet of it; look at that with the Read tool.

- `--seconds`: 3 to 15 (default 5).
- `--resolution`: `720p` (default), `360p` for a cheap draft, `1080p`, `4k`.
- `--aspect`: `16:9` (default) or `9:16` for a phone.
- `--image`: start the clip from this picture. Make the picture with generate-image first when the look matters; it is far cheaper to get a still right than a clip.
- `--last-frame`: end on this picture (with `--image`; clips up to 10 seconds).
- `--ref`: up to 6 pictures of a character, object or style the clip should match.
- `--dry-run`: check the request and print the estimated cost without calling anything.

| `--model` | What | Cost for 5 s at 720p | Use for |
|---|---|---|---|
| `omni` *(default)* | Gemini Omni 1.2 Flash, sound included | about $0.35 ($0.12 at 360p, $0.52 at 1080p) | Nearly everything. One key, any length from 3 to 15 s. |
| `wan` | Alibaba Wan 3.0 through OpenRouter | about $0.50 | A second opinion when Omni's people or motion look wrong; 1:1 and 4:3 shapes; clips up to 30 s. |
| `seedance` | Seedance 2.5 through OpenRouter | about $1 or more | Best-rated for realistic people and for starting from an image. Use for a final, not a draft. |
| any `owner/name` id | Any video model OpenRouter lists | varies | `--dry-run` shows the price and checks the length and size are allowed. |

Prompting, in short: describe one continuous shot (subject, action, setting, camera, light), say "single continuous shot, no scene cuts" unless you want cuts, and describe the sound you want ("Sound: wind, footsteps. No dialogue, no music."). **Read `references/filming.md` before a clip that matters.**

Limits to tell the user about when they apply: the default model refuses pictures of some recognisable people and will not edit pictures of children in the UK and EU; every clip carries an invisible watermark; Google keeps the request for 55 days.

## Compose: a video you build

You write an HTML page that animates; `render.js` draws it frame by frame in headless Chrome and encodes an mp4. The page's clock is controlled, so CSS animations, transitions, `setTimeout` and `requestAnimationFrame` all follow video time and every render is identical.

**Read `references/composing.md` before your first composition in a session.** It holds the craft: storyboard, pacing, look, sound, and the review loop. (The reference files write script paths relative to this skill's folder: `scripts/render.js` there is `${CLAUDE_SKILL_DIR}/scripts/render.js` here.) The steps:

1. **Brief.** Who watches, the one thing they should take away, length, shape (1920x1080, or 1080x1920 for a phone), voice or silent.
2. **Storyboard and script.** Write `storyboard.md` and `script.txt` before any code. For a video over a minute, or one going to other people, show the user the storyboard first.
3. **Start from the template.** `cp -r ${CLAUDE_SKILL_DIR}/assets/template my-video`
4. **Narrate.** `node ${CLAUDE_SKILL_DIR}/scripts/narrate.js script.txt --out-dir audio --style "warm, clear, lively pace"` makes one sound file per line, trims and evens out each one, builds a timeline, and notes when each word is spoken. Time the pictures to it: `data-at="n03"` means "when line 3 starts", and `data-at="n03:fox"` means "when the word fox is spoken in line 3". If it reports `check_these_lines`, the voice may have said a word wrong: run it once more with `--redo 03` (each take differs), and if it is still flagged, rewrite the line or tell the user.
5. **Build** the page: your own look, one idea per scene.
6. **Check, look, fix. Repeat.** You can't watch the video, so:
   - `node ${CLAUDE_SKILL_DIR}/scripts/render.js comp.html --check` finds text that is cut off, overlapping, partly hidden behind a picture, too small, or gone too fast to read.
   - `... --sheet every=1 --out out/sheet.jpg` makes a contact sheet. Read it. `--strip 4.0:4.6` shows every frame of a moment; `--frame 7.2 --out out/f.png` one frame at full size.
7. **Render.** `node ${CLAUDE_SKILL_DIR}/scripts/render.js comp.html --out out/video.mp4` (run in the background for long videos: it draws 15 to 25 frames a second at 1080p, so a one-minute video takes about two minutes). Then make a contact sheet of the finished file, `... render.js out/video.mp4 --sheet every=2 --out out/final-sheet.jpg`, and look once more before handing it over.

`render.js` reads size and length from the page: `<html data-width="1920" data-height="1080" data-fps="30" data-duration="24">`. Leave `data-duration` out when using the template and the video ends 1.5 seconds after the narration (`data-tail="2.5"` on the `<html>` tag changes that). `--from 4 --to 9` renders part of it. Output folders are created for you.

**Sound.** Three kinds, and the renderer balances them for you, because you can't hear the result:
- **Voice:** the template adds the narration lines.
- **Music:** `node ${CLAUDE_SKILL_DIR}/scripts/music.js "warm felt piano and soft pads, calm and curious, 80 bpm" --seconds 55 --out audio/music.mp3` (8 cents; ask for the video's length plus about 8 seconds). Place it with `<audio src="audio/music.mp3" data-role="music" data-start="0" data-fade-out="2.5">`. With `data-role="music"` the renderer sets its level under the voice and lowers it further while the voice speaks; don't set a volume. A narrated video with no music feels bare past about 15 seconds, so add some unless the user wants it plain.
- **Effects:** `node ${CLAUDE_SKILL_DIR}/scripts/sfx.js make all --out-dir sfx` makes a small set (whoosh, pop, tick, thud, puff, riser, chime); `sfx.js find "page turn" --out sfx/page.mp3` fetches a public-domain recording. Place one with `<audio src="sfx/pop-1.wav" data-start="n04:thirty">`. Use few, each with a cause on screen.

A `<video>` clip plays in step with the timeline from its `data-start`; its own sound is included unless it has the `muted` attribute (`data-volume="0.15"` keeps it under the voice). `render.js` brings the finished sound to a standard loudness and reports what it measured under `sound`: read it. `voice_over_music_lu` should be 15 or more (under 10 the voice is hard to follow), and any `warnings` need fixing. Tell the user which sounds were generated and that you could not listen to the finished video.

Rules that keep renders working:
- Local files only. No CDN scripts, web fonts or remote images: copy what you need into the folder.
- Fonts must be installed or loaded with `@font-face` from a local file.
- Chrome must be Google Chrome to play clips from `film.js` (they are H.264).

## Cost and the usage log

- Film: about 7 cents a second at 720p on the default model. Narration: about 1.4 cents a minute (Google has said this doubles on 1 January 2027), plus a hundredth of a cent a line for word times. Music: 8 cents a piece. Effects and rendering are free.
- Every film, narration and music call adds a line to `~/skills-output/generate-video/usage.jsonl`, failures included, with `kind`, `model`, `cost_usd` and `tag`. Pass `--tag project/run` to group calls.
- Clips are saved in `~/skills-output/generate-video/` unless `--out` says otherwise. A composition lives in its own folder, wherever you put it.
- Before a batch of more than a few dollars, tell the user the estimate (`--dry-run`).

## Setup

Needs Node 22 or later, `ffmpeg` on the PATH, and Google Chrome (or set `CHROME_PATH`). The scripts read their keys themselves, from the environment or else from `~/.claude/.env`, so run them exactly as shown, with nothing in front. `GEMINI_API_KEY` for the default film model, narration and music; `OPENROUTER_API_KEY` for other film models; `GROQ_API_KEY` for word times and the speech check (optional: without it, narration still works and times are per line).

## Related

- **generate-image** makes and edits the still pictures a video uses (`--ref` keeps a character the same across them).
- Changes: `CHANGELOG.md`.
- **If `local.md` exists next to this file, read it too.** It holds this machine's own notes: where the source lives, and how to show the user a finished video.
