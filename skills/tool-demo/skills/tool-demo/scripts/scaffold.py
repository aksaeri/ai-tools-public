#!/usr/bin/env python3
"""Create the skeleton of a demo package for one tool.

    scaffold.py <tool> --out <folder> [--uses N] [--title T] [--audience A]
                [--look L] [--names N] [--tag T] [--dry-run]

Writes <folder>/demo/ with a rebuild brief, a page with one slot per use case,
the shared video rules with your values filled in, and one brief stub per video.
Existing files are never overwritten; they are reported as skipped.
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "references"


def page_md(tool: str, uses: int) -> str:
    parts = [f"# {tool}\n", "<What it's for, in two sentences.>\n", "## How I use it\n",
             "<Two or three sentences in the owner's own words. Ask them; never invent this.>\n",
             "## What it does\n"]
    for i in range(1, uses + 1):
        parts.append(f"### {i}. <use case {i}>\n")
        parts.append("<A concrete example: what goes in, what comes out.>\n")
        parts.append(f"[![Video, under 30 seconds: <what it shows>](video/v{i}.jpg)](video/v{i}.mp4)\n")
        parts.append(f"*Video (under 30 seconds, tap to play): <one-line caption>. Mocked up.*\n")
    parts += ["## What you need\n", "<Software, keys by name, cost per use, what it hasn't been tested on.>\n"]
    return "\n".join(parts)


def video_stub(i: int) -> str:
    return (f"Video id: v{i}. Work only in your own folder, and deliver video/v{i}.mp4 and video/v{i}.jpg.\n"
            f"First read ../VIDEO-BRIEF-COMMON.md and follow it exactly.\n\n"
            f"Topic: use case {i}, <name>.\n\n"
            "Narration (exact lines, one per line in script.txt; 3 to 5 lines, about 25 seconds):\n1. \n2. \n3. \n4. \n\n"
            "Scenes (one per line, invented data only):\n- 1: \n- 2: \n- 3: \n- 4: \n- End: the caption \"<tool>: <use case>\".\n")


def plan(a) -> dict:
    demo = Path(a.out) / "demo"
    common = (HERE / "video-brief-common.md").read_text()
    for k, v in {"{PAGE_TITLE}": a.title or a.tool, "{AUDIENCE}": a.audience, "{LOOK}": a.look,
                 "{ALLOWED_NAMES}": a.names or a.tool, "{TAG}": a.tag or a.tool}.items():
        common = common.replace(k, v)
    files = {
        demo / f"{a.tool}-brief.md": (HERE / "brief-template.md").read_text().replace("<tool>", a.tool),
        demo / "page.md": page_md(a.tool, a.uses),
        demo / "VIDEO-BRIEF-COMMON.md": common,
    }
    for i in range(1, a.uses + 1):
        files[demo / "briefs" / f"v{i}.md"] = video_stub(i).replace("<tool>", a.tool)
    return files


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("tool")
    p.add_argument("--out", required=True, help="folder to create demo/ in")
    p.add_argument("--uses", type=int, default=4, help="number of use cases, one video each (default 4)")
    p.add_argument("--title", default="", help="page title (default: the tool name)")
    p.add_argument("--audience", default="curious people who are comfortable with computers, most of them not developers")
    p.add_argument("--look", default="warm light background, one accent colour, dark terminal panels, clean mock interfaces")
    p.add_argument("--names", default="", help="product names the videos may show (default: the tool name)")
    p.add_argument("--tag", default="", help="usage-log tag prefix for paid calls (default: the tool name)")
    p.add_argument("--dry-run", action="store_true", help="list what would be written; write nothing")
    a = p.parse_args(argv)
    if not 1 <= a.uses <= 20:
        p.error("--uses must be between 1 and 20")
    files = plan(a)
    for path, text in files.items():
        if path.exists():
            print(f"skip (exists): {path}")
            continue
        if a.dry_run:
            print(f"would write: {path}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"wrote: {path}")
    if not a.dry_run:
        (Path(a.out) / "demo" / "video").mkdir(parents=True, exist_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
