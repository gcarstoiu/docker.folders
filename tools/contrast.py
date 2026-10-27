#!/usr/bin/env python3
"""Check the token pairs in styles/tokens.css against WCAG 2 contrast ratios.

DESIGN_SPEC.md 14 requires that no text pair falls below 4.5:1 (normal text)
and that large/non-text indicators clear 3:1. The design handoff shipped with
one known failure (#6F7782 at 3.74:1); this guards against reintroducing it,
and covers the light themes the handoff never measured.

Usage:  python3 tools/contrast.py [--quiet]
Exit status is non-zero if any pair fails.
"""
import re, sys, pathlib

CSS = pathlib.Path(__file__).resolve().parent.parent / "src/usr/local/emhttp/plugins/simple.folders/styles/tokens.css"

def srgb(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def luminance(hexcolor):
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)

def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)

def parse_blocks(text):
    """Return {selector: {var: value}} for each .sf-root rule."""
    # Strip comments first: they mention .sf-root in prose, which would
    # otherwise be matched as a selector.
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    blocks = {}
    for m in re.finditer(r"(\.sf-root[^{]*)\{([^}]*)\}", text, re.S):
        sel = m.group(1).strip()
        vars_ = dict(re.findall(r"(--sf-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})", m.group(2)))
        if vars_:
            blocks[sel] = vars_
    return blocks

# (foreground token, background token, minimum ratio, label)
TEXT = 4.5
UI   = 3.0
PAIRS = [
    ("--sf-text",           "--sf-bg-card",    TEXT, "body text on the table card"),
    ("--sf-text",           "--sf-bg-folder",  TEXT, "body text on a folder row"),
    ("--sf-text",           "--sf-bg-popover", TEXT, "menu item text"),
    ("--sf-text",           "--sf-bg-dialog",  TEXT, "dialog text"),
    ("--sf-text-secondary", "--sf-bg-card",    TEXT, "secondary text on the card"),
    ("--sf-text-muted",     "--sf-bg-card",    TEXT, "muted text on the card"),
    ("--sf-text-muted",     "--sf-bg-folder",  TEXT, "muted text on a folder row"),
    ("--sf-text-dim",       "--sf-bg-folder",  TEXT, "dim labels on a folder row"),
    ("--sf-text-dim",       "--sf-bg-card",    TEXT, "dim labels on the card"),
    ("--sf-text-faint",     "--sf-bg-card",    TEXT, "faint labels (column heads)"),
    ("--sf-running-text",   "--sf-bg-card",    TEXT, "'Running' label"),
    ("--sf-running-text",   "--sf-bg-folder",  TEXT, "'x of y running' on a folder row"),
    ("--sf-paused-text",    "--sf-bg-card",    TEXT, "'Paused' label"),
    ("--sf-busy-text",      "--sf-bg-card",    TEXT, "busy label"),
    ("--sf-warn-fg",        "--sf-warn-bg",    TEXT, "'Update ready' badge"),
    ("--sf-danger-fg",      "--sf-bg-popover", TEXT, "'Delete folder' menu item"),
    ("--sf-warn-fg",        "--sf-bg-popover", TEXT, "'Force update' menu item"),
    ("--sf-accent",         "--sf-bg-card",    TEXT, "accent text/links"),
    ("--sf-accent-soft-fg", "--sf-accent-soft-bg", TEXT, "accent chip"),
    ("--sf-on-accent",      "--sf-accent",     TEXT, "primary button label"),
    ("--sf-accent-chip-fg", "--sf-bg-card",    TEXT, "chip text on the card"),
    ("--sf-on-brand",       "--sf-brand",      TEXT, "'Add container' label"),
    ("--sf-on-brand",       "--sf-brand-hover",TEXT, "'Add container' label, hovered"),
    ("--sf-brand-border",   "--sf-bg-card",    UI,   "'Add container' edge"),
    # Non-text indicators: shape also carries the meaning, so 3:1 applies.
    ("--sf-running",        "--sf-bg-folder",  UI,   "running dot"),
    ("--sf-paused",         "--sf-bg-folder",  UI,   "paused bars"),
    ("--sf-stopped-ring",   "--sf-bg-folder",  UI,   "stopped ring"),
    ("--sf-accent",         "--sf-bg-card",    UI,   "focus ring"),
    ("--sf-border-control", "--sf-bg-card",    UI,   "control border"),
    ("--sf-switch-on",      "--sf-bg-card",    UI,   "switch, on"),
    ("--sf-switch-off",     "--sf-bg-card",    UI,   "switch, off"),
    ("--sf-switch-off",     "--sf-bg-folder",  UI,   "switch, off, on a folder row"),
    ("--sf-border-control", "--sf-bg-dialog",  UI,   "control border in a dialog"),
    ("--sf-border-control", "--sf-bg-input",   UI,   "input border"),
    ("--sf-switch-knob",    "--sf-switch-off", UI,   "switch knob, off"),
    ("--sf-switch-knob",    "--sf-switch-on",  UI,   "switch knob, on"),
]

GLYPHS = ["slate", "blue", "teal", "green", "amber", "orange", "rose", "violet"]

def main():
    quiet = "--quiet" in sys.argv
    blocks = parse_blocks(CSS.read_text())
    base = blocks.get(".sf-root", {})
    failures = []

    for sel, overrides in blocks.items():
        tokens = {**base, **overrides}
        theme = "dark (black, gray)" if sel == ".sf-root" else sel.split('"')[1]
        rows = []

        checks = list(PAIRS) + [
            (f"--sf-{g}-glyph", f"--sf-{g}-tile", UI, f"{g} folder glyph") for g in GLYPHS
        ]
        for fg, bg, minimum, label in checks:
            if fg not in tokens or bg not in tokens:
                continue
            r = ratio(tokens[fg], tokens[bg])
            ok = r >= minimum
            if not ok:
                failures.append((theme, label, tokens[fg], tokens[bg], r, minimum))
            rows.append((ok, r, minimum, label, tokens[fg], tokens[bg]))

        if not quiet:
            print(f"\n=== {theme} ===")
            for ok, r, minimum, label, fg, bg in rows:
                print(f"  {'ok ' if ok else 'FAIL'} {r:5.2f}:1 (min {minimum:.1f})  {label:38s} {fg} on {bg}")

    print()
    if failures:
        print(f"{len(failures)} pair(s) below the required ratio:")
        for theme, label, fg, bg, r, minimum in failures:
            print(f"  [{theme}] {label}: {fg} on {bg} = {r:.2f}:1, needs {minimum:.1f}:1")
        return 1
    print("all token pairs pass")
    return 0

if __name__ == "__main__":
    sys.exit(main())
