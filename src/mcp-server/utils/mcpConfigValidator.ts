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
import { AsyncLock } from "../../utils/concurrency/asyncLock.js";

// --- Hybrid Cache Implementation (In-Memory + Filesystem) ---

interface CacheEntry {
  exists: boolean;
  filePath?: string;
  client?: ClientName;
  timestamp: number;
}

/**
 * In-memory cache for fast access within the same session.
 * This is the first layer of caching.
 */
const memoryCache = new Map<string, CacheEntry>();

/**
 * AsyncLock to prevent race conditions when multiple processes
 * try to build and write to the cache simultaneously.
 */
const cacheLock = new AsyncLock();

/**
 * Path to the filesystem cache file (relative to project root)
 * This is the second layer of caching for persistence across sessions.
 */
const CACHE_FILE_PATH = path.join(".mcp", "cache", "config_validator.json");

/**
 * TTL for cache entries in milliseconds.
 * Increased to 1 hour to reduce unnecessary bootstrap requirements.
 */
const CACHE_TTL_MS = 3_600_000; // 1 hour

/**
 * Reads the cache from filesystem
 */
async function readCache(projectPath: string): Promise<Record<string, CacheEntry>> {
  const cachePath = path.join(projectPath, CACHE_FILE_PATH);
  try {
    const data = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Writes the cache to filesystem using atomic write pattern
 * to prevent corruption from concurrent writes
 */
async function writeCache(projectPath: string, cache: Record<string, CacheEntry>): Promise<void> {
  const cachePath = path.join(projectPath, CACHE_FILE_PATH);
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    
    // Atomic write: write to temp file first, then rename
    // This ensures the file is either fully written or not updated
    const tempPath = `${cachePath}.${Date.now()}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(cache, null, 2));
    await fs.rename(tempPath, cachePath);
  } catch (error) {
    // Note: This is a utility function without RequestContext, so we log without it
    logger.warning("Failed to write to MCP config validator cache", {
      requestId: "cache-write",
      timestamp: new Date().toISOString(),
      path: cachePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// --- End Filesystem Cache Implementation ---

/**
 * Shared marker constants for content injection used by setup tools.
 * Supports both legacy (GEMINI-MCP-LOCAL) and new (CODEMENTOR) markers for backward compatibility.
 */
export const MCP_CONTENT_START_MARKER = "<!-- MCP:GEMINI-MCP-LOCAL:START -->";
export const MCP_CONTENT_END_MARKER = "<!-- MCP:GEMINI-MCP-LOCAL:END -->";

// New marker constants for CodeMentor branding
export const MCP_CODEMENTOR_START_MARKER = "<!-- MCP:CODEMENTOR:START -->";
export const MCP_CODEMENTOR_END_MARKER = "<!-- MCP:CODEMENTOR:END -->";

/**
 * Checks if MCP configuration exists in the given project path.
 * Uses in-memory cache and validates both START and END markers.
 */
/**
 * Finds the project root directory by looking for common markers
 * (.git, package.json, etc.) starting from the given path and walking up
 */
async function findProjectRoot(startPath: string): Promise<string> {
  let currentPath = startPath;
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    // Check for common project root markers
    const markers = ['.git', 'package.json', '.mcpignore', '.gitignore'];
    
    for (const marker of markers) {
      try {
        const markerPath = path.join(currentPath, marker);
        await fs.access(markerPath);
        // Found a marker, this is likely the project root
        return currentPath;
      } catch {
        // Marker not found, continue
      }
    }
    
    // Move up one directory
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      // Reached the root without finding markers
      break;
    }
    currentPath = parentPath;
  }
  
  // If no markers found, return the original path
  return startPath;
}

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
  
  // Find the project root (where config files should be)
  const projectRoot = await findProjectRoot(normalizedPath);
  
  const now = Date.now();

  // Use project root for caching (so subdirectories share the same cache)
  const cacheKey = projectRoot;

  // Layer 1: Check in-memory cache first (fastest)
  if (!forceRefresh) {
    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached && now - memoryCached.timestamp < CACHE_TTL_MS) {
      logger.debug("MCP config check: using in-memory cache", {
        ...context,
        projectPath: normalizedPath,
        projectRoot,
        cachedResult: memoryCached.exists,
      });
      return {
        exists: memoryCached.exists,
        filePath: memoryCached.filePath,
        client: memoryCached.client,
      };
    }
  }

  // Layer 2: Check filesystem cache (persistent across sessions)
  if (!forceRefresh) {
    const filesystemCache = await readCache(projectRoot);
    const fsCached = filesystemCache[cacheKey];
    if (fsCached && now - fsCached.timestamp < CACHE_TTL_MS) {
      // Populate in-memory cache for next time
      memoryCache.set(cacheKey, fsCached);
      
      logger.debug("MCP config check: using filesystem cache", {
        ...context,
        projectPath: normalizedPath,
        projectRoot,
        cachedResult: fsCached.exists,
      });
      return {
        exists: fsCached.exists,
        filePath: fsCached.filePath,
        client: fsCached.client,
      };
    }
  }

  // Layer 3: Cache miss - perform expensive file scan with lock to prevent race conditions
  await cacheLock.acquire();
  try {
    // Double-check cache inside lock (another process might have populated it while waiting)
    const memoryCachedAfterLock = memoryCache.get(cacheKey);
    if (!forceRefresh && memoryCachedAfterLock && now - memoryCachedAfterLock.timestamp < CACHE_TTL_MS) {
      logger.debug("MCP config check: found in cache after lock acquisition", {
        ...context,
        projectPath: normalizedPath,
        projectRoot,
      });
      return {
        exists: memoryCachedAfterLock.exists,
        filePath: memoryCachedAfterLock.filePath,
        client: memoryCachedAfterLock.client,
      };
    }

    // Perform the expensive file scan in the project root
    const scanResult = await performConfigFileScan(projectRoot, context, now);
    
    // Write to both caches using the cache key
    memoryCache.set(cacheKey, scanResult);
    const filesystemCache = await readCache(projectRoot);
    filesystemCache[cacheKey] = scanResult;
    await writeCache(projectRoot, filesystemCache);
    
    logger.debug("MCP config check: scan complete", {
      ...context,
      projectPath: normalizedPath,
      projectRoot,
      found: scanResult.exists,
    });
    
    return {
      exists: scanResult.exists,
      filePath: scanResult.filePath,
      client: scanResult.client,
    };
  } finally {
    cacheLock.release();
  }
}

/**
 * Performs the actual file system scan to find MCP config files.
 * Extracted into a separate function for better code organization.
 */
async function performConfigFileScan(
  normalizedPath: string,
  context: RequestContext,
  timestamp: number,
): Promise<CacheEntry> {
  // Check all possible client config files with optimized file operations
  for (const [clientName, profile] of Object.entries(CLIENT_PROFILES)) {
    const fullPath = profile.directory
      ? path.join(normalizedPath, profile.directory, profile.file)
      : path.join(normalizedPath, profile.file);

    try {
      // 1. Check file existence first (faster than reading)
      await fs.access(fullPath, fs.constants.R_OK);

      // 2. Read first 2KB to check for START marker (increased from 500 bytes for better detection)
      const fileHandle = await fs.open(fullPath, "r");
      const buffer = Buffer.alloc(2048);
      let bytesRead = 0;
      try {
        const result = await fileHandle.read(buffer, 0, 2048, 0);
        bytesRead = result.bytesRead;
      } finally {
        await fileHandle.close();
      }

      if (bytesRead > 0) {
        const partialContent = buffer.toString("utf-8", 0, bytesRead);

        // Check for START marker in first 2KB (support both legacy and new markers)
        const hasLegacyStartMarker = partialContent.includes(MCP_CONTENT_START_MARKER);
        const hasNewStartMarker = partialContent.includes(MCP_CODEMENTOR_START_MARKER);
        
        if (hasLegacyStartMarker || hasNewStartMarker) {
          // Performance optimization: Read only last 2KB to check for END marker
          // instead of loading entire file into memory
          const stats = await fs.stat(fullPath);
          const endBuffer = Buffer.alloc(2048);
          const endPosition = Math.max(0, stats.size - 2048);
          
          const endFileHandle = await fs.open(fullPath, "r");
          let endBytesRead = 0;
          try {
            const result = await endFileHandle.read(endBuffer, 0, 2048, endPosition);
            endBytesRead = result.bytesRead;
          } finally {
            await endFileHandle.close();
          }
          
          const endContent = endBuffer.toString("utf-8", 0, endBytesRead);

          // Check if both START and END markers exist (either legacy or new)
          const hasValidLegacyMarkers =
            hasLegacyStartMarker && endContent.includes(MCP_CONTENT_END_MARKER);
          const hasValidNewMarkers =
            hasNewStartMarker && endContent.includes(MCP_CODEMENTOR_END_MARKER);

          if (hasValidLegacyMarkers || hasValidNewMarkers) {
            logger.debug("MCP config found during file scan", {
              ...context,
              filePath: fullPath,
              client: clientName,
              markerType: hasValidNewMarkers ? "codementor" : "legacy",
            });

            return {
              exists: true,
              filePath: fullPath,
              client: clientName as ClientName,
              timestamp,
            };
          } else {
            // Marker found but incomplete - log for debugging
            logger.debug("MCP config markers incomplete", {
              ...context,
              filePath: fullPath,
              hasStartMarker: hasLegacyStartMarker || hasNewStartMarker,
              hasEndMarker: endContent.includes(MCP_CONTENT_END_MARKER) || endContent.includes(MCP_CODEMENTOR_END_MARKER),
            });
          }
        }
      }
    } catch {
      // File doesn't exist or can't be read, continue checking
      continue;
    }
  }

  // No config found - return negative result
  logger.debug("MCP config not found during file scan", { ...context });
  return {
    exists: false,
    timestamp,
  };
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
      `██████████████████████████████████████████████████████████████████\n` +
      `█                                                                █\n` +
      `█  🚨 STOP - YOU MUST RUN 'project_bootstrap' TOOL FIRST 🚨     █\n` +
      `█                                                                █\n` +
      `██████████████████████████████████████████████████████████████████\n\n` +
      `⛔ THIS TOOL CANNOT RUN WITHOUT SETUP ⛔\n\n` +
      `REQUIRED FIRST STEP (takes 2 seconds):\n` +
      `Call the project_bootstrap tool NOW:\n\n` +
      `  project_bootstrap({ \n` +
      `    client: "kiro",      // or: cursor, gemini-cli, claude-code, warp, cline, etc.\n` +
      `    projectPath: "."\n` +
      `  })\n\n` +
      `After setup completes, you can use all other MCP analysis tools.\n\n` +
      `WHY THIS IS REQUIRED:\n` +
      `The bootstrap tool creates essential configuration files (e.g., AGENTS.md, .mcpignore)\n` +
      `and injects a guide on how to use all MCP tools correctly. This ensures\n` +
      `efficient analysis and avoids token limits or incorrect operations.\n\n` +
      `NOTE: Bootstrap only needs to run ONCE per project. If you're seeing this\n` +
      `repeatedly, the config file may be missing markers or in an unexpected location.\n` +
      `Check the relevant client configuration file (e.g., AGENTS.md, .kiro/steering/mcp-guide.md)\n` +
      `exists and contains MCP markers (<!-- MCP:CODEMENTOR:START --> and <!-- MCP:CODEMENTOR:END -->).\n\n` +
      `❌ DO NOT try to analyze files manually\n` +
      `✅ DO call project_bootstrap first (only once per project)`;

    logger.warning("MCP config validation failed - setup required", {
      ...context,
      projectPath,
    });

    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      errorMessage,
      {
        projectPath,
        requiredAction: "call_project_bootstrap",
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
 * Refreshes both in-memory and filesystem config caches.
 * Called by setup tools after writing a config file.
 */
export async function refreshMcpConfigCache(
  normalizedPath: string,
  entry: { exists: boolean; filePath?: string; client?: ClientName },
): Promise<void> {
  const cacheEntry: CacheEntry = { ...entry, timestamp: Date.now() };
  
  // Find project root for consistent caching
  const projectRoot = await findProjectRoot(normalizedPath);
  const cacheKey = projectRoot;
  
  // Acquire lock to prevent race conditions with concurrent scans
  await cacheLock.acquire();
  try {
    // Update both caches
    memoryCache.set(cacheKey, cacheEntry);
    
    const filesystemCache = await readCache(projectRoot);
    filesystemCache[cacheKey] = cacheEntry;
    await writeCache(projectRoot, filesystemCache);
  } finally {
    cacheLock.release();
  }
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
        recommendation: "call_project_bootstrap",
      },
    );
  }
}

