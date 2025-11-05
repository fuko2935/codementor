/**
 * @fileoverview Provides Git diff extraction and analysis utilities.
 * This module handles extracting diffs from Git repositories with security validation.
 * @module src/mcp-server/utils/gitDiffAnalyzer
 */

import simpleGit, { SimpleGit, DiffResult, DiffResultTextFile, DiffResultBinaryFile } from "simple-git";
import { logger, type RequestContext } from "../../utils/index.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

/**
 * Type guard to check if a diff file is a text file (has insertions/deletions).
 * 
 * @param file - The diff result file to check
 * @returns True if the file is a text file with insertions/deletions data
 */
function isTextFile(
  file: DiffResultTextFile | DiffResultBinaryFile,
): file is DiffResultTextFile {
  return "insertions" in file && "deletions" in file;
}

/**
 * Interface for the diff result structure returned to the AI.
 */
export interface DiffResultData {
  summary: {
    filesModified: number;
    insertions: number;
    deletions: number;
    revisionInfo?: {
      base: string;
      head: string;
    };
  };
  files: Array<{
    path: string;
    status: "added" | "deleted" | "modified";
    insertions: number;
    deletions: number;
    diff: string;
  }>;
}

/**
 * Parameters for extracting git diff.
 */
export interface ExtractGitDiffParams {
  revision?: string;
  count?: number;
}

/**
 * Validates a revision string to prevent command injection risks.
 * Allows common Git revision characters while disallowing shell metacharacters.
 * 
 * This is a defense-in-depth measure: the `simple-git` library already mitigates
 * injection attacks by not executing commands in a shell, but this function provides
 * an additional validation layer against malicious or malformed revision strings.
 *
 * @param revision - The revision string to validate
 * @returns True if valid, false otherwise
 */
export function validateRevision(revision: string): boolean {
  // Disallows leading hyphens and shell metacharacters (;, &, |, $, etc.)
  // Allows: alphanumeric, ~, ^, ., /, -, _, and .. (for ranges)
  const validRevisionRegex = /^(?![-])[a-zA-Z0-9\~\^\.\/\-\_]+$/;
  return validRevisionRegex.test(revision);
}

/**
 * Extracts the diff for a single file from the full diff text.
 *
 * @param fullDiff - The complete diff output from git
 * @param filePath - The path of the file to extract
 * @returns The diff block for the specific file, or empty string if not found
 */
function extractFileDiff(fullDiff: string, filePath: string): string {
  // Find the diff block that starts with this file
  const filePattern = new RegExp(
    `diff --git a/${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} b/${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=diff --git|$)`,
  );
  const match = fullDiff.match(filePattern);
  return match ? match[0].trim() : "";
}

/**
 * Extracts git diff information from a repository.
 *
 * @param projectPath - The validated path to the git repository
 * @param params - Parameters specifying which changes to extract
 * @param context - Request context for logging
 * @returns Structured diff data in JSON format for AI consumption
 * @throws {McpError} If git operations fail or invalid parameters are provided
 */
export async function extractGitDiff(
  projectPath: string,
  params: ExtractGitDiffParams,
  context: RequestContext,
): Promise<DiffResultData> {
  const git: SimpleGit = simpleGit(projectPath);

  try {
    let diffSummary: DiffResult["files"];
    let diffText: string;
    let revisionInfo: { base: string; head: string } | undefined;

    // Handle uncommitted changes (revision === ".")
    if (params.revision === ".") {
      logger.debug("Extracting uncommitted changes", {
        ...context,
        projectPath,
      });

      const diffSummaryResult = await git.diffSummary();
      const diffTextResult = await git.diff();

      diffSummary = diffSummaryResult.files;
      diffText = diffTextResult;

      // Get current branch for context
      const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD");
      revisionInfo = {
        base: currentBranch,
        head: "working directory",
      };
    }
    // Handle commit count (last N commits)
    else if (params.count !== undefined && params.count > 0) {
      if (!validateRevision(String(params.count))) {
        throw new McpError(
          BaseErrorCode.INVALID_INPUT,
          `Invalid count parameter: ${params.count}`,
        );
      }

      logger.debug("Extracting last N commits", {
        ...context,
        projectPath,
        count: params.count,
      });

      const baseRevision = `HEAD~${params.count}`;
      const headRevision = "HEAD";

      if (!validateRevision(baseRevision) || !validateRevision(headRevision)) {
        throw new McpError(
          BaseErrorCode.INVALID_INPUT,
          "Invalid revision format for commit count",
        );
      }

      const diffSummaryResult = await git.diffSummary([baseRevision, headRevision]);
      const diffTextResult = await git.diff([baseRevision, headRevision]);

      diffSummary = diffSummaryResult.files;
      diffText = diffTextResult;
      revisionInfo = {
        base: baseRevision,
        head: headRevision,
      };
    }
    // Handle specific revision (commit hash, range, etc.)
    else if (params.revision) {
      if (!validateRevision(params.revision)) {
        throw new McpError(
          BaseErrorCode.INVALID_INPUT,
          `Invalid characters in revision string: ${params.revision}. ` +
            `Revision must contain only alphanumeric characters and git revision symbols (~, ^, ., /, -, _).`,
        );
      }

      logger.debug("Extracting diff for specific revision", {
        ...context,
        projectPath,
        revision: params.revision,
      });

      // Check if it's a range (contains "..")
      if (params.revision.includes("..")) {
        const [base, head] = params.revision.split("..");
        if (!validateRevision(base) || !validateRevision(head)) {
          throw new McpError(
            BaseErrorCode.INVALID_INPUT,
            "Invalid revision range format",
          );
        }

        const diffSummaryResult = await git.diffSummary([base, head]);
        const diffTextResult = await git.diff([base, head]);

        diffSummary = diffSummaryResult.files;
        diffText = diffTextResult;
        revisionInfo = {
          base: base.trim(),
          head: head.trim(),
        };
      } else {
        // Single commit - compare with parent (or empty tree for initial commit)
        const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // Git's magic empty tree hash
        let baseRevision = `${params.revision}^1`;

        try {
          // Try diffing against the parent first
          const diffSummaryResult = await git.diffSummary([baseRevision, params.revision]);
          const diffTextResult = await git.diff([baseRevision, params.revision]);

          diffSummary = diffSummaryResult.files;
          diffText = diffTextResult;
        } catch (error) {
          // If it fails, it's likely the initial commit. Fallback to empty tree.
          logger.debug(
            `Diff against parent for ${params.revision} failed, trying against empty tree.`,
            {
              ...context,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          baseRevision = EMPTY_TREE_HASH;
          const diffSummaryResult = await git.diffSummary([baseRevision, params.revision]);
          const diffTextResult = await git.diff([baseRevision, params.revision]);

          diffSummary = diffSummaryResult.files;
          diffText = diffTextResult;
        }

        revisionInfo = {
          base: baseRevision,
          head: params.revision,
        };
      }
    } else {
      // Default to uncommitted changes if nothing specified
      logger.debug("Extracting uncommitted changes (default)", {
        ...context,
        projectPath,
      });

      const diffSummaryResult = await git.diffSummary();
      const diffTextResult = await git.diff();

      diffSummary = diffSummaryResult.files;
      diffText = diffTextResult;

      const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD");
      revisionInfo = {
        base: currentBranch,
        head: "working directory",
      };
    }

    // Process files and extract individual diffs
    const files = diffSummary
      .filter((file) => !file.binary) // Only process text files
      .filter(isTextFile) // Type guard to ensure we have text file data
      .map((file) => {
        const fileDiff = extractFileDiff(diffText, file.file);

        // Now TypeScript knows file has insertions/deletions
        const insertions = file.insertions;
        const deletions = file.deletions;

        // Determine file status
        let status: "added" | "deleted" | "modified";
        if (insertions > 0 && deletions === 0) {
          status = "added";
        } else if (deletions > 0 && insertions === 0) {
          status = "deleted";
        } else {
          status = "modified";
        }

        return {
          path: file.file,
          status,
          insertions,
          deletions,
          diff: fileDiff,
        };
      });

    // Calculate totals (only for text files)
    const totalInsertions = files.reduce((sum, file) => sum + file.insertions, 0);
    const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

    logger.info("Git diff extracted successfully", {
      ...context,
      projectPath,
      filesModified: files.length,
      totalInsertions,
      totalDeletions,
    });

    return {
      summary: {
        filesModified: files.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
        revisionInfo,
      },
      files,
    };
  } catch (error) {
    logger.error("Failed to extract git diff", {
      ...context,
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });

    // Re-throw McpError as-is
    if (error instanceof McpError) {
      throw error;
    }

    // Wrap other errors
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to extract git diff: ${error instanceof Error ? error.message : "Unknown git error"}`,
      {
        originalError: error,
      },
    );
  }
}

