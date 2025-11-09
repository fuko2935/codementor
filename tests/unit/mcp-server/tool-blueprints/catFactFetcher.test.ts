import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BaseErrorCode, McpError } from "../../../../src/types-global/errors.js";
import { registerCatFactFetcherTool } from "../../../../src/mcp-server/tool-blueprints/catFactFetcher/registration.js";
import { authContext } from "../../../../src/mcp-server/transports/auth/core/authContext.js";

type ToolHandler = (
  params: unknown,
  mcpContext?: unknown,
) => Promise<{ content: unknown; isError?: boolean }>;

function getRegisteredToolHandler(server: McpServer, name: string): ToolHandler {
  const toolsMap = (server as unknown as { tools: Map<string, unknown> }).tools;
  const tool = toolsMap.get(name) as
    | {
        handler: ToolHandler;
      }
    | undefined;

  if (!tool || typeof tool.handler !== "function") {
    throw new Error(`Tool handler for '${name}' not found or invalid.`);
  }

  return tool.handler;
}

test("catFactFetcher: missing required scope results in FORBIDDEN", async () => {
  const server = new McpServer();
  await registerCatFactFetcherTool(server);

  const handler = getRegisteredToolHandler(server, "get_random_cat_fact");

  await assert.rejects(
    async () => {
      await authContext.run(
        {
          authInfo: {
            clientId: "test-client",
            subject: "test-subject",
            scopes: ["some:other"],
          },
        },
        async () => {
          await handler({ maxLength: 64 });
        },
      );
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError, "Expected McpError to be thrown");
      assert.equal(
        error.code,
        BaseErrorCode.FORBIDDEN,
        "Expected FORBIDDEN error code for missing scope",
      );
      return true;
    },
  );
});

test("catFactFetcher: missing auth context results in INTERNAL_ERROR", async () => {
  const server = new McpServer();
  await registerCatFactFetcherTool(server);

  const handler = getRegisteredToolHandler(server, "get_random_cat_fact");

  await assert.rejects(
    async () => {
      await handler({ maxLength: 64 });
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError, "Expected McpError to be thrown");
      assert.equal(
        error.code,
        BaseErrorCode.INTERNAL_ERROR,
        "Expected INTERNAL_ERROR when auth context is missing",
      );
      return true;
    },
  );
});

test("catFactFetcher: succeeds when required external:fetch scope is present", async () => {
  const server = new McpServer();
  await registerCatFactFetcherTool(server);

  const handler = getRegisteredToolHandler(server, "get_random_cat_fact");

  const result = await authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["external:fetch"],
      },
    },
    async () => {
      return handler({ maxLength: 64 });
    },
  );

  assert.ok(result, "Expected handler to return a result");
  assert.equal(
    result.isError,
    false,
    "Expected successful response (isError should be false or undefined)",
  );
  assert.ok(
    Array.isArray(result.content),
    "Expected content to be an array in successful response",
  );
});