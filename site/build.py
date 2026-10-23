#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""Build the site and the Claude Code install list from skills/*/tool.yaml.

Each section in site.yaml (Claude skills, tools I've built) is a folder of tools, served at
/<dir>/<tool>/. The first skill pages were published at /<skill>/; those redirect.

  uv run site/build.py                 write .claude-plugin/marketplace.json and _site/
  uv run site/build.py --check         fail if marketplace.json is out of date (CI runs this)
  uv run site/build.py --out DIR       build the site somewhere else
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(__file__).resolve().parent
CLAUDE_AI_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
e = html.escape


def load_tools(cfg):
    tools = []
    for sec in cfg["sections"]:
        folder = ROOT / sec["dir"]
        for d in sorted(folder.iterdir()) if folder.exists() else []:
            if not (d / "tool.yaml").exists():
                continue
            t = yaml.safe_load((d / "tool.yaml").read_text()) or {}
            t["sec"] = sec
            tools.append(_load_one(t, d))
    return sorted(tools, key=lambda t: (t.get("order", 99), t["slug"]))


def _load_one(t, d):
    if True:
        t["slug"] = d.name
        t["dir"] = d
        t["snapshot"] = json.loads((d / "snapshot.json").read_text()) if (d / "snapshot.json").exists() else {}
        t["skills"] = sorted(p.name for p in (d / "skills").iterdir()) if (d / "skills").exists() else []
    return t


def marketplace(cfg, tools) -> str:
    data = {
        "name": cfg["marketplace"],
        "owner": {"name": cfg["author"]},
        "metadata": {"description": cfg["tagline"]},
        "plugins": [{"name": t["slug"], "source": f"./{t['sec']['dir']}/{t['slug']}", "description": t["summary"]}
                    for t in tools if t["skills"]],
    }
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# --- claude.ai zip --------------------------------------------------------------

def _claude_ai_skill_md(text: str) -> str:
    text = text.replace("${CLAUDE_SKILL_DIR}/", "").replace("${CLAUDE_SKILL_DIR}", ".")
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    fm = yaml.safe_load(text[3:end]) or {}
    body = text[end + 4:].lstrip("\n")
    meta = dict(fm.pop("metadata", None) or {})
    for k in [k for k in fm if k not in CLAUDE_AI_KEYS]:
        meta[k] = fm.pop(k)
    if meta:
        fm["metadata"] = meta
    return "---\n" + yaml.safe_dump(fm, sort_keys=False, allow_unicode=True, width=1000) + "---\n\n" + body


def make_zip(skill_dir: Path, dest: Path):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(skill_dir.rglob("*")):
            if p.is_dir():
                continue
            arc = f"{skill_dir.name}/{p.relative_to(skill_dir).as_posix()}"
            if p.name == "SKILL.md" and p.parent == skill_dir:
                z.writestr(arc, _claude_ai_skill_md(p.read_text()))
            else:
                z.write(p, arc)


# --- pages ------------------------------------------------------------------------

# Where a tool can run, in the order a reader meets them. Keys match snapshot.json.
SURFACES = [("claude-code", "Claude Code"), ("cowork", "Cowork"), ("claude-ai", "Claude chat")]
OK = ("works", "caveat")


def surface_info(t, key):
    s = dict(t["snapshot"].get("surfaces", {}).get(key, {}))
    s.update((t.get("surfaces") or {}).get(key, {}))       # tool.yaml may override a verdict or its reasons
    return s


def available(t):
    """Labels of the routes that work for this tool, for the card and the top of its page."""
    out = [label for key, label in SURFACES if t["skills"] and surface_info(t, key).get("verdict") in OK]
    out += [w["label"] for w in t.get("where", []) if w.get("verdict", "works") in OK and w.get("tag", True)]
    if t.get("brief"):
        out.append("Build your own")
    return out


def tags_html(t):
    items = "".join(f"<li>{e(label)}</li>" for label in available(t))
    return f'<ul class="tags" aria-label="Works in">{items}</ul>'


def asset(p: str) -> str:
    # demo/ is copied to the tool's folder on the site, so drop the prefix.
    return p[len("demo/"):] if p.startswith("demo/") else p


def header_svg(t) -> str:
    p = t.get("header")
    if not p or not (t["dir"] / p).exists():
        return ""
    svg = (t["dir"] / p).read_text()
    return svg[svg.find("<svg"):]


THEME_BOOT = """<script>
try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
</script>"""

THEME_SWITCH = """<div class="theme" role="group" aria-label="Colour theme">
<button type="button" data-set-theme="system">System</button><button type="button" data-set-theme="light">Light</button><button type="button" data-set-theme="dark">Dark</button>
</div>"""


def page(title, body, depth, cfg, desc="", hero="", sec=None, scripts=()):
    up = "../" * depth
    home = up or "./"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc or cfg['tagline'])}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{e(cfg['title'])}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc or cfg.get('share_description', cfg['tagline']))}">
<meta property="og:image" content="{e(cfg['url'].rstrip('/'))}/og-image.webp">
<meta property="og:image:type" content="image/webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AI tools: Claude skills and tools by {e(cfg['author'])}, at tools.aksaeri.com">
<meta name="twitter:card" content="summary_large_image">
{THEME_BOOT}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="{up}style.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="wordmark" href="{home}">{e(cfg['author'])}</a><a class="sitelink" href="{home}">{e(cfg['title'])}</a>{f'<a class="sitelink" href="{home}#{e(sec["dir"])}">{e(sec["title"])}</a>' if sec else ''}{THEME_SWITCH}</div></header>
{hero}
<main class="wrap">
{body}
</main>
<footer class="wrap muted">MIT licence · <a href="https://github.com/{e(cfg['repo'])}">Source on GitHub</a> · <a href="{home}llms.txt">llms.txt</a></footer>
<script src="{up}site.js"></script>
{"".join(f'<script src="{e(src)}" defer></script>' for src in dict.fromkeys(scripts))}
</body>
</html>
"""


def anim_attrs(t, speed_key):
    a = t.get("animation")
    return f' {a["attr"]} data-speed="{a.get(speed_key, 1)}"' if a else ""


def card_html(t):
    base = f"{t['sec']['dir']}/{t['slug']}"
    art = f'<img src="{e(base)}/{e(asset(t["art"]))}" alt="" loading="lazy">' if t.get("art") else header_svg(t)
    return f"""<a class="card" href="{e(base)}/">
  <div class="poster"{anim_attrs(t, "card_speed")}>{art}</div>
  <div class="cb"><b>{e(t['title'])}</b><span>{e(t['summary'])}</span>{tags_html(t)}</div>
</a>"""


def index_page(cfg, tools):
    parts = [f'<section class="hero"><h1>{e(cfg["title"])}</h1></section>']
    for sec in cfg["sections"]:
        mine = [t for t in tools if t["sec"] is sec]
        if not mine:
            continue
        parts.append(f"""<section class="col" id="{e(sec['dir'])}">
<h2>{e(sec['title'])}</h2>
<p class="lede">{e(sec['tagline'])}</p>
</section>
<section class="cards">
{''.join(card_html(t) for t in mine)}
</section>""")
    parts.append(f"""<section class="col">
<h2>Install a skill in Claude Code</h2>
<pre><code>claude plugin marketplace add {e(cfg['repo'])}
claude plugin install &lt;skill&gt;@{e(cfg['marketplace'])}</code></pre>
<p class="note">In Cowork, open Customize, then Plugins, then Add marketplace, and enter <code>{e(cfg['repo'])}</code>.</p>
</section>""")
    scripts = [f"{t['sec']['dir']}/{t['slug']}/{asset(t['animation']['script'])}" for t in tools if t.get("animation")]
    return page(cfg["title"], "\n".join(parts), 0, cfg, scripts=scripts)


def media_html(t):
    out = []
    for m in t.get("media", []):
        cap = f"<figcaption>{e(m.get('caption', ''))}</figcaption>" if m.get("caption") else ""
        if m.get("video"):
            def vid(src, poster, cls=""):
                p = f' poster="{e(asset(poster))}"' if poster else ""
                c = f' class="{cls}"' if cls else ""
                return f'<video{c} controls muted playsinline loop preload="none"{p}><source src="{e(asset(src))}" type="video/mp4"></video>'
            if m.get("narrow_video"):
                # A stacked version for phones, where the wide layout is too small to read.
                v = vid(m["video"], m.get("poster"), "only-wide") + vid(m["narrow_video"], m.get("narrow_poster"), "only-narrow")
            else:
                v = vid(m["video"], m.get("poster"))
            out.append(f'<figure{" class=\"wide\"" if m.get("narrow_video") else ""}>{v}{cap}</figure>')
        elif m.get("image"):
            out.append(f'<figure><img src="{e(asset(m["image"]))}" alt="{e(m.get("alt") or m.get("caption", ""))}" loading="lazy">{cap}</figure>')
    return "\n".join(out)


BLOCKERS = ("can't run", "doesn't have")


def shown_reasons(s):
    """When a surface can't run the tool, the blockers are the only reasons worth showing."""
    reasons = s.get("reasons", [])
    if s.get("verdict") not in OK:
        reasons = [r for r in reasons if any(b in r for b in BLOCKERS)] or reasons
    return [r[:1].upper() + r[1:] + ("" if r.endswith(".") else ".") for r in reasons]


def prose_html(text: str) -> str:
    """Paragraphs split by blank lines; a block whose lines all start with "- " becomes a list."""
    out = []
    for block in [b.strip() for b in (text or "").strip().split("\n\n") if b.strip()]:
        rows = block.splitlines()
        if all(r.startswith("- ") for r in rows):
            out.append("<ul>" + "".join(f"<li>{e(r[2:])}</li>" for r in rows) + "</ul>")
        else:
            out.append(f"<p>{e(' '.join(rows))}</p>")
    return "".join(out)


def requires_li(t):
    def line(r):
        r = r if r.endswith(".") else r + "."
        return e(r) if r.lower().startswith("optional") else "Needs " + e(r[:1].lower() + r[1:])
    return "".join(f'<li class="req">{line(r)}</li>' for r in t.get("requires", []))


def where_html(t):
    rows = []
    for key, label in SURFACES:
        if not t["skills"]:
            continue
        s = surface_info(t, key)
        ok = s.get("verdict") in OK
        status = "Works" if s.get("verdict") == "works" else "Works, with notes" if ok else "Doesn't run here"
        reasons = (requires_li(t) if ok else "") + "".join(f"<li>{e(r)}</li>" for r in shown_reasons(s))
        rows.append(f'<tr><th scope="row">{e(label)}</th><td><span class="state {"ok" if ok else "no"}">{e(status)}</span>'
                    f'{f"<ul>{reasons}</ul>" if reasons else ""}</td></tr>')
    for w in t.get("where", []):
        # Tools that aren't skills describe their own parts (an app, a server) in tool.yaml.
        v = w.get("verdict", "works")
        status = w.get("status") or ("Works" if v == "works" else "Works, with notes" if v in OK else "Not yet")
        notes = "".join(f'<li class="req">{e(r)}</li>' for r in w.get("needs", []))
        notes += "".join(f"<li>{e(r)}</li>" for r in w.get("notes", []))
        rows.append(f'<tr><th scope="row">{e(w["label"])}</th><td><span class="state {"ok" if v in OK else "no"}">{e(status)}</span>'
                    f'{f"<ul>{notes}</ul>" if notes else ""}</td></tr>')
    if t.get("brief"):
        rows.append('<tr><th scope="row">Build your own</th><td><span class="state ok">Any setup</span><ul><li>Give the brief to your own Claude.</li></ul></td></tr>')
    return f'<table class="where">{"".join(rows)}</table>'


def human_date(iso: str) -> str:
    try:
        d = dt.date.fromisoformat(iso)
    except ValueError:
        return ""
    return f"{d.day} {d.strftime('%B %Y')}"


def tool_page(cfg, t):
    slug, snap = t["slug"], t["snapshot"]
    brief = Path(t["brief"]).name if t.get("brief") else ""
    brief_url = f"{cfg['url'].rstrip('/')}/{t['sec']['dir']}/{slug}/{brief}" if brief else ""
    tabs, panels = [], []

    def tab(key, label, inner):
        first = not tabs
        tabs.append(f'<button role="tab" id="tab-{key}" aria-controls="p-{key}" aria-selected="{"true" if first else "false"}"{"" if first else " tabindex=\"-1\""}>{e(label)}</button>')
        panels.append(f'<div class="panel" role="tabpanel" id="p-{key}" aria-labelledby="tab-{key}"{"" if first else " hidden"}><h3 class="nojs">{e(label)}</h3>{inner}</div>')

    def cannot(key, label):
        why = "".join(f"<li>{e(r)}</li>" for r in shown_reasons(surface_info(t, key)))
        return f"<p>This one doesn't run in {e(label)}:</p><ul>{why}</ul><p>Use Claude Code, or build your own version from the brief.</p>"

    if t["skills"]:
        need_line = f'<ul>{requires_li(t)}</ul>' if t.get("requires") else ""
        tab("cc", "Claude Code", f"""<p>Run these once in a terminal. To update later, run <code>claude plugin update {e(slug)}@{e(cfg['marketplace'])}</code>.</p>
<pre><code>claude plugin marketplace add {e(cfg['repo'])}
claude plugin install {e(slug)}@{e(cfg['marketplace'])}</code></pre>{need_line}
<p class="note">On Windows, if you don't have an SSH key set up for GitHub, set <code>CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1</code> first.</p>""")
        co = surface_info(t, "cowork")
        if co.get("verdict") in OK:
            notes = "".join(f"<li>{e(r)}</li>" for r in shown_reasons(co))
            tab("co", "Cowork", f"""<ol><li>In the Claude desktop app, open Customize, then Plugins.</li>
<li>Choose Add marketplace and enter <code>{e(cfg['repo'])}</code>.</li>
<li>Install <b>{e(slug)}</b>.</li></ol>
{f'<p>Before it will run:</p><ul>{notes}</ul>' if notes else ''}""")
        else:
            tab("co", "Cowork", cannot("cowork", "Cowork"))
        ai = surface_info(t, "claude-ai")
        if ai.get("verdict") in OK:
            zips = "".join(f'<li><a href="{e(s)}.zip">{e(s)}.zip</a></li>' for s in t["skills"])
            notes = "".join(f"<li>{e(r)}</li>" for r in shown_reasons(ai))
            tab("ai", "Claude chat", f"""<ol><li>Download the skill: <ul>{zips}</ul></li>
<li>In Claude on the web or desktop, open Customize, then Skills, and upload the zip.</li>
<li>If the skill has scripts, turn on code execution in Settings.</li></ol>
{f'<p>Things to know:</p><ul>{notes}</ul>' if notes else ''}""")
        else:
            tab("ai", "Claude chat", cannot("claude-ai", "Claude chat"))
    if brief:
        prompt = f"Read {brief_url} and help me build my own version of {t['title']} for my setup. Ask me what I use first."
        tab("own", "Build your own", f"""<p>Give the brief to your own Claude and adapt it to what you use. <a href="{e(brief)}">Read the brief</a>.</p>
<div class="copyrow"><pre class="prompt">{e(prompt)}</pre><button class="btn copy" type="button">Copy</button></div>
<p class="note copied" aria-live="polite"></p>""")
    source = f"https://github.com/{cfg['repo']}/tree/main/{t['sec']['dir']}/{slug}"
    updated = human_date(snap.get("source_date") or snap.get("exported", ""))
    art = header_svg(t)
    media = media_html(t)
    if t.get("art"):
        credit = f'<p class="art-credit">Art: {e(t.get("art_title", ""))}</p>' if t.get("art_title") else ""
        hero = f"""<!-- --art resolves against style.css at the site root, hence the tool folder in the path -->
<section class="hero-art"{anim_attrs(t, "speed")} style="--art: url('{e(t['sec']['dir'])}/{e(slug)}/{e(asset(t['art']))}')">
<div class="wrap"><div class="hero-boxes">
<h1><span>{e(t['title'])}</span></h1>
<p class="lede">{e(t['summary'])}</p>
{tags_html(t)}
</div>{credit}</div>
</section>"""
        top = ""
    else:
        hero = ""
        top = f"""<section class="hero">
<h1>{e(t['title'])}</h1>
<p class="lede">{e(t['summary'])}</p>
{tags_html(t)}
</section>
"""
    body = f"""{top}<section class="col">
<h2>How I use it</h2>
{prose_html(t.get('how_i_use_it', ''))}
{''.join(f'<p><a class="btn-link" href="{e(asset(l["href"]))}">{e(l["label"])} →</a></p>' for l in t.get("links", []))}
{f'<p class="prov">Last updated {e(updated)}</p>' if updated else ''}
</section>
{f'<section class="col"><h2>Visual overview</h2><figure class="header-art">{art}</figure></section>' if art else ''}
{f'<section class="media">{media}</section>' if media else ''}
<section class="col">
<h2>Where it works</h2>
{where_html(t)}
</section>
<section class="col">
<h2>Get it</h2>
{f'<div class="tabs" role="tablist" aria-label="Ways to get it">{"".join(tabs)}</div>' if tabs else '<p>The brief for building your own is on its way.</p>'}
{''.join(panels)}
<p class="note">{" · ".join(x for x in [f'<a href="{e(source)}">Read the code on GitHub</a>' if t["skills"] or t.get("code") else "", f'<a href="{e(brief)}">The brief, as Markdown</a>' if brief else "", '<a href="llms.txt">llms.txt</a>'] if x)}</p>
</section>"""
    scripts = [asset(t["animation"]["script"])] if t.get("animation") else []
    return page(f"{t['title']} · {cfg['title']}", body, 2, cfg, t["summary"], hero, t["sec"], scripts)


def llms_root(cfg, tools):
    lines = [f"# {cfg['title']}", "", f"> Claude skills and tools by {cfg['author']}, cleaned up so you can install them or build your own.", "",
             f"Claude Code users can install any skill: `claude plugin marketplace add {cfg['repo']}` then `claude plugin install <tool>@{cfg['marketplace']}`.", "", "## Tools", ""]
    for t in tools:
        lines.append(f"- [{t['title']}]({t['sec']['dir']}/{t['slug']}/llms.txt): {t['summary']}")
    return "\n".join(lines) + "\n"


def llms_tool(cfg, t):
    brief = Path(t["brief"]).name if t.get("brief") else ""
    lines = [f"# {t['title']}", "", f"> {t['summary']}", ""]
    lines += [p.replace("\n", " ") for p in t.get("how_i_use_it", "").strip().split("\n\n") if p] + [""]
    lines += ["## Files", ""]
    if brief:
        lines.append(f"- [Rebuild brief (Markdown)]({brief}): how it works and how to build your own version")
    lines.append(f"- [The page](./): demo and install routes")
    if t["skills"]:
        lines.append(f"- [Source](https://github.com/{cfg['repo']}/tree/main/{t['sec']['dir']}/{t['slug']}): the code")
    return "\n".join(lines) + "\n"


def redirect(to: str) -> str:
    return (f'<!doctype html><meta charset="utf-8"><title>Moved</title>'
            f'<meta http-equiv="refresh" content="0; url={e(to)}"><link rel="canonical" href="{e(to)}">'
            f'<p>This page has moved: <a href="{e(to)}">{e(to)}</a></p>\n')


def build_site(cfg, tools, out: Path):
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in ("style.css", "site.js"):
        shutil.copy(SITE / f, out / f)
    (out / ".nojekyll").write_text("")
    if (SITE / "og" / "og-image.webp").exists():
        shutil.copy(SITE / "og" / "og-image.webp", out / "og-image.webp")
    shutil.copytree(SITE / "og", out / "og")   # the template, so the image can be re-rendered from the preview
    (out / "index.html").write_text(index_page(cfg, tools))
    (out / "llms.txt").write_text(llms_root(cfg, tools))
    for sec in cfg["sections"]:
        (out / sec["dir"]).mkdir()
        (out / sec["dir"] / "index.html").write_text(redirect(f"../#{sec['dir']}"))
    for t in tools:
        d = out / t["sec"]["dir"] / t["slug"]
        if (t["dir"] / "demo").exists():
            shutil.copytree(t["dir"] / "demo", d)
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(tool_page(cfg, t))
        if not t.get("llms"):          # a tool may ship its own llms.txt in demo/ (copied above)
            (d / "llms.txt").write_text(llms_tool(cfg, t))
        if t["snapshot"].get("surfaces", {}).get("claude-ai", {}).get("verdict") in ("works", "caveat"):
            for s in t["skills"]:
                make_zip(t["dir"] / "skills" / s, d / f"{s}.zip")
        # The first pages were published at /<skill>/; keep those addresses working.
        if t["skills"]:
            old = out / t["slug"]
            old.mkdir()
            (old / "index.html").write_text(redirect(f"../{t['sec']['dir']}/{t['slug']}/"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args(argv)
    cfg = yaml.safe_load((SITE / "site.yaml").read_text())
    tools = load_tools(cfg)
    mp_file = ROOT / ".claude-plugin" / "marketplace.json"
    mp = marketplace(cfg, tools)
    if args.check:
        if not mp_file.exists() or mp_file.read_text() != mp:
            print("marketplace.json is out of date: run `uv run site/build.py` and commit it.")
            return 1
    else:
        mp_file.parent.mkdir(exist_ok=True)
        mp_file.write_text(mp)
    build_site(cfg, tools, Path(args.out))
    print(f"built {len(tools)} tools into {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
