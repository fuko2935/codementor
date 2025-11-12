/**
 * @fileoverview MCP Configuration Validator
 * Checks if MCP setup guide has been configured before allowing tool usage
 * @module src/mcp-server/utils/mcpConfigValidator
 */

import { promises as fs } from "fs";
import path from "path";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { logger, type RequestContext } from "../../utils/index.js";
import {
  CLIENT_PROFILES,
  type ClientName,
} from "../../config/clientProfiles.js";
import { validateSecurePath } from "./securePathValidator.js";

/**
 * In-memory cache for MCP config existence checks.
 * Single source of truth shared across all tools.
 */
const configCache = new Map<
  string,
  { exists: boolean; filePath?: string; client?: ClientName; timestamp: number }
>();

/**
 * TTL for cache entries in milliseconds.
 * Keeps cache fresh while avoiding excessive FS scans.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Shared marker constants for content injection used by setup tools.
 * These must match the values used in mcpSetupGuide and projectBootstrap.
 */
export const MCP_CONTENT_START_MARKER = "<!-- MCP:GEMINI-MCP-LOCAL:START -->";
export const MCP_CONTENT_END_MARKER = "<!-- MCP:GEMINI-MCP-LOCAL:END -->";

/**
 * Checks if MCP configuration exists in the given project path.
 * Uses in-memory cache and validates both START and END markers.
 */
export async function mcpConfigExists(
  projectPath: string,
  context: RequestContext,
  forceRefresh = false,
): Promise<{ exists: boolean; filePath?: string; client?: ClientName }> {
  // SECURITY: Validate and normalize path FIRST before any file operations
  const normalizedPath = await validateSecurePath(
    projectPath,
    process.cwd(),
    context,
  );
  const now = Date.now();

  // Check cache (skip if forceRefresh or expired)
  if (!forceRefresh) {
    const cached = configCache.get(normalizedPath);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      logger.debug("MCP config check: using cache", {
        ...context,
        projectPath: normalizedPath,
        cachedResult: cached.exists,
      });
      return {
        exists: cached.exists,
        filePath: cached.filePath,
        client: cached.client,
      };
    }
  }

  // Check all possible client config files with optimized file operations
  for (const [clientName, profile] of Object.entries(CLIENT_PROFILES)) {
    const fullPath = profile.directory
      ? path.join(normalizedPath, profile.directory, profile.file)
      : path.join(normalizedPath, profile.file);

    try {
      // 1. Check file existence first (faster than reading)
      await fs.access(fullPath, fs.constants.R_OK);

      // 2. Read first 500 bytes to check for START marker (performance optimization)
      const fileHandle = await fs.open(fullPath, "r");
      const buffer = Buffer.alloc(500);
      let bytesRead = 0;
      try {
        const result = await fileHandle.read(buffer, 0, 500, 0);
        bytesRead = result.bytesRead;
      } finally {
        await fileHandle.close();
      }

      if (bytesRead > 0) {
        const partialContent = buffer.toString("utf-8", 0, bytesRead);

        // Check for START marker in first 500 bytes
        // If found, read full file to verify END marker
        if (partialContent.includes(MCP_CONTENT_START_MARKER)) {
          const fullContent = await fs.readFile(fullPath, "utf-8");

          if (
            fullContent.includes(MCP_CONTENT_START_MARKER) &&
            fullContent.includes(MCP_CONTENT_END_MARKER)
          ) {
            const result = {
              exists: true,
              filePath: fullPath,
              client: clientName as ClientName,
            };

            configCache.set(normalizedPath, { ...result, timestamp: now });

            logger.debug("MCP config found", {
              ...context,
              filePath: fullPath,
              client: clientName,
            });

            return result;
          }
        }
      }
    } catch {
      // File doesn't exist or can't be read, continue checking
      continue;
    }
  }

  // Cache the negative result
  const result = { exists: false };
  configCache.set(normalizedPath, { ...result, timestamp: now });

  return result;
}

/**
 * Validates that MCP configuration exists in the project
 * Throws an error with helpful instructions if not found
 * 
 * @param projectPath - Project directory path to check
 * @param context - Request context for logging
 * @throws {McpError} If MCP configuration is not found
 */
export async function validateMcpConfigExists(
  projectPath: string,
  context: RequestContext,
): Promise<void> {
  const configCheck = await mcpConfigExists(projectPath, context);

  if (!configCheck.exists) {
    const errorMessage =
      `\n` +
      `█████████████████████████████████████████████████████████████████\n` +
      `█                                                               █\n` +
      `█  🚨 STOP - YOU MUST RUN 'mcp_setup_guide' TOOL FIRST 🚨     █\n` +
      `█                                                               █\n` +
      `█████████████████████████████████████████████████████████████████\n\n` +
      `⛔ THIS TOOL CANNOT RUN WITHOUT SETUP ⛔\n\n` +
      `REQUIRED FIRST STEP (takes 1 second):\n` +
      `Call mcp_setup_guide tool NOW:\n\n` +
      `  mcp_setup_guide({ \n` +
      `    client: "cursor",    // or: gemini-cli, claude-code, warp, cline, etc.\n` +
      `    projectPath: "."\n` +
      `  })\n\n` +
      `After setup completes, you can use all MCP analysis tools.\n\n` +
      `WHY THIS IS REQUIRED:\n` +
      `The setup guide provides essential documentation on how to use MCP tools\n` +
      `correctly. This ensures efficient analysis and avoids token limits or\n` +
      `incorrect operations. It takes 1 second to run.\n\n` +
      `❌ DO NOT try to analyze files manually\n` +
      `✅ DO call mcp_setup_guide first`;

    logger.warning("MCP config validation failed - setup required", {
      ...context,
      projectPath,
    });

    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      errorMessage,
      {
        projectPath,
        requiredAction: "call_mcp_setup_guide",
        availableClients: Object.keys(CLIENT_PROFILES),
      },
    );
  }

  logger.debug("MCP config validation passed", {
    ...context,
    projectPath,
    configFile: configCheck.filePath,
    client: configCheck.client,
  });
}

/**
 * Refreshes the in-memory config cache.
 * Called by setup tools after writing a config file.
 */
export function refreshMcpConfigCache(
  normalizedPath: string,
  entry: { exists: boolean; filePath?: string; client?: ClientName },
): void {
  configCache.set(normalizedPath, { ...entry, timestamp: Date.now() });
}

/**
 * Optional: Creates a more lenient validator that only logs a warning
 * Can be used for tools that should work even without MCP config
 *
 * @param projectPath - Project directory path to check
 * @param context - Request context for logging
 */
export async function warnIfMcpConfigMissing(
  projectPath: string,
  context: RequestContext,
): Promise<void> {
  const configCheck = await mcpConfigExists(projectPath, context);

  if (!configCheck.exists) {
    logger.warning(
      "MCP config not found - tool will proceed but setup is recommended",
      {
        ...context,
        projectPath,
        recommendation: "call_mcp_setup_guide",
      },
    );
  }
}

