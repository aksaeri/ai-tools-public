# zotero-librarian: a brief for rebuilding it

This describes a Claude Code skill that turns a messy reference into a clean Zotero record: a DOI, an arXiv or PubMed ID, an ISBN, a URL, or just a title someone half remembers. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is a small Python package with a command-line interface, run through `uv` (a Python environment manager), plus a SKILL.md that tells Claude how to route each request.

## What it does

You say "add this to Zotero" and give it whatever you have. Claude first tries a fixed, repeatable lookup. If that can't find a clean identifier, Claude hands the job to a second Claude instance (Claude Code calls this a subagent), which researches the source on the web and returns structured metadata. Both routes end in the same check, duplicate test and upload to your Zotero cloud library. The Zotero desktop app picks the record up on its next sync.

```
input ──▶ clean identifier? ──yes──▶ look it up (Crossref, arXiv, OpenLibrary, PubMed)
                │                                   │
                no                                  │
                ▼                                   │
     research subagent ──▶ metadata JSON            │
                └──────────────┬────────────────────┘
                               ▼
              check fields ▶ skip duplicates ▶ create the Zotero item
```

## Components

1. **A command-line tool**, with these commands:
   - `setup`: writes the API key and library ID to `~/.claude/zotero-config.json`, never into the repo.
   - `resolve <input>`: finds the identifier and prints normalised metadata. Exit codes: `0` resolved, `3` no clean identifier (use the research route), `4` identifier found but the lookup failed (retry once, then use the research route).
   - `lookup <input>`: resolve and add, with `--dry-run` to preview.
   - `add --json '<payload>'`: check and upload metadata from the research route.
   - `collections`: list collection keys.
   - `--group <id>` or `--library <spec>`: target a shared group library for one command, without changing the default.
2. **A launcher script** that runs the tool inside its own `uv` environment and works out which `uv` command exists on the machine. That lets one SKILL.md work on Linux and Windows.
3. **SKILL.md**: the routing steps, the subagent's instructions, and the rules below.

## Identifier detection

Regular expressions, tried in this order: arXiv (`arxiv.org/abs/…`, `arXiv:…`, or a bare `NNNN.NNNNN`), DOI (`10.NNNN/…` anywhere, including inside a URL), PubMed ID, ISBN. A URL with none of these goes to the research route.

## The research route

Claude gives the research to a smaller, cheaper Claude model (the original uses Sonnet) with web search and page fetching. It asks for a single JSON object that uses Zotero's field names. The instructions that matter:

- Read the primary source itself. For a PDF, download it and extract the text rather than trusting a fetched summary.
- Prefer returning a DOI or arXiv ID when one exists. Claude then re-runs the fixed lookup so the authoritative API fills the record.
- Choose the item type that matches the actual thing: report, web page, blog post, preprint, book section and so on, each with its own fields.
- Use an organisation as a single-name author when no person is named. Never invent an author.
- Ground the abstract in the source's own text, or leave it out. A summary Claude writes is labelled as such.
- If the input is a press release that links a report, ask whether the user wants the page, the report, or both. Both is a legitimate answer, and they are separate records.

## Rules worth keeping

1. A fixed lookup first, research second. The fixed route is fast, repeatable and exact. The research route only covers what it can't.
2. One shared validation and upload path for both routes.
3. Confirm with the user before the first real upload, unless they've said "just add it".
4. Record where each item came from. The user's exact request goes into the item's Extra field, Zotero's free-text notes field.
5. Duplicate checking is exact-match only (same DOI or same title). Flag near-duplicates to the user rather than guessing.
6. Keys stay in a config file outside the repo.
7. Editing an existing record goes through the Zotero API with the item's current version (`If-Unmodified-Since-Version`), so a collaborator's change isn't overwritten.

## What you need

- A Zotero account and an API key with write access (zotero.org/settings/keys).
- Python, and `uv` or another environment manager.
- Your own contact email in the tool's User-Agent string, because Crossref asks API users to identify themselves.

## Rebuilding it

- Start with `resolve` for DOIs and arXiv IDs. Those two cover most academic references.
- Add `add` with the field check next, and the research subagent last, because it depends on the check being strict.
- The Python library `pyzotero` handles Zotero's item templates and uploads.
