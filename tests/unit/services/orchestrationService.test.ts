/**
 * @fileoverview Unit tests for orchestration service
 * @module tests/unit/services/orchestrationService
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProjectGroups,
  analyzeProjectGroups,
  orchestrateFullAnalysis,
} from "../../../src/mcp-server/services/orchestrationService.js";
import type { RequestContext } from "../../../src/utils/index.js";

// Mock the orchestrator logic modules
vi.mock("../../../src/mcp-server/tools/projectOrchestratorCreate/logic.js", () => ({
  projectOrchestratorCreateLogic: vi.fn(),
}));

vi.mock("../../../src/mcp-server/tools/projectOrchestratorAnalyze/logic.js", () => ({
  projectOrchestratorAnalyzeLogic: vi.fn(),
}));

import { projectOrchestratorCreateLogic } from "../../../src/mcp-server/tools/projectOrchestratorCreate/logic.js";
import { projectOrchestratorAnalyzeLogic } from "../../../src/mcp-server/tools/projectOrchestratorAnalyze/logic.js";

describe("orchestrationService", () => {
  let mockContext: RequestContext;

  beforeEach(() => {
    mockContext = {
      requestId: "test-request-id",
      userId: "test-user",
      clientId: "test-client",
      operation: "orchestration_test",
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  describe("createProjectGroups", () => {
    it("should delegate to projectOrchestratorCreateLogic", async () => {
      const mockResponse = {
        projectPath: "/test/path",
        groupsData: JSON.stringify({ groups: [], totalFiles: 10 }),
      };

      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue(mockResponse);

      const params = {
        projectPath: "/test/path",
        question: "Test question",
        analysisMode: "general" as const,
        maxTokensPerGroup: 900000,
        temporaryIgnore: [],
        ignoreMcpignore: false,
      };

      const result = await createProjectGroups(params, mockContext);

      expect(projectOrchestratorCreateLogic).toHaveBeenCalledWith(params, mockContext);
      expect(result).toEqual(mockResponse);
    });
  });

  describe("analyzeProjectGroups", () => {
    it("should delegate to projectOrchestratorAnalyzeLogic", async () => {
      const mockResponse = {
        projectPath: "/test/path",
        analysis: "Test analysis result",
      };

      vi.mocked(projectOrchestratorAnalyzeLogic).mockResolvedValue(mockResponse);

      const params = {
        projectPath: "/test/path",
        question: "Test question",
        analysisMode: "security" as const,
        fileGroupsData: JSON.stringify({ groups: [] }),
        maxTokensPerGroup: 900000,
      };

      const result = await analyzeProjectGroups(params, mockContext);

      expect(projectOrchestratorAnalyzeLogic).toHaveBeenCalledWith(params, mockContext);
      expect(result).toEqual(mockResponse);
    });
  });

  describe("orchestrateFullAnalysis", () => {
    it("should execute full workflow: create groups then analyze", async () => {
      const mockGroupsData = JSON.stringify({
        groups: [{ files: ["file1.ts", "file2.ts"] }],
        totalFiles: 2,
      });

      const mockCreateResponse = {
        projectPath: "/test/path",
        groupsData: mockGroupsData,
      };

      const mockAnalyzeResponse = {
        projectPath: "/test/path",
        analysis: "Complete analysis result",
      };

      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue(mockCreateResponse);
      vi.mocked(projectOrchestratorAnalyzeLogic).mockResolvedValue(mockAnalyzeResponse);

      const result = await orchestrateFullAnalysis(
        "/test/path",
        "Analyze this project",
        "general",
        900000,
        undefined,
        false,
        undefined,
        mockContext
      );

      // Verify create was called first
      expect(projectOrchestratorCreateLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: "/test/path",
          question: "Analyze this project",
          analysisMode: "general",
          maxTokensPerGroup: 900000,
        }),
        mockContext
      );

      // Verify analyze was called with groups data
      expect(projectOrchestratorAnalyzeLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: "/test/path",
          question: "Analyze this project",
          analysisMode: "general",
          fileGroupsData: mockGroupsData,
        }),
        mockContext
      );

      // Verify result includes file count
      expect(result.analysis).toBe("Complete analysis result");
      expect(result.filesProcessed).toBe(2);
    });

    it("should handle different analysis modes", async () => {
      const mockGroupsData = JSON.stringify({ groups: [], totalFiles: 5 });

      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue({
        projectPath: "/test/path",
        groupsData: mockGroupsData,
      });

      vi.mocked(projectOrchestratorAnalyzeLogic).mockResolvedValue({
        projectPath: "/test/path",
        analysis: "Security analysis",
      });

      await orchestrateFullAnalysis(
        "/test/path",
        "Find security issues",
        "security",
        900000,
        undefined,
        false,
        undefined,
        mockContext
      );

      expect(projectOrchestratorCreateLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisMode: "security",
        }),
        mockContext
      );

      expect(projectOrchestratorAnalyzeLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisMode: "security",
        }),
        mockContext
      );
    });

    it("should pass through optional parameters", async () => {
      const mockGroupsData = JSON.stringify({ groups: [], totalFiles: 0 });

      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue({
        projectPath: "/test/path",
        groupsData: mockGroupsData,
      });

      vi.mocked(projectOrchestratorAnalyzeLogic).mockResolvedValue({
        projectPath: "/test/path",
        analysis: "Result",
      });

      const temporaryIgnore = ["*.log", "node_modules/"];
      const geminiApiKey = "test-api-key";

      await orchestrateFullAnalysis(
        "/test/path",
        "Test",
        "general",
        800000,
        temporaryIgnore,
        true,
        geminiApiKey,
        mockContext
      );

      // Verify optional params are passed to create
      expect(projectOrchestratorCreateLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          temporaryIgnore,
          ignoreMcpignore: true,
          geminiApiKey,
          maxTokensPerGroup: 800000,
        }),
        mockContext
      );

      // Verify optional params are passed to analyze
      expect(projectOrchestratorAnalyzeLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          temporaryIgnore,
          geminiApiKey,
          maxTokensPerGroup: 800000,
        }),
        mockContext
      );
    });

    it("should handle invalid JSON in groups data gracefully", async () => {
      const invalidGroupsData = "invalid json {";

      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue({
        projectPath: "/test/path",
        groupsData: invalidGroupsData,
      });

      vi.mocked(projectOrchestratorAnalyzeLogic).mockResolvedValue({
        projectPath: "/test/path",
        analysis: "Result",
      });

      const result = await orchestrateFullAnalysis(
        "/test/path",
        "Test",
        "general",
        900000,
        undefined,
        false,
        undefined,
        mockContext
      );

      // Should default to 0 files when JSON parsing fails
      expect(result.filesProcessed).toBe(0);
      expect(result.analysis).toBe("Result");
    });

    it("should propagate errors from create step", async () => {
      const createError = new Error("Create failed");
      vi.mocked(projectOrchestratorCreateLogic).mockRejectedValue(createError);

      await expect(
        orchestrateFullAnalysis(
          "/test/path",
          "Test",
          "general",
          900000,
          undefined,
          false,
          undefined,
          mockContext
        )
      ).rejects.toThrow("Create failed");

      // Analyze should not be called if create fails
      expect(projectOrchestratorAnalyzeLogic).not.toHaveBeenCalled();
    });

    it("should propagate errors from analyze step", async () => {
      vi.mocked(projectOrchestratorCreateLogic).mockResolvedValue({
        projectPath: "/test/path",
        groupsData: JSON.stringify({ groups: [] }),
      });

      const analyzeError = new Error("Analyze failed");
      vi.mocked(projectOrchestratorAnalyzeLogic).mockRejectedValue(analyzeError);

      await expect(
        orchestrateFullAnalysis(
          "/test/path",
          "Test",
          "general",
          900000,
          undefined,
          false,
          undefined,
          mockContext
        )
      ).rejects.toThrow("Analyze failed");
    });
  });
});
