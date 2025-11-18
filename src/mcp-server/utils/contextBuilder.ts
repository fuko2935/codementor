/**
 * @fileoverview Shared context builder for preparing full project context
 * @module src/mcp-server/utils/contextBuilder
 */
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { type RequestContext, logger, createIgnoreInstance } from "../../utils/index.js";

/**
 * Maximum allowed total file size in bytes (100 MB).
 */
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

/**
 * Maximum allowed number of files to process.
 */
const MAX_FILE_COUNT = 1000;

/**
 * Prepares full project context by reading all non-ignored files
 * 
 * @param projectPath - Validated project path
 * @param temporaryIgnore - Additional ignore patterns for this operation
 * @param ignoreMcpignore - If true, ignores .mcpignore file
 * @param context - Request context for logging
 * @returns Full project context as string with file markers
 * @throws {McpError} VALIDATION_ERROR - When project exceeds size or file count limits
 */
export async function prepareFullContext(
  projectPath: string,
  temporaryIgnore: string[] = [],
  ignoreMcpignore: boolean = false,
  context: RequestContext,
): Promise<string> {
  const ig = await createIgnoreInstance({
    projectPath,
    temporaryIgnore,
    ignoreMcpignore,
    context,
  });

  const allFiles = await glob("**/*", {
    cwd: projectPath,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });

  const files = allFiles.filter((f) => !ig.ignores(f));

  // Check file count limit before processing
  if (files.length > MAX_FILE_COUNT) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      `Project too large: ${files.length} files found (maximum ${MAX_FILE_COUNT} allowed). ` +
        `Use .mcpignore to exclude unnecessary files (node_modules/, dist/, *.test.ts) or analyze a subdirectory instead.`,
      {
        fileCount: files.length,
        maxFileCount: MAX_FILE_COUNT,
      },
    );
  }

  // Use array buffer instead of string concatenation to avoid memory waste
  // Each += operation creates a new string copy, which is inefficient for large content
  const contextParts: string[] = [];
  let processedFiles = 0;
  let totalSize = 0;

  for (const file of files) {
    try {
      // Check file count limit during processing (safety check)
      if (processedFiles >= MAX_FILE_COUNT) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Project too large: processed ${processedFiles} files (maximum ${MAX_FILE_COUNT} allowed). ` +
            `Use .mcpignore or temporaryIgnore to exclude unnecessary files.`,
          {
            processedFiles,
            maxFileCount: MAX_FILE_COUNT,
          },
        );
      }

      const p = path.join(projectPath, file);
      const c = await fs.readFile(p, "utf-8");
      const contentSize = Buffer.byteLength(c, "utf-8");

      // Check total size limit
      if (totalSize + contentSize > MAX_TOTAL_SIZE) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Project too large: total size exceeds ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit ` +
            `(current: ${Math.round(totalSize / (1024 * 1024))}MB). ` +
            `Use .mcpignore to exclude large files/directories or analyze a subdirectory instead.`,
          {
            currentSize: totalSize,
            maxSize: MAX_TOTAL_SIZE,
            processedFiles,
          },
        );
      }

      contextParts.push(`--- File: ${file} ---\n`, c, "\n\n");
      processedFiles++;
      totalSize += contentSize;
    } catch (error) {
      // Re-throw McpError (circuit breaker)
      if (error instanceof McpError) {
        throw error;
      }
      // Skip unreadable files
      logger.debug("Skipping unreadable file", {
        ...context,
        file,
        error: String(error),
      });
    }
  }

  const full = contextParts.join("");

  logger.debug("File processing completed", {
    ...context,
    processedFiles,
    ignoredFiles: allFiles.length - files.length,
    totalSizeBytes: totalSize,
    totalSizeMB: Math.round(totalSize / (1024 * 1024)),
  });

  logger.info("Project context prepared successfully", {
    ...context,
    processedFiles,
    totalCharacters: full.length,
    totalSizeBytes: totalSize,
  });

  return full;
}
