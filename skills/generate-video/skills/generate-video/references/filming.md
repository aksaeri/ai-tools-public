# Filming a clip with a video model

How to get a usable clip from `film.js` in few tries. Script paths here are written relative to the skill's folder: `scripts/film.js` is the `film.js` whose full path `SKILL.md` gives. Each try costs real money (about 35 cents for 5 seconds at 720p), so think before generating and look after.

## Writing the prompt

Describe the shot the way you would brief a camera operator, in this order:

1. **Shot and camera:** "Continuous single handheld shot", "slow push-in", "static wide shot", "low angle tracking shot".
2. **Subject and action:** who or what, doing what, in what order. One clear action for a 5-second clip.
3. **Setting and light:** place, time of day, weather, the quality of light.
4. **Sound:** what should be heard, and what should not.

```
Continuous single handheld shot, no scene cuts: a red fox trots across a frozen lake
at sunset, breath misting in the cold air, pine forest on the far shore.
Sound: paws crunching on snow, light wind. No dialogue, no music.
```

Things the default model (Gemini Omni) does unless told otherwise:

- **It cuts between several shots.** For one shot, say "single continuous shot" and "no scene cuts".
- **It adds sound of its own choosing**, sometimes music or speech. Say what you want: "Sound: ...", "No dialogue", "No music", or "Include calm background music".
- **It has no negative-prompt setting.** Put what to avoid in plain words in the prompt: "No text on screen", "No people in the background".

Timing inside a clip works in plain language or timecodes:

```
[0-3s] A woman walks down a quiet street at night.
[3-6s] She stops and turns toward a glowing doorway.
[6-8s] She steps through it.
```

Dialogue: write the line in quotes and say who speaks it. Keep it short; a 5-second clip holds about ten words.

## Starting from a picture

When the look matters (a particular character, product, place or style), make a still first with the generate-image skill, check it, then animate it:

```bash
node scripts/film.js "The fox lifts its head, looks at the camera, then trots out of frame to the left. Single continuous shot." --image fox.jpg
```

A still costs about 3 cents and a clip about 35, so settle the composition on stills. With `--image`, describe only what changes: the motion, the camera, the sound. Add `--last-frame end.jpg` to control where the shot ends (clips up to 10 seconds).

`--ref` (up to 6 pictures) is different: the clip does not start from them, but should match the character, object or style they show. Use it to keep the same character across several clips.

## Trying cheaply

- `--dry-run` prints the request and the estimated cost and calls nothing.
- `--resolution 360p` costs a third as much and is enough to see whether the action and framing work. Each generation is different, so a draft tests the prompt, not the exact result.
- Ask for the length you need. Cost is per second; a 5-second clip that works beats a 15-second one that wanders.

## Looking at the result

You can't watch it, so pull frames and read them:

```bash
node scripts/render.js clip.mp4 --sheet every=1 --out sheet.jpg
node scripts/render.js clip.mp4 --strip 2.0:2.5 --out strip.jpg   # every frame of a moment
```

Check: is it the subject and action asked for, does anything deform (hands, faces, legs mid-stride), are there unwanted cuts or text, and does it hold together from first frame to last. If the sound matters, transcribe it or describe to the user that you could not listen. Say plainly what you could and could not verify.

## Choosing a model

| `--model` | Good at | Weak at |
|---|---|---|
| `omni` (default) | Following a detailed prompt, sound, any length from 3 to 15 s, starting from pictures, price | New (November 2026); rated top in one public comparison and mid-table for realistic people in another. Only 16:9 and 9:16. |
| `wan` | Top-rated for text-to-video in the Artificial Analysis comparison; clips up to 30 s; 1:1, 4:3, 3:4 shapes | Costs more; a starting image may need a public web address |
| `seedance` | Top-rated for realistic people and for image-to-video | Two to three times the price; 720p at most |

Other OpenRouter models work by full id, such as `google/veo-3.1-lite` or `kwaivgi/kling-v3.0-std`. `--dry-run` checks the length, size and shape against what the model allows and shows the price where it is per second.

## Limits

- The default model will not accept pictures of some recognisable real people, and in the UK and EU will not edit pictures containing children.
- Every clip carries an invisible watermark (SynthID).
- Requests through the Gemini key are stored by Google for 55 days. Requests through OpenRouter cannot use its no-retention setting. Don't send private pictures the user would not want kept.
- Clips longer than 15 seconds: make several and join them in a composition, using the last frame of one as `--image` for the next when they must flow.

## Putting clips in a composed video

Save clips into the composition's folder (`--out clips/fox.mp4`) and place them with `<video src="clips/fox.mp4" muted data-start="n03">`. See `composing.md`.
