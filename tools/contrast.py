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

CSS = pathlib.Path(__file__).resolve().parent.parent / "src/usr/local/emhttp/plugins/docker.folders/styles/tokens.css"

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
    """Return {selector: {var: value}} for each .df-root rule."""
    # Strip comments first: they mention .df-root in prose, which would
    # otherwise be matched as a selector.
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    blocks = {}
    for m in re.finditer(r"(\.df-root[^{]*)\{([^}]*)\}", text, re.S):
        sel = m.group(1).strip()
        vars_ = dict(re.findall(r"(--df-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})", m.group(2)))
        if vars_:
            blocks[sel] = vars_
    return blocks

# (foreground token, background token, minimum ratio, label)
TEXT = 4.5
UI   = 3.0
PAIRS = [
    ("--df-text",           "--df-bg-card",    TEXT, "body text on the table card"),
    ("--df-text",           "--df-bg-folder",  TEXT, "body text on a folder row"),
    ("--df-text",           "--df-bg-popover", TEXT, "menu item text"),
    ("--df-text",           "--df-bg-dialog",  TEXT, "dialog text"),
    ("--df-text-secondary", "--df-bg-card",    TEXT, "secondary text on the card"),
    ("--df-text-muted",     "--df-bg-card",    TEXT, "muted text on the card"),
    ("--df-text-muted",     "--df-bg-folder",  TEXT, "muted text on a folder row"),
    ("--df-text-dim",       "--df-bg-folder",  TEXT, "dim labels on a folder row"),
    ("--df-text-dim",       "--df-bg-card",    TEXT, "dim labels on the card"),
    ("--df-text-faint",     "--df-bg-card",    TEXT, "faint labels (column heads)"),
    ("--df-running-text",   "--df-bg-card",    TEXT, "'Running' label"),
    ("--df-running-text",   "--df-bg-folder",  TEXT, "'x of y running' on a folder row"),
    ("--df-paused-text",    "--df-bg-card",    TEXT, "'Paused' label"),
    ("--df-busy-text",      "--df-bg-card",    TEXT, "busy label"),
    ("--df-warn-fg",        "--df-warn-bg",    TEXT, "'Update ready' badge"),
    ("--df-danger-fg",      "--df-bg-popover", TEXT, "'Delete folder' menu item"),
    ("--df-warn-fg",        "--df-bg-popover", TEXT, "'Force update' menu item"),
    ("--df-accent",         "--df-bg-card",    TEXT, "accent text/links"),
    ("--df-accent-soft-fg", "--df-accent-soft-bg", TEXT, "accent chip"),
    ("--df-on-accent",      "--df-accent",     TEXT, "primary button label"),
    ("--df-accent-chip-fg", "--df-bg-card",    TEXT, "chip text on the card"),
    ("--df-on-brand",       "--df-brand",      TEXT, "'Add container' label"),
    ("--df-on-brand",       "--df-brand-hover",TEXT, "'Add container' label, hovered"),
    ("--df-brand-border",   "--df-bg-card",    UI,   "'Add container' edge"),
    # Non-text indicators: shape also carries the meaning, so 3:1 applies.
    ("--df-running",        "--df-bg-folder",  UI,   "running dot"),
    ("--df-paused",         "--df-bg-folder",  UI,   "paused bars"),
    ("--df-stopped-ring",   "--df-bg-folder",  UI,   "stopped ring"),
    ("--df-accent",         "--df-bg-card",    UI,   "focus ring"),
    ("--df-border-control", "--df-bg-card",    UI,   "control border"),
    ("--df-switch-on",      "--df-bg-card",    UI,   "switch, on"),
    ("--df-switch-off",     "--df-bg-card",    UI,   "switch, off"),
    ("--df-switch-off",     "--df-bg-folder",  UI,   "switch, off, on a folder row"),
    ("--df-border-control", "--df-bg-dialog",  UI,   "control border in a dialog"),
    ("--df-border-control", "--df-bg-input",   UI,   "input border"),
    ("--df-switch-knob",    "--df-switch-off", UI,   "switch knob, off"),
    ("--df-switch-knob",    "--df-switch-on",  UI,   "switch knob, on"),
]

GLYPHS = ["slate", "blue", "teal", "green", "amber", "orange", "rose", "violet"]

def main():
    quiet = "--quiet" in sys.argv
    blocks = parse_blocks(CSS.read_text())
    base = blocks.get(".df-root", {})
    failures = []

    for sel, overrides in blocks.items():
        tokens = {**base, **overrides}
        theme = "dark (black, gray)" if sel == ".df-root" else sel.split('"')[1]
        rows = []

        checks = list(PAIRS) + [
            (f"--df-{g}-glyph", f"--df-{g}-tile", UI, f"{g} folder glyph") for g in GLYPHS
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
