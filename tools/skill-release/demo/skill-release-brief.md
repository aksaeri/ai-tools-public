# skill-release: a brief for rebuilding it

This describes a Claude Code skill for sharing your own skills in public without developing them in public. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is one Python script (run with `uv`, needing only PyYAML) and a SKILL.md.

## The problem

Skills you build for yourself fill up with your own details: machine names, home-folder paths, colleagues' names, your employer, your email address, private web addresses. You want to share some of them, but making your working repo public would publish all of that, and its history too. You also don't want a second copy that you have to keep editing by hand.

## The design

Publishing is a one-way copy, made on request:

```
skill source (where you keep working)
   └─▶ check: what would go out, what looks private, where it will run
         └─▶ export: cleaned copy committed to a local clone of the public repo
               └─▶ a person reads the diff and says yes ─▶ git push
```

- **Settings live outside the tool.** A folder in your home directory holds `tools.yaml` (which tools, where each comes from, what to leave out, text to swap in the public copy) and `scrub.txt` (your own patterns, one regular expression per line). Neither file is ever copied anywhere, because a list of what you're hiding is itself private.
- **Git sources export the committed version only,** never work in progress. The check says when there are uncommitted changes.
- **Every export is a fresh copy.** The public folder is replaced, so files deleted at the source disappear from the public copy too.

## What the check looks for

Blocking:

- matches from your scrub list, including in file names;
- email addresses, apart from no-reply and example.com addresses;
- private IP addresses, including the range Tailscale uses;
- strings shaped like common API keys and private keys;
- home-folder paths with a real user name;
- `*.ts.net` network names;
- files over 50 MB.

It also skips caches, virtual environments, `node_modules`, `.env` files, logs and backups automatically. The scan can't read images or video, so it lists them for a person to look at.

## Where it will run

The check also reports how the skill fits each Claude surface:

- **Claude Code, as a plugin:** blocked if the name isn't lowercase letters, digits and hyphens matching the folder, or if any file still refers to the skill's installed path (`~/.claude/skills/<name>`). A plugin installs somewhere else.
- **claude.ai upload:** "no" if the instructions need a program its sandbox can't run (`uv`, `ffmpeg`, a signed-in CLI and so on). Otherwise there are caveats for a description over 200 characters, scripts (code execution must be on), calls to outside services, and API keys.

## What the export changes

- `~/.claude/skills/<name>/` becomes `${CLAUDE_SKILL_DIR}/`, which Claude Code substitutes in SKILL.md and in `allowed-tools`.
- Frontmatter keys Claude Code doesn't recognise move under `metadata:`, because claude.ai rejects unknown keys.
- It writes `.claude-plugin/plugin.json` with no version field, so each public commit counts as an update for people who installed it.
- It records the source revision, the date and the fit verdicts in `snapshot.json`. A `status` command then shows which public copies are behind.

## The review step

- Branches and pull requests on a public repo are public as soon as they're pushed, so review happens before the push, on your own machine.
- A pre-push hook reruns the scan over every tracked file as a backstop. It can't replace a person reading the diff, because no pattern list knows every name.

## Rebuilding it

- The scan is the core: your patterns plus the built-in checks above, run over the transformed output rather than the source.
- Keep the settings file format small. Rewrites are literal text swaps, and "allow" patterns excuse false positives such as "MIT License".
- Test it on a fake skill that contains a planted hostname, an email address and an installed path. Confirm the export refuses it and writes nothing.
