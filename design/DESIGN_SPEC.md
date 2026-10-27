# Docker Folders for Unraid — design specification

Status: design handoff, 2026-10-27. Source of truth for behaviour is this file plus
`prototype/index.html`. Screenshots in `screenshots/` show the prototype's key states.

The prototype **simulates** every Docker operation, the web icon lookup and the icon
download (timers and fake data). Nothing in it talks to Docker or the network.

---

## 1. Goal

A no-code way to group Docker containers on the Unraid Docker page:

1. Name a folder.
2. Choose which containers belong to it.
3. Group the containers in the folder while still showing their icons when folded.
4. Unfold the folder to see the full container rows.
5. Give the folder an icon: built-in, fetched from the web (automatic by name, or by URL),
   or reused from a member container.
6. Run commands on the whole folder from its icon: start, stop, restart, pause/resume,
   check for updates, update, force update.
7. Extras agreed during design: start order, start delay, reverse-order stop,
   auto-add rules, folder status summary, folder-level autostart, per-container menu
   from the folded icons, progress panel, confirmations.

## 2. Prior art (check before building)

Two existing Unraid plugins cover much of this. Findings below come from their app
pages and the FolderView3 forum thread as read on 2026-10-26; their docs and code
were **not** inspected.

| Plugin | Maintainer | Listed features (from app page) | Requires |
|---|---|---|---|
| FolderView3 | chodeus (fork of FolderView2 / folder.view) | Folders for Docker and VMs, auto-assign by regex or Docker label (`folder.view3`), colours, custom actions, WebUI links, drag-and-drop order, bulk start/stop/restart/pause, custom autostart order, JSON backup | Unraid 7.0+ |
| FolderView Plus | alexphillips-dev | Nested folders, custom icons, folder actions, assignment rules, templates, scheduled backups | Unraid 7.0+ |

Not confirmed in either listing: "force update every container in a folder" and
"download a folder icon from the web by name". Treat those as possible gaps, not
confirmed ones.

Sources:
- https://forums.unraid.net/topic/197223-plugin-folderview3/
- https://ca.unraid.net/apps/folderview3-11rday51j5cf8p
- https://ca.unraid.net/apps/folderview-plus-0z54b3k188hf1w

## 3. Screen anatomy (Docker page)

```
┌ header ─────────────────────────────────────────────────────────────────────────┐
│ UNRAID · DOCKER                                  [Filter…] [Unfold all] [+ New folder] │
│ Containers                                                                          │
│ 16 containers · 13 running · 3 folders · 4 updates ready                            │
└─────────────────────────────────────────────────────────────────────────────────┘
┌ table card ─────────────────────────────────────────────────────────────────────┐
│    CONTAINER              STATUS   VERSION   PORT  CPU  MEMORY  AUTOSTART     │
│ ›  [▣] Media 5 containers  4 of 5…  2 updates  —   6.9%  1.6 GB   (◐) Mixed  ⋮ │
│        [P][Q][P][S][R]     ▬▬ ▬▬                                               │  ← folded: icon strip
│ ⌄  [⌂] Smart home           …                                                  │
│    │ 1 [M] mosquitto       ● Running …                                    ⋮ │  ← unfolded: container rows
│    │ 2 [Z] zigbee2mqtt     ‖ Paused  …                                    ⋮ │
│    NOT IN A FOLDER · 6                                                         │
│       [N] nextcloud        ● Running  Update ready  :443 …                ⋮ │
└─────────────────────────────────────────────────────────────────────────────────┘
Tip: a folder's icon opens its commands · each container icon opens that container's menu · the folder name unfolds it
```

### 3.1 Table columns

Grid template (prototype): `40px minmax(280px, 1fr) 150px 124px 84px 72px 92px 104px 44px`,
column gap 10px, row side padding 12px. The table has `min-width: 1100px` and scrolls
horizontally inside its card on narrower screens.

| # | Column | Folder row | Container row |
|---|---|---|---|
| 1 | (chevron / tree) | Fold/unfold button | Vertical tree line (in a folder) or empty |
| 2 | Container | Folder icon, name, count, icon strip or sub-line | Start-order number, icon, name, image |
| 3 | Status | "x of y running" + segmented bar | Status dot + text |
| 4 | Version | "n updates" badge or "Up to date" | "Update ready" badge or "Up to date" |
| 5 | Port | "—" | `:port` |
| 6 | CPU | Sum of running members | Value or "—" when not running |
| 7 | Memory | Sum of running members | Value or "—" when not running |
| 8 | Autostart | Tri-state switch (All on / All off / Mixed) | Switch (On / Off) |
| 9 | (menu) | ⋮ folder menu | ⋮ container menu |

## 4. Folder row

### 4.1 Folded (the main requirement)

- **Line 1:** folder name (15px, semibold, ellipsis) + muted count ("3 containers").
- **Line 2:** the **icon strip**: one button per member container, in start order,
  **all of them, no cap, no "+N"**. Icons sit on their own line under the name, never
  beside it (side-by-side broke the row when the column was at its minimum width: only
  two icons fitted). When there are more than fit, the strip wraps onto another line
  and the row grows; it never overlaps other columns.
- Each strip button: 38×38 hit area, 30×30 tile, 8px radius, letter or app icon,
  status dot (11px, bottom-right, ringed in the row colour) unless the folder's preview
  mode is "Icons only". Tooltip `name · Status`. `aria-label` "Actions for <name>, <status>".
- **Clicking a strip icon opens that container's menu** (§6.2), anchored to the icon,
  left-aligned.
- Preview modes (folder setting): `status` = icons + status dots (default),
  `icons` = icons only, `count` = no strip; line 2 shows the sub-line instead.

### 4.2 Unfolded

- Line 2 becomes the sub-line: "5 containers · starts 5 s apart" (delay part omitted
  when delay is 0).
- The icon strip is hidden; member container rows appear below the folder row, indented,
  with a tree line in column 1 and the start-order number before each icon.

### 4.3 Controls on the folder row

| Control | Action |
|---|---|
| Chevron (col 1) | Fold / unfold. `aria-expanded` reflects state. Rotates 90° when open. |
| Folder name | Fold / unfold (mouse convenience; not a separate tab stop). |
| **Folder icon** (40×40, 10px radius) | Opens the **folder command menu**, left-aligned under the icon. Hover ring 2px accent. |
| ⋮ (col 9) | Opens the same folder menu, right-aligned. |
| Autostart switch | All members on if not all on; otherwise all off. Shows "Mixed" with a centred knob when members differ. |

### 4.4 Status summary

- Text: "x of y running"; green when all running; while any member is busy:
  "Working… x of y up" in busy blue.
- Segmented bar (100×4px): one segment per member, coloured by its status.
- Version: "n update(s)" badge when any member has an update; else muted "Up to date".
- CPU / Memory: sums over running members; "—" when none running.
  Memory shows MB under 1000, else GB with one decimal.

## 5. Container row

- Icon tile 32×32, name (500 weight), image name (12px muted) below.
- Status: running = filled green dot; stopped = hollow grey ring; paused = two amber bars;
  busy = spinning blue ring + the busy label ("Stopping…", "Pulling image…", …).
  Shape differs per state, so colour is never the only signal.
- Autostart switch; ⋮ container menu.
- "Not in a folder" section lists containers in no folder, under a mono uppercase label
  with the count.

## 6. Menus

Popover: 260px wide, max-height 76vh with scroll, opens below the trigger (or above when
there is no room below), closes on outside click, on Escape (focus returns to the
trigger) and after choosing an item. While any job is running, every Docker action is
disabled.

### 6.1 Folder menu

Header: folder name. Items, with enable rules:

| Item | Hint | Enabled when |
|---|---|---|
| Start all | "n stopped" / "all up" | some member stopped |
| Stop all | "reverse order" if set | some member running or paused |
| Restart all | "n running" | some member running |
| Pause all *or* Resume all | "n paused" | Pause: some running, none paused. Resume: some paused |
| — | | |
| Check for updates | | folder not empty |
| Update n containers | "ready" | shown only when n > 0 |
| Force update all (warning colour) | member count | folder not empty → opens confirmation (§8) |
| — | | |
| Open WebUIs | running count | some member running |
| Edit folder… | | always |
| Move folder up / down | | not first / not last |
| — | | |
| Delete folder (danger colour) | | no job running → opens confirmation (§8) |

### 6.2 Container menu (from ⋮ or from a folded strip icon)

Header: container name. Start / Stop / Resume (by state) · Restart (running only) ·
Update (when one is ready) or Force update · — · "Move to folder" or "Add to folder"
(heading) · one item per other folder with its item count · New folder… (opens the
editor with this container preselected) · "Remove from <folder>" (only if in a folder).

## 7. Bulk operation semantics

All operations run **sequentially**, one container at a time, and only **one job at a
time** across the page (a second request shows the toast "Another job is still running").

| Operation | Targets | Order |
|---|---|---|
| Start all | stopped members | start order, waiting `delay` seconds between starts |
| Stop all | running + paused members | reverse start order if `reverseStop`, else start order |
| Restart all | running members only (stopped stay stopped) | stop phase as Stop; then start phase as Start |
| Pause all | running members | start order |
| Resume all | paused members | start order |
| Check for updates | all members | start order; marks containers with updates |
| Update | members with an update ready | pull image → recreate; each returns to its previous state (paused → running) |
| Force update | all members | as Update, even when already up to date |

If an operation has no targets, nothing runs and a toast says "Nothing to do in “<folder>”".

### 7.1 Progress panel

Fixed bottom-right, 340px wide. Shows the job title ("Restarting Media"), "Step i of n"
(waits count as steps), a progress bar, and one line per target container with a state
marker (queued = hollow ring, active = spinner, done = green dot) and a mono note
(queued / stopping / wait 5 s / starting / restarted / pulling / recreating / updated /
updated, left stopped / up to date / update ready). When finished, it shows a check, a
summary ("4 containers restarted") and a close button, then dismisses itself after 6.5 s.

### 7.2 Toasts

Bottom-left, auto-dismiss after 4.2 s: folder created/saved/deleted, container moved,
WebUIs opened, nothing-to-do, another-job-running.

## 8. Confirmations

Modal dialog, 480px max width, Cancel + one confirm button; Escape cancels.

- **Force update**: title "Force update n containers in “<folder>”?"; body explains every
  image is pulled again and each container recreated; running ones come back up in start
  order, stopped ones stay stopped. Lists each member with "update ready" (warning
  colour) or "already up to date". Confirm button in warning colour.
- **Delete folder**: title "Delete folder “<folder>”?"; body says only the folder is
  removed and its n containers keep running and move to "Not in a folder". Confirm
  button in danger colour. Containers are never stopped or removed by this.

## 9. Folder editor (New folder / Edit folder)

Modal, max 1000px wide, max height = viewport − 32px; header, scrolling body, fixed
footer. Two columns that stack on narrow screens. A **live preview** of the folder row
sits at the top of the body (icon, name or "Untitled folder", count + delay, icon strip).

### Left column
- **Folder name** (required, max 32 chars, counter "n / 32"). Errors: empty → "Give the
  folder a name"; duplicate (case-insensitive) → "Another folder already uses this name".
- **Icon** (segmented tabs):
  - *Built-in*: 14 glyphs in a 7-column grid (folder, media, downloads, home, AI/compute,
    databases, cloud, security, network, photos, music, monitoring, passwords, games).
  - *From the web*: checkbox "Fetch automatically from the folder name" (on by default
    for new folders; the icon then follows the name as you type). Search field
    pre-filled with the name; results from **Dashboard Icons**, **selfh.st icons** and a
    **Generated** monogram, each showing the file name it would fetch. "Or paste an image
    URL" + Download: accepts direct links ending in .png .svg .jpg .jpeg .webp .ico;
    on success "Downloaded <file> from <host> · stored locally so it shows offline";
    otherwise an inline error. Picking anything turns automatic fetch off.
  - *From a container*: tiles of the current members; pick one to reuse its icon.
- **Colour**: 8 swatches (slate, blue, teal, green, amber, orange, rose, violet); the
  colour tints the built-in glyph tile and the generated monogram.

### Right column
- **Containers in this folder**: searchable checklist of all containers. A container
  belongs to **at most one folder**: one already in another folder shows "in <folder>";
  ticking it shows "moves from <folder>" in warning colour, and saving moves it.
- **Start order**: the selected containers as an ordered list with up/down buttons
  ("Start <name> earlier/later"). Hint: "top starts first, stops last" when reverse stop
  is on.
- **Auto-add containers whose name matches**: optional regex, case-insensitive. Live
  feedback: invalid → "That is not a valid pattern"; otherwise chips of extra matches
  ("Will also add:"). Below: containers carrying a Docker label also join, including
  ones created later (prototype shows the placeholder label `folder=<slug>`; real key is
  an open decision, §13).
- **Behaviour**: wait between container starts (0–300 s, number input); Stop in reverse
  order (switch, default on); Show folder on the Dashboard (switch, default on); When
  folded, show: Icons + status / Icons only / Count only.

### Footer
Delete folder (edit mode only, danger outline → closes editor and opens §8 delete
confirmation) · Cancel · Create folder / Save folder (primary).

On save: members = ticked list + current rule matches; those containers are removed
from any other folder; delay is clamped to 0–300; a new folder is added at the end and
starts unfolded; an edited folder keeps its fold state.

## 10. Filter

The header filter matches container names and folder names (case-insensitive substring).
A folder whose name matches shows all its members; otherwise it shows only matching
members. Folders with no match are hidden. While filtering, every shown folder is
unfolded. No results → "Nothing matches “<query>”".

## 11. Data model

Prototype shape (see `folders.example.json`):

```json
{
  "id": "f-media",
  "name": "Media",
  "color": "amber",
  "icon": { "type": "glyph", "key": "media" },
  "members": ["plex", "qbittorrent", "prowlarr", "sonarr", "radarr"],
  "expanded": true,
  "delay": 5,
  "reverseStop": true,
  "preview": "status",
  "rule": "",
  "dashboard": true
}
```

- `members` is ordered: it is the start order.
- `icon.type`: `glyph` (`key`), `container` (`cid`), `web` (prototype: `src` index,
  `letter`, `query`). For a real build, store web icons as
  `{ "type": "web", "source": "dashboard-icons" | "selfhst" | "url", "query": "...",
  "url": "...", "localFile": "..." }` so the downloaded file can be served offline.
- `expanded` is a per-viewer UI preference; consider storing it separately from the
  shared folder definition.
- The prototype keys members by a container id. A real build needs a stable key that
  survives container recreation (e.g. container name). Verify how Unraid identifies
  containers across updates before choosing.

Container fields the UI reads: name, image, icon (the prototype uses a letter + colour
because it does not reproduce real app logos), status (running / stopped / paused, plus
transient busy), update-available flag, port (first published or WebUI port), CPU %,
memory, autostart flag, WebUI URL.

## 12. Visual system

See `design-tokens.json` for every value. Summary:

- Dark theme only in the prototype. Ground `#101215`, table card `#16191D`, folder rows
  `#191D22`, popovers `#1F2328`, dialogs `#1B1F24`.
- Text `#E6E8EB`; secondary `#C9CED4`; muted `#9AA1AB`; dim labels `#8B929C`.
- One accent, blue `#6EA8FE` (primary buttons, focus rings, busy state, progress).
- Status: running `#3FB97A`, paused `#E0A43A`, stopped ring `#6B727C`, busy `#6EA8FE`.
- Warning (updates, force update) `#FFB27A` on `#3A2312`; danger `#FF9B9B`.
- Type: IBM Plex Sans (UI) and IBM Plex Mono (numbers, eyebrows, column heads). In the
  real UI, use the host UI's fonts if they differ.
- Radii: controls 8, tiles/menus 10, cards 12, dialogs 14, pills 999.
- Motion: menus/dialogs fade+rise 140ms; chevron and switch knob 150ms; progress bar
  300ms; spinners 0.8s linear.
- No emoji; icons are 24-unit stroke paths (in the prototype source).

## 13. Open decisions for implementation

Resolve these with the owner before writing code:

1. **Build target**: new Unraid plugin, a fork/contribution to FolderView3 or FolderView
   Plus, or a userscript/CSS layer. (Check those plugins' licences before reusing code.)
2. **Unraid version** to support, and which Docker page DOM / APIs to hook into. Check
   current Unraid plugin documentation; do not rely on memory.
3. **How each Docker action maps to Unraid**: especially "update" and "force update"
   (pull + recreate). Use Unraid's own mechanism if one exists, so container templates
   stay authoritative.
4. **Storage** for folder definitions and downloaded icons (location must survive reboots).
5. **Docker label key** for auto-assignment (FolderView3 uses `folder.view3`; the
   prototype's `folder=<slug>` is a placeholder).
6. **Icon fetching**: exact URLs/APIs of Dashboard Icons and selfh.st icons, licence
   terms, caching, and behaviour when the server is offline.
7. **Themes**: the prototype is dark only; the real UI must follow the user's Unraid theme.
8. **Dashboard tile** design (the "Show on Dashboard" switch exists; the tile is not designed).
9. **Folder-level start order vs Unraid's own autostart order**: decide which wins.

## 14. Accessibility

- All controls are real `<button>` / `<input>` / `<label>` elements; icon-only buttons
  have `aria-label`s; switches use `aria-pressed` (`mixed` for the folder switch);
  the chevron uses `aria-expanded`.
- Escape closes the topmost menu or dialog; closing a menu returns focus to its trigger.
- Status never relies on colour alone (dot shape + text).
- Contrast, computed with the WCAG 2 formula for the main foreground/background pairs
  in `design-tokens.json` (2026-10-27): all text pairs measured 4.73:1 or higher, except
  the "—" placeholder colour `#6F7782` on the folder row (3.74:1). The prototype now
  uses `#8B929C` for it; the canvas version still has the old colour. Not checked:
  text over the hover backgrounds, disabled (40 % opacity) menu items, and the real
  theme colours of the host UI.
- Production dialogs should trap focus (the prototype does not).

## 15. Acceptance checklist

- [ ] Create a folder with a name, members, an icon from each of the three sources, and a colour.
- [ ] A container can only be in one folder; moving it is visible before saving.
- [ ] Folded folders show every member icon on its own line under the name; at the
      narrowest table width the row wraps icons instead of overlapping columns.
- [ ] Clicking a folded icon opens that container's menu; clicking the folder icon opens the folder menu.
- [ ] Unfolding shows container rows with start-order numbers.
- [ ] Start / stop / restart / pause / resume / check / update / force update follow §7,
      including delay, reverse stop and "restart only running".
- [ ] Only one job runs at a time; progress panel and toasts behave as §7.1–7.2.
- [ ] Force update and delete folder require confirmation; delete never touches containers.
- [ ] Auto-add regex and label rules add matching containers, including new ones.
- [ ] Filter behaves as §10.
- [ ] Keyboard: everything reachable by Tab; Escape closes menus/dialogs.
