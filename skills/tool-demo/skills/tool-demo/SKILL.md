---
name: tool-demo
description: Package a tool or skill so other people can see what it does and rebuild it themselves - a page of use cases, a rebuild brief, and short narrated demo videos with mocked-up screens, all checked for private details. Use when asked to demo, showcase, document or package a tool or skill for friends, colleagues or a public page, or to make "a video for each use case".
allowed-tools:
- Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/scaffold.py *)
metadata:
  platforms:
  - claude-code
  complexity: medium
  prereqs:
  - python3
  - 'the generate-video skill (for videos): Node 22+, ffmpeg, Google Chrome, GEMINI_API_KEY'
  provenance:
    author: aksaeri
    written: 2026-11
---

# tool-demo

Turns a tool you've built into a package someone else can learn from: what it's for, how you use it, how they could build their own, and a short video for each use case. It isn't a release: nothing here installs or tests the tool on other machines.

**If `local.md` exists next to this file, read it first.** It says where packages go on this machine, which site they're published to, and who owns which tools.

## What a package holds

```
demo/
  <tool>-brief.md        a brief for rebuilding it (references/brief-template.md)
  page.md                the use cases, how you use it, and the videos (or the site's own page file)
  video/<id>.mp4 + .jpg  one short video per use case, with a poster frame
  VIDEO-BRIEF-COMMON.md  the shared rules every video follows
```

`python3 ${CLAUDE_SKILL_DIR}/scripts/scaffold.py <tool> --out <folder> [--uses N] [--dry-run]` creates this skeleton, with one numbered slot per use case. `--dry-run` lists what it would write.

## Steps

1. **Read the tool, not your memory of it.** Its SKILL.md or README, its scripts, and its changelog. Note what it needs: software, keys, accounts, costs, and what it hasn't been tested on.
2. **Get the owner's own words.** "How I use it" is in the owner's voice, so never invent it. Ask the owner (or the session that owns the tool) for two or three sentences based only on what they've actually done with it, and show the result to them before it goes public.
3. **List the use cases.** One line each, concrete: "turns a folder of receipts into a spreadsheet", not "helps with finance". Four to ten is plenty. Each use case gets a paragraph and a video.
4. **Check facts that aren't yours.** When the page compares the tool with someone else's product, check those claims against that product's current official docs, and write "I found nothing in the docs about X" rather than "it can't do X".
5. **Write the brief** from `references/brief-template.md`: the problem, what it does, components, decisions worth keeping, what you need. It describes behaviour and decisions, so a reader can rebuild it on their own setup.
6. **Make the videos** (below).
7. **Check for private details** (below) across the page, the brief and every video frame.
8. **Publish** where `local.md` says, and get the owner's yes before anything goes public.

## Videos: one per use case

Use the **generate-video** skill's compose route: an animated HTML page with narration, rendered to mp4. Never film real screens, and never use a video model for these. Mocked-up screens are what keep private data out.

1. Copy `references/video-brief-common.md` into the package as `VIDEO-BRIEF-COMMON.md`, and fill in the page's title, its audience and the look.
2. For each use case, write a short brief with **the exact narration lines** (3 to 5 lines, about 25 seconds) and **the scenes**: what's on screen for each line, using invented data. Write the narration yourself. It's where the facts are, so don't leave it to the video agent.
3. Give each video to its own subagent with the shared brief path and its own brief, all working in separate folders. Run about four at a time, because each render keeps a headless Chrome busy.
4. When each one comes back, look at its poster and contact sheet yourself, for privacy and for whether it shows the point. Note anything the agent couldn't check, such as a word the speech check misheard.
5. Make the first video, get a reaction, then make the rest in the same look. A reaction to one video is cheap; eleven videos in the wrong direction are not.

Cost: about 9 cents a video (8 for music, under 1 for narration). Give each agent a cap, and total the usage log by tag at the end.

## Checking for private details

Run this before anything leaves the machine, every time.

- Names of people, employers, clients and organisations; email addresses, account names and handles.
- Hostnames, IP addresses, private-network names and internal URLs. Describe the need generally instead, such as "a small home server".
- Home-folder paths, keys and tokens.
- Internal project details beyond a one-line generic description. A project the owner has already published may be named.
- Every video poster and contact sheet: no real calendars, inboxes, file lists or browser tabs.

Search the files with a pattern list of your own names, hosts and domains (`local.md` says where this machine's list is), then read the page once more as a stranger would.

## Writing the page

- Lead with the answer: what the tool is for, in two sentences.
- One heading per use case, each with a concrete example, then its video as a poster image linked to the mp4. Many markdown renderers drop raw `<video>` tags, and a linked poster works everywhere.
- Define each term where it first appears, in plain words. Keep the reading level around school year 8.
- When the page compares tools, say where each one fits, with the evidence, and don't sell.
