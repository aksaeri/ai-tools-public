#!/usr/bin/env python3
"""Search YouTube through yt-dlp. No API key needed.

Usage:
  youtube_search.py "QUERY" [-n 10]

Prints a JSON array to stdout: [{id, url, title, channel, minutes, views}, ...].
Errors go to stderr with a non-zero exit. Set YTDLP to use a specific yt-dlp binary;
otherwise ~/.local/bin/yt-dlp is preferred (the apt one is too old for YouTube).
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def ytdlp() -> str:
    if os.environ.get("YTDLP"):
        return os.environ["YTDLP"]
    local = Path.home() / ".local" / "bin" / "yt-dlp"
    return str(local) if local.exists() else "yt-dlp"


def compact(d: dict) -> dict:
    dur = d.get("duration")
    return {
        "id": d["id"],
        "url": f"https://www.youtube.com/watch?v={d['id']}",
        "title": d.get("title"),
        "channel": d.get("channel") or d.get("uploader"),
        "minutes": round(dur / 60, 1) if dur else None,
        "views": d.get("view_count"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query")
    ap.add_argument("-n", type=int, default=10, help="number of results (default 10)")
    a = ap.parse_args(argv)
    try:
        r = subprocess.run([ytdlp(), f"ytsearch{a.n}:{a.query}", "--flat-playlist", "-j"],
                           capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"yt-dlp failed to run: {e}", file=sys.stderr)
        return 1
    if r.returncode != 0:
        print(f"yt-dlp search failed:\n{r.stderr.strip()}", file=sys.stderr)
        return 1
    rows = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append(compact(json.loads(line)))
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
