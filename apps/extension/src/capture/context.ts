/**
 * The context the content script knows without reading the page: the URL bar and a coarse
 * device class. The device class comes from viewport width and pointer type, never from the
 * user-agent string (schema rule: "Never a user-agent string").
 */
import type { DeviceClass, PageContext } from "./adapter";

export interface Viewport {
  href: string;
  width: number;
  /** `matchMedia("(pointer: coarse)")`: a touch-first device. */
  coarsePointer: boolean;
}

export const MOBILE_MAX_WIDTH = 768;
export const TABLET_MAX_WIDTH = 1200;

export function deviceClass(v: Pick<Viewport, "width" | "coarsePointer">): DeviceClass {
  if (!v.coarsePointer) return "desktop";
  if (v.width < MOBILE_MAX_WIDTH) return "mobile";
  if (v.width < TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

export function pageContext(v: Viewport): PageContext {
  const device = deviceClass(v);
  return { url: v.href, device, surface: device === "desktop" ? "web" : "mobile_web" };
}

/** Read the viewport from a live window. Kept tiny and untested; everything else is pure. */
export function viewportOf(win: Window): Viewport {
  let coarsePointer = false;
  try {
    coarsePointer = win.matchMedia("(pointer: coarse)").matches;
  } catch {
    // Some embedders lack matchMedia; treat as a desktop pointer.
  }
  return { href: win.location.href, width: win.innerWidth, coarsePointer };
}
