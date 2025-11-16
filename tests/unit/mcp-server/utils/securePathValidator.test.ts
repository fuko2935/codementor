/**
 * @fileoverview Unit tests for securePathValidator (validateSecurePath).
 * Covers path traversal, existence, directory type, and valid paths.
 * @module tests/unit/mcp-server/utils/securePathValidator
 */

import { describe, it, beforeEach, afterEach } from "@jest/globals";
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
    expect(result).toBe(expected);
  });

  it("treats empty string as baseDir (current behavior)", async () => {
    const result = await validateSecurePath("", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
    expect(result).toBe(expected);
  });

  it("treats whitespace-only path as normalized under baseDir (current behavior)", async () => {
    const result = await validateSecurePath("   ", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
    expect(result).toBe(expected);
  });

  it("allows baseDir itself via '.'", async () => {
    const result = await validateSecurePath(".", baseDir);
    const expected = path.normalize(path.resolve(baseDir));
    expect(result).toBe(expected);
  });

  it("rejects absolute path outside baseDir with VALIDATION_ERROR (sanitization layer)", async () => {
    await expect(() => validateSecurePath(outsideDir, baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath(outsideDir, baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/Path traversal/i)
      });
  });

  it("rejects unix-style absolute path outside baseDir with FORBIDDEN", async () => {
    const unixAbsolute = path.resolve("/etc/passwd");
    // Güvenli davranış: baseDir altında olmadığı için FORBIDDEN beklenir (implementasyondaki final kontrol).
    await expect(() => validateSecurePath(unixAbsolute, baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath(unixAbsolute, baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.FORBIDDEN,
        message: expect.stringMatching(/Path traversal detected/i)
      });
  });

  it("rejects windows-style absolute path outside baseDir with FORBIDDEN (platform-agnostic check)", async () => {
    const winLike = "C:\\windows\\system32";
    await expect(() => validateSecurePath(winLike, baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath(winLike, baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.FORBIDDEN,
        message: expect.stringMatching(/Path traversal detected/i)
      });
  });

  it("rejects relative traversal outside baseDir with VALIDATION_ERROR (sanitization layer)", async () => {
    const rel = "project/../../";
    await expect(() => validateSecurePath(rel, baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath(rel, baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR,
        message: expect.stringMatching(/traversal|escape/i)
      });
  });

  it("rejects '../outside' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "../outside";
    await expect(() => validateSecurePath(rel, baseDir))
      .rejects.toThrow(McpError);
    const error = await (() => validateSecurePath(rel, baseDir))()
      .catch(err => err);
    expect(
      error.code === BaseErrorCode.VALIDATION_ERROR ||
      error.code === BaseErrorCode.FORBIDDEN
    ).toBe(true);
    expect(error.message).toMatch(/traversal|escape/i);
  });

  it("rejects 'subdir/../../escape' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "subdir/../../escape";
    await expect(() => validateSecurePath(rel, baseDir))
      .rejects.toThrow(McpError);
    const error = await (() => validateSecurePath(rel, baseDir))()
      .catch(err => err);
    expect(
      error.code === BaseErrorCode.VALIDATION_ERROR ||
      error.code === BaseErrorCode.FORBIDDEN
    ).toBe(true);
    expect(error.message).toMatch(/traversal|escape/i);
  });

  it("rejects './../escape' traversal escaping baseDir (sanitization / final guard)", async () => {
    const rel = "./../escape";
    await expect(() => validateSecurePath(rel, baseDir))
      .rejects.toThrow(McpError);
    const error = await (() => validateSecurePath(rel, baseDir))()
      .catch(err => err);
    expect(
      error.code === BaseErrorCode.VALIDATION_ERROR ||
      error.code === BaseErrorCode.FORBIDDEN
    ).toBe(true);
    expect(error.message).toMatch(/traversal|escape/i);
  });

  it("rejects non-existent path with INVALID_INPUT", async () => {
    await expect(() => validateSecurePath("missing-folder", baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath("missing-folder", baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.INVALID_INPUT,
        message: expect.stringMatching(/does not exist|inaccessible/i)
      });
  });

  it("rejects file path (not a directory) with INVALID_INPUT", async () => {
    await expect(() => validateSecurePath(path.relative(baseDir, fileInside), baseDir))
      .rejects.toThrow(McpError);
    await expect(() => validateSecurePath(path.relative(baseDir, fileInside), baseDir))
      .rejects.toMatchObject({
        code: BaseErrorCode.INVALID_INPUT,
        message: expect.stringMatching(/not a directory/i)
      });
  });

  it("rejects path containing null byte with INVALID_INPUT or VALIDATION_ERROR", async () => {
    const malicious = "some/path\0evil";
    await expect(() => validateSecurePath(malicious, baseDir))
      .rejects.toThrow(McpError);
    const error = await (() => validateSecurePath(malicious, baseDir))()
      .catch(err => err);
    expect(
      error.code === BaseErrorCode.INVALID_INPUT ||
      error.code === BaseErrorCode.VALIDATION_ERROR
    ).toBe(true);
  });

  it("accepts valid nested relative path under baseDir", async () => {
    const nestedDir = path.join(validDir, "nested");
    await fs.mkdir(nestedDir, { recursive: true });

    const result = await validateSecurePath(path.relative(baseDir, nestedDir), baseDir);
    const expected = path.normalize(path.resolve(nestedDir));
    expect(result).toBe(expected);
    expect(result.startsWith(path.normalize(path.resolve(baseDir)))).toBe(true);
  });

  it("accepts './subdir' style path under baseDir", async () => {
    const subdir = path.join(baseDir, "subdir");
    await fs.mkdir(subdir, { recursive: true });

    const result = await validateSecurePath("./subdir", baseDir);
    const expected = path.normalize(path.resolve(subdir));
    expect(result).toBe(expected);
    expect(result.startsWith(path.normalize(path.resolve(baseDir)))).toBe(true);
  });

  it("accepts absolute path inside baseDir", async () => {
    const abs = path.resolve(validDir);
    const result = await validateSecurePath(abs, baseDir);
    expect(result).toBe(path.normalize(abs));
  });
});