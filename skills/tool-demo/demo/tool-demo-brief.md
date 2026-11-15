# tool-demo: a brief for rebuilding it

This describes a Claude Code skill that packages a tool you've built so other people can learn from it. It covers the behaviour and the decisions behind it, so you can rebuild it for your own setup. The original is one SKILL.md, two templates and a small Python script that lays out the folder.

## The problem

When a friend asks "what does that tool do, and how would I make my own?", the honest answer is spread across code, chat history and your memory. Screenshots and screen recordings leak names, inboxes and file lists. And a written explanation alone doesn't show the tool working.

## What it does

Claude reads the tool itself, asks you how you actually use it, lists the use cases, and writes a page and a rebuild brief. Then it has one short narrated video made for each use case, with every screen drawn in HTML using invented data, so nothing private can appear. Before anything goes out, it checks the page, the brief and every video frame for private details.

## Components

1. **SKILL.md**: the steps, the rules for videos and the privacy check.
2. **references/brief-template.md**: the shape of the rebuild brief (problem, what it does, components, decisions, what you need).
3. **references/video-brief-common.md**: the rules every video follows: route, length, look, privacy and what to deliver.
4. **scripts/scaffold.py**: creates the package folder with one slot per use case, and fills in the shared video rules. It has a dry run and never overwrites a file.

## Decisions worth keeping

1. **The owner's words, not Claude's.** "How I use it" comes from the person who uses the tool, and they see it before it's public.
2. **Draw the screens; never record them.** Mocked-up screens with invented data are what keep private details out of the videos.
3. **Claude writes the narration; a helper builds each video.** The narration carries the facts, so it isn't delegated. Each video goes to its own helper session, with the same shared rules, about four at a time.
4. **One video first.** Get a reaction to the first one, then make the rest in the same look.
5. **Check other people's products against their docs**, and write "I found nothing about X" rather than "it can't do X".

## What you need

- Python 3 for the folder script.
- A way to render narrated HTML animations to video. The original uses the generate-video skill: Node 22+, ffmpeg, Google Chrome and a Gemini API key, at about 9 cents a video.
- Tested on Linux only.
