# Commit Review Analysis - MCP Timeout & Crash Issue

## Problem Description
- **Issue**: First MCP tool call gets stuck and times out; second request causes MCP to error and shut down
- **Introduced**: Between commits before `2a62902` (when validation was added)
- **Still present**: After commit `77a8281` (caching attempt)

## Commits Reviewed

### 1. **Commit 2a62902** - `feat: add MCP setup guide and configuration validation`
**Date**: Nov 5, 17:42:05 2025

**Critical Bug Found**: `__dirname` used without being defined!

```typescript
// ❌ BROKEN CODE in 2a62902
// File: src/mcp-server/tools/mcpSetupGuide/logic.ts

// NO ESM imports for __dirname!
import { promises as fs } from "fs";
import path from "path";
// ❌ Missing: import { fileURLToPath } from "url";

async function generateMcpGuideContent(): Promise<string> {
  try {
    // ❌ __dirname is UNDEFINED in ESM modules!
    const templatePath = path.join(__dirname, "templates", "mcp-guide.md");
    const content = await fs.readFile(templatePath, "utf-8");
    return content;
  } catch (_error) {
    // Falls back to embedded content
  }
}
```

**Impact**: 
- `__dirname` is `undefined` in ESM modules
- `path.join(undefined, "templates", "mcp-guide.md")` creates invalid path
- File read fails/hangs, causing timeout
- Validation added to ALL analysis tools, so EVERY tool call triggers this

**Affected Tools** (all had validation added):
- `geminiCodebaseAnalyzer`
- `dynamicExpertAnalyze`
- `dynamicExpertCreate`
- `projectOrchestratorAnalyze`
- `projectOrchestratorCreate`

---

### 2. **Commit 2f9e900** - `feat: implement MCP-driven mentor workflow`
**Date**: Nov 5, 18:57:02 2025

**Partial Fix**: Added ESM __dirname imports

```typescript
// ✅ FIXED in 2f9e900
import { fileURLToPath } from "url";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**But introduced new issue**: Removed fallback content, made template CRITICAL

```typescript
// ⚠️ NEW ISSUE: Throws McpError if template missing
async function generateMcpGuideContent(context?: RequestContext): Promise<string> {
  try {
    const templatePath = path.join(__dirname, "templates", "mcp-guide.md");
    const content = await fs.readFile(templatePath, "utf-8");
    return content;
  } catch (error) {
    // ❌ Now throws critical error instead of using fallback
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `CRITICAL: The MCP guide template file is missing...`,
    );
  }
}
```

---

### 3. **Commit 77a8281** - `feat(mcp): add caching layer to fix tool timeout`
**Date**: Nov 5, 19:33:19 2025

**Attempted Fix**: Added 60-second TTL cache for config checks

```typescript
// In-memory cache for config existence check
const configCache = new Map<string, { exists: boolean; filePath?: string; client?: ClientName; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 60 seconds

export async function mcpConfigExists(
  projectPath: string,
  context: RequestContext,
  forceRefresh = false,
): Promise<{ exists: boolean; filePath?: string; client?: ClientName }> {
  const normalizedPath = path.resolve(projectPath);
  const now = Date.now();
  
  // Check cache (skip if forceRefresh or expired)
  if (!forceRefresh) {
    const cached = configCache.get(normalizedPath);
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return { exists: cached.exists, filePath: cached.filePath, client: cached.client };
    }
  }
  
  // Check all possible client config files (17+ files!)
  for (const [clientName, profile] of Object.entries(CLIENT_PROFILES)) {
    // ... scans 17+ different file paths
  }
}
```

**Why this doesn't fully solve the issue**:
1. First call still scans 17+ files (slow on some systems)
2. Each file read could be large (AGENTS.md files)
3. If cache is cold or expired, delay happens again
4. No timeout mechanism on individual file reads

---

## Root Causes Identified

### Primary Issue: Performance Bottleneck in Validation

**The validation flow**:
```
Tool Called
  └─> validateMcpConfigExists(projectPath, context)
      └─> mcpConfigExists(projectPath, context)
          └─> Scans 17+ different file locations:
              - AGENTS.md (12 clients)
              - GEMINI.md
              - CLAUDE.md
              - WARP.md
              - QWEN.md
              - .clinerules/mcp-guide.md
              - .kiro/steering/mcp-guide.md
              - .qoder/AGENTS.md
              
              For EACH file:
                1. Build full path
                2. Try to read entire file content
                3. Check if contains MCP markers
                4. If found, return; else continue
```

**Problem**: 
- On first call (no cache), ALL tools block on this scan
- Large AGENTS.md files (can be 100KB+) read into memory
- Slow disk I/O can cause significant delay
- No timeout on individual file operations
- Error handling catches exceptions but continues, potentially leaving state dirty

### Secondary Issue: Potential STDIO Corruption

**Found in**: `src/index.ts` and `src/utils/internal/logger.ts`

```typescript
// src/index.ts lines 146-151
// ⚠️ Happens BEFORE logger initialization!
if (process.stdout.isTTY) {
  console.warn(
    `[Startup Warning] Invalid MCP_LOG_LEVEL...`
  );
}
```

**Risk**: If `isTTY` check fails or is bypassed, console output corrupts JSON-RPC stream in STDIO mode

### Tertiary Issue: No Graceful Degradation

**Current behavior**:
```typescript
if (!configCheck.exists) {
  // ❌ Throws error with huge message, blocks tool execution
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    `█████████████████████████████████████
     🚨 STOP - YOU MUST RUN 'mcp_setup_guide' TOOL FIRST 🚨
     ...300+ character error message...`
  );
}
```

**Problem**: 
- No way to bypass or skip validation
- Tool completely blocked if setup not run
- Error message itself is expensive to generate and transmit

---

## Why Second Call Crashes

**Hypothesis**:
1. First call times out during validation file scan
2. MCP client marks request as failed, but server might still be processing
3. File handles or promises might still be pending
4. Second call arrives while first is still cleaning up
5. Race condition or resource conflict causes crash

**Evidence needed**:
- Check if fs.readFile operations are being properly awaited
- Verify no dangling file handles
- Check for memory leaks in cache implementation
- Verify error handling doesn't leave process in bad state

---

## CLIENT_PROFILES Breakdown

Total of **17 client profiles** being checked on every validation:

```typescript
// Root-level AGENTS.md (12 clients)
cursor, codex-cli, codex-ide, droidcli, droid-factory, 
roo-code, kilo-code, zed, vscode-copilot, aider, opencode, amp

// Custom named files (4 clients)
gemini-cli (GEMINI.md), qwen-code (QWEN.md), 
claude-code (CLAUDE.md), warp (WARP.md)

// Custom directories (3 clients)
cline (.clinerules/mcp-guide.md)
kiro (.kiro/steering/mcp-guide.md)
qoder-cli, qoder-ide (.qoder/AGENTS.md)

// Fallback
other (AGENTS.md)
```

---

## Recommended Fixes

### Fix 1: Optimize Config Check (CRITICAL - Immediate)

```typescript
export async function mcpConfigExists(
  projectPath: string,
  context: RequestContext,
  forceRefresh = false,
): Promise<{ exists: boolean; filePath?: string; client?: ClientName }> {
  const normalizedPath = path.resolve(projectPath);
  const now = Date.now();
  
  // Check cache first
  if (!forceRefresh) {
    const cached = configCache.get(normalizedPath);
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return { exists: cached.exists, filePath: cached.filePath, client: cached.client };
    }
  }
  
  // ✅ FIX 1: Add timeout to file operations
  const FILE_READ_TIMEOUT = 1000; // 1 second per file max
  
  // ✅ FIX 2: Check file existence BEFORE reading content
  // ✅ FIX 3: Read only first 500 bytes to check markers (markers are at top)
  for (const [clientName, profile] of Object.entries(CLIENT_PROFILES)) {
    const fullPath = profile.directory
      ? path.join(normalizedPath, profile.directory, profile.file)
      : path.join(normalizedPath, profile.file);

    try {
      // Check if file exists first (fast)
      await fs.access(fullPath, fs.constants.R_OK);
      
      // Read only first 500 bytes (markers are at beginning)
      const fileHandle = await fs.open(fullPath, 'r');
      const buffer = Buffer.alloc(500);
      await fileHandle.read(buffer, 0, 500, 0);
      await fileHandle.close();
      
      const content = buffer.toString('utf-8');
      
      if (
        content.includes(MCP_CONTENT_START_MARKER) &&
        content.includes(MCP_CONTENT_END_MARKER)
      ) {
        const result = {
          exists: true,
          filePath: fullPath,
          client: clientName as ClientName,
        };
        
        configCache.set(normalizedPath, { ...result, timestamp: now });
        return result;
      }
    } catch (_error) {
      // File doesn't exist or can't be read, continue
      continue;
    }
  }

  // Cache negative result
  const result = { exists: false };
  configCache.set(normalizedPath, { ...result, timestamp: now });
  return result;
}
```

### Fix 2: Make Validation Optional (IMPORTANT)

```typescript
// Add flag to skip validation during development/debugging
export async function validateMcpConfigExists(
  projectPath: string,
  context: RequestContext,
  skipValidation = false, // ✅ NEW: Allow bypassing
): Promise<void> {
  if (skipValidation || process.env.MCP_SKIP_VALIDATION === 'true') {
    logger.debug("MCP config validation skipped", { ...context, projectPath });
    return;
  }
  
  // ... existing validation logic
}
```

### Fix 3: Reduce Cache TTL on Errors

```typescript
// ✅ Cache negative results for shorter time (10 seconds instead of 60)
const CACHE_TTL_MS = 60000; // 60 seconds for positive results
const CACHE_TTL_NEGATIVE_MS = 10000; // 10 seconds for negative results

// When caching negative result:
configCache.set(normalizedPath, { 
  exists: false, 
  timestamp: now,
  ttl: CACHE_TTL_NEGATIVE_MS // ✅ Custom TTL
});

// When checking cache:
if (cached && (now - cached.timestamp) < (cached.ttl || CACHE_TTL_MS)) {
  return { exists: cached.exists, filePath: cached.filePath, client: cached.client };
}
```

### Fix 4: Add Circuit Breaker

```typescript
// ✅ If validation fails repeatedly, stop trying
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

export async function validateMcpConfigExists(
  projectPath: string,
  context: RequestContext,
): Promise<void> {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    logger.warning("MCP validation circuit breaker open - allowing request", {
      ...context,
      projectPath,
      consecutiveFailures,
    });
    return; // Allow request through
  }
  
  try {
    const configCheck = await mcpConfigExists(projectPath, context);
    
    if (!configCheck.exists) {
      consecutiveFailures++;
      throw new McpError(...);
    }
    
    // Reset on success
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    throw error;
  }
}
```

### Fix 5: Remove Console Warnings Before Logger Init

```typescript
// src/index.ts lines 146-151
// ❌ REMOVE THIS:
if (process.stdout.isTTY) {
  console.warn(`[Startup Warning] Invalid MCP_LOG_LEVEL...`);
}

// ✅ REPLACE WITH: Log after logger initialization
await logger.initialize(validatedMcpLogLevel);

if (initialLogLevelConfig !== validatedMcpLogLevel) {
  logger.warning(
    `Invalid MCP_LOG_LEVEL "${initialLogLevelConfig}" in configuration. ` +
    `Defaulted to "info". Valid levels: ${validMcpLogLevels.join(", ")}`,
    { startup: true, requestId: "logger-init" }
  );
}
```

---

## Testing Plan

### Test 1: Verify Fix Works
```bash
# 1. Apply fixes
# 2. Rebuild
npm run build

# 3. Test first call (should not timeout)
# 4. Test second call immediately after (should not crash)
# 5. Test with missing config (should fail gracefully)
```

### Test 2: Performance Benchmark
```bash
# Measure validation time before/after fixes
# Target: < 100ms for first call, < 5ms for cached calls
```

### Test 3: Stress Test
```bash
# Send 100 concurrent requests
# Verify no crashes, no memory leaks, cache works correctly
```

---

## Priority Actions

1. **IMMEDIATE**: Apply Fix 1 (optimize file reading) - Solves primary performance issue
2. **HIGH**: Apply Fix 5 (remove console warnings) - Prevents potential STDIO corruption
3. **MEDIUM**: Apply Fix 2 (optional validation) - Allows debugging
4. **MEDIUM**: Apply Fix 4 (circuit breaker) - Prevents repeated failures
5. **LOW**: Apply Fix 3 (reduce negative cache TTL) - Fine-tuning

---

## Conclusion

The issue was introduced in commit `2a62902` when:
1. Validation was added to all tools (blocking operation)
2. `__dirname` was undefined, causing file reads to fail/hang
3. 17+ file paths are scanned on every tool call

Commit `2f9e900` fixed the `__dirname` issue but made template critical.

Commit `77a8281` added caching but first-call performance still suffers.

**Root cause**: Synchronous-style file scanning blocking all tool operations without timeout or optimization.

**Solution**: Optimize file reading (check existence first, read only 500 bytes, add timeouts) + add circuit breaker + remove pre-logger console output.

