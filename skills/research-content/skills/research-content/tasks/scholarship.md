# Scholarship

For: mapping a research area, finding canonical papers and talks, methods that
could be borrowed from a neighbouring field, and "does this project already exist?".

## Angles to choose from

- **Canonical papers.** `openalex.py search "<the question in plain words>" --sort cited`, then `refs` on the two or three most central papers to find what they build on, and `cites` to find who builds on them. A paper that turns up in several reference lists is canonical whatever its citation count.
- **Recent work.** `openalex.py search "…" --from-year <3 years ago> --sort recent`. Preprints count; say so in `why`.
- **Borrowable methods.** Rephrase the question for a neighbouring field (health policy for education policy, environmental regulation for AI regulation) and search there. The lead is the method, so `why` names it.
- **Talks and seminars.** `youtube_search.py` for conference talks, seminar series, parliamentary committee hearings; transcripts to find the minute that matters.
- **Grey literature and policy.** Government and parliamentary reports, think tanks, inquiries, submissions. For Australia: apo.org.au (Analysis & Policy Observatory), aph.gov.au (committees, Parliamentary Library), pc.gov.au (Productivity Commission), law reform commissions, state audit offices.
- **People and groups.** Who keeps appearing as author, what centre or lab they're in, whether they have a project page or a reading list. A reading list from a working researcher is often the best single lead.

## "Does this already exist?"

Give one scout this as its whole angle. It looks for a project, paper, dataset or
tool doing substantially the same thing, and reports the closest matches with how
each differs. "Nothing close found" is a valid answer if it says what it searched.

## Reporting

`kind` is paper, talk, report or page. Put year and venue in `title` or `what`.
Include `oa_url` in `why` when there's free full text.
