import { describe, expect, it } from "vitest";
import { defaultGlobalShortcut, normalizeGlobalShortcut, globalShortcutOptions } from "./shortcuts";

describe("defaultGlobalShortcut", () => {
  it("uses Ctrl+Alt+Space on Windows (Alt+Space is reserved by the OS)", () => {
    expect(defaultGlobalShortcut("win32")).toBe("Ctrl+Alt+Space");
  });
  it("uses Alt+Space (Option+Space) on macOS", () => {
    expect(defaultGlobalShortcut("darwin")).toBe("Alt+Space");
  });
});

describe("normalizeGlobalShortcut", () => {
  it("falls back to the platform default for invalid values", () => {
    expect(normalizeGlobalShortcut("nonsense", "win32")).toBe("Ctrl+Alt+Space");
    expect(normalizeGlobalShortcut("nonsense", "darwin")).toBe("Alt+Space");
  });
  it("keeps a valid value", () => {
    expect(normalizeGlobalShortcut("Ctrl+Alt+Space", "darwin")).toBe("Ctrl+Alt+Space");
  });
});

describe("globalShortcutOptions", () => {
  it("labels modifiers as Alt/Ctrl on Windows", () => {
    const labels = globalShortcutOptions("win32").map((o) => o.label);
    expect(labels).toContain("Alt + Space");
    expect(labels.join(" ")).not.toContain("Option");
  });
  it("labels modifiers as Option/Command on macOS", () => {
    const labels = globalShortcutOptions("darwin").map((o) => o.label);
    expect(labels).toContain("Option + Space");
  });
});
