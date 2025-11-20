import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import { mcpConfigExists, refreshMcpConfigCache } from "../../../src/mcp-server/utils/mcpConfigValidator.js";
import type { RequestContext } from "../../../src/utils/index.js";

describe("mcpConfigValidator", () => {
  let mockContext: RequestContext;

  beforeEach(() => {
    mockContext = {
      requestId: "test-request-id",
      timestamp: new Date().toISOString(),
      operation: "test_mcp_config_validator",
    };
  });

  afterEach(async () => {
    // Clean up cache
    try {
      await fs.rm(".mcp/cache", { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe("findProjectRoot functionality", () => {
    it("should find config in project root when given a subdirectory", async () => {
      // Test with a subdirectory path
      const subdirPath = "src/mcp-server/tools";
      
      const result = await mcpConfigExists(subdirPath, mockContext, true);
      
      // Should find the config file in the project root
      expect(result.exists).toBe(true);
      expect(result.filePath).toBeDefined();
      
      // The config file should be in the project root, not in the subdirectory
      const configDir = path.dirname(result.filePath!);
      const projectRoot = process.cwd();
      
      // Config should be in root or a direct subdirectory of root (like .kiro/steering)
      expect(configDir.startsWith(projectRoot)).toBe(true);
    });

    it("should find config when given the project root", async () => {
      const rootPath = ".";
      
      const result = await mcpConfigExists(rootPath, mockContext, true);
      
      expect(result.exists).toBe(true);
      expect(result.filePath).toBeDefined();
    });

    it("should cache results for subdirectories", async () => {
      const subdirPath = "src/mcp-server/tools";
      
      // First call - should scan filesystem
      const result1 = await mcpConfigExists(subdirPath, mockContext, false);
      
      // Second call - should use cache
      const result2 = await mcpConfigExists(subdirPath, mockContext, false);
      
      expect(result1).toEqual(result2);
      expect(result1.exists).toBe(true);
    });

    it("should share cache between root and subdirectory paths", async () => {
      const rootPath = ".";
      const subdirPath = "src/mcp-server/tools";
      
      // Check root first
      const rootResult = await mcpConfigExists(rootPath, mockContext, true);
      
      // Check subdirectory - should use the same cache
      const subdirResult = await mcpConfigExists(subdirPath, mockContext, false);
      
      // Both should find the same config
      expect(rootResult.exists).toBe(subdirResult.exists);
      expect(rootResult.filePath).toBe(subdirResult.filePath);
      expect(rootResult.client).toBe(subdirResult.client);
    });
  });

  describe("cache refresh", () => {
    it("should refresh cache for project root when given subdirectory", async () => {
      const subdirPath = "src/mcp-server/tools";
      const projectRoot = process.cwd();
      
      // Refresh cache with subdirectory path
      await refreshMcpConfigCache(path.join(projectRoot, subdirPath), {
        exists: true,
        filePath: path.join(projectRoot, "AGENTS.md"),
        client: "cursor",
      });
      
      // Check that cache works for both root and subdirectory
      const rootResult = await mcpConfigExists(".", mockContext, false);
      const subdirResult = await mcpConfigExists(subdirPath, mockContext, false);
      
      expect(rootResult.exists).toBe(true);
      expect(subdirResult.exists).toBe(true);
    });
  });
});
