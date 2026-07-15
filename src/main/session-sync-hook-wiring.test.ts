import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve("src", "main", "index.ts"), "utf8");

describe("session sync hook main-process wiring", () => {
  it("loads the packaged hook installer and exposes status, install and remove IPC", () => {
    expect(source).toContain("setup-session-sync-hook.cjs");
    expect(source).toContain('ipcMain.handle("remote-session:hook-status"');
    expect(source).toContain('ipcMain.handle("remote-session:install-hooks"');
    expect(source).toContain('ipcMain.handle("remote-session:uninstall-hooks"');
  });

  it("starts and stops a background queue drain", () => {
    expect(source).toContain("startAutoSessionSyncQueue()");
    expect(source).toContain("stopAutoSessionSyncQueue()");
    expect(source).toContain("drainSessionSyncQueue");
    expect(source).toContain("AUTO_SESSION_SYNC_QUEUE_INTERVAL_MS");
  });

  it("removes hooks before disabling remote session sync", () => {
    const settingsBlock = source.slice(source.indexOf('ipcMain.handle("settings:set"'), source.indexOf('ipcMain.handle("api-provider-key:get"'));
    expect(settingsBlock).toContain('"remoteSyncEnabled" in settings');
    expect(settingsBlock.indexOf("uninstallSessionSyncHooks")).toBeLessThan(settingsBlock.indexOf("settingsStore.set"));
    expect(settingsBlock).toContain("clearSessionSyncQueue");
  });

  it("excludes subagents and skips an unchanged local revision before uploading", () => {
    const drainBlock = source.slice(source.indexOf("async function drainSessionSyncQueue"), source.indexOf("function startAutoSessionSyncQueue"));
    expect(drainBlock).toContain("session.isSubagent");
    expect(drainBlock).toContain("binding.lastLocalRevision === built.payload.content_hash");
    expect(drainBlock.indexOf("binding.lastLocalRevision === built.payload.content_hash")).toBeLessThan(drainBlock.indexOf("uploadSessionToRemote"));
  });
});
