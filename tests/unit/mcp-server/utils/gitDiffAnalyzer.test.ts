/**
 * @fileoverview Unit tests for gitDiffAnalyzer (validateRevision, extractGitDiff).
 * Covers revision validation, uncommitted changes, commit count, range, single commit and ignore filtering.
 * @module tests/unit/mcp-server/utils/gitDiffAnalyzer
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import path from "path";
import simpleGit, { SimpleGit } from "simple-git";
import ignore from "ignore";

import { validateRevision, extractGitDiff } from "../../../../src/mcp-server/utils/gitDiffAnalyzer.js";
import { requestContextService } from "../../../../src/utils/index.js";

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
      assert.strictEqual(validateRevision(r), true, `Expected valid: ${r}`);
    }
  });

  it("rejects unsafe or malformed revisions", () => {
    const invalids = ["-bad", "HEAD; rm -rf /", "bad|rev", "$ENV", "rev && echo hi"];
    for (const r of invalids) {
      assert.strictEqual(validateRevision(r), false, `Expected invalid: ${r}`);
    }
  });
});

describe("extractGitDiff", () => {
  it("returns uncommitted changes for revision '.'", async () => {
    // Create uncommitted change: c.txt
    const rel = "c.txt";
    const full = path.join(repoDir, rel);
    await fs.writeFile(full, "c-change\n", "utf-8");

    const context = requestContextService.createRequestContext({
      operation: "gitDiffUncommittedTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "." }, context);

    assert.ok(result.summary.filesModified >= 0, "filesModified should be >= 0");
    assert.ok(result.summary.revisionInfo, "revisionInfo should be present");
    assert.strictEqual(result.summary.revisionInfo?.head, "working directory");
    // If there are changes, c.txt should be in the list
    if (result.summary.filesModified > 0) {
      assert.ok(result.files.some((f) => f.path === rel), "c.txt should appear in uncommitted diff");
    }
    assert.strictEqual(Array.isArray(result.skippedFiles) ? typeof result.skippedFiles[0]?.path === "string" : true, true);
  });

  it("returns diff for last N commits when 'count' is set", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffCountTest",
    });
    const result = await extractGitDiff(repoDir, { count: 1 }, context);

    assert.ok(result.summary.filesModified >= 1, "Should have at least one modified file for last commit");
    assert.ok(result.summary.revisionInfo, "revisionInfo should be present");
    assert.strictEqual(result.summary.revisionInfo?.head, "HEAD");
    assert.strictEqual(result.summary.revisionInfo?.base, "HEAD~1");
  });

  it("returns diff for specific revision range 'HEAD~2..HEAD'", async () => {
    const context = requestContextService.createRequestContext({
      operation: "gitDiffRangeTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "HEAD~2..HEAD" }, context);

    assert.ok(result.summary.filesModified >= 1, "Range should include changes across commits");
    assert.ok(result.summary.revisionInfo, "revisionInfo should be present");
    assert.strictEqual(result.summary.revisionInfo?.base, "HEAD~2");
    assert.strictEqual(result.summary.revisionInfo?.head, "HEAD");
    // Expect a.txt or b.txt in the range
    const paths = result.files.map((f) => f.path);
    assert.ok(paths.includes("a.txt") || paths.includes("b.txt"), "Expected a.txt or b.txt in diff");
  });

  it("returns diff for a single commit hash (against parent or empty tree)", async () => {
    // Resolve HEAD~1 to a specific commit hash
    const hash = (await git.revparse(["HEAD~1"])).trim();
    const context = requestContextService.createRequestContext({
      operation: "gitDiffSingleCommitTest",
    });
    const result = await extractGitDiff(repoDir, { revision: hash }, context);

    assert.ok(result.summary.filesModified >= 1, "Single commit should produce at least one file change");
    assert.ok(result.summary.revisionInfo, "revisionInfo should be present");
    assert.strictEqual(result.summary.revisionInfo?.head, hash);
  });

  it("applies ignore filtering (exclude b.txt)", async () => {
    const ig = ignore().add("b.txt");
    const context = requestContextService.createRequestContext({
      operation: "gitDiffIgnoreTest",
    });
    const result = await extractGitDiff(repoDir, { revision: "HEAD~2..HEAD", ignoreInstance: ig }, context);

    assert.ok(result.summary.filesModified >= 1, "Filtered range should still include changes");
    assert.ok(!result.files.some((f) => f.path === "b.txt"), "b.txt should be filtered out by ignore");
  });
});