/**
 * Test-only DB isolation. Import this module as the FIRST import in any
 * test file that touches the shared cmux SQLite database. It redirects
 * `$XDG_CACHE_HOME` to a per-process temp directory BEFORE `src/db.ts` is
 * loaded, so `getDb()` opens a throwaway database instead of the user's
 * real `~/.cache/cmux/cmux.sqlite`.
 *
 * Without this, tests that call `DELETE FROM <table>` or `_clearAll()`
 * wipe the user's real picker/transition history.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const marker = join(tmpdir(), "cmux-test-");
if (!process.env.XDG_CACHE_HOME?.startsWith(marker)) {
  process.env.XDG_CACHE_HOME = mkdtempSync(marker);
}
