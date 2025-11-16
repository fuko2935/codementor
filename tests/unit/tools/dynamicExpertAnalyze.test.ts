/**
 * @fileoverview Registration and basic behavior tests for
 * gemini_dynamic_expert_analyze tool.
 *
 * Note:
 * - Built-in auth/scope enforcement has been removed.
 * - These tests only verify registration and successful handler invocation.
 */

import { describe, it, expect } from "@jest/globals";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerDynamicExpertAnalyze } from "../../../src/mcp-server/tools/dynamicExpertAnalyze/registration.js";
import { TestMcpServer } from "../testUtils/testMcpServer.js";

/**
 * Helper to invoke the tool handler with standard params.
 */
 
async function callTool(
  handler: (params: any) => Promise<CallToolResult>,
) {
  const params = {
    projectPath: ".",
    question: "How does dynamic expert analyze work?",
    expertPrompt: "You are a test expert.",
  };
  return handler(params);
}

describe("gemini_dynamic_expert_analyze registration (no built-in auth)", () => {
  it("registers the tool with a callable handler", async () => {
    const server = new TestMcpServer();
    await registerDynamicExpertAnalyze(server);

    const tools = server.getTools();
    const tool = tools.get("gemini_dynamic_expert_analyze");
    expect(tool).toBeDefined();
    expect(typeof tool.handler).toBe("function");

    const result = await callTool(tool.handler);
    expect(result).toBeDefined();
  });
});