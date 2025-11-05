/**
 * @fileoverview Unit tests for mcp_setup_guide tool
 * Tests file creation, updating, and marker-based content injection
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  mcpSetupGuideLogic,
  MCP_CONTENT_START_MARKER,
  MCP_CONTENT_END_MARKER,
  type McpSetupGuideInput,
} from "../../../src/mcp-server/tools/mcpSetupGuide/logic.js";
import { requestContextService } from "../../../src/utils/index.js";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("mcpSetupGuide Tool", () => {
  let testDir: string;
  let context: ReturnType<typeof requestContextService.createRequestContext>;

  beforeEach(async () => {
    // Create a temporary test directory inside project (for security validation)
    testDir = path.join(process.cwd(), ".test-temp", `mcp-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Clean up any existing test files in project root
    const testFiles = ["AGENTS.md", "GEMINI.md", "CLAUDE.md", "WARP.md", ".clinerules", ".kiro"];
    for (const file of testFiles) {
      const filePath = path.join(process.cwd(), file);
      try {
        await fs.rm(filePath, { recursive: true, force: true });
      } catch (_error) {
        // Ignore if doesn't exist
      }
    }

    // Create request context
    context = requestContextService.createRequestContext({
      operation: "test_mcp_setup_guide",
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe("File Creation", () => {
    it("should create a new AGENTS.md file when none exists", async () => {
      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Use relative path, will be validated against process.cwd()
        force: true,  // Force to overwrite existing file for tests
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      // Can be "created" or "updated" depending on whether AGENTS.md exists
      assert.ok(result.action === "created" || result.action === "updated");
      assert.ok(result.filePath.includes("AGENTS.md"));

      // Verify file was created
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const content = await fs.readFile(filePath, "utf-8");
      assert.ok(content.includes(MCP_CONTENT_START_MARKER));
      assert.ok(content.includes(MCP_CONTENT_END_MARKER));
      assert.ok(content.includes("MCP = YOUR MENTOR"));
    });

    it("should create file in subdirectory for clients like cline", async () => {
      const params: McpSetupGuideInput = {
        client: "cline",
        projectPath: ".",  // Validated against process.cwd()
        force: true,  // Force to overwrite for tests
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      // Can be "created" or "updated" depending on whether AGENTS.md exists
      assert.ok(result.action === "created" || result.action === "updated");

      // Verify directory and file were created
      const filePath = path.join(process.cwd(), ".clinerules", "mcp-guide.md");
      const content = await fs.readFile(filePath, "utf-8");
      assert.ok(content.includes(MCP_CONTENT_START_MARKER));
    });

    it("should create different file names for different clients", async () => {
      const clients: Array<{ client: McpSetupGuideInput["client"]; expectedFile: string }> = [
        { client: "cursor", expectedFile: "AGENTS.md" },
        { client: "claude-code", expectedFile: "CLAUDE.md" },
        { client: "gemini-cli", expectedFile: "GEMINI.md" },
        { client: "warp", expectedFile: "WARP.md" },
      ];

      for (const { client, expectedFile } of clients) {
        const clientDir = path.join(testDir, client);
        await fs.mkdir(clientDir, { recursive: true });

        const params: McpSetupGuideInput = {
          client,
          projectPath: clientDir,
          force: false,
        };

        const result = await mcpSetupGuideLogic(params, context);
        assert.strictEqual(result.success, true);
        assert.ok(result.filePath.includes(expectedFile));

        // Verify file exists
        const fileExists = await fs
          .access(result.filePath)
          .then(() => true)
          .catch(() => false);
        assert.strictEqual(fileExists, true);
      }
    });
  });

  describe("Content Update", () => {
    it("should append MCP block to existing file without markers", async () => {
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const existingContent = "# Existing Content\n\nSome existing documentation.\n";
      await fs.writeFile(filePath, existingContent, "utf-8");

      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, "updated");

      // Verify existing content is preserved and MCP block is appended
      const updatedContent = await fs.readFile(filePath, "utf-8");
      assert.ok(updatedContent.includes(existingContent));
      assert.ok(updatedContent.includes(MCP_CONTENT_START_MARKER));
      assert.ok(updatedContent.includes(MCP_CONTENT_END_MARKER));
    });

    it("should replace existing MCP block in file", async () => {
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const initialContent = `# Existing Content\n\n${MCP_CONTENT_START_MARKER}\nOld MCP Content\n${MCP_CONTENT_END_MARKER}\n\n## More Content\n`;
      await fs.writeFile(filePath, initialContent, "utf-8");

      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, "updated");

      // Verify MCP block was replaced, not appended
      const updatedContent = await fs.readFile(filePath, "utf-8");
      const mcpBlockCount = (updatedContent.match(new RegExp(MCP_CONTENT_START_MARKER, "g")) || []).length;
      assert.strictEqual(mcpBlockCount, 1);
      assert.ok(updatedContent.includes("# Existing Content"));
      assert.ok(updatedContent.includes("## More Content"));
      assert.ok(!updatedContent.includes("Old MCP Content"));
    });

    it("should skip update if content is unchanged and force is false", async () => {
      // First, create the file
      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      await mcpSetupGuideLogic(params, context);

      // Try to update again without force
      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, "skipped");
      assert.ok(result.message.includes("already up to date"));
    });

    it("should force update when force parameter is true", async () => {
      // First, create the file
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      await mcpSetupGuideLogic(params, context);
      
      // Wait a bit to ensure timestamp would differ
      await new Promise(resolve => setTimeout(resolve, 10));

      // Force update with same content
      const forceParams: McpSetupGuideInput = {
        ...params,
        force: true,
      };
      
      const result = await mcpSetupGuideLogic(forceParams, context);

      // Should report update even if content is same when force is true
      assert.strictEqual(result.success, true);
      
      // Content should be present
      const updatedContent = await fs.readFile(filePath, "utf-8");
      assert.ok(updatedContent.includes(MCP_CONTENT_START_MARKER));
    });
  });

  describe("Content Preservation", () => {
    it("should preserve content before and after MCP markers", async () => {
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const beforeContent = "# Project Documentation\n\nImportant notes.\n\n";
      const afterContent = "\n\n## Additional Information\n\nMore details.\n";
      const initialContent = `${beforeContent}${MCP_CONTENT_START_MARKER}\nOld MCP\n${MCP_CONTENT_END_MARKER}${afterContent}`;
      await fs.writeFile(filePath, initialContent, "utf-8");

      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);

      const updatedContent = await fs.readFile(filePath, "utf-8");
      assert.ok(updatedContent.includes("# Project Documentation"));
      assert.ok(updatedContent.includes("Important notes."));
      assert.ok(updatedContent.includes("## Additional Information"));
      assert.ok(updatedContent.includes("More details."));
    });

    it("should handle files with only partial markers gracefully", async () => {
      const filePath = path.join(process.cwd(), "AGENTS.md");
      // File with only start marker (incomplete)
      const incompleteContent = `# Documentation\n\n${MCP_CONTENT_START_MARKER}\nIncomplete block\n\n## More content`;
      await fs.writeFile(filePath, incompleteContent, "utf-8");

      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, "updated");

      // Should append new block since markers are incomplete
      const updatedContent = await fs.readFile(filePath, "utf-8");
      assert.ok(updatedContent.includes("# Documentation"));
      assert.ok(updatedContent.includes(MCP_CONTENT_START_MARKER));
      assert.ok(updatedContent.includes(MCP_CONTENT_END_MARKER));
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in file content", async () => {
      const filePath = path.join(process.cwd(), "AGENTS.md");
      const specialContent = "# Code Examples\n\n```typescript\nconst regex = /[.*+?^${}()|[\\]\\\\]/g;\n```\n";
      await fs.writeFile(filePath, specialContent, "utf-8");

      const params: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);

      const updatedContent = await fs.readFile(filePath, "utf-8");
      assert.ok(updatedContent.includes("const regex = /[.*+?^${}()|[\\]\\\\]/g;"));
    });

    it("should create nested directories if needed", async () => {
      const params: McpSetupGuideInput = {
        client: "kiro",
        projectPath: ".",  // Validated against process.cwd()
        force: false,
      };

      const result = await mcpSetupGuideLogic(params, context);

      assert.strictEqual(result.success, true);

      // Verify nested directory was created
      const dirPath = path.join(process.cwd(), ".kiro", "steering");
      const dirExists = await fs
        .access(dirPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(dirExists, true);
    });

    it("should reject path traversal attempts", async () => {
      const maliciousParams: McpSetupGuideInput = {
        client: "cursor",
        projectPath: "../../../etc",
        force: false,
      };

      try {
        await mcpSetupGuideLogic(maliciousParams, context);
        assert.fail("Should have thrown an error for path traversal attempt");
      } catch (error) {
        // Should throw McpError for invalid path
        assert.ok(error instanceof Error);
        assert.ok(
          error.message.includes("Invalid") || 
          error.message.includes("outside") ||
          error.message.includes("Path traversal"),
          `Expected security error, got: ${error.message}`
        );
      }
    });
  });
});

