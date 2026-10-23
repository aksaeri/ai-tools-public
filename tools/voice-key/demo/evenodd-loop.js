/* Even-odd bars, looping. Self-contained: no dependencies, data inline.
 *
 * 24 bars in three directions; each pixel is coral where an odd number of bars
 * cover it, teal where even, cream where none. 22 bars show at a time. Every
 * second (at speed 1) a random bar is erased in the direction it was drawn and a
 * different missing bar draws itself in, for ever.
 *
 * Use:
 *   <div class="whatever" data-evenodd-loop data-speed="0.2"></div>
 *   <script src="evenodd-loop.js" defer></script>
 * The element gets a canvas that covers it (like background-size: cover) and a
 * small pause button. Options as data attributes:
 *   data-speed="1"        time multiplier (0.2 = five times slower)
 *   data-pause-button="0" leave out the pause button
 * Or from script: EvenOddLoop.mount(element, { speed: 0.2, pauseButton: true }).
 * Stops drawing while off screen; shows a still frame if the visitor prefers
 * reduced motion. Source: ~/projects/alg-art (hueclock.py, seed 3, light).
 */
(function () {
  const W = 1600, H = 900, KEEP = 22, SWAP_SECONDS = 1, DRAW_SECONDS = 1.8;
  const BG = '#FAFAF7', ODD = '#f66e5c', EVEN = '#17b2c7';
  // [angle in degrees, centre (distance along the bar's normal), width]
  const BARS = [[0,43.95,60],[0,493.95,110],[0,268.95,30],[0,718.95,60],[0,156.45,110],[0,606.45,30],[0,381.45,60],[0,831.45,110],
    [60,-1181.28,30],[60,-263.46,60],[60,-722.37,110],[60,195.45,30],[60,-951.83,60],[60,-34.01,110],[60,-492.92,30],[60,424.9,60],
    [120,-1817.71,110],[120,-899.89,30],[120,-1358.8,60],[120,-440.98,110],[120,-1588.26,30],[120,-670.44,60],[120,-1129.35,110],[120,-211.53,30]];

  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const rand = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const bars = BARS.map(([deg, c, w]) => {
    const a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const t = [0, W * dx, H * dy, W * dx + H * dy];
    return { c, w, dx, dy, nx, ny, tlo: Math.min(...t) - 20, thi: Math.max(...t) + 20 };
  });

  function mount(el, opts = {}) {
    const speed = +(opts.speed ?? el.dataset.speed ?? 1) || 1;
    const withButton = opts.pauseButton ?? (el.dataset.pauseButton !== '0');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.setAttribute('aria-hidden', 'true');
    // z-index 1 keeps the canvas above the host's own still (an img with a transform would otherwise paint over it)
    canvas.style.cssText = 'position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    el.prepend(canvas);
    const g = canvas.getContext('2d');
    const off = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const uni = off(), par = off(), ug = uni.getContext('2d'), pg = par.getContext('2d');

    // state: which bars are on, drawing in, or being erased
    const r = rand(17);
    const st = bars.map(() => ({ s: 'on', t: 0 }));
    const pick = pred => { const c = []; st.forEach((x, i) => pred(x, i) && c.push(i)); return c.length ? c[Math.floor(r() * c.length)] : -1; };
    for (let k = 0; k < bars.length - KEEP; k++) st[pick(x => x.s === 'on')].s = 'off';
    let acc = 0, lastOut = -1;

    function quad(ctx, b, t0, t1) {
      const p0 = b.c - b.w / 2, p1 = b.c + b.w / 2, pt = (p, t) => [b.nx * p + b.dx * t, b.ny * p + b.dy * t];
      ctx.beginPath();
      [[p0, t0], [p0, t1], [p1, t1], [p1, t0]].forEach(([p, t], i) => ctx[i ? 'lineTo' : 'moveTo'](...pt(p, t)));
      ctx.closePath(); ctx.fill();
    }
    function draw() {
      ug.clearRect(0, 0, W, H); pg.clearRect(0, 0, W, H);
      ug.fillStyle = EVEN; pg.fillStyle = ODD; pg.globalCompositeOperation = 'xor';
      st.forEach((x, i) => {
        const a = x.s === 'out' ? ease(x.t) : 0, b = x.s === 'in' ? ease(x.t) : x.s === 'off' ? 0 : 1;
        if (b <= a) return;
        const s = bars[i], span = s.thi - s.tlo;
        quad(ug, s, s.tlo + a * span, s.tlo + b * span); quad(pg, s, s.tlo + a * span, s.tlo + b * span);
      });
      pg.globalCompositeOperation = 'source-over';
      g.fillStyle = BG; g.fillRect(0, 0, W, H); g.drawImage(uni, 0, 0); g.drawImage(par, 0, 0);
    }
    function tick(dt) {
      for (const x of st) if (x.s === 'in' || x.s === 'out') { x.t += dt / DRAW_SECONDS; if (x.t >= 1) x.s = x.s === 'in' ? 'on' : 'off'; }
      acc += dt;
      while (acc >= SWAP_SECONDS) {
        acc -= SWAP_SECONDS;
        const out = pick(x => x.s === 'on'), inn = pick((x, j) => x.s === 'off' && j !== lastOut);
        if (out >= 0) { st[out] = { s: 'out', t: 0 }; lastOut = out; }
        if (inn >= 0) st[inn] = { s: 'in', t: 0 };
      }
    }

    let paused = matchMedia('(prefers-reduced-motion: reduce)').matches, visible = true, raf = 0, prev = 0;
    function frame(now) {
      raf = 0;
      if (paused || !visible) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0; prev = now;
      tick(dt * speed); draw();
      raf = requestAnimationFrame(frame);
    }
    const play = () => { if (!raf && !paused && visible) { prev = 0; raf = requestAnimationFrame(frame); } };
    new IntersectionObserver(e => { visible = e[0].isIntersecting; play(); }).observe(el);

    let btn = null;
    if (withButton) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'position:absolute;right:10px;bottom:10px;z-index:2;width:30px;height:30px;border-radius:50%;' +
        'border:0;background:rgba(27,27,34,.55);color:#fff;font:12px/30px system-ui,sans-serif;text-align:center;cursor:pointer;padding:0;';
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); paused = !paused; label(); play(); });
      el.appendChild(btn);
    }
    function label() {
      if (!btn) return;
      btn.textContent = paused ? '▶' : '❚❚';
      btn.setAttribute('aria-label', paused ? 'Play the background animation' : 'Pause the background animation');
    }
    label(); draw(); play();
    return { pause() { paused = true; label(); }, play() { paused = false; label(); play(); } };
  }

  window.EvenOddLoop = { mount };
  const auto = () => document.querySelectorAll('[data-evenodd-loop]').forEach(el => mount(el));
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', auto) : auto();
})();
