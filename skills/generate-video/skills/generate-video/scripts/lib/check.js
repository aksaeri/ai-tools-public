// The checks an agent can't do by eye, because it can't watch the video:
// text that leaves the frame, is clipped by its box, sits on top of other
// text, is partly hidden behind a picture, is too small, or isn't on screen
// long enough to read.

// Page side: list every element that holds text of its own and is visible now.
export const INSPECT = `(() => {
  let nextId = 0;
  const ids = new WeakMap();
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, ++nextId); return ids.get(el); };
  window.__vtInspect = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!own.length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let opacity = 1;
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) opacity *= parseFloat(getComputedStyle(p).opacity);
      if (opacity < 0.5) continue;
      // The text itself, not its box: a wide box with short text is not a problem.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const range = document.createRange();
      for (const n of own) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (!r.width || !r.height) continue;
          x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
        }
      }
      if (!(x1 > x0 && y1 > y0)) continue;
      if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue; // wholly off screen
      // Hidden behind something opaque? Wholly (a later scene stacked on top):
      // skip it. Only at one end (a picture sitting over part of it): report it.
      const blockedAt = (px, py) => {
        const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, px)), Math.min(H - 1, Math.max(0, py)));
        if (!top || top === el || el.contains(top) || top.contains(el)) return false;
        const bg = getComputedStyle(top).backgroundColor;
        const alpha = bg.startsWith("rgba") ? parseFloat(bg.split(",")[3]) : bg === "transparent" ? 0 : 1;
        return alpha > 0.5 || ["IMG", "VIDEO", "CANVAS"].includes(top.tagName);
      };
      const midY = (y0 + y1) / 2, inset = Math.min(12, (x1 - x0) / 4);
      if (blockedAt((x0 + x1) / 2, midY)) continue;
      const covered = blockedAt(x0 + inset, midY) || blockedAt(x1 - inset, midY);
      const box = el.getBoundingClientRect();
      const scale = el.offsetHeight ? box.height / el.offsetHeight : 1;
      const anc = [];
      for (let p = el.parentElement; p; p = p.parentElement) if (ids.has(p)) anc.push(ids.get(p));
      const text = own.map((n) => n.nodeValue.trim()).join(" ").replace(/\\s+/g, " ");
      out.push({
        id: idOf(el), text: text.slice(0, 80), words: text.split(" ").filter((w) => /[\\p{L}\\p{N}]/u.test(w)).length,
        rect: [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)],
        font: Math.round(parseFloat(cs.fontSize) * scale * 10) / 10,
        clipped: (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) ||
                 (cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1),
        covered, anc,
      });
    }
    return out;
  };
})();`;

// Seconds a viewer needs for a piece of text: half a second to find it, then
// about 200 words a minute.
export function readSeconds(words) {
  return 0.5 + words * 0.3;
}

const SMALL_FONT = 0.022; // of frame height: 24 px at 1080p

function overlap(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a[2] * a[3], b[2] * b[3]);
}

// samples: [{ t, items }] at a fixed step. Returns { problems, text, ... }.
export function analyse(samples, meta, step, pageErrors = []) {
  const seen = new Map(); // id -> { text, words, first, last, shown }
  const problems = [];
  const flagged = new Set();
  const flag = (key, p) => { if (!flagged.has(key)) { flagged.add(key); problems.push(p); } };
  const t2 = (t) => Math.round(t * 100) / 100;
  let prev = new Map();
  let overlapping = new Set();

  for (const { t, items } of samples) {
    const now = new Map(items.map((i) => [i.id, i]));
    const nowOverlapping = new Set();
    for (const it of items) {
      const s = seen.get(it.id) || { text: it.text, words: 0, first: t, last: t, shown: 0 };
      s.words = Math.max(s.words, it.words);
      s.last = t;
      s.shown += step;
      seen.set(it.id, s);
      // Only judge text that is holding still: text sliding in is meant to cross the edge.
      const before = prev.get(it.id);
      const still = before && before.rect.every((v, i) => Math.abs(v - it.rect[i]) <= 1);
      if (!still) continue;
      const [x, y, w, h] = it.rect;
      if (x < -2 || y < -2 || x + w > meta.width + 2 || y + h > meta.height + 2) {
        flag(`cut:${it.id}`, { kind: "cut-off", time: t2(t), text: it.text, detail: `runs off the frame (text box ${x},${y} ${w}x${h}; frame ${meta.width}x${meta.height})` });
      }
      if (it.clipped) {
        flag(`clip:${it.id}`, { kind: "clipped", time: t2(t), text: it.text, detail: "is longer than its box and is being clipped" });
      }
      if (it.covered) {
        flag(`cover:${it.id}`, { kind: "covered", time: t2(t), text: it.text, detail: "is partly hidden behind a picture, clip or panel" });
      }
      if (it.font < meta.height * SMALL_FONT) {
        flag(`small:${it.id}`, { kind: "small-text", time: t2(t), text: it.text, detail: `is ${it.font} px tall; under ${Math.round(meta.height * SMALL_FONT)} px is hard to read on a phone` });
      }
      for (const other of items) {
        if (other.id <= it.id || it.anc.includes(other.id) || other.anc.includes(it.id)) continue;
        const ob = prev.get(other.id);
        if (!ob || !ob.rect.every((v, i) => Math.abs(v - other.rect[i]) <= 1)) continue;
        if (overlap(it.rect, other.rect) > 0.15) {
          // Two samples running: one sample can be the middle of a crossfade.
          const key = `over:${it.id}:${other.id}`;
          if (overlapping.has(key)) flag(key, { kind: "overlap", time: t2(t - step), text: it.text, detail: `overlaps "${other.text}"` });
          nowOverlapping.add(key);
        }
      }
    }
    prev = now;
    overlapping = nowOverlapping;
  }

  for (const [id, s] of seen) {
    const need = readSeconds(s.words);
    if (s.words >= 2 && s.shown + 1e-9 < need) {
      flag(`read:${id}`, {
        kind: "too-fast", time: t2(s.first), text: s.text,
        detail: `is readable for ${t2(s.shown)} s; ${s.words} words need about ${t2(need)} s`,
      });
    }
  }
  for (const e of [...new Set(pageErrors)].slice(0, 10)) {
    problems.push({ kind: "page-error", time: null, text: "", detail: String(e).split("\n")[0].slice(0, 300) });
  }
  problems.sort((a, b) => (a.time ?? -1) - (b.time ?? -1));

  const lines = problems.map((p) =>
    p.kind === "page-error" ? `  page error: ${p.detail}` : `  ${String(p.time.toFixed(2)).padStart(6)} s  ${p.kind.padEnd(10)}  "${p.text}" ${p.detail}`
  );
  const text = problems.length
    ? `${problems.length} problem${problems.length > 1 ? "s" : ""} in ${meta.duration} s (${seen.size} pieces of text checked):\n${lines.join("\n")}\n` +
      "These are measurements, not judgements: look at a frame at each time before changing anything."
    : `No layout or pacing problems found in ${meta.duration} s (${seen.size} pieces of text checked). Still look at a contact sheet: this checks text only.`;
  return { ok: problems.length === 0, duration: meta.duration, texts_checked: seen.size, problems, text };
}
