import type { ApiConfig, ApiFormat } from "./api-config";

// Accepts any role string so non user/assistant rows (e.g. tool output) can be filtered out.
export interface SummaryInputMessage {
  role: string;
  content: string;
}

// AI session summaries: a one-line "problem + solution" summary plus suggested
// tags/title for each session. The summary is what makes session search good —
// it normalizes wildly different transcripts into searchable language.

export interface SummaryEndpoint {
  baseUrl: string;
  model: string;
  apiKey: string;
  apiFormat: ApiFormat;
}

export interface SessionSummaryResult {
  summary: string;
  tags: string[];
  title: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const MAX_MESSAGES = 14;
const MAX_CHARS_PER_MESSAGE = 1500;
const MAX_TOTAL_CHARS = 12_000;
const MAX_TAGS = 5;

// Picks the first usable custom endpoint from the candidate configs in order.
// Callers pass the dedicated summary config first, then existing configs, so an
// unconfigured dedicated provider transparently falls back to the existing one.
export function resolveSummaryEndpoint(candidates: readonly ApiConfig[]): SummaryEndpoint | null {
  for (const config of candidates) {
    if (config.activeProvider !== "custom") continue;
    const baseUrl = config.customBaseUrl.trim().replace(/\/+$/, "");
    const model = config.customModel.trim();
    const apiKey = config.customApiKey.trim();
    if (baseUrl && model && apiKey) {
      return { baseUrl, model, apiKey, apiFormat: config.customApiFormat };
    }
  }
  return null;
}

// A stored summary remembers which version of the session it described, so we can
// tell when the session has since been updated and the summary needs refreshing.
export interface SummaryRecord {
  basisUpdatedAt: number;
}

export type SummaryFreshness = "missing" | "stale" | "fresh";

export function summaryFreshness(session: { updatedAt: number }, record: SummaryRecord | null): SummaryFreshness {
  if (!record) return "missing";
  return session.updatedAt > record.basisUpdatedAt ? "stale" : "fresh";
}

// Batch/auto backfill: only touch sessions updated within maxAgeMs, and only when
// the summary is missing or stale. Manual single-session summaries bypass this.
export function needsBackfill(
  session: { updatedAt: number },
  record: SummaryRecord | null,
  now: number,
  maxAgeMs: number,
): boolean {
  if (now - session.updatedAt > maxAgeMs) return false;
  return summaryFreshness(session, record) !== "fresh";
}

const SYSTEM_PROMPT =
  "You label developer AI-coding sessions so they can be found again later. " +
  "Read the transcript excerpt and reply with a single JSON object and nothing else: " +
  '{"summary": string, "title": string, "tags": string[]}. ' +
  "summary: one sentence naming the problem AND how it was solved (or the current state). " +
  "title: <= 8 words. tags: 2-5 short lowercase topic tags (tools, languages, domains). " +
  "Write summary and title in the same language the user mostly used in the transcript.";

export function buildSummaryMessages(messages: readonly SummaryInputMessage[]): ChatMessage[] {
  const transcript = buildTranscript(messages);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Transcript excerpt:\n\n${transcript}` },
  ];
}

function buildTranscript(messages: readonly SummaryInputMessage[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const message of messages) {
    const content = (message.content ?? "").trim();
    if (!content) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const clipped = content.length > MAX_CHARS_PER_MESSAGE ? `${content.slice(0, MAX_CHARS_PER_MESSAGE)}…` : content;
    const line = `${message.role.toUpperCase()}: ${clipped}`;
    if (total + line.length > MAX_TOTAL_CHARS) break;
    lines.push(line);
    total += line.length;
    if (lines.length >= MAX_MESSAGES) break;
  }
  return lines.join("\n\n");
}

export function parseSummaryResponse(text: string): SessionSummaryResult {
  const json = extractJsonObject(text);
  if (!json) throw new Error("AI summary response was not valid JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("AI summary response was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("AI summary response was not an object.");
  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const tags = normalizeTags(record.tags);
  if (!summary) throw new Error("AI summary response had no summary.");
  return { summary, title, tags };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

// Models sometimes wrap JSON in prose or code fences; grab the outermost object.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

export type ChatCompletionFn = (endpoint: SummaryEndpoint, messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export async function summarizeSession(
  messages: readonly SummaryInputMessage[],
  endpoint: SummaryEndpoint,
  chat: ChatCompletionFn = defaultChatCompletion,
  signal?: AbortSignal,
): Promise<SessionSummaryResult> {
  const chatMessages = buildSummaryMessages(messages);
  if (!chatMessages[1].content.includes("USER") && !chatMessages[1].content.includes("ASSISTANT")) {
    throw new Error("Session has no readable user/assistant messages to summarize.");
  }
  const reply = await chat(endpoint, chatMessages, signal);
  return parseSummaryResponse(reply);
}

// OpenAI-compatible /chat/completions. Covers the openai_chat presets
// (DeepSeek, GLM, Kimi, LongCat, MiMo) and most custom providers.
async function defaultChatCompletion(endpoint: SummaryEndpoint, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  if (endpoint.apiFormat !== "openai_chat") {
    throw new Error(`AI summary requires an OpenAI chat-compatible provider (got ${endpoint.apiFormat}).`);
  }
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify({ model: endpoint.model, messages, temperature: 0.2, stream: false }),
    signal,
  });
  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`AI summary request failed (HTTP ${response.status}). ${detail}`.trim());
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("AI summary response had no content.");
  return content;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return "";
  }
}
