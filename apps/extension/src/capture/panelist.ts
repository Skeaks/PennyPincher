/**
 * The panelist id moved to `src/identity/panelist.ts` in S14, which owns rotation and the
 * id history. This re-export keeps the S04 import path (`capture/run.ts` and its tests)
 * working; new code imports from `identity/` directly.
 */
export {
  PANELIST_KEY,
  PANELIST_ROTATION_MS,
  type PanelistRecord,
  getPanelistId,
} from "../identity/panelist";
