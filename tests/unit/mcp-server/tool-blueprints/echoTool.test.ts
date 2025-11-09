import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authContext } from "../../../../../src/mcp-server/transports/auth/core/authContext.js";
import {
  BaseErrorCode,
  McpError,
} from "../../../../../src/types-global/errors.js";
import { registerEchoTool } from "../../../../../src/mcp-server/tool-blueprints/echoTool/registration.js";

type ToolHandler = (
  params: unknown,
  mcpContext?: unknown,
) => Promise<{ content: unknown; isError?: boolean }>;

function getRegisteredToolHandler(server: McpServer, name: string): ToolHandler {
  // Access the internal tools registry consistent with other tests that introspect server registrations.
  // If the SDK changes, this helper should be updated accordingly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyServer = server as any;

  if (!anyServer.tools || !anyServer.tools.has(name)) {
    throw new Error(`Tool '${name}' is not registered on the server instance.`);
  }

  const toolDef = anyServer.tools.get(name);
  if (!toolDef || typeof toolDef.handler !== "function") {
    throw new Error(
      `Tool '${name}' does not expose a callable handler in the expected shape.`,
    );
  }

  return toolDef.handler as ToolHandler;
}

test("echoTool - missing required scope results in FORBIDDEN McpError", async () => {
  const server = new McpServer();
  await registerEchoTool(server);

  const handler = getRegisteredToolHandler(server, "echo_message");

  const store = {
    authInfo: {
      clientId: "test-client",
      subject: "test-subject",
      scopes: ["some:other"],
    },
  };

  await assert.rejects(
    async () => {
      await authContext.run(store, async () => {
        await handler(
          {
            message: "hello",
          },
          {},
        );
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, BaseErrorCode.FORBIDDEN);
      return true;
    },
  );
});

test("echoTool - missing auth context results in INTERNAL_ERROR McpError", async () => {
  const server = new McpServer();
  await registerEchoTool(server);

  const handler = getRegisteredToolHandler(server, "echo_message");

  await assert.rejects(
    async () => {
      await handler(
        {
          message: "hello",
        },
        {},
      );
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
      return true;
    },
  );
});

test("echoTool - with utility:use scope succeeds and preserves echo behavior", async () => {
  const server = new McpServer();
  await registerEchoTool(server);

  const handler = getRegisteredToolHandler(server, "echo_message");

  const store = {
    authInfo: {
      clientId: "test-client",
      subject: "test-subject",
      scopes: ["utility:use"],
    },
  };

  const result = await authContext.run(store, async () => {
    return handler(
      {
        message: "hello",
        repeat: 1,
      },
      {},
    );
  });

  assert.ok(result);
  assert.equal(result.isError, false);

  const textContent = Array.isArray(result.content)
    ? result.content.find(
        (c: any) => c && c.type === "text" && typeof c.text === "string",
      )?.text
    : undefined;

  assert.ok(
    typeof textContent === "string",
    "Expected text content in echo tool response",
  );

  const parsed = JSON.parse(textContent as string);
  assert.ok(
    parsed && (parsed.message || parsed.output || parsed.result),
    "Echo behavior should be preserved in the response structure",
  );
});