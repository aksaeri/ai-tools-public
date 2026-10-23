#!/usr/bin/env python3
"""Reddit and Twitter through TikHub, a paid third-party API. Needs a key.

Usage:
  tikhub.py reddit-search "QUERY" [--comments] [--subreddit NAME] [--sort relevance|new|top|hot|comments]
                                  [--time all|year|month|week|day|hour] [-n 25]
  tikhub.py reddit-thread URL_OR_ID [--pages 5]
  tikhub.py x-search "QUERY" [--group NAME | --from a,b,c] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [-n 20] [--pages 3]
  tikhub.py x-scan "QUERY" (--group NAME | --from a,b,c) [--since YYYY-MM-DD] [--pages 3]
  tikhub.py x-posts HANDLE [-n 50] [--no-detail]
  tikhub.py x-thread URL_OR_ID [--pages 1]
  tikhub.py balance

Every command takes --dry-run (print the first requests and the most calls it
could make, spend nothing) and --no-links (leave t.co links unresolved).

reddit-search  posts, or comments with --comments, matching QUERY. QUERY takes
               AND, OR, NOT, "quoted phrases"; --subreddit scopes it.
reddit-thread  a post's full text and its comments, flat, with depth and parent.
x-search       posts matching QUERY. --group names a list of accounts in
               x_accounts.json; --from gives handles directly. Results come back
               newest first, and posts quoted by two or more results are listed
               in often_quoted.
x-scan         reads each listed account's own recent posts back to --since and
               keeps those whose words, or whose quoted or reposted post's words,
               contain every term in QUERY. Slower and dearer than x-search (one
               call per 20 posts per account) but it catches a "lol" quote of a
               screenshot, which Twitter's search misses because it matches only the
               poster's own words. Reposts are kept, marked reposted_by.
x-posts        an account's latest N posts of its own (originals and quote
               posts). Its replies to itself sit in each post's thread; its
               reposts of other people's quotes of one of its posts are listed
               on that post as boosted; other reposts are listed apart. Quoted
               posts cut short by Twitter are fetched in full unless --no-detail.
x-thread       one post in full and the replies under it.
balance        paid balance and free credit (free call).

Prints JSON on stdout. Every paid call costs about US$0.001 and Reddit and Twitter
calls can't use free credit; the call count goes to stderr. Reads
TIKHUB_API_KEY from the environment or ~/.claude/.env; without one it exits 3.
TikHub logs every query and caches responses for 24 hours on its servers, so
keep confidential topics off it. Other errors exit 1, bad arguments exit 2.
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PRICE = 0.001
HERE = Path(__file__).resolve().parent
ACCOUNTS = Path(os.environ.get("TIKHUB_ACCOUNTS", HERE.parent / "x_accounts.json"))
HANDLES_PER_QUERY = 15        # Twitter caps query length; long from: lists go in batches


class Fail(Exception):
    pass


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


class Api:
    def __init__(self, key: str, dry: bool):
        self.key, self.dry = key, dry
        self.base = os.environ.get("TIKHUB_BASE", "https://api.tikhub.io")
        self.calls, self.planned = 0, []

    def get(self, path: str, paid: bool = True, **params) -> dict:
        params = {k: v for k, v in params.items() if v not in (None, "")}
        if self.dry:
            self.planned.append({"path": path, "params": params})
            return {}
        url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.key}", "User-Agent": "research-content"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors="replace")
            if e.code == 401:
                raise Fail("TikHub rejected the key (HTTP 401). Check TIKHUB_API_KEY.")
            if e.code == 402:
                raise Fail("TikHub: out of paid credit (HTTP 402). Reddit and Twitter calls can't use free credit; top up at tikhub.io.")
            raise Fail(f"TikHub returned HTTP {e.code} for {path}: {detail}")
        except urllib.error.URLError as e:
            raise Fail(f"could not reach TikHub: {e.reason}")
        if paid:
            self.calls += 1
        if body.get("code") != 200:
            raise Fail(f"TikHub error for {path}: {body.get('message') or body}")
        return body["data"] or {} if "data" in body else body     # the account endpoint has no data wrapper


# --- shared text helpers --------------------------------------------------

def x_date(s):
    if not s:
        return None
    return datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y").astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def r_date(s):
    return s[:19] + "Z" if s else None


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


SHORTENERS = r"(t\.co|visitlink\.me|bit\.ly|buff\.ly|ow\.ly|trib\.al|lnkd\.in|dlvr\.it|shorturl|tinyurl)"


class Links:
    """t.co links: from the post's own entities where Twitter gives them, else by following the redirect (free)."""

    def __init__(self, follow: bool):
        self.follow, self.seen, self.authors = follow, {}, {}
        self.opener = urllib.request.build_opener(NoRedirect)

    def resolve(self, u):
        if u in self.seen or not self.follow:
            return self.seen.get(u)
        cur, moved = u, False
        for _ in range(6):
            try:
                self.opener.open(urllib.request.Request(cur, method="HEAD", headers={"User-Agent": "curl/8"}), timeout=15)
                break
            except urllib.error.HTTPError as e:
                loc = e.headers.get("Location")
                if e.code not in (301, 302, 303, 307, 308) or not loc:
                    break
                cur, moved = urllib.parse.urljoin(cur, loc), True
                if not re.search(SHORTENERS, urllib.parse.urlsplit(cur).netloc):
                    break
            except Exception:
                break
        self.seen[u] = tidy(cur) if moved else None
        return self.seen[u]

    def text(self, raw, entities=None):
        """Unescape, swap t.co links for their destinations, drop links to the post's own photo or video."""
        ents = entities if isinstance(entities, dict) else {}
        for e in ents.get("urls") or []:
            if e.get("url") and e.get("expanded_url"):
                self.seen.setdefault(e["url"], tidy(e["expanded_url"]))
        for e in ents.get("media") or []:
            if e.get("url"):
                self.seen.setdefault(e["url"], e.get("expanded_url"))

        def rep(m):
            dest = self.resolve(m.group(0))
            if not dest:
                return m.group(0)
            own = re.search(r"x\.com/(\w+)/status/(\d+)/(photo|video)/", dest)
            if own:                     # a link to the post's own media, which also names its author
                self.authors[own.group(2)] = own.group(1)
                return ""
            return dest
        return html.unescape(re.sub(r"https://t\.co/\w+", rep, raw or "")).strip()


def tidy(u):
    p = urllib.parse.urlsplit(u)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not re.match(r"utm_|^(s|t|ref_src|ref_url)$", k)]
    return urllib.parse.urlunsplit((p.scheme, p.netloc.replace("twitter.com", "x.com"), p.path, urllib.parse.urlencode(q), ""))


# --- Twitter --------------------------------------------------------------------

def x_media(t):
    out, m = [], t.get("media")
    if isinstance(m, dict):
        for kind, items in m.items():
            for it in items or []:
                u = it.get("media_url_https")
                if not u:
                    continue
                if kind == "video":
                    mp4 = sorted((v for v in it.get("variants", []) if v.get("content_type") == "video/mp4"),
                                 key=lambda v: v.get("bitrate", 0))
                    out.append({"type": "video", "url": mp4[-1]["url"] if mp4 else None, "thumbnail": u,
                                "seconds": round(it["duration"] / 1000) if it.get("duration") else None})
                else:
                    out.append({"type": "photo", "url": u + ("?name=orig" if "/media/" in u else "")})
    ents = t.get("entities") if isinstance(t.get("entities"), dict) else {}
    if not out:                                   # detail and reply responses keep media under entities
        for it in ents.get("media") or []:
            u = it.get("media_url_https")
            if not u:
                continue
            if it.get("type") in ("video", "animated_gif"):
                mp4 = sorted((v for v in (it.get("video_info") or {}).get("variants", []) if v.get("content_type") == "video/mp4"),
                             key=lambda v: v.get("bitrate", 0))
                out.append({"type": "video", "url": mp4[-1]["url"] if mp4 else None, "thumbnail": u})
            else:
                out.append({"type": "photo", "url": u + ("?name=orig" if "/media/" in u else "")})
    return out


def x_author(t):
    for src in (t.get("author"), t.get("user_info")):
        if isinstance(src, dict) and src.get("screen_name"):
            return src["screen_name"]
    return t.get("screen_name")


def x_post(t, links, author=None):
    pid = t.get("tweet_id") or t.get("id")
    raw = t.get("text") or ""
    text = links.text(raw, t.get("entities"))
    a = x_author(t) or author or links.authors.get(pid)
    p = {"id": pid, "url": f"https://x.com/{a or 'i'}/status/{pid}", "author": a, "date": x_date(t.get("created_at")),
         "text": text,
         "metrics": {"likes": num(t.get("favorites") or t.get("likes")), "reposts": num(t.get("retweets")),
                     "quotes": num(t.get("quotes")), "replies": num(t.get("replies")), "views": num(t.get("views"))},
         "media": x_media(t)}
    reply_to = t.get("reply_to") or t.get("in_reply_to_status_id_str")
    if reply_to:
        p["reply_to"] = reply_to
    if t.get("quoted"):
        q = t["quoted"]
        p["quoted"] = x_post(q, links)
        # Twitter cuts quoted text at about 300 characters; x-posts fetches the long ones in full (_full)
        p["quoted"]["text_complete"] = bool(q.get("_full")) or len(q.get("text") or "") < 270
        if q.get("_gone"):
            p["quoted"]["unavailable"] = True
    return p


def x_repost(t, links):
    """The post inside a repost. Twitter leaves out its author in timelines; the "RT @name:" text still has it."""
    o = x_post(t["retweeted_tweet"], links)
    by = re.match(r"RT @(\w+):", t.get("text") or "")
    if by and not o["author"]:
        o["author"] = by.group(1)
        o["url"] = f"https://x.com/{o['author']}/status/{o['id']}"
    return o


def x_id(s):
    m = re.search(r"status/(\d+)", s)
    if m:
        return m.group(1)
    if s.isdigit():
        return s
    raise Fail(f"not a post URL or id: {s}")


def load_group(name):
    try:
        groups = json.loads(ACCOUNTS.read_text(encoding="utf-8")).get("groups", {})
    except OSError:
        raise Fail(f"no account list at {ACCOUNTS}")
    if name not in groups:
        raise Fail(f"no group '{name}' in {ACCOUNTS.name}; groups: {', '.join(groups) or 'none'}")
    handles = [h.lstrip("@") for h in groups[name].get("accounts", [])]
    if not handles:
        raise Fail(f"group '{name}' in {ACCOUNTS.name} has no accounts yet; add handles to its accounts list")
    return handles


def x_search(api, links, a):
    handles = load_group(a.group) if a.group else [h.strip().lstrip("@") for h in (a.from_ or "").split(",") if h.strip()]
    tail = " ".join(f"{k}:{v}" for k, v in (("since", a.since), ("until", a.until)) if v)
    batches = [handles[i:i + HANDLES_PER_QUERY] for i in range(0, len(handles), HANDLES_PER_QUERY)] or [[]]
    found, queries = {}, []
    for batch in batches:
        q = a.query
        if batch:
            q += " (" + " OR ".join(f"from:{h}" for h in batch) + ")"
        if tail:
            q += " " + tail
        queries.append(q)
        cursor = None
        for _ in range(a.pages):
            d = api.get("/api/v1/twitter/web/fetch_search_timeline", keyword=q, search_type="Latest", cursor=cursor)
            for t in d.get("timeline") or []:
                if t.get("type", "tweet") != "tweet":
                    continue
                pid = t.get("tweet_id")
                if pid not in found:
                    found[pid] = x_post(t, links)
            cursor = d.get("next_cursor")
            if not cursor or len(found) >= a.n * len(batches) or not d.get("timeline"):
                break
    results = sorted(found.values(), key=lambda p: p["date"] or "", reverse=True)[:a.n]
    quoted = {}
    for p in results:
        if p.get("quoted"):
            quoted.setdefault(p["quoted"]["id"], {"post": p["quoted"], "quoted_by": []})["quoted_by"].append(p["id"])
    return {"queries": queries, "results": results,
            "often_quoted": [v for v in quoted.values() if len(v["quoted_by"]) > 1]}, len(batches) * a.pages


def terms(query):
    """Quoted phrases and single words, lower-cased; a post matches when it has all of them."""
    return [(a or b).lower() for a, b in re.findall(r'"([^"]+)"|(\S+)', query)]


def x_scan(api, links, a):
    handles = load_group(a.group) if a.group else [h.strip().lstrip("@") for h in (a.from_ or "").split(",") if h.strip()]
    if not handles:
        raise Fail("x-scan needs --group or --from")
    want = terms(a.query)
    since = a.since or (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    results, failed = [], []
    for h in handles:
        cursor = None
        for _ in range(a.pages):
            try:
                d = api.get("/api/v1/twitter/web/fetch_user_post_tweet", screen_name=h, cursor=cursor)
            except Fail as e:
                failed.append({"account": h, "error": str(e)})
                break
            tl = d.get("timeline") or []
            for t in tl:
                if (x_date(t.get("created_at")) or "") < since:
                    continue
                rt = t.get("retweeted_tweet")
                src = rt or t
                hay = " ".join([src.get("text") or "", (src.get("quoted") or {}).get("text") or ""]).lower()
                if not all(w in hay for w in want):
                    continue
                p = x_repost(t, links) if rt else x_post(t, links, author=h)
                if rt:
                    p["reposted_by"] = h
                results.append(p)
            cursor = d.get("next_cursor")
            # pinned posts can be old, so judge by the oldest post on the page
            oldest = min((x_date(t.get("created_at")) or "" for t in tl), default="")
            if not cursor or not tl or oldest < since:
                break
    seen, unique = set(), []
    for p in sorted(results, key=lambda p: p["date"] or "", reverse=True):
        if p["id"] not in seen:
            seen.add(p["id"])
            unique.append(p)
    groups = {}
    for p in unique:
        root = p["id"] if p.get("reposted_by") else (p.get("quoted") or {}).get("id")
        if root:
            groups.setdefault(root, {"post": p.get("quoted") or p, "picked_up_by": []})["picked_up_by"].append(
                p.get("reposted_by") or p["author"])
    return {"since": since, "accounts": len(handles), "results": unique,
            "often_quoted": [g for g in groups.values() if len(g["picked_up_by"]) > 1],
            "failed": failed}, len(handles) * a.pages


def x_posts(api, links, a):
    handle = a.handle.lstrip("@")
    raw, user, cursor, pages = [], {}, None, 0
    max_pages = a.n // 10 + 3          # 20 items a page, but reposts and self-replies don't count towards n
    while pages < max_pages:
        d = api.get("/api/v1/twitter/web/fetch_user_post_tweet", screen_name=handle, cursor=cursor)
        pages += 1
        user = user or d.get("user") or {}
        raw += d.get("timeline") or []
        cursor = d.get("next_cursor")
        own = [t for t in raw if not t.get("retweeted_tweet")]
        own_ids = {t["tweet_id"] for t in own}
        if not cursor or not d.get("timeline") or sum(1 for t in own if t.get("reply_to") not in own_ids) >= a.n:
            break
    seen, items = set(), []
    for t in raw:
        if t["tweet_id"] not in seen:
            seen.add(t["tweet_id"])
            items.append(t)
    uid = user.get("rest_id") or user.get("id")

    # quoted posts Twitter cut short, or whose author it left out (unless it's this account's own post)
    if not a.no_detail:
        own = [t for t in items if not t.get("retweeted_tweet")]
        own_ids = {t["tweet_id"] for t in own}
        heads = [t for t in own if t.get("reply_to") not in own_ids][:a.n]
        start = min((x_date(t["created_at"]) for t in heads), default="")
        need = {}
        for t in items:                 # only what the output will hold: the window from the oldest post kept
            if (x_date(t.get("created_at")) or "") < start:
                continue
            src = t.get("retweeted_tweet") or t
            q = src.get("quoted")
            if q and (q.get("author") or {}).get("rest_id") != uid and (len(q.get("text") or "") >= 270 or not x_author(q)):
                need.setdefault(q["tweet_id"], []).append(q)      # several posts can quote the same one
        for qid, copies in need.items():
            d = api.get("/api/v1/twitter/web/fetch_tweet_detail", tweet_id=qid)
            for q in copies:
                if d.get("created_at") and d.get("text"):
                    q.update({"text": d["text"], "author": d.get("author") or q.get("author"),
                              "entities": d.get("entities"), "_full": True})
                elif not api.dry:
                    q["_gone"] = True

    def mine(t):
        p = x_post(t, links, author=handle)
        q = t.get("quoted")
        if q and p.get("quoted") and (q.get("author") or {}).get("rest_id") == uid:
            p["quoted"]["author"] = handle
            p["quoted"]["url"] = f"https://x.com/{handle}/status/{q['tweet_id']}"
        return p

    own = [t for t in items if not t.get("retweeted_tweet")]
    own_ids = {t["tweet_id"] for t in own}
    threads, posts, by_id = {}, [], {}
    for t in own:
        if t.get("reply_to") in own_ids:
            threads.setdefault(t["reply_to"], []).append(t)
            continue
        p = mine(t)
        p["kind"] = "quote" if t.get("quoted") else "reply" if t.get("reply_to") else "post"
        p["thread"], p["boosted"] = [], []
        posts.append(p)
        by_id[p["id"]] = p
    posts = posts[:a.n]
    kept = {p["id"] for p in posts}
    oldest = min((p["date"] for p in posts if p["date"]), default="")

    def continue_thread(root, into):
        for c in sorted(threads.get(root, []), key=lambda c: x_date(c["created_at"])):
            into.append(mine(c))
            continue_thread(c["tweet_id"], into)
    for p in posts:
        continue_thread(p["id"], p["thread"])

    reposts = []
    for t in items:
        r = t.get("retweeted_tweet")
        if not r or (x_date(t.get("created_at")) or "") < oldest:
            continue
        o = x_repost(t, links)
        q = r.get("quoted") or {}
        target = q.get("tweet_id") if (q.get("author") or {}).get("rest_id") == uid else None
        entry = {"reposted_at": x_date(t.get("created_at")), "post": o}
        if target in kept:
            entry["relation"] = "quotes this post"
            by_id[target]["boosted"].append(entry)
        else:
            reposts.append(entry)
    for i, p in enumerate(posts, 1):
        p["n"] = i

    doc = {"account": {"handle": handle, "id": uid, "name": user.get("name"), "bio": user.get("desc"),
                       "followers": num(user.get("sub_count")), "posts_total": num(user.get("statuses_count"))},
           "counting": "posts: the account's own posts and quote posts, newest first. thread: its replies to itself. "
                       "boosted: its reposts of other people's quotes of that post. reposts: its other reposts in the same period. "
                       "Its replies to other people's posts are not on its Posts tab and are not included.",
           "posts": posts, "reposts": reposts}
    return doc, max_pages + (0 if a.no_detail else a.n)


def x_thread(api, links, a):
    tid = x_id(a.post)
    post, replies, cursor = None, [], None
    for _ in range(a.pages):
        d = api.get("/api/v1/twitter/web/fetch_post_comments", tweet_id=tid, cursor=cursor)
        if post is None and d.get("text"):
            post = x_post(d, links)
        replies += [x_post(r, links) for r in d.get("thread") or []]
        cursor = d.get("cursor")
        if not cursor or not d.get("thread"):
            break
    if post is None and not api.dry:
        raise Fail(f"post {tid} not found (deleted, protected, or the id is wrong)")
    return {"post": post, "replies": replies}, a.pages


# --- Reddit -----------------------------------------------------------------

REDDIT = "https://www.reddit.com"


def r_author(o):
    return (o.get("authorInfo") or {}).get("name") or "[deleted]"


def r_post(p, full=False):
    text = ((p.get("content") or {}).get("markdown") or "").strip()
    out = {"kind": "post", "id": p.get("id"), "url": REDDIT + p["permalink"] if p.get("permalink") else p.get("url"),
           "title": p.get("postTitle") or p.get("title"), "subreddit": (p.get("subreddit") or {}).get("prefixedName"),
           "author": r_author(p), "date": r_date(p.get("createdAt")), "score": p.get("score"), "comments": p.get("commentCount")}
    if not full and len(text) > 800:
        text, out["text_truncated"] = text[:800] + "…", True
    out["text"] = text
    link = (p.get("outboundLink") or {}).get("url") or p.get("url")
    if link and not p.get("isSelfPost") and "reddit.com" not in link:
        out["link"] = link
    return out


def r_comment(c):
    post = c.get("postInfo") or {}
    sub = (post.get("subreddit") or {}).get("name")
    # postInfo.url is the link a link post points to (an image, say), so build the thread URL from the ids
    post_url = f"{REDDIT}/r/{sub}/comments/{post['id'][3:]}/" if sub and post.get("id") else None
    return {"kind": "comment", "id": c.get("id"),
            "url": f"{post_url}comment/{c['id'][3:]}/" if post_url and c.get("id") else None,
            "post_title": post.get("title"), "post_url": post_url,
            "subreddit": (post.get("subreddit") or {}).get("prefixedName"), "author": r_author(c),
            "date": r_date(c.get("createdAt")), "score": c.get("score"),
            "text": ((c.get("content") or {}).get("markdown") or "").strip()}


def reddit_search(api, links, a):
    q = a.query + (f" subreddit:{a.subreddit.removeprefix('r/')}" if a.subreddit else "")
    kind = "comment" if a.comments else "post"
    out, after, pages = [], None, -(-a.n // 10) + 1
    for _ in range(pages):
        d = api.get("/api/v1/reddit/app/fetch_dynamic_search", query=q, search_type=kind,
                    sort=a.sort.upper() if a.sort else None, time_range=None if a.comments else a.time,
                    need_format="true", after=after)
        for ch in d.get("children") or []:
            if kind == "post" and ch.get("post"):
                out.append(r_post(ch["post"]))
            elif kind == "comment" and ch.get("comment"):
                out.append(r_comment(ch["comment"]))
        info = d.get("pageInfo") or {}
        after = info.get("endCursor")
        if len(out) >= a.n or not info.get("hasNextPage") or not d.get("children"):
            break
    return out[:a.n], pages


def r_id(s):
    m = re.search(r"comments/(\w+)", s)
    pid = m.group(1) if m else s.removeprefix("t3_")
    if not re.fullmatch(r"[a-z0-9]+", pid):
        raise Fail(f"not a Reddit post URL or id: {s}")
    return "t3_" + pid


def reddit_thread(api, links, a):
    pid = r_id(a.post)
    d = api.get("/api/v1/reddit/app/fetch_post_details", post_id=pid, need_format="true")
    found = (d.get("postsInfoByIds") or [None])[0]
    if not found and not api.dry:
        raise Fail(f"Reddit post {pid} not found (deleted, private, or the id is wrong)")
    post = r_post(found, full=True) if found else None
    comments, hidden, after = [], 0, None
    for _ in range(a.pages):
        d = api.get("/api/v1/reddit/app/fetch_post_comments", post_id=pid, need_format="true", after=after)
        trees = ((d.get("postInfoById") or {}).get("commentForest") or {}).get("trees") or []
        after = None
        for t in trees:
            n = t.get("node")
            if n:
                comments.append({"id": n["id"], "parent": t.get("parentId"), "depth": t.get("depth", 0),
                                 "author": r_author(n), "score": n.get("score"), "date": r_date(n.get("createdAt")),
                                 "text": ((n.get("content") or {}).get("markdown") or "").strip(),
                                 "url": f"{post['url'].rstrip('/')}/{n['id'][3:]}/" if post else None})
            elif t.get("more"):
                if t.get("depth", 0) == 0 and t["more"].get("cursor"):
                    after = t["more"]["cursor"]
                else:
                    hidden += t["more"].get("count") or 0
        if not after:
            break
    return {"post": post, "comments": comments, "shown": len(comments),
            "total": post.get("comments") if post else None, "more_top_level": bool(after),
            "deep_replies_not_fetched": hidden}, a.pages + 1


def balance(api, links, a):
    d = api.get("/api/v1/tikhub/user/get_user_info", paid=False)
    u = d.get("user_data") or {}
    return {"balance_usd": u.get("balance"), "free_credit_usd": u.get("free_credit"),
            "note": "Reddit and Twitter calls are paid from balance only; free credit doesn't cover them."}, 0


# --- CLI --------------------------------------------------------------------

def main(argv=None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dry-run", action="store_true", help="print the requests, spend nothing")
    common.add_argument("--no-links", action="store_true", help="leave t.co links unresolved")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("reddit-search", parents=[common])
    s.add_argument("query")
    s.add_argument("--comments", action="store_true", help="search comments instead of posts")
    s.add_argument("--subreddit")
    s.add_argument("--sort", choices=["relevance", "new", "top", "hot", "comments"])
    s.add_argument("--time", choices=["all", "year", "month", "week", "day", "hour"])
    s.add_argument("-n", type=int, default=25)
    s.set_defaults(fn=reddit_search)

    s = sub.add_parser("reddit-thread", parents=[common])
    s.add_argument("post", help="post URL or id")
    s.add_argument("--pages", type=int, default=5, help="pages of top-level comments (about 10 each)")
    s.set_defaults(fn=reddit_thread)

    s = sub.add_parser("x-search", parents=[common])
    s.add_argument("query")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--group", help="a group of accounts in x_accounts.json")
    g.add_argument("--from", dest="from_", help="comma-separated handles")
    s.add_argument("--since")
    s.add_argument("--until")
    s.add_argument("-n", type=int, default=20)
    s.add_argument("--pages", type=int, default=3, help="most result pages per batch of accounts")
    s.set_defaults(fn=x_search)

    s = sub.add_parser("x-scan", parents=[common])
    s.add_argument("query")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--group", help="a group of accounts in x_accounts.json")
    g.add_argument("--from", dest="from_", help="comma-separated handles")
    s.add_argument("--since", help="YYYY-MM-DD, default a week ago")
    s.add_argument("--pages", type=int, default=3, help="most timeline pages per account (20 posts each)")
    s.set_defaults(fn=x_scan)

    s = sub.add_parser("x-posts", parents=[common])
    s.add_argument("handle")
    s.add_argument("-n", type=int, default=50)
    s.add_argument("--no-detail", action="store_true", help="don't fetch quoted posts Twitter cut short")
    s.set_defaults(fn=x_posts)

    s = sub.add_parser("x-thread", parents=[common])
    s.add_argument("post", help="post URL or id")
    s.add_argument("--pages", type=int, default=1, help="pages of replies")
    s.set_defaults(fn=x_thread)

    s = sub.add_parser("balance", parents=[common])
    s.set_defaults(fn=balance)

    a = ap.parse_args(argv)
    for d in ("since", "until"):
        if getattr(a, d, None) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", getattr(a, d)):
            ap.error(f"--{d} takes YYYY-MM-DD")

    key = env_value("TIKHUB_API_KEY")
    if not key and not a.dry_run:
        print("TikHub unavailable: no TIKHUB_API_KEY in the environment or ~/.claude/.env", file=sys.stderr)
        return 3
    api = Api(key, a.dry_run)
    links = Links(follow=not (a.no_links or a.dry_run))
    try:
        result, most = a.fn(api, links, a)
    except Fail as e:
        print(e, file=sys.stderr)
        if api.calls:
            print(f"tikhub: {api.calls} paid calls before the error, about US${api.calls * PRICE:.3f}", file=sys.stderr)
        return 1
    try:
        sys.stdout.reconfigure(encoding="utf-8")      # Windows consoles default to a code page
    except AttributeError:
        pass
    if a.dry_run:
        print(json.dumps({"first_requests": api.planned, "most_paid_calls": most,
                          "most_cost_usd": round(most * PRICE, 3)}, ensure_ascii=False, indent=1))
        return 0
    print(json.dumps(result, ensure_ascii=False, indent=1))
    if api.calls:
        print(f"tikhub: {api.calls} paid calls, about US${api.calls * PRICE:.3f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
