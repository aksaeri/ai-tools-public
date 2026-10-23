// MicPhone: an Android phone (Pixel-like, light theme) running a chat app,
// with Gboard up and Voice Key's floating mic over it. Shared by clip-mic.html,
// clip-flow.html and the page's state explorer, so they all show one artwork.
//
// Classic script, no dependencies. Load fonts/fonts.css on the page for Roboto
// (it falls back to system sans otherwise). Injects its own CSS (mp- classes).
//
//   const phone = MicPhone.create(container, opts?)
//     container  any element with a size; the phone is fitted inside it
//                ("contain"), centred unless opts.alignX / opts.alignY (0..1).
//     opts       { incoming, cleaned, contact, alignX, alignY }; text defaults
//                come from window.Story when it exists.
//
//   phone.draw(t, timeline)
//     Sets the whole picture for time t (seconds) from a Story.mic-shaped
//     object: tap1, growEnd, speechStart, speechEnd, tap2, collapseEnd,
//     textLands, tapSend, messageSent, kbdHide. A null or missing tapSend /
//     messageSent / kbdHide means that event does not happen. Pure: no
//     timers, no animation, nothing remembered between calls.
//
//   phone.setState(name)
//     A still for the page: ready, offline, checking, recording, sending,
//     recover, menu, nokbd. On a normal page the spinner and the amber pulse
//     animate with CSS; draw() switches that off again.
//
//   phone.getPoint(name) -> { x, y }
//     Centre of a part, in CSS px relative to the container's top-left (its
//     own untransformed box). Reflects the last draw()/setState(). Names:
//     disc, stop (the stop disc; same spot as disc), pill, timer, send,
//     field, keyboard (top centre of Gboard), outgoing (the sent bubble),
//     screen.
//   phone.getRect(name) -> { x, y, width, height }  same space; names:
//     phone, screen, disc, pill, field, send, keyboard, outgoing.
//   phone.scale  px per dp at the last fit; phone.el  the root element.
//
// Geometry follows FloatingControl.kt in dp: a 46 dp disc docked 8 dp in from
// the right edge, about 34% down; the pill reaches 86 dp in from the disc
// column (132 dp in all); timer centred 58 dp in, bars from 6 dp in, 4 dp
// apart, one per 250 ms tick, nine ticks long.

(function () {
  if (window.MicPhone) return;

  // Device geometry, in dp. The screen is 360 x 720 dp.
  const BZ = 8, SW = 360, SH = 720, W = SW + 2 * BZ, H = SH + 2 * BZ;
  const COL = 46, R = 23, PILL = 86, MARGIN = 8;
  const CX = SW - MARGIN - R;               // disc centre x (329)
  const CY = Math.round(SH * 0.34) + R;     // disc centre y (268)
  const COL_L = CX - R;                     // left edge of the disc column
  const KBD = 264, NAV = 28;                // Gboard keys area, nav bar

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const rand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  // Same formula as Kit.speechLevel, so the pill's bars match the scene's sound icon.
  const speechLevel = (t, seed = 1) => {
    if (window.Kit && window.Kit.speechLevel) return window.Kit.speechLevel(t, seed);
    const syl = Math.abs(Math.sin(t * 9.1 + seed)) * 0.55 + Math.abs(Math.sin(t * 3.3 + seed * 2)) * 0.35;
    const gap = Math.sin(t * 1.9 + seed) > 0.82 ? 0.25 : 1;
    return clamp(syl * gap * (0.75 + 0.25 * rand(Math.floor(t * 8))));
  };
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const P = (deg, r) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (from, sweep, r) => {
    const [x0, y0] = P(from, r), [x1, y1] = P(from + sweep, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  const CSS = `
.mp-root{position:absolute;inset:0;overflow:visible;pointer-events:none;-webkit-font-smoothing:antialiased}
.mp-device{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;font-family:Roboto,"Google Sans",system-ui,sans-serif;color:#1F1F1F}
.mp-body{position:absolute;inset:0;border-radius:46px;background:linear-gradient(150deg,#4A4E55 0%,#1D1F23 18%,#111215 60%,#2A2D32 100%);
  box-shadow:0 34px 60px -24px rgba(27,35,48,.45),0 12px 24px -12px rgba(27,35,48,.35),inset 0 0 0 1.2px #5C6067,inset 0 0 0 2.4px #15171A}
.mp-btn{position:absolute;right:-2.2px;width:3.2px;border-radius:0 2px 2px 0;background:linear-gradient(90deg,#2A2D31,#55595F)}
.mp-btn-pwr{top:150px;height:48px}.mp-btn-vol{top:228px;height:92px}
.mp-screen{position:absolute;left:${BZ}px;top:${BZ}px;width:${SW}px;height:${SH}px;border-radius:38px;overflow:hidden;background:#FFFFFF}
.mp-col{position:absolute;inset:0;display:flex;flex-direction:column}
.mp-status{height:30px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:2px 22px 0 26px;background:#F3F6FB;font-size:14px;font-weight:500;letter-spacing:.1px}
.mp-status svg{display:block}
.mp-sicons{display:flex;gap:5px;align-items:center}
.mp-punch{position:absolute;left:${SW / 2 - 6.5}px;top:9px;width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 40% 38%,#2C3440 0 18%,#090A0C 46%);box-shadow:0 0 0 1.2px #1A1C20}
.mp-appbar{height:62px;flex:none;display:flex;align-items:center;gap:12px;padding:0 6px 0 14px;background:#F3F6FB}
.mp-appbar .mp-ic{width:24px;height:24px;fill:#444746;flex:none}
.mp-av{width:38px;height:38px;border-radius:50%;flex:none;background:#F4B7A7;color:#7A2E1C;font-size:18px;font-weight:500;display:flex;align-items:center;justify-content:center}
.mp-who{flex:1;display:flex;flex-direction:column;line-height:1.15}
.mp-who b{font-weight:500;font-size:18px;color:#1F1F1F}
.mp-who span{font-size:12.5px;color:#5F6368}
.mp-acts{display:flex;gap:18px;padding-right:10px}
.mp-chat{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;padding:0 12px 6px}
.mp-day{align-self:center;font-size:12px;color:#5F6368;margin:0 0 12px}
.mp-in{display:flex;align-items:flex-end;gap:8px;margin-bottom:6px}
.mp-av-s{width:28px;height:28px;border-radius:50%;flex:none;background:#F4B7A7;color:#7A2E1C;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center}
.mp-bub{font-size:15.5px;line-height:21px;padding:10px 15px;border-radius:20px;max-width:248px;text-wrap:balance}
.mp-bub-in{background:#E9EEF6;color:#1F1F1F;border-bottom-left-radius:5px}
.mp-outwrap{overflow:hidden;flex:none}
.mp-outinner{display:flex;flex-direction:column;align-items:flex-end;padding-top:6px}
.mp-bub-out{background:#0B57D0;color:#FFFFFF;border-bottom-right-radius:5px;max-width:262px}
.mp-meta{font-size:11.5px;color:#5F6368;margin:4px 4px 0}
.mp-compose{flex:none;display:flex;align-items:flex-end;gap:8px;padding:8px 12px 8px 12px;background:#FFFFFF}
.mp-field{flex:1;position:relative;min-height:48px;border-radius:24px;background:#EDF1F7;box-sizing:border-box;padding:13px 16px 14px 46px;font-size:16px;line-height:21px;color:#1F1F1F}
.mp-field .mp-emoji{position:absolute;left:13px;bottom:12px;width:24px;height:24px}
.mp-ph{color:#6F757C}
.mp-typed{border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.mp-caret{display:inline-block;width:2px;height:21px;margin:0 1px 0 0;vertical-align:-5px;background:#0B57D0}
.mp-send{width:48px;height:48px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:#DCE2EA}
.mp-send svg{width:22px;height:22px;fill:#8A9099;margin-left:3px}
.mp-send.mp-on{background:#0B57D0}.mp-send.mp-on svg{fill:#FFFFFF}
.mp-send.mp-down{background:#0842A0}
.mp-kspace{flex:none;background:#FFFFFF}
.mp-kbd{position:absolute;left:0;width:${SW}px;height:${KBD + NAV}px;top:${SH - KBD - NAV}px;background:#E8EAED}
.mp-kbd .mp-tb{position:absolute;left:0;right:0;top:0;height:44px}
.mp-kbd .mp-tb svg{position:absolute;top:10px;width:24px;height:24px}
.mp-key{position:absolute;box-sizing:border-box;border-radius:7px;background:#FFFFFF;box-shadow:0 1px 0 rgba(60,64,67,.28);display:flex;align-items:center;justify-content:center;font-size:22px;color:#202124;line-height:1}
.mp-key.mp-fn{background:#CCD1D8}
.mp-key.mp-enter{background:#0B57D0}
.mp-key sup{position:absolute;right:4px;top:3px;font-size:9.5px;color:#5F6368;line-height:1}
.mp-key.mp-sm{font-size:14.5px;font-weight:500}
.mp-key svg{width:22px;height:22px}
.mp-knav svg{position:absolute;width:22px;height:22px;fill:#444746}
.mp-handle{position:absolute;left:${SW / 2 - 54}px;top:${SH - 13}px;width:108px;height:4px;border-radius:2px;background:#1F1F1F;opacity:.88}
.mp-float{position:absolute;left:0;top:0;width:${SW}px;height:${SH}px;overflow:visible}
.mp-float text{font-family:Roboto,"Google Sans",system-ui,sans-serif}
.mp-live .mp-spinarc{animation:mp-rot .9s linear infinite;transform-origin:${CX}px ${CY}px}
.mp-live .mp-amb{animation:mp-pulse 1.6s ease-in-out infinite}
@keyframes mp-rot{to{transform:rotate(360deg)}}
@keyframes mp-pulse{50%{stroke-width:3.5px;r:20.98px;stroke-opacity:.55}}
`;

  const ICON = {
    back: '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>',
    call: '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>',
    more: '<path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>',
    send: '<path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.99.99 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/>',
    emoji: '<g fill="none" stroke="#5F6368" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M8 14.2c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2" stroke-linecap="round"/></g><circle cx="9" cy="9.7" r="1.35" fill="#5F6368"/><circle cx="15" cy="9.7" r="1.35" fill="#5F6368"/>',
    backspace: '<path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z" fill="#202124"/>',
    shift: '<path d="M12 4.2 3.8 12.6h4.9V19.6h6.6v-7h4.9z" fill="none" stroke="#202124" stroke-width="1.8" stroke-linejoin="round"/>',
    enter: '<path d="M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7z" fill="#FFFFFF"/>',
    grid: '<g fill="none" stroke="#444746" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></g>',
    sticker: '<g fill="none" stroke="#444746" stroke-width="1.8" stroke-linejoin="round"><path d="M20.5 13.5V6.5a3 3 0 00-3-3h-11a3 3 0 00-3 3v11a3 3 0 003 3h7z"/><path d="M13.5 20.5v-4a3 3 0 013-3h4"/><path d="M8 11.2c.9 1.3 2.2 1.9 3.6 1.9" stroke-linecap="round"/></g><circle cx="8.6" cy="8.4" r="1.2" fill="#444746"/><circle cx="14.4" cy="8.4" r="1.2" fill="#444746"/>',
    gif: '<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.6" fill="none" stroke="#444746" stroke-width="1.8"/><text x="12" y="15.3" text-anchor="middle" font-size="7.8" font-weight="700" fill="#444746" font-family="Roboto,sans-serif">GIF</text>',
    clip: '<g fill="none" stroke="#444746" stroke-width="1.8" stroke-linejoin="round"><path d="M8.5 4.5H6.5a2 2 0 00-2 2v13a2 2 0 002 2h11a2 2 0 002-2v-13a2 2 0 00-2-2h-2"/><rect x="8.5" y="2.8" width="7" height="3.6" rx="1.2"/></g>',
    gear: '<g fill="none" stroke="#444746"><circle cx="12" cy="12" r="7.2" stroke-width="3.2" stroke-dasharray="2.83 2.83"/><circle cx="12" cy="12" r="6" stroke-width="1.8"/><circle cx="12" cy="12" r="2.6" stroke-width="1.8"/></g>',
    palette: '<g fill="none" stroke="#444746" stroke-width="1.8"><path d="M12 3.2a8.8 8.8 0 100 17.6c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.5 1.6-1.5h1.9a4.9 4.9 0 004.9-4.9c0-4.2-4-7.5-9.2-7.5z"/></g><circle cx="7.4" cy="11.6" r="1.3" fill="#444746"/><circle cx="10" cy="7.6" r="1.3" fill="#444746"/><circle cx="14.6" cy="7.8" r="1.3" fill="#444746"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="#444746"/><path d="M5.8 11.2a6.2 6.2 0 0012.4 0M12 17.4v3.4" fill="none" stroke="#444746" stroke-width="1.9" stroke-linecap="round"/>',
    chevron: '<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>',
    kbsw: '<path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 12H4V7h16v10zm-9-9h2v2h-2zm0 3h2v2h-2zM8 8h2v2H8zm0 3h2v2H8zm-3 0h2v2H5zm0-3h2v2H5zm3 6h8v2H8zm6-3h2v2h-2zm0-3h2v2h-2zm3 3h2v2h-2zm0-3h2v2h-2z"/>',
    wifi: '<path d="M12 20.6 23.3 7a17.6 17.6 0 00-22.6 0z"/>',
    signal: '<path d="M2.5 21.5h19v-19z"/>',
  };
  const svg = (name, attrs = "") => `<svg viewBox="0 0 24 24" ${attrs}>${ICON[name]}</svg>`;

  function keyboardHTML() {
    const pad = 3, slot = (SW - 2 * pad) / 10, gap = 2.7, kh = 44, top = [50, 104, 158, 212];
    const out = [];
    const key = (col, span, row, inner, cls = "") => {
      const x = pad + col * slot + gap, w = span * slot - 2 * gap;
      out.push(`<div class="mp-key ${cls}" style="left:${x.toFixed(2)}px;top:${top[row]}px;width:${w.toFixed(2)}px;height:${kh}px">${inner}</div>`);
    };
    "qwertyuiop".split("").forEach((c, i) => key(i, 1, 0, `${c}<sup>${(i + 1) % 10}</sup>`));
    "asdfghjkl".split("").forEach((c, i) => key(i + 0.5, 1, 1, c));
    key(0, 1.5, 2, svg("shift"), "mp-fn");
    "zxcvbnm".split("").forEach((c, i) => key(i + 1.5, 1, 2, c));
    key(8.5, 1.5, 2, svg("backspace"), "mp-fn");
    key(0, 1.5, 3, "?123", "mp-fn mp-sm");
    key(1.5, 1, 3, '<span style="margin-top:-8px">,</span>', "mp-fn");
    key(2.5, 5, 3, "");
    key(7.5, 1, 3, '<span style="margin-top:-8px">.</span>', "mp-fn");
    key(8.5, 1.5, 3, svg("enter"), "mp-enter");
    const tb = [["grid", 14], ["sticker", 66], ["gif", 118], ["clip", 170], ["gear", 222], ["palette", 274], ["mic", 322]]
      .map(([n, x]) => svg(n, `style="left:${x}px"`)).join("");
    const nav = `<div class="mp-knav">${svg("chevron", `style="left:22px;top:${KBD + 3}px"`)}${svg("kbsw", `style="left:${SW - 44}px;top:${KBD + 3}px"`)}</div>`;
    return `<div class="mp-tb">${tb}</div>${out.join("")}${nav}`;
  }

  function floatSVG(uid) {
    const bars = Array.from({ length: 12 }, () => '<line x1="0" x2="0" y1="0" y2="0"/>').join("");
    const menuX = COL_L - 8 - 188, menuY = CY + R - 160;
    const row = (i, label, dim) => `<text x="${menuX + 16}" y="${menuY + 8 + 48 * i + 29.5}" font-size="15" fill="#E8EAED" fill-opacity="${dim ? 0.38 : 1}">${label}</text>`;
    return `<svg class="mp-float" viewBox="0 0 ${SW} ${SH}">
  <defs><filter id="mp-sh${uid}" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".32"/></filter>
  <filter id="mp-dsh${uid}" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity=".28"/></filter></defs>
  <g class="mp-fl">
    <g filter="url(#mp-dsh${uid})">
      <rect class="mp-pill" y="${CY - R}" height="${COL}" rx="${R}" fill="#202124" fill-opacity=".92"/>
      <circle class="mp-discfill" cx="${CX}" cy="${CY}" r="${R}" fill="#202124" fill-opacity=".9"/>
    </g>
    <rect class="mp-pilledge" y="${CY - R + 0.5}" height="${COL - 1}" rx="${R - 0.5}" fill="none" stroke="#FFFFFF" stroke-opacity=".16" stroke-width="1"/>
    <g class="mp-rec">
      <text class="mp-timer" x="${COL_L - 58}" y="${CY + 4.7}" text-anchor="middle" font-size="13" font-weight="700" fill="#FFFFFF">0:00</text>
      <g class="mp-bars" stroke="#F28B82" stroke-width="2" stroke-linecap="round">${bars}</g>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="#D93025"/>
      <circle class="mp-glow" cx="${CX}" cy="${CY}" r="12" fill="#FFFFFF" fill-opacity=".1"/>
      <rect x="${CX - 6}" y="${CY - 6}" width="12" height="12" rx="2.5" fill="#FFFFFF"/>
    </g>
    <g class="mp-idle">
      <circle cx="${CX}" cy="${CY}" r="${R - 0.5}" fill="none" stroke="#FFFFFF" stroke-opacity=".16" stroke-width="1"/>
      <g class="mp-mic" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round">
        <rect x="${CX - 3.75}" y="${CY - 10.5}" width="7.5" height="12.5" rx="3.75" stroke="none"/>
        <path d="M${CX + 7} ${CY - 1.5}A7 7 0 0 1 ${CX - 7} ${CY - 1.5}M${CX} ${CY + 5.5}V${CY + 9.5}" fill="none"/>
      </g>
      <circle class="mp-ok" cx="${CX}" cy="${CY}" r="21.5" fill="none" stroke="#34A853" stroke-width="2.5"/>
      <path class="mp-bad" d="${arc(120, 300, 21.5)}" fill="none" stroke="#EA4335" stroke-width="2.5"/>
      <circle class="mp-unk" cx="${CX}" cy="${CY}" r="22" fill="none" stroke="#9AA0A6" stroke-width="1.5"/>
      <circle class="mp-amb" cx="${CX}" cy="${CY}" r="21.5" fill="none" stroke="#FBBC04" stroke-width="2.5"/>
      <g class="mp-spin" fill="none" stroke-width="2.5" stroke-linecap="round">
        <circle cx="${CX}" cy="${CY}" r="21.5" stroke="#FFFFFF" stroke-opacity=".18"/>
        <path class="mp-spinarc" stroke="#FFFFFF"/>
      </g>
    </g>
    <g class="mp-menu" font-family="Roboto,sans-serif">
      <rect x="${menuX}" y="${menuY}" width="188" height="160" rx="12" fill="#2B2C30" filter="url(#mp-sh${uid})"/>
      ${row(0, "Insert held text", true)}${row(1, "Retry failed send")}${row(2, "Settings")}
    </g>
  </g>
</svg>`;
  }

  let uidN = 0;
  let cssDone = false;

  function create(container, opts = {}) {
    if (!cssDone && !document.getElementById("mp-css")) {
      const s = document.createElement("style");
      s.id = "mp-css"; s.textContent = CSS; document.head.appendChild(s);
    }
    cssDone = true;
    const story = window.Story || {};
    const o = {
      incoming: opts.incoming || story.incoming || "Are you around later?",
      cleaned: opts.cleaned || story.cleaned || "Sounds good, see you at the gate at five.",
      contact: opts.contact || "Sam",
      alignX: opts.alignX ?? 0.5, alignY: opts.alignY ?? 0.5,
    };
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const uid = ++uidN;
    const root = document.createElement("div");
    root.className = "mp-root";
    root.innerHTML = `<div class="mp-device">
  <div class="mp-btn mp-btn-pwr"></div><div class="mp-btn mp-btn-vol"></div>
  <div class="mp-body"></div>
  <div class="mp-screen">
    <div class="mp-col">
      <div class="mp-status"><span>5:12</span><span class="mp-sicons">${svg("wifi", 'width="16" height="16" fill="#1F1F1F"')}${svg("signal", 'width="14" height="14" fill="#1F1F1F"')}<svg width="22" height="12" viewBox="0 0 22 12"><rect x=".7" y=".7" width="18" height="10.6" rx="3" fill="none" stroke="#1F1F1F" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.4" y="2.4" width="11.5" height="7.2" rx="1.6" fill="#1F1F1F"/><rect x="19.6" y="4" width="1.8" height="4" rx=".8" fill="#1F1F1F" fill-opacity=".45"/></svg></span></div>
      <div class="mp-appbar">${svg("back", 'class="mp-ic"')}<div class="mp-av">${o.contact[0]}</div><div class="mp-who"><b>${o.contact}</b><span>Mobile</span></div><div class="mp-acts">${svg("call", 'class="mp-ic"')}${svg("more", 'class="mp-ic"')}</div></div>
      <div class="mp-chat">
        <div class="mp-day">Today 4:58 PM</div>
        <div class="mp-in"><div class="mp-av-s">${o.contact[0]}</div><div class="mp-bub mp-bub-in">${o.incoming}</div></div>
        <div class="mp-outwrap"><div class="mp-outinner"><div class="mp-bub mp-bub-out">${o.cleaned}</div><div class="mp-meta">Now</div></div></div>
      </div>
      <div class="mp-compose">
        <div class="mp-field">${svg("emoji", 'class="mp-emoji"')}<span class="mp-typed"></span><span class="mp-caret"></span><span class="mp-ph">Message</span></div>
        <div class="mp-send">${svg("send")}</div>
      </div>
      <div class="mp-kspace"></div>
    </div>
    <div class="mp-handle"></div>
    <div class="mp-kbd">${keyboardHTML()}<div class="mp-handle" style="top:${KBD + NAV - 13}px"></div></div>
    ${floatSVG(uid)}
    <div class="mp-punch"></div>
  </div>
</div>`;
    container.appendChild(root);
    const $ = (c) => root.querySelector(c);
    const el = {
      device: $(".mp-device"), screen: $(".mp-screen"), field: $(".mp-field"), typed: $(".mp-typed"), caret: $(".mp-caret"),
      ph: $(".mp-ph"), send: $(".mp-send"), kspace: $(".mp-kspace"), kbd: $(".mp-kbd"), outwrap: $(".mp-outwrap"),
      outinner: $(".mp-outinner"), bubOut: $(".mp-bub-out"), fl: $(".mp-fl"), pill: $(".mp-pill"), pilledge: $(".mp-pilledge"),
      rec: $(".mp-rec"), idle: $(".mp-idle"), discfill: $(".mp-discfill"), mic: $(".mp-mic"), timer: $(".mp-timer"),
      bars: [...root.querySelectorAll(".mp-bars line")], glow: $(".mp-glow"), ok: $(".mp-ok"), bad: $(".mp-bad"),
      unk: $(".mp-unk"), amb: $(".mp-amb"), spin: $(".mp-spin"), spinarc: $(".mp-spinarc"), menu: $(".mp-menu"),
    };
    const show = (e, on) => { e.style.display = on ? "" : "none"; };

    let fitS = 1, ox = 0, oy = 0;
    function fit() {
      const cw = container.clientWidth, ch = container.clientHeight;
      if (!cw || !ch) return;
      fitS = Math.min(cw / W, ch / H);
      ox = (cw - W * fitS) * o.alignX;
      oy = (ch - H * fitS) * o.alignY;
      el.device.style.transform = `translate(${ox}px,${oy}px) scale(${fitS})`;
      api.scale = fitS;
    }

    // Everything on screen is set from one plain state object.
    function render(st) {
      fit();
      // Keyboard and the layout above it.
      const kh = st.kbdHidden;
      el.kbd.style.transform = `translateY(${((KBD + NAV) * kh).toFixed(2)}px)`;
      el.kspace.style.height = `${(NAV + KBD * (1 - kh)).toFixed(2)}px`;
      // The field.
      el.typed.textContent = st.typed;
      el.ph.style.display = st.typed ? "none" : "";
      el.typed.style.background = st.highlight > 0 ? `rgba(123,63,207,${(0.2 * st.highlight).toFixed(3)})` : "transparent";
      el.caret.style.visibility = st.caret ? "visible" : "hidden";
      el.send.classList.toggle("mp-on", !!st.typed || st.sendDown);
      el.send.classList.toggle("mp-down", st.sendDown);
      // The sent bubble grows in from the bottom of the chat.
      const full = el.outinner.scrollHeight;
      el.outwrap.style.height = `${(full * st.sent).toFixed(2)}px`;
      el.outinner.style.opacity = st.sent.toFixed(3);
      el.outinner.style.transform = `translateY(${((1 - st.sent) * 10).toFixed(2)}px)`;

      // The floating control.
      el.fl.style.opacity = st.floatOpacity.toFixed(3);
      show(el.fl, st.floatOpacity > 0.001);
      const g = st.g;
      show(el.pill, g > 0.01); show(el.pilledge, g > 0.01);
      if (g > 0.01) {
        const a = COL_L - PILL * g, w = COL_L + COL - a;
        el.pill.setAttribute("x", a.toFixed(2)); el.pill.setAttribute("width", w.toFixed(2));
        el.pilledge.setAttribute("x", (a + 0.5).toFixed(2)); el.pilledge.setAttribute("width", (w - 1).toFixed(2));
      }
      const rec = st.mic === "rec", snd = st.mic === "send";
      show(el.rec, rec); show(el.idle, !rec);
      show(el.discfill, !rec);
      if (rec) {
        const a = clamp((g - 0.6) / 0.4);
        el.timer.textContent = fmt(st.elapsed);
        el.timer.setAttribute("fill-opacity", a.toFixed(3));
        el.bars.forEach((ln, i) => {
          const b = st.bars[i];
          if (!b) { ln.style.display = "none"; return; }
          ln.style.display = "";
          const x = COL_L - 6 - 4 * b.age, h = 0.75 + 9 * b.level * b.grow;
          ln.setAttribute("x1", x.toFixed(2)); ln.setAttribute("x2", x.toFixed(2));
          ln.setAttribute("y1", (CY - h).toFixed(2)); ln.setAttribute("y2", (CY + h).toFixed(2));
          ln.setAttribute("stroke-opacity", (a * clamp((9 - b.age) / 2)).toFixed(3));
        });
        el.glow.setAttribute("r", (12 + 9 * st.ls).toFixed(2));
        el.glow.setAttribute("fill-opacity", (0.1 + 0.22 * st.ls).toFixed(3));
      } else {
        el.discfill.setAttribute("fill-opacity", snd ? "0.7" : "0.9");
        el.mic.setAttribute("opacity", snd ? "0.43" : "1");
        show(el.spin, snd);
        const out = snd ? "" : st.outline;
        show(el.ok, out === "ok"); show(el.bad, out === "bad"); show(el.unk, out === "unknown"); show(el.amb, out === "amber");
        if (out === "amber") {
          const s = st.pulse, w = 2.5 + s;
          el.amb.setAttribute("stroke-width", w.toFixed(2));
          el.amb.setAttribute("r", (22.75 - w / 2).toFixed(2));
          el.amb.setAttribute("stroke-opacity", (1 - 0.45 * s).toFixed(3));
        }
        if (snd) el.spinarc.setAttribute("d", arc(-90 + 360 * st.spin, 100, 21.5));
      }
      show(el.menu, st.menu);
    }

    const base = () => ({
      kbdHidden: 0, typed: "", highlight: 0, caret: true, sendDown: false, sent: 0,
      floatOpacity: 1, mic: "idle", outline: "ok", pulse: 0, g: 0, elapsed: 0, bars: [], ls: 0, spin: 0, menu: false,
    });

    function stateAt(t, tl) {
      const st = base();
      const has = (k) => tl[k] !== null && tl[k] !== undefined;
      const speaking = (u) => (has("speechStart") ? seg(u, tl.speechStart - 0.05, tl.speechStart + 0.1) * (1 - seg(u, tl.speechEnd, tl.speechEnd + 0.2)) : 0);
      const level = (u, i) => clamp(0.05 + 0.04 * rand(i * 7 + 3) + speaking(u) * speechLevel(u) * 0.95);
      const lands = has("textLands") ? tl.textLands : Infinity;
      if (has("tap1") && t >= tl.tap1 && t < (has("tap2") ? tl.tap2 : Infinity)) {
        st.mic = "rec";
        st.g = easeOut(seg(t, tl.tap1, tl.growEnd));
        st.elapsed = t - tl.tap1;
        const kNow = Math.floor(st.elapsed / 0.25);
        for (let k = kNow; k >= Math.max(0, kNow - 11); k--) {
          const tk = tl.tap1 + 0.25 * k, age = (t - tk) / 0.25;
          if (age > 9) break;
          st.bars.push({ age, level: level(tk, k), grow: easeOut(clamp((t - tk) / 0.12)) });
        }
        st.ls = 0.6 * level(t, kNow) + 0.4 * level(t - 0.08, kNow - 1);
      } else if (has("tap2") && t >= tl.tap2 && t < lands) {
        st.mic = "send";
        st.g = 1 - easeOut(seg(t, tl.tap2, tl.collapseEnd));
        st.spin = ((t - tl.tap2) % 0.9) / 0.9;
      }
      const sentAt = has("messageSent") ? tl.messageSent : Infinity;
      if (t >= lands && t < sentAt) {
        st.typed = o.cleaned;
        st.highlight = 1 - seg(t, lands + 0.5, lands + 1.4);
      }
      st.sent = easeOut(seg(t, sentAt, sentAt + 0.3));
      st.sendDown = has("tapSend") && t >= tl.tapSend - 0.12 && t < tl.tapSend + 0.08;
      st.kbdHidden = has("kbdHide") ? easeInOut(seg(t, tl.kbdHide, tl.kbdHide + 0.4)) : 0;
      st.floatOpacity = 1 - st.kbdHidden;
      st.caret = st.kbdHidden < 0.5 && (t % 1.0) < 0.55;
      return st;
    }

    const STATES = {
      ready: {},
      offline: { outline: "bad" },
      checking: { outline: "unknown" },
      recover: { outline: "amber" },
      menu: { outline: "amber", menu: true },
      recording: { mic: "rec", g: 1, elapsed: 3.2, ls: 0.45 },
      sending: { mic: "send", spin: 0.08 },
      nokbd: { kbdHidden: 1, floatOpacity: 0, sent: 1, caret: false },
    };
    const STILL_LEVELS = [0.35, 0.7, 0.5, 0.9, 0.6, 0.25, 0.75, 0.55, 0.4, 0.8];

    const api = {
      el: root, scale: 1,
      draw(t, timeline) {
        root.classList.remove("mp-live");
        render(stateAt(t, timeline || window.Story?.mic || {}));
      },
      setState(name) {
        const def = STATES[name];
        if (!def) throw new Error(`MicPhone: unknown state "${name}"`);
        const st = Object.assign(base(), def);
        if (st.mic === "rec") st.bars = STILL_LEVELS.map((level, i) => ({ age: i + 0.3, level, grow: 1 }));
        root.classList.add("mp-live");
        render(st);
      },
      getRect(name) {
        let r; // in screen dp
        switch (name) {
          case "phone": return { x: ox, y: oy, width: W * fitS, height: H * fitS };
          case "screen": r = { x: 0, y: 0, w: SW, h: SH }; break;
          case "disc": case "stop": r = { x: COL_L, y: CY - R, w: COL, h: COL }; break;
          case "pill": r = { x: COL_L - PILL, y: CY - R, w: PILL + COL, h: COL }; break;
          case "timer": r = { x: COL_L - 58 - 14, y: CY - 8, w: 28, h: 16 }; break;
          case "field": r = box(el.field); break;
          case "send": r = box(el.send); break;
          case "keyboard": r = box(el.kbd); break;
          case "outgoing": r = box(el.bubOut); break;
          default: throw new Error(`MicPhone: unknown part "${name}"`);
        }
        return { x: ox + (BZ + r.x) * fitS, y: oy + (BZ + r.y) * fitS, width: r.w * fitS, height: r.h * fitS };
      },
      getPoint(name) {
        const r = api.getRect(name === "keyboard" ? "keyboard" : name);
        if (name === "keyboard") return { x: r.x + r.width / 2, y: r.y };
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
    };
    // Box of a screen element in screen dp, from layout offsets (unaffected by transforms).
    function box(e) {
      let x = 0, y = 0, n = e;
      while (n && n !== el.screen) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      const ty = e === el.kbd ? parseFloat((el.kbd.style.transform.match(/translateY\(([-\d.]+)px/) || [0, "0"])[1]) : 0;
      return { x, y: y + ty, w: e.offsetWidth, h: e.offsetHeight };
    }

    if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(container);
    api.setState("ready");
    return api;
  }

  window.MicPhone = { create, W, H, SCREEN: { width: SW, height: SH }, DISC: { x: CX, y: CY, r: R } };
})();
