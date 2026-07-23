import { describe, expect, it } from "vitest";
import { isLocalSessionEnvironment, isLocalSessionStorage } from "./session-environment";

describe("session environment classification", () => {
  it.each([
    ["strict local", { environmentKind: "local", environmentId: "local" }, true],
    ["imported local", { environmentKind: "local", environmentId: "imported-local" }, false],
    ["ssh", { environmentKind: "ssh", environmentId: "ssh-dev" }, false],
    ["inconsistent ssh local id", { environmentKind: "ssh", environmentId: "local" }, false],
  ] as const)("classifies %s", (_label, session, expected) => {
    expect(isLocalSessionEnvironment(session)).toBe(expected);
  });

  it("classifies storage independently from the execution environment", () => {
    expect(isLocalSessionStorage({ environmentId: "ssh-dev", storageEnvironmentId: "local" })).toBe(true);
    expect(isLocalSessionStorage({ environmentId: "ssh-dev", storageEnvironmentId: "ssh-dev" })).toBe(false);
    expect(isLocalSessionStorage({ environmentId: "local" })).toBe(true);
  });
});
