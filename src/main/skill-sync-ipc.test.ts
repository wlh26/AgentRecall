import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");

describe("skill sync IPC", () => {
  it("exposes Supabase skill sync handlers through main and preload", () => {
    for (const channel of [
      "skills:sync-snapshot",
      "skills:sync-upload",
      "skills:sync-install",
      "skills:sync-diff",
      "skills:sync-copy-setup-sql",
    ]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke("${channel}"`);
    }
  });

  it("builds Skill diffs from managed local paths and hydrated remote versions", () => {
    expect(mainSource).toContain("buildSkillDiffSnapshot(localSnapshot, remoteSnapshot)");
    expect(mainSource).toContain("findInstalledSkillByPath(localSkillPath)");
    expect(mainSource).toContain("getRemoteSkillVersionDetail(remoteSkillId)");
    expect(mainSource).toContain('file.relativePath === "SKILL.md"');
    expect(preloadSource).toContain("getSyncedSkillDiff:");
  });

  it("resolves portable identity aliases before uploads and cloud deletion", () => {
    expect(mainSource).toContain("groupRemoteSkillVersions(await client.listRemoteSkillVersions())");
    expect(mainSource).toContain("client.deleteRemoteSkillVersions(group.versions.map");
    expect(mainSource).toContain("latest.contentHash !== existingBinding.lastContentHash");
  });

  it("exposes first-time setup SQL and a project-specific SQL Editor link", () => {
    for (const channel of ["supabase:copy-combined-setup-sql", "supabase:open-sql-editor"]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke("${channel}"`);
    }
    expect(mainSource).toContain("buildCombinedSupabaseSetupSql()");
    expect(mainSource).toContain("shell.openExternal(supabaseSqlEditorUrl(projectUrl))");
  });
});
