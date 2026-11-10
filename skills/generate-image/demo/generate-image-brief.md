# generate-image: a brief for rebuilding it

This describes a Claude Code skill that makes pictures with Google's Gemini image models. It covers the behaviour and the decisions behind it, so you can rebuild it for your own setup. The original is one SKILL.md and a Node script with no dependencies beyond Node 18.

## The problem

Claude can draw diagrams and charts itself, in SVG or HTML, and does that better than an image model: the text is exact and the layout can be edited. What it can't make is a picture: a scene, an illustration, a character, a photo-style image. Asking an image model for one by hand means a separate app, copying prompts back and forth, and no record of what it cost.

## What it does

Claude writes a prompt, runs the script, and looks at the result before showing it to you. The script sends the prompt to a Gemini image model, saves the picture, prints one line of JSON with the path and the cost, and adds a line to a usage log.

## Components

1. **SKILL.md**: when to use it and when not, the models and their costs, how to write a prompt, and how to keep a series consistent.
2. **scripts/generate.js**: one call to the Gemini API. Flags for model, aspect ratio, size, a style directive, reference images and a tag.
3. **scripts/usage-report.js**: totals spend by day, tag and model from the usage log.
4. **scripts/cleanup.js**: lists generated images older than 60 days, and deletes them only when asked.

## Decisions worth keeping

1. **A routing table at the top.** Diagrams, charts and flowcharts go to SVG or HTML, and video goes to a separate skill. Without the table, Claude sends everything to the image model.
2. **The cheapest model by default.** A 1K draft costs about 3 cents. Claude moves up to the better models for a final version, a larger size, a hard composition or legible text in the image, and says which model it used so you can redo it at another level.
3. **No built-in style.** The prompt goes to the model as written. For a series that must match, Claude writes one style directive and passes it unchanged to every call.
4. **Reference images.** Pass a picture to edit it, to keep a character the same across a series, or to combine several images.
5. **Fail before paying.** A size or aspect ratio the chosen model can't make fails at once, with a message naming the model to use.
6. **Look before showing.** Claude reads the saved image before handing it over.
7. **Log every call**, failures included, with the cost worked out from the API's token counts and Google's list prices.

## What you need

- Node 18 or later.
- A Gemini API key, `GEMINI_API_KEY`.
- About 3 cents an image on the default model.
- Tested on Linux only, not on Windows or macOS.
