import { execFile } from "node:child_process";
import { sourceFamily } from "./platform";
import type { LiveSession, SessionSearchResult } from "./types";

type CommandRunner = (command: string, args: string[]) => Promise<string>;

export interface FocusLiveSessionOptions {
  platform?: NodeJS.Platform;
  runner?: CommandRunner;
}

interface ProcessRecord {
  pid: number;
  ppid: number;
  command: string;
}

interface TerminalTarget {
  appName: string;
}

export function liveSessionPidForSession(session: SessionSearchResult, liveSessions: LiveSession[]): number | null {
  const family = sourceFamily(session.source);
  return liveSessions.find((liveSession) => liveSession.family === family && liveSession.rawId === session.rawId)?.pid ?? null;
}

export async function focusLiveSessionTerminal(pid: number, options: FocusLiveSessionOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("Bringing an existing terminal to front is currently supported on macOS only.");
  }

  const runner = options.runner ?? runProcess;
  const tty = normalizeTty(await runner("/bin/ps", ["-o", "tty=", "-p", String(pid)]));
  const processOutput = await runner("/bin/ps", ["-axo", "pid=,ppid=,command="]);
  const target = findTerminalTarget(pid, parseProcessRecords(processOutput));
  if (!target) throw new Error("Could not find the terminal app for this open session.");

  if (tty && (target.appName === "Terminal" || target.appName === "iTerm")) {
    try {
      const focused = await runner("/usr/bin/osascript", ["-e", buildTtyFocusScript(target.appName, tty)]);
      if (focused.trim() === "true") return;
    } catch {
      // Fall back to app activation below if tab-level focusing is unavailable.
    }
  }

  await runner("/usr/bin/osascript", ["-e", `tell application "${escapeAppleScript(target.appName)}" to activate`]);
}

function findTerminalTarget(pid: number, records: ProcessRecord[]): TerminalTarget | null {
  const byPid = new Map(records.map((record) => [record.pid, record]));
  const visited = new Set<number>();
  let current = byPid.get(pid);

  while (current && !visited.has(current.pid)) {
    visited.add(current.pid);
    const target = terminalTargetFromCommand(current.command);
    if (target) return target;
    current = byPid.get(current.ppid);
  }

  return null;
}

function terminalTargetFromCommand(command: string): TerminalTarget | null {
  const lower = command.toLowerCase();
  const executable = normalizedExecutableName(command.split(/\s+/)[0]);

  if (lower.includes("/terminal.app/") || executable === "terminal") return { appName: "Terminal" };
  if (lower.includes("/iterm.app/") || lower.includes("/iterm2.app/") || executable === "iterm" || executable === "iterm2") {
    return { appName: "iTerm" };
  }
  if (lower.includes("/ghostty.app/") || executable === "ghostty") return { appName: "Ghostty" };
  if (lower.includes("/wezterm.app/") || executable === "wezterm-gui" || executable === "wezterm") return { appName: "WezTerm" };
  if (lower.includes("/warp.app/") || executable === "warp") return { appName: "Warp" };

  return null;
}

function parseProcessRecords(output: string): ProcessRecord[] {
  const records: ProcessRecord[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3]?.trim();
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) continue;
    records.push({ pid, ppid, command });
  }
  return records;
}

function normalizeTty(output: string): string | null {
  const tty = output.trim();
  if (!tty || tty === "??") return null;
  return tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
}

function buildTtyFocusScript(appName: "Terminal" | "iTerm", tty: string): string {
  const escapedTty = escapeAppleScript(tty);
  if (appName === "Terminal") {
    return `set targetTty to "${escapedTty}"
tell application "Terminal"
  repeat with terminalWindow in windows
    repeat with terminalTab in tabs of terminalWindow
      if tty of terminalTab is targetTty then
        activate
        set selected tab of terminalWindow to terminalTab
        set index of terminalWindow to 1
        return "true"
      end if
    end repeat
  end repeat
  activate
end tell
return "false"`;
  }

  return `set targetTty to "${escapedTty}"
tell application "iTerm"
  repeat with terminalWindow in windows
    repeat with terminalTab in tabs of terminalWindow
      repeat with terminalSession in sessions of terminalTab
        if tty of terminalSession is targetTty then
          activate
          select terminalTab
          select terminalSession
          set index of terminalWindow to 1
          return "true"
        end if
      end repeat
    end repeat
  end repeat
  activate
end tell
return "false"`;
}

function normalizedExecutableName(token: string | undefined): string {
  if (!token) return "";
  return token.replace(/^['"]|['"]$/g, "").split(/[\\/]/).pop()?.toLowerCase() || "";
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
    });
  });
}
