import { describe, expect, it } from "vitest";
import {
  runAiAssistantTurn,
  type AiChatMessage,
  type SummaryEndpoint,
  type ToolChatCompletionFn,
  type ToolExecutor,
} from "./ai-assistant";

const endpoint: SummaryEndpoint = { baseUrl: "http://x", model: "m", apiKey: "k", apiFormat: "openai_chat" };

describe("runAiAssistantTurn", () => {
  it("executes a tool call, feeds the result back, and returns the final reply with surfaced sessionKeys", async () => {
    // Round 1: model asks to search. Round 2: model answers in plain text.
    const chatTurns: Array<{ content: string; toolCalls: { id: string; name: string; arguments: string }[] }> = [
      { content: "", toolCalls: [{ id: "c1", name: "search_sessions", arguments: JSON.stringify({ query: "sqlite migration" }) }] },
      { content: "Found the session where you fixed the SQLite migration.", toolCalls: [] },
    ];
    const sentMessages: AiChatMessage[][] = [];
    const chat: ToolChatCompletionFn = async (_endpoint, messages) => {
      sentMessages.push(messages);
      return chatTurns.shift()!;
    };

    const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
    const executeTool: ToolExecutor = async (name, args) => {
      executed.push({ name, args });
      return {
        result: [{ sessionKey: "sess-42", title: "Fix migration" }],
        sessionKeys: ["sess-42"],
      };
    };

    const result = await runAiAssistantTurn(endpoint, [{ role: "user", content: "find my sqlite migration fix" }], executeTool, {
      chat,
    });

    expect(executed).toEqual([{ name: "search_sessions", args: { query: "sqlite migration" } }]);
    expect(result.reply).toBe("Found the session where you fixed the SQLite migration.");
    expect(result.sessionKeys).toEqual(["sess-42"]);
    // The second LLM call must include the tool result so the model can answer.
    const secondCall = sentMessages[1];
    expect(secondCall.some((m) => m.role === "tool" && m.content.includes("sess-42"))).toBe(true);
  });

  it("dedupes sessionKeys surfaced across multiple tool calls", async () => {
    const chatTurns: Array<{ content: string; toolCalls: { id: string; name: string; arguments: string }[] }> = [
      {
        content: "",
        toolCalls: [
          { id: "a", name: "search_sessions", arguments: JSON.stringify({ query: "auth" }) },
          { id: "b", name: "get_session", arguments: JSON.stringify({ sessionKey: "dup" }) },
        ],
      },
      { content: "done", toolCalls: [] },
    ];
    const chat: ToolChatCompletionFn = async () => chatTurns.shift()!;
    const executeTool: ToolExecutor = async (name) => ({
      result: {},
      sessionKeys: name === "search_sessions" ? ["dup", "other"] : ["dup"],
    });

    const result = await runAiAssistantTurn(endpoint, [{ role: "user", content: "x" }], executeTool, { chat });
    expect(result.sessionKeys).toEqual(["dup", "other"]);
  });

  it("captures a tool execution error and still completes", async () => {
    const chatTurns: Array<{ content: string; toolCalls: { id: string; name: string; arguments: string }[] }> = [
      { content: "", toolCalls: [{ id: "c1", name: "search_sessions", arguments: "{}" }] },
      { content: "I hit an error but here is what I can say.", toolCalls: [] },
    ];
    const captured: AiChatMessage[][] = [];
    const chat: ToolChatCompletionFn = async (_e, messages) => {
      captured.push(messages);
      return chatTurns.shift()!;
    };
    const executeTool: ToolExecutor = async () => {
      throw new Error("db is locked");
    };

    const result = await runAiAssistantTurn(endpoint, [{ role: "user", content: "x" }], executeTool, { chat });
    expect(result.reply).toBe("I hit an error but here is what I can say.");
    const toolMsg = captured[1].find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("db is locked");
  });
});
