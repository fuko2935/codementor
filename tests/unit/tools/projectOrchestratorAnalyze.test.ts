/**
 * @fileoverview Authorization scope tests for project_orchestrator_analyze tool.
 *
 * Covers:
 * 1) Missing required scopes - expect McpError(BaseErrorCode.FORBIDDEN).
 * 2) Missing auth context - expect McpError(BaseErrorCode.INTERNAL_ERROR).
 * 3) Required scope present - handler proceeds without FORBIDDEN.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerProjectOrchestratorAnalyze } from "../../src/mcp-server/tools/projectOrchestratorAnalyze/registration.js";
import { McpError, BaseErrorCode } from "../../src/types-global/errors.js";
import { authContext } from "../../src/mcp-server/transports/auth/core/authContext.js";

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
    question: "How does orchestrator analyze work?",
    fileGroupsData: '{"groups":[],"totalFiles":0}',
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

describe("project_orchestrator_analyze authorization scopes", () => {
  it("should reject with FORBIDDEN when orchestration:read scope is missing", async () => {
    const server = new TestMcpServer();
    await registerProjectOrchestratorAnalyze(server);

    const tool = server.registeredTools.get("project_orchestrator_analyze");
    assert.ok(tool, "project_orchestrator_analyze tool should be registered");

    await assert.rejects(
      () => callWithAuthContext(["some:other"], tool!.handler),
      (error: unknown) => {
        assert.ok(error instanceof McpError, "Error should be McpError");
        assert.strictEqual(
          error.code,
          BaseErrorCode.FORBIDDEN,
          "Missing orchestration:read should yield FORBIDDEN",
        );
        return true;
      },
    );
  });

  it("should reject with INTERNAL_ERROR when auth context is absent", async () => {
    const server = new TestMcpServer();
    await registerProjectOrchestratorAnalyze(server);

    const tool = server.registeredTools.get("project_orchestrator_analyze");
    assert.ok(tool, "project_orchestrator_analyze tool should be registered");

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

  it("should allow execution when orchestration:read scope is present", async () => {
    const server = new TestMcpServer();
    await registerProjectOrchestratorAnalyze(server);

    const tool = server.registeredTools.get("project_orchestrator_analyze");
    assert.ok(tool, "project_orchestrator_analyze tool should be registered");

    let unexpectedError: unknown | null = null;

    try {
      const result = await callWithAuthContext(
        ["orchestration:read"],
        tool!.handler,
      );
      assert.ok(
        result,
        "Expected a CallToolResult-like response when required scope is present",
      );
    } catch (error) {
      unexpectedError = error;
    }

    if (unexpectedError) {
      assert.ok(unexpectedError instanceof Error);
      if (unexpectedError instanceof McpError) {
        assert.notStrictEqual(
          unexpectedError.code,
          BaseErrorCode.FORBIDDEN,
          "Should not return FORBIDDEN when orchestration:read is present",
        );
      }
    }
  });
}