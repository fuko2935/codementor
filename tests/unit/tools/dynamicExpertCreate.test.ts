/**
 * @fileoverview Tests for dynamicExpertCreate limits (file count & size).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import {
  dynamicExpertCreateLogic,
  type DynamicExpertCreateInput,
} from "../../../src/mcp-server/tools/dynamicExpertCreate/logic.js";
import { requestContextService } from "../../../src/utils/index.js";
import {
  MCP_CONTENT_END_MARKER,
  MCP_CONTENT_START_MARKER,
} from "../../../src/mcp-server/tools/mcpSetupGuide/logic.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

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
