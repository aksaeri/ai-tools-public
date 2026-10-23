#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""Build the tools site and the Claude Code install list from tools/*/tool.yaml.

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


def load_tools():
    tools = []
    for d in sorted((ROOT / "tools").iterdir()):
        if not (d / "tool.yaml").exists():
            continue
        t = yaml.safe_load((d / "tool.yaml").read_text()) or {}
        t["slug"] = d.name
        t["dir"] = d
        t["snapshot"] = json.loads((d / "snapshot.json").read_text()) if (d / "snapshot.json").exists() else {}
        t["skills"] = sorted(p.name for p in (d / "skills").iterdir()) if (d / "skills").exists() else []
        tools.append(t)
    return sorted(tools, key=lambda t: (t.get("order", 99), t["slug"]))


def marketplace(cfg, tools) -> str:
    data = {
        "name": cfg["marketplace"],
        "owner": {"name": cfg["author"]},
        "metadata": {"description": cfg["tagline"]},
        "plugins": [{"name": t["slug"], "source": f"./tools/{t['slug']}", "description": t["summary"]}
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


def page(title, body, depth, cfg, desc="", hero=""):
    up = "../" * depth
    home = up or "./"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc or cfg['tagline'])}">
{THEME_BOOT}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="{up}style.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="wordmark" href="{home}">{e(cfg['author'])}</a><a class="sitelink" href="{home}">{e(cfg['title'])}</a>{THEME_SWITCH}</div></header>
{hero}
<main class="wrap">
{body}
</main>
<footer class="wrap muted">MIT licence · <a href="https://github.com/{e(cfg['repo'])}">Source on GitHub</a> · <a href="{home}llms.txt">llms.txt</a></footer>
<script src="{up}site.js"></script>
</body>
</html>
"""


def index_page(cfg, tools):
    cards = []
    for t in tools:
        art = f'<img src="{e(t["slug"])}/{e(asset(t["art"]))}" alt="" loading="lazy">' if t.get("art") else header_svg(t)
        if not art:
            poster = next((m.get("poster") or m.get("image") for m in t.get("media", []) if m.get("poster") or m.get("image")), None)
            art = f'<img src="{e(t["slug"])}/{e(asset(poster))}" alt="" loading="lazy">' if poster else ""
        cards.append(f"""<a class="card" href="{e(t['slug'])}/">
  <div class="poster" aria-hidden="true">{art}</div>
  <div class="cb"><b>{e(t['title'])}</b><span>{e(t['summary'])}</span>{tags_html(t)}</div>
</a>""")
    body = f"""<section class="hero">
<h1>{e(cfg['title'])}</h1>
<p class="lede">{e(cfg['tagline'])}</p>
<p class="muted">{e(cfg.get('intro', ''))}</p>
</section>
<section class="cards">
{''.join(cards)}
</section>
<section class="col">
<h2>Install a skill in Claude Code</h2>
<pre><code>claude plugin marketplace add {e(cfg['repo'])}
claude plugin install &lt;tool&gt;@{e(cfg['marketplace'])}</code></pre>
<p class="note">In Cowork, open Customize, then Plugins, then Add marketplace, and enter <code>{e(cfg['repo'])}</code>.</p>
</section>"""
    return page(cfg["title"], body, 0, cfg)


def media_html(t):
    out = []
    for m in t.get("media", []):
        cap = f"<figcaption>{e(m.get('caption', ''))}</figcaption>" if m.get("caption") else ""
        if m.get("video"):
            poster = f' poster="{e(asset(m["poster"]))}"' if m.get("poster") else ""
            out.append(f'<figure><video controls muted playsinline preload="none"{poster}><source src="{e(asset(m["video"]))}" type="video/mp4"></video>{cap}</figure>')
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
    brief_url = f"{cfg['url'].rstrip('/')}/{slug}/{brief}" if brief else ""
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
    source = f"https://github.com/{cfg['repo']}/tree/main/tools/{slug}"
    updated = human_date(snap.get("source_date") or snap.get("exported", ""))
    art = header_svg(t)
    media = media_html(t)
    if t.get("art"):
        credit = f'<p class="art-credit">Art: {e(t.get("art_title", ""))}</p>' if t.get("art_title") else ""
        hero = f"""<!-- --art resolves against style.css at the site root, hence the tool folder in the path -->
<section class="hero-art" style="--art: url('{e(slug)}/{e(asset(t['art']))}')">
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
<div class="tabs" role="tablist" aria-label="Ways to get it">{''.join(tabs)}</div>
{''.join(panels)}
<p class="note"><a href="{e(source)}">Read the code on GitHub</a>{f' · <a href="{e(brief)}">The brief, as Markdown</a>' if brief else ''} · <a href="llms.txt">llms.txt</a></p>
</section>"""
    return page(f"{t['title']} · {cfg['title']}", body, 1, cfg, t["summary"], hero)


def llms_root(cfg, tools):
    lines = [f"# {cfg['title']}", "", f"> {cfg['tagline']} By {cfg['author']}.", "",
             f"Claude Code users can install any skill: `claude plugin marketplace add {cfg['repo']}` then `claude plugin install <tool>@{cfg['marketplace']}`.", "", "## Tools", ""]
    for t in tools:
        lines.append(f"- [{t['title']}]({t['slug']}/llms.txt): {t['summary']}")
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
        lines.append(f"- [Source](https://github.com/{cfg['repo']}/tree/main/tools/{t['slug']}): the skill itself")
    return "\n".join(lines) + "\n"


def build_site(cfg, tools, out: Path):
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in ("style.css", "site.js"):
        shutil.copy(SITE / f, out / f)
    (out / ".nojekyll").write_text("")
    (out / "index.html").write_text(index_page(cfg, tools))
    (out / "llms.txt").write_text(llms_root(cfg, tools))
    for t in tools:
        d = out / t["slug"]
        if (t["dir"] / "demo").exists():
            shutil.copytree(t["dir"] / "demo", d)
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(tool_page(cfg, t))
        (d / "llms.txt").write_text(llms_tool(cfg, t))
        if t["snapshot"].get("surfaces", {}).get("claude-ai", {}).get("verdict") in ("works", "caveat"):
            for s in t["skills"]:
                make_zip(t["dir"] / "skills" / s, d / f"{s}.zip")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args(argv)
    cfg = yaml.safe_load((SITE / "site.yaml").read_text())
    tools = load_tools()
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
