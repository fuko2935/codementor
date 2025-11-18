import { describe, it, expect } from "@jest/globals";
import { registerCalculateTokenCount } from "../../../src/mcp-server/tools/calculateTokenCount/registration.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";
import { TestMcpServer, callTool } from "../testUtils/testMcpServer.js";

describe("calculateTokenCount", () => {
  it("reports validation errors as McpError", async () => {
    const testServer = new TestMcpServer();
    await registerCalculateTokenCount(testServer as any);

    const tools = testServer.getTools();
    const tool = tools.get("calculate_token_count");
    
    if (!tool) {
      throw new Error("Tool not registered");
    }

    await expect(
      tool.handler({
        projectPath: "./non-existent-path",
        textToAnalyze: "hello world",
        tokenizerModel: "gemini-2.0-flash",
      })
    ).rejects.toThrow(McpError);
  });

  it("succeeds for valid input without auth", async () => {
    const testServer = new TestMcpServer();
    await registerCalculateTokenCount(testServer as any);

    const tools = testServer.getTools();
    const tool = tools.get("calculate_token_count");
    
    if (!tool) {
      throw new Error("Tool not registered");
    }

    const result = await tool.handler({
      projectPath: ".",
      textToAnalyze: "hello world",
      tokenizerModel: "gemini-2.0-flash",
    });

    expect(result.isError).toBe(false);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });
});
