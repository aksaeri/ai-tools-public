# Common rules for every demo video

You are making one short narrated demo video for a page titled "{PAGE_TITLE}". Its readers: {AUDIENCE}. The narration is in the tool owner's first person.

## How
- Use the generate-video skill's **compose** route only: an animated HTML page rendered to mp4. Never use film.js (no video-model clips).
- Read ~/.claude/skills/generate-video/SKILL.md, its local.md and references/composing.md first, and follow them: storyboard, template, narrate.js, `render.js --check`, contact sheets, then the final render.
- Match the look of the series: {LOOK}. If other videos in this package are finished, copy fonts, palette and layout from their `comp.html` and `stage.css` (read them; don't edit them).
- Spec: 1920x1080, under 30 seconds, the skill's default narration voice, a quiet music bed from music.js (8 cents), at most two effects, and on-screen captions of the narration.
- Tag every paid call `--tag {TAG}/<your video id>`. Spending cap: US$1 for your video.

## Privacy (strict: this page is public)
- No real names of people or organisations, and no hostnames, IP addresses, URLs, emails, account names or session ids.
- No real screenshots: draw everything on screen in HTML, with invented generic data.
- Product names you may show: {ALLOWED_NAMES}.
- Don't copy any company's logo or exact interface. A generic, friendly look is enough.

## Accuracy
Show only what the narration and scene list describe. Don't add claims about features.

## Deliver
- The final video at `<your folder>/out/<id>.mp4`.
- A poster at `<your folder>/out/<id>.jpg`: a clear mid-video frame, 1280x720 (render with `--frame`, then scale it with ffmpeg).
- A report back in under 120 words: the duration, the total cost for your tag from the usage log, the `--check` result, what you looked at on the contact sheet, and anything you couldn't do.
