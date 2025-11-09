/**
 * @fileoverview Authorization scope tests for gemini_dynamic_expert_analyze tool.
 *
 * Scenarios:
 * 1) Missing required scope - expect McpError(BaseErrorCode.FORBIDDEN).
 * 2) Missing auth context   - expect McpError(BaseErrorCode.INTERNAL_ERROR).
 * 3) Required scope present - handler proceeds without FORBIDDEN.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerDynamicExpertAnalyze } from "../../../src/mcp-server/tools/dynamicExpertAnalyze/registration.js";
import { McpError, BaseErrorCode } from "../../../src/types-global/errors.js";
import { authContext } from "../../../src/mcp-server/transports/auth/core/authContext.js";

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
 * Helper to invoke the tool handler with optional auth context.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callWithAuthContext(
  scopes: string[] | null,
  handler: (params: any) => Promise<CallToolResult>,
) {
  const params = {
    projectPath: ".",
    question: "How does dynamic expert analyze work?",
    expertPrompt: "You are a test expert.",
  };

  if (scopes) {
    return await authContext.run(
      {
        authInfo: {
          clientId: "test-client",
          subject: "test-subject",
          scopes,
        },
      },
      async () => handler(params),
    );
  }

  // No auth context at all
  return handler(params);
}

describe("gemini_dynamic_expert_analyze authorization scopes", () => {
  it("rejects with FORBIDDEN when expert:analyze scope is missing", async () => {
    const server = new TestMcpServer();
    await registerDynamicExpertAnalyze(server);

    const tool = server.registeredTools.get("gemini_dynamic_expert_analyze");
    assert.ok(tool, "gemini_dynamic_expert_analyze tool should be registered");

    await assert.rejects(
      () => callWithAuthContext(["some:other"], tool!.handler),
      (error: unknown) => {
        assert.ok(error instanceof McpError, "Error should be McpError");
        assert.strictEqual(
          error.code,
          BaseErrorCode.FORBIDDEN,
          "Missing expert:analyze should yield FORBIDDEN",
        );
        return true;
      },
    );
  });

  it("rejects with INTERNAL_ERROR when auth context is missing", async () => {
    const server = new TestMcpServer();
    await registerDynamicExpertAnalyze(server);

    const tool = server.registeredTools.get("gemini_dynamic_expert_analyze");
    assert.ok(tool, "gemini_dynamic_expert_analyze tool should be registered");

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

  it("allows execution when expert:analyze scope is present", async () => {
    const server = new TestMcpServer();
    await registerDynamicExpertAnalyze(server);

    const tool = server.registeredTools.get("gemini_dynamic_expert_analyze");
    assert.ok(tool, "gemini_dynamic_expert_analyze tool should be registered");

    let unexpectedError: unknown | null = null;

    try {
      const result = await callWithAuthContext(
        ["expert:analyze"],
        tool!.handler,
      );
      assert.ok(
        result,
        "Expected a CallToolResult-like response when required scope is present",
      );

      // If handler encodes errors into the result, ensure it is not a FORBIDDEN-style error.
      if ("isError" in result && result.isError === true) {
        const text =
          Array.isArray(result.content) && result.content[0]?.type === "text"
            ? result.content[0].text
            : "";
        assert.ok(
          !/FORBIDDEN/i.test(text),
          "Result should not indicate FORBIDDEN when expert:analyze scope is present",
        );
      }
    } catch (error) {
      unexpectedError = error;
    }

    if (unexpectedError) {
      assert.ok(unexpectedError instanceof Error);
      if (unexpectedError instanceof McpError) {
        assert.notStrictEqual(
          unexpectedError.code,
          BaseErrorCode.FORBIDDEN,
          "Should not throw FORBIDDEN when expert:analyze scope is present",
        );
      }
    }
  });
}