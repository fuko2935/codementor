/**
 * @fileoverview Unit tests for securePathValidator (validateSecurePath).
 * Covers path traversal, existence, directory type, and valid paths.
 * @module tests/unit/mcp-server/utils/securePathValidator
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import { validateSecurePath } from "../../../../src/mcp-server/utils/securePathValidator.js";
import { McpError, BaseErrorCode } from "../../../../src/types-global/errors.js";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");
let baseDir: string;
let validDir: string;
let fileInside: string;
let outsideDir: string;

beforeEach(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true });
  baseDir = await fs.mkdtemp(path.join(TEST_ROOT, "secure-base-"));
  validDir = path.join(baseDir, "project");
  await fs.mkdir(validDir, { recursive: true });
  fileInside = path.join(validDir, "file.txt");
  await fs.writeFile(fileInside, "hello", "utf-8");
  // create an outside directory not under baseDir
  outsideDir = await fs.mkdtemp(path.join(TEST_ROOT, "outside-"));
});

afterEach(async () => {
  // cleanup: remove both baseDir and outsideDir
  await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
});

describe("validateSecurePath", () => {
  it("resolves relative path within baseDir", async () => {
    const p = "./project";
    const result = await validateSecurePath(p, baseDir);
    const expected = path.normalize(path.resolve(baseDir, "project"));
    assert.strictEqual(result, expected);
  });

  it("allows baseDir itself via '.'", async () => {
    const result = await validateSecurePath(".", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
    assert.strictEqual(result, expected);
  });

  it("rejects absolute path outside baseDir with VALIDATION_ERROR (sanitization layer)", async () => {
    await assert.rejects(
      () => validateSecurePath(outsideDir, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.strictEqual((err as McpError).code, BaseErrorCode.VALIDATION_ERROR);
        assert.match((err as Error).message, /Path traversal/i);
        return true;
      }
    );
  });

  it("rejects relative traversal outside baseDir with VALIDATION_ERROR (sanitization layer)", async () => {
    const rel = "project/../../";
    await assert.rejects(
      () => validateSecurePath(rel, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.strictEqual((err as McpError).code, BaseErrorCode.VALIDATION_ERROR);
        assert.match((err as Error).message, /traversal|escape/i);
        return true;
      }
    );
  });

  it("rejects non-existent path with INVALID_INPUT", async () => {
    await assert.rejects(
      () => validateSecurePath("missing-folder", baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.strictEqual((err as McpError).code, BaseErrorCode.INVALID_INPUT);
        assert.match((err as Error).message, /does not exist|inaccessible/i);
        return true;
      }
    );
  });

  it("rejects file path (not a directory) with INVALID_INPUT", async () => {
    await assert.rejects(
      () => validateSecurePath(path.relative(baseDir, fileInside), baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.strictEqual((err as McpError).code, BaseErrorCode.INVALID_INPUT);
        assert.match((err as Error).message, /not a directory/i);
        return true;
      }
    );
  });

  it("accepts absolute path inside baseDir", async () => {
    const abs = path.resolve(validDir);
    const result = await validateSecurePath(abs, baseDir);
    assert.strictEqual(result, path.normalize(abs));
  });
});