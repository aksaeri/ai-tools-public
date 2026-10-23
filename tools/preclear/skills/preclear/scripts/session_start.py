#!/usr/bin/env python3
"""SessionStart (clear) hook for preclear's default location.

Prints this project's open_threads.md into the new session's context, stopping at a
"# Parked" heading and reporting how many threads sit below it. Prints nothing when
there is no file, so sessions without saved threads start clean.
"""
import json
import os
import re
import sys
from pathlib import Path


def project_dir(cwd: str) -> Path:
    # Same naming as ~/.claude/projects/: the working folder with "/" turned into "-".
    return Path.home() / ".claude" / "preclear" / re.sub(r"[/\\:]", "-", cwd)


def main() -> int:
    try:
        cwd = json.load(sys.stdin).get("cwd") or os.getcwd()
    except (json.JSONDecodeError, ValueError):
        cwd = os.getcwd()
    f = project_dir(cwd) / "open_threads.md"
    if not f.exists():
        return 0
    text = f.read_text(encoding="utf-8")
    live, _, parked = text.partition("\n# Parked")
    if not live.strip():
        return 0
    print(f"Open threads saved before the last /clear ({f}):\n")
    print(live.strip())
    n = len(re.findall(r"^## ", parked, flags=re.M))
    if n:
        print(f"\n({n} parked thread{'s' if n != 1 else ''} below '# Parked' in that file, not shown.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
