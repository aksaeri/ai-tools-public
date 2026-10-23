---
name: zotero-librarian
description: Resolve a paper, book, or citation (DOI, arXiv/ISBN/PMID, a URL, or freeform title) to authoritative metadata and add it to a Zotero cloud library. Use when the user wants to "add X to Zotero", "save this paper", "cite this", or capture a reference from a link or description.
allowed-tools:
- Bash(${CLAUDE_SKILL_DIR}/scripts/zl *)
---

# zotero-librarian

Add references to Zotero from messy input. A deterministic CLI handles clean
identifiers; you (Claude) handle the messy cases by dispatching a Sonnet
subagent to do web research, then push the result through the same CLI.

`ZL` below = `${CLAUDE_SKILL_DIR}/scripts/zl` — a small launcher
that runs the CLI in the skill's own uv environment and picks a uv runner that
exists on the host: bare `uv` on Linux (no `python` command; uv isn't a
module there), and `python -m uv` on Windows (bare `uv` isn't on PATH in
non-interactive shells, but uv is a pip module). One tracked SKILL.md therefore
works on both machines, with no OS-specific path or runner to maintain.

## First run / setup

If `~/.claude/zotero-config.json` is missing, tell the user to create an API key
with **write access** at https://www.zotero.org/settings/keys/new and find their
userID at https://www.zotero.org/settings/keys, then run:

```
ZL setup --api-key <KEY> --library-id <USERID> --library-type user [--default-collection <KEY>]
```

The launcher auto-creates the skill's environment on the first `ZL` call, so no
explicit setup is normally needed. To pre-build it, run once:

```
uv sync --project ${CLAUDE_SKILL_DIR}        # Linux
python -m uv sync --project ${CLAUDE_SKILL_DIR}   # Windows
```

## Routing algorithm

For each input the user gives:

1. **Try the deterministic path.** Run `ZL lookup "<input>" --dry-run`.
   - Exit `0`: a clean identifier was found and resolved. Show the user the
     resolved title/authors/year/type. On confirmation (or if the user already
     said "just add it"), re-run without `--dry-run`, adding `--collection <K>`
     if they named one.
   - Exit `3`: no clean identifier. Go to step 2 (agentic path).
   - Exit `4`: identifier found but lookup failed (network/not-found). Retry
     once; if it still fails, fall through to the agentic path.

2. **Agentic path — dispatch a Sonnet subagent.** Use the Agent tool
   (`subagent_type: general-purpose`, `model: sonnet`) with this task:

   > Identify the bibliographic work described by: "<input>". Read the primary
   > source directly (fetch the page/PDF) and/or search authoritative sources
   > (publisher page, Crossref, arXiv, Semantic Scholar, PubMed, OpenLibrary,
   > the publishing organisation's own site). If a DOI or arXiv id exists,
   > strongly prefer to return it. Return ONLY a JSON object, no prose:
   > `{"itemType":"...","title":"...","creators":[{"creatorType":"author","firstName":"...","lastName":"..."}],"date":"YYYY-MM-DD","DOI":"...","url":"...","publicationTitle":"...","volume":"","issue":"","pages":"","abstractNote":"...","_source":"agent"}`
   > Choose the itemType that matches the actual artifact — any valid Zotero
   > type, e.g.: journalArticle, conferencePaper, preprint, **report** (policy
   > papers, corporate frameworks, white papers, institutional PDFs),
   > **webpage** (a web page / press release / landing page), **blogPost**
   > (company or personal blog), book, bookSection, document, magazineArticle,
   > newspaperArticle, thesis. Use type-appropriate fields: report →
   > `institution`,`place`; webpage → `websiteTitle`; blogPost → `blogTitle`.
   > For a corporate/institutional author with no named humans, use a
   > single-field creator `{"creatorType":"author","name":"<Org>"}` (NOT
   > firstName/lastName), or omit creators and rely on `institution`. Never
   > invent an author (e.g. a generic "Staff" byline → omit creators). Use the
   > EXACT published title. Omit any field you cannot verify from the source.
   >
   > **Abstract — ground it or omit it.** Base `abstractNote` on the source's
   > OWN text. Read the raw document yourself: for a PDF, download it and extract
   > the text (pdftotext / pypdf) — do NOT rely on a WebFetch auto-summary, which
   > is a lossy second-hand digest. Summarise from an identified section, and
   > draw ONLY from the same artifact this record is for (for a report record,
   > read the report PDF — never the press release that announces it). If you
   > cannot actually read the source text (PDF blocked/garbled, page unreachable),
   > set NO abstract — never fabricate one from a digest, a linked page, or prior
   > knowledge; a missing abstract is fine, a hallucinated one is not. When you
   > compose the abstract yourself (the source had no labelled abstract of its
   > own), prefix it with `[Sonnet 4.6 summary] ` so it is not mistaken for the
   > author's abstract. If you lift the source's genuine abstract verbatim, do
   > not prefix it.

   - If the subagent returns a DOI or arXiv id, prefer re-running
     `ZL lookup "<doi-or-arxiv>"` so the authoritative API fills the record.
   - Otherwise, validate the subagent's JSON with
     `ZL add --json '<payload>' --dry-run`, show the user, then `add` for real.

   **Landing page vs underlying document:** if the input is a press release or
   landing page that announces/links a primary document (a PDF report, dataset,
   etc.), ask the user which they want — the page itself (`webpage`), the
   underlying work (`report`/etc., with the direct PDF url), or BOTH as two
   separate records. Both is a common and legitimate request: a webpage record
   and the report it links are distinct artifacts, NOT duplicates. Source each
   record from its own artifact — the webpage record from the page, the report
   record from the PDF — and never let the page's promotional wording leak into
   the report's metadata.

3. **Always confirm before the first real push** unless the user explicitly
   said to add without confirmation. Report the created item key + a note that
   it's now in their library.

## Picking a collection

If the user names a collection, run `ZL collections` to get its key, match by
name, and pass `--collection <KEY>`. If the name is ambiguous, ask which one.

## Targeting a group / shared library

By default the CLI uses the library in `~/.claude/zotero-config.json`. To add to
a different library for a single command — e.g. a shared **group** library —
pass `--group <id>` (or `--library group:<id>`) on `add`, `lookup`, or
`collections`. It is not persisted; the configured default library is unchanged.
Get a group's numeric id from its Zotero URL, and use `ZL collections --group
<id>` to list that library's collection keys for `--collection`. (`--library`
also accepts `user`, `user:<id>`, and a bare numeric id, which means a group.)

When the user names a shared library ("add X to the Lab Reading Group library"),
resolve the name to its group id — list the user's groups via the Zotero API
(`GET https://api.zotero.org/users/<userID>/groups`, with their key) and match by
name — then pass `--group <id>`. If the name matches more than one group, ask
which.

## Examples

- `add https://arxiv.org/abs/2511.11595 to zotero` → `ZL lookup` (arXiv path).
- `save 10.1145/3790096` → `ZL lookup` (DOI path).
- `add the paper "Model evaluation for extreme risks"` → no identifier →
  Sonnet subagent → returns arXiv id → `ZL lookup` to finalize.

## Notes

- Config and API key live in `~/.claude/zotero-config.json`, never in the repo.
- `--dry-run` prints the exact item without writing — use it to preview.
- **The abstract is the user's call.** If they say to leave it out, omit it. If
  they ask for a summary/abstract, compose a grounded one from the document
  (prefixed `[Sonnet 4.6 summary]`), never fabricated. With no instruction: use the
  source's own abstract when there is one, else compose a grounded one, else omit.
- **Editing an existing record** (wrong authors, missing DOI, empty abstract) is
  NOT a CLI command — the CLI only adds. Do it via the Zotero API: fetch the item,
  then PATCH the changed fields with the `If-Unmodified-Since-Version` header (its
  current version) so a concurrent edit isn't clobbered. Works on user and group
  libraries; only fill/repair fields, don't overwrite a collaborator's choices.
- **Always pass `--query "<the user's exact request>"`** on `add`/`lookup`. It is
  recorded in Zotero's `extra` field as provenance:
  `Automatic record from user query "<query>"`. Reproduce the user's wording
  verbatim.
- **`--attach-pdf`** downloads and attaches the document's PDF (from the item
  `url`, or `--pdf-url <url>` when the record's url isn't the PDF itself — e.g. a
  webpage record whose report PDF lives elsewhere). Best-effort: paywalled or
  blocked PDFs are skipped with a message, the record is still created. Use it
  for reports and other PDF-backed documents.
- `accessDate` is set to today automatically for agentic (web-sourced) records.
- Dedupe is on by default but is **exact-match only** (same DOI, or same exact
  title). It catches re-adding the same artifact, not a true duplicate whose
  title differs slightly — flag those to the user yourself. Note the opposite
  case too: a press webpage and the PDF report it links are NOT duplicates, they
  are distinct artifacts, and keeping both is legitimate (don't suppress one).
- Roadmap (not yet implemented): smarter/fuzzy + URL-based dedupe, multi-library
  "add to <library>" selection with disambiguation, batch/multi-input mode.
