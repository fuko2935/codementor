/**
 * @fileoverview Provides project size validation utilities to prevent processing
 * projects that exceed token limits. This module ensures that LLM API calls are
 * only made for projects within acceptable size boundaries.
 * @module src/mcp-server/utils/projectSizeValidator
 */

import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { logger, type RequestContext, requestContextService } from "../../utils/index.js";
import { createIgnoreInstance } from "../../utils/parsing/ignorePatterns.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { countTokensLocally } from "./tokenizer.js";
import { config } from "../../config/index.js";

/**
 * Result of project size validation.
 */
export interface ProjectSizeValidationResult {
  /** Whether the project size is within limits */
  valid: boolean;
  /** The calculated token count (if valid) */
  tokenCount?: number;
  /** Error message if project exceeds limit */
  error?: string;
}

/**
 * Calculates the total token count for a project directory.
 * Uses the same logic as calculateTokenCount tool but optimized for validation.
 *
 * @param projectPath - Absolute path to the project directory
 * @param temporaryIgnore - Optional array of patterns to temporarily ignore
 * @param ignoreMcpignore - Whether to ignore .mcpignore file
 * @param context - Request context for logging
 * @returns Total token count
 */
async function calculateProjectTokens(
  projectPath: string,
  temporaryIgnore: string[] | undefined,
  ignoreMcpignore: boolean | undefined,
  context: RequestContext,
): Promise<number> {
  const ig = await createIgnoreInstance({
    projectPath,
    temporaryIgnore,
    ignoreMcpignore,
    context,
  });

  const pattern = "**/*";
  const allFiles = await glob(pattern, {
    cwd: projectPath,
    nodir: true,
    dot: true,
  });

  const filteredFiles = allFiles.filter((f) => !ig.ignores(f));

  let totalTokens = 0;
  const maxFileSize = 1_000_000; // 1MB per file

  for (const file of filteredFiles) {
    try {
      const filePath = path.join(projectPath, file);
      const stats = await fs.stat(filePath);
      if (stats.size > maxFileSize || stats.size === 0) {
        continue;
      }
      const content = await fs.readFile(filePath, "utf-8");
      if (content.includes("\0")) {
        continue;
      }
      const tokens = countTokensLocally(content, "gemini-2.0-flash");
      totalTokens += tokens;
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  return totalTokens;
}

/**
 * Validates that a project's size is within the configured token limit.
 * Returns a friendly error message if the limit is exceeded.
 *
 * @param projectPath - Path to the project directory (can be relative or absolute)
 * @param maxTokens - Maximum allowed tokens (defaults to config.MAX_PROJECT_TOKENS or 20M)
 * @param temporaryIgnore - Optional array of patterns to temporarily ignore
 * @param ignoreMcpignore - Whether to ignore .mcpignore file
 * @param context - Request context for logging
 * @returns Validation result with token count and error message if invalid
 */
export async function validateProjectSize(
  projectPath: string,
  maxTokens?: number,
  temporaryIgnore?: string[],
  ignoreMcpignore?: boolean,
  context?: RequestContext,
): Promise<ProjectSizeValidationResult> {
  const effectiveMaxTokens = maxTokens ?? config.maxProjectTokens ?? 20_000_000;
  const requestContext: RequestContext = context ?? requestContextService.createRequestContext({
    operation: "validateProjectSize",
  });

  try {
    // The projectPath should already be validated by validateSecurePath before calling this function
    // We just verify it exists and is a directory
    const stats = await fs.stat(projectPath);
    if (!stats.isDirectory()) {
      throw new McpError(
        BaseErrorCode.INVALID_INPUT,
        `Project path is not a directory: ${projectPath}`,
      );
    }

    logger.debug("Calculating project token count for validation", {
      ...requestContext,
      projectPath: projectPath,
      maxTokens: effectiveMaxTokens,
    });

    // Calculate token count
    const tokenCount = await calculateProjectTokens(
      projectPath,
      temporaryIgnore,
      ignoreMcpignore,
      requestContext,
    );

    logger.debug("Project token count calculated", {
      ...requestContext,
      tokenCount,
      maxTokens: effectiveMaxTokens,
    });

    // Check if token count exceeds limit
    if (tokenCount > effectiveMaxTokens) {
      const errorMessage =
        `Projenizin boyutu çok büyük (${tokenCount.toLocaleString()} token, limit: ${effectiveMaxTokens.toLocaleString()}).\n\n` +
        `Lütfen şunları kontrol edin:\n` +
        `- .gitignore dosyanızda node_modules, dist, build klasörleri ignore edilmiş mi?\n` +
        `- .mcpignore dosyası oluşturup ek dosya/klasörleri ignore ettiniz mi?\n` +
        `- Gereksiz büyük binary, video, image dosyaları var mı?\n\n` +
        `İpucu: Büyük projeler için project_orchestrator_create aracını kullanabilirsiniz.`;

      logger.warning("Project size exceeds token limit", {
        ...requestContext,
        tokenCount,
        maxTokens: effectiveMaxTokens,
        projectPath: projectPath,
      });

      return {
        valid: false,
        tokenCount,
        error: errorMessage,
      };
    }

    return {
      valid: true,
      tokenCount,
    };
  } catch (error) {
    logger.error("Error validating project size", {
      ...requestContext,
      error: error instanceof Error ? error.message : String(error),
      projectPath,
    });

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to validate project size: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

