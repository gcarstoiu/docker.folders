# Docker Folders — design handoff

Design package for grouping Docker containers into folders on Unraid, ready to hand to
Claude Code.

| Path | What it is |
|---|---|
| `CLAUDE.md` | Brief Claude Code reads automatically when started in this folder |
| `DESIGN_SPEC.md` | Full behaviour and layout spec, data model, open decisions, acceptance checklist |
| `prototype/index.html` | Standalone interactive prototype (open in any browser, no install) |
| `screenshots/` | Key states of the prototype |
| `design-tokens.json` | Colours, type, sizes, motion |
| `folders.example.json` | Example folder definitions |
| `source/Main.dc.html` | Original design-canvas source (runs only inside the canvas) |

## Use it with Claude Code

Unzip, go into the folder and start Claude Code there:

```bash
unzip docker-folders-handoff.zip
cd docker-folders-handoff
claude
```

A first prompt that works with the brief:

```text
Read CLAUDE.md and DESIGN_SPEC.md, open prototype/index.html, then ask me the open
decisions in §13 before proposing an implementation plan.
```

The prototype fakes all Docker actions and icon downloads; nothing in this folder
touches a server.
