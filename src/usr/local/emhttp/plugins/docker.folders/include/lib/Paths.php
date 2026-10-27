<?PHP
/* docker.folders - filesystem locations.
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

defined('DF_PLUGIN')     || define('DF_PLUGIN', 'docker.folders');
defined('DF_CONFIG_DIR') || define('DF_CONFIG_DIR', '/boot/config/plugins/'.DF_PLUGIN);
defined('DF_ICON_DIR')   || define('DF_ICON_DIR', DF_CONFIG_DIR.'/icons');
defined('DF_FOLDERS')    || define('DF_FOLDERS', DF_CONFIG_DIR.'/folders.json');

/* Per-job scratch for update runs. Deliberately on tmpfs: a job that did not
 * finish before a reboot is meaningless. */
defined('DF_RUN_DIR')    || define('DF_RUN_DIR', '/var/tmp/'.DF_PLUGIN);

/* Unraid's own docker manager - the only core code this plugin calls into. */
defined('DF_DOCKER_MAN') || define('DF_DOCKER_MAN', '/usr/local/emhttp/plugins/dynamix.docker.manager');

/* Unraid's container start order and per-container start delay. One
 * "<name> <seconds>" line per autostarted container, in start order.
 * Folder start order is written straight into this file rather than kept
 * alongside it (DESIGN_SPEC.md 13.9). */
defined('DF_DOCKER_MAN_AUTOSTART') || define('DF_DOCKER_MAN_AUTOSTART', '/var/lib/docker/unraid-autostart');

/* Docker label that assigns a container to a folder: docker.folders=<slug>.
 * Containers created later carrying this label join automatically. */
defined('DF_LABEL')      || define('DF_LABEL', 'docker.folders');

function df_ensure_dirs(): void {
  foreach ([DF_CONFIG_DIR, DF_ICON_DIR, DF_RUN_DIR] as $dir) {
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
  }
}
