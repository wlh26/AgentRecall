import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStoredTheme } from "./theme";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("theme storage", () => {
  it("defaults to light when no theme is stored", () => {
    expect(readStoredTheme(null)).toBe("light");
  });

  it("keeps dark only when dark is explicitly stored", () => {
    expect(readStoredTheme("dark")).toBe("dark");
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("system")).toBe("light");
  });
});

describe("theme controls", () => {
  it("keeps light and dark mode selection inside settings", () => {
    const toolbar = appSource.slice(
      appSource.indexOf('<header className="toolbar">'),
      appSource.indexOf('<div className="result-count">'),
    );
    const settingsDialog = appSource.slice(appSource.indexOf("function SettingsDialog"), appSource.indexOf("function DeleteTagDialog"));

    expect(toolbar).not.toContain("setTheme");
    expect(settingsDialog).toContain("theme-setting-toggle");
    expect(settingsDialog).toContain("onThemeChange");
    expect(settingsDialog).toMatch(/Appearance/);
  });
});
