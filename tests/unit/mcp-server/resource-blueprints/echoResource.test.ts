import { describe, it, expect } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEchoResource } from "../../../../src/mcp-server/resource-blueprints/echoResource/registration.js";

/**
 * Helper to obtain the registered echo resource handler from the MCP server.
 */
function getRegisteredEchoHandler(server: McpServer) {
  const resources = (server as any).resources as Map<string, any> | undefined;
  expect(resources).toBeDefined();

  const resourceEntry = resources?.get("echo-resource");
  expect(resourceEntry).toBeDefined();

  const handler = resourceEntry.handler as
    | ((uri: URL, params: any) => Promise<any>)
    | undefined;

  expect(handler).toBeDefined();
  return handler!;
}

describe("echoResource registration (no built-in auth)", () => {
  it("registers an echo resource handler that returns a JSON payload", async () => {
    const server = new McpServer(
      {
        name: "test-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          logging: {},
          tools: { listChanged: true },
        },
      }
    );

    await registerEchoResource(server);
    const handler = getRegisteredEchoHandler(server);

    const result = await handler(new URL("echo://hello"), { message: "hello" });

    expect(result).toBeDefined();
    expect(Array.isArray(result.contents)).toBe(true);
    expect(result.contents.length).toBeGreaterThan(0);
    expect(result.contents[0].mimeType).toBe("application/json");
  });
});