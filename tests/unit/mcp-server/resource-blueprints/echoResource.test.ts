import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEchoResource } from "../../../../src/mcp-server/resource-blueprints/echoResource/registration.js";

/**
 * Helper to obtain the registered echo resource handler from the MCP server.
 */
function getRegisteredEchoHandler(server: McpServer) {
  const resources = (server as any).resources as Map<string, any> | undefined;
  assert.ok(resources, "Expected server.resources map to be defined");

  const resourceEntry = resources.get("echo-resource");
  assert.ok(resourceEntry, "Expected 'echo-resource' to be registered");

  const handler = resourceEntry.handler as
    | ((uri: URL, params: any) => Promise<any>)
    | undefined;

  assert.ok(handler, "Expected echo-resource handler to be defined");
  return handler!;
}

describe("echoResource registration (no built-in auth)", () => {
  it("registers an echo resource handler that returns a JSON payload", async () => {
    const server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });

    await registerEchoResource(server);
    const handler = getRegisteredEchoHandler(server);

    const result = await handler(new URL("echo://hello"), { message: "hello" });

    assert.ok(result, "Expected handler to return a result");
    assert.ok(
      Array.isArray(result.contents),
      "Expected result.contents to be an array",
    );
    assert.ok(
      result.contents.length > 0,
      "Expected at least one content entry in result.contents",
    );
    assert.equal(
      result.contents[0].mimeType,
      "application/json",
      "Expected JSON mimeType in response",
    );
  });
});