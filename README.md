# AI tools

Claude skills and tools I use every week, cleaned up so you can install them or build your own.

**Browse them with demos:** https://aksaeri.github.io/ai-tools-public/

| Tool | What it does |
|---|---|
| [gdocs-suggest](tools/gdocs-suggest/) | Claude comments on, copyedits and fills gaps in a Google Doc, with every word it adds in red or marked [Claude]. |
| [zotero-librarian](tools/zotero-librarian/) | Turns a DOI, arXiv ID, URL or half-remembered title into a clean, correctly typed record in your Zotero library. |
| [skill-release](tools/skill-release/) | Checks a skill before you share it, then exports a cleaned copy one way into a public repo. |

## Install a skill in Claude Code

```bash
claude plugin marketplace add aksaeri/ai-tools-public
claude plugin install gdocs-suggest@aksaeri-tools
```

Update with `claude plugin update <tool>@aksaeri-tools`. On Windows without an SSH key for GitHub, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` first.

## Build your own

Each tool has a brief in `tools/<tool>/demo/<tool>-brief.md` that describes how it works and the decisions behind it. Hand it to your own Claude and ask for a version that fits your setup.

## How this repo is made

I develop these tools privately. Each one is copied here one way by [skill-release](tools/skill-release/), which removes private details and checks the result, and I read every change before it is pushed. So please don't send pull requests against `tools/*/skills/`; they would be overwritten by the next export. Open an issue instead.

- `tools/<tool>/skills/`: the skill, exported. Don't edit by hand.
- `tools/<tool>/tool.yaml` and `demo/`: the page text, demo material and brief, written by hand.
- `site/`: builds the site and `.claude-plugin/marketplace.json` from the manifests (`uv run site/build.py`).

MIT licence.
