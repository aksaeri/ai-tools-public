"""Schematic header drawings for the tool pages (800x450, theme-aware via CSS variables).

    python3 site/headers.py            # writes tools/<tool>/demo/header.svg for every tool below
"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "tools"

STYLE = """<style>
.s-paper{fill:var(--surface,#fff);stroke:var(--line-strong,#C9CCC6);stroke-width:1.5}
.s-box{fill:var(--surface,#fff);stroke:var(--accent,#17879B);stroke-width:2}
.s-dash{fill:none;stroke:var(--muted,#6B6B6B);stroke-width:1.5;stroke-dasharray:5 4}
.s-ln{fill:var(--line-strong,#C9CCC6)}
.s-ink{fill:var(--fg,#1A1A1A)}
.s-red{fill:#E0352B}
.s-green{fill:#1E8E3E}
.s-teal{fill:var(--accent,#17879B)}
.s-tint{fill:var(--tint-2,rgba(23,135,155,.16))}
.s-ar{fill:none;stroke:var(--accent,#17879B);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.s-thin{fill:none;stroke:var(--muted,#6B6B6B);stroke-width:1.5}
.s-strike{stroke:var(--muted,#6B6B6B);stroke-width:1.5}
.s-lab{fill:var(--muted,#6B6B6B);font:500 15px Inter,system-ui,sans-serif}
.s-mono{fill:var(--muted,#6B6B6B);font:500 11px 'JetBrains Mono',ui-monospace,monospace}
.s-tag{fill:var(--accent,#17879B);font:600 10px Inter,system-ui,sans-serif}
</style>"""


def svg(body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" role="img" aria-label="{label}">'
            f'{STYLE}{body}</svg>\n')


def ln(x, y, w, cls="s-ln", h=6):
    return f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="3"/>'


def lines(x, y, widths, cls="s-ln", gap=16):
    return "".join(ln(x, y + i * gap, w, cls) for i, w in enumerate(widths))


def arrow(x1, y1, x2, y2):
    import math
    a = math.atan2(y2 - y1, x2 - x1)
    hx1, hy1 = x2 - 10 * math.cos(a - 0.45), y2 - 10 * math.sin(a - 0.45)
    hx2, hy2 = x2 - 10 * math.cos(a + 0.45), y2 - 10 * math.sin(a + 0.45)
    return (f'<path class="s-ar" d="M{x1},{y1} L{x2},{y2}"/>'
            f'<path class="s-ar" d="M{hx1:.1f},{hy1:.1f} L{x2},{y2} L{hx2:.1f},{hy2:.1f}"/>')


def lab(x, y, text, anchor="middle"):
    return f'<text class="s-lab" x="{x}" y="{y}" text-anchor="{anchor}">{text}</text>'


# --- gdocs-suggest: a draft, then the same draft after one run ------------------------
def gdocs():
    b = []
    # left page
    b.append('<rect class="s-paper" x="50" y="40" width="260" height="360" rx="8"/>')
    b.append(ln(74, 66, 130, "s-ink", 10))
    b.append(lines(74, 100, [210, 200, 150]))
    b.append(ln(74, 160, 110))
    b.append('<rect class="s-dash" x="192" y="153" width="70" height="20" rx="4"/><text class="s-mono" x="227" y="167" text-anchor="middle">{TBC}</text>')
    b.append(lines(74, 204, [210, 205, 120]))
    b.append(lines(74, 268, [210, 190, 165]))
    b.append(lines(74, 332, [210, 140]))
    # arrow
    b.append(arrow(330, 220, 412, 220))
    b.append(f'<text class="s-lab" x="371" y="206" text-anchor="middle">one run</text>')
    # right page
    X = 430
    b.append(f'<rect class="s-paper" x="{X}" y="40" width="260" height="360" rx="8"/>')
    b.append(ln(X + 24, 66, 130, "s-ink", 10))
    # para 1 with a suggestion: struck word, green insert; plus a highlighted span for the comment
    b.append(f'<rect class="s-tint" x="{X+20}" y="112" width="150" height="14" rx="3"/>')
    b.append(ln(X + 24, 100, 60) + ln(X + 88, 100, 34) + f'<line class="s-strike" x1="{X+86}" y1="103" x2="{X+124}" y2="103"/>'
             + ln(X + 126, 100, 34, "s-green") + ln(X + 164, 100, 70))
    b.append(lines(X + 24, 116, [200, 150]))
    # para 2: TBC stays, red fill below
    b.append(ln(X + 24, 160, 110))
    b.append(f'<rect class="s-dash" x="{X+142}" y="153" width="70" height="20" rx="4"/><text class="s-mono" x="{X+177}" y="167" text-anchor="middle">{{TBC}}</text>')
    b.append(lines(X + 24, 182, [210, 150], "s-red"))
    # para 3: original, then red rewrite below
    b.append(lines(X + 24, 216, [210, 205, 120]))
    b.append(lines(X + 24, 266, [210, 196, 90], "s-red"))
    # para 4
    b.append(lines(X + 24, 330, [210, 140]))
    # margin comment
    b.append(f'<path class="s-thin" d="M{X+170},{119} L{X+272},{108}"/>')
    b.append(f'<rect class="s-box" x="{X+272}" y="84" width="88" height="62" rx="8"/>')
    b.append(f'<text class="s-tag" x="{X+284}" y="102">[Claude]</text>')
    b.append(lines(X + 284, 112, [64, 46], "s-ln", 12))
    b.append(lab(180, 432, "Your draft"))
    b.append(lab(560, 432, "After Claude"))
    return svg("".join(b), "A draft on the left. On the right, the same draft after one run: a suggested word change in green, new text in red under the originals, and a margin comment marked [Claude].")


# --- zotero-librarian: messy input, two routes, one clean record ----------------------
def zotero():
    b = []
    # chat bubble
    b.append('<rect class="s-box" x="30" y="150" width="190" height="110" rx="14"/>')
    b.append(lines(52, 176, [146, 120, 84]))
    b.append('<rect class="s-teal" x="140" y="220" width="2.5" height="16"/>')
    b.append(lab(125, 290, "A title, link or DOI"))
    # two routes
    b.append(arrow(225, 190, 300, 135))
    b.append(arrow(225, 225, 300, 300))
    b.append('<rect class="s-paper" x="305" y="95" width="170" height="80" rx="8"/>')
    b.append(lines(325, 117, [90, 120, 70]))
    b.append(lab(390, 82, "Exact lookup"))
    b.append('<rect class="s-paper" x="305" y="262" width="170" height="80" rx="8"/>')
    b.append('<circle class="s-thin" cx="338" cy="296" r="13"/><path class="s-thin" d="M347,305 L358,316"/>')
    b.append(lines(368, 284, [86, 70, 92]))
    b.append(lab(390, 370, "Web research"))
    # merge to record card
    b.append(arrow(480, 135, 548, 200))
    b.append(arrow(480, 300, 548, 236))
    b.append('<rect class="s-box" x="555" y="120" width="210" height="200" rx="10"/>')
    rows = [(56, 120), (40, 100), (48, 130), (36, 70), (52, 110)]
    for i, (lw, vw) in enumerate(rows):
        y = 146 + i * 32
        b.append(ln(575, y, lw, "s-teal", 6) + ln(575 + lw + 12, y, vw))
    b.append(lab(660, 350, "A clean Zotero record"))
    return svg("".join(b), "A messy request on the left goes either to an exact lookup or to web research, and both routes end in one clean Zotero record on the right.")


# --- skill-release: your skill, checked, a clean copy, public ------------------------
def release():
    b = []

    def folder(x, y, rows, dots=()):
        out = [f'<path class="s-paper" d="M{x},{y+14} q0,-14 14,-14 h52 l12,14 h98 q14,0 14,14 v176 q0,14 -14,14 h-162 q-14,0 -14,-14 z"/>']
        for i, w in enumerate(rows):
            yy = y + 42 + i * 26
            out.append(ln(x + 22, yy, w))
            if i in dots:
                out.append(f'<circle class="s-red" cx="{x + 30 + w}" cy="{yy + 3}" r="5"/>')
        return "".join(out)

    b.append(folder(30, 110, [120, 96, 132, 84, 110, 70], dots=(1, 3)))
    b.append(lab(125, 362, "Your skill"))
    b.append(arrow(232, 215, 292, 215))
    # check panel
    b.append('<rect class="s-box" x="300" y="120" width="180" height="190" rx="10"/>')
    for i in range(4):
        y = 150 + i * 36
        b.append(f'<path class="s-ar" d="M322,{y} l7,7 l13,-14"/>' + ln(354, y - 3, 100 - (i % 2) * 24))
    b.append(lab(390, 340, "Check and clean"))
    # private scrub list, stays behind
    b.append('<rect class="s-dash" x="322" y="30" width="136" height="46" rx="8"/>')
    b.append('<rect class="s-thin" x="337" y="48" width="18" height="14" rx="2"/><path class="s-thin" d="M341,48 v-5 a5,5 0 0 1 10,0 v5"/>')
    b.append(lines(364, 46, [78, 60], "s-ln", 12))
    b.append('<path class="s-thin" d="M390,80 L390,116" stroke-dasharray="4 4"/>')
    b.append(arrow(488, 215, 548, 215))
    b.append(folder(555, 110, [120, 96, 132, 84, 110, 70]))
    b.append('<circle class="s-teal" cx="735" cy="132" r="13"/><path d="M729,132 l4,4 l8,-9" fill="none" stroke="var(--surface,#fff)" stroke-width="2.5" stroke-linecap="round"/>')
    b.append(lab(650, 362, "Public copy"))
    return svg("".join(b), "Your skill on the left has two private details marked in red. A check, using a private list that stays behind, cleans them out, and a clean public copy comes out on the right.")



def bubble(x, y, w, h, widths, cls="s-box"):
    return f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="12"/>' + lines(x + 16, y + 18, widths, gap=14)


# --- research-content: one question, independent scouts, a numbered list you steer -----
def research():
    b = [bubble(30, 175, 170, 80, [130, 100, 70])]
    b.append(lab(115, 285, "Your question"))
    icons = [
        '<path class="s-teal" d="M{x},{y} l14,8 l-14,8 z"/>',                                  # video
        '<rect class="s-thin" x="{x}" y="{y}" width="18" height="13" rx="3"/><path class="s-thin" d="M{x1},{y2} l0,5 l5,-5"/>',  # comment
        '<rect class="s-thin" x="{x}" y="{y}" width="14" height="18" rx="2"/>',                 # paper
        '<circle class="s-thin" cx="{cx}" cy="{cy}" r="9"/><path class="s-thin" d="M{x},{cy} h18 M{cx},{y} v18"/>',  # world
    ]
    names = ["Videos", "Forums", "Papers", "Other languages"]
    for i in range(4):
        y = 70 + i * 82
        b.append(arrow(205, 215, 262, y + 24))
        b.append(f'<rect class="s-paper" x="270" y="{y}" width="190" height="50" rx="8"/>')
        x, yy = 284, y + 16
        b.append(icons[i].format(x=x, y=yy, x1=x + 4, y2=yy + 13, cx=x + 9, cy=yy + 9))
        b.append(f'<text class="s-lab" x="314" y="{y + 30}" style="font-size:13px">{names[i]}</text>')
        b.append(arrow(465, y + 24, 538, 120 + i * 50))
    # numbered leads
    b.append('<rect class="s-box" x="545" y="90" width="220" height="230" rx="10"/>')
    for i in range(6):
        y = 116 + i * 34
        b.append(f'<text class="s-tag" x="562" y="{y + 7}" style="font-size:12px">{i + 1}</text>' + ln(580, y, 150 - (i % 3) * 22))
        b.append(ln(580, y + 12, 90 - (i % 2) * 20))
    b.append(lab(655, 350, "Leads you steer"))
    # steer loop
    b.append('<path class="s-ar" d="M655,358 C655,420 115,420 115,300" stroke-dasharray="6 6"/>')
    b.append('<path class="s-ar" d="M108,309 L115,298 L122,309"/>')
    b.append(lab(385, 438, "\u201cmore like 2 and 5\u201d"))
    return svg("".join(b), "A question goes out to four independent search agents (videos, forums, papers, other languages). Their finds come back as one numbered list of leads, and your reply sends the next round.")


# --- writing-for-humans: a cluttered draft becomes a page with the point first -----------
def writing():
    b = ['<rect class="s-paper" x="50" y="40" width="260" height="360" rx="8"/>']
    y = 66
    for i, w in enumerate([210, 205, 198, 210, 160, 0, 210, 190, 205, 210, 120, 0, 210, 200, 185, 210, 140, 0, 205, 150]):
        if w:
            b.append(ln(74, y, 170 if i == 14 else w, "s-ink" if i == 14 else "s-ln", 7 if i == 14 else 6))
        y += 16
    b.append(lab(180, 432, "The draft"))
    b.append(arrow(330, 220, 412, 220))
    b.append('<text class="s-lab" x="371" y="206" text-anchor="middle">triage</text>')
    X = 430
    b.append(f'<rect class="s-paper" x="{X}" y="40" width="260" height="360" rx="8"/>')
    b.append(f'<rect class="s-tint" x="{X+16}" y="56" width="228" height="22" rx="4"/>' + ln(X + 24, 64, 170, "s-ink", 7))
    b.append(lines(X + 24, 96, [210, 160]))
    b.append(f'<rect class="s-box" x="{X+20}" y="138" width="220" height="64" rx="8"/>')
    b.append(f'<text class="s-tag" x="{X+34}" y="160" style="font-size:12px">1</text>' + ln(X + 50, 154, 150, "s-ink", 6))
    b.append(ln(X + 50, 168, 120))
    b.append(f'<text class="s-tag" x="{X+34}" y="190" style="font-size:12px">2</text>' + ln(X + 50, 184, 140, "s-ink", 6))
    b.append(lines(X + 24, 226, [120, 150, 100], "s-ln", 16))
    b.append(lab(560, 432, "Point first, asks with defaults"))
    # reader card
    b.append(f'<rect class="s-dash" x="{X+272}" y="56" width="92" height="50" rx="6"/>')
    b.append(f'<circle class="s-thin" cx="{X+290}" cy="76" r="8"/><path class="s-thin" d="M{X+278},98 q12,-12 24,0"/>')
    b.append(lines(X + 308, 70, [44, 34], "s-ln", 12))
    b.append(f'<text class="s-lab" x="{X+318}" y="124" text-anchor="middle" style="font-size:13px">Reader</text>')
    return svg("".join(b), "A long, cluttered draft on the left. On the right, the same piece rewritten for its reader: the point first, then numbered asks with defaults, then short supporting lines.")


# --- preclear: live threads saved before /clear, read back after ---------------------------
def preclear():
    b = []
    for i, (w, live) in enumerate([(150, False), (120, True), (160, False), (100, False), (140, True), (130, False), (110, True)]):
        y = 50 + i * 44
        x = 40 if i % 2 == 0 else 70
        b.append(f'<rect class="s-paper" x="{x}" y="{y}" width="{w + 30}" height="32" rx="10"/>' + ln(x + 14, y + 13, w))
        if live:
            b.append(f'<circle class="s-teal" cx="{x + w + 42}" cy="{y + 16}" r="6"/>')
    b.append(lab(140, 385, "The conversation"))
    b.append(arrow(280, 205, 338, 205))
    b.append('<path class="s-paper" d="M345,110 h120 l24,24 v172 h-144 z"/>')
    b.append('<text class="s-mono" x="360" y="132">open_threads.md</text>')
    for i in range(3):
        y = 150 + i * 46
        b.append(f'<circle class="s-teal" cx="364" cy="{y + 3}" r="5"/>' + ln(376, y, 90, "s-ink", 6) + ln(376, y + 14, 70))
    b.append(lab(417, 338, "Saved threads"))
    # clear divider
    b.append('<path class="s-thin" d="M520,60 V380" stroke-dasharray="6 6"/>')
    b.append('<text class="s-mono" x="520" y="46" text-anchor="middle">/clear</text>')
    # new session
    b.append(arrow(495, 205, 552, 205))
    b.append('<rect class="s-box" x="560" y="110" width="200" height="190" rx="10"/>')
    b.append('<rect class="s-tint" x="574" y="124" width="172" height="86" rx="6"/>')
    for i in range(3):
        y = 138 + i * 24
        b.append(f'<circle class="s-teal" cx="588" cy="{y + 3}" r="4"/>' + ln(598, y, 110, "s-ink", 6))
    b.append(lines(578, 230, [150, 120, 90]))
    b.append(lab(660, 338, "The next session"))
    return svg("".join(b), "Three live threads in a long conversation are saved to open_threads.md before /clear, and the next session starts by reading them.")


# --- find-session: many past sessions, one checked match with a resume command --------------
def findsess():
    b = [bubble(30, 60, 200, 64, [150, 110], "s-box")]
    b.append(lab(130, 150, "What you remember"))
    for r in range(4):
        for c in range(4):
            x, y = 262 + c * 62, 190 + r * 50
            hit = (r, c) == (2, 3)
            b.append(f'<rect class="{"s-box" if hit else "s-paper"}" x="{x}" y="{y}" width="50" height="38" rx="5"/>' + ln(x + 8, y + 12, 34, "s-teal" if hit else "s-ln", 5) + ln(x + 8, y + 23, 24, "s-ln", 5))
    b.append(lab(380, 420, "Your past sessions"))
    b.append(arrow(232, 92, 300, 170))
    b.append(arrow(500, 309, 554, 262))
    b.append('<rect class="s-box" x="560" y="130" width="210" height="170" rx="10"/>')
    rows = [("MATCH", 120), ("project", 100), ("session", 110), ("evidence", 90)]
    for i, (k, w) in enumerate(rows):
        y = 156 + i * 26
        b.append(f'<text class="s-mono" x="576" y="{y + 6}">{k}</text>' + ln(640, y, w - 30, "s-ink" if i == 0 else "s-ln", 6))
    b.append('<rect class="s-tint" x="572" y="262" width="186" height="26" rx="5"/><text class="s-mono" x="582" y="279">claude --resume …</text>')
    b.append(lab(665, 330, "One checked answer"))
    return svg("".join(b), "A half-remembered description is searched against many past sessions, and one checked match comes back with its project, session, evidence and the command to resume it.")


for slug, fn in [("gdocs-suggest", gdocs), ("zotero-librarian", zotero), ("skill-release", release),
                 ("research-content", research), ("writing-for-humans", writing), ("preclear", preclear),
                 ("find-session", findsess)]:
    (OUT / slug / "demo").mkdir(parents=True, exist_ok=True)
    (OUT / slug / "demo" / "header.svg").write_text(fn())
    print("wrote", OUT / slug / "demo" / "header.svg")
