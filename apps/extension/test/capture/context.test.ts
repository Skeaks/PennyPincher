import { describe, expect, it } from "vitest";
import { deviceClass, pageContext } from "../../src/capture/context";

describe("pageContext", () => {
  it("a fine pointer is desktop / web at any width", () => {
    expect(deviceClass({ width: 390, coarsePointer: false })).toBe("desktop");
    expect(pageContext({ href: "https://x/", width: 1440, coarsePointer: false })).toEqual({
      url: "https://x/",
      device: "desktop",
      surface: "web",
    });
  });

  it("a coarse pointer is mobile below 768, tablet below 1200, desktop above", () => {
    expect(deviceClass({ width: 390, coarsePointer: true })).toBe("mobile");
    expect(deviceClass({ width: 767, coarsePointer: true })).toBe("mobile");
    expect(deviceClass({ width: 768, coarsePointer: true })).toBe("tablet");
    expect(deviceClass({ width: 1199, coarsePointer: true })).toBe("tablet");
    expect(deviceClass({ width: 1200, coarsePointer: true })).toBe("desktop");
  });

  it("mobile and tablet render on mobile_web", () => {
    expect(pageContext({ href: "https://x/", width: 390, coarsePointer: true }).surface).toBe(
      "mobile_web",
    );
    expect(pageContext({ href: "https://x/", width: 900, coarsePointer: true }).surface).toBe(
      "mobile_web",
    );
  });
});
