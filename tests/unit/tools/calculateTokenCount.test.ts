import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCalculateTokenCount } from "../../../src/mcp-server/tools/calculateTokenCount/registration.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";
import { callTool } from "../testUtils/testMcpServer.js";

void test("calculateTokenCount - reports validation errors as McpError", async () => {
  const server = new McpServer();
  await registerCalculateTokenCount(server);

  await assert.rejects(
    async () =>
      callTool(server, "calculate_token_count", {
        projectPath: "./non-existent-path",
        textToAnalyze: "hello world",
        tokenizerModel: "gemini-2.0-flash",
      }),
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(
        error.code,
        BaseErrorCode.INVALID_PARAMS,
        "Expected INVALID_PARAMS for invalid projectPath",
      );
      return true;
    },
  );
});

void test("calculateTokenCount - succeeds for valid input without auth", async () => {
  const server = new McpServer();
  await registerCalculateTokenCount(server);

  const result = await callTool(server, "calculate_token_count", {
    projectPath: ".",
    textToAnalyze: "hello world",
    tokenizerModel: "gemini-2.0-flash",
  });

  assert.equal(result.isError, false);
  assert.ok(Array.isArray(result.content));
  assert.ok(result.content.length > 0);
});
