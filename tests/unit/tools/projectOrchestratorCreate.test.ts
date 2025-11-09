/**
 * @fileoverview Tests for projectOrchestratorCreate batching behavior.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import {
  projectOrchestratorCreateLogic,
  type ProjectOrchestratorCreateInput,
} from "../../../src/mcp-server/tools/projectOrchestratorCreate/logic.js";
import { requestContextService } from "../../../src/utils/index.js";
import type { FileMetadata } from "../../../src/mcp-server/utils/codeParser.js";
import type { ProjectGroup } from "../../../src/mcp-server/services/aiGroupingService.js";
import {
  MCP_CONTENT_END_MARKER,
  MCP_CONTENT_START_MARKER,
} from "../../../src/mcp-server/tools/mcpSetupGuide/logic.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

async function createTypeScriptFiles(
  directory: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const filePath = path.join(directory, `file-${i}.ts`);
    await fs.writeFile(
      filePath,
      `export const value${i} = ${i};\nexport function fn${i}() { return value${i}; }`,
      "utf-8",
    );
  }
}

async function seedMcpGuide(directory: string): Promise<void> {
  const filePath = path.join(directory, "AGENTS.md");
  const content = `${MCP_CONTENT_START_MARKER}\nTest guide\n${MCP_CONTENT_END_MARKER}`;
  await fs.writeFile(filePath, content, "utf-8");
}

describe("projectOrchestratorCreateLogic batching", () => {
  let testDir: string;
  let context: ReturnType<typeof requestContextService.createRequestContext>;
  let metadataCalls: string[];
  let groupingCalls: FileMetadata[][];

  beforeEach(async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
    testDir = await fs.mkdtemp(path.join(TEST_ROOT, "orchestrator-create-"));
    await seedMcpGuide(testDir);
    context = requestContextService.createRequestContext({
      operation: "projectOrchestratorCreateTest",
    });
    metadataCalls = [];
    groupingCalls = [];
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("processes more than one batch without losing files", async () => {
    const fileCount = 60; // > BATCH_SIZE (50)
    await createTypeScriptFiles(testDir, fileCount);

    const extractMetadataStub = async (
      filePath: string,
      content: string,
    ): Promise<FileMetadata> => {
      metadataCalls.push(filePath);
      return {
        filePath,
        language: "typescript",
        classes: [],
        functions: [],
        imports: [],
        exports: [],
        estimatedTokens: content.length,
      };
    };

    const groupFilesWithAiStub = async (
      metadata: FileMetadata[],
      _maxTokensPerGroup: number,
      _context: ReturnType<typeof requestContextService.createRequestContext>,
      _geminiApiKey?: string,
      _question?: string,
    ): Promise<ProjectGroup[]> => {
      groupingCalls.push(metadata);
      return [
        {
          groupIndex: 0,
          name: "All Files",
          description: "Contains every file (test stub).",
          totalTokens: metadata.reduce((sum, m) => sum + m.estimatedTokens, 0),
          files: metadata.map((m) => m.filePath),
          metadata,
        },
      ];
    };

    const params: ProjectOrchestratorCreateInput = {
      projectPath: testDir,
      question: "How is batching handled?",
      ignoreMcpignore: false,
      analysisMode: "general",
      temporaryIgnore: ["AGENTS.md"],
    };

    const result = await projectOrchestratorCreateLogic(params, context, {
      extractMetadata: extractMetadataStub,
      groupFilesWithAI: groupFilesWithAiStub,
    });

    const parsed = JSON.parse(result.groupsData);

    assert.strictEqual(parsed.totalFiles, fileCount);
    assert.strictEqual(parsed.groups.length, 1);
    assert.strictEqual(parsed.groups[0].files.length, fileCount);
    assert.strictEqual(parsed.groups[0].metadata.length, fileCount);

    assert.strictEqual(metadataCalls.length, fileCount);
    assert.strictEqual(groupingCalls.length, 1);
    assert.strictEqual(groupingCalls[0].length, fileCount);
  });

describe("projectOrchestratorCreate security (scope enforcement)", () => {
  it("throws INTERNAL_ERROR when auth context is missing", () => {
    // withRequiredScopes will throw INTERNAL_ERROR when auth context/store is missing.
    const { withRequiredScopes } = require("../../../src/mcp-server/transports/auth/core/authUtils.js");
    try {
      withRequiredScopes(["orchestration:write"]);
      assert.fail("Expected withRequiredScopes to throw due to missing auth context");
    } catch (error: any) {
      assert.strictEqual(error?.code, "INTERNAL_ERROR");
    }
  });

  it("throws FORBIDDEN when required orchestration:write scope is missing", () => {
    const { authContext } = require("../../../src/mcp-server/transports/auth/core/authContext.js");
    const { withRequiredScopes } = require("../../../src/mcp-server/transports/auth/core/authUtils.js");
    const { McpError, BaseErrorCode } = require("../../../src/types-global/errors.js");

    const store = {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["orchestration:read"], // missing orchestration:write
      },
    };

    authContext.run(store, () => {
      try {
        withRequiredScopes(["orchestration:write"]);
        assert.fail("Expected withRequiredScopes to throw FORBIDDEN when scope is missing");
      } catch (error: any) {
        assert.ok(error instanceof McpError);
        assert.strictEqual(error.code, BaseErrorCode.FORBIDDEN);
      }
    });
  });

  it("allows execution when orchestration:write scope is present", () => {
    const { authContext } = require("../../../src/mcp-server/transports/auth/core/authContext.js");
    const { withRequiredScopes } = require("../../../src/mcp-server/transports/auth/core/authUtils.js");
    const { McpError } = require("../../../src/types-global/errors.js");

    const store = {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes: ["orchestration:write"],
      },
    };

    authContext.run(store, () => {
      try {
        withRequiredScopes(["orchestration:write"]);
      } catch (error: any) {
        assert.fail(`Did not expect withRequiredScopes to throw, but got: ${error?.message}`);
      }
    });
  });
});
});
