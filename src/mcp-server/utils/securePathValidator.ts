/**
 * @fileoverview Provides secure path validation utilities to prevent path traversal attacks.
 * This module ensures that all project paths are validated against a secure base directory
 * before any file system operations are performed.
 * @module src/mcp-server/utils/securePathValidator
 */

import path from "path";
import { promises as fs } from "fs";
import { logger, type RequestContext, requestContextService } from "../../utils/index.js";
import { sanitization } from "../../utils/security/sanitization.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

/**
 * Validates and resolves a project path securely.
 * Ensures the path is within the allowed base directory (process.cwd() by default).
 *
 * @param projectPath - The project path to validate (can be relative or absolute)
 * @param baseDir - Base directory to restrict paths to (defaults to process.cwd())
 * @param context - Request context for logging
 * @returns The normalized, validated absolute path
 * @throws {McpError} If path traversal is detected or path is invalid
 */
export async function validateSecurePath(
  projectPath: string,
  baseDir: string = process.cwd(),
  context?: RequestContext,
): Promise<string> {
  const requestContext: RequestContext = context ?? requestContextService.createRequestContext({
    operation: "validateSecurePath",
  });

  try {
    // Sanitize the path - allow absolute paths but validate they're within baseDir
    const sanitized = sanitization.sanitizePath(projectPath, {
      rootDir: baseDir,
      allowAbsolute: true, // Allow absolute paths - we'll validate they're within baseDir below
    });

    // Resolve against the base directory
    const resolvedPath = path.resolve(baseDir, sanitized.sanitizedPath);
    const normalizedPath = path.normalize(resolvedPath);

    // CRITICAL: Verify the final path is still within the base directory
    // This prevents path traversal attacks even if normalization changes the path
    const baseDirNormalized = path.normalize(path.resolve(baseDir));
    if (!normalizedPath.startsWith(baseDirNormalized + path.sep) && 
        normalizedPath !== baseDirNormalized) {
      logger.warning("Path traversal attempt detected", {
        ...requestContext,
        originalPath: projectPath,
        resolvedPath: normalizedPath,
        baseDir: baseDirNormalized,
      });
      throw new McpError(
        BaseErrorCode.FORBIDDEN,
        `Path traversal detected. Project path must be within the working directory. Path: '${projectPath}'`,
      );
    }

    // Verify the path exists and is a directory
    const stats = await fs.stat(normalizedPath).catch((e) => {
      logger.warning("Path does not exist or is inaccessible", {
        ...requestContext,
        path: normalizedPath,
        error: e instanceof Error ? e.message : String(e),
      });
      throw new McpError(
        BaseErrorCode.INVALID_INPUT,
        `Project path does not exist or is inaccessible: ${projectPath}`,
      );
    });

    if (!stats.isDirectory()) {
      throw new McpError(
        BaseErrorCode.INVALID_INPUT,
        `Project path is not a directory: ${projectPath}`,
      );
    }

    logger.debug("Path validated successfully", {
      ...requestContext,
      originalPath: projectPath,
      validatedPath: normalizedPath,
    });

    return normalizedPath;
  } catch (error) {
    // Re-throw McpError as-is
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Error validating secure path", {
      ...requestContext,
      error: error instanceof Error ? error.message : String(error),
      projectPath,
    });

    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to validate project path: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

