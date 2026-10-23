---
name: find-session
description: Locate a past Claude Code session or project from a fuzzy, half-remembered description — "the session where we built the OpenRouter usage dashboard". Use it whenever the target is earlier work rather than a file in the current repo, including requests to resume or point at one. Returns a distilled hit (project path, session id, resume command, evidence) and runs as a subagent, so the transcript searching stays out of the caller's context.
---

# find-session

**If `local.md` exists next to this file, read it first.** It lists this machine's curated session indexes, any extra transcript folders, and anything else specific to this setup. Where it and this file differ, `local.md` wins.

- **Per-machine scope:** transcripts live on each machine, so this skill finds sessions on the machine it runs on.
- **Windows:** run the scripts with `python` rather than `python3`.

Find a past Claude Code session/project from a vague description, and return a
small, verified answer — not a pile of grep output.

## Why run this as a subagent

The searching is verbose (grepping every transcript, scoring, reading files).
If the caller runs it inline, that noise fills their context — which is exactly
the problem this skill exists to avoid. So: **the caller should dispatch this as
a subagent** whose entire job is to return the distilled result below. If you
are that subagent, do all the searching internally and reply with only the
result block.

**Set the model explicitly — do not inherit the caller's.** Dispatch this with
`model: "opus"`. The caller is often a lightweight or orchestration
session, and inheriting its model is what produces the failure this skill is
most prone to: a confident MATCH built on a plausible-looking index row that
nobody verified. The work is judgment-heavy — deciding whether a half-remembered
description really means *this* session, telling a real hit from injected
boilerplate, and being willing to answer "no convincing match" — so it wants a
strong model even though the mechanics are just grep and scoring. Never Haiku.
Sonnet is an acceptable fallback for a narrow lookup where the user already
named a distinctive keyword; anything vaguer, use Opus.

## Output format (return ONLY this)

```
MATCH: <one-line title of the session/project>
project_path: <absolute path to the project dir on disk, or "n/a">
session_id:   <uuid>
transcript:   <~/.claude[-acct]/projects/<slug>/<uuid>.jsonl>
resume:       cd <dir the jsonl lives under> && claude --resume <uuid>
last_active:  <YYYY-MM-DD of the last real message>
evidence:     <1–2 sentences: the concrete signals that confirm it — a quoted
              user turn, a filename, a matched feature>
confidence:   high | medium | low
```
If nothing convincingly matches, say so and list the 2–3 closest candidates with
why each is doubtful — don't force a false positive.

## Method

Work cheapest-first; stop as soon as you have a verified match.

### 1. Curated index first, if you keep one
Some setups keep a curated list of sessions or projects, with a name and a
summary for each. If `local.md` names one, fuzzy-match the user's description
against it first, using any search script it gives. If a candidate looks right,
jump to step 3 to verify. With no index, start at step 2.

### 2. Transcript deep-search (when there's no index, or it's thin)
Index summaries are lossy — the distinctive detail the user remembers (a
filename, a feature, a phrase) often only lives in the raw conversation. Grep the
transcripts:
`python3 scripts/search_transcripts.py <term> [<term> …] [--exclude <caller-sid>]`

Pass `--exclude <the calling session's own id>` — otherwise the conversation
that dispatched this search (which is *about* the search terms) will rank at the
top and drown the real hit. When weighing results, trust **hit concentration +
the evidence snippet** over raw co-occurrence: the real match usually has a term
heavily concentrated with a dead-on snippet (e.g. `coverage_heatmap=128`,
"we now use coverage_heatmap.py"), whereas a passing mention or an injected
desk-list dump scatters a few hits across a snippet that's obviously boilerplate.

What the script does, and why (do the same if searching by hand):
- Reads `~/.claude/projects/*/*.jsonl`, plus the same under every other Claude
  Code config folder in your home directory (`~/.claude-*/`, for example a second
  account) and `$CLAUDE_CONFIG_DIR` if set. Add others with `--roots`.
- Extracts **only user/assistant visible text**, stripping `<system-reminder>`
  blocks and tool-call/tool-result payloads. This matters: memory files,
  CLAUDE.md and other context get injected into virtually every transcript, so
  raw `grep -c` counts are massively polluted — a session can show hundreds of
  hits for a project name that are all injected boilerplate, not real work.
  Filter to real dialogue or you'll chase ghosts.
- Scores by **distinct-signal co-occurrence** (how many of the query terms show
  up in real text), not raw hit count.
- Ranks by the **last real message timestamp**, NOT file mtime. mtime is
  polluted — a session gets touched today just by being resumed or appended to,
  so mtime tells you what's live, not what's relevant.

### 3. Verify before you conclude
Index titles and even ccc-names are sometimes wrong (a session that started as
one thing and drifted). Before answering:
- Read the actual project files on disk (README, the specific file/feature the
  user named) to confirm the match is real.
- Confirm the `project_path` exists and contains what you claim.

### 4. Resume detail
Resuming is **project-scoped by cwd**: `claude --resume <uuid>` only finds the
session if launched from the directory the jsonl lives under (the `<slug>` in
`~/.claude/projects/<slug>/` is the path-mangled cwd). Always give the `cd …`
in the resume command so it actually works.

## Asking for anchors
If the description is genuinely thin and the first index pass is ambiguous, it's
worth one quick question to the user for an anchor: a rough date, the project
area, or a distinctive keyword (a filename, a feature, a person). One good
keyword collapses the search — don't grind through every transcript blind when a
five-word hint would pin it.

## Gotchas recap
- Search every Claude Code config folder, not just `~/.claude`.
- Strip `<system-reminder>` + tool payloads before counting keywords.
- Rank by last *message* timestamp, not file mtime.
- Verify against real files; index titles drift.
- `--resume` needs the right cwd.
