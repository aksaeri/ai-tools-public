#!/usr/bin/env python3
"""Get a YouTube video's transcript in whatever language it has.

Usage:
  youtube_transcript.py VIDEO_ID_OR_URL [--lang en,id] [--out DIR] [--no-whisper] [--max-minutes 90]

Track order: hand-made captions in a --lang language, then hand-made captions in
the video's own language, then the video's own-language automatic captions, then
automatic captions in a --lang language. Own-language automatic captions beat
YouTube's machine-translated English, which loses detail. With no captions at
all, the audio goes to Whisper through the transcribe skill (Groq), unless the
video is longer than --max-minutes or --no-whisper is set.

Prints JSON: {id, url, title, channel, minutes, language, track, source, text, path}.
source is manual | auto | whisper. The text is in the original language; translate
it yourself. Results are cached in --out (default ~/.cache/research-content/transcripts).
Errors go to stderr with a non-zero exit; nothing is silenced.
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_OUT = Path.home() / ".cache" / "research-content" / "transcripts"
TRANSCRIBE_JS = Path.home() / ".claude" / "skills" / "transcribe" / "scripts" / "transcribe.js"
NOT_CAPTIONS = {"live_chat", "rechat"}
ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/|embed/)([\w-]{11})")


def ytdlp() -> str:
    if os.environ.get("YTDLP"):
        return os.environ["YTDLP"]
    local = Path.home() / ".local" / "bin" / "yt-dlp"
    return str(local) if local.exists() else "yt-dlp"


def video_id(s: str) -> str:
    m = ID_RE.search(s)
    return m.group(1) if m else s


def _base(lang: str | None) -> str | None:
    return lang.split("-")[0].lower() if lang else None


def choose_track(info: dict, prefs: list[str]) -> tuple[str, str] | None:
    """Return (caption key, 'manual'|'auto') or None."""
    manual = [k for k in (info.get("subtitles") or {}) if k not in NOT_CAPTIONS]
    auto = list(info.get("automatic_captions") or {})
    orig = _base(info.get("language"))

    for p in prefs:
        for k in manual:
            if _base(k) == p.lower():
                return k, "manual"
    if orig:
        for k in manual:
            if _base(k) == orig:
                return k, "manual"
        for k in (f"{orig}-orig", orig):
            if k in auto:
                return k, "auto"
    for p in prefs:
        for k in (f"{p}-orig", p):
            if k in auto:
                return k, "auto"
    return None


def clean_vtt(text: str) -> str:
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if (not line or line == "WEBVTT" or "-->" in line or line.isdigit()
                or line.startswith(("Kind:", "Language:", "NOTE", "STYLE"))):
            continue
        line = html.unescape(re.sub(r"<[^>]+>", "", line)).strip()
        if line and (not out or out[-1] != line):
            out.append(line)
    return "\n".join(out)


def _fail(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 1


def _whisper(url: str, dest: Path) -> str:
    cmd = os.environ.get("TRANSCRIBE_CMD")
    base = [cmd] if cmd else ["node", str(TRANSCRIBE_JS)]
    env = {**os.environ, "PATH": f"{Path.home() / '.local' / 'bin'}:{os.environ.get('PATH', '')}"}
    r = subprocess.run(base + [url, "--no-captions", "--format=txt", f"--output={dest}"],
                       capture_output=True, text=True, timeout=1800, env=env)
    last = (r.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        res = json.loads(last)
    except json.JSONDecodeError:
        res = {}
    if r.returncode != 0 or not res.get("success"):
        raise RuntimeError(f"Whisper transcription failed: {res.get('error') or r.stderr.strip() or last}")
    return Path(res["transcript_path"]).read_text(encoding="utf-8").strip()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--lang", default="en", help="preferred caption languages, comma-separated (default en)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--no-whisper", action="store_true", help="never fall back to audio transcription")
    ap.add_argument("--max-minutes", type=float, default=90, help="longest video to send to Whisper")
    a = ap.parse_args(argv)

    vid = video_id(a.video)
    url = f"https://www.youtube.com/watch?v={vid}"
    a.out.mkdir(parents=True, exist_ok=True)
    cache = a.out / f"{vid}.transcript.json"
    if cache.exists():
        print(cache.read_text(encoding="utf-8"))
        return 0

    try:
        r = subprocess.run([ytdlp(), "-J", "--skip-download", url], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        return _fail(f"yt-dlp failed to run: {e}")
    if r.returncode != 0:
        return _fail(f"yt-dlp could not read {url}:\n{r.stderr.strip()}")
    info = json.loads(r.stdout)
    dur = info.get("duration")
    result = {"id": vid, "url": url, "title": info.get("title"),
              "channel": info.get("channel") or info.get("uploader"),
              "minutes": round(dur / 60, 1) if dur else None}

    track = choose_track(info, [p.strip() for p in a.lang.split(",") if p.strip()])
    if track:
        key, kind = track
        flag = "--write-subs" if kind == "manual" else "--write-auto-subs"
        r = subprocess.run([ytdlp(), "--skip-download", flag, "--sub-langs", key, "--sub-format", "vtt",
                            "-o", str(a.out / "%(id)s"), url], capture_output=True, text=True, timeout=180)
        vtt = a.out / f"{vid}.{key}.vtt"
        if r.returncode != 0 or not vtt.exists():
            return _fail(f"yt-dlp could not download the {key} captions:\n{r.stderr.strip()}")
        result.update(language=_base(key), track=key, source=kind,
                      text=clean_vtt(vtt.read_text(encoding="utf-8")), path=str(vtt))
    else:
        if a.no_whisper:
            return _fail(f"no captions for {url} and --no-whisper is set")
        if dur and dur / 60 > a.max_minutes:
            return _fail(f"no captions for {url}, and at {dur / 60:.0f} minutes it is over --max-minutes "
                         f"({a.max_minutes:g}); raise --max-minutes to transcribe it anyway")
        dest = a.out / f"{vid}.whisper.txt"
        try:
            text = _whisper(url, dest)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            return _fail(f"no captions for {url}, and {e}")
        result.update(language=_base(info.get("language")), track=None, source="whisper", text=text, path=str(dest))

    blob = json.dumps(result, ensure_ascii=False, indent=1)
    cache.write_text(blob, encoding="utf-8")
    print(blob)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
