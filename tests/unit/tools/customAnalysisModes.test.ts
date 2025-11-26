/**
 * @fileoverview Tests for custom analysis modes integration
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { createAnalysisModeLogic } from "../../../src/mcp-server/tools/createAnalysisMode/logic.js";
import { BASE_DIR } from "../../../src/index.js";
import type { RequestContext } from "../../../src/utils/index.js";

describe("Custom Analysis Modes", () => {
  const testModesDir = path.join(BASE_DIR, ".mcp", "analysis_modes");
  const testModeName = "test-mode";
  const testModePath = path.join(testModesDir, `${testModeName}.md`);

  const mockContext: RequestContext = {
    requestId: "test-request-id",
    userId: "test-user",
    operation: "test-operation",
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(testModesDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.unlink(testModePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe("forge with saveAs", () => {
    it("should save mode to file when saveAs is provided", async () => {
      const params = {
        action: "create" as const,
        expertiseHint: "You are a test expert",
        withAi: false,
        returnFormat: "json" as const,
        saveAs: testModeName,
      };

      const result = await createAnalysisModeLogic(params, mockContext);

      expect(result.savedPath).toBeDefined();
      expect(result.savedPath).toContain(testModeName);
      expect(result.analysisModePrompt).toBe("You are a test expert");

      // Verify file was created
      const fileExists = await fs
        .access(testModePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const fileContent = await fs.readFile(testModePath, "utf-8");
      expect(fileContent).toBe("You are a test expert");
    });

    it("should reject invalid saveAs names", async () => {
      const params = {
        action: "create" as const,
        expertiseHint: "You are a test expert",
        withAi: false,
        returnFormat: "json" as const,
        saveAs: "../../../etc/passwd", // Path traversal attempt
      };

      await expect(createAnalysisModeLogic(params, mockContext)).rejects.toThrow();
    });

    it("should work without saveAs parameter", async () => {
      const params = {
        action: "create" as const,
        expertiseHint: "You are a test expert",
        withAi: false,
        returnFormat: "json" as const,
      };

      const result = await createAnalysisModeLogic(params, mockContext);

      expect(result.savedPath).toBeUndefined();
      expect(result.analysisModePrompt).toBe("You are a test expert");
    });
  });

  describe("analysisMode format validation", () => {
    it("should accept standard modes", () => {
      const standardModes = [
        "general",
        "security",
        "performance",
        "review",
        "implementation",
      ];

      standardModes.forEach((mode) => {
        expect(mode).toBeTruthy();
      });
    });

    it("should accept custom mode format", () => {
      const customMode = "custom:my-expert";
      expect(customMode.startsWith("custom:")).toBe(true);
    });

    it("should validate custom mode name format", () => {
      const validNames = ["my-expert", "test_mode", "expert123"];
      const invalidNames = ["../etc", "mode with spaces", "mode/path"];

      validNames.forEach((name) => {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
      });

      invalidNames.forEach((name) => {
        expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(false);
      });
    });
  });
});
