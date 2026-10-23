# Buying or choosing something

For: products, services, tools and APIs. The web here is full of affiliate
round-ups, AI-written "best X of 2026" pages and vendors posting as users. The
job is to get past them to people who used the thing and showed their evidence.

## Angles to choose from

- **Hands-on video reviews.** `youtube_search.py`; prefer reviewers who show measurements, play recorded samples or compare side by side. Use the transcript to find the timestamp of the comparison.
- **Forums and comment threads.** Named subreddits and specialist forums (find them first: search "<thing> forum" and "<thing> subreddit"). The value is in long-time users' comments and in disagreements. For Reddit, `tikhub.py reddit-search` scoped to the subreddits you found, then `reddit-thread` on the best threads; without a TikHub key they come back as `unopened` (see the Reddit row in SKILL.md).
- **Measurement and testing sites.** Independent labs and testers that publish their method.
- **Docs and pricing pages** (for services and APIs). What it actually costs at the user's scale, rate limits, languages and regions supported, the free tier. Read the vendor's own page, and quote the number.
- **Complaints.** "<thing> problem", "<thing> stopped working", "<thing> alternative": what goes wrong after six months.

## Skip

Pages titled "best <thing> 2026", "top 10 <thing>", round-ups with affiliate
links, and anything that never says it used the product.

## Sellers

Mark `"seller": true` when the recommender sells the thing: a username matching
the product or company, "disclaimer: I work there", "we built / we invented",
an account whose only replies recommend one vendor, a price comparison that
only flatters one product. Keep the lead, because the founder's own claim can be
useful, but in `why` say what independent leads say about the same product.
