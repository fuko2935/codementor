/**
 * @fileoverview Provides Git diff extraction and analysis utilities.
 * This module handles extracting diffs from Git repositories with security validation.
 * @module src/mcp-server/utils/gitDiffAnalyzer
 */

import simpleGit, { SimpleGit, DiffResult, DiffResultTextFile, DiffResultBinaryFile } from "simple-git";
import ignore from "ignore";
import { promises as fs } from "fs";
import path from "path";
import { logger, type RequestContext } from "../../utils/index.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { config } from "../../config/index.js";
import { BASE_DIR } from "../../index.js";
import { validateSecurePath } from "./securePathValidator.js";

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
 * Gets the size of a file in a Git revision without loading its content into memory.
 * For uncommitted files (revision === 'index'), uses filesystem stats.
 * For committed files, uses `git cat-file -s` to get blob size efficiently.
 *
 * @param git - SimpleGit instance
 * @param revision - Git revision (commit hash, branch name, or 'index' for uncommitted)
 * @param filePath - Path to the file relative to repository root
 * @returns File size in bytes, or 0 if file doesn't exist in that revision
 */
async function getGitBlobSize(
  git: SimpleGit,
  revision: string,
  filePath: string,
): Promise<number> {
  try {
    // For uncommitted files (working directory or index)
    if (revision === 'index') {
      const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
      const fullPath = path.join(repoRoot, filePath);
      const stats = await fs.stat(fullPath);
      return stats.size;
    }
    
    // For committed files, use `git cat-file -s` to get size without loading content
    // Format: <revision>:<path>
    const sizeString = await git.raw(['cat-file', '-s', `${revision}:${filePath}`]);
    const size = parseInt(sizeString.trim(), 10);
    return isNaN(size) ? 0 : size;
  } catch (_error) {
    // File doesn't exist in that revision (e.g., was added/deleted)
    // Return 0 to indicate file not found
    return 0;
  }
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
  skippedFiles?: Array<{
    path: string;
    size: number;
    reason: string;
  }>;
}

/**
 * Parameters for extracting git diff.
 */
export interface ExtractGitDiffParams {
  revision?: string;
  count?: number;
  /** Optional ignore instance to filter out certain files (e.g., node_modules, dist) */
  ignoreInstance?: ReturnType<typeof ignore>;
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
  const validRevisionRegex = /^(?![-])[a-zA-Z0-9~^./\-_]+$/;
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
  // Split the diff into sections by 'diff --git' headers
  const sections = fullDiff.split(/(?=^diff --git )/m);
  
  // Find the section that matches our file path
  for (const section of sections) {
    if (section.trim().length === 0) continue;
    
    // Look for the git header line: "diff --git a/file b/file"
    const gitHeaderMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (gitHeaderMatch) {
      const [, fileA, fileB] = gitHeaderMatch;
      
      // Check if either file path matches (for renames, fileA and fileB might differ)
      if (fileA === filePath || fileB === filePath) {
        return section.trim();
      }
    }
  }
  
  // Handle edge case: binary files or empty diffs
  return "";
}

/**
 * Gets diff summary with actual insertion/deletion counts for filtered files.
 * This is memory-safe because it only processes the already-filtered file list.
 *
 * @param git - SimpleGit instance
 * @param baseRevision - Base revision (can be undefined for uncommitted)
 * @param headRevision - Head revision (can be undefined for uncommitted)
 * @param filesToDiff - Array of filtered file paths
 * @param context - Request context for logging
 * @returns DiffResult files array with actual insertion/deletion counts
 */
async function getDiffSummaryForFiles(
  git: SimpleGit,
  baseRevision: string | undefined,
  headRevision: string | undefined,
  filesToDiff: string[],
  context: RequestContext,
): Promise<DiffResult["files"]> {
  if (filesToDiff.length === 0) {
    return [];
  }

  try {
    // Build git diff command arguments
    const diffArgs: string[] = [];
    if (baseRevision && headRevision) {
      diffArgs.push(baseRevision, headRevision);
    }
    diffArgs.push('--', ...filesToDiff);

    // Get summary with actual stats (memory-safe since files are already filtered)
    const summaryResult = await git.diffSummary(diffArgs);
    return summaryResult.files;
  } catch (error) {
    logger.warning("Failed to get diff summary, falling back to zero counts", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback to zero counts if summary fails
    return filesToDiff.map((file) => ({
      file,
      changes: 0,
      insertions: 0,
      deletions: 0,
      binary: false,
    }));
  }
}

/**
 * Private helper function to get filtered diff with common logic.
 * Consolidates the duplicated file filtering and diff extraction logic.
 *
 * @param git - SimpleGit instance
 * @param diffArgs - Arguments for git diff command (e.g., ['HEAD~1', 'HEAD'] or [] for uncommitted)
 * @param headRevisionForSizeCheck - Revision to use for size checking (e.g., 'HEAD', 'index')
 * @param ignoreInstance - Optional ignore instance to filter out certain files
 * @param maxBlobSize - Maximum blob size in bytes
 * @param context - Request context for logging
 * @param logContext - Context string for logging (e.g., "uncommitted", "last N commits")
 * @returns Object containing diff text, summary, and skipped files
 */
async function _getFilteredDiff(
  git: SimpleGit,
  diffArgs: string[],
  headRevisionForSizeCheck: string,
  ignoreInstance: ReturnType<typeof ignore> | undefined,
  maxBlobSize: number,
  context: RequestContext,
  logContext: string,
): Promise<{ diffText: string, diffSummary: DiffResult["files"], skippedFilesForSize: Array<{ path: string; size: number; reason: string }> }> {
  // Get file names first (needed for both ignore and size filtering)
  logger.info(`🔍 Getting changed files list (${logContext}, name-only)...`, context);
  const nameOnlyArgs = ['diff', '--name-only', ...diffArgs];
  const nameOnlyResult = await git.raw(nameOnlyArgs);
  const allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
  
  // Filter using ignore patterns if provided
  let filesToDiff: string[];
  if (ignoreInstance) {
    filesToDiff = allChangedFiles.filter((file) => !ignoreInstance.ignores(file));
    logger.info(`🔍 Files after ignore filtering: ${filesToDiff.length}/${allChangedFiles.length} (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
  } else {
    filesToDiff = allChangedFiles;
  }

  // Filter by file size before running git diff
  const skippedFilesForSize: Array<{ path: string; size: number; reason: string }> = [];
  const safeFilesToDiff: string[] = [];
  for (const file of filesToDiff) {
    const size = await getGitBlobSize(git, headRevisionForSizeCheck, file);
    if (size > maxBlobSize) {
      skippedFilesForSize.push({
        path: file,
        size,
        reason: `File size (${size} bytes) exceeds the configured limit of ${maxBlobSize} bytes.`
      });
      logger.warning(`Skipping large file in diff analysis: ${file}`, {
        ...context,
        fileSize: size,
        limit: maxBlobSize
      });
    } else {
      safeFilesToDiff.push(file);
    }
  }

  let diffText: string;
  let diffSummary: DiffResult["files"];

  // Get diff text only for safe files (within size limit)
  if (safeFilesToDiff.length > 0) {
    logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} files, ${skippedFilesForSize.length} skipped due to size)`, context);
    
    // Batch processing to avoid E2BIG (argument list too long) error
    const BATCH_SIZE = 100;
    const diffTextBatches: string[] = [];
    
    if (safeFilesToDiff.length > BATCH_SIZE) {
      logger.info(`📦 Processing ${safeFilesToDiff.length} files in batches of ${BATCH_SIZE}`, context);
    }
    
    for (let i = 0; i < safeFilesToDiff.length; i += BATCH_SIZE) {
      const batch = safeFilesToDiff.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(safeFilesToDiff.length / BATCH_SIZE);
      
      if (totalBatches > 1) {
        logger.debug(`Processing batch ${batchNum}/${totalBatches} (${batch.length} files)`, context);
      }
      
      const diffTextArgs = [...diffArgs, '--', ...batch];
      const batchDiff = await git.diff(diffTextArgs);
      diffTextBatches.push(batchDiff);
    }
    
    diffText = diffTextBatches.join('\n');
    logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
    
    // Get actual insertion/deletion counts for filtered files
    // Extract base and head revisions from diffArgs for getDiffSummaryForFiles
    const baseRevision = diffArgs.length >= 2 ? diffArgs[0] : undefined;
    const headRevision = diffArgs.length >= 2 ? diffArgs[1] : undefined;
    diffSummary = await getDiffSummaryForFiles(git, baseRevision, headRevision, safeFilesToDiff, context);
  } else {
    logger.info(`📭 No files to diff after filtering`, context);
    diffText = "";
    diffSummary = [];
  }

  return { diffText, diffSummary, skippedFilesForSize };
}

/**
 * Helper function to extract uncommitted changes from git.
 *
 * @param git - SimpleGit instance
 * @param ignoreInstance - Optional ignore instance to filter out certain files
 * @param maxBlobSize - Maximum blob size in bytes
 * @param context - Request context for logging
 * @returns Object containing diff text, summary, revision info, and skipped files
 */
async function extractUncommittedChanges(
  git: SimpleGit,
  ignoreInstance: ReturnType<typeof ignore> | undefined,
  maxBlobSize: number,
  context: RequestContext,
): Promise<{ diffText: string, diffSummary: DiffResult["files"], revisionInfo: { base: string; head: string }, skippedFilesForSize: Array<{ path: string; size: number; reason: string }> }> {
  logger.debug("Extracting uncommitted changes", context);

  const { diffText, diffSummary, skippedFilesForSize } = await _getFilteredDiff(
    git,
    [], // No revision args for uncommitted changes
    'index', // Use 'index' for size check
    ignoreInstance,
    maxBlobSize,
    context,
    'uncommitted'
  );

  // Get current branch for context
  const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim();
  const revisionInfo = {
    base: currentBranch,
    head: "working directory",
  };

  return { diffText, diffSummary, revisionInfo, skippedFilesForSize };
}

/**
 * Helper function to extract changes for the last N commits.
 *
 * @param git - SimpleGit instance
 * @param count - Number of commits to analyze
 * @param ignoreInstance - Optional ignore instance to filter out certain files
 * @param maxBlobSize - Maximum blob size in bytes
 * @param context - Request context for logging
 * @returns Object containing diff text, summary, revision info, and skipped files
 */
async function extractCommitCountChanges(
  git: SimpleGit,
  count: number,
  ignoreInstance: ReturnType<typeof ignore> | undefined,
  maxBlobSize: number,
  context: RequestContext,
): Promise<{ diffText: string, diffSummary: DiffResult["files"], revisionInfo: { base: string; head: string }, skippedFilesForSize: Array<{ path: string; size: number; reason: string }> }> {
  if (!validateRevision(String(count))) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Invalid count parameter: ${count}`,
    );
  }

  logger.debug("Extracting last N commits", {
    ...context,
    count,
  });

  const baseRevision = `HEAD~${count}`;
  const headRevision = "HEAD";

  if (!validateRevision(baseRevision) || !validateRevision(headRevision)) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "Invalid revision format for commit count",
    );
  }

  const { diffText, diffSummary, skippedFilesForSize } = await _getFilteredDiff(
    git,
    [baseRevision, headRevision],
    headRevision, // Use head for size check
    ignoreInstance,
    maxBlobSize,
    context,
    `last ${count} commits`
  );

  const revisionInfo = {
    base: baseRevision,
    head: headRevision,
  };

  return { diffText, diffSummary, revisionInfo, skippedFilesForSize };
}

/**
 * Helper function to extract changes for a specific revision or range.
 *
 * @param git - SimpleGit instance
 * @param revision - Git revision string (commit hash, range, etc.)
 * @param ignoreInstance - Optional ignore instance to filter out certain files
 * @param maxBlobSize - Maximum blob size in bytes
 * @param context - Request context for logging
 * @returns Object containing diff text, summary, revision info, and skipped files
 */
async function extractRevisionChanges(
  git: SimpleGit,
  revision: string,
  ignoreInstance: ReturnType<typeof ignore> | undefined,
  maxBlobSize: number,
  context: RequestContext,
): Promise<{ diffText: string, diffSummary: DiffResult["files"], revisionInfo: { base: string; head: string }, skippedFilesForSize: Array<{ path: string; size: number; reason: string }> }> {
  if (!validateRevision(revision)) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Invalid characters in revision string: ${revision}. ` +
        `Revision must contain only alphanumeric characters and git revision symbols (~, ^, ., /, -, _).`,
    );
  }

  logger.debug("Extracting diff for specific revision", {
    ...context,
    revision,
  });

  // Check if it's a range (contains "..")
  if (revision.includes("..")) {
    const [base, head] = revision.split("..");
    if (!validateRevision(base) || !validateRevision(head)) {
      throw new McpError(
        BaseErrorCode.INVALID_INPUT,
        "Invalid revision range format",
      );
    }

    const { diffText, diffSummary, skippedFilesForSize } = await _getFilteredDiff(
      git,
      [base, head],
      head, // Use head for size check
      ignoreInstance,
      maxBlobSize,
      context,
      `range ${base}..${head}`
    );

    const revisionInfo = {
      base: base.trim(),
      head: head.trim(),
    };

    return { diffText, diffSummary, revisionInfo, skippedFilesForSize };
  } else {
    // Single commit - compare with parent (or empty tree for initial commit)
    const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // Git's magic empty tree hash
    let baseRevision = `${revision}^1`;

    try {
      // Try diffing against the parent first
      const { diffText, diffSummary, skippedFilesForSize } = await _getFilteredDiff(
        git,
        [baseRevision, revision],
        revision, // Use commit revision for size check
        ignoreInstance,
        maxBlobSize,
        context,
        `commit ${revision}`
      );

      const revisionInfo = {
        base: baseRevision,
        head: revision,
      };

      return { diffText, diffSummary, revisionInfo, skippedFilesForSize };
    } catch (error) {
      // If it fails, it's likely the initial commit. Fallback to empty tree.
      logger.debug(
        `Diff against parent for ${revision} failed, trying against empty tree.`,
        {
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      baseRevision = EMPTY_TREE_HASH;
      
      const { diffText, diffSummary, skippedFilesForSize } = await _getFilteredDiff(
        git,
        [baseRevision, revision],
        revision, // Use commit revision for size check
        ignoreInstance,
        maxBlobSize,
        context,
        `first commit ${revision}`
      );

      const revisionInfo = {
        base: baseRevision,
        head: revision,
      };

      return { diffText, diffSummary, revisionInfo, skippedFilesForSize };
    }
  }
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
  // Enforce secure, idempotent project path validation before any git operations.
  // - Uses BASE_DIR as the trusted repository root anchor.
  // - Safe for double invocation: validateSecurePath is idempotent and returns a normalized path.
  const validatedProjectPath = await validateSecurePath(projectPath, BASE_DIR, context);
  const git: SimpleGit = simpleGit(validatedProjectPath);

  try {
    const maxBlobSize = config.maxGitBlobSizeBytes;

    let resultData: { diffText: string, diffSummary: DiffResult["files"], revisionInfo: { base: string; head: string }, skippedFilesForSize: Array<{ path: string; size: number; reason: string }> };

    // Handle uncommitted changes (revision === ".")
    if (params.revision === ".") {
      resultData = await extractUncommittedChanges(git, params.ignoreInstance, maxBlobSize, {
        ...context,
        projectPath,
      });
    }
    // Handle commit count (last N commits)
    else if (params.count !== undefined && params.count > 0) {
      resultData = await extractCommitCountChanges(git, params.count, params.ignoreInstance, maxBlobSize, {
        ...context,
        projectPath,
      });
    }
    // Handle specific revision (commit hash, range, etc.)
    else if (params.revision) {
      resultData = await extractRevisionChanges(git, params.revision, params.ignoreInstance, maxBlobSize, {
        ...context,
        projectPath,
      });
    } else {
      // Default to uncommitted changes if nothing specified
      resultData = await extractUncommittedChanges(git, params.ignoreInstance, maxBlobSize, {
        ...context,
        projectPath,
      });
    }

    // Extract the results from the helper function
    const diffText = resultData.diffText;
    const diffSummary = resultData.diffSummary;
    const revisionInfo = resultData.revisionInfo;
    const skippedFilesForSize = resultData.skippedFilesForSize;

    // Filter files BEFORE extracting diffs to prevent memory overflow
    const filteredSummary = diffSummary
      .filter((file) => !file.binary) // Only process text files
      .filter(isTextFile) // Type guard to ensure we have text file data
      .filter((file) => {
        // Filter out ignored files (node_modules, dist, etc.) if ignoreInstance provided
        if (params.ignoreInstance) {
          const shouldIgnore = params.ignoreInstance.ignores(file.file);
          if (shouldIgnore) {
            logger.debug(`Ignoring file in git diff: ${file.file}`, context);
          }
          return !shouldIgnore;
        }
        return true;
      });

    // Log filtering results
    const totalFiles = diffSummary.length;
    const filteredFiles = filteredSummary.length;
    if (params.ignoreInstance && totalFiles > filteredFiles) {
      logger.info(`Git diff filtered: ${filteredFiles}/${totalFiles} files (ignored ${totalFiles - filteredFiles})`, context);
    }

    // Process files and extract individual diffs
    const files = filteredSummary.map((file) => {
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
      // Include skipped files information for consumer tools
      skippedFiles: skippedFilesForSize.length > 0 ? skippedFilesForSize : undefined,
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

