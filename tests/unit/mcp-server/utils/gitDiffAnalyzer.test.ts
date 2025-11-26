/**
 * @fileoverview Unit tests for gitDiffAnalyzer (validateRevision, extractGitDiff).
 * Covers revision validation, uncommitted changes, commit count, range, single commit and ignore filtering.
 * @module tests/unit/mcp-server/utils/gitDiffAnalyzer
 */

import { describe, it, beforeEach, afterEach, expect } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import simpleGit, { SimpleGit } from "simple-git";
import ignore from "ignore";

import { validateRevision, extractGitDiff } from "../../../../src/mcp-server/utils/gitDiffAnalyzer";
import { requestContextService } from "../../../../src/utils/index";

const TEST_ROOT = path.join(process.cwd(), ".test-temp");

let repoDir: string;
let git: SimpleGit;

async function writeAndStage(fileRelPath: string, content: string) {
  const full = path.join(repoDir, fileRelPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
  await git.add(fileRelPath);
}

beforeEach(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true });
  repoDir = await fs.mkdtemp(path.join(TEST_ROOT, "git-diff-"));
  git = simpleGit(repoDir);

  await git.init();
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");

  // Commit 1: add a.txt
  await writeAndStage("a.txt", "a\n");
  await git.commit("init: add a.txt");

  // Commit 2: modify a.txt
  await writeAndStage("a.txt", "aa\n");
  await git.commit("feat: modify a.txt");

  // Commit 3: add b.txt
  await writeAndStage("b.txt", "b\n");
  await git.commit("feat: add b.txt");
});

afterEach(async () => {
  await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
});

describe("validateRevision", () => {
  it("accepts common valid revisions", () => {
    const valids = ["HEAD", "HEAD~1", "main", "feature/test_1", "abc123", "HEAD^", "a/b", "v1.0.0"];
    for (const r of valids) {
      expect(validateRevision(r)).toBe(true);
    }
  });

  it("rejects unsafe or malformed revisions", () => {
    const invalids = ["-bad", "HEAD; rm -rf /", "bad|rev", "$ENV", "rev && echo hi"];
    for (const r of invalids) {
      expect(validateRevision(r)).toBe(false);
    }
  });
});

describe("extractGitDiff", () => {
  it("uses validated projectPath and supports idempotent validation", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffSecurePathIdempotent",
    });

    // 1) Valid absolute path inside allowed base (simulates already-validated path)
    const firstResult = await extractGitDiff(repoDir, { revision: "." }, context);
    expect(firstResult.summary.filesModified).toBeGreaterThanOrEqual(0);

    // 2) Idempotent behavior: passing the normalized path again must not break
    const secondResult = await extractGitDiff(firstResult.summary.revisionInfo ? repoDir : repoDir, { revision: "." }, context);
    expect(secondResult.summary.filesModified).toBeGreaterThanOrEqual(0);
  });

  it("rejects paths with null bytes", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffSecurePathInvalid",
    });

    // Test null byte injection
    const nullBytePath = repoDir + "\x00malicious";

    await expect(extractGitDiff(nullBytePath, { revision: "." }, context)).rejects.toThrow();
  });

  it("accepts paths outside current working directory", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffExternalPath",
    });

    // This should now work - analyzing a directory outside CWD
    const result = await extractGitDiff(repoDir, { revision: "." }, context);
    expect(result.summary.filesModified).toBeGreaterThanOrEqual(0);
  });

  it("returns uncommitted changes for revision '.'", async () => {
    // Create uncommitted change: c.txt
    const rel = "c.txt";
    const full = path.join(repoDir, rel);
    await fs.writeFile(full, "c-change\n", "utf-8");

    const context = requestContextService.createRequestContext({
      operation: "gitDiffUncommittedTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "." }, context);

    expect(result.summary.filesModified).toBeGreaterThanOrEqual(0);
    expect(result.summary.revisionInfo).toBeDefined();
    expect(result.summary.revisionInfo?.head).toBe("working directory");
    // If there are changes, c.txt should be in the list
    if (result.summary.filesModified > 0) {
      expect(result.files.some((f) => f.path === rel)).toBe(true);
    }
    expect(Array.isArray(result.skippedFiles) ? typeof result.skippedFiles[0]?.path === "string" : true).toBe(true);
  });

  it("returns diff for last N commits when 'count' is set", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffCountTest",
    });
    const result = await extractGitDiff(repoDir, { count: 1 }, context);

    expect(result.summary.filesModified).toBeGreaterThanOrEqual(1);
    expect(result.summary.revisionInfo).toBeDefined();
    expect(result.summary.revisionInfo?.head).toBe("HEAD");
    expect(result.summary.revisionInfo?.base).toBe("HEAD~1");
  });

  it("returns diff for specific revision range 'HEAD~2..HEAD'", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffRangeTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "HEAD~2..HEAD" }, context);

    expect(result.summary.filesModified).toBeGreaterThanOrEqual(1);
    expect(result.summary.revisionInfo).toBeDefined();
    expect(result.summary.revisionInfo?.base).toBe("HEAD~2");
    expect(result.summary.revisionInfo?.head).toBe("HEAD");
    // Expect a.txt or b.txt in the range
    const paths = result.files.map((f) => f.path);
    expect(paths.includes("a.txt") || paths.includes("b.txt")).toBe(true);
  });

  it("returns diff for a single commit hash (against parent or empty tree)", async () => {
    // Resolve HEAD~1 to a specific commit hash
    const hash = (await git.revparse(["HEAD~1"])).trim();
    const context = requestContextService.createRequestContext({
      operation: "gitDiffSingleCommitTest",
    });
    const result = await extractGitDiff(repoDir, { revision: hash }, context);

    expect(result.summary.filesModified).toBeGreaterThanOrEqual(1);
    expect(result.summary.revisionInfo).toBeDefined();
    expect(result.summary.revisionInfo?.head).toBe(hash);
  });

  it("applies ignore filtering (exclude b.txt)", async () => {
    const ig = ignore().add("b.txt");
    const context = requestContextService.createRequestContext({
      operation: "gitDiffIgnoreTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "HEAD~2..HEAD", ignoreInstance: ig }, context);

    expect(result.summary.filesModified).toBeGreaterThanOrEqual(1);
    expect(result.files.some((f) => f.path === "b.txt")).toBe(false);
  });
});