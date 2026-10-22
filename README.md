# AI tools

Claude skills I use most weeks, cleaned up so you can install them or build your own.

**Browse them with demos:** https://tools.aksaeri.com/

| Tool | What it does |
|---|---|
| [gdocs-suggest](tools/gdocs-suggest/) | Claude comments on, copyedits and fills gaps in a Google Doc. Everything it adds is red or marked [Claude]. |
| [zotero-librarian](tools/zotero-librarian/) | Turns a DOI, arXiv ID, link or half-remembered title into a correctly typed record in your Zotero library. |
| [skill-release](tools/skill-release/) | Checks a skill you want to share for private details, like machine names or your email, then copies a cleaned version into a public repo. |

## Install a skill in Claude Code

```bash
claude plugin marketplace add aksaeri/ai-tools-public
claude plugin install gdocs-suggest@aksaeri-tools
```

Update with `claude plugin update <tool>@aksaeri-tools`. On Windows without an SSH key for GitHub, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` first.

In Cowork, open Customize, then Plugins, then Add marketplace, and enter `aksaeri/ai-tools-public`.

## Build your own

Each tool has a brief in `tools/<tool>/demo/<tool>-brief.md` that describes how it works and the decisions behind it. Hand it to your own Claude and ask for a version that fits your setup.

## How this repo is made

I develop these tools privately. Each one is copied here one way by [skill-release](tools/skill-release/), which removes private details and checks the result, and I read every change before it is pushed. So please don't send pull requests against `tools/*/skills/`; they would be overwritten by the next export. Open an issue instead.

- `tools/<tool>/skills/`: the skill, exported. Don't edit by hand.
- `tools/<tool>/tool.yaml` and `demo/`: the page text, demo material and brief, written by hand.
- `site/`: builds the site and `.claude-plugin/marketplace.json` from the manifests (`uv run site/build.py`).

MIT licence.
