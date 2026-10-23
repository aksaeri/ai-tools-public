---
name: research-content
description: 'Scouts the web for leads the user steers: several independent search agents, each on a different angle, bring back specific sources (videos with the useful timestamp, forum and Reddit comments, papers and who cites them, posts from a chosen circle of Twitter accounts, local-language pages), and the user picks which to follow. Use when the user asks to "research [topic]", "find the best content/sources on", "dig up reviews of", "what''s the scholarship on", "find me non-English sources", or wants leads to steer. Not for "explain X" or a general overview; Claude''s built-in research does those.'
metadata:
  platforms:
  - claude-code
  - cowork
  platforms_notes: Needs WebSearch, WebFetch and subagents. The YouTube, OpenAlex and TikHub helpers need Python 3 and network access; the transcript fallback needs the transcribe skill.
  complexity: medium
  prereqs:
  - WebSearch / WebFetch tool access
  - Python 3
  - yt-dlp (for YouTube)
  - transcribe skill + GROQ_API_KEY (optional, for videos without captions)
  - SERPAPI_API_KEY (optional)
  - TIKHUB_API_KEY (optional, paid, for Reddit and Twitter)
  provenance:
    author: aksaeri
    written: 2026-04
    last_revised: 2026-10
    last_tested: 2026-10
    endorsement: Rebuilt 2026-10 around independent scouts and steering. Not yet re-endorsed after the rebuild.
---

# research-content

Find what an ordinary search buries, and let the user steer. The output is a
numbered list of leads, not a scored report or an essay.

```
map  →  scouts (parallel, independent)  →  gather  →  steer  →  more scouts …
```

## Run folder

```bash
RUN="$HOME/.local/share/research-content/runs/$(date +%Y%m%d-%H%M)-<slug>"   # slug: 3-4 words, kebab-case
mkdir -p "$RUN"
C="${CLAUDE_SKILL_DIR}/components"
PY=$(command -v python || command -v python3)   # Windows has python; some Linux systems only python3
```

## 1. Map (you, the main session)

Decide the kind of task and read its file, if one fits:

| Task | File |
|---|---|
| Scholarship, a research area, "does this exist already?" | `tasks/scholarship.md` |
| Buying or choosing something; comparing tools or services | `tasks/buying.md` |
| Local knowledge, travel, food, anything better covered in another language | `tasks/local.md` |

Then write `$RUN/map.md`:

- the request in one line, and what a great lead looks like for it
- three to five **angles**, each a different place or way to look, with where to search and what to skip. When the request is about what people in a field are saying and `x_accounts.json` has a group for it, one angle is that group on Twitter
- languages to search in (default: English plus any language the topic lives in)

If the request is vague enough that a wrong map would waste the run, show the user the
map and wait. Otherwise carry on.

## 2. Scouts

One subagent per angle, **all in a single message**, `subagent_type: general-purpose`,
`model: sonnet` (searching and reading is Sonnet work; judgement stays with you).
Each scout's prompt gets the request, *its own angle only*, the where/skip notes,
the languages, the relevant component commands from **Sources**, and the lead
format below. Never pass one scout's findings to another: independence is the
point, so one bad early result can't pull every scout the same way.

Tell each scout:

1. Search widely within its angle, then open the promising results (WebFetch, transcripts, abstracts). Never return a lead it hasn't opened.
2. For forums, the value is usually in the comments; name the commenter.
3. For videos, find where the useful part is and give the timestamp.
4. Flag anyone selling the thing they recommend: a username matching a product, "disclaimer: I work there", "we built", a reply that only names one vendor. Keep the lead, mark it `"seller": true`.
5. Return at most 8 leads as a JSON array, best first, plus one line on what it tried that found nothing.
6. Found something promising it couldn't open (Reddit, a paywall, a login)? List it under `unopened` with the URL and the search snippet, not as a lead.

Lead format:

```json
{"url": "...", "title": "...", "kind": "video|thread|comment|post|paper|talk|report|page|repo",
 "language": "en", "what": "one line: what it is",
 "why": "one line: why it matters for this request",
 "where": "the useful bit: timestamp, section, commenter",
 "quote": "short excerpt in the original language (optional)",
 "english": "translation of the quote, when not English",
 "date": "YYYY or YYYY-MM-DD if known", "seller": false}
```

## 3. Gather (you)

Save every scout's raw output to `$RUN/scout-<angle>.json`. Then:

- Merge duplicates, keeping every angle that found it (two independent scouts finding the same thing is a signal; say so).
- Drop leads that don't serve the request. Keep seller leads but label them; never let a seller lead sit top of its group unchallenged.
- Group by angle, number leads 1…N across the whole list, best first within each group.
- Write `$RUN/leads.json` (the leads plus `n`, `angle`, `found_by`) and `$RUN/leads.md`.
- Add a short **Nobody found** list: parts of the request no scout covered.
- Add **Couldn't open**: the scouts' `unopened` items worth their time, one line each, so the user can open or save the best ones.

No scores. If a ranking is needed, the order within a group is it.

`leads.md` shape, one line per lead:

```markdown
## Video reviews
1. **Title** (channel, 2025) — what it is. Why it matters. ▶ 4:12 [link]
2. …
```

## 4. Steer

Reply with the leads list (up to ~25 lines inline; for more, share `leads.md` with
`share-md` and give the top few inline), the Nobody-found list and Couldn't open. Then stop and
wait.

When the user replies ("more like 2 and 5", "drop the sellers", "try German forums"),
send a new round of scouts aimed where they pointed: same author or channel, what
cites a paper (`openalex.py cites`), the thread a comment came from, a new angle
the user named. Append their leads to the same files, numbering on from the last lead.
Keep going until the user says stop.

## Sources

| Source | How |
|---|---|
| Web | WebSearch / WebFetch. Add `site:` for a known domain; search in the local language for local topics. |
| HN, forums | `site:news.ycombinator.com` or `site:<forum domain>`; WebFetch the thread itself. |
| Reddit | Through TikHub (below): `$PY $C/tikhub.py reddit-search "query" [--subreddit NAME] [--comments] [--sort new\|top] [--time year]` finds posts, or comments with `--comments`; `reddit-thread URL` gives the post and its comments with depth and parent. Scope to named subreddits where you can; Reddit-wide search is noisy. Reddit blocks WebFetch, old.reddit, the `.json` endpoints and a real browser, so don't try those or Claude in Chrome. Without a TikHub key (exit 3), find threads with `site:reddit.com/r/<name>` and return them as `unopened`; the user can save a thread's text to a file for a scout to read. |
| Twitter | Through TikHub. Search a circle of accounts, not all of Twitter: `x_accounts.json` holds groups of handles the user picked. `$PY $C/tikhub.py x-search "query" --group NAME [--since YYYY-MM-DD]` uses Twitter's own search, which matches only the poster's words. `x-scan "query" --group NAME --since …` reads each account's recent posts and also matches the post they quote or repost: use it for "what are people saying about X", where the substance is often a screenshot with a one-word comment. `x-thread URL` gives a post in full and its replies; `x-posts HANDLE -n 50` an account's own latest posts, its self-threads and the reactions it reposted. Text in screenshots isn't read yet: say a lead's substance is in its image when it is. |
| TikHub | A paid third-party API (tikhub.io) that reads Reddit and Twitter. About US$0.001 a call; every command prints its call count on stderr and takes `--dry-run`. Keep a round to about 50 calls unless the user says otherwise; an x-scan costs one call per account per 20 posts. TikHub logs every query and caches responses for 24 hours, so keep confidential topics off it. Exit 3 means no key: skip it. |
| YouTube search | `$PY $C/youtube_search.py "query" -n 15` → id, title, channel, minutes, views. Search in the video's language. |
| YouTube transcript | `$PY $C/youtube_transcript.py VIDEO_ID [--lang en,id]` → captions in whatever language the video has; falls back to Whisper when there are none (videos up to 90 minutes). Text comes back in the original language. |
| Scholarly works | `$PY $C/openalex.py search "question in plain words" [--from-year Y] [--sort cited]`; `--keyword` for names and exact phrases; `cites W…` and `refs W…` walk citations. `oa_url` is free full text. |
| Google / Scholar | `$PY $C/serpapi.py google|scholar "query" [--hl id --gl id]`. Exit 3 means no key: skip it and use WebSearch. |
| Trusted blogs | `blogs.json`: blogs the user trusts, by cluster (`ai`, `general`). If the request touches a cluster, give one scout `site:<domain> <2-5 word topic>` across every blog in it. One hit here outweighs several elsewhere. |
| Local library | Not built yet: a local store of full-text papers and RSS archives. When it exists, its search command goes here. |

Every component prints JSON on stdout and errors on stderr, and exits non-zero on
failure. Read the error; don't retry the same call blindly.

## Present

Final message: the leads (or link plus top few), Nobody found, Couldn't open, and the run folder path.
