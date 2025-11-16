/**
 * @fileoverview Registration and basic behavior tests for
 * gemini_dynamic_expert_analyze tool.
 *
 * Note:
 * - Built-in auth/scope enforcement has been removed.
 * - These tests only verify registration and successful handler invocation.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerDynamicExpertAnalyze } from "../../../src/mcp-server/tools/dynamicExpertAnalyze/registration.js";

/**
 * Minimal fake server to capture registered tools.
 */
class TestMcpServer extends McpServer {
  public registeredTools: Map<
    string,
    {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: any;
      handler: (params: unknown) => Promise<CallToolResult>;
    }
  > = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, description: string, inputSchema: any, handler: any): void {
    this.registeredTools.set(name, {
      description,
      inputSchema,
      handler,
    });
  }
}

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

    const tool = server.registeredTools.get("gemini_dynamic_expert_analyze");
    assert.ok(tool, "gemini_dynamic_expert_analyze tool should be registered");
    assert.ok(typeof tool.handler === "function", "handler must be a function");

    const result = await callTool(tool.handler);
    assert.ok(result, "Expected handler to return a result");
  });
});