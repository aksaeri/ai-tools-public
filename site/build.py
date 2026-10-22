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

def surfaces(t):
    s = t["snapshot"].get("surfaces", {})
    cc = s.get("claude-code", {}).get("verdict")
    ai = s.get("claude-ai", {}).get("verdict")
    chips = []
    if t["skills"] and cc == "works":
        chips.append(("Claude Code", True))
    if t["skills"]:
        chips.append(("claude.ai", ai in ("works", "caveat")))
    chips.append(("Build your own", True))
    return chips


def chips_html(t):
    return "".join(f'<em class="{"y" if ok else "n"}">{e(label)}{"" if ok else " ✕"}</em>' for label, ok in surfaces(t))


def page(title, body, depth, cfg, desc=""):
    css = "../" * depth + "style.css"
    home = "../" * depth or "./"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc or cfg['tagline'])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="{css}">
</head>
<body>
<header class="top"><div class="wrap"><a class="wordmark" href="{home}">{e(cfg['author'])}</a><span class="muted">· {e(cfg['title'])}</span></div></header>
<main class="wrap">
{body}
</main>
<footer class="wrap muted">MIT licence · <a href="https://github.com/{e(cfg['repo'])}">Source on GitHub</a> · <a href="{home}llms.txt">llms.txt</a></footer>
<script src="{'../' * depth}site.js"></script>
</body>
</html>
"""


def index_page(cfg, tools):
    cards = []
    for t in tools:
        poster = next((m.get("poster") or m.get("image") for m in t.get("media", []) if m.get("poster") or m.get("image")), None)
        img = f'<img src="{e(t["slug"])}/{e(asset(poster))}" alt="" loading="lazy">' if poster else '<div class="ph"></div>'
        cards.append(f"""<a class="card" href="{e(t['slug'])}/">
  <div class="poster">{img}</div>
  <div class="cb"><b>{e(t['title'])}</b><span>{e(t['summary'])}</span><div class="works">{chips_html(t)}</div></div>
</a>""")
    body = f"""<section class="hero">
<h1>{e(cfg['title'])}</h1>
<p class="lede">{e(cfg['tagline'])}</p>
<p class="muted">Each tool has a short demo, how I use it, and a brief you can hand to your own Claude to build a version for your setup. Skills install into Claude Code in two commands.</p>
</section>
<section class="cards">
{''.join(cards)}
</section>
<section class="col">
<h2>Install any skill in Claude Code</h2>
<pre><code>claude plugin marketplace add {e(cfg['repo'])}
claude plugin install &lt;tool&gt;@{e(cfg['marketplace'])}</code></pre>
<p class="note">On Windows without an SSH key for GitHub, set <code>CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1</code> first. Update later with <code>claude plugin update &lt;tool&gt;@{e(cfg['marketplace'])}</code>.</p>
</section>"""
    return page(cfg["title"], body, 0, cfg)


def asset(p: str) -> str:
    # demo/ is copied to the tool's folder on the site, so drop the prefix.
    return p[len("demo/"):] if p.startswith("demo/") else p


def media_html(t):
    out = []
    for m in t.get("media", []):
        cap = f"<figcaption>{e(m.get('caption', ''))}</figcaption>" if m.get("caption") else ""
        if m.get("video"):
            poster = f' poster="{e(asset(m["poster"]))}"' if m.get("poster") else ""
            out.append(f'<figure><video controls muted playsinline preload="none"{poster}><source src="{e(asset(m["video"]))}" type="video/mp4"></video>{cap}</figure>')
        elif m.get("image"):
            out.append(f'<figure><img src="{e(asset(m["image"]))}" alt="{e(m.get("caption", ""))}" loading="lazy">{cap}</figure>')
    return "\n".join(out) or '<p class="note">Demo video coming.</p>'


def tool_page(cfg, t):
    slug, snap = t["slug"], t["snapshot"]
    ai = snap.get("surfaces", {}).get("claude-ai", {})
    cc = snap.get("surfaces", {}).get("claude-code", {})
    needs = t.get("needs") or cc.get("needs") or []
    brief = Path(t["brief"]).name if t.get("brief") else ""
    brief_url = f"{cfg['url'].rstrip('/')}/{slug}/{brief}" if brief else ""
    tabs, panels = [], []

    def tab(key, label, inner):
        first = not tabs
        tabs.append(f'<button role="tab" id="tab-{key}" aria-controls="p-{key}" aria-selected="{"true" if first else "false"}"{"" if first else " tabindex=\"-1\""}>{e(label)}</button>')
        panels.append(f'<div class="panel" role="tabpanel" id="p-{key}" aria-labelledby="tab-{key}"{"" if first else " hidden"}><h3 class="nojs">{e(label)}</h3>{inner}</div>')

    if t["skills"]:
        need_line = f"<p>You'll need: {e(', '.join(needs))}.</p>" if needs else ""
        tab("cc", "Claude Code", f"""<p>Two commands, once. Updates come with <code>claude plugin update {e(slug)}@{e(cfg['marketplace'])}</code>.</p>
<pre><code>claude plugin marketplace add {e(cfg['repo'])}
claude plugin install {e(slug)}@{e(cfg['marketplace'])}</code></pre>{need_line}
<p class="note">On Windows without an SSH key for GitHub, set <code>CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1</code> first.</p>""")
        if ai.get("verdict") in ("works", "caveat"):
            zips = "".join(f'<li><a href="{e(s)}.zip">{e(s)}.zip</a></li>' for s in t["skills"])
            notes = "".join(f"<li>{e(r)}</li>" for r in ai.get("reasons", []))
            tab("ai", "claude.ai", f"""<ol><li>Download the skill: <ul>{zips}</ul></li>
<li>In claude.ai, open Customize, then Skills, and upload the zip.</li>
<li>Turn on code execution in Settings if the skill has scripts.</li></ol>
{f'<p class="note">Things to know:</p><ul class="note">{notes}</ul>' if notes else ''}""")
        else:
            why = "".join(f"<li>{e(r)}</li>" for r in ai.get("reasons", []) if "can't run" in r) or "<li>it needs programs on your own computer</li>"
            tab("ai", "claude.ai", f"<p>This one doesn't run on claude.ai, because:</p><ul>{why}</ul><p>Use Claude Code, or build your own version from the brief.</p>")
    if brief:
        prompt = f"Read {brief_url} and help me build my own version of {t['title']} for my setup. Ask me what I use first."
        tab("own", "Build your own", f"""<p>Hand the brief to your own Claude and adapt it to what you use. <a href="{e(brief)}">Read the brief</a>.</p>
<div class="copyrow"><pre class="prompt">{e(prompt)}</pre><button class="btn copy" type="button">Copy</button></div>
<p class="note copied" aria-live="polite"></p>""")
    source = f"https://github.com/{cfg['repo']}/tree/main/tools/{slug}"
    exported = snap.get("exported", "")
    body = f"""<section class="hero">
<p class="eyebrow"><a href="../">All tools</a></p>
<h1>{e(t['title'])}</h1>
<p class="lede">{e(t['summary'])}</p>
<div class="works">{chips_html(t)}</div>
</section>
<section class="media">{media_html(t)}</section>
<section class="col">
<h2>How I use it</h2>
{''.join(f'<p>{e(p)}</p>' for p in t.get('how_i_use_it', '').strip().split(chr(10) + chr(10)) if p)}
<p class="prov">{f'Snapshot of {e(exported)}. ' if exported else ''}{e(t.get('endorsement', ''))}</p>
</section>
<section class="col">
<h2>Get it</h2>
<div class="tabs" role="tablist" aria-label="Ways to get it">{''.join(tabs)}</div>
{''.join(panels)}
<p class="note"><a href="{e(source)}">Read the code on GitHub</a>{f' · <a href="{e(brief)}">Brief (Markdown)</a>' if brief else ''} · <a href="llms.txt">llms.txt</a></p>
</section>"""
    return page(f"{t['title']} · {cfg['title']}", body, 1, cfg, t["summary"])


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
