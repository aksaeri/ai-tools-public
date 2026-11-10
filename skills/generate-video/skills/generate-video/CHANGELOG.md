# generate-video changelog

## 2026-11-10, second update

Sound, brought in line with a second research round (voice, music, effects, mixing). Existing compositions still render; their sound will measure differently.

- **Narration lines are trimmed and levelled.** Each line loses the silence at its ends and is brought to -20 LUFS, so lines start on time and match in loudness. All lines are made again once after this update. `--redo 03,07` makes named lines again.
- **The mix is set by measurement.** Music marked `data-role="music"` is levelled 12 LU under the voice and lowered a further 8 dB while the voice speaks. The finished sound is brought to -14 LUFS with peaks under -1 dB (`--loudness` changes or disables that). `render.js` reports loudness, peak and how far the music sits under the voice, with warnings.
- **Sound effects** (`scripts/sfx.js`): a synthesised set (whoosh, pop, tick, thud, puff, riser, chime), and a search of Openverse for short public-domain recordings.
- **Music** is asked for as a bed under a voice by default (`--plain` turns that off), with the ending placed; a note of the prompt and terms is saved beside the file.
- **Guide:** a Sound section in `references/composing.md`: voices and style, music, effects, and how to check a mix nobody can hear.

## 2026-11-10

First version.

- **Film** (`scripts/film.js`): a clip from a video model. Default is Gemini Omni 1.2 Flash through the Gemini key (3 to 15 seconds, sound included, about 7 cents a second at 720p). Other models go through OpenRouter by id; `wan` and `seedance` are short names. `--image`, `--last-frame` and `--ref` start from or match pictures. `--dry-run` checks the request and estimates the cost.
- **Compose** (`scripts/render.js`): turns an animated HTML page into an mp4 with headless Chrome and ffmpeg. The page's clock is controlled, so renders are identical every time. Also makes contact sheets, frame strips and single frames, and `--check` reports text that is cut off, clipped, overlapping, partly hidden, too small or shown too briefly. `--sheet`, `--strip` and `--frame` also read a finished video file.
- **Narrate** (`scripts/narrate.js`): one sound file per script line with Gemini TTS, a timeline, word times and a speech check (the last two through Groq Whisper). Unchanged lines are not generated again.
- **Music** (`scripts/music.js`): an instrumental piece from Google's Lyria, 8 cents. Sound tracks in a composition can fade out at the end (`data-fade-out`) and repeat (`data-loop`).
- **Template** (`assets/template/`): `stage.js` times scenes and elements from attributes, including times tied to narration lines and words.
- **Guides**: `references/composing.md` and `references/filming.md`.
- Usage log: `~/skills-output/generate-video/usage.jsonl`.

A fresh agent made a video from these instructions alone before release; its ten findings are fixed in this version (rate-limit retries, timeline kept in step with the sound files after a failed run, British spellings in the speech check, contact sheets from a finished mp4, SVG transforms left alone, clearer length and pause guidance).

Not tested on Windows.
