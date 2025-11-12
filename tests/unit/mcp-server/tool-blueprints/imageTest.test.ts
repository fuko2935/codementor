import assert from "node:assert";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { BaseErrorCode, McpError } from "../../../../src/types-global/errors.js";
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

/**
 * Bu testler, imageTest aracının auth gereksinimi olmadan kaydedildiğini ve
 * temel hata/success davranışının doğru çalıştığını doğrular.
 * Araç, varsayılan olarak serbestçe çağrılabilir; üretimde harici koruma önerilir.
 */

test("imageTest tool - registers and returns a successful response", async () => {
  const server = new McpServer();
  await registerFetchImageTestTool(server);

  const handler = getRegisteredToolHandler(server, "fetch_image_test");

  const result = await handler(
    {
      imageUrl: "https://example.com/cat.png",
    },
    {},
  );

  assert.ok(result, "Result should be defined");
  assert.strictEqual(result.isError, false, "Expected a successful response");
  assert.ok(
    Array.isArray(result.content),
    "Expected result.content to be an array",
  );
});

test("imageTest tool - surfaces McpError or Error on invalid input", async () => {
  const server = new McpServer();
  await registerFetchImageTestTool(server);

  const handler = getRegisteredToolHandler(server, "fetch_image_test");

  await assert.rejects(
    async () => {
      // Bilerek geçersiz/gereksiz bir payload kullanarak hata yüzeylenmesini doğrula.
      await handler(
        {
          imageUrl: "",
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