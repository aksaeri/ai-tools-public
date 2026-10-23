#!/usr/bin/env python3
"""Deep-search Claude Code transcripts for a past session by keyword.

Extracts only real user/assistant dialogue (strips <system-reminder> blocks and
tool payloads), scores each session by how many of the query terms co-occur in
real text, and ranks by the LAST REAL MESSAGE timestamp (not file mtime).

Usage:
    search_transcripts.py <term> [<term> ...] [--limit N] [--roots DIR ...]
    # multi-word signal: quote it ->  search_transcripts.py "coverage heatmap" syncthing
"""
import argparse, glob, json, os, re, sys

def default_roots():
    """~/.claude, any other Claude Code config folder in the home directory (~/.claude-*,
    e.g. a second account) that has a projects/ folder, and $CLAUDE_CONFIG_DIR if set."""
    home = os.path.expanduser("~")
    roots = [os.path.join(home, ".claude")]
    roots += sorted(p for p in glob.glob(os.path.join(home, ".claude-*"))
                    if os.path.isdir(os.path.join(p, "projects")))
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env and os.path.isdir(os.path.join(env, "projects")):
        roots.append(env)
    out = []
    for r in roots:
        if os.path.realpath(r) not in [os.path.realpath(x) for x in out]:
            out.append(r)
    return out


DEFAULT_ROOTS = default_roots()
SR = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)


def load_index():
    """sid -> {display_name, cwd, ...} from session-index.json, best-effort."""
    out = {}
    p = os.path.expanduser("~/.claude/session-index.json")
    try:
        for s in json.load(open(p, encoding="utf-8")):
            if s.get("sid"):
                out[s["sid"]] = s
    except Exception:
        pass
    return out


def dialogue(path):
    """Yield (text, timestamp) for each user/assistant turn, system-reminders stripped."""
    try:
        lines = open(path, encoding="utf-8", errors="ignore").read().splitlines()
    except Exception:
        return
    for ln in lines:
        try:
            o = json.loads(ln)
        except Exception:
            continue
        m = o.get("message") or o
        if not isinstance(m, dict):
            continue
        role = m.get("role") or o.get("type")
        if role not in ("user", "assistant"):
            continue
        c = m.get("content")
        parts = []
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "text":
                    parts.append(b.get("text", ""))
        text = SR.sub("", "\n".join(parts))
        yield text, (o.get("timestamp") or m.get("timestamp") or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="+")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--roots", nargs="*", default=DEFAULT_ROOTS)
    ap.add_argument("--exclude", nargs="*", default=[],
                    help="session id(s) to skip — pass the CALLER's own session id so this "
                         "search doesn't rank the conversation that launched it.")
    args = ap.parse_args()

    terms = [t.lower() for t in args.terms]
    exclude = set(args.exclude)
    index = load_index()
    files = []
    for root in args.roots:
        files += glob.glob(os.path.join(root, "projects", "*", "*.jsonl"))

    by_sid = {}  # dedup: same session can exist under multiple account roots
    for f in files:
        sid = os.path.basename(f)[:-6]
        if sid in exclude:
            continue
        hits = {t: 0 for t in terms}
        last = ""
        snippet = ""
        for text, ts in dialogue(f):
            low = text.lower()
            for t in terms:
                n = low.count(t)
                if n:
                    hits[t] += n
                    if not snippet:
                        i = low.find(t)
                        snippet = text[max(0, i - 70):i + 90].replace("\n", " ").strip()
            if ts > last:
                last = ts
        if sum(hits.values()) == 0:
            continue
        # merge across account roots: keep the copy with more hits, latest ts
        prev = by_sid.get(sid)
        if prev is None or sum(hits.values()) > prev["total"]:
            by_sid[sid] = {
                "distinct": sum(1 for t in terms if hits[t]),
                "total": sum(hits.values()),
                "last": max(last, prev["last"]) if prev else last,
                "sid": sid,
                "dir": os.path.dirname(f),
                "hits": hits,
                "snippet": snippet or (prev["snippet"] if prev else ""),
                "meta": index.get(sid, {}),
            }
        elif last > prev["last"]:
            prev["last"] = last

    rows = list(by_sid.values())
    rows.sort(key=lambda r: (r["distinct"], r["last"], r["total"]), reverse=True)
    if not rows:
        print("No transcripts matched:", " ".join(args.terms))
        return
    for r in rows[: args.limit]:
        meta = r["meta"]
        name = meta.get("display_name") or "(unnamed)"
        cwd = meta.get("cwd") or "(cwd unknown — verify)"
        hitstr = " ".join(f"{t}={r['hits'][t]}" for t in terms)
        print(f"[{r['distinct']}/{len(terms)} terms] last={r['last'][:10]}  {name}")
        print(f"    sid={r['sid']}")
        print(f"    cwd={cwd}")
        print(f"    jsonl_dir={r['dir']}   ({hitstr})")
        if r["snippet"]:
            print(f"    ↳ …{r['snippet']}…")
        print()


if __name__ == "__main__":
    main()
