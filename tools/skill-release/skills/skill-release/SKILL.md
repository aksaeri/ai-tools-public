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

## Before exporting: what the first exports taught

- **Find out who maintains the skill first.** If it isn't the user's own (another person, or another Claude session that looks after it), don't edit its source. Write down what needs to change and why, point at the `check` output, and let its owner make the change or approve yours. Draft proposed files in a separate review folder, never in the live skill.
- **Nothing may change for the owner.** The skill keeps working on its home machine exactly as before. Test that, for example by running a changed script on the owner's machine and comparing the results.
- **Skill tied to one setup?** Split it: a general core in SKILL.md, and everything about this user's machine, accounts, people and folders in a `local.md` beside it. SKILL.md says "If `local.md` exists, read it first; it wins." Add `local.md` to the tool's `exclude`. The owner's sessions read local.md and behave as before; the public copy is the general core. Personal material such as writing samples stays in a gitignored folder and goes in no repo at all.
- **Curated lists** (accounts someone follows, favourite sources): give the public copy an example file with `replace`, and leave the owner's copy alone.
- **A description too long for Claude chat** (over 200 characters): set a short public `description` in tools.yaml rather than changing the one that triggers the skill for its owner.
- **Uncommitted work at a git source isn't exported.** Ask before committing it, and commit only the skill's own files, not unrelated changes other people or sessions left in that repo.
- **If a safety hook or permission check blocks a step, stop and tell the user** what you were doing and why it was blocked. Don't reword the command or switch tools to get past it. If the pre-push scan blocks a push, fix the finding; never skip the hook.
- **Some things no scan catches:** names of people and projects not on the list, private numbers like group IDs, and anything in images or video. Read the changes yourself as well.

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
