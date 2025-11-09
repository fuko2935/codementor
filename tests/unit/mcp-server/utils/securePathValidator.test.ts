/**
 * @fileoverview Unit tests for securePathValidator (validateSecurePath).
 * Covers path traversal, existence, directory type, and valid paths.
 * @module tests/unit/mcp-server/utils/securePathValidator
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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

  it("treats empty string as baseDir (current behavior)", async () => {
    const result = await validateSecurePath("", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
    assert.strictEqual(result, expected);
  });

  it("treats whitespace-only path as normalized under baseDir (current behavior)", async () => {
    const result = await validateSecurePath("   ", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
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

  it("rejects unix-style absolute path outside baseDir with FORBIDDEN", async () => {
    const unixAbsolute = path.resolve("/etc/passwd");
    // Güvenli davranış: baseDir altında olmadığı için FORBIDDEN beklenir (implementasyondaki final kontrol).
    await assert.rejects(
      () => validateSecurePath(unixAbsolute, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.strictEqual((err as McpError).code, BaseErrorCode.FORBIDDEN);
        assert.match((err as Error).message, /Path traversal detected/i);
        return true;
      }
    );
  });

  it("rejects windows-style absolute path outside baseDir with FORBIDDEN (platform-agnostic check)", async () => {
    const winLike = "C:\\windows\\system32";
    await assert.rejects(
      () => validateSecurePath(winLike, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        // sanitizePath + final kontrolün mevcut davranışıyla hizalan:
        // Gerçek kodda kullanılan hata kodlarından birini bekle.
        // Burada güvenlik reddi olarak FORBIDDEN assert ediliyor.
        assert.strictEqual((err as McpError).code, BaseErrorCode.FORBIDDEN);
        assert.match((err as Error).message, /Path traversal detected/i);
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

  it("rejects '../outside' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "../outside";
    await assert.rejects(
      () => validateSecurePath(rel, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        // sanitizePath veya final guard tarafından path traversal olarak algılanmalı.
        assert.ok(
          (err as McpError).code === BaseErrorCode.VALIDATION_ERROR ||
          (err as McpError).code === BaseErrorCode.FORBIDDEN,
          `Unexpected error code for '../outside': ${(err as McpError).code}`,
        );
        assert.match((err as Error).message, /traversal|escape/i);
        return true;
      }
    );
  });

  it("rejects 'subdir/../../escape' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "subdir/../../escape";
    await assert.rejects(
      () => validateSecurePath(rel, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.ok(
          (err as McpError).code === BaseErrorCode.VALIDATION_ERROR ||
          (err as McpError).code === BaseErrorCode.FORBIDDEN,
          `Unexpected error code for 'subdir/../../escape': ${(err as McpError).code}`,
        );
        assert.match((err as Error).message, /traversal|escape/i);
        return true;
      }
    );
  });

  it("rejects './../escape' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "./../escape";
    await assert.rejects(
      () => validateSecurePath(rel, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        assert.ok(
          (err as McpError).code === BaseErrorCode.VALIDATION_ERROR ||
          (err as McpError).code === BaseErrorCode.FORBIDDEN,
          `Unexpected error code for './../escape': ${(err as McpError).code}`,
        );
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

  it("rejects path containing null byte with INVALID_INPUT or VALIDATION_ERROR", async () => {
    const malicious = "some/path\0evil";
    await assert.rejects(
      () => validateSecurePath(malicious, baseDir),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        // sanitizePath/FS katmanının mevcut davranışına göre:
        // null byte içeren girdiler güvenli şekilde reddedilmeli.
        assert.ok(
          (err as McpError).code === BaseErrorCode.INVALID_INPUT ||
          (err as McpError).code === BaseErrorCode.VALIDATION_ERROR,
          `Unexpected error code for null-byte path: ${(err as McpError).code}`,
        );
        return true;
      }
    );
  });

  it("accepts valid nested relative path under baseDir", async () => {
    const nestedDir = path.join(validDir, "nested");
    await fs.mkdir(nestedDir, { recursive: true });

    const result = await validateSecurePath(path.relative(baseDir, nestedDir), baseDir);
    const expected = path.normalize(path.resolve(nestedDir));
    assert.strictEqual(result, expected);
    assert.ok(result.startsWith(path.normalize(path.resolve(baseDir))));
  });

  it("accepts './subdir' style path under baseDir", async () => {
    const subdir = path.join(baseDir, "subdir");
    await fs.mkdir(subdir, { recursive: true });

    const result = await validateSecurePath("./subdir", baseDir);
    const expected = path.normalize(path.resolve(subdir));
    assert.strictEqual(result, expected);
    assert.ok(result.startsWith(path.normalize(path.resolve(baseDir))));
  });

  it("accepts absolute path inside baseDir", async () => {
    const abs = path.resolve(validDir);
    const result = await validateSecurePath(abs, baseDir);
    assert.strictEqual(result, path.normalize(abs));
  });
});