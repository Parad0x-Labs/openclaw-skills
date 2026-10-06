#!/usr/bin/env python3
"""Parad0x Labs README banner (matches parad0xlabs.com tokens). Usage:
make_banner.py OUT.svg "EYEBROW" "Title" "One-line value proposition" "chip1|chip2|chip3"
Chips may start with '+' to render in the accent colour (use for real, current status only)."""
import sys, html
out, eyebrow, title, sub, chips = sys.argv[1:6]
P, INK, MUTED, LINE, GREEN, PANEL = "#0a0a0a", "#f0efeb", "#a3a3a3", "#303030", "#92aa7c", "#111111"
W, H = 1280, 360
e = html.escape
chip_svg, x = [], 80
for c in [c for c in chips.split("|") if c]:
    hot = c.startswith("+"); c = c.lstrip("+")
    w = 22 + len(c) * 9.2
    col = GREEN if hot else MUTED
    chip_svg.append(f'<g transform="translate({x:.0f},270)"><rect width="{w:.0f}" height="34" rx="17" fill="{PANEL}" stroke="{col}" stroke-opacity="{0.9 if hot else 0.5}"/>'
                    f'<text x="{w/2:.0f}" y="22" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-size="14" fill="{col}">{e(c)}</text></g>')
    x += w + 12
# Georgia renders "0" as an old-style figure that reads like "o"; set it in monospace, as in the wordmark.
title_svg = e(title).replace("0", '<tspan font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-style="normal" font-size="64">0</tspan>')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{e(title)} — {e(sub)}">
<rect width="{W}" height="{H}" fill="{P}"/>
<g stroke="{LINE}" stroke-width="1"><line x1="80" y1="62" x2="{W-80}" y2="62"/><line x1="80" y1="{H-30}" x2="{W-80}" y2="{H-30}"/></g>
<g stroke="{LINE}" stroke-width="1" fill="none" opacity="0.9">
  <circle cx="{W-210}" cy="170" r="96"/><circle cx="{W-210}" cy="170" r="64"/><circle cx="{W-210}" cy="170" r="32"/>
  <line x1="{W-306}" y1="170" x2="{W-114}" y2="170"/><line x1="{W-210}" y1="74" x2="{W-210}" y2="266"/>
</g>
<circle cx="{W-178}" cy="138" r="5" fill="{GREEN}"/>
<text x="80" y="48" font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-size="14" letter-spacing="2" fill="{MUTED}">{e(eyebrow.upper())}</text>
<text x="{W-80}" y="48" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="20" fill="{INK}">Parad<tspan font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-style="normal" font-size="17">0</tspan>x Labs</text>
<text x="78" y="160" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="76" fill="{INK}">{title_svg}</text>
<text x="80" y="215" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="{MUTED}">{e(sub)}</text>
{''.join(chip_svg)}
</svg>'''
open(out, "w").write(svg)
print("wrote", out, len(svg), "bytes")
