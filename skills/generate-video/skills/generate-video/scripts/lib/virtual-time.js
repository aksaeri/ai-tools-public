// Injected into the page before any of its own scripts run. It replaces the
// page's clocks with one the renderer controls, so a normal animated page
// (CSS animations, transitions, element.animate(), requestAnimationFrame,
// setTimeout, Date, performance.now) renders the same frames every time, at
// any speed. Math.random is seeded for the same reason.
//
// The renderer calls __vt.runTo(frame, fps, from) to step time forward one
// frame at a time, and takes a screenshot after each step it wants to keep.

export const VIRTUAL_TIME = `(() => {
  if (window.__vt) return;
  const R = {
    raf: window.requestAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    Date: window.Date,
  };
  const EPOCH = 1767225600000; // 2026-01-01T00:00:00Z: every render sees the same date
  let now = 0;
  let seq = 0;
  let rafs = [];
  const timers = new Map();
  const errors = [];

  window.requestAnimationFrame = (cb) => { rafs.push([++seq, cb]); return seq; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r[0] !== id); };
  window.setTimeout = (cb, ms = 0, ...a) => {
    timers.set(++seq, { at: now + Math.max(0, +ms || 0), cb, a, every: 0 });
    return seq;
  };
  window.setInterval = (cb, ms = 0, ...a) => {
    const every = Math.max(1, +ms || 0);
    timers.set(++seq, { at: now + every, cb, a, every });
    return seq;
  };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  performance.now = () => now;
  class VDate extends R.Date {
    constructor(...a) { if (a.length) super(...a); else super(EPOCH + now); }
    static now() { return EPOCH + now; }
  }
  window.Date = VDate;

  let seed = 0x9e3779b9; // mulberry32
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function run(cb, ...a) {
    try {
      if (typeof cb === "function") cb(...a);
    } catch (e) {
      errors.push(String((e && e.stack) || e));
    }
  }

  function fireTimers(until) {
    for (let guard = 0; guard < 100000; guard++) {
      let id = null, best = null;
      for (const [k, t] of timers) {
        if (t.at <= until && (best === null || t.at < best.at)) { id = k; best = t; }
      }
      if (id === null) return;
      now = Math.max(now, best.at);
      if (best.every) best.at += best.every; else timers.delete(id);
      run(best.cb, ...best.a);
    }
  }

  // CSS animations, transitions and element.animate() run on the browser's own
  // clock, which can't be replaced. So each one is paused and its position set
  // by hand: (video time now) - (video time it first appeared). One started by
  // a timer or frame callback is first seen in the same step, so it starts at 0.
  const animStart = new WeakMap();
  const finished = new WeakSet();
  function syncAnimations() {
    for (const an of document.getAnimations()) {
      if (finished.has(an)) continue;
      if (!animStart.has(an)) animStart.set(an, now);
      const local = (now - animStart.get(an)) * (an.playbackRate || 1);
      const end = an.effect ? an.effect.getComputedTiming().endTime : Infinity;
      try {
        if (Number.isFinite(end) && local >= end) {
          finished.add(an);
          an.finish(); // fires finish/animationend so code waiting on them carries on
        } else {
          an.pause();
          an.currentTime = local;
        }
      } catch (e) { /* an animation removed mid-step */ }
    }
  }

  async function syncVideos() {
    for (const v of document.querySelectorAll("video")) {
      const start = parseFloat(v.dataset.start || "0");
      const rate = parseFloat(v.dataset.rate || "1");
      let t = (now / 1000 - start) * rate;
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      if (v.loop && dur) t = ((t % dur) + dur) % dur;
      t = Math.max(0, dur ? Math.min(t, dur - 0.001) : t);
      v.pause();
      if (Math.abs(v.currentTime - t) > 0.0005 || v.readyState < 2) {
        await new Promise((res) => {
          let done = false;
          const fin = () => { if (!done) { done = true; v.removeEventListener("seeked", fin); res(); } };
          v.addEventListener("seeked", fin);
          v.currentTime = t;
          R.setTimeout(fin, 3000);
        });
      }
    }
  }

  async function step(tMs, paint) {
    fireTimers(tMs);
    now = tMs;
    const q = rafs;
    rafs = [];
    for (const [, cb] of q) run(cb, now);
    await Promise.resolve();
    syncAnimations();
    if (typeof window.seek === "function") await window.seek(now / 1000);
    if (paint) {
      await syncVideos();
      await new Promise((r) => R.raf(() => r()));
    }
  }

  window.__vt = {
    errors,
    get now() { return now; },
    step,
    // Step from frame \`from\` to \`frame\` inclusive; only the last is painted.
    async runTo(frame, fps, from) {
      for (let f = from; f <= frame; f++) await step((f * 1000) / fps, f === frame);
    },
    // Wait for fonts, images and video metadata, using the real clock.
    async ready() {
      const sleep = (ms) => new Promise((r) => R.setTimeout(r, ms));
      const all = (list) => Promise.race([Promise.all(list), sleep(15000)]);
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(15000)]);
      await all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      await all([...document.querySelectorAll("video")].map((v) => {
        v.muted = v.muted || false;
        v.pause();
        return v.readyState >= 2 ? null : new Promise((r) => { v.onloadeddata = v.onerror = r; v.load(); });
      }));
      await all([...document.querySelectorAll("audio")].map((a) => {
        a.pause();
        return a.readyState >= 1 || !a.src ? null : new Promise((r) => { a.onloadedmetadata = a.onerror = r; });
      }));
    },
  };
})();`;
