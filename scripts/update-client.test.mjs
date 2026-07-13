import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  UPDATE_REQUEST_TIMEOUT_MS,
  checkForUpdate,
  compareVersions,
  formatUpdateNotice,
  installUpdate,
  parseUpdateManifest,
  snoozeUpdatePrompt,
} = require("../bin/update-client.cjs");

test("allows enough time for a normal GitHub release check", () => {
  assert.equal(UPDATE_REQUEST_TIMEOUT_MS, 5_000);
});

function manifest(version = "0.2.0") {
  return {
    schemaVersion: 1,
    version,
    tag: `v${version}`,
    title: "自动更新",
    publishedAt: "2026-07-14T00:00:00.000Z",
    releaseUrl: `https://github.com/zszz3/agent-session-search/releases/tag/v${version}`,
    notes: { features: ["终端显示更新。"], fixes: ["修复重启失败。"] },
    package: {
      name: `agent-session-search-${version}.tgz`,
      url: `https://github.com/zszz3/agent-session-search/releases/download/v${version}/agent-session-search-${version}.tgz`,
      sha256: "a".repeat(64),
      checksumUrl: "",
    },
  };
}

test("compares stable application versions", () => {
  assert.equal(compareVersions("0.1.9", "0.2.0"), -1);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
});

test("snoozes the terminal prompt for the same cached version", async () => {
  const value = manifest();
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "agent-session-update-snooze-"));
  const cachePath = path.join(cacheDirectory, "update-check.json");
  const now = Date.now();
  let request = 0;
  const fetchImpl = async () => {
    request += 1;
    return request === 1
      ? new Response(JSON.stringify({ tag_name: "v0.2.0", assets: [{ name: "update.json", browser_download_url: "https://download.example/update.json" }] }), { status: 200 })
      : new Response(JSON.stringify(value), { status: 200 });
  };
  await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchImpl, force: true, now });
  await snoozeUpdatePrompt("0.2.0", { cachePath, now, durationMs: 60_000 });
  const cached = await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchImpl, now: now + 1 });
  assert.equal(cached.updateAvailable, true);
  assert.equal(cached.promptSnoozed, true);
});

test("refuses to install an update whose package checksum does not match", async () => {
  const value = manifest();
  const statusDirectory = await mkdtemp(path.join(tmpdir(), "agent-session-update-status-"));
  await assert.rejects(
    installUpdate(value, {
      fetchImpl: async () => new Response("tampered package", { status: 200 }),
      statusPath: path.join(statusDirectory, "status.json"),
    }),
    /checksum mismatch/,
  );
});

test("rejects untrusted release package URLs", () => {
  const value = manifest();
  value.package.url = "https://example.com/update.tgz";
  assert.throws(() => parseUpdateManifest(value), /not trusted/);
});

test("checks GitHub latest release and formats the same notes for terminal output", async () => {
  const value = manifest();
  const requests = [];
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "agent-session-update-cache-"));
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (requests.length === 1) {
      return new Response(JSON.stringify({ tag_name: "v0.2.0", assets: [{ name: "update.json", browser_download_url: "https://download.example/update.json" }] }), {
        status: 200,
        headers: { etag: '"release-etag"' },
      });
    }
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const result = await checkForUpdate({
    currentVersion: "0.1.0",
    cachePath: path.join(cacheDirectory, "update-check.json"),
    fetchImpl,
    force: true,
    now: 123,
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.manifest.version, "0.2.0");
  assert.match(formatUpdateNotice(result), /新增功能：[\s\S]*Bug 修复：/);
  assert.equal(requests.length, 2);
});

test("reports a clear error when the GitHub release check times out", async () => {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "agent-session-update-timeout-"));
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const result = await checkForUpdate({
    currentVersion: "0.1.0",
    cachePath: path.join(cacheDirectory, "update-check.json"),
    fetchImpl,
    force: true,
    timeoutMs: 5,
  });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.error, "The GitHub request timed out after 5 ms.");
});
