import assert from "node:assert";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BaseErrorCode, McpError } from "../../../../src/types-global/errors.js";
import { authContext } from "../../../../src/mcp-server/transports/auth/core/authContext.js";
import { registerFetchImageTestTool } from "../../../../src/mcp-server/tool-blueprints/imageTest/registration.js";

type ToolHandler = (
  args?: unknown,
  toolContext?: unknown,
) => Promise<CallToolResult>;

function getRegisteredToolHandler(server: McpServer, name: string): ToolHandler {
  const anyServer = server as unknown as {
    tools?: Map<
      string,
      {
        handler: ToolHandler;
      }
    >;
  };

  const tools = anyServer.tools;
  assert.ok(tools, "Server should have a tools map exposing registered tools");

  const tool = tools.get(name);
  assert.ok(tool, `Tool '${name}' should be registered`);

  return tool.handler;
}

test("imageTest tool - forbidden when required scope is missing", async () => {
  const server = new McpServer();

  await registerFetchImageTestTool(server);

  const handler = getRegisteredToolHandler(server, "fetch_image_test");

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
          await handler(
            {
              // Minimal valid shape; exact fields validated in logic layer, we focus on auth here.
              imageUrl: "https://example.com/cat.png",
            },
            {},
          );
        },
      );
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError, "Error should be an McpError");
      assert.strictEqual(
        error.code,
        BaseErrorCode.FORBIDDEN,
        "Expected FORBIDDEN when required scope is missing",
      );
      return true;
    },
  );
});

test("imageTest tool - internal error when auth context is missing", async () => {
  const server = new McpServer();

  await registerFetchImageTestTool(server);

  const handler = getRegisteredToolHandler(server, "fetch_image_test");

  await assert.rejects(
    async () => {
      await handler(
        {
          imageUrl: "https://example.com/cat.png",
        },
        {},
      );
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError, "Error should be an McpError");
      assert.strictEqual(
        error.code,
        BaseErrorCode.INTERNAL_ERROR,
        "Expected INTERNAL_ERROR when auth context is missing",
      );
      return true;
    },
  );
});

test("imageTest tool - succeeds when required scope is present", async () => {
  const server = new McpServer();

  await registerFetchImageTestTool(server);

  const handler = getRegisteredToolHandler(server, "fetch_image_test");

  const result = await authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["image:analyze"],
      },
    },
    async () => {
      return handler(
        {
          imageUrl: "https://example.com/cat.png",
        },
        {},
      );
    },
  );

  assert.ok(result, "Result should be defined");
  assert.strictEqual(result.isError, false, "Expected a successful response");
  assert.ok(
    Array.isArray(result.content),
    "Expected result.content to be an array",
  );
});