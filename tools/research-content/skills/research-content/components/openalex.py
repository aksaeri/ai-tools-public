#!/usr/bin/env python3
"""Search scholarly works on OpenAlex and walk citations. Free; no key needed.

Usage:
  openalex.py search "QUERY" [-n 10] [--from-year 2018] [--sort relevance|cited|recent] [--keyword]
  openalex.py cites WORK_ID [-n 10]     works that cite this one, most-cited first
  openalex.py refs WORK_ID              works this one cites, most-cited first

search is semantic (by meaning) unless --keyword is given, which matches the words
themselves; use --keyword for names, case names and exact phrases. --sort reorders
the relevant results; it never asks OpenAlex to sort, because a server-side
citation sort pulls in famous papers on other topics.

WORK_ID is an OpenAlex id (W123…) or its URL. Prints a JSON array of
{id, title, year, cited_by, authors, venue, doi, oa_url, abstract, url}.
oa_url is a free full-text link when one exists.

Without a key OpenAlex allows a small daily budget (about 100 searches); set
OPENALEX_API_KEY in the environment or ~/.claude/.env for more. Errors go to
stderr with a non-zero exit.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FIELDS = ("id,display_name,publication_year,cited_by_count,doi,authorships,"
          "primary_location,open_access,abstract_inverted_index")
SORTS = ("relevance", "cited", "recent")


def env_value(name: str) -> str:
    if name in os.environ:
        return os.environ[name]
    f = Path.home() / ".claude" / ".env"
    try:
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"\'')
    except OSError:
        pass
    return ""


def short_id(s: str) -> str:
    return s.rstrip("/").rsplit("/", 1)[-1]


def abstract(inv: dict | None, limit: int = 800) -> str | None:
    if not inv:
        return None
    words = sorted((pos, w) for w, ps in inv.items() for pos in ps)
    text = " ".join(w for _, w in words)
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def compact(w: dict) -> dict:
    names = [a.get("author", {}).get("display_name", "") for a in w.get("authorships") or []]
    authors = ", ".join(names[:3]) + (" et al." if len(names) > 3 else "")
    src = ((w.get("primary_location") or {}).get("source") or {})
    return {
        "id": short_id(w["id"]),
        "title": w.get("display_name"),
        "year": w.get("publication_year"),
        "cited_by": w.get("cited_by_count"),
        "authors": authors,
        "venue": src.get("display_name"),
        "doi": w.get("doi"),
        "oa_url": (w.get("open_access") or {}).get("oa_url"),
        "abstract": abstract(w.get("abstract_inverted_index")),
        "url": w["id"] if str(w["id"]).startswith("http") else f"https://openalex.org/{w['id']}",
    }


class ApiError(Exception):
    pass


def get(path: str, params: dict) -> dict:
    base = os.environ.get("OPENALEX_BASE", "https://api.openalex.org")
    key = env_value("OPENALEX_API_KEY")
    if key:
        params = {**params, "api_key": key}
    url = f"{base}{path}?{urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            left = r.headers.get("X-RateLimit-Remaining")
            if left and left.isdigit() and int(left) < 100:
                print(f"openalex: {left} credits left today", file=sys.stderr)
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise ApiError(f"OpenAlex returned HTTP {e.code} for {path}: {e.read()[:300].decode(errors='replace')}")
    except urllib.error.URLError as e:
        raise ApiError(f"could not reach OpenAlex: {e.reason}")


def sort_rows(rows: list[dict], how: str) -> list[dict]:
    if how == "cited":
        return sorted(rows, key=lambda w: -(w["cited_by"] or -1))
    if how == "recent":
        return sorted(rows, key=lambda w: -(w["year"] or 0))
    return rows


def search(q: str, n: int, from_year: int | None, sort: str, keyword: bool = False) -> list[dict]:
    per_page = n if sort == "relevance" else min(50, max(25, n * 3))
    if keyword:
        params = {"search": q, "filter": f"from_publication_date:{from_year}-01-01" if from_year else None}
    else:
        # semantic search accepts publication_year but not from_publication_date
        params = {"search.semantic": q, "filter": f"publication_year:{from_year}-2100" if from_year else None}
    rows = [compact(w) for w in get("/works", {**params, "per_page": per_page, "select": FIELDS})["results"]]
    return sort_rows(rows, sort)[:n]


def cites(work: str, n: int) -> list[dict]:
    params = {"filter": f"cites:{short_id(work)}", "per_page": n, "select": FIELDS, "sort": "cited_by_count:desc"}
    return [compact(w) for w in get("/works", params)["results"]]


def refs(work: str) -> list[dict]:
    ids = [short_id(r) for r in get(f"/works/{short_id(work)}", {"select": "id,referenced_works"}).get("referenced_works") or []]
    out = []
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        res = get("/works", {"filter": "openalex_id:" + "|".join(chunk), "per_page": 50, "select": FIELDS})
        out += [compact(w) for w in res["results"]]
    return sorted(out, key=lambda w: -(w["cited_by"] or 0))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("-n", type=int, default=10)
    s.add_argument("--from-year", type=int)
    s.add_argument("--sort", choices=SORTS, default="relevance")
    s.add_argument("--keyword", action="store_true", help="match words exactly instead of by meaning")
    c = sub.add_parser("cites")
    c.add_argument("work")
    c.add_argument("-n", type=int, default=10)
    r = sub.add_parser("refs")
    r.add_argument("work")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "search":
            rows = search(a.query, a.n, a.from_year, a.sort, a.keyword)
        elif a.cmd == "cites":
            rows = cites(a.work, a.n)
        else:
            rows = refs(a.work)
    except ApiError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
