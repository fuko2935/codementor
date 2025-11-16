/**
 * @fileoverview Registration and basic behavior tests for
 * gemini_codebase_analyzer tool.
 *
 * Note:
 * - Built-in auth/scope enforcement has been removed.
 * - These tests only verify registration and successful handler invocation.
 */

import { describe, it, expect } from "@jest/globals";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerGeminiCodebaseAnalyzer } from "../../../src/mcp-server/tools/geminiCodebaseAnalyzer/registration.js";
import { TestMcpServer } from "../testUtils/testMcpServer.js";

// Helper to invoke the tool handler with standard params
async function callTool(
  handler: (params: any) => Promise<CallToolResult>,
) {
  return handler({
    projectPath: ".",
    question: "What does this project do?",
  });
}

describe("gemini_codebase_analyzer registration (no built-in auth)", () => {
  it("registers the tool with a callable handler", async () => {
    const server = new TestMcpServer();
    await registerGeminiCodebaseAnalyzer(server);

    const tools = server.getTools();
    const tool = tools.get("gemini_codebase_analyzer");
    expect(tool).toBeDefined();
    expect(typeof tool.handler).toBe("function");

    // Smoke test: calling the handler should not throw synchronously and should
    // return a CallToolResult-like object or a promise thereof.
    const result = await callTool(tool.handler);
    expect(result).toBeDefined();
  });
});