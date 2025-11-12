/**
 * @fileoverview Registration and basic behavior tests for
 * gemini_codebase_analyzer tool.
 *
 * Note:
 * - Built-in auth/scope enforcement has been removed.
 * - These tests only verify registration and successful handler invocation.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerGeminiCodebaseAnalyzer } from "../../src/mcp-server/tools/geminiCodebaseAnalyzer/registration.js";

// Minimal fake server implementation to capture the registered handler
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

  // Override only the 'tool' registration used in production code
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, description: string, inputSchema: any, handler: any): void {
    this.registeredTools.set(name, {
      description,
      inputSchema,
      handler,
    });
  }
}

// Helper to invoke the tool handler with standard params
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const tool = server.registeredTools.get("gemini_codebase_analyzer");
    assert.ok(tool, "gemini_codebase_analyzer tool should be registered");
    assert.ok(typeof tool.handler === "function", "handler must be a function");

    // Smoke test: calling the handler should not throw synchronously and should
    // return a CallToolResult-like object or a promise thereof.
    const result = await callTool(tool.handler);
    assert.ok(result, "Expected handler to return a result");
  });
});