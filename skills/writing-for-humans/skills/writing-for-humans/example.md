# Worked example (synthetic)

A made-up instance of the "plain section first" shape for a long document. The source was a dense, Claude-facing design for checking a small team's backups. Every name and number is invented. Match the shape, not the content: what this is, one concrete scenario, the calls with defaults, the decided items in one line each, and the detail below a rule.

## For Priya (plain language)

### What this is

The team's laptops back up every night to a shared drive, but nobody checks that the backups worked. This adds a short check each Monday morning that tells you which laptops haven't backed up in the last week. It's worth doing now because two laptops went three weeks without a backup in September, and nobody noticed until one of them failed.

### How it works

Take Sam's laptop on a Monday at 8am. The check looks at the newest file in Sam's backup folder. It's from Thursday night, four days ago, so Sam's laptop goes on the list. Every other laptop backed up on Sunday night, so they don't.

You get one email:

```
Backups older than 3 days (1 of 9 laptops)
  sam-laptop    last backup Thu 9 Oct, 23:10
```

If every laptop is fine, the email says so in one line, so you know the check itself ran.

### Your calls

1. **Should the email go to you only, or to the whole team?** It's your call because you know who would act on it. I recommend you only, so it doesn't become noise. If you say nothing, it goes to you only.
2. **Is 3 days the right threshold?** People away on leave will show up every week. I recommend 3 days plus a short "away" list you can edit. If you say nothing, it's 3 days with no away list.

### Decided (no response needed)

- It runs on the shared drive's own server, so no laptop has to be on.
- It reads file dates only and never opens a backup.
- It costs nothing to run: no new service or account.

---

*Detail below this line is for whoever builds it, not required reading.*
