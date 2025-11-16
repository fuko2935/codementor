/**
 * @fileoverview Tests for dynamicExpertCreate limits (file count & size)
 * and authorization behavior for the gemini_dynamic_expert_create tool.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  dynamicExpertCreateLogic,
  type DynamicExpertCreateInput,
} from "../../../src/mcp-server/tools/dynamicExpertCreate/logic.js";
import { registerDynamicExpertCreate } from "../../../src/mcp-server/tools/dynamicExpertCreate/registration.js";
import { requestContextService } from "../../../src/utils/index.js";
import {
  MCP_CONTENT_END_MARKER,
  MCP_CONTENT_START_MARKER,
} from "../../../src/mcp-server/tools/mcpSetupGuide/logic.js";
import {
  McpError,
  BaseErrorCode,
} from "../../../src/types-global/errors.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

class TestMcpServer extends McpServer {
  public registeredTools: Map<
    string,
    {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: any;
      handler: (params: unknown) => Promise<CallToolResult>;
    }
  > = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, description: string, inputSchema: any, handler: any): void {
    this.registeredTools.set(name, {
      description,
      inputSchema,
      handler,
    });
  }
}

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
      const server = new TestMcpServer();
      await registerDynamicExpertCreate(server);

      const tool = server.registeredTools.get("gemini_dynamic_expert_create");
      assert.ok(tool, "gemini_dynamic_expert_create tool should be registered");
      assert.ok(typeof tool.handler === "function", "handler must be a function");

      const result = await callTool(tool.handler);
      assert.ok(result, "Expected a CallToolResult-like response");
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

    await assert.rejects(
      () => dynamicExpertCreateLogic(params, context),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /Project too large: \d+ files found \(maximum 1000 allowed\)/,
        );
        return true;
      },
    );
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

    await assert.rejects(
      () => dynamicExpertCreateLogic(params, context),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /total size exceeds 100MB limit/i);
        return true;
      },
    );
  });
});
