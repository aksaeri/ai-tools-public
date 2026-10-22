---
name: skill-release
description: Check a skill before sharing it publicly, then export a cleaned copy one way into a public repo. Use when asked to share, publish, release or refresh a skill or tool.
allowed-tools:
- Bash(uv run --quiet ${CLAUDE_SKILL_DIR}/scripts/release.py *)
metadata:
  platforms:
  - claude-code
  complexity: medium
  prereqs:
  - uv
  - git
  - a public git repo to export into
  provenance:
    author: aksaeri
    written: 2026-10
    last_tested: 2026-10
    endorsement: Built to share my own skills without developing them in public. 18 unit tests; used for the first exports to my public tools repo.
---

# skill-release

Share a skill without developing it in public. You keep working on the skill where it lives
now. When you want to share it, this skill copies the committed version, cleans it, checks it,
and commits it into a local clone of your public repo. A person approves every push.

`REL` below means `uv run --quiet ${CLAUDE_SKILL_DIR}/scripts/release.py`.

## Settings stay outside this skill

Everything private lives in `~/.config/skill-release/` (or `$SKILL_RELEASE_CONFIG`), never in
this skill and never in a repo:

- `tools.yaml`: the public repo's local path, and for each tool where its source lives, what
  to leave out, text to rewrite in the public copy, and patterns that are fine to publish.
- `scrub.txt`: your own patterns, one regex per line: hostnames, network names, colleagues,
  employers, private domains, folder names.

If either file is missing, help the user write them. Start from `references/setup.md`, and ask
for the names of their machines, workplace and the people who appear in their work. Never
copy the scrub list anywhere, and never quote its contents in anything that will be published.

## Sharing or refreshing a tool

1. **Check.** `REL check <tool>`. It writes nothing. It reports:
   - every file that would be exported (git sources export HEAD only; it says so if there are
     uncommitted changes);
   - findings: scrub-list matches, emails, private IP addresses, key-shaped strings, home-folder
     paths and private network names. `BLOCK` stops the export.
   - fit for each surface: Claude Code (works or blocked) and claude.ai (works, caveat or no),
     with reasons.
2. **Resolve each BLOCK**, in this order of preference:
   - a rewrite in `tools.yaml` that replaces the private text in the public copy only;
   - an entry under `exclude` if the file shouldn't be public at all;
   - an `allow` pattern, only for a genuine false positive (such as "MIT License"), confirmed
     with the user;
   - a change in the source itself. If the user doesn't own the skill, ask its owner.
   Don't weaken the scrub list to get a tool through.
3. **Look at binary files yourself.** The scan can't read images or video. Open each one and
   check for names, faces, inboxes, calendars, file lists and browser tabs.
4. **Export.** `REL export <tool>` repeats the check, writes `tools/<tool>/` in the public repo
   and commits locally. It never pushes. What it writes:
   - `skills/<skill>/`: the cleaned skill. Install paths such as `~/.claude/skills/<skill>/`
     become `${CLAUDE_SKILL_DIR}/`, and frontmatter keys Claude Code doesn't know move under
     `metadata:`.
   - `.claude-plugin/plugin.json`: lets Claude Code install it from the repo. There is no
     version field, so every public commit counts as an update.
   - `snapshot.json`: the source revision, the date and the fit verdicts.
   - `tool.yaml`: written only if missing. Fill in its `how_i_use_it` in the user's words.
5. **Get approval, then push.** Show the user what will go public: `git -C <public repo> log
   --stat origin/main..HEAD` (or every commit, before the first push) and the diff. Push only
   after they say yes to this push. Approval for an earlier push doesn't carry over.

## Other commands

- `REL status`: each tool is `current`, `behind` (the source changed since the last export) or
  `not exported`.
- `REL scan`: scans every tracked file in the public repo. Exit code 1 means a blocking finding.
- `REL install-hook`: makes `git push` in the public repo run `scan` first. Install it once
  per clone. It is a backstop, not a substitute for step 5.

## Rules

- One way only. Nobody edits a tool's `skills/` folder in the public repo; fixes go to the
  source and come back with the next export. Hand-written files (`tool.yaml`, demo material,
  the site) are the exception.
- A pull request or branch on a public repo is public the moment it's pushed. Review happens
  before the push, on the user's machine.
- If something private is ever pushed: rotate any key at once, then rewrite history. Forks and
  caches may already hold it, so say so plainly.
