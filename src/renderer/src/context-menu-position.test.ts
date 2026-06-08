import { describe, expect, it } from "vitest";
import { clampedContextMenuPosition } from "./context-menu-position";

describe("context menu positioning", () => {
  it("keeps a menu inside the viewport when opened near the bottom-right corner", () => {
    expect(
      clampedContextMenuPosition(
        { x: 780, y: 580 },
        { width: 220, height: 260 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 572, y: 332 });
  });

  it("keeps normal click positions unchanged", () => {
    expect(
      clampedContextMenuPosition(
        { x: 120, y: 160 },
        { width: 220, height: 260 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 120, y: 160 });
  });

  it("keeps a margin when the click point is outside the top-left edge", () => {
    expect(
      clampedContextMenuPosition(
        { x: -20, y: -10 },
        { width: 220, height: 260 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });
});
