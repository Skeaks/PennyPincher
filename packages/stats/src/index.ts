/**
 * @pennypincher/stats — tier resolution, confidence, and UNRESOLVED.
 *
 *   resolve(observations, { windowHours }) -> Resolution
 *   explain(resolution) -> the line the UI shows
 *
 * The constants (`RESOLVE_SAFETY_FACTOR`, `MIN_TIER_SIGHTINGS`, `SINGLETON_NOISE_MIN_N`,
 * `MAX_TIERS`) are exported so the UI and the docs quote the same numbers the engine uses.
 */
export { expectedDrawsUniform, harmonic, probabilityAllSeen } from "./coupon";
export { explain, formatMinor } from "./explain";
export {
  DEFAULT_WINDOW_HOURS,
  MAX_TIERS,
  MIN_TIER_SIGHTINGS,
  type ObservationLike,
  RESOLVE_SAFETY_FACTOR,
  type Resolution,
  type Resolved,
  type ResolveOptions,
  SINGLETON_NOISE_MIN_N,
  type Tier,
  type Unresolved,
  type UnresolvedReason,
  requiredObservations,
  resolve,
} from "./resolve";
