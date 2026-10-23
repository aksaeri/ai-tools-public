---
name: writing-for-humans
description: 'Use when drafting or reviewing anything a person will read, so it is plain, triaged and sounds like you: reports, emails, pages, briefings, summaries.'
---

# Writing for Humans

Clear writing is compression keyed to the reader. Cut what they already know or will not use. Keep what bears on their decision, including what you are unsure of. Then make it sound like a person wrote it, and when it goes out under the user's name, like them.

**If `local.md` exists next to this file, read it first.** It names the user, says where their writing samples and worked example are, and gives any house rules. Where it and this file differ, `local.md` wins.

## Every piece

1. **Reader.** Know who reads it and what they already know. Above Quick, say it in one line when you hand the piece over: `Reader: Ana, programme lead at the funder. Level: Deep. Sent as: the user.` Under the user's name means their first person, unsigned or signed the way they sign to that person. Otherwise it is from Claude. If the task doesn't say, an email or message to a colleague is the user's; a report or page is Claude's.
2. **Point first.** The first lines say what the reader most needs to know or do.
3. **Plain words, about grade 10.** Keep technical terms the reader uses themselves. Replace words coined during the work (codenames, labels, file, script and tier names) with what the thing does. No glossaries.
4. **Two kinds of qualifier.** Cut covering material: offers to help, "let me know if this is wrong", follow-up promises, process history, effort spent. Keep load-bearing material: what you are unsure of, the main consideration against your recommendation, anything that would change the reader's answer if they knew it. Say it once, in a plain clause beside the claim it qualifies. Concise means fewer words, not fewer considerations, and never more confidence than the evidence carries.
5. **Asks.** Only what the reader alone can decide. Each is a question with your recommendation and what happens if they say nothing. Three at most; usually one.
6. **No LLM voice.** No "not X, but Y" antithesis, punchy one-line paragraphs, em-dash runs, corporate words (delve, robust, leverage, pivotal), or bold-label paragraphs. If the piece is a file and the voice-check skill is installed, run its scanner, `python3 <voice-check folder>/scripts/scan.py <file> --grade-target 10`, and fix what it flags. Scanner-clean is the floor.

Structure follows the piece. A short note gets no headings and no ritual sections; numbered asks are welcome when there are two or more.

## Pick a level

Rate the piece on reader, stakes and length; the highest wins. Above Quick, put the level in the hand-over line so the user can say "go deeper" or "too much".

| Level | When | Add to "Every piece" | What the user is asked for |
|---|---|---|---|
| Quick | For the user, read once: terminal status, short summary, under ~400 words | Nothing | Nothing |
| Standard | A page or more for the user; any note to someone else; anything sent as the user | Triage, samples, cold read, left-out list | A one-line reaction if they have one |
| Deep | Sent as the user to funders, clients, government or the public; published; permanent; long | Standard, then review rounds (`reviewing.md`) | Read the left-out list; a blind pick if offered |

## Standard and Deep

**Triage before prose.** List: the one thing; the asks with defaults; the load-bearing qualifiers; the covering material you will cut; coined terms with their plain replacements; the numbers that change what the reader does, in natural units.

**Samples.** If there is a `samples/` folder, `samples/index.md` lists pseudonymised pieces the user wrote themselves, by reader and purpose. Read the two or three closest to the task in full before drafting. They show how the user writes, never what: every name, number, date and fact in them is a fictional stand-in, and none of it goes into a draft. When the piece is sent as the user, match their register. When Claude is writing to the user, borrow the register but write as Claude. `samples/profile.md` summarises what they have in common.

If there are no samples, say so in the hand-over line, and offer to build the folder: ten to twenty pieces the user wrote without AI help, across the readers they write for, with every name, organisation, number, date and link replaced by a fictional stand-in. Keep the folder out of every repo, because pseudonymised writing can still identify people.

**Cold read.** Hand a fresh subagent only the draft and the reader line. It reports what it thinks it is being asked, any term it did not know, and anything that sounded more certain than the draft supports. Fix those. The author drafts, because the author knows what the reader knows; the cold reader catches what the author can no longer see.

**Left out.** In the hand-over message, list in one line each the considerations you cut that a reasonable reader might want. Not covering material. The user can ask for any of them back, and what they ask for shows what should have stayed.

**Shapes.** A long document for the user opens with a plain section they can read alone: what this is, one concrete scenario with real names and values, the calls with defaults, and decided items one line each; detail goes below a rule. `example.md` is one instance, not a template. A piece for anyone else puts the answer and the asks first, then sections in the order the reader would ask, each one they can stop after. Length is set by the reader's job.

## Every fact from the source

A date, deadline, status, amount or role the source does not state is left out or marked for the user to fill in, never supplied to complete a sentence.

## Not for

Documents only agents read (task briefs, plans an agent executes, scratch notes, code), routine chat replies and tool narration, and raw working output the user asked to skim.
