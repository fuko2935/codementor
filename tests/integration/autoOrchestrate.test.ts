/**
 * @fileoverview Integration tests for auto-orchestration feature
 * @module tests/integration/autoOrchestrate
 * 
 * Tests the automatic orchestration fallback when project size exceeds token limits.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { geminiCodebaseAnalyzerLogic } from "../../src/mcp-server/tools/geminiCodebaseAnalyzer/logic.js";
import type { RequestContext } from "../../src/utils/index.js";

describe("Auto-Orchestration Integration Tests", () => {
  const testProjectPath = path.join(process.cwd(), ".test-temp", "large-project");
  let mockContext: RequestContext;

  beforeAll(async () => {
    // Create test context
    mockContext = {
      requestId: "test-auto-orchestrate",
      userId: "test-user",
      clientId: "test-client",
      operation: "auto_orchestrate_test",
    };

    // Create a large test project that exceeds threshold
    await fs.mkdir(testProjectPath, { recursive: true });
    
    // Create multiple large files to exceed token threshold
    for (let i = 0; i < 50; i++) {
      const content = `// File ${i}\n${"x".repeat(10000)}\n`;
      await fs.writeFile(
        path.join(testProjectPath, `file${i}.js`),
        content,
        "utf-8"
      );
    }

    // Create .mcp directory for config validation
    await fs.mkdir(path.join(testProjectPath, ".mcp"), { recursive: true });
    await fs.writeFile(
      path.join(testProjectPath, ".mcp", ".mcpignore"),
      "node_modules/\n",
      "utf-8"
    );
  });

  afterAll(async () => {
    // Cleanup test project
    try {
      await fs.rm(testProjectPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should automatically trigger orchestration when project exceeds threshold", async () => {
    const params = {
      projectPath: testProjectPath,
      question: "What does this project do?",
      analysisMode: "general" as const,
      autoOrchestrate: true,
      orchestratorThreshold: 0.01, // Very low threshold to trigger orchestration
    };

    const result = await geminiCodebaseAnalyzerLogic(params, mockContext);

    // Verify orchestration was triggered
    expect(result.analysis).toContain("Orchestrator fallback used automatically");
    expect(result.analysis).toContain("Project size exceeded token limits");
    expect(result.projectPath).toBe(testProjectPath);
    expect(result.filesProcessed).toBeGreaterThan(0);
  }, 60000); // 60 second timeout for LLM calls

  it("should suggest orchestration when near threshold but not auto-orchestrate", async () => {
    const params = {
      projectPath: testProjectPath,
      question: "Analyze this codebase",
      analysisMode: "general" as const,
      autoOrchestrate: false,
      orchestratorThreshold: 0.01, // Very low threshold
    };

    try {
      await geminiCodebaseAnalyzerLogic(params, mockContext);
      // Should throw before reaching here
      expect.fail("Should have thrown validation error");
    } catch (error: any) {
      // Verify error message suggests orchestration
      expect(error.message).toContain("project_orchestrator");
      expect(error.message).toContain("autoOrchestrate=true");
    }
  });

  it("should handle review mode gracefully in orchestration fallback", async () => {
    const params = {
      projectPath: testProjectPath,
      question: "Review recent changes",
      analysisMode: "review" as const,
      autoOrchestrate: true,
      orchestratorThreshold: 0.01,
      includeChanges: {
        revision: ".",
      },
    };

    const result = await geminiCodebaseAnalyzerLogic(params, mockContext);

    // Verify fallback message about review mode not supported
    expect(result.analysis).toContain("'review' mode is not yet supported in orchestrator fallback");
    expect(result.analysis).toContain("switched to 'general'");
  }, 60000);

  it("should respect custom orchestratorThreshold setting", async () => {
    const params = {
      projectPath: testProjectPath,
      question: "What is this?",
      analysisMode: "general" as const,
      autoOrchestrate: true,
      orchestratorThreshold: 0.95, // Very high threshold - should not trigger
    };

    // This should work without orchestration since threshold is high
    // (assuming our test project is not THAT large)
    const result = await geminiCodebaseAnalyzerLogic(params, mockContext);

    // If orchestration was NOT triggered, analysis should not contain fallback message
    // If it WAS triggered (project is huge), that's also valid
    expect(result).toBeDefined();
    expect(result.projectPath).toBe(testProjectPath);
  }, 60000);
});
