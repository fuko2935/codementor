import { describe, it, expect } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCalculateTokenCount } from "../../../src/mcp-server/tools/calculateTokenCount/registration.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";
import { callTool } from "../testUtils/testMcpServer.js";

describe("calculateTokenCount", () => {
  it("reports validation errors as McpError", async () => {
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
    await registerCalculateTokenCount(server);

    await expect(
      callTool(server, "calculate_token_count", {
        projectPath: "./non-existent-path",
        textToAnalyze: "hello world",
        tokenizerModel: "gemini-2.0-flash",
      })
    ).rejects.toThrow(McpError);
  });

  it("succeeds for valid input without auth", async () => {
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
    await registerCalculateTokenCount(server);

    const result = await callTool(server, "calculate_token_count", {
      projectPath: ".",
      textToAnalyze: "hello world",
      tokenizerModel: "gemini-2.0-flash",
    });

    expect(result.isError).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });
});
