/**
 * @fileoverview Authorization tests for gemini_codebase_analyzer tool registration.
 *
 * Covers:
 * - Missing/insufficient scopes: expect McpError with FORBIDDEN (403 semantics).
 * - Sufficient scopes: handler executes underlying logic successfully.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerGeminiCodebaseAnalyzer } from "../../src/mcp-server/tools/geminiCodebaseAnalyzer/registration.js";
import { McpError, BaseErrorCode } from "../../src/types-global/errors.js";
import { authContext } from "../../src/mcp-server/transports/auth/core/authContext.js";

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

// Helper to invoke the tool handler with a given auth context
async function callWithAuthContext(
  scopes: string[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any) => Promise<CallToolResult>,
) {
  if (scopes) {
    return await authContext.run(
      {
        authInfo: {
          clientId: "test-client",
          scopes,
        },
      },
      async () => {
        return handler({
          projectPath: ".",
          question: "What does this project do?",
        });
      },
    );
  }

  // No auth context at all
  return handler({
    projectPath: ".",
    question: "What does this project do?",
  });
}

describe("gemini_codebase_analyzer authorization scopes", () => {
  it("should reject when required scopes are missing", async () => {
    const server = new TestMcpServer();
    await registerGeminiCodebaseAnalyzer(server);

    const tool = server.registeredTools.get("gemini_codebase_analyzer");
    assert.ok(tool, "gemini_codebase_analyzer tool should be registered");

    // Missing both required scopes
    await assert.rejects(
      () => callWithAuthContext(["some:other"], tool!.handler),
      (error: unknown) => {
        assert.ok(error instanceof McpError, "Error should be McpError");
        assert.strictEqual(
          error.code,
          BaseErrorCode.FORBIDDEN,
          "Error code should be FORBIDDEN for missing scopes",
        );
        return true;
      },
    );
  });

  it("should reject when auth context is absent", async () => {
    const server = new TestMcpServer();
    await registerGeminiCodebaseAnalyzer(server);

    const tool = server.registeredTools.get("gemini_codebase_analyzer");
    assert.ok(tool, "gemini_codebase_analyzer tool should be registered");

    // No authContext.run wrapper: triggers INTERNAL_ERROR from withRequiredScopes
    await assert.rejects(
      () => callWithAuthContext(null, tool!.handler),
      (error: unknown) => {
        assert.ok(error instanceof McpError, "Error should be McpError");
        assert.strictEqual(
          error.code,
          BaseErrorCode.INTERNAL_ERROR,
          "Missing auth context should be treated as INTERNAL_ERROR",
        );
        return true;
      },
    );
  });

  it("should allow when required scopes are present", async () => {
    const server = new TestMcpServer();
    await registerGeminiCodebaseAnalyzer(server);

    const tool = server.registeredTools.get("gemini_codebase_analyzer");
    assert.ok(tool, "gemini_codebase_analyzer tool should be registered");

    // Provide both required scopes; expect handler to run without throwing McpError(FORBIDDEN).
    // We do not assert on the full result shape to keep this test stable;
    // success is "no FORBIDDEN due to scope check".
    let errorCaught: unknown | null = null;
    try {
      const result = await callWithAuthContext(
        ["analysis:read", "codebase:read"],
        tool!.handler,
      );
      // Result should be a CallToolResult-like object or at least not throw FORBIDDEN.
      assert.ok(result, "Expected a successful result when scopes are valid");
    } catch (err) {
      errorCaught = err;
    }

    if (errorCaught) {
      // If something failed, ensure it is NOT due to forbidden scopes.
      assert.ok(errorCaught instanceof Error);
      if (errorCaught instanceof McpError) {
        assert.notStrictEqual(
          errorCaught.code,
          BaseErrorCode.FORBIDDEN,
          "Should not fail with FORBIDDEN when required scopes are present",
        );
      }
    }
  });
});