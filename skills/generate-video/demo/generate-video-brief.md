# generate-video: a brief for rebuilding it

This describes a Claude Code skill that makes videos in two different ways. It covers the behaviour and the decisions behind it, so you can rebuild it for your own setup. The original is a SKILL.md, two reference guides, an HTML template and a handful of Node scripts with no npm dependencies.

## The problem

"Make a video" covers two different jobs. A short clip of a fox trotting across snow has to look filmed, and only a video model can make that. An explainer with exact words, numbers, charts and timing is something a video model gets wrong every time. Claude can build that kind of video itself, as long as it has a way to turn a web page into an mp4 and some way to check a result it can't watch.

## What it does

Claude picks a route first, and says which one it took.

- **Film:** a video model makes a 3 to 15 second clip from a prompt, optionally starting from a picture. The default model includes sound and costs about 35 cents for 5 seconds at 720p.
- **Compose:** Claude writes a storyboard and script, generates the narration, builds an animated HTML page timed to the narration, checks it, and renders it to an mp4 in headless Chrome. It can place filmed clips and generated pictures inside the composition.

## Components

1. **SKILL.md**: choosing the route, the commands, costs and setup.
2. **references/filming.md** and **references/composing.md**: the craft for each route, including storyboards, pacing, look and the review loop.
3. **assets/template/**: a starting composition with a stage, a script file and narration wiring.
4. **scripts/film.js**: one call to a video model, through Gemini or OpenRouter, with a dry run that shows the price.
5. **scripts/narrate.js**: one sound file per script line, trimmed and evened out, with a timeline and the time each word is spoken.
6. **scripts/render.js**: draws the page frame by frame on a controlled clock and encodes the mp4. It also checks the page and makes contact sheets.
7. **scripts/music.js** and **scripts/sfx.js**: a generated music bed, and a small set of synthesised effects or a public-domain recording.

## Decisions worth keeping

1. **Choose the route before anything else.** A model asked for text or charts gets them wrong, and a composition asked for a believable person looks like a cartoon. When a request could go either way, Claude asks one question: should it look filmed, or designed?
2. **A controlled clock.** The renderer takes over the page's time, so CSS animations, timers and animation frames all follow video time and every render comes out the same.
3. **Time pictures to the voice.** The narration script records when each line starts and when each word is spoken, so an element can appear "when the word fox is spoken in line 3".
4. **Check what you can't watch.** Claude can't see a video play, so the renderer finds text that is cut off, overlapping, too small or gone too fast to read, and makes contact sheets and frame strips for Claude to look at. It also measures the finished sound: the voice should sit well above the music.
5. **Get stills right first.** A picture costs a few cents and a clip costs tens of cents, so the look is settled as a still, made with the generate-image skill, and the clip starts from it.
6. **Log every paid call** with its cost, and give an estimate before any batch worth more than a few dollars.

## What you need

- Node 22 or later, ffmpeg and Google Chrome.
- A Gemini API key, `GEMINI_API_KEY`. `OPENROUTER_API_KEY` (for other video models) and `GROQ_API_KEY` (for word timings and a speech check) are optional.
- About 35 cents per 5-second clip, 8 cents per piece of music, and about 1.4 cents a minute of narration. Effects and rendering are free.
- Tested on Linux only, not on Windows or macOS.

## Reference code

The published skill is the reference implementation: [generate-video on GitHub](https://github.com/aksaeri/ai-tools-public/tree/main/skills/generate-video/skills/generate-video). Start from it and change what your setup needs. Where to look:

- `SKILL.md`: choosing between filming and composing, the commands and the costs.
- `references/composing.md` and `references/filming.md`: the craft of each route.
- `scripts/render.js` with `scripts/lib/virtual-time.js` and `chrome.js`: the controlled clock and frame-by-frame rendering; `scripts/lib/check.js` finds unreadable text, and `scripts/lib/mix.js` balances voice, music and effects.
- `scripts/narrate.js`, `music.js`, `sfx.js` and `film.js`: narration with word times, music, effects, and video-model clips.
- `assets/template/`: the starting composition.
