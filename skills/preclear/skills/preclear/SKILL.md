---
name: preclear
description: Use when the user is about to /clear this session and wants nothing dropped — triggers include /preclear, "about to clear", "wrap up before I clear", "new task, clear context", or any stated intent to clear while replies, follow-ups, or unfinished work may still be in flight.
---

# Preclear — capture live threads before /clear

/clear wipes this conversation's context. This ritual saves every live thread to disk first, so the post-clear session can pick them up. A SessionStart hook reads the file back after the clear (see "Reading it back" below).

**If `local.md` exists next to this file, read it first.** It says where this user's threads file lives and how to find it, and it overrides the default location in step 2.

## Steps

1. **Sweep the whole conversation for live threads.** A thread is live if any of these hold:
   - Waiting on an external reply (email sent, message posted, request pending)
   - A follow-up or check is due later (chase dates, "if nothing happens by X")
   - Work promised but not finished, or explicitly parked ("later", "not now")
   - Background machinery still running: subagents, workflows, artifact watches, ScheduleWakeup loops, monitors
   - A decision the user deferred and will need to make

   Not live: completed tasks, threads already tracked elsewhere IF that tracker will actually fire (a task-tracker item with a due date counts as tracked — still list it, one line, marked "tracked in <tracker>").

2. **Update the threads file, `open_threads.md`.** Where it lives:
   - If `local.md` says, follow it.
   - Otherwise use `~/.claude/preclear/<project>/open_threads.md`, where `<project>` is the session's working folder with each `/` replaced by `-` (the same naming Claude Code uses under `~/.claude/projects/`). Create the folder if needed.

   (Weak norm: files Claude writes use `_` or `-` between words, never spaces.) Merge, don't overwrite: keep existing unresolved entries, delete entries that resolved during this conversation. Each entry:

   ```markdown
   ## <short thread name>
   - **State:** <where things stand, one or two sentences>
   - **Next action:** <what to do, and any date to act by>
   - **Wake condition:** <what event or date reactivates this — "reply from X", "2026-09-08 tracker task fires", "manual">
   ```

   **Park what has gone quiet.** The whole file is injected into every post-clear
   session, so it is a standing context cost and it only ever grows. A thread whose
   wake condition is "manual" and which has not moved in about three weeks goes under
   a `# Parked` heading at the end of the file, unchanged. The SessionStart hook stops
   at that heading and reports only a count, so parked threads stay findable without
   being re-read every time. Move one back up the moment it becomes live again, and
   delete it outright when it resolves.

3. **Append a dated entry to `work_log.md`** (same folder) summarising what this conversation did, per that file's conventions.

4. **Offer a timed reminder only if a thread would otherwise die silently** — i.e. its wake condition is "manual" and it matters. Default is no extra reminder: the file plus the post-clear hook is the mechanism.

5. **Tell the user it's safe to /clear**, listing the thread names captured (or "no live threads — nothing to carry over").

## Reading it back

The file only helps if the next session sees it. A SessionStart hook with the `clear` matcher prints it into the new session's context. `scripts/session_start.py` is a minimal one for the default location: it prints everything above `# Parked` and a count of parked threads. To install it, add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {"matcher": "clear", "hooks": [{"type": "command", "command": "python3 /path/to/preclear/scripts/session_start.py"}]}
    ]
  }
}
```

If `local.md` describes a different hook, that one is already installed; don't add a second.

## Red flags

- "The context summary will preserve it" — /clear keeps nothing; write to the file.
- "I'll remember" — post-clear you won't; only the file survives.
- Skipping the sweep because the conversation "was just one task" — mid-turn asides ("can you also…", "later we should…") are where threads hide; sweep everything.
