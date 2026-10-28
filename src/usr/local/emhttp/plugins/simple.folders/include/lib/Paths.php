<?PHP
/* simple.folders - filesystem locations.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Folder definitions and downloaded icons live on the flash drive so they
 * survive a reboot - /usr/local/emhttp is a RAM filesystem on Unraid and is
 * rebuilt from the plugin package on every boot.
 *
 * Every path is overridable by defining the constant beforehand, which is how
 * the development harness points them at a scratch directory. Production code
 * never defines them.
 */

defined('SF_PLUGIN')     || define('SF_PLUGIN', 'simple.folders');
defined('SF_CONFIG_DIR') || define('SF_CONFIG_DIR', '/boot/config/plugins/'.SF_PLUGIN);
defined('SF_ICON_DIR')   || define('SF_ICON_DIR', SF_CONFIG_DIR.'/icons');
defined('SF_FOLDERS')    || define('SF_FOLDERS', SF_CONFIG_DIR.'/folders.json');

/* Per-job scratch for update runs. Deliberately on tmpfs: a job that did not
 * finish before a reboot is meaningless. */
defined('SF_RUN_DIR')    || define('SF_RUN_DIR', '/var/tmp/'.SF_PLUGIN);

/* Unraid's own docker manager - the only core code this plugin calls into. */
defined('SF_DOCKER_MAN') || define('SF_DOCKER_MAN', '/usr/local/emhttp/plugins/dynamix.docker.manager');

/* Unraid's container start order and per-container start delay. One
 * "<name> <seconds>" line per autostarted container, in start order.
 * Folder start order is written straight into this file rather than kept
 * alongside it (DESIGN_SPEC.md 13.9). */
defined('SF_DOCKER_MAN_AUTOSTART') || define('SF_DOCKER_MAN_AUTOSTART', '/var/lib/docker/unraid-autostart');

/* Unraid's container DISPLAY order, as the lock-and-drag on the stock Docker
 * page writes it: one <index>="<name>" line per container.
 *
 * Separate from the start order above, and deliberately so. Unraid's own
 * UserPrefs.php rewrites BOTH - saving a display order there re-sorts the
 * autostart file to match - which would quietly undo the start order a
 * folder owns. This plugin writes this file alone and never touches
 * unraid-autostart from here. */
defined('SF_USER_PREFS') || define('SF_USER_PREFS', '/boot/config/plugins/dockerMan/userprefs.cfg');

/* Docker label that assigns a container to a folder: simple.folders=<slug>.
 * Containers created later carrying this label join automatically. */
defined('SF_LABEL')      || define('SF_LABEL', 'simple.folders');

/* The plugin was called docker.folders before it was renamed to Simple
 * Folders. Container templates carrying the old label keep working: it is
 * read everywhere the current one is, just never written. */
defined('SF_LABEL_LEGACY') || define('SF_LABEL_LEGACY', 'docker.folders');
defined('SF_CONFIG_DIR_LEGACY') || define('SF_CONFIG_DIR_LEGACY', '/boot/config/plugins/docker.folders');

function sf_ensure_dirs(): void {
  foreach ([SF_CONFIG_DIR, SF_ICON_DIR, SF_RUN_DIR] as $dir) {
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
  }
}
