/**
 * @fileoverview Tests for dynamicExpertCreate limits (file count & size)
 * and authorization behavior for the gemini_dynamic_expert_create tool.
 */

import { describe, it, beforeEach, afterEach, expect, jest } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  dynamicExpertCreateLogic,
  type DynamicExpertCreateInput,
} from "../../../src/mcp-server/tools/dynamicExpertCreate/logic.js";
import { registerDynamicExpertCreate } from "../../../src/mcp-server/tools/dynamicExpertCreate/registration.js";
import { requestContextService } from "../../../src/utils/index.js";
import {
  MCP_CODEMENTOR_END_MARKER as MCP_CONTENT_END_MARKER,
  MCP_CODEMENTOR_START_MARKER as MCP_CONTENT_START_MARKER,
} from "../../../src/mcp-server/utils/mcpConfigValidator.js";
import {
  McpError,
  BaseErrorCode,
} from "../../../src/types-global/errors.js";
import { TestMcpServer } from "../testUtils/testMcpServer.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

// Helper to invoke the registered tool handler with standard params.
 
async function callTool(
  handler: (params: any) => Promise<CallToolResult>,
) {
  const params: DynamicExpertCreateInput = {
    projectPath: ".",
    expertiseHint: "Test expert",
    ignoreMcpignore: false,
    temporaryIgnore: [],
  };
  return handler(params);
}

async function createSequentialFiles(
  directory: string,
  count: number,
  content: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const filePath = path.join(directory, `file-${i}.ts`);
    await fs.writeFile(filePath, content, "utf-8");
  }
}

async function createLargeFile(
  filePath: string,
  sizeInMB: number,
): Promise<void> {
  const handle = await fs.open(filePath, "w");
  const chunk = Buffer.alloc(1024 * 1024, "a");
  try {
    for (let i = 0; i < sizeInMB; i++) {
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
}

async function seedMcpGuide(directory: string): Promise<void> {
  const filePath = path.join(directory, "AGENTS.md");
  const content = `${MCP_CONTENT_START_MARKER}\nTest guide\n${MCP_CONTENT_END_MARKER}`;
  await fs.writeFile(filePath, content, "utf-8");
}

describe("dynamicExpertCreateLogic limits", () => {
  let testDir: string;
  let context: ReturnType<typeof requestContextService.createRequestContext>;

  beforeEach(async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
    testDir = await fs.mkdtemp(path.join(TEST_ROOT, "dynamic-create-"));
    await seedMcpGuide(testDir);
    context = requestContextService.createRequestContext({
      operation: "dynamicExpertCreateTest",
    });
  });
  
  describe("gemini_dynamic_expert_create registration (no built-in auth)", () => {
    it("registers the tool with a callable handler", async () => {
      const testServer = new TestMcpServer();
      await registerDynamicExpertCreate(testServer.server);

      const tools = testServer.getTools();
      const tool = tools.get("gemini_dynamic_expert_create");
      expect(tool).toBeDefined();
      
      if (tool) {
        expect(typeof tool.handler).toBe("function");
        const result = await callTool(tool.handler);
        expect(result).toBeDefined();
      }
    });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("throws when file count exceeds MAX_FILE_COUNT", async () => {
    await createSequentialFiles(testDir, 1001, "export const value = 1;");

    const params: DynamicExpertCreateInput = {
      projectPath: testDir,
      expertiseHint: "Test expert",
      ignoreMcpignore: false,
      temporaryIgnore: ["AGENTS.md"],
    };

    await expect(
      dynamicExpertCreateLogic(params, context)
    ).rejects.toThrow(/Project too large: \d+ files found \(maximum 1000 allowed\)/);
  });

  it("throws when total project size exceeds MAX_TOTAL_SIZE", async () => {
    const largeFilePath = path.join(testDir, "huge-file.ts");
    await createLargeFile(largeFilePath, 101); // Write 101MB to exceed 100MB cap

    const params: DynamicExpertCreateInput = {
      projectPath: testDir,
      expertiseHint: "Large project",
      ignoreMcpignore: false,
      temporaryIgnore: ["AGENTS.md"],
    };

    await expect(
      dynamicExpertCreateLogic(params, context)
    ).rejects.toThrow(/total size exceeds 100MB limit/i);
  });

  // Integration tests - require real LLM API calls
  // Skip in CI/CD or when SKIP_INTEGRATION_TESTS=true
  describe.skip("dynamicExpertCreateLogic behavior (integration tests)", () => {
    it("creates expert prompt with projectPath provided", async () => {
      const params: DynamicExpertCreateInput = {
        projectPath: testDir,
        expertiseHint: "React performance optimization",
        ignoreMcpignore: false,
        temporaryIgnore: [],
      };

      const result = await dynamicExpertCreateLogic(params, context);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }, 30000);

    it("creates expert prompt without projectPath (hint only)", async () => {
      const params: DynamicExpertCreateInput = {
        expertiseHint: "Security vulnerability analysis",
        ignoreMcpignore: false,
        temporaryIgnore: [],
      };

      const result = await dynamicExpertCreateLogic(params, context);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }, 30000);

    it("throws VALIDATION_ERROR when projectPath is invalid", async () => {
      const params: DynamicExpertCreateInput = {
        projectPath: "/nonexistent/path",
        expertiseHint: "Test expert",
        ignoreMcpignore: false,
        temporaryIgnore: [],
      };

      await expect(
        dynamicExpertCreateLogic(params, context)
      ).rejects.toThrow(McpError);
    });
  });
});
