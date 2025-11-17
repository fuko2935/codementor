/**
 * @fileoverview Registration and basic behavior tests for
 * gemini_codebase_analyzer tool.
 *
 * Note:
 * - Built-in auth/scope enforcement has been removed.
 * - These tests verify registration and handler invocation.
 * - LLM API calls are mocked to avoid real API requests.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { registerGeminiCodebaseAnalyzer } from "../../../src/mcp-server/tools/geminiCodebaseAnalyzer/registration.js";
import { 
  geminiCodebaseAnalyzerLogic,
  type GeminiCodebaseAnalyzerInput 
} from "../../../src/mcp-server/tools/geminiCodebaseAnalyzer/logic.js";
import { requestContextService } from "../../../src/utils/index.js";
import {
  MCP_CODEMENTOR_END_MARKER as MCP_CONTENT_END_MARKER,
  MCP_CODEMENTOR_START_MARKER as MCP_CONTENT_START_MARKER,
} from "../../../src/mcp-server/utils/mcpConfigValidator.js";
import { TestMcpServer } from "../testUtils/testMcpServer.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

// Helper to invoke the tool handler with standard params
async function callTool(
  handler: (params: any) => Promise<CallToolResult>,
) {
  return handler({
    projectPath: ".",
    question: "What does this project do?",
  });
}

async function seedMcpGuide(directory: string): Promise<void> {
  const filePath = path.join(directory, "AGENTS.md");
  const content = `${MCP_CONTENT_START_MARKER}\nTest guide\n${MCP_CONTENT_END_MARKER}`;
  await fs.writeFile(filePath, content, "utf-8");
}

describe("gemini_codebase_analyzer registration (no built-in auth)", () => {
  it("registers the tool with a callable handler", async () => {
    const testServer = new TestMcpServer();
    await registerGeminiCodebaseAnalyzer(testServer.server);

    const tools = testServer.getTools();
    const tool = tools.get("gemini_codebase_analyzer");
    expect(tool).toBeDefined();
    
    if (tool) {
      expect(typeof tool.handler).toBe("function");
      // Smoke test: calling the handler should not throw synchronously and should
      // return a CallToolResult-like object or a promise thereof.
      const result = await callTool(tool.handler);
      expect(result).toBeDefined();
    }
  });
});

// Integration tests removed - customExpertPrompt feature has been deprecated

// Integration test - requires real LLM API calls
describe.skip("geminiCodebaseAnalyzerLogic autoOrchestrate behavior (integration test)", () => {
  let testDir: string;
  let context: ReturnType<typeof requestContextService.createRequestContext>;

  beforeEach(async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
    testDir = await fs.mkdtemp(path.join(TEST_ROOT, "orchestrate-"));
    await seedMcpGuide(testDir);
    context = requestContextService.createRequestContext({
      operation: "autoOrchestrateTest",
    });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("triggers orchestrator when autoOrchestrate=true and project exceeds threshold", async () => {
    // Create many files to exceed token threshold
    for (let i = 0; i < 100; i++) {
      await fs.writeFile(
        path.join(testDir, `file${i}.ts`),
        `export const value${i} = ${i};\n`.repeat(1000),
        "utf-8"
      );
    }

    const params: GeminiCodebaseAnalyzerInput = {
      projectPath: testDir,
      question: "Analyze this large project",
      autoOrchestrate: true,
      orchestratorThreshold: 0.1, // Low threshold to trigger orchestration
      ignoreMcpignore: false,
      temporaryIgnore: ["AGENTS.md"],
    };

    const result = await geminiCodebaseAnalyzerLogic(params, context);
    
    expect(result).toBeDefined();
    expect(result.analysis).toContain("Orchestrator fallback");
  }, 60000);
});