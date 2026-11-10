# Composing a video

How to make a composed video that is worth watching. The mechanics are in `SKILL.md`; this is the craft. Script paths here are written relative to the skill's folder: `scripts/render.js` is the `render.js` whose full path `SKILL.md` gives. It draws on what people making Claude-built videos reported through 2026: the tooling was rarely the problem. Pacing, a generic look and unchecked frames were.

You wrote the code, so you know what happens. The viewer sees it once, at full speed, for the first time. Most of this guide follows from that.

## 1. Storyboard before code

Write `storyboard.md` first. One-line prompts turned straight into code give generic results.

```
Point: the one thing the viewer should take away.
Viewer: who, what they already know, where they watch (phone feed, shared link, a talk).
Shape and length: 1920x1080, about 35 s.
Look: (see section 3) palette, type, the recurring visual idea.

Scenes:
  1  0-7 s    "Line the voice says."
     shows:   what is on screen
     reads:   1. the title (2 s)   2. the number 236 (1.5 s)
     motion:  how things arrive and what changes
  2  7-15 s   ...
Ending: what the last frame holds, and for how long.
```

A **read** is one thing the viewer has to notice and understand. The reads are the timing plan:

- Every read needs time to be found, understood and registered. Budget **half a second plus a third of a second per word** for text; more for a chart or anything small.
- **One read at a time.** Two things arriving together means one is missed. Put a cause before its effect, not on top of it.
- **Quick motion, held meaning.** An element can arrive in half a second. What it means needs the hold after it. A video at one constant speed, fast or slow, is flat.
- **Let the reads set the length.** If a scene's reads don't fit, lengthen it or cut a read. Don't squeeze.
- The last frame needs its hold too: at least 1.5 seconds after the final read.

For anything over a minute, or going to other people, show the user the storyboard before building. It is the cheapest point to change direction.

## 2. Narration

Narration sets the timing, so do it before the pictures.

- Write for the ear: short sentences, one idea per line, plain words, numbers rounded ("about two hundred", not "236.4"). A line is one sound file; keep each under about 25 words.
- Length: the style sets the speed. Measured: about 2.8 words a second with `--style "warm, clear, lively pace"`, about 1.8 with "unhurried". Add half a second before the first line and 0.4 seconds between lines (`--start` and `--gap` change those). So a 20-second video is about 45 words in five lines at a lively pace. `--dry-run` gives a rough length before you pay; the first real run gives the true one, so check `narration_ends_at` and trim the script if it runs long.
- `script.txt` takes one line per line. `[pause 1.5]`, on a line of its own, adds that much silence before the next line: use it where a picture needs time on its own. Pause lines don't count in the numbering (`n03` is still the third spoken line), and adding or changing them costs nothing to re-run.
- `node scripts/narrate.js script.txt --out-dir audio --style "warm, clear, lively pace"` writes the sound files and `audio/narration.js`. Each line has its silent ends trimmed and is brought to the same loudness, so lines start when the timeline says and none is louder than the next. `--model lite` is cheaper for drafts.
- Voice: the default is `en-au-storyteller-1`, an Australian woman's voice, low and calm, from Google's voice library. `--voice` changes it: to one of Google's thirty named voices (`Kore` is firm, `Charon` and `Rasalgethi` informative, `Schedar` even, `Iapetus` and `Erinome` clear, `Achird` friendly, `Sulafat` warm), or to any id from the library, which holds hundreds across accents and languages (`curl -G https://generativelanguage.googleapis.com/v1beta/voices -H "x-goog-api-key: $GEMINI_API_KEY" --data-urlencode "language_code=en-GB"` lists them with descriptions). Keep the default unless the user asks for another; for something that matters, make one line in three voices and let them choose, because you can't judge a voice.
- Style: one short description, the same for every line, such as "warm, clear, lively pace". Google's advice is to start with none and add only what is missing. Set the pace in the style ("speaking slowly", "lively pace"). Don't describe age, gender or accent, and don't ask for consistency: extra instructions make the voice drift.
- The text is spoken exactly as written. Put delivery in `--style`, never in the text. For stress, write the word in CAPITALS. For a pause, use a comma, a dash, `...`, or `<short pause>` and `<long pause>`. Write numbers, dates and abbreviations the way they should be said ("thirty-five cents", "A I").
- Changing a line and running it again regenerates only that line and re-times everything after it. Changing `--voice`, `--style` or `--model` regenerates every line.
- Google allows about ten lines a minute. Past that the script waits and carries on by itself, so a long script takes a few minutes. If a run still fails part-way, the lines that worked are kept and the timeline still matches the sound files: run the same command again.
- In the page, tie times to the narration: `data-at="n03"` (line 3 starts), `"n03.end"`, `"n03+0.8"`, and best of all **`"n03:fox"`: when the word "fox" is spoken in line 3** (`"n03:the#2"` for the second "the", `"n03:fox-0.2"` for just before; case and punctuation are ignored, so "it's" is `n03:its`). Then a changed script moves the pictures with it. Bring each picture in as its word is spoken, or a beat before; never after.
- You can't hear it, so `narrate.js` listens for you: it transcribes each line and lists under `check_these_lines` any script word the transcript doesn't contain. That is a prompt to act, since the transcriber also mishears. First run again with `--redo 04` (the line's number): every take is a little different, and a second take often clears it. If it is flagged twice, rewrite the line, respell the word the way it sounds, or tell the user it couldn't be confirmed.
- Word times and the speech check need a `GROQ_API_KEY`. Without one, only whole-line times work.

Words on screen should be the narration's own words: a headline that says "is blue" while the voice says "looks blue" reads as a mistake.

A silent video is fine for a short loop or a clip that will play muted in a feed. Then the text on screen carries everything, and needs longer holds.

## 3. The look

Left alone, the result looks like a web page: centred text on a dark gradient, rounded cards in a grid, one accent colour, everything fading up. Viewers now recognise that as generated. Decide the look on purpose.

- **Start from something real** when there is something: the user's brand, their product's actual screens, a reference video or image they like, the subject's own material (a paper's figures, a map, photographs). Rebuild a product's interface from its real colours, fonts and wording; don't invent a generic one.
- Otherwise choose a direction and write it down in three lines: a small palette (a ground, an ink, one or two accents), one or two typefaces, and **one recurring visual idea** that carries across scenes (a line that keeps drawing, a grid that reorganises, a single object that transforms). Continuity between scenes is what makes it a film and not slides.
- Use the frame. Big type (titles over 100 px at 1080p; nothing under 28 px), strong alignment, deliberate empty space, things placed off-centre. Fill the frame or leave it empty on purpose.
- Fonts must be installed or bundled. Check with `fc-list : family | sort -u`, or put a font file in the folder and load it with `@font-face`. A missing font silently becomes a default one.
- Pictures: make stills with the generate-image skill (one `--style` across the set; `--ref` to keep a character), real-looking shots with `film.js`, and diagrams or icons as inline SVG, which you can animate.
- For a phone (1080x1920), design it again for that shape. Don't shrink the wide one.

## 4. Building the page

Start from `assets/template/`. `stage.js` handles timing from attributes; `stage.css` holds mechanics only. The look is yours.

- A `<section class="scene" data-from="n02" data-to="n04">` is visible between those times. Elements with `data-at` get class `in` at that time; `data-enter="rise|left|right|scale|fade"` picks the entrance, or write your own CSS on `.in`.
- Inside an `<svg>`, `data-at` only fades a shape in; it leaves the shape's own `transform` alone. For SVG motion, write your own CSS on `.in` or use `stage.at()`.
- For anything richer, write ordinary code: CSS `@keyframes`, `element.animate()`, `stage.at("n03+1", () => ...)`, or a `requestAnimationFrame` loop reading `performance.now()`. All of it follows the video clock. `Math.random()` gives the same sequence every render.
- Move the camera by transforming a wrapper (pan, zoom into the part being discussed, pull back to show the whole). One slow move reads better than many cuts.
- Motion: ease in and out (never linear, except for steady drifts), stagger things that arrive together by 80 to 150 ms, and move only what the viewer should look at. Most of the frame should be still most of the time.
- Transitions between scenes should mean something: carry an element across, wipe in the direction of travel, or cut. A crossfade everywhere is the default; use it sparingly.
- Numbers that count up, bars that grow, lines that draw: animate the thing itself, because that is where a composed video beats slides.
- A film clip: `<video src="clips/fox.mp4" muted data-start="n03">` plays in step from that time. Without `muted`, its own sound is mixed in; give it `data-volume="0.15"` so it stays under the voice.
- Sound has its own section below.
- Captions: the template's `<div id="captions">` shows each line as it is spoken. Keep it for videos likely to be watched muted; remove it when the scenes already show the words.

## 5. Sound

You can't hear any of it. So the tools set levels by measurement, and your part is choosing what sound there is and where it goes. This follows what people making these videos, and the kits they publish, had settled on by late 2026.

**Music.** Make one piece per video with `music.js`.
- Describe genre, two or three instruments, tempo and mood: "warm felt piano and soft analog pads, gentle sub bass, 80 BPM, calm and curious". About 70 to 90 BPM suits a calm explainer, 100 to 120 a short punchy one.
- By default the script asks for a bed to sit under a voice: steady, sparse, no lead melody, no builds or drops. A tune or a swell competes with the narrator. Use `--plain` only when the music is the main thing.
- Ask for the video's length plus about 8 seconds (`--seconds`). The length is roughly kept, not exactly. The renderer cuts the piece at the end of the video, and `data-fade-out="2.5"` fades it. Don't loop a piece that has an ending; `data-loop` is for material made to repeat.
- Place it with `data-role="music"`. The renderer then puts it 12 loudness units under the voice and lowers it a further 8 dB while the voice speaks, easing down just before each line and back up after. Leave `data-volume` off; use it only to nudge (0.7 quieter, 1.4 louder). `data-duck="off"` stops the lowering.
- Tell the user the music is AI-made. The script saves a note of the prompt and the terms beside the file: Google claims no ownership but may make similar music for others, the file carries an inaudible watermark, and YouTube asks uploaders to disclose AI-generated music.

**Effects.** `sfx.js make all --out-dir sfx` makes the set; `sfx.js list` says what each is for.
- Every effect needs a cause on screen: a whoosh for a panel or scene moving, a pop for a number or badge landing, a tick for digits or typed characters, a puff or thud for a landing, a riser into the one big reveal. If nothing happens on screen, add no sound.
- Few and exact. A handful in a one-minute video. When several things arrive together, one sound covers them. Too many, or the same whoosh on every move, sounds like a template: rotate the variants (`whoosh-1`, `-2`, `-3`).
- Timing: start a whoosh when the movement starts; start a pop, tick or thud on the frame the thing lands. Tie them to the same times as the pictures (`data-start="n04:thirty"`).
- Prefer the gaps between narration lines, and never put an effect on the word the sentence stresses.
- For a real-world sound the set lacks (a door, rain, a page turning), `sfx.js find "page turn" --out sfx/page.mp3` fetches a short public-domain recording and notes where it came from.
- The made sounds are synthesised. The set itself has been listened to and approved by a person. What nobody has heard is your use of them in this video, so say so when you hand it over.

**The mix.** `render.js` does it: voice lines as narrated, music as above, effects and clip sound at the volume given, then the whole brought to -14 LUFS (the level YouTube plays at; `--loudness -16` for a podcast-style target) with peaks held under -1 dB. It reports under `sound`:
- `loudness_lufs`: should be within about 1 of the target.
- `true_peak_db`: should be -1 or lower.
- `voice_over_music_lu`: how far the music sits under the voice while it speaks. 15 to 20 is right; under 10 the voice is hard to follow.
- `warnings`: fix each one.

**One check by ear, done by machine.** Pull the sound out of the finished video and transcribe it (`ffmpeg -i out/video.mp4 -vn -ac 1 -ar 16000 out/check.wav`, then the transcribe skill or any speech-to-text). If the transcript matches the script, the voice is intelligible over everything else. If a word is wrong here but was right in `narrate.js`, something is masking it: lower that effect or the clip's sound.

## 6. Check, look, fix

Reading the code does not tell you how it looks or moves. Use all three levels, more than once.

1. **`--check`** measures every piece of text four times a second: off the frame, clipped by its box, overlapping other text, partly hidden behind a picture or panel, too small for a phone, or on screen too briefly to read. Fix what is real. It only knows about text, and it counts every element that holds text of its own, so a styled word inside a sentence counts separately.
2. **A contact sheet** of the whole video: `--sheet every=1 --out out/sheet.jpg` (every 2 seconds for a long one). Read it in order as a viewer would. Is each scene's point clear from its frames alone? Is anything stranded, cramped, misaligned or half off screen? Does it look like one film?
3. **Close up.** `--strip 6.8:7.4` shows every frame of a transition or entrance: look for pops, jumps and things arriving together. `--frame 12.3 --out out/f.png` shows one frame at full size: check spacing, alignment and contrast where it matters.

Then judge the timing: on a sheet at a fixed step, count how many frames each read gets, and whether anything new arrives before the last thing has landed.

Fix, then look again. Plan for at least two rounds; the first contact sheet always shows something. `--from 6 --to 12 --out out/part.mp4` renders one stretch quickly. For a long or important video, hand a fresh subagent the storyboard and the contact sheets only, and ask what it thinks the video says and where it is confusing.

After the final render, make one more sheet from the finished file (`render.js out/video.mp4 --sheet every=2 --out out/final-sheet.jpg`) and look at it before telling the user it is done.

## 7. What goes wrong most

- Everything at one brisk speed; text gone before it can be read; no holds.
- Several things arriving at once.
- Too many transitions and cuts; a different layout in every scene with nothing linking them.
- The web-page look: centred headline, gradient, cards, fade-up on everything.
- Slides with a voice: static text panels where something could move, grow, draw or transform.
- Text too small, too close to the edge, or over a busy picture without contrast.
- Pictures arriving after the voice has moved on.
- A video that just stops, with no final hold.
- A voice with nothing under it, or an effect on every movement.
- Saying it is finished without having looked at the frames, or without saying that you could not listen to the finished sound.

## 8. When the user reacts

Change the smallest thing that answers the comment, re-render that stretch, and look. Keep notes on what they liked in `storyboard.md`. Record a preference as a preference for this video; don't turn one annoyed comment into a rule for everything after it.
