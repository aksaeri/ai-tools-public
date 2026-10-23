#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""skill-release: check a skill before sharing it, then export it one way into a public repo.

Your settings live outside this tool, so nothing private ships with it. Default folder
~/.config/skill-release/ (or $SKILL_RELEASE_CONFIG, or --config):
  tools.yaml   the public repo and, per tool, where its source lives
  scrub.txt    your own patterns: hostnames, people, employers, domains (one regex per line)

Commands (all read-only except export and install-hook):
  check <tool>          dry run: what would be exported, scrub hits, Claude Code / claude.ai fit
  export <tool>         write the cleaned copy into the public repo and commit it locally
  scan [--repo PATH]    scan every tracked file in the public repo (the pre-push hook runs this)
  status                which public copies are behind their source
  install-hook          make `git push` in the public repo run scan first
"""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

# --- settings -------------------------------------------------------------------

DEFAULT_CONFIG = Path.home() / ".config" / "skill-release"

# Never exported, whatever the tool's own exclude list says.
ALWAYS_SKIP = [
    "**/__pycache__/*", "*.pyc", "**/node_modules/*", "node_modules/*", ".venv/*", "venv/*",
    ".pytest_cache/*", "*.egg-info/*", ".env", ".env.*", "*.bak", "*.bak-*", ".DS_Store",
    "Thumbs.db", "output/*", ".stfolder", ".stignore", ".git/*", "*.log",
]
ENV_EXAMPLE = ".env.example"

# Frontmatter keys Claude Code understands. Anything else moves under metadata:.
CLAUDE_CODE_KEYS = {
    "name", "description", "allowed-tools", "argument-hint", "disable-model-invocation",
    "user-invocable", "model", "context", "agent", "hooks", "license", "compatibility",
    "metadata", "when_to_use", "paths", "effort", "shell", "version",
}
# The only keys claude.ai's skill upload accepts.
CLAUDE_AI_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}

MAX_FILE_BYTES = 50 * 1024 * 1024
NAME_RE = re.compile(r"^[a-z0-9-]{1,64}$")

# Programs claude.ai's sandbox can't provide; a skill that needs one won't run there.
CLAUDE_AI_CANNOT = {
    "gws": "the gws CLI signed in to Google", "ffmpeg": "ffmpeg", "yt-dlp": "yt-dlp",
    "uv": "uv", "playwright": "a Playwright browser", "docker": "Docker", "wrangler": "Wrangler",
}
# Cowork runs skills in an isolated VM: tools signed in on your own machine aren't there,
# and other programs would have to be installed inside it.
COWORK_CANNOT = {"gws": "the gws CLI signed in to Google", "wrangler": "Wrangler signed in to Cloudflare"}
COWORK_INSTALL = {"uv": "uv", "ffmpeg": "ffmpeg", "yt-dlp": "yt-dlp", "playwright": "a Playwright browser"}
SCRIPT_RUNTIME = {".py": "Python", ".js": "Node", ".mjs": "Node", ".ts": "Node"}
# Programs worth listing as needs on any surface.
NEEDS = {"node": "Node", "npm": "npm", "python": "Python", "python3": "Python", **CLAUDE_AI_CANNOT}


@dataclass
class Tool:
    name: str
    source: Path
    path: str
    exclude: list
    rewrite: list
    allow: list
    skill: str = ""
    description: str = ""      # replaces the SKILL.md description in the public copy only
    replace: dict = field(default_factory=dict)   # relative path -> file whose content the public copy gets
    source_date: str = ""      # set by read_source: when the exported source last changed

    def __post_init__(self):
        self.skill = self.skill or self.name


@dataclass
class Config:
    dir: Path
    public_repo: Path
    author: str
    tools: dict
    scrub: list
    allow: list
    public_dir: str = "tools"   # folder in the public repo that holds one subfolder per tool


@dataclass
class Hit:
    path: str
    line: int
    kind: str
    match: str
    blocking: bool = True


@dataclass
class Report:
    tool: Tool
    ref: str
    files: dict                 # relative path -> str (text) or bytes (binary)
    hits: list = field(default_factory=list)
    assessment: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)

    @property
    def blocking(self) -> list:
        out = [f"{h.path}:{h.line} {h.kind}: {h.match}" for h in self.hits if h.blocking]
        if self.assessment.get("claude-code", {}).get("verdict") == "blocked":
            out += [f"Claude Code: {r}" for r in self.assessment["claude-code"]["reasons"]]
        return out


class Blocked(Exception):
    def __init__(self, report: Report):
        self.report = report
        super().__init__("; ".join(report.blocking))


def _expand(p) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(str(p))))


def compile_patterns(lines) -> list:
    return [re.compile(x, re.IGNORECASE) for x in lines]


def load_scrub(path: Path) -> list:
    lines = [l.strip() for l in path.read_text().splitlines()]
    return compile_patterns([l for l in lines if l and not l.startswith("#")])


def load_config(cfg_dir=None) -> Config:
    d = _expand(cfg_dir or os.environ.get("SKILL_RELEASE_CONFIG") or DEFAULT_CONFIG)
    tools_file, scrub_file = d / "tools.yaml", d / "scrub.txt"
    for f in (tools_file, scrub_file):
        if not f.exists():
            raise SystemExit(f"missing {f}. Create it first; see references/setup.md.")
    raw = yaml.safe_load(tools_file.read_text()) or {}
    tools = {}
    for name, t in (raw.get("tools") or {}).items():
        tools[name] = Tool(
            name=name, source=_expand(t["source"]), path=t.get("path", "."),
            exclude=t.get("exclude", []), rewrite=t.get("rewrite", []),
            allow=compile_patterns(t.get("allow", [])), skill=t.get("skill", ""),
            description=t.get("description", ""),
            replace={rel: _expand(src) if os.path.isabs(os.path.expanduser(str(src))) else d / src
                     for rel, src in (t.get("replace") or {}).items()},
        )
    return Config(dir=d, public_repo=_expand(raw["public_repo"]), author=raw.get("author", ""),
                  tools=tools, scrub=load_scrub(scrub_file), allow=compile_patterns(raw.get("allow", [])),
                  public_dir=raw.get("public_dir", "tools"))


# --- scanning -------------------------------------------------------------------

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
IPV4_RE = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
KEY_RE = re.compile(
    r"(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}"
    r"|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|pat[A-Za-z0-9]{14}\.[a-f0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
HOME_RE = re.compile(r"(?:/home/|/Users/|C:\\\\?Users\\\\?)([A-Za-z0-9._-]+)")
PRIVNET_RE = re.compile(r"\b[\w.-]+\.ts\.net\b")
PLACEHOLDER_USERS = {"user", "you", "username", "name", "me", "runner", "your-name", "yourname"}
SAFE_EMAIL = re.compile(r"^(no-?reply|git)@|@(users\.noreply\.github\.com|example\.(com|org|net))$", re.I)
CGNAT = ipaddress.ip_network("100.64.0.0/10")


def _generic(line: str):
    for m in EMAIL_RE.finditer(line):
        if not SAFE_EMAIL.search(m.group()):
            yield "email", m.group(), True
    for m in IPV4_RE.finditer(line):
        try:
            ip = ipaddress.ip_address(m.group())
        except ValueError:
            continue
        if ip.is_loopback or ip.is_unspecified or ip.is_reserved or ip.is_multicast or str(ip).startswith("255."):
            continue
        if ip.is_private or ip in CGNAT:
            yield "private-ip", m.group(), True
        else:
            yield "ip", m.group(), False
    for m in KEY_RE.finditer(line):
        yield "key", m.group()[:12] + "…", True
    for m in HOME_RE.finditer(line):
        if m.group(1).lower() not in PLACEHOLDER_USERS:
            yield "home-path", m.group(), True
    for m in PRIVNET_RE.finditer(line):
        yield "private-net", m.group(), True


def scan_text(path: str, text: str, scrub: list, allow: list) -> list:
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        found = [("scrub", m.group(), True) for p in scrub for m in p.finditer(line)]
        found += list(_generic(line))
        for kind, match, blocking in found:
            if any(a.search(s) for a in allow for s in _around(line, match)):
                continue
            hits.append(Hit(path, n, kind, match, blocking))
    return hits


def _around(line: str, match: str):
    # Lets an allow pattern like "MIT License" excuse the "MIT" inside it.
    i = line.find(match)
    while i != -1:
        yield line[max(0, i - 40): i + len(match) + 40]
        i = line.find(match, i + 1)


# --- frontmatter and transforms ----------------------------------------------

def _lenient_yaml(block: str) -> dict:
    """Claude Code accepts plain values containing ': ' (e.g. a description); strict YAML doesn't.
    Quote such top-level values and parse again."""
    out = []
    for line in block.splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):\s+(.*\S)\s*$", line)
        if m and not m.group(2).startswith(("'", '"', "[", "{", "|", ">", "&", "*", "!")):
            line = f"{m.group(1)}: " + json.dumps(m.group(2))
        out.append(line)
    return yaml.safe_load("\n".join(out)) or {}


def split_frontmatter(text: str):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    try:
        fm = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        fm = _lenient_yaml(text[3:end])
    body = text[end + 4:].lstrip("\n")
    return fm, body


def join_frontmatter(fm: dict, body: str) -> str:
    dumped = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True, width=1000)
    return f"---\n{dumped}---\n\n{body}"


def _move_keys(fm: dict, keep: set) -> dict:
    out, meta = {}, dict(fm.get("metadata") or {})
    for k, v in fm.items():
        if k == "metadata":
            continue
        if k in keep:
            out[k] = v
        else:
            meta[k] = v
    if meta:
        out["metadata"] = meta
    return out


def _install_path_re(skill: str):
    s = re.escape(skill)
    return re.compile(r"(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]\.claude[/\\]skills[/\\]" + s + r"(?=[/\\\s`'\")]|$)")


def transform_skill_md(text: str, skill: str, description: str = "") -> str:
    text = _install_path_re(skill).sub("${CLAUDE_SKILL_DIR}", text)
    fm, body = split_frontmatter(text)
    if not fm:
        return text
    if description:
        fm["description"] = description
    return join_frontmatter(_move_keys(fm, CLAUDE_CODE_KEYS), body)


def claude_ai_skill_md(plugin_text: str) -> str:
    text = plugin_text.replace("${CLAUDE_SKILL_DIR}/", "").replace("${CLAUDE_SKILL_DIR}", ".")
    fm, body = split_frontmatter(text)
    return join_frontmatter(_move_keys(fm, CLAUDE_AI_KEYS), body) if fm else text


# --- compatibility --------------------------------------------------------------

def _mentions(text: str, word: str) -> bool:
    return re.search(r"(?<![\w-])" + re.escape(word) + r"(?![\w-])", text) is not None


def assess(skill: str, files: dict) -> dict:
    cc = {"verdict": "works", "reasons": [], "needs": []}
    ai = {"verdict": "works", "reasons": []}
    md = files.get("SKILL.md")
    if not isinstance(md, str):
        cc.update(verdict="blocked", reasons=["no SKILL.md"])
        no_md = {"verdict": "no", "reasons": ["no SKILL.md"]}
        return {"claude-code": cc, "cowork": no_md, "claude-ai": no_md}
    try:
        fm, body = split_frontmatter(md)
    except yaml.YAMLError as e:
        cc.update(verdict="blocked", reasons=[f"SKILL.md frontmatter doesn't parse: {e}"])
        bad = {"verdict": "no", "reasons": cc["reasons"]}
        return {"claude-code": cc, "cowork": bad, "claude-ai": bad}

    name, desc = str(fm.get("name", "")), str(fm.get("description", ""))
    if name != skill or not NAME_RE.match(name):
        cc["reasons"].append(f"name '{name}' must be '{skill}': lowercase letters, digits and hyphens, 64 at most")
    if not desc:
        cc["reasons"].append("no description")
    elif len(desc) > 1024:
        cc["reasons"].append(f"description is {len(desc)} characters; Claude Code allows 1,024")
    installed = _install_path_re(skill)
    for path, content in files.items():
        if isinstance(content, str) and installed.search(content):
            cc["reasons"].append(f"{path} still refers to ~/.claude/skills/{skill}; a plugin installs elsewhere")
    if cc["reasons"]:
        cc["verdict"] = "blocked"

    # What Claude is told to run lives in SKILL.md; words inside scripts are code, not instructions.
    text = body
    needs = {label for word, label in NEEDS.items() if _mentions(text, word)}
    needs |= {SCRIPT_RUNTIME[Path(p).suffix] for p in files if Path(p).suffix in SCRIPT_RUNTIME}
    cc["needs"] = sorted(needs)

    no, caveat = [], []
    if len(desc) > 200:
        caveat.append(f"description is {len(desc)} characters; Claude chat allows 200 at most")
    for word, label in CLAUDE_AI_CANNOT.items():
        if _mentions(text, word):
            no.append(f"needs {label}, which Claude chat can't run")
    scripts = [p for p in files if not p.endswith(".md") and p not in (ENV_EXAMPLE, "LICENSE")]
    if scripts:
        caveat.append("has scripts, so code execution must be on")
        code = "\n".join(files[p] for p in scripts if isinstance(files[p], str))
        if re.search(r"https?://|\bfetch\(|\brequests\.|\burllib\b|\bhttpx\b", code):
            caveat.append("calls outside services; Claude chat's sandbox may block them")
        if re.search(r"process\.env\.|os\.environ|getenv\(", code) or ENV_EXAMPLE in files:
            caveat.append("needs your own API key or settings")
    ai["reasons"] = no + caveat
    ai["verdict"] = "no" if no else "caveat" if caveat else "works"

    # Cowork installs plugins from the same marketplace, but runs them in an isolated Linux VM:
    # nothing installed or signed in on the user's own machine is there.
    co_no, co_caveat = [], []
    for word, label in COWORK_CANNOT.items():
        if _mentions(text, word):
            co_no.append(f"needs {label}, which Cowork's virtual machine doesn't have")
    for word, label in COWORK_INSTALL.items():
        if _mentions(text, word):
            co_caveat.append(f"needs {label} installed inside Cowork's virtual machine")
    if scripts:
        code = "\n".join(files[p] for p in scripts if isinstance(files[p], str))
        if re.search(r"https?://|\bfetch\(|\brequests\.|\burllib\b|\bhttpx\b", code):
            co_caveat.append("calls outside services, so network access must be allowed for your workspace")
    co = {"verdict": "no" if co_no else "caveat" if co_caveat else "works", "reasons": co_no + co_caveat}
    return {"claude-code": cc, "cowork": co, "claude-ai": ai}


# --- reading sources ----------------------------------------------------------

def _skipped(rel: str, extra: list) -> bool:
    for pat in ALWAYS_SKIP + list(extra):
        p = pat.rstrip("/")
        if fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(rel, p + "/*") or fnmatch.fnmatch("/" + rel, "*/" + p):
            return True
        parts = rel.split("/")
        if any(fnmatch.fnmatch("/".join(parts[:i]), p) for i in range(1, len(parts))):
            return True
    return False


def _git(repo: Path, *args, binary=False):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode()


def _decode(b: bytes):
    if b"\0" in b[:8192]:
        return b
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b


def _is_git(path: Path) -> bool:
    return subprocess.run(["git", "-C", str(path), "rev-parse", "--git-dir"],
                          capture_output=True).returncode == 0


def read_source(tool: Tool):
    """Return ({relative path: content}, source ref). Git sources read HEAD, never the working tree."""
    files = {}
    if _is_git(tool.source):
        top = Path(_git(tool.source, "rev-parse", "--show-toplevel").strip())
        if subprocess.run(["git", "-C", str(top), "rev-parse", "--verify", "-q", "HEAD"],
                          capture_output=True).returncode:
            raise SystemExit(f"{top} has no commits yet. Commit the skill first; export reads committed work only.")
        prefix = (tool.source / tool.path).resolve().relative_to(top).as_posix()
        prefix = "" if prefix == "." else prefix
        listing = _git(top, "ls-tree", "-r", "--name-only", "HEAD", "--", prefix or ".").splitlines()
        for full in listing:
            rel = full[len(prefix) + 1:] if prefix else full
            if not _skipped(rel, tool.exclude):
                files[rel] = _decode(_git(top, "show", f"HEAD:{full}", binary=True))
        ref = _git(top, "log", "-1", "--format=%H", "HEAD", "--", prefix or ".").strip()
        tool.source_date = _git(top, "log", "-1", "--format=%cs", "HEAD", "--", prefix or ".").strip()
    else:
        root = (tool.source / tool.path).resolve()
        h = hashlib.sha256()
        for p in sorted(root.rglob("*")):
            rel = p.relative_to(root).as_posix()
            if p.is_dir() or p.is_symlink() or _skipped(rel, tool.exclude):
                continue
            data = p.read_bytes()
            h.update(rel.encode() + b"\0" + data)
            day = dt.date.fromtimestamp(p.stat().st_mtime).isoformat()
            tool.source_date = max(tool.source_date, day)
            files[rel] = _decode(data)
        ref = "sha256:" + h.hexdigest()
    return files, ref


# --- check and export ----------------------------------------------------------

def _apply_rewrites(text: str, rewrites: list) -> str:
    for old, new in rewrites:
        text = text.replace(old, new)
    return text


def check(cfg: Config, name: str) -> Report:
    tool = cfg.tools.get(name)
    if not tool:
        raise SystemExit(f"no tool '{name}' in {cfg.dir / 'tools.yaml'}")
    raw, ref = read_source(tool)
    for rel, src in tool.replace.items():
        if not src.exists():
            raise SystemExit(f"{name}: replacement for {rel} not found at {src}")
        raw[rel] = _decode(src.read_bytes())
    out = {}
    for rel, content in raw.items():
        if isinstance(content, str):
            content = _apply_rewrites(content, tool.rewrite)
            if rel == "SKILL.md":
                content = transform_skill_md(content, tool.skill, tool.description)
        out[rel] = content
    rep = Report(tool=tool, ref=ref, files=out)
    if _is_git(tool.source):
        dirty = _git(tool.source, "status", "--porcelain", "--", tool.path).strip()
        if dirty:
            rep.notes.append("the source has uncommitted changes; they are not included (export reads HEAD)")
    allow = cfg.allow + tool.allow
    for rel, content in out.items():
        rep.hits += [Hit(rel, 0, "scrub-in-filename", m.group()) for p in cfg.scrub for m in p.finditer(rel)]
        if isinstance(content, str):
            rep.hits += scan_text(rel, content, cfg.scrub, allow)
        else:
            rep.notes.append(f"{rel}: binary file, check it by eye")
        if not isinstance(content, str) and len(content) > MAX_FILE_BYTES:
            rep.hits.append(Hit(rel, 0, "too-large", f"{len(content) // 1_000_000} MB"))
    rep.assessment = assess(tool.skill, out)
    return rep


def _first_sentence(desc: str) -> str:
    s = re.split(r"(?<=[.!?])\s", desc.strip(), maxsplit=1)[0]
    return s if len(s) <= 200 else s[:197].rstrip() + "…"


def export(cfg: Config, name: str, commit: bool = True) -> Report:
    rep = check(cfg, name)
    if rep.blocking:
        raise Blocked(rep)
    tool = rep.tool
    root = cfg.public_repo / cfg.public_dir / tool.name
    skill_dir = root / "skills" / tool.skill
    if skill_dir.exists():
        shutil.rmtree(skill_dir)
    for rel, content in rep.files.items():
        dest = skill_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            dest.write_text(content)
        else:
            dest.write_bytes(content)
        src_mode = (tool.source / tool.path / rel)
        if src_mode.exists() and os.access(src_mode, os.X_OK):
            dest.chmod(0o755)

    fm, _ = split_frontmatter(rep.files["SKILL.md"])
    desc = _first_sentence(str(fm.get("description", "")))
    tool_yaml = root / "tool.yaml"
    summary = (yaml.safe_load(tool_yaml.read_text()) or {}).get("summary") if tool_yaml.exists() else None
    plugin = {"name": tool.name, "description": summary or desc}
    if cfg.author:
        plugin["author"] = {"name": cfg.author}
    (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (root / ".claude-plugin" / "plugin.json").write_text(json.dumps(plugin, indent=2, ensure_ascii=False) + "\n")
    snap = {"source_ref": rep.ref, "source_date": tool.source_date, "exported": dt.date.today().isoformat(),
            "surfaces": rep.assessment}
    (root / "snapshot.json").write_text(json.dumps(snap, indent=2, ensure_ascii=False) + "\n")
    if not (root / "tool.yaml").exists():
        (root / "tool.yaml").write_text(yaml.safe_dump({
            "title": tool.name, "summary": desc,
            "how_i_use_it": "TODO: a paragraph in the author's own words.",
            "endorsement": (fm.get("metadata") or {}).get("provenance", {}).get("endorsement", ""),
            "media": [], "brief": "",
        }, sort_keys=False, width=1000))

    if commit:
        _git(cfg.public_repo, "add", "-A", "--", f"{cfg.public_dir}/{tool.name}")
        if subprocess.run(["git", "-C", str(cfg.public_repo), "diff", "--cached", "--quiet"]).returncode:
            _git(cfg.public_repo, "commit", "-q", "-m", f"Export {tool.name} ({rep.ref.split(':')[-1][:12]})")
    return rep


def status(cfg: Config) -> dict:
    out = {}
    for name, tool in cfg.tools.items():
        snap_file = cfg.public_repo / cfg.public_dir / name / "snapshot.json"
        if not snap_file.exists():
            out[name] = "not exported"
            continue
        _, ref = read_source(tool)
        out[name] = "current" if json.loads(snap_file.read_text())["source_ref"] == ref else "behind"
    return out


def scan_repo(cfg: Config, repo: Path) -> list:
    allow = cfg.allow + [a for t in cfg.tools.values() for a in t.allow]
    hits = []
    for rel in _git(repo, "ls-files", "-z").split("\0"):
        p = repo / rel
        if not rel or not p.is_file():
            continue
        content = _decode(p.read_bytes())
        if isinstance(content, str):
            hits += scan_text(rel, content, cfg.scrub, allow)
    return hits


HOOK = """#!/bin/sh
# Installed by skill-release. Blocks a push if any tracked file matches your scrub list
# or looks private (emails, private IPs, keys, home paths).
exec uv run --quiet {script} --config {cfg} scan --repo "$(git rev-parse --show-toplevel)"
"""


def install_hook(cfg: Config) -> Path:
    hook = cfg.public_repo / ".git" / "hooks" / "pre-push"
    hook.write_text(HOOK.format(script=Path(__file__).resolve(), cfg=cfg.dir))
    hook.chmod(0o755)
    return hook


# --- CLI ------------------------------------------------------------------------

def _print_report(rep: Report):
    print(f"{rep.tool.name}: {len(rep.files)} files from {rep.tool.source / rep.tool.path}")
    print(f"  source ref {rep.ref[:19]}")
    for rel in sorted(rep.files):
        print(f"    {rel}")
    if rep.hits:
        print("  findings:")
        for h in rep.hits:
            flag = "BLOCK" if h.blocking else "check"
            print(f"    {flag}  {h.path}:{h.line}  {h.kind}  {h.match}")
    for n in rep.notes:
        print(f"  note: {n}")
    for surface, a in rep.assessment.items():
        print(f"  {surface}: {a['verdict']}")
        for r in a["reasons"]:
            print(f"    - {r}")
        if a.get("needs"):
            print(f"    needs: {', '.join(a['needs'])}")
    print("  result:", "BLOCKED" if rep.blocking else "ready to export")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="settings folder (default ~/.config/skill-release)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("check", "export"):
        s = sub.add_parser(c)
        s.add_argument("tool")
    sub.choices["export"].add_argument("--no-commit", action="store_true")
    sub.add_parser("scan").add_argument("--repo")
    sub.add_parser("status")
    sub.add_parser("install-hook")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)

    if args.cmd == "check":
        rep = check(cfg, args.tool)
        _print_report(rep)
        return 1 if rep.blocking else 0
    if args.cmd == "export":
        try:
            rep = export(cfg, args.tool, commit=not args.no_commit)
        except Blocked as e:
            _print_report(e.report)
            print("\nNothing was written.")
            return 1
        _print_report(rep)
        print(f"\nExported to {cfg.public_repo / cfg.public_dir / args.tool}" + ("" if args.no_commit else " and committed locally. Nothing is pushed."))
        return 0
    if args.cmd == "scan":
        repo = _expand(args.repo) if args.repo else cfg.public_repo
        hits = scan_repo(cfg, repo)
        for h in hits:
            print(f"{'BLOCK' if h.blocking else 'check'}  {h.path}:{h.line}  {h.kind}  {h.match}")
        blocking = [h for h in hits if h.blocking]
        print(f"{len(blocking)} blocking finding(s) in {repo}" + ("; push stopped." if blocking else "."))
        return 1 if blocking else 0
    if args.cmd == "status":
        for name, s in status(cfg).items():
            print(f"{name:28} {s}")
        return 0
    if args.cmd == "install-hook":
        print(f"installed {install_hook(cfg)}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
