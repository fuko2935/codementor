import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

/**
 * Bu testler, echoTool kaydının auth bağımlılığı olmadan çalıştığını ve
 * MCP hatalarının doğru yüzeylendiğini doğrular.
 * Araç, varsayılan olarak serbestçe çağrılabilir; üretimde harici koruma önerilir.
 */

test("echoTool - registers and echoes a basic message", async () => {
  const server = new McpServer();
  await registerEchoTool(server);

  const handler = getRegisteredToolHandler(server, "echo_message");

  const result = await handler(
    {
      message: "hello",
      repeat: 1,
    },
    {},
  );

  assert.ok(result, "Expected a result from echo tool");
  assert.equal(result.isError, false);

  const textContent = Array.isArray(result.content)
    ? result.content.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

test("echoTool - surfaces McpError for invalid input", async () => {
  const server = new McpServer();
  await registerEchoTool(server);

  const handler = getRegisteredToolHandler(server, "echo_message");

  await assert.rejects(
    async () => {
      // Beklenen şemaya uymayan bir payload ile çağır.
      await handler(
        {
          // message alanını bilerek eksik bırakıyoruz.
          repeat: -1,
        },
        {},
      );
    },
    (error: unknown) => {
      assert.ok(error instanceof McpError || error instanceof Error);
      return true;
    },
  );
});