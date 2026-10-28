#!/bin/bash
#
# Build the simple.folders Slackware package and stamp its md5 into the .plg.
#
# Unraid plugins install a .txz that is unpacked at / , so everything under
# src/ must mirror the final filesystem layout exactly.
#
# Requires: makepkg (Slackware) or the bundled fallback below, md5sum, tar, xz.
# Run from the repository root:  ./pkg_build.sh
#
set -euo pipefail

PLUGIN="simple.folders"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/src"
ARCHIVE="$ROOT/archive"
PLG="$ROOT/$PLUGIN.plg"

# Version comes from the .plg so there is exactly one place to bump it.
VERSION="$(sed -n 's/.*<!ENTITY version *"\([^"]*\)".*/\1/p' "$PLG")"
[ -n "$VERSION" ] || { echo "error: could not read version from $PLG" >&2; exit 1; }

PKG="$ARCHIVE/$PLUGIN-$VERSION.txz"

# ---------------------------------------------------------------------------
# A file mtime derived from the version. See the note by the tar call for why
# this must change between releases and must not change within one.
# ---------------------------------------------------------------------------
version_mtime() {
  local v="$1" day offset
  day="$(printf '%s' "$v" | grep -oE '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}' | tr '.' '-')"
  [ -n "$day" ] || day="2026-01-01"
  # Spread within that day by a hash of the full version, so suffixed
  # releases (…28a, …28b) differ from each other and from the bare date.
  offset=$(( $(printf '%s' "$v" | cksum | cut -d' ' -f1) % 86400 ))
  date -u -d "$day UTC + $offset seconds" '+%Y-%m-%d %H:%M:%S'
}

MTIME="$(version_mtime "$VERSION")"

# Guard: a constant here is the bug this replaced, so prove it varies.
if [ "$(version_mtime "$VERSION")" = "$(version_mtime "${VERSION}-probe")" ]; then
  echo "error: the asset mtime does not change with the version." >&2
  echo "       Browsers would keep serving the previous release's assets." >&2
  exit 1
fi
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "==> building $PLUGIN $VERSION"

# ---------------------------------------------------------------------------
# Stage the tree.
# ---------------------------------------------------------------------------
cp -a "$SRC/." "$BUILD/"

# Unraid runs these through PHP and bash; CRLF breaks both. The plugin docs
# call this out explicitly, so normalise rather than trust the checkout.
find "$BUILD" -type f \
  \( -name '*.page' -o -name '*.php' -o -name '*.js' -o -name '*.css' \
     -o -name '*.sh' -o -name '*.json' -o -name '*.md' \) \
  -exec sed -i 's/\r$//' {} +

find "$BUILD" -type d -exec chmod 0755 {} +
find "$BUILD" -type f -exec chmod 0644 {} +

# ---------------------------------------------------------------------------
# slack-desc: Slackware package metadata. The ruler must sit at column 12 and
# every description line is prefixed with "$PLUGIN:".
# ---------------------------------------------------------------------------
mkdir -p "$BUILD/install"
cat > "$BUILD/install/slack-desc" <<EOF
       |-----handy-ruler------------------------------------------------------|
$PLUGIN: $PLUGIN (group Docker containers into folders)
$PLUGIN:
$PLUGIN: Adds folders to the Unraid Docker page. Group containers, fold them
$PLUGIN: away behind a single row, and run start/stop/restart/pause/update
$PLUGIN: across a whole folder in a defined order.
$PLUGIN:
$PLUGIN: Folder definitions live on the flash drive and survive reboots.
$PLUGIN:
$PLUGIN: Homepage: https://github.com/gcarstoiu/simple.folders
$PLUGIN:
$PLUGIN:
EOF

# ---------------------------------------------------------------------------
# Package. Prefer real makepkg (on Unraid/Slackware); otherwise build the same
# layout by hand so the package can be produced on a dev machine.
# ---------------------------------------------------------------------------
mkdir -p "$ARCHIVE"
rm -f "$PKG"

# Careful: Arch Linux ships an unrelated tool also called makepkg. Only
# Slackware's accepts -l/-c, so probe for that rather than trusting the name.
if command -v makepkg >/dev/null 2>&1 && makepkg --help 2>&1 | grep -qi 'slackware'; then
  echo "    using Slackware makepkg"
  ( cd "$BUILD" && makepkg -l n -c n "$PKG" >/dev/null )
else
  # A Slackware package is just a tar.xz of the tree plus install/slack-desc,
  # which is exactly what has been staged - so build it directly. This is the
  # normal path when building off-server.
  echo "    building the .txz directly (no Slackware makepkg here)"
  # Deterministic, but NOT frozen.
  #
  # The archive must be reproducible so the md5 only moves when the plugin
  # actually changed - hence --sort and a fixed mtime rather than the clock.
  #
  # But the mtime cannot be a constant. Unraid's autov() cache-busts every
  # script and stylesheet on its FILE MTIME:
  #
  #     $time = filemtime($path);  $newFile = "$file?v=$time";
  #
  # With one hardcoded date, every release served identical asset URLs, so
  # browsers kept running the previous release's JavaScript and the update
  # looked like it had done nothing at all. The mtime is therefore derived
  # from the version: same version, same bytes; new version, new URLs.
  ( cd "$BUILD" && tar --owner=root --group=root --numeric-owner \
      --sort=name --mtime="UTC $MTIME" --format=gnu \
      -cJf "$PKG" . )
fi

MD5="$(md5sum "$PKG" | cut -d' ' -f1)"

# Stamp the checksum into the .plg; the plugin manager verifies it on install.
sed -i "s/<!ENTITY md5 *\"[^\"]*\">/<!ENTITY md5       \"$MD5\">/" "$PLG"

# ---------------------------------------------------------------------------
# Validate the XML before anyone can publish it.
#
# Unraid's plugin manager parses the .plg and nothing else: a malformed one
# fails with "XML file doesn't exist or xml parse error" and the plugin will
# not install at all. It is easy to break by hand - a literal <folder> in the
# changelog is enough, because there is no CDATA section and the parser reads
# it as an element that never closes. So the build refuses to finish rather
# than leave a broken manifest for the next push.
# ---------------------------------------------------------------------------
validate_xml() {
  python3 - "$1" <<'PYEOF'
import sys, xml.dom.minidom
path = sys.argv[1]
try:
    xml.dom.minidom.parse(path)
except Exception as exc:
    print(f"  INVALID  {path}\n           {exc}")
    sys.exit(1)
print(f"  ok       {path}")
PYEOF
}

echo "==> validating XML"
xml_ok=0
for f in "$PLG" "$ROOT/ca_profile.xml" "$ROOT/templates/$PLUGIN.xml"; do
  [ -f "$f" ] || continue
  validate_xml "$f" || xml_ok=1
done

if [ "$xml_ok" -ne 0 ]; then
  echo
  echo "error: the XML above is malformed - not publishing." >&2
  echo "       Unraid reports this as \"XML file doesn't exist or xml parse error\"" >&2
  echo "       and refuses to install the plugin." >&2
  rm -f "$PKG"
  exit 1
fi

# ---------------------------------------------------------------------------
# Check what the Plugins page will actually show.
#
# It takes the row's title from plugins/<name>/README.md rendered as
# Markdown, falling back to the bare plugin id when there is none - which is
# how this shipped once reading "simple.folders" instead of "Simple Folders".
# The icon attribute is resolved against plugins/<name>/images/, and silently
# falls back to a generic plugin icon when the file is missing.
# ---------------------------------------------------------------------------
echo "==> checking the Plugins page entry"
python3 - "$BUILD" "$PLG" <<'PYEOF' || { echo "error: see above - not publishing." >&2; rm -f "$PKG"; exit 1; }
import os, re, sys, pathlib

build, plg_path = sys.argv[1], sys.argv[2]
plg  = pathlib.Path(plg_path).read_text()
ent  = dict(re.findall(r'<!ENTITY (\w+)\s+"([^"]*)">', plg))
name = ent.get('name', '')
icon = (re.search(r'icon="([^"]*)"', plg) or [None, ''])[1]
root = pathlib.Path(build) / 'usr/local/emhttp'
bad  = False

readme = root / 'plugins' / name / 'README.md'
if readme.exists():
    first = readme.read_text().strip().splitlines()[0]
    shown = re.sub(r'\*\*(.+?)\*\*', r'\1', first).strip()
    print(f'  title    {shown!r}')
    if shown == name:
        print(f'  PROBLEM  the title is the plugin id; give README.md a readable name')
        bad = True
else:
    print(f'  PROBLEM  no plugins/{name}/README.md - the page would show {name!r}')
    bad = True

if icon.endswith('.png'):
    for rel in (f'plugins/{name}/images/{icon}', f'plugins/{name}/{icon}'):
        if (root / rel).exists():
            print(f'  icon     /{rel}')
            break
    else:
        print(f'  PROBLEM  icon="{icon}" is not in the package; it would fall back to the generic icon')
        bad = True
else:
    print(f'  icon     FontAwesome "{icon}" (not the plugin artwork)')

sys.exit(1 if bad else 0)
PYEOF

echo "==> $PKG"
echo "    md5 $MD5  (written to $PLUGIN.plg)"
echo "    size $(du -h "$PKG" | cut -f1)"
echo "    asset mtime $MTIME  (what autov() cache-busts on)"
