# find-session: a brief for rebuilding it

This describes a Claude Code skill that finds a past session from a half-remembered description, such as "the session where we built the usage dashboard", and tells you how to resume it. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is a SKILL.md and a Python script of about 150 lines that searches Claude Code's saved transcripts.

## What it does

You describe the earlier work in your own words. A subagent searches your past sessions and returns one short, checked answer:

```
MATCH: <one-line title of the session>
project_path: <the project folder on disk>
session_id:   <uuid>
transcript:   <path to the .jsonl file>
resume:       cd <folder> && claude --resume <uuid>
last_active:  <date of the last real message>
evidence:     <a quoted turn, a file name or a feature that confirms it>
confidence:   high | medium | low
```

If nothing convincingly matches, it says so and lists the two or three closest candidates, with why each is doubtful.

## Where the sessions are

Claude Code saves every session as a `.jsonl` file under `~/.claude/projects/<folder>/`, where `<folder>` is the working directory with `/` turned into `-`. A second account or config folder (`~/.claude-*`, or `$CLAUDE_CONFIG_DIR`) has its own `projects/` folder, and the search covers those too.

## How the search works

1. **A curated index first, if you keep one.** A list of sessions with names and summaries is the cheapest place to look. With no index, start at step 2.
2. **The transcripts.** The script:
   - reads only what the user and Claude actually said, and strips system reminders and tool calls. Memory files and project instructions get injected into nearly every transcript, so a raw text search finds the same boilerplate everywhere;
   - scores each session by how many of the search terms appear, not by raw hit count;
   - ranks by the time of the last real message, not the file's modified time, which changes whenever a session is resumed;
   - skips the session that's doing the searching (pass its id), because that conversation is all about the search terms.
3. **Verify.** Before answering, open the project folder and confirm the thing the user remembered is really there. Summaries drift.

`claude --resume` only finds a session when it's started from the folder the transcript belongs to, so the answer always includes the `cd`.

## Rules worth keeping

1. Run it as a subagent, so the noisy searching stays out of the main conversation.
2. Use a strong model for it. The hard part is judging whether a plausible hit is really the one, and saying "no convincing match" when it isn't.
3. Trust a term concentrated in one session with a clear quote over a few scattered mentions.
4. If the description is thin, ask once for an anchor: a rough date, a project, a file name. One good keyword collapses the search.

## Rebuilding it

- Start with the transcript search. It needs nothing but Python and the files Claude Code already writes.
- Add an index later, if you keep many long-lived sessions and want names and summaries for them.
