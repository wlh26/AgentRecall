import { describe, expect, it } from "vitest";
import { resolveSearchScope } from "./features/search/search-scope";
import {
  disabledSshEnvironmentIdsByHostAlias,
  existingSshHostAliases,
} from "./features/settings/ssh-environment-dialog";

describe("resolveSearchScope", () => {
  it("marks explicit environment and another environment's selected project as incompatible", () => {
    expect(resolveSearchScope("ssh-b", "/work/app", "ssh-a")).toEqual({
      environmentId: "ssh-b",
      projectPath: "/work/app",
      projectEnvironmentConflict: true,
    });
  });

  it("keeps all-environment project filters scoped to the selected project environment", () => {
    expect(resolveSearchScope("all", "/work/app", "ssh-a")).toEqual({
      environmentId: "ssh-a",
      projectPath: "/work/app",
      projectEnvironmentConflict: false,
    });
  });
});

describe("existingSshHostAliases", () => {
  const environments = [
    { id: "local", kind: "local" as const, label: "Local", hostAlias: null, enabled: true },
    { id: "devbox", kind: "ssh" as const, label: "devbox", hostAlias: "devbox", enabled: true },
    { id: "cursor-dev", kind: "ssh" as const, label: "dev", hostAlias: "dev", enabled: false },
    { id: "prod", kind: "ssh" as const, label: "prod", hostAlias: null, enabled: true },
  ];

  it("blocks enabled aliases while leaving disabled discovered aliases selectable", () => {
    expect(
      existingSshHostAliases(environments),
    ).toEqual(new Set(["devbox"]));
  });

  it("maps disabled SSH aliases to the environment ids that should be upgraded", () => {
    expect(disabledSshEnvironmentIdsByHostAlias(environments)).toEqual(new Map([["dev", "cursor-dev"]]));
  });
});
