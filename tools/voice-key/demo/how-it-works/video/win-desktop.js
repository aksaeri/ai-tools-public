// win-desktop.js: the bottom-right corner of a Windows 11 desktop (light
// theme) with a generic chat window, a toast, the tray menu and the taskbar
// with the Voice Key tray icon. Used by clip-win.html and by the page's stills.
// Classic script, no dependencies; injects its own CSS (classes prefixed wd-).
//
//   const d = WinDesktop.create(container, opts)
//     Appends the desktop to container. It fills the container's width and
//     keeps a 1000 x 680 aspect; everything inside is laid out in a fixed
//     1000 x 680 "stage" coordinate system and scaled to fit.
//     opts (all optional):
//       incoming   text of Sam's message      (default Story.incoming)
//       text       text that gets pasted      (default Story.cleaned)
//       toastText  notification body         (default = text)
//       contact    chat contact name          (default "Sam")
//   d.draw(t, timeline)
//     Sets the whole picture for time t (seconds) from a Story.win-shaped
//     object: recStart, sending, cleanReady, toastOut, pasted. A pure function
//     of t, including the caret blink (530 ms on, 530 ms off, restarting when
//     the text lands). Missing keys mean "doesn't happen".
//   d.setState(name)
//     A still: "ready", "recording", "sending", "unreachable", "queued",
//     "menu" (tray menu open, 2 clips queued), "toast" (notification showing).
//   d.overlay     a div above everything, in stage coordinates, for a scene's
//                 own annotations (position children absolutely in stage px).
//   d.scale       stage px -> container CSS px (container width / 1000).
//   d.getPoint(name) -> {x, y[, w, h]} in stage px:
//       "tray"     centre of the Voice Key tray icon        (704, 644)
//       "caret"    top of the text caret, where it is now
//       "field"    the chat message box (rect)
//       "toast"    where the notification sits when shown (rect)
//       "free"     empty wallpaper below the window, left of the toast (rect)
//       "taskbar"  the taskbar (rect, top at y 608)
//
//   WinDesktop.icon(state) -> SVG string (viewBox 0 0 64 64) of the tray
//     icon, drawn as voice_key_win/tray.py draws it. state: "ready",
//     "recording", "sending", "unreachable", "queued".
//   WinDesktop.states   the setState names, in order.

(function () {
  const W = 1000, H = 680;
  const COLORS = { ready: "#888888", recording: "#d33a2c", sending: "#e6a817" };

  // ---- tray icon (tray.py make_icon, 64 x 64) ----------------------------
  function icon(state) {
    const queued = state === "queued";
    const c = COLORS[state] || COLORS.ready;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect x="22" y="8" width="20" height="30" rx="10" fill="${c}"/>` +
      `<path d="M47.5 36 A15.5 11.5 0 0 1 16.5 36" fill="none" stroke="${c}" stroke-width="5"/>` +
      `<path d="M32 50 V58 M22 58 H42" stroke="${c}" stroke-width="5" fill="none"/>`;
    if (state === "unreachable")
      s += `<path d="M10 54 L54 10" stroke="#fff" stroke-width="7"/><path d="M10 54 L54 10" stroke="#d33a2c" stroke-width="3"/>`;
    if (queued) s += `<circle cx="52" cy="52" r="8" fill="#d33a2c"/>`;
    return s + `</svg>`;
  }

  // ---- small line icons, 24 x 24, Fluent-like ----------------------------
  const svg = (body, sw = 1.5, extra = "") =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  const I = {
    chevUp: svg('<path d="M6.5 14.5 12 9l5.5 5.5"/>'),
    wifi: svg('<path d="M2.8 9.2a13.5 13.5 0 0 1 18.4 0"/><path d="M5.8 12.5a9 9 0 0 1 12.4 0"/><path d="M8.9 15.8a4.6 4.6 0 0 1 6.2 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>'),
    speaker: svg('<path d="M3.8 9.4h3.1L11.5 5.6v12.8L6.9 14.6H3.8z"/><path d="M15.2 9.3a3.9 3.9 0 0 1 0 5.4"/><path d="M17.8 6.8a7.6 7.6 0 0 1 0 10.4"/>'),
    bell: svg('<path d="M12 3.5a5.6 5.6 0 0 0-5.6 5.6v3.6L4.6 16h14.8l-1.8-3.3V9.1A5.6 5.6 0 0 0 12 3.5z"/><path d="M9.8 18.6a2.3 2.3 0 0 0 4.4 0"/>'),
    min: svg('<path d="M6 12h12"/>', 1),
    max: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>', 1),
    close: svg('<path d="M7 7l10 10M17 7 7 17"/>', 1),
    chat: svg('<path d="M4.5 6.8A2.3 2.3 0 0 1 6.8 4.5h10.4a2.3 2.3 0 0 1 2.3 2.3v7a2.3 2.3 0 0 1-2.3 2.3H11l-4.2 3.4v-3.4A2.3 2.3 0 0 1 4.5 13.8z"/>'),
    people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.8" cy="9.6" r="2.4"/><path d="M15.6 14.2a4.4 4.4 0 0 1 5 4.8"/>'),
    cal: svg('<rect x="4" y="5.5" width="16" height="14" rx="2.4"/><path d="M4 9.8h16M8.5 3.8v3.4M15.5 3.8v3.4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>'),
    phone: svg('<path d="M7.2 4.5 9.4 4l1.6 3.8-1.8 1.4a9.6 9.6 0 0 0 5.6 5.6l1.4-1.8 3.8 1.6-.5 2.2a2.3 2.3 0 0 1-2.4 1.8A13.8 13.8 0 0 1 4.9 6.9a2.3 2.3 0 0 1 2.3-2.4z"/>'),
    video: svg('<rect x="3.5" y="6.5" width="12" height="11" rx="2.4"/><path d="m15.5 10.6 5-3v8.8l-5-3"/>'),
    smile: svg('<circle cx="12" cy="12" r="8.2"/><path d="M8.6 14.2a4.4 4.4 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10" r=".9" fill="currentColor" stroke="none"/>'),
    clip: svg('<path d="m19 11.5-6.8 6.8a4.4 4.4 0 0 1-6.2-6.2l7.3-7.3a2.9 2.9 0 0 1 4.1 4.1l-7.1 7.1a1.4 1.4 0 0 1-2-2l6.5-6.5"/>'),
    send: svg('<path d="M4.6 4.8 20 12 4.6 19.2l2.6-7.2z"/><path d="M7.2 12H13"/>'),
    dots: svg('<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>', 1),
    check: svg('<path d="m5.5 12.5 4 4 9-9"/>'),
    chevR: svg('<path d="m9.5 6 6 6-6 6"/>'),
  };
  // Generic app tiles for the taskbar and title bar (no real brands).
  const TILE = {
    chat: `<svg viewBox="0 0 32 32"><defs><linearGradient id="wdg-chat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fb6a8"/><stop offset="1" stop-color="#1f7f8f"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#wdg-chat)"/><path d="M9 11.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-4.5l-4 3v-3H12a3 3 0 0 1-3-3z" fill="#fff"/></svg>`,
    folder: `<svg viewBox="0 0 32 32"><path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h6.2l2.6 2.6h12.2A2.5 2.5 0 0 1 29 12.1V24a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24z" fill="#e8a33d"/><path d="M3 13a2.5 2.5 0 0 1 2.5-2.5h21A2.5 2.5 0 0 1 29 13v11a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24z" fill="#f7c95c"/></svg>`,
    globe: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.5" fill="#4b8ef0"/><g fill="none" stroke="#fff" stroke-width="1.6" opacity=".9"><ellipse cx="16" cy="16" rx="5.2" ry="12.5"/><path d="M3.5 16h25M5.5 9.5h21M5.5 22.5h21"/></g></svg>`,
    notes: `<svg viewBox="0 0 32 32"><rect x="5" y="3" width="22" height="26" rx="4" fill="#7a6ff0"/><path d="M10 11h12M10 16h12M10 21h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  };

  const CSS = `
.wd-root{position:relative;width:100%;aspect-ratio:${W}/${H};overflow:hidden;border-radius:var(--wd-radius,12px);
  font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased;user-select:none;contain:layout paint}
.wd-stage{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;overflow:hidden}
.wd-stage *{box-sizing:border-box}
.wd-stage svg{display:block;width:100%;height:100%}
.wd-wall{position:absolute;inset:0;background:
  radial-gradient(60% 70% at 92% 8%,#f6eefc 0%,rgba(246,238,252,0) 70%),
  radial-gradient(55% 60% at 8% 96%,#c9dcf6 0%,rgba(201,220,246,0) 70%),
  linear-gradient(158deg,#e9f0fb 0%,#dbe6f7 55%,#d2def4 100%)}
.wd-wall svg{position:absolute;inset:0}
/* window */
.wd-win{position:absolute;left:36px;top:20px;width:744px;height:392px;border-radius:12px;background:#eef2f7;
  box-shadow:0 0 0 1px rgba(0,0,0,.09),0 18px 42px rgba(20,32,60,.22),0 4px 12px rgba(20,32,60,.10);overflow:hidden}
.wd-title{position:absolute;left:0;top:0;right:0;height:48px;display:flex;align-items:center}
.wd-title .wd-appic{width:24px;height:24px;margin-left:18px}
.wd-title .wd-tt{margin-left:14px;font-size:18px;font-weight:400;color:#1a1a1a}
.wd-caps{position:absolute;right:0;top:0;height:48px;display:flex}
.wd-caps span{width:68px;height:48px;display:flex;align-items:center;justify-content:center;color:#1a1a1a}
.wd-caps span svg{width:22px;height:22px}
.wd-rail{position:absolute;left:0;top:48px;bottom:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:6px}
.wd-rail span{position:relative;width:48px;height:46px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#5c5c5c}
.wd-rail span svg{width:26px;height:26px}
.wd-rail span.on{background:rgba(255,255,255,.75);color:#005fb8;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.wd-rail span.on::before{content:"";position:absolute;left:-9px;top:14px;width:4px;height:18px;border-radius:2px;background:#005fb8}
.wd-rail span.bottom{margin-top:auto;margin-bottom:10px}
.wd-pane{position:absolute;left:66px;top:48px;right:0;bottom:0;background:#fff;border-top-left-radius:12px;
  box-shadow:inset 1px 1px 0 rgba(0,0,0,.06)}
.wd-head{position:absolute;left:0;right:0;top:0;height:62px;display:flex;align-items:center;padding:0 22px;border-bottom:1px solid #ebebeb}
.wd-av{width:38px;height:38px;border-radius:50%;background:#d6c3a5;color:#5a4426;font-weight:600;font-size:17px;display:flex;align-items:center;justify-content:center}
.wd-who{margin-left:14px;line-height:1.2}
.wd-who b{display:block;font-weight:600;font-size:19px}
.wd-who i{font-style:normal;font-size:15px;color:#616161}
.wd-who i::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:#3aa55d;margin-right:7px;vertical-align:0}
.wd-hicons{margin-left:auto;display:flex;gap:10px;color:#424242}
.wd-hicons span{width:40px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center}
.wd-hicons svg{width:24px;height:24px}
.wd-msgs{position:absolute;left:0;right:0;top:62px;bottom:76px;padding:16px 24px 14px;display:flex;flex-direction:column;justify-content:flex-end}
.wd-day{text-align:center;font-size:14px;color:#707070;margin-bottom:12px}
.wd-in{display:flex;align-items:flex-end;gap:10px}
.wd-in .wd-av{width:30px;height:30px;font-size:13px}
.wd-bub{background:#f0f0f0;border-radius:16px 16px 16px 4px;padding:11px 16px;font-size:20px;line-height:1.3}
.wd-meta{margin:6px 0 0 40px;font-size:14px;color:#707070}
.wd-compose{position:absolute;left:20px;right:20px;bottom:14px;height:56px;border-radius:8px;background:#fff;
  border:1px solid #d6d6d6;border-bottom:2px solid #005fb8;display:flex;align-items:center;padding:0 10px 0 18px}
.wd-field{position:relative;flex:1;display:flex;align-items:center;height:100%;font-size:20px;white-space:nowrap;overflow:hidden}
.wd-typed{position:relative;border-radius:4px}
.wd-typed .wd-hl{position:absolute;inset:-3px -4px;border-radius:5px;background:#7b3fcf;opacity:0}
.wd-typed .wd-tx{position:relative}
.wd-caret{display:inline-block;width:2px;height:26px;background:#1a1a1a;margin-left:1px}
.wd-ph{color:#8a8a8a;margin-left:2px}
.wd-cicons{display:flex;gap:4px;color:#616161}
.wd-cicons span{width:40px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center}
.wd-cicons svg{width:24px;height:24px}
.wd-cicons .wd-send{color:#a0a0a0}
.wd-cicons .wd-send.on{color:#005fb8}
/* toast */
.wd-toast{position:absolute;left:436px;top:474px;width:546px;height:116px;border-radius:12px;padding:20px 22px 0 24px;
  background:rgba(250,250,252,.97);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 16px 36px rgba(20,32,60,.22),0 3px 8px rgba(20,32,60,.08)}
.wd-th{display:flex;align-items:center;height:24px;font-size:16px;color:#424242}
.wd-th .wd-ti{width:22px;height:22px;margin-right:10px}
.wd-th .wd-tr{margin-left:auto;display:flex;gap:18px;color:#616161}
.wd-th .wd-tr span{width:20px;height:20px}
.wd-tb{margin-top:14px;font-size:21px;line-height:1.4;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* tray menu */
.wd-menu{position:absolute;left:556px;top:198px;width:330px;padding:6px;border-radius:12px;background:rgba(249,249,251,.98);
  box-shadow:0 0 0 1px rgba(0,0,0,.09),0 14px 32px rgba(20,32,60,.22);font-size:19px;display:none}
.wd-menu .wd-mi{position:relative;height:44px;display:flex;align-items:center;padding-left:46px;border-radius:6px}
.wd-menu .wd-mi.dis{color:#8a8a8a}
.wd-menu .wd-mi.hov{background:rgba(0,0,0,.05)}
.wd-menu .wd-mi .wd-ck{position:absolute;left:14px;top:11px;width:22px;height:22px}
.wd-menu .wd-mi .wd-sub{position:absolute;right:12px;top:12px;width:20px;height:20px;color:#5c5c5c}
.wd-menu .wd-sep{height:1px;background:rgba(0,0,0,.09);margin:4px -6px}
/* taskbar */
.wd-bar{position:absolute;left:0;top:608px;width:${W}px;height:72px;background:rgba(238,242,248,.86);
  backdrop-filter:blur(24px) saturate(1.3);-webkit-backdrop-filter:blur(24px) saturate(1.3);border-top:1px solid rgba(0,0,0,.08)}
.wd-app{position:absolute;top:6px;width:60px;height:60px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.wd-app svg{width:36px;height:36px}
.wd-app.on{background:rgba(255,255,255,.7);box-shadow:0 0 0 1px rgba(0,0,0,.05)}
.wd-app i{position:absolute;bottom:3px;left:50%;height:5px;border-radius:3px;transform:translateX(-50%);width:9px;background:#8a8a8a}
.wd-app.on i{width:24px;background:#005fb8}
.wd-tic{position:absolute;top:22px;width:28px;height:28px;color:#1a1a1a}
.wd-tic.small{width:26px;height:26px;top:23px}
.wd-mic{position:absolute;left:690px;top:630px;width:28px;height:28px}
.wd-clock{position:absolute;right:76px;top:13px;text-align:right;font-size:17px;line-height:23px;color:#1a1a1a}
.wd-overlay{position:absolute;inset:0;pointer-events:none}
`;

  function injectCSS() {
    if (document.getElementById("wd-css")) return;
    const s = document.createElement("style");
    s.id = "wd-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Soft ribbons over the wallpaper gradient: suggests a Windows 11
  // wallpaper without copying one.
  const WALL = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="wdw1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9cbcf0" stop-opacity=".0"/><stop offset=".5" stop-color="#8fb2ee" stop-opacity=".55"/><stop offset="1" stop-color="#b9a8ee" stop-opacity=".25"/></linearGradient>
    <linearGradient id="wdw2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#c8b6f2" stop-opacity=".1"/><stop offset=".6" stop-color="#a9c4f3" stop-opacity=".6"/><stop offset="1" stop-color="#e3edfc" stop-opacity=".2"/></linearGradient>
    <filter id="wdblur"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <g filter="url(#wdblur)">
    <path d="M-80 560 C 180 420, 420 640, 700 470 S 1020 300, 1120 360 L 1120 470 C 980 420, 820 600, 600 640 S 120 640, -80 700 Z" fill="url(#wdw1)"/>
    <path d="M520 -40 C 640 120, 820 160, 1080 120 L 1080 300 C 900 330, 700 260, 600 140 Z" fill="url(#wdw2)"/>
    </g></svg>`;

  const MENU = [
    ["Ready · 2 queued", "dis"], ["-"], ["Microphone", "sub"], ["Retry 2 queued clips", "hov"],
    ["Open log"], ["Open config"], ["-"], ["Sounds", "ck"], ["Notifications", "ck"], ["Recording window", "ck"], ["-"], ["Quit"],
  ];

  function template(o) {
    const menu = MENU.map(([label, k]) => label === "-" ? '<div class="wd-sep"></div>' :
      `<div class="wd-mi ${k === "dis" ? "dis" : ""} ${k === "hov" ? "hov" : ""}">${k === "ck" ? `<span class="wd-ck">${I.check}</span>` : ""}${label}${k === "sub" ? `<span class="wd-sub">${I.chevR}</span>` : ""}</div>`).join("");
    const initial = esc(o.contact.slice(0, 1));
    return `<div class="wd-stage">
  <div class="wd-wall">${WALL}</div>
  <div class="wd-win">
    <div class="wd-title"><span class="wd-appic">${TILE.chat}</span><span class="wd-tt">Chat</span></div>
    <div class="wd-caps"><span>${I.min}</span><span>${I.max}</span><span>${I.close}</span></div>
    <div class="wd-rail"><span class="on">${I.chat}</span><span>${I.people}</span><span>${I.cal}</span><span class="bottom">${I.gear}</span></div>
    <div class="wd-pane">
      <div class="wd-head"><div class="wd-av">${initial}</div><div class="wd-who"><b>${esc(o.contact)}</b><i>Active now</i></div>
        <div class="wd-hicons"><span>${I.video}</span><span>${I.phone}</span></div></div>
      <div class="wd-msgs"><div class="wd-day">Today</div>
        <div class="wd-in"><div class="wd-av">${initial}</div><div class="wd-bub">${esc(o.incoming)}</div></div>
        <div class="wd-meta">10:41</div></div>
      <div class="wd-compose"><div class="wd-field"><span class="wd-typed"><span class="wd-hl"></span><span class="wd-tx"></span></span><span class="wd-caret"></span><span class="wd-ph">Type a message</span></div>
        <div class="wd-cicons"><span>${I.smile}</span><span>${I.clip}</span><span class="wd-send">${I.send}</span></div></div>
    </div>
  </div>
  <div class="wd-toast"><div class="wd-th"><span class="wd-ti">${icon("ready")}</span>Voice Key<span class="wd-tr"><span>${I.dots}</span><span>${I.close}</span></span></div>
    <div class="wd-tb">${esc(o.toastText)}</div></div>
  <div class="wd-menu">${menu}</div>
  <div class="wd-bar">
    <div class="wd-app" style="left:22px">${TILE.folder}<i></i></div>
    <div class="wd-app" style="left:86px">${TILE.globe}<i></i></div>
    <div class="wd-app on" style="left:150px">${TILE.chat}<i></i></div>
    <div class="wd-app" style="left:214px">${TILE.notes}</div>
    <span class="wd-tic" style="left:648px">${I.chevUp}</span>
    <span class="wd-tic" style="left:748px">${I.wifi}</span>
    <span class="wd-tic" style="left:786px">${I.speaker}</span>
    <div class="wd-clock">10:42<br>8/10/2026</div>
    <span class="wd-tic small" style="left:952px">${I.bell}</span>
  </div>
  <div class="wd-mic"></div>
  <div class="wd-overlay"></div>
</div>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  const clamp = (x) => Math.min(1, Math.max(0, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeIn = (p) => p * p * p;
  const at = (tl, k) => (tl && typeof tl[k] === "number" ? tl[k] : Infinity);

  // A frame description. Every draw/setState builds one and paints it.
  const BASE = { icon: "ready", caret: true, text: "", hl: 0, toastIn: 0, toastOut: 0, menu: false };
  const STATES = {
    ready: {},
    recording: { icon: "recording" },
    sending: { icon: "sending" },
    unreachable: { icon: "unreachable" },
    queued: { icon: "queued" },
    menu: { icon: "queued", menu: true },
    toast: { toastIn: 1 },
  };

  function create(container, opts = {}) {
    injectCSS();
    const S = window.Story || {};
    const o = {
      incoming: opts.incoming ?? S.incoming ?? "Are you around later?",
      text: opts.text ?? S.cleaned ?? "Sounds good, see you at the gate at five.",
      contact: opts.contact ?? "Sam",
    };
    o.toastText = opts.toastText ?? o.text;
    const root = document.createElement("div");
    root.className = "wd-root";
    root.innerHTML = template(o);
    container.appendChild(root);
    const q = (s) => root.querySelector(s);
    const el = {
      stage: q(".wd-stage"), mic: q(".wd-mic"), toast: q(".wd-toast"), menu: q(".wd-menu"),
      tx: q(".wd-tx"), hl: q(".wd-hl"), caret: q(".wd-caret"), ph: q(".wd-ph"), send: q(".wd-send"),
      overlay: q(".wd-overlay"),
    };
    let k = 1, last = {};
    const fit = () => {
      const w = root.clientWidth || W;
      k = w / W;
      el.stage.style.transform = `scale(${k})`;
    };
    if (window.ResizeObserver) new ResizeObserver(fit).observe(root);
    fit();

    function paint(s) {
      s = { ...BASE, ...s };
      if (s.icon !== last.icon) el.mic.innerHTML = icon(s.icon);
      if (s.text !== last.text) el.tx.textContent = s.text;
      el.ph.style.display = s.text ? "none" : "";
      el.send.classList.toggle("on", !!s.text);
      el.hl.style.opacity = (0.16 * s.hl).toFixed(3);
      el.caret.style.visibility = s.caret ? "visible" : "hidden";
      const shown = s.toastIn > 0 && s.toastOut < 1;
      el.toast.style.display = shown ? "" : "none";
      if (shown) {
        const x = (1 - easeOut(s.toastIn)) * 590 + easeIn(s.toastOut) * 590;
        el.toast.style.transform = `translateX(${x.toFixed(1)}px)`;
        el.toast.style.opacity = (Math.min(1, s.toastIn * 2.5) * (1 - s.toastOut)).toFixed(3);
      }
      el.menu.style.display = s.menu ? "block" : "none";
      last = s;
    }

    function frameAt(t, tl) {
      const rec = at(tl, "recStart"), snd = at(tl, "sending"), clean = at(tl, "cleanReady");
      const out = at(tl, "toastOut"), pasted = at(tl, "pasted");
      const ic = t >= clean ? "ready" : t >= snd ? "sending" : t >= rec ? "recording" : "ready";
      const has = t >= pasted;
      // Windows' caret: 530 ms on, 530 ms off, restarting on each edit.
      const since = has ? t - pasted : t;
      return {
        icon: ic,
        caret: (since % 1.06) < 0.53,
        text: has ? o.text : "",
        hl: has ? 1 - seg(t, pasted + 0.15, pasted + 1.1) : 0,
        toastIn: seg(t, clean, clean + 0.38),
        toastOut: seg(t, out, out + 0.32),
      };
    }

    function getPoint(name) {
      switch (name) {
        case "tray": return { x: 704, y: 644 };
        case "field": return { x: 122, y: 342, w: 638, h: 56 };
        case "toast": return { x: 436, y: 474, w: 546, h: 116 };
        case "free": return { x: 24, y: 432, w: 396, h: 164 };
        case "taskbar": return { x: 0, y: 608, w: W, h: 72 };
        case "caret": {
          const a = el.caret.getBoundingClientRect(), b = el.stage.getBoundingClientRect();
          return { x: (a.left - b.left) / k, y: (a.top - b.top) / k };
        }
      }
      return null;
    }

    paint({});
    return {
      el: root,
      overlay: el.overlay,
      get scale() { return k; },
      draw(t, tl) { paint(frameAt(t, tl)); },
      setState(name) { paint(STATES[name] || {}); },
      getPoint,
    };
  }

  window.WinDesktop = { create, icon, states: Object.keys(STATES), width: W, height: H };
})();
