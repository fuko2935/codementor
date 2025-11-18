import { describe, it, expect } from "@jest/globals";
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
  expect(tools).toBeDefined();

  const tool = tools?.get(name);
  expect(tool).toBeDefined();

  if (!tool) {
    throw new Error(`Tool '${name}' should be registered`);
  }

  return tool.handler;
}

/**
 * Bu testler, imageTest aracının auth gereksinimi olmadan kaydedildiğini ve
 * temel hata/success davranışının doğru çalıştığını doğrular.
 * Araç, varsayılan olarak serbestçe çağrılabilir; üretimde harici koruma önerilir.
 */

describe("imageTest", () => {
  it("imageTest tool - registers and returns a successful response", async () => {
    const server = new McpServer(
      {
        name: "test-server",
        version: "1.0.0"
      },
      {
        capabilities: {
          logging: {},
          tools: { listChanged: true },
        },
      }
    );
    await registerFetchImageTestTool(server);

    const handler = getRegisteredToolHandler(server, "fetch_image_test");

    const result = await handler(
      {
        imageUrl: "https://example.com/cat.png",
      },
      {},
    );

    expect(result).toBeDefined();
    expect(result.isError).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("imageTest tool - surfaces McpError or Error on invalid input", async () => {
    const server = new McpServer(
      {
        name: "test-server",
        version: "1.0.0"
      },
      {
        capabilities: {
          logging: {},
          tools: { listChanged: true },
        },
      }
    );
    await registerFetchImageTestTool(server);

    const handler = getRegisteredToolHandler(server, "fetch_image_test");

    await expect(async () => {
      // Bilerek geçersiz/gereksiz bir payload kullanarak hata yüzeylenmesini doğrula.
      await handler(
        {
          imageUrl: "",
        },
        {},
      );
    }).rejects.toThrow();
  });
});