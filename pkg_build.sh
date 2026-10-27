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
  # Deterministic: same sources must give the same bytes, so the md5 stamped
  # into the .plg only changes when the plugin actually changed. Without
  # --sort and a fixed mtime the archive differs on every build and every
  # rebuild looks like a new release.
  ( cd "$BUILD" && tar --owner=root --group=root --numeric-owner \
      --sort=name --mtime="UTC 2020-01-01" --format=gnu \
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

echo "==> $PKG"
echo "    md5 $MD5  (written to $PLUGIN.plg)"
echo "    size $(du -h "$PKG" | cut -f1)"
