# research-content: a brief for rebuilding it

This describes a Claude Code skill that finds what an ordinary web search buries, and lets you steer where it looks next. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is a SKILL.md, three short task guides, and five small Python helpers for sources that web search handles badly.

## What it does

You ask a question, such as "which web search API gives good results in many languages, at research volume?". Claude doesn't write an essay. It sends several search agents out at once, each looking in a different place, and brings back a numbered list of specific leads: a video with the timestamp where the useful part starts, a forum comment and who wrote it, a paper and the work that cites it, a post in Japanese with a translation. You reply with "more like 2 and 5" or "try German forums", and it sends a new round.

```
map  →  scouts (in parallel, independent)  →  gather  →  you steer  →  more scouts …
```

## The loop

1. **Map.** Claude writes down the request in one line, what a great lead would look like, three to five angles (each a different place or way to look, with what to skip), and the languages to search in. For a vague request it shows you the map first.
2. **Scouts.** One subagent per angle, all started in the same message, on a cheaper model (the original uses Sonnet). Each gets only its own angle. None sees the others' results, so one bad early find can't pull every scout the same way.
3. **Gather.** Claude merges duplicates (two scouts finding the same thing independently is a signal, and it says so), drops leads that don't serve the request, and groups and numbers the rest. It also lists what nobody found, and the promising things a scout couldn't open (paywalls, logins).
4. **Steer.** Claude shows the list and stops. Each reply sends a new round of scouts where you pointed, and the numbering carries on from the last lead.

## What each scout must do

- Open every lead before returning it. A search snippet isn't a lead.
- On forums, find the useful comment and name the commenter.
- On videos, give the timestamp of the useful part.
- Flag anyone selling what they recommend ("disclaimer: I work there", a username that matches the product). Keep the lead, but mark it.
- Return at most eight leads, best first, as JSON in a fixed format: link, kind, language, one line on what it is, one on why it matters, where the useful bit is, a short quote with a translation if it isn't in English.

## Sources web search handles badly

| Source | How the original gets at it |
|---|---|
| YouTube | `yt-dlp` search, then the captions, so a scout can find the timestamp. Videos without captions can be transcribed. |
| Papers | OpenAlex, which also gives the papers that cite a given one. |
| Reddit and Twitter | TikHub, a paid API. Twitter searches cover a circle of accounts you pick in `x_accounts.json`, not all of Twitter. |
| Search results in other countries | SerpAPI, optional, for Google results in another country and language. |
| Blogs you trust | `blogs.json`, a short list of blogs to search by site. |

The task guides cover three common shapes of request: scholarship, buying or choosing something, and local knowledge that lives in another language.

## Rules worth keeping

1. Leads, not a report. No scores. Order within a group is the ranking.
2. Scouts are independent, and the main session keeps the judgement.
3. Every lead says exactly where the useful part is.
4. Sellers are labelled, never hidden, and never left at the top of a group unchallenged.
5. Say what nobody found. A gap is information.
6. Stop after each round and wait for the user to steer.

## What you need

- Claude Code (or Cowork) with web search, web fetch and subagents.
- Python 3, and `yt-dlp` for YouTube.
- Optional keys: SerpAPI, TikHub (paid) for Reddit and Twitter, and a speech-to-text service for videos without captions.

## Rebuilding it

- Start with the map, the scouts and the lead format, using only web search and fetch. That's most of the value.
- Add one source helper at a time, in the order your topics need them. YouTube captions are usually the first.
- Keep the account list and the blog list as plain files you edit, separate from the instructions.
