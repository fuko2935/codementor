import { describe, it, expect } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BaseErrorCode, McpError } from "../../../../src/types-global/errors.js";
import { registerCatFactFetcherTool } from "../../../../src/mcp-server/tool-blueprints/catFactFetcher/registration.js";

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

/**
 * Bu testler, catFactFetcher aracının başarılı şekilde kaydedildiğini ve temel hata
 * davranışlarının (McpError kullanımı) auth bağımlılığı olmadan sürdüğünü doğrular.
 * Sunucu, varsayılan olarak kimlik doğrulaması yapmaz; gerekli ise harici olarak korunmalıdır.
 */

describe("catFactFetcher", () => {
  it("catFactFetcher: tool registers successfully and returns a response", async () => {
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
  await registerCatFactFetcherTool(server);

  const handler = getRegisteredToolHandler(server, "get_random_cat_fact");

  const result = await handler({ maxLength: 64 });

  expect(result).toBeDefined();
  expect(result.isError).toBe(false);
  expect(Array.isArray(result.content)).toBe(true);
  });

  it("catFactFetcher: propagates McpError correctly on invalid input", async () => {
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
  await registerCatFactFetcherTool(server);

  const handler = getRegisteredToolHandler(server, "get_random_cat_fact");

  await expect(async () => {
    // Bilerek hatalı bir payload ile çağır.
    // Gerçek doğrulama mantığı registration/logic tarafında tanımlı.
    await handler({ maxLength: -1 });
  }).rejects.toThrow();
});
});