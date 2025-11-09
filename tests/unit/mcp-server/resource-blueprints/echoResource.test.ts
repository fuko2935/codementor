import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, BaseErrorCode } from "../../../../src/types-global/errors.js";
import { registerEchoResource } from "../../../../src/mcp-server/resource-blueprints/echoResource/registration.js";
import { authContext } from "../../../../src/mcp-server/transports/auth/core/authContext.js";

function getRegisteredEchoHandler(server: McpServer) {
  // The registration uses:
  //   const resourceName = "echo-resource";
  //   server.resource(resourceName, template, meta, handler);
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

function runWithAuthContext<T>(
  scopes: string[] | null,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  if (scopes === null) {
    // No authContext; call directly (simulates missing middleware)
    return fn();
  }

  return authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes,
      },
    },
    fn,
  );
}

describe("echoResource scope enforcement", () => {
  it("should throw FORBIDDEN when required scope is missing", async () => {
    const server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });

    await registerEchoResource(server);
    const handler = getRegisteredEchoHandler(server);

    await assert.rejects(
      async () => {
        await runWithAuthContext(["some:other"], () => {
          return handler(new URL("echo://hello"), { message: "hello" });
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof McpError, "Expected McpError to be thrown");
        assert.equal(
          error.code,
          BaseErrorCode.FORBIDDEN,
          "Expected FORBIDDEN error code when scope is missing",
        );
        return true;
      },
    );
  });

  it("should throw INTERNAL_ERROR when auth context is missing", async () => {
    const server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });

    await registerEchoResource(server);
    const handler = getRegisteredEchoHandler(server);

    await assert.rejects(
      async () => {
        // No authContext.run - simulates misconfiguration / missing middleware
        await handler(new URL("echo://hello"), { message: "hello" });
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

  it("should succeed when required scope resource:read is present", async () => {
    const server = new McpServer({
      name: "test-server",
      version: "1.0.0",
    });

    await registerEchoResource(server);
    const handler = getRegisteredEchoHandler(server);

    const result = await runWithAuthContext(["resource:read"], () => {
      return handler(new URL("echo://hello"), { message: "hello" });
    });

    // The handler should not fail and should return a valid ReadResourceResult-like shape
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