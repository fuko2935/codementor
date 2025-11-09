import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCalculateTokenCount } from "../../../src/mcp-server/tools/calculateTokenCount/registration.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";
import { authContext } from "../../../src/mcp-server/transports/auth/core/authContext.js";
import { callTool } from "../testUtils/testMcpServer.js";

void test("calculateTokenCount - forbidden without required scope", async () => {
  const server = new McpServer();
  await registerCalculateTokenCount(server);

  // Sağlanan auth context, gerekli scope'u içermiyor.
  await authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["some:other"],
      },
    } as any,
    async () => {
      await assert.rejects(
        async () =>
          callTool(server, "calculate_token_count", {
            projectPath: ".",
            textToAnalyze: "hello world",
            tokenizerModel: "gemini-2.0-flash",
          }),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    },
  );
});

void test("calculateTokenCount - internal error when auth context missing", async () => {
  const server = new McpServer();
  await registerCalculateTokenCount(server);

  // authContext.run olmadan: withRequiredScopes INTERNAL_ERROR döndürmeli (misconfiguration).
  await assert.rejects(
    async () =>
      callTool(server, "calculate_token_count", {
        projectPath: ".",
        textToAnalyze: "hello world",
        tokenizerModel: "gemini-2.0-flash",
      }),
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
      return true;
    },
  );
});

void test("calculateTokenCount - succeeds with analysis:read scope", async () => {
  const server = new McpServer();
  await registerCalculateTokenCount(server);

  await authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["analysis:read"],
      },
    } as any,
    async () => {
      const result = await callTool(server, "calculate_token_count", {
        projectPath: ".",
        textToAnalyze: "hello world",
        tokenizerModel: "gemini-2.0-flash",
      });

      // Handler, gerekli scope mevcutken hata fırlatmamalı ve başarılı sonuç üretmeli.
      assert.equal(result.isError, false);
      assert.ok(Array.isArray(result.content));
      assert.ok(result.content.length > 0);
    },
  );
});