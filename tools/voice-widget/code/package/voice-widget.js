/* voice-widget v1: a mic button for any text box. Speech goes to Groq Whisper through
 * our relay; the text lands in the box. One file, no dependencies, no build step.
 *
 *   <script src="https://voice.aksaeri.com/v1/voice-widget.js" data-deployment="demo" defer></script>
 *   <textarea data-voice></textarea>
 *
 * Options and manual API: package/README.md. Contract: docs/specs/2026-11-06-v1-relay-and-package.md.
 */
(function () {
  'use strict';
  if (window.VoiceWidget && window.VoiceWidget.version) return;   // loaded twice: keep the first

  var script = document.currentScript;
  var sd = (script && script.dataset) || {};

  // Relay base URL defaults to the folder above /v1/ in this script's URL, so a copy
  // served under a path prefix (a local dev server) talks to its own relay.
  function baseOf(url) {
    var u = new URL(url, location.href);
    var m = /^(.*\/)v1\/[^/]*$/.exec(u.pathname);
    return u.origin + (m ? m[1] : '/');
  }
  function flag(v) { return v === '' || v === 'true' || v === '1'; }
  function slash(u) { u = new URL(u, location.href).href; return /\/$/.test(u) ? u : u + '/'; }

  var DEF = {
    deployment: sd.deployment || '',
    endpoint: sd.endpoint ? slash(sd.endpoint) : baseOf((script && script.src) || location.href),
    notice: sd.notice != null ? sd.notice : 'Your voice is sent to Groq to turn it into text. Nothing is stored.',
    label: sd.label || 'Speak your answer',
    maxSeconds: +sd.maxSeconds > 0 ? +sd.maxSeconds : 90,
    position: sd.position === 'inline' ? 'inline' : 'below',
    size: sd.size === 'small' ? 'small' : 'normal',
    buttonStyle: sd.buttonStyle === 'outline' ? 'outline' : 'filled',   // data-button-style
    colorScheme: /^(light|dark)$/.test(sd.colorScheme || '') ? sd.colorScheme : 'auto',  // data-color-scheme
    hint: sd.hint != null ? sd.hint : null,  // idle instruction; '' hides it, null = default
    accent: sd.accent || '',          // button colour, e.g. '#17879B'
    accentDark: sd.accentDark || '',  // button colour in dark mode (defaults to accent)
    iconOnly: flag(sd.iconOnly),      // data-icon-only: show only the icon (aria-label keeps the words)
    cancelButton: flag(sd.cancelButton),  // data-cancel-button: a Cancel button while recording
    usedLabel: sd.usedLabel != null ? sd.usedLabel : 'Add more by voice',  // '' keeps the first label
    doneMessage: sd.doneMessage != null ? sd.doneMessage : null,          // '' = no success message
    lang: sd.lang || 'en',            // reserved: v1 is English only
    onTranscript: null
  };
  var DEBUG = sd.debug === '1';

  // ---------------------------------------------------------------- words
  var PRESS = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Press';
  var T = {
    idle: PRESS + ' the button and talk. ' + PRESS + ' Stop when you’re done.',
    starting: 'Starting the microphone…',
    listening: 'Listening…',
    sending: 'Turning speech into text…',
    added: 'Added to your answer. You can edit it.',
    addedMax: function (s) { return 'Added to your answer. Recordings stop after ' + s + ' seconds, so ' + PRESS.toLowerCase() + ' the button again to keep going.'; },
    cancelled: 'Recording cancelled.',
    maxNote: function (s) { return 'Recordings stop after ' + s + ' seconds, so ' + PRESS.toLowerCase() + ' the button again to keep going.'; },
    short: 'That was too short to hear. ' + PRESS + ' the button, talk, then ' + PRESS.toLowerCase() + ' Stop.',
    nothing: 'No words came through. Please try again, a little closer to the microphone.',
    closed: 'Voice typing has closed for this survey. You can still type your answer.',
    notSetUp: 'Voice typing isn’t set up for this page.',
    wait: 'Please wait a moment and try again.',
    tooLong: function (s) { return 'That recording was too long. Please keep each one under ' + s + ' seconds.'; },
    failed: 'Something went wrong turning your speech into text. Please try again, or type your answer.',
    offline: 'Couldn’t reach voice typing. Check your internet connection and try again.',
    denied: 'Your browser blocked the microphone. To use voice typing, allow the microphone for this site (usually through an icon in the address bar), then ' + PRESS.toLowerCase() + ' the button again.',
    noMic: 'No microphone was found. You can type your answer instead.',
    busy: 'Another app is using your microphone. Close it and try again.',
    unsupported: 'Voice typing doesn’t work in this browser. You can type your answer instead.',
    stopsAt: function (s) { return 'Recording stops at ' + fmt(s) + '.'; }
  };
  // Relay error code -> [message key, closes the deployment for every box on the page]
  var ERR = {
    budget_exhausted: ['closed', 1], inactive: ['closed', 1],
    origin_not_allowed: ['notSetUp', 1], unknown_deployment: ['notSetUp', 1],
    rate_limited: ['wait'], too_long: ['tooLong'], empty: ['nothing'], upstream_error: ['failed']
  };

  function warn() { try { console.warn.apply(console, ['[voice-widget]'].concat([].slice.call(arguments))); } catch (e) {} }

  // ---------------------------------------------------------------- relay calls
  function api(o, path, init) {
    return fetch(o.endpoint + 'v1/' + path + '?d=' + encodeURIComponent(o.deployment), init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j = j && typeof j === 'object' ? j : {};
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  var statusCache = {};   // endpoint|deployment -> Promise<{show, msg}>
  var closed = {};        // endpoint|deployment -> message, once the relay has said no
  function keyOf(o) { return o.endpoint + '|' + o.deployment; }

  function checkStatus(o) {
    var k = keyOf(o);
    if (statusCache[k]) return statusCache[k];
    function once() { return api(o, 'status', { method: 'GET', cache: 'no-store', credentials: 'omit' }); }
    statusCache[k] = once().catch(function () {
      return new Promise(function (res) { setTimeout(res, 2000); }).then(once);   // one retry
    }).then(function (r) {
      if (r.ok) {
        if (r.body.available === false) { warn('deployment "' + o.deployment + '" is not available (closed or out of budget); hiding the button.'); return { show: false }; }
        return { show: true };
      }
      var e = ERR[r.body.error];
      if (e && e[1]) { warn('status ' + r.status + ' ' + r.body.error + ' for deployment "' + o.deployment + '"'); return { show: true, msg: T[e[0]] }; }
      return { show: true };      // relay hiccup: let them try; send() reports any real error
    }, function () {
      // Network failure, or the relay refused this origin (CORS refusals look the same).
      warn('could not reach ' + o.endpoint + 'v1/status for deployment "' + o.deployment + '". Check the deployment name, and that ' +
        location.origin + ' is in its allowed_origins. Hiding the button.');
      return { show: false };
    });
    return statusCache[k];
  }

  // ---------------------------------------------------------------- recorder
  function codeErr(code) { var e = new Error(code); e.code = code; return e; }
  function pickMime() {
    var prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < prefs.length; i++) { try { if (MediaRecorder.isTypeSupported(prefs[i])) return prefs[i]; } catch (e) {} }
    return '';
  }

  class Rec {
    constructor(onTick) { this.onTick = onTick; this.dead = false; }
    get elapsed() { return this.t0 ? ((this.t1 || performance.now()) - this.t0) / 1000 : 0; }
    async start() {
      var md = navigator.mediaDevices;
      if (!md || !md.getUserMedia || typeof MediaRecorder === 'undefined') throw codeErr('unsupported');
      var AC = window.AudioContext || window.webkitAudioContext;
      try { this.ctx = AC ? new AC() : null; } catch (e) { this.ctx = null; }  // before any await (iOS)
      try {
        this.stream = await md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        this.release();
        var n = e && e.name;
        throw codeErr(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'noMic'
          : n === 'NotReadableError' || n === 'AbortError' ? 'busy' : 'unsupported');
      }
      if (this.dead) { this.release(); throw codeErr('aborted'); }
      var an = null, buf = null;
      if (this.ctx) {
        try {
          this.ctx.resume && this.ctx.resume().catch(function () {});
          an = this.ctx.createAnalyser(); an.fftSize = 1024;
          this.ctx.createMediaStreamSource(this.stream).connect(an);
          buf = new Float32Array(an.fftSize);
        } catch (e) { an = null; }
      }
      var mime = pickMime();
      this.chunks = [];
      this.mr = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
      var self = this;
      this.mr.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
      this.mr.start(1000);
      this.t0 = performance.now();
      (function tick() {
        if (!self.stream || self.t1) return;
        var level = 0;
        if (an) {
          an.getFloatTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          level = Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9) + 60) / 50));
        }
        try { self.onTick(level, self.elapsed); } catch (e) {}
        self.timer = setTimeout(tick, 60);
      })();
    }
    stop() {
      var self = this, mr = this.mr;
      if (!mr) return Promise.reject(codeErr('aborted'));
      this.t1 = performance.now();
      return new Promise(function (res) {
        mr.onstop = res;
        if (mr.state !== 'inactive') mr.stop(); else res();
      }).then(function () {
        var type = (mr.mimeType || (self.chunks[0] && self.chunks[0].type) || 'audio/webm').split(';')[0];
        var blob = new Blob(self.chunks, { type: type });
        self.release();
        return { blob: blob, seconds: (self.t1 - self.t0) / 1000 };
      });
    }
    cancel() {
      this.dead = true;
      try { if (this.mr && this.mr.state !== 'inactive') { this.mr.onstop = null; this.mr.stop(); } } catch (e) {}
      this.release();
    }
    release() {
      clearTimeout(this.timer);
      if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
      if (this.ctx && this.ctx.close) this.ctx.close().catch(function () {});
      this.ctx = null;
    }
  }

  // ---------------------------------------------------------------- text insertion
  // Native prototype setter + bubbling input/change: React/Vue-controlled fields see it.
  function setNative(el, v) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
  }
  function fire(el, type, data) {
    var ev;
    try { ev = type === 'input' ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: data }) : new Event(type, { bubbles: true }); }
    catch (e) { ev = document.createEvent('Event'); ev.initEvent(type, true, false); }
    el.dispatchEvent(ev);
  }
  // at = {s, e, v} caret captured when the box had focus as recording started, or null (append).
  function insertText(el, text, at) {
    var v = el.value || '';
    var s = v.length, e = v.length;
    if (at && at.v === v && typeof at.s === 'number') { s = at.s; e = at.e; }   // box unchanged since: use caret
    var before = v.slice(0, s), after = v.slice(e);
    var ins = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '');
    var nv = before + ins + after;
    if (el.maxLength > 0 && nv.length > el.maxLength) nv = nv.slice(0, el.maxLength);
    setNative(el, nv);
    fire(el, 'input', text);
    fire(el, 'change');
    return Math.min(nv.length, (before + ins).length);
  }

  // ---------------------------------------------------------------- UI
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    '.vw{--ac:var(--vw-accent,#2f5d50);--acf:var(--vw-accent-text,#fff);--rc:var(--vw-record,#b3261e);--rcf:var(--vw-record-text,#fff);--fo:var(--vw-focus,#1a73e8);' +
      '--bg:var(--vw-button-bg,var(--ac));--fg:var(--vw-button-text,var(--acf));--bd:var(--vw-button-border,0 solid transparent);--rad:var(--vw-radius,999px);font-family:inherit;font-size:15px;line-height:1.4;color:inherit;margin:0;padding:0;max-width:100%}',
    '.row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px}',
    '.mic{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;min-width:44px;margin:0;padding:0 18px 0 14px;border:var(--bd);border-radius:var(--rad);' +
      'background:var(--bg);color:var(--fg);font-family:inherit;font-size:16px;font-weight:600;line-height:1.2;text-transform:none;letter-spacing:normal;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-appearance:none;appearance:none}',
    '.mic:hover{filter:brightness(1.08)}',
    '.mic:focus-visible{outline:3px solid var(--fo);outline-offset:2px}',
    '.mic:disabled{opacity:.55;cursor:default;filter:none}',
    '.i,.sp{width:20px;height:20px;flex:none;fill:currentColor}',
    '.is,.sp,.rec{display:none}',
    '[data-state=rec] .mic{background:var(--rc);color:var(--rcf);border-color:var(--rc)}',
    '.io .lb{display:none}',
    '.io .mic{padding:0;gap:0}',
    '.cx{display:none;align-items:center;justify-content:center;gap:6px;min-height:inherit;margin:0;padding:0 14px;border:1px solid currentColor;border-radius:var(--rad);' +
      'background:transparent;color:inherit;opacity:.8;font:inherit;font-size:14px;font-weight:600;line-height:1.2;cursor:pointer;-webkit-appearance:none;appearance:none}',
    '.cx:hover{opacity:1}',
    '.cx:focus-visible{outline:3px solid var(--fo);outline-offset:2px}',
    '.cx svg{width:16px;height:16px;fill:currentColor;flex:none}',
    '.io .cx{padding:0;min-width:inherit}',
    '.io .cx .cl{display:none}',
    '[data-state=rec] .cx,[data-state=start] .cx{display:inline-flex}',
    '.ol{--bg:var(--vw-button-bg,transparent);--fg:var(--vw-button-text,var(--ac));--bd:var(--vw-button-border,1.5px solid var(--ac))}',
    '.ol .mic:hover{filter:none;background:color-mix(in srgb,var(--ac) 8%,var(--vw-button-bg,transparent))}',
    '.ol[data-state=rec] .mic:hover{background:var(--rc)}',
    '[data-state=rec] .im,[data-state=send] .im,[data-state=start] .im{display:none}',
    '[data-state=rec] .is{display:block}',
    '[data-state=send] .sp,[data-state=start] .sp{display:block}',
    '[data-state=rec] .rec{display:inline-flex;align-items:center;gap:8px}',
    '.sp{border:3px solid currentColor;border-right-color:transparent;border-radius:50%;animation:vwspin .9s linear infinite}',
    '@keyframes vwspin{to{transform:rotate(360deg)}}',
    '.tm{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.warn .tm{font-weight:700}',
    '.mt{display:inline-block;width:56px;height:6px;border-radius:3px;background:rgba(128,128,128,.3);overflow:hidden}',
    '.mf{display:block;height:100%;width:0;background:var(--rc);transition:width 60ms linear}',
    '.msg{flex:1 1 14em;min-width:0}',
    '.msg:empty{display:none}',
    '[data-err] .msg{border-left:3px solid var(--rc);padding-left:8px;font-weight:600}',
    '.nt{margin-top:4px;font-size:13px;opacity:.75}',
    '.nt:empty{display:none}',
    '@media (prefers-reduced-motion:reduce){.sp{animation:none;border-right-color:currentColor;opacity:.6}.mf{transition:none}}'
  ].join('\n');

  var DARK = '.vw{--ac:var(--vw-accent-dark,#8cc5b2);--acf:var(--vw-accent-text-dark,#10221c);--rc:var(--vw-record-dark,#f2b8b5);' +
    '--rcf:var(--vw-record-text-dark,#410e0b);--fo:var(--vw-focus-dark,#8ab4f8)}';

  var HTML =
    '<div class="vw" part="root" data-state="idle"><div class="row">' +
    '<button class="mic" part="button" type="button">' +
    '<svg class="i im" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>' +
    '<svg class="i is" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' +
    '<span class="sp" aria-hidden="true"></span><span class="lb" part="label"></span></button>' +
    '<button class="cx" part="cancel" type="button" aria-label="Cancel recording">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"/></svg>' +
    '<span class="cl">Cancel</span></button>' +
    '<span class="rec" aria-hidden="true"><span class="tm" part="timer">0:00</span><span class="mt"><span class="mf"></span></span></span>' +
    '<span class="msg" part="message" role="status" aria-live="polite"></span>' +
    '</div><div class="nt" part="notice"></div></div>';

  var instances = [];
  var byEl = new WeakMap();
  var current = null;         // the widget that is recording, if any

  function fmt(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  class Widget {
    constructor(el, o) {
      this.el = el; this.o = o; this.state = 'idle'; this.used = false; this.caret = null; this.at = null;
      var host = this.host = document.createElement('voice-widget');
      // Inline so no page rule can outrank it: reset everything, then only what we need.
      // Text colour and font follow the page live (light or dark); the button has its own colours.
      host.setAttribute('style', 'all:initial;color:inherit;font-family:inherit;display:none;max-width:100%;vertical-align:middle;' +
        (o.position === 'inline' ? 'margin:0 0 0 8px' : 'margin:6px 0 0'));
      var root = this.root = host.attachShadow({ mode: 'open' });
      var safe = function (c) { return /^#[0-9a-f]{3,8}$|^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(c || '') ? c : ''; };
      var acc = safe(o.accent), accD = safe(o.accentDark);
      // A custom accent applies in both modes with white text, unless a dark one is given.
      var extra = (o.colorScheme === 'dark' ? DARK : o.colorScheme === 'auto' ? '@media (prefers-color-scheme:dark){' + DARK + '}' : '') +
        (acc ? '.vw{--ac:' + acc + ';--acf:#fff}' : '') +
        (accD ? '@media (prefers-color-scheme:dark){.vw{--ac:' + accD + '}}' : '') +
        // Small: a quieter button that still meets the 24 px minimum touch target (WCAG 2.2).
        (o.size === 'small' ? '.vw{font-size:13px}.mic{min-height:34px;min-width:34px;padding:0 13px 0 10px;font-size:14px;gap:6px}' +
          '.i,.sp{width:16px;height:16px}.nt{font-size:12px}.cx{min-height:34px}.io .cx{min-width:34px}' : '') +
        (o.size !== 'small' ? '.cx{min-height:44px}.io .cx{min-width:44px}' : '');
      root.innerHTML = '<style>' + CSS + extra + '</style>' + HTML;
      var q = function (s) { return root.querySelector(s); };
      this.vw = q('.vw');
      if (o.buttonStyle === 'outline') this.vw.classList.add('ol');
      if (o.iconOnly) this.vw.classList.add('io');
      this.cx = q('.cx');
      if (!o.cancelButton) { this.cx.remove(); this.cx = null; } this.btn = q('.mic'); this.lb = q('.lb'); this.msg = q('.msg');
      this.tm = q('.tm'); this.mf = q('.mf'); this.nt = q('.nt');
      this.nt.textContent = o.notice || '';
      var self = this;
      this.btn.addEventListener('pointerdown', function () { if (self.focused()) self.memo(); });
      this.btn.addEventListener('focus', function (e) { if (e.relatedTarget === el) self.memo(); });
      this.btn.addEventListener('click', function () { self.toggle(); });
      if (this.cx) this.cx.addEventListener('click', function () { if (self.state === 'rec' || self.state === 'start') { self.cancel(); self.btn.focus(); } });
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (self.state === 'rec' || self.state === 'start')) { e.preventDefault(); self.cancel(); } });
      el.insertAdjacentElement('afterend', host);
      this.set('idle', o.hint != null ? o.hint : T.idle);
      checkStatus(o).then(function (st) {
        if (!self.host.isConnected && !self.el.isConnected) return;
        if (!st.show) return;
        host.style.display = o.position === 'inline' ? 'inline-block' : 'block';
        if (st.msg) self.close(st.msg);
        else if (closed[keyOf(o)]) self.close(closed[keyOf(o)]);
      });
    }

    focused() {
      var a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a === this.el;
    }
    memo() {
      try { this.caret = { s: this.el.selectionStart, e: this.el.selectionEnd, v: this.el.value }; } catch (e) { this.caret = null; }
    }
    set(state, text, isErr) {
      var prev = this.state;
      this.state = state;
      this.vw.setAttribute('data-state', state);
      if (isErr) this.vw.setAttribute('data-err', ''); else this.vw.removeAttribute('data-err');
      this.vw.classList.remove('warn');
      this.msg.textContent = text || '';
      this.btn.disabled = state === 'send' || state === 'off';
      var idleLabel = this.used && this.o.usedLabel ? this.o.usedLabel : this.o.label;
      var lb = { rec: 'Stop', send: 'Writing…', start: 'Starting…' }[state] || idleLabel;
      var aria = { rec: 'Stop recording and add the text', send: 'Writing… please wait', start: 'Starting… press to cancel' }[state] || idleLabel + ' (voice typing)';
      this.lb.textContent = lb;
      this.btn.setAttribute('aria-label', aria);
      if (this.o.iconOnly) this.btn.title = aria; else this.btn.removeAttribute('title');
      if (state !== prev) {
        try { this.el.dispatchEvent(new CustomEvent('voicewidget:state', { bubbles: true, detail: { state: state, previous: prev, element: this.el } })); } catch (e) {}
      }
    }
    close(text) {
      if (this.rec) { this.rec.cancel(); this.rec = null; if (current === this) current = null; }
      this.set('off', text, true);
    }

    toggle() {
      if (this.state === 'rec') this.stop();
      else if (this.state === 'start') this.cancel();
      else if (this.state === 'idle' || this.state === 'err') this.start();
    }

    async start() {
      if (current && current !== this) { if (current.state === 'start') current.cancel(); else current.stop(); }
      current = this;
      this.at = this.caret; this.caret = null;
      this.autoStopped = false; this.warned = false;
      this.set('start', T.starting);
      var self = this, max = this.o.maxSeconds;
      var rec = this.rec = new Rec(function (level, t) {
        self.mf.style.width = Math.round(level * 100) + '%';
        var left = Math.ceil(max - t);
        self.tm.textContent = fmt(t) + (left <= 10 ? ' · stops in ' + Math.max(0, left) + ' s' : '');
        if (left <= 10 && !self.warned) { self.warned = true; self.vw.classList.add('warn'); self.msg.textContent = T.stopsAt(max); }
        if (t >= max && self.state === 'rec') { self.autoStopped = true; self.stop(); }
      });
      try {
        await rec.start();
      } catch (e) {
        if (this.rec !== rec) return;           // cancelled while asking for the mic
        this.rec = null; if (current === this) current = null;
        if (e.code === 'unsupported' && !window.isSecureContext) warn('the microphone needs an https page.');
        return this.set('err', T[e.code] || T.unsupported, true);
      }
      if (this.rec !== rec) return;
      this.tm.textContent = '0:00';
      this.set('rec', T.listening);
    }

    cancel() {
      if (this.rec) this.rec.cancel();
      this.rec = null; if (current === this) current = null;
      this.set('idle', T.cancelled);
    }

    async stop() {
      var rec = this.rec;
      if (!rec || this.state !== 'rec') return;
      this.rec = null; if (current === this) current = null;
      this.set('send', T.sending);
      var r;
      try { r = await rec.stop(); } catch (e) { return this.set('err', T.failed, true); }
      if (r.seconds < 0.6 || r.blob.size < 400) return this.set('idle', T.short);
      return this.send(r.blob, Math.min(r.seconds, this.o.maxSeconds));
    }

    // The normal send path: POST the audio, insert the text, report errors in plain words.
    async send(blob, seconds) {
      var o = this.o, k = keyOf(o);
      if (closed[k]) { this.close(closed[k]); return ''; }
      this.set('send', T.sending);
      var headers = { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] };
      if (seconds > 0) headers['X-Audio-Seconds'] = seconds.toFixed(1);
      var r;
      try {
        r = await api(o, 'transcribe', { method: 'POST', body: blob, headers: headers, credentials: 'omit' });
      } catch (e) {
        this.set('err', T.offline, true); return '';
      }
      if (!r.ok) {
        var e = ERR[r.body.error] || ['failed'];
        var text = typeof T[e[0]] === 'function' ? T[e[0]](o.maxSeconds) : T[e[0]];
        if (e[1]) {
          closed[k] = text;
          instances.forEach(function (w) { if (keyOf(w.o) === k) w.close(text); });
        } else this.set('err', text, true);
        return '';
      }
      var out = String(r.body.text || '').trim();
      if (!out) { this.set('idle', T.nothing); return ''; }
      var el = this.el;
      if (el.disabled || el.readOnly || !el.isConnected) { this.set('idle', ''); return ''; }
      var wasFocused = !!this.at;
      var pos = insertText(el, out, this.at);
      this.at = null;
      if (wasFocused) { try { el.focus(); el.setSelectionRange(pos, pos); } catch (err) {} }
      this.used = true;
      var done = o.doneMessage != null ? o.doneMessage : T.added;
      this.set('idle', this.autoStopped ? (o.doneMessage === '' ? T.maxNote(o.maxSeconds) : T.addedMax(o.maxSeconds)) : done);
      var detail = { text: out, seconds: r.body.seconds, element: el };
      try { el.dispatchEvent(new CustomEvent('voicewidget:transcript', { bubbles: true, detail: detail })); } catch (err) {}
      if (typeof o.onTranscript === 'function') { try { o.onTranscript(out, detail); } catch (err) { warn('onTranscript threw', err); } }
      return out;
    }

    detach() {
      if (this.rec) { this.rec.cancel(); this.rec = null; }
      if (current === this) current = null;
      this.host.remove();
      byEl.delete(this.el);
      var i = instances.indexOf(this);
      if (i >= 0) instances.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- attach / auto-attach
  function supported(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|search|)$/.test((el.getAttribute('type') || '').toLowerCase());
  }

  function attach(el, opts) {
    if (!supported(el)) {
      warn('attach() needs a <textarea> or <input type="text">; contenteditable and other fields are not supported in v1.', el);
      return null;
    }
    var existing = byEl.get(el);
    if (existing) return existing.handle;
    var o = {};
    for (var k in DEF) o[k] = DEF[k];
    for (k in (opts || {})) if (opts[k] !== undefined) o[k] = opts[k];
    o.endpoint = slash(o.endpoint);
    o.maxSeconds = +o.maxSeconds > 0 ? +o.maxSeconds : 90;
    if (!o.deployment) { warn('no deployment given (data-deployment on the script tag, or {deployment} in attach()).'); return null; }
    var w = new Widget(el, o);
    w.handle = {
      element: el,
      get state() { return w.state; },        // idle | start | rec | send | err | off
      cancel: function () { if (w.state === 'rec' || w.state === 'start') w.cancel(); },
      detach: function () { w.detach(); },
      _w: w
    };
    byEl.set(el, w);
    instances.push(w);
    return w.handle;
  }

  var SEL = 'textarea[data-voice],input[data-voice]' + (sd.target ? ',' + sd.target : '');
  function scan() {
    instances.slice().forEach(function (w) { if (!w.el.isConnected) w.detach(); });   // box removed: tidy up
    if (!DEF.deployment) return;
    var list;
    try { list = document.querySelectorAll(SEL); } catch (e) { warn('bad data-target selector', sd.target); return; }
    for (var i = 0; i < list.length; i++) if (!byEl.has(list[i]) && supported(list[i])) attach(list[i]);
  }

  var pending = 0;
  function start() {
    scan();
    new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = 0; scan(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  var api_ = {
    version: '1.0.0',
    attach: attach,
    get: function (el) { var w = byEl.get(el); return w ? w.handle : null; },
    scan: scan
  };
  if (DEBUG) {
    // Test hook (no microphone in headless browsers): run the normal send path with a given blob.
    api_._debugSend = function (handle, blob, seconds) {
      var w = handle && handle._w;
      if (!w) return Promise.reject(new Error('no such handle'));
      if (w.focused()) w.memo();
      w.at = w.caret; w.caret = null;
      return w.send(blob, seconds || 0);
    };
  }
  window.VoiceWidget = api_;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
