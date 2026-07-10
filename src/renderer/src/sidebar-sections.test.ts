import { describe, expect, it } from "vitest";
import { readSidebarSections, serializeSidebarSections, toggleSidebarSection } from "./sidebar-sections";

describe("sidebar sections", () => {
  it("defaults views to collapsed while keeping the other sections expanded", () => {
    expect(readSidebarSections(null)).toEqual({
      environments: true,
      remaining: true,
      projects: true,
      sources: true,
      tags: true,
      views: false,
    });
  });

  it("reads persisted section state and fills missing values with defaults", () => {
    expect(readSidebarSections(JSON.stringify({ projects: false }))).toEqual({
      environments: true,
      remaining: true,
      projects: false,
      sources: true,
      tags: true,
      views: false,
    });
    expect(readSidebarSections(JSON.stringify({ views: true })).views).toBe(true);
  });

  it("falls back to defaults for invalid persisted state", () => {
    expect(readSidebarSections("{not-json")).toEqual({
      environments: true,
      remaining: true,
      projects: true,
      sources: true,
      tags: true,
      views: false,
    });
  });

  it("toggles one section without mutating the other sections", () => {
    const next = toggleSidebarSection(
      { environments: true, remaining: true, projects: true, sources: true, tags: false, views: true },
      "tags",
    );

    expect(next).toEqual({ environments: true, remaining: true, projects: true, sources: true, tags: true, views: true });
    expect(JSON.parse(serializeSidebarSections(next))).toEqual(next);
  });
});
