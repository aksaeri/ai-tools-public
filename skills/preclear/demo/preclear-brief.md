# preclear: a brief for rebuilding it

This describes a Claude Code skill and a hook that stop work being lost when you clear a session. It describes behaviour and decisions, so you can rebuild it for your own setup. The original is one SKILL.md and a short SessionStart hook script.

## The problem

`/clear` gives a long Claude Code session a fresh start, and it keeps nothing. Anything still in flight is gone: a reply you're waiting on, a check due on Friday, a background job, a decision you put off. Asking Claude to "remember" doesn't help, because after the clear there's nothing to remember with.

## What it does

Before you clear, you say "preclear" (or "about to clear"). Claude sweeps the whole conversation for live threads, writes them to a file, and tells you it's safe to clear. When the new session starts, a hook prints that file into it, so the new session knows what was open.

## Components

1. **SKILL.md**, with the sweep and the file format.
2. **A threads file per project**, `open_threads.md`, plus a `work_log.md` beside it. The default location is `~/.claude/preclear/<project>/`, named from the working folder the way Claude Code names its own project folders.
3. **A SessionStart hook** with the `clear` matcher. It prints the threads file into the new session's context, stops at a `# Parked` heading, and reports how many parked threads sit below it. With no file, it prints nothing.

## What counts as a live thread

- waiting on an outside reply;
- a follow-up or check due later;
- work promised but not finished, or explicitly put off;
- something still running: a subagent, a scheduled check, a watch;
- a decision the user deferred.

A task already in a tracker that will actually remind you counts as tracked: it gets one line, marked as tracked there.

## The entry format

```markdown
## <short thread name>
- **State:** where things stand, in one or two sentences
- **Next action:** what to do, and any date to act by
- **Wake condition:** what reactivates it: "reply from X", a date, or "manual"
```

The file is merged, never overwritten: unresolved entries stay, and resolved ones are deleted.

## Rules worth keeping

1. Sweep everything. Threads hide in asides ("can you also…", "later we should…"), even in a conversation that felt like one task.
2. Park what has gone quiet. The whole file is read into every new session, so it costs context and only grows. A "manual" thread untouched for about three weeks moves under `# Parked`, where the hook only counts it.
3. Offer a timed reminder only when a thread would otherwise die silently. The file and the hook are the mechanism.
4. End by telling the user it's safe to clear and naming what was saved.

## Rebuilding it

- The hook is the part people skip, and without it the file is never read back. Install it first.
- If you run several long-lived sessions, give each its own threads file, and say in a local settings file how the skill should tell them apart.
