#!/usr/bin/env python3
"""Google and Google Scholar results through SerpApi. Optional: needs a key.

Usage:
  serpapi.py google  "QUERY" [-n 10] [--hl id] [--gl id]
  serpapi.py scholar "QUERY" [-n 10] [--hl en]

--hl is the interface language and --gl the country, which is how you get the
results a local searcher would see (eg --hl id --gl id for Indonesia).
Prints a JSON array of {title, url, snippet, source, date, cited_by}.

Reads SERPAPI_API_KEY from the environment or ~/.claude/.env. Without one it
exits 3 and says so; treat that as "this source is unavailable" and carry on
with WebSearch. Other errors exit 1 with the reason on stderr.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENGINES = {"google": "google", "scholar": "google_scholar"}


def env_value(name: str) -> str:
    if name in os.environ:
        return os.environ[name]
    try:
        for line in (Path.home() / ".claude" / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"\'')
    except OSError:
        pass
    return ""


def compact(r: dict) -> dict:
    row = {"title": r.get("title"), "url": r.get("link"), "snippet": r.get("snippet")}
    pub = (r.get("publication_info") or {}).get("summary")
    row["source"] = pub or r.get("source")
    if r.get("date"):
        row["date"] = r["date"]
    cited = ((r.get("inline_links") or {}).get("cited_by") or {}).get("total")
    if cited is not None:
        row["cited_by"] = cited
    return row


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("engine", choices=list(ENGINES))
    ap.add_argument("query")
    ap.add_argument("-n", type=int, default=10)
    ap.add_argument("--hl")
    ap.add_argument("--gl")
    a = ap.parse_args(argv)

    key = env_value("SERPAPI_API_KEY")
    if not key:
        print("SerpApi unavailable: no SERPAPI_API_KEY in the environment or ~/.claude/.env", file=sys.stderr)
        return 3
    params = {"engine": ENGINES[a.engine], "q": a.query, "num": a.n, "hl": a.hl, "gl": a.gl, "api_key": key}
    base = os.environ.get("SERPAPI_BASE", "https://serpapi.com/search.json")
    url = f"{base}?{urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        print(f"SerpApi returned HTTP {e.code}: {e.read()[:300].decode(errors='replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"could not reach SerpApi: {e.reason}", file=sys.stderr)
        return 1
    if data.get("error"):
        print(f"SerpApi error: {data['error']}", file=sys.stderr)
        return 1
    print(json.dumps([compact(r) for r in data.get("organic_results", [])[:a.n]], ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
