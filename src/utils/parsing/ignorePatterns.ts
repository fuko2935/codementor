/**
 * @fileoverview Utility for creating ignore pattern instances that support
 * both .gitignore and .mcpignore files. This provides centralized file filtering
 * logic used across all MCP tools for consistent behavior.
 * @module src/utils/parsing/ignorePatterns
 */

import { promises as fs } from "fs";
import path from "path";
import ignore from "ignore";
import { logger, type RequestContext } from "../internal/index.js";

/**
 * Default ignore patterns applied to all projects.
 * These patterns exclude common build artifacts, dependencies, and system files.
 */
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "*.log",
  ".env*",
  "coverage/**",
  ".DS_Store",
  "Thumbs.db",
  "*.tmp",
  "*.temp",
  "*.map",
  "*.lock",
  ".cache/**",
];

/**
 * Options for creating an ignore instance.
 */
export interface CreateIgnoreInstanceOptions {
  /** Absolute or relative path to the project directory */
  projectPath: string;
  /** Additional temporary ignore patterns (for this operation only) */
  temporaryIgnore?: string[];
  /** If true, skips loading .mcpignore and only uses .gitignore. Defaults to false. */
  ignoreMcpignore?: boolean;
  /** Request context for logging */
  context: RequestContext;
}

/**
 * Creates and configures an ignore instance with:
 * 1. Default patterns (node_modules, .git, dist, build, etc.)
 * 2. .gitignore patterns (if file exists)
 * 3. .mcpignore patterns (if file exists and not ignored) - works on top of .gitignore
 * 4. Temporary ignore patterns (if provided)
 *
 * This function is error-tolerant: missing .gitignore or .mcpignore files
 * are handled gracefully without throwing errors.
 *
 * @param options - Configuration options for the ignore instance
 * @returns A promise resolving to a configured Ignore instance
 *
 * @example
 * const ig = await createIgnoreInstance({
 *   projectPath: "/path/to/project",
 *   temporaryIgnore: ["test/**"],
 *   ignoreMcpignore: true,
 *   context: requestContext
 * });
 * const filteredFiles = allFiles.filter((f) => !ig.ignores(f));
 */
export async function createIgnoreInstance(
  options: CreateIgnoreInstanceOptions,
): Promise<ReturnType<typeof ignore>> {
  const { projectPath, temporaryIgnore, ignoreMcpignore = false, context } = options;
  const ig = ignore();

  // 1. Add default patterns first
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // 2. Load and apply .gitignore patterns
  const gitignorePath = path.join(projectPath, ".gitignore");
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
    logger.debug("Loaded .gitignore patterns", {
      ...context,
      gitignorePath,
      patternCount: gitignoreContent.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length,
    });
  } catch (error) {
    // .gitignore is optional - file not found is OK
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      // Log unexpected errors but don't fail
      logger.debug("Could not read .gitignore (non-critical)", {
        ...context,
        gitignorePath,
        error: String(error),
      });
    }
  }

  // 3. Conditionally load and apply .mcpignore patterns
  if (!ignoreMcpignore) {
    const mcpignorePath = path.join(projectPath, ".mcpignore");
    try {
      const mcpignoreContent = await fs.readFile(mcpignorePath, "utf-8");
      ig.add(mcpignoreContent);
      logger.debug("Loaded .mcpignore patterns", {
        ...context,
        mcpignorePath,
        patternCount: mcpignoreContent.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length,
      });
    } catch (error) {
      // .mcpignore is optional - file not found is OK
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code !== "ENOENT"
      ) {
        // Log unexpected errors but don't fail
        logger.debug("Could not read .mcpignore (non-critical)", {
          ...context,
          mcpignorePath,
          error: String(error),
        });
      }
    }
  } else {
    logger.debug("Skipping .mcpignore file as requested", {
      ...context,
    });
  }

  // 4. Add temporary ignore patterns (highest priority - applied last)
  if (temporaryIgnore && temporaryIgnore.length > 0) {
    ig.add(temporaryIgnore);
    logger.debug("Added temporary ignore patterns", {
      ...context,
      temporaryIgnoreCount: temporaryIgnore.length,
    });
  }

  return ig;
}

