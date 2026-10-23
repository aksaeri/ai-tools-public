# writing-for-humans: a brief for rebuilding it

This describes a Claude Code skill that makes anything a person will read plain, triaged and in your voice. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is three Markdown files: SKILL.md, a guide to review rounds, and a worked example. A folder of your own writing samples makes it much better, and a separate scanner (the voice-check skill) catches mechanical tics.

## The idea

Clear writing is compression keyed to the reader. Cut what they already know or won't use. Keep what bears on their decision, including what you're unsure of. Then make it sound like a person wrote it, and when it goes out under your name, like you.

The failure it exists to prevent is an assistant that explains everything and can't tell what matters, so the important point is buried. Readable sentences don't fix that. Deciding what to bring to the reader does.

## Every piece

1. **Reader.** Say who reads it and what they already know, in one line when the piece is handed over, along with the level and who it's sent as: "Reader: the programme lead at the funder. Level: Deep. Sent as: me."
2. **Point first.** The first lines say what the reader most needs to know or do.
3. **Plain words, about grade 10.** Keep the technical terms the reader uses themselves. Replace words coined during the work with what the thing does. No glossaries.
4. **Two kinds of qualifier.** Cut covering material: offers to help, process history, effort spent. Keep the load-bearing material: what you're unsure of, the main point against your recommendation, anything that would change the reader's answer. Say it once, beside the claim it qualifies.
5. **Asks.** Only what the reader alone can decide. Each is a question with a recommendation and what happens if they say nothing. Three at most.
6. **No LLM voice.** No "not X, but Y", no punchy one-line paragraphs, no runs of dashes, no corporate words. Run a scanner over the file if you have one.

## Three levels

| Level | When | Extra steps |
|---|---|---|
| Quick | Short, read once by you | None |
| Standard | A page or more for you, anything for someone else, anything sent as you | Triage first, read your samples, a cold read, a list of what was left out |
| Deep | Sent as you to funders, clients or the public; published; long | Standard, then up to three review rounds |

A **cold read** hands a fresh subagent only the draft and the reader line, and asks what it thinks it's being asked, which terms it didn't know, and what sounded surer than the draft supports.

A **review round** runs three fresh subagents at once:
- a cold reader;
- a voice match, which compares the draft with your samples and points to the sentences you wouldn't have written;
- a cutter, which returns a shorter version and may not remove the load-bearing points or add anything.

Most pieces stop after one round.

## Your samples

The skill gets most of its voice from a folder of ten to twenty pieces you wrote yourself, across the readers you write for, with a one-line index entry each (reader, purpose, register). Replace every name, organisation, number, date and link with a fictional stand-in first. Keep the folder out of every repo, because pseudonymised writing can still identify people. A short profile file sums up what the samples have in common: how you open, how you ask for things, how you state uncertainty.

## Rules worth keeping

1. Triage before prose.
2. A date, amount or status the source doesn't give is left out or marked for you to fill in, never invented to finish a sentence.
3. Reviewers cut before they add. Asked for improvements, a model adds caveats and gets longer and worse.
4. A long document for you opens with a plain section you can read alone: what this is, one concrete scenario, your calls with defaults, and the decided items in one line each.

## Rebuilding it

- Start with "Every piece" and the reader line. They work on any Claude surface, with no files at all.
- Build the samples folder next. It's the part that makes the output sound like you.
- Add the review rounds last, for the writing that matters most.
