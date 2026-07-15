import { describe, expect, it } from "vitest";
import { buildSkillDiffSnapshot, type SkillContentSnapshot } from "./skill-diff";

function file(relativePath: string, content: string | Buffer) {
  return {
    relativePath,
    contentBase64: Buffer.from(content).toString("base64"),
  };
}

function content(hash: string, files: SkillContentSnapshot["files"]): SkillContentSnapshot {
  return { contentHash: hash, files };
}

describe("Skill content diff", () => {
  it("identifies unchanged, added, removed, and modified text files", () => {
    const result = buildSkillDiffSnapshot(
      content("local", [file("SKILL.md", "# Skill\nold"), file("removed.txt", "gone"), file("same.txt", "same")]),
      content("remote", [file("SKILL.md", "# Skill\nnew"), file("added.txt", "hello"), file("same.txt", "same")]),
    );

    expect(result.state).toBe("different");
    expect(result.files.map((entry) => [entry.relativePath, entry.status])).toEqual([
      ["SKILL.md", "modified"],
      ["added.txt", "added"],
      ["removed.txt", "removed"],
      ["same.txt", "unchanged"],
    ]);
    expect(result.files[0].diff).toContain("-old");
    expect(result.files[0].diff).toContain("+new");
  });

  it("reports binary changes without rendering binary text", () => {
    const result = buildSkillDiffSnapshot(
      content("local", [file("asset.bin", Buffer.from([0, 1, 2]))]),
      content("remote", [file("asset.bin", Buffer.from([0, 1, 3]))]),
    );
    expect(result.files[0]).toMatchObject({ status: "modified", binary: true, localSize: 3, remoteSize: 3 });
    expect(result.files[0].diff).toBeNull();
  });

  it("uses content hashes for identical snapshots", () => {
    const result = buildSkillDiffSnapshot(
      content("same", [file("SKILL.md", "same")]),
      content("same", [file("SKILL.md", "same")]),
    );
    expect(result.state).toBe("identical");
    expect(result.files[0].status).toBe("unchanged");
  });

  it("treats materialized legacy files as identical when the cloud hash is missing", () => {
    const result = buildSkillDiffSnapshot(
      content("local-hash", [file("SKILL.md", "same")]),
      content("", [file("SKILL.md", "same")]),
    );
    expect(result.state).toBe("identical");
    expect(result.files[0].status).toBe("unchanged");
  });

  it("describes one-sided snapshots without inventing a two-sided diff", () => {
    const localOnly = buildSkillDiffSnapshot(content("local", [file("SKILL.md", "local")]), null);
    const remoteOnly = buildSkillDiffSnapshot(null, content("remote", [file("SKILL.md", "remote")]));
    expect(localOnly).toMatchObject({ state: "local-only", remoteHash: "" });
    expect(remoteOnly).toMatchObject({ state: "remote-only", localHash: "" });
    expect(localOnly.files[0].status).toBe("removed");
    expect(remoteOnly.files[0].status).toBe("added");
  });

});
