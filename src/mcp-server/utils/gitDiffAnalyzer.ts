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
  } catch (error) {
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
  // Find the diff block that starts with this file
  const filePattern = new RegExp(
    `diff --git a/${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} b/${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=diff --git|$)`,
  );
  const match = fullDiff.match(filePattern);
  return match ? match[0].trim() : "";
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
    const skippedFilesForSize: Array<{ path: string; size: number; reason: string }> = [];
    const maxBlobSize = config.maxGitBlobSizeBytes;

    // Handle uncommitted changes (revision === ".")
    if (params.revision === ".") {
      logger.debug("Extracting uncommitted changes", {
        ...context,
        projectPath,
      });

      // Filter files early if ignoreInstance provided
      let filesToDiff: string[] = [];
      let allChangedFiles: string[] = [];
      
      // Get file names first (needed for both ignore and size filtering)
      logger.info(`🔍 Getting uncommitted files list (name-only)...`, context);
      const nameOnlyResult = await git.raw(['diff', '--name-only']);
      allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
      
      // Filter using ignore patterns if provided
      if (params.ignoreInstance) {
        filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
        logger.info(`🔍 Uncommitted files after ignore filtering: ${filesToDiff.length}/${allChangedFiles.length} (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
      } else {
        filesToDiff = allChangedFiles;
      }

      // NEW: Filter by file size before running git diff
      const safeFilesToDiff: string[] = [];
      for (const file of filesToDiff) {
        const size = await getGitBlobSize(git, 'index', file);
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

      // Get diff text only for safe files (within size limit)
      if (safeFilesToDiff.length > 0) {
        logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} uncommitted files, ${skippedFilesForSize.length} skipped due to size)`, context);
        const diffTextResult = await git.diff(['--', ...safeFilesToDiff]);
        diffText = diffTextResult;
        logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
        
        // Get actual insertion/deletion counts for filtered files
        diffSummary = await getDiffSummaryForFiles(git, undefined, undefined, safeFilesToDiff, context);
      } else {
        logger.info(`📭 No uncommitted files to diff after filtering`, context);
        diffText = "";
        diffSummary = [];
      }

      // Get current branch for context
      const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim();
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

      // Filter files early if ignoreInstance provided
      let filesToDiff: string[] = [];
      let allChangedFiles: string[] = [];
      
      // Get file names first (needed for both ignore and size filtering)
      logger.info(`🔍 Getting changed files list (name-only, no content)...`, context);
      const nameOnlyResult = await git.raw(['diff', '--name-only', baseRevision, headRevision]);
      allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
      
      // Filter using ignore patterns if provided
      if (params.ignoreInstance) {
        filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
        logger.info(`🔍 Git diff filtering: ${filesToDiff.length}/${allChangedFiles.length} files (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
        logger.info(`📂 Files to diff: ${filesToDiff.slice(0, 10).join(", ")}${filesToDiff.length > 10 ? "..." : ""}`, context);
      } else {
        filesToDiff = allChangedFiles;
      }

      // NEW: Filter by file size before running git diff
      const safeFilesToDiff: string[] = [];
      for (const file of filesToDiff) {
        // Check size at head revision
        const size = await getGitBlobSize(git, headRevision, file);
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

      // Get diff text only for safe files (within size limit)
      if (safeFilesToDiff.length > 0) {
        logger.info(`⚡ Running filtered git diff (${safeFilesToDiff.length} files, ${skippedFilesForSize.length} skipped due to size)`, context);
        const diffTextResult = await git.diff([baseRevision, headRevision, '--', ...safeFilesToDiff]);
        diffText = diffTextResult;
        logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
        
        // Get actual insertion/deletion counts for filtered files
        diffSummary = await getDiffSummaryForFiles(git, baseRevision, headRevision, safeFilesToDiff, context);
      } else {
        logger.info(`📭 No files to diff after filtering`, context);
        diffText = "";
        diffSummary = [];
      }
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

        // Filter files early if ignoreInstance provided
        let filesToDiff: string[] = [];
        let allChangedFiles: string[] = [];
        
        // Get file names first (needed for both ignore and size filtering)
        logger.info(`🔍 Getting changed files list for range ${base}..${head} (name-only)...`, context);
        const nameOnlyResult = await git.raw(['diff', '--name-only', base, head]);
        allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
        
        // Filter using ignore patterns if provided
        if (params.ignoreInstance) {
          filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
          logger.info(`🔍 Git diff filtering: ${filesToDiff.length}/${allChangedFiles.length} files (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
        } else {
          filesToDiff = allChangedFiles;
        }

        // NEW: Filter by file size before running git diff
        const safeFilesToDiff: string[] = [];
        for (const file of filesToDiff) {
          // Check size at head revision
          const size = await getGitBlobSize(git, head, file);
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

        // Get diff text only for safe files (within size limit)
        if (safeFilesToDiff.length > 0) {
          logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} files in range, ${skippedFilesForSize.length} skipped due to size)`, context);
          const diffTextResult = await git.diff([base, head, '--', ...safeFilesToDiff]);
          diffText = diffTextResult;
          logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
          
          // Get actual insertion/deletion counts for filtered files
          diffSummary = await getDiffSummaryForFiles(git, base, head, safeFilesToDiff, context);
        } else {
          logger.info(`📭 No files to diff after filtering`, context);
          diffText = "";
          diffSummary = [];
        }
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
          // Filter files early if ignoreInstance provided
          let filesToDiff: string[] = [];
          let allChangedFiles: string[] = [];
          
          // Get file names first (needed for both ignore and size filtering)
          logger.info(`🔍 Getting changed files list for commit ${params.revision} (name-only)...`, context);
          const nameOnlyResult = await git.raw(['diff', '--name-only', baseRevision, params.revision]);
          allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
          
          // Filter using ignore patterns if provided
          if (params.ignoreInstance) {
            filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
            logger.info(`🔍 Git diff filtering: ${filesToDiff.length}/${allChangedFiles.length} files (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
          } else {
            filesToDiff = allChangedFiles;
          }

          // NEW: Filter by file size before running git diff
          const safeFilesToDiff: string[] = [];
          for (const file of filesToDiff) {
            // Check size at commit revision
            const size = await getGitBlobSize(git, params.revision, file);
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

          // Get diff text only for safe files (within size limit)
          if (safeFilesToDiff.length > 0) {
            logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} files for commit, ${skippedFilesForSize.length} skipped due to size)`, context);
            const diffTextResult = await git.diff([baseRevision, params.revision, '--', ...safeFilesToDiff]);
            diffText = diffTextResult;
            logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
            
            // Get actual insertion/deletion counts for filtered files
            diffSummary = await getDiffSummaryForFiles(git, baseRevision, params.revision, safeFilesToDiff, context);
          } else {
            logger.info(`📭 No files to diff after filtering`, context);
            diffText = "";
            diffSummary = [];
          }
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
          
          // Filter files early if ignoreInstance provided
          let filesToDiff: string[] = [];
          let allChangedFiles: string[] = [];
          
          // Get file names first (needed for both ignore and size filtering)
          logger.info(`🔍 Getting changed files list for first commit ${params.revision} (name-only)...`, context);
          const nameOnlyResult = await git.raw(['diff', '--name-only', baseRevision, params.revision]);
          allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
          
          // Filter using ignore patterns if provided
          if (params.ignoreInstance) {
            filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
            logger.info(`🔍 Git diff filtering (first commit): ${filesToDiff.length}/${allChangedFiles.length} files (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
          } else {
            filesToDiff = allChangedFiles;
          }

          // NEW: Filter by file size before running git diff
          const safeFilesToDiff: string[] = [];
          for (const file of filesToDiff) {
            // Check size at commit revision
            const size = await getGitBlobSize(git, params.revision, file);
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

          // Get diff text only for safe files (within size limit)
          if (safeFilesToDiff.length > 0) {
            logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} files for first commit, ${skippedFilesForSize.length} skipped due to size)`, context);
            const diffTextResult = await git.diff([baseRevision, params.revision, '--', ...safeFilesToDiff]);
            diffText = diffTextResult;
            logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
            
            // Get actual insertion/deletion counts for filtered files
            diffSummary = await getDiffSummaryForFiles(git, baseRevision, params.revision, safeFilesToDiff, context);
          } else {
            logger.info(`📭 No files to diff after filtering`, context);
            diffText = "";
            diffSummary = [];
          }
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

      // Filter files early if ignoreInstance provided
      let filesToDiff: string[] = [];
      let allChangedFiles: string[] = [];
      
      // Get file names first (needed for both ignore and size filtering)
      logger.info(`🔍 Getting uncommitted files list (default, name-only)...`, context);
      const nameOnlyResult = await git.raw(['diff', '--name-only']);
      allChangedFiles = nameOnlyResult.split('\n').filter((f) => f.trim().length > 0);
      
      // Filter using ignore patterns if provided
      if (params.ignoreInstance) {
        filesToDiff = allChangedFiles.filter((file) => !params.ignoreInstance!.ignores(file));
        logger.info(`🔍 Uncommitted files (default): ${filesToDiff.length}/${allChangedFiles.length} (excluded: ${allChangedFiles.length - filesToDiff.length})`, context);
      } else {
        filesToDiff = allChangedFiles;
      }

      // NEW: Filter by file size before running git diff
      const safeFilesToDiff: string[] = [];
      for (const file of filesToDiff) {
        const size = await getGitBlobSize(git, 'index', file);
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

      // Get diff text only for safe files (within size limit)
      if (safeFilesToDiff.length > 0) {
        logger.info(`⚡ Running filtered diff (${safeFilesToDiff.length} uncommitted files, default, ${skippedFilesForSize.length} skipped due to size)`, context);
        const diffTextResult = await git.diff(['--', ...safeFilesToDiff]);
        diffText = diffTextResult;
        logger.info(`✅ Filtered diff size: ${(diffText.length / 1024).toFixed(2)} KB`, context);
        
        // Get actual insertion/deletion counts for filtered files
        diffSummary = await getDiffSummaryForFiles(git, undefined, undefined, safeFilesToDiff, context);
      } else {
        logger.info(`📭 No uncommitted files to diff after filtering (default)`, context);
        diffText = "";
        diffSummary = [];
      }

      const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim();
      revisionInfo = {
        base: currentBranch,
        head: "working directory",
      };
    }

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

