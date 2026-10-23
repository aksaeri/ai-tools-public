# Local and other-language

For: food, travel, places, customs, and any topic whose best material is in
another language or written by locals for locals.

## Before scouting

Name the languages (Indonesian for gado gado, Japanese for a Kyoto neighbourhood)
and the local words people would actually search for: the dish's regional
name, the neighbourhood's nickname, local terms for "recipe", "review",
"hidden", "where locals eat". Put them in the map so every scout uses them.

## Angles to choose from

- **Local-language web.** Search in the language. Recipe sites, local food blogs, regional news, local review sites. WebFetch and read in the original.
- **Local-language video.** `youtube_search.py "<local query>"`, then `youtube_transcript.py ID --lang <code>`: home cooks, street-food vendors, local guides. Keep the original-language captions; translate the useful part yourself.
- **Local forums and social.** The country's main forums and subreddits (eg r/indonesia, Kaskus) and diaspora communities. Search them with `site:`; subreddits through `tikhub.py reddit-search --subreddit`.
- **English for comparison.** One English angle, to show what the tourist version says; useful mainly for contrast.
- **Travel:** search for places by what locals do there, not by "attractions". Recent posts beat guidebook pages; look for dates.

## Reporting

`language` is the source's language. `quote` is the useful sentence in the
original; `english` is your translation. `why` says what this source knows that
the English sources don't.
