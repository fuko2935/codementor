/**
 * @fileoverview Provides secure path validation utilities.
 * Modified to allow access to any valid local path as per user requirement,
 * while still preventing malicious patterns like null bytes.
 * @module src/mcp-server/utils/securePathValidator
 */

import path from "path";
import { promises as fs } from "fs";
import { logger, type RequestContext, requestContextService } from "../../utils/index.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

/**
 * Validates and resolves a project path.
 * Allows access to any valid directory on the local filesystem.
 *
 * @param projectPath - The project path to validate (can be relative or absolute)
 * @param baseDir - Base directory for resolving relative paths (defaults to process.cwd())
 * @param context - Request context for logging
 * @returns The normalized, validated absolute path
 * @throws {McpError} If path is invalid or does not exist
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
    // 1. Null bytes check (Security: malicious input)
    if (projectPath.includes("\x00")) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "Path contains null bytes",
        { providedPath: projectPath }
      );
    }

    // 2. Empty check
    if (!projectPath || projectPath.trim() === "") {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "Path cannot be empty",
        { providedPath: projectPath }
      );
    }

    // Resolve the path - if it's relative, resolve against baseDir
    // If it's absolute, use it as-is
    const resolvedPath = path.isAbsolute(projectPath) 
      ? path.resolve(projectPath)
      : path.resolve(baseDir, projectPath);
    
    const normalizedPath = path.normalize(resolvedPath);

    // NOTE: Containment check removed to allow analyzing external projects.
    // The user explicitly requested to allow access to any local path.
    logger.debug("Path resolved", {
      ...requestContext,
      originalPath: projectPath,
      resolvedPath: normalizedPath,
    });

    // Verify the path exists and is a directory
    const stats = await fs.stat(normalizedPath).catch((e) => {
      logger.warning("Path does not exist or is inaccessible", {
        ...requestContext,
        path: normalizedPath,
        error: e instanceof Error ? e.message : String(e),
      });
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        `Project path does not exist or is inaccessible: ${projectPath}`,
      );
    });

    if (!stats.isDirectory()) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
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

