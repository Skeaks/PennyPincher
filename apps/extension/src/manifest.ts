/**
 * The manifest, kept as a plain object so a unit test can pin it.
 *
 * Permissions are the whole legal posture of the extension (docs/decisions/0003-capture-posture.md):
 *   - host_permissions: only the three retailers we have adapters for. Subdomains allowed.
 *   - permissions: `storage` (the local observation store) and `alarms` (future scheduling).
 *   - Nothing else. No `cookies`, no `webRequest`, no `tabs`, no `scripting`.
 */
export const HOST_PERMISSIONS = [
  "*://*.instacart.com/*",
  "*://*.target.com/*",
  "*://*.walmart.com/*",
] as const;

export const PERMISSIONS = ["storage", "alarms"] as const;

import type { UserManifest } from "wxt";

export const manifest: UserManifest = {
  name: "PennyPincher",
  description:
    "Records the prices you were already shown on supported retailers, locally, with your consent.",
  permissions: [...PERMISSIONS],
  host_permissions: [...HOST_PERMISSIONS],
};
