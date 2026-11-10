// stage.js: the small timing helper for a composition. Plain JavaScript, no
// dependencies. It runs the same in a browser (for a quick look) and under
// render.js (which controls the clock, so every render is identical).
//
// What it does, all from attributes in the HTML:
//   <section class="scene" data-from="0" data-to="n03">   shown between two times
//   <h1 data-at="n01+0.3">                                 gets class "in" at that time
//   <p data-at="2.5" data-out="6">                         ... and loses it again at data-out
//   <video src="clip.mp4" muted data-start="n04">         plays in step from that time
//   <div id="captions"></div>                              shows each narration line while it is spoken
//
// Times are seconds ("2.5"), or tied to the narration made by narrate.js:
//   "n03"      when line 03 starts        "n03.end"    when it ends
//   "n03+0.4"  0.4 s after it starts      "n03.end-0.2"
//   "n03:fox"  when the word "fox" is spoken in line 03 ("n03:the#2" for the second "the")
//   "end"      the end of the video
// Tying times to the narration means a changed script re-times the pictures by itself.
//
// For anything else, use stage.at(time, fn), or ordinary CSS animations,
// setTimeout and requestAnimationFrame: they all follow the video clock.

(() => {
  const root = document.documentElement;
  const lines = window.NARRATION || [];
  const byId = Object.fromEntries(lines.map((l) => [String(l.id), l]));
  const narrationEnd = window.NARRATION_END || 0;
  const norm = (w) => String(w).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

  // Length: <html data-duration>, else narration end plus data-tail (default 1.5 s).
  const tail = parseFloat(root.dataset.tail || "1.5");
  const duration = parseFloat(root.dataset.duration) || Math.round((narrationEnd + tail) * 100) / 100;
  window.VIDEO_DURATION = duration;

  function time(expr) {
    if (typeof expr === "number") return expr;
    let s = String(expr).trim();
    if (/^[0-9.]+$/.test(s)) return parseFloat(s);
    let offset = 0;
    const tail = s.match(/\s*([+-])\s*([0-9.]+)$/);
    if (tail && tail.index > 0) {
      offset = (tail[1] === "-" ? -1 : 1) * parseFloat(tail[2]);
      s = s.slice(0, tail.index);
    }
    let t;
    if (s === "end") t = duration;
    else {
      const m = s.match(/^n([\w-]+?)(?:(\.end)|:(.+?)(?:#(\d+))?)?$/);
      if (!m) throw new Error(`stage.js: can't read the time "${expr}"`);
      const line = byId[m[1]] || byId[m[1].replace(/^0+/, "")] || byId[m[1].padStart(2, "0")];
      if (!line) throw new Error(`stage.js: no narration line "${m[1]}" for the time "${expr}"`);
      if (m[2]) t = line.end;
      else if (m[3]) {
        // n04:cost = when the word "cost" is spoken in line 04; n04:the#2 = the second "the".
        const want = norm(m[3]);
        const hits = (line.words || []).filter((w) => norm(w.w) === want);
        const hit = hits[(parseInt(m[4] || "1", 10) || 1) - 1];
        if (!hit) {
          const have = line.words ? line.words.map((w) => w.w).join(" ") : "(no word times: run narrate.js with a GROQ_API_KEY)";
          throw new Error(`stage.js: no word "${m[3]}" in line ${m[1]} for the time "${expr}". Words: ${have}`);
        }
        t = line.start + hit.t;
      } else t = line.start;
    }
    return Math.max(0, t + offset);
  }

  function at(expr, fn) {
    const t = time(expr);
    if (t <= 0) fn();
    else setTimeout(fn, t * 1000);
  }

  function start() {
    for (const el of document.querySelectorAll("[data-from]")) {
      at(el.dataset.from, () => el.classList.add("on"));
      if (el.dataset.to) at(el.dataset.to, () => el.classList.remove("on"));
    }
    for (const el of document.querySelectorAll("[data-at]")) {
      at(el.dataset.at, () => el.classList.add("in"));
      if (el.dataset.out) at(el.dataset.out, () => el.classList.remove("in"));
    }
    const captions = document.getElementById("captions");
    for (const l of lines) {
      // render.js reads these <audio data-start> elements to build the sound track.
      const a = new Audio(l.file.includes("/") ? l.file : (root.dataset.audioDir || "audio") + "/" + l.file);
      a.dataset.start = l.start;
      a.dataset.role = "voice"; // tells render.js this is narration: music is lowered under it
      a.preload = "auto";
      document.body.append(a);
      if (!window.__vt) at(l.start, () => a.play().catch(() => {}));
      if (captions) {
        at(l.start, () => { captions.textContent = l.text; captions.classList.add("in"); });
        at(l.end + 0.15, () => { if (captions.textContent === l.text) captions.classList.remove("in"); });
      }
    }
  }

  // <video data-start="n04"> and <audio data-start="n02+1">: turn the time into
  // seconds now, because render.js reads data-start as a number.
  for (const el of document.querySelectorAll("video[data-start], audio[data-start]")) {
    el.dataset.start = time(el.dataset.start);
  }

  window.stage = { time, at, duration, lines };

  if (window.__vt) start();
  else {
    // In an ordinary browser, sound needs a click first.
    const go = document.createElement("button");
    go.textContent = "Play preview";
    go.style.cssText = "position:fixed;inset:0;margin:auto;width:240px;height:80px;font:600 24px system-ui;z-index:99999;cursor:pointer";
    go.onclick = () => { go.remove(); start(); };
    addEventListener("DOMContentLoaded", () => document.body.append(go));
  }
})();
