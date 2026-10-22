# zotero-librarian

A Claude Code skill that turns loose bibliographic input — a DOI, arXiv/ISBN/PMID,
a URL, or a freeform title — into a correctly-typed record in your Zotero cloud
library. Clean identifiers resolve deterministically against Crossref, arXiv,
OpenLibrary, and PubMed; messy inputs are resolved by a Sonnet subagent that
searches authoritative sources, then pushed through the same validated path.

> **Cloning this with Claude Code?** Open the repo and Claude will read
> [`.claude/CLAUDE.md`](.claude/CLAUDE.md) — a full onboarding/cookbook that walks
> through setup, installing it as a skill, verifying, and day-to-day use. It can run
> most of the setup for you.

## Install

Requires [uv](https://docs.astral.sh/uv/) (cross-platform). From the repo root:

```bash
uv sync                  # Linux/macOS
python -m uv sync        # Windows (bare `uv` is often not on PATH there)
```

This creates `.venv` and installs everything, including the `zotero-librarian`
entry point. To run the CLI, use the bundled launcher `./scripts/zl` — it works
on every host: it locates the project automatically and picks a uv runner that
exists (bare `uv` where it's on PATH, e.g. Linux; `python -m uv` otherwise, e.g.
Windows non-interactive shells). All examples below use it.

## Configure

Create a Zotero API key with **write** access
(https://www.zotero.org/settings/keys/new) and find your userID, then:

```bash
./scripts/zl setup --api-key <KEY> --library-id <USERID> --library-type user
```

Config is written to `~/.claude/zotero-config.json` (outside the repo).

## Use (standalone CLI)

```bash
./scripts/zl lookup "https://arxiv.org/abs/2511.11595"   # resolve + add
./scripts/zl resolve "10.1145/3790096"                   # print metadata only
./scripts/zl add --json '{"itemType":"book","title":"..."}' --dry-run
./scripts/zl collections                                 # list collection keys
```

To add to a **group / shared library** for one command (without changing your
default config), pass `--group <id>` — or `--library <user|user:id|group:id>` —
to `add`, `lookup`, or `collections`:

```bash
./scripts/zl collections --group 6626682                       # list a group's collections
./scripts/zl lookup "10.1145/3790096" --group 6626682          # add into that group
```

Inside Claude Code, just say "add <thing> to Zotero" and the skill orchestrates
the rest, including web research for inputs without a clean identifier.

**New here?** [`DEMO.md`](DEMO.md) is a guided first-run tour — follow it yourself,
or tell Claude "walk me through the zotero-librarian demo".

## Development

```bash
uv run pytest -q                 # unit tests (no network); on Windows: python -m uv run pytest -q
ZOTLIB_NETWORK_TESTS=1 uv run pytest tests/test_network_smoke.py -q
```

## Roadmap

- PDF retrieval & attachment (Unpaywall / arXiv OA).
- Multi-library "add to <library>" with fuzzy selection + disambiguation.

(No separate local-desktop target needed: the Zotero desktop app syncs from the
online library, so Web-API additions appear there automatically.)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and the test-first
workflow. Full architecture is in `docs/2026-06-17-zotero-librarian-design.md`.
