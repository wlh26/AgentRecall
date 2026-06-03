import { liveSessionPidForSession } from "./session-focus";
import type { LiveSession, SessionSearchResult } from "./types";

export type ResumeRouteResult = { route: "resume" } | { route: "focus"; pid: number };

export function routeResumeSession(
  session: SessionSearchResult,
  liveSessions: LiveSession[],
  options: { platform?: NodeJS.Platform } = {},
): ResumeRouteResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32") return { route: "resume" };
  const pid = liveSessionPidForSession(session, liveSessions);
  return pid ? { route: "focus", pid } : { route: "resume" };
}
