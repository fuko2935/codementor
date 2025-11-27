# Changelog

## [5.2.13] - 2025-01-26

### 🚀 Enhanced: Autonomous Engineer Protocol v7.0

The `ignite` tool's MCP guide template has been upgraded to transform AI assistants from passive advisors to autonomous, quality-obsessed senior engineers.

#### New Features
- **Autonomous Work Loop (The Loop)**: AI now follows a continuous improvement cycle:
  - Phase 1: Strategic Analysis with automatic mode selection
  - Phase 2: Code implementation and user confirmation
  - Phase 3: Mandatory code review before completion
- **Intent Mapping**: Automatic analysis mode selection based on user intent
- **Recursive Perfection**: AI won't mark tasks complete until code passes review
- **Proactive Behavior**: Automatic git diff analysis after code changes

#### Key Behavioral Changes
- AI must run `insight` with `analysisMode: "review"` after user applies code
- No more "Great, anything else?" - AI validates changes first
- Loop continues until 100% error-free and compliant with project rules

### 📝 Migration
- Run `ignite` with `force: true` to update existing projects with the new protocol

## [5.2.12] - 2025-01-26

### 🎨 Branding: Tool Renaming

All MCP tools have been renamed for better clarity and memorability:

- `gemini_codebase_analyzer` → **`insight`** - Main codebase analysis tool
- `calculate_token_count` → **`weigh`** - Token counting utility
- `create_analysis_mode` → **`forge`** - Custom analysis mode management
- `project_bootstrap` → **`ignite`** - Project initialization

### 🔧 Changes
- Updated default LLM model to `gemini-3-pro-preview`
- Improved circular reference handling in log sanitization
- All tool registrations and documentation updated to reflect new names

### 📝 Migration
- Old tool names are no longer available
- Update any scripts or configurations using the old tool names

## [5.2.11] - 2025-01-25

### 🔧 Internal Improvements
- Intermediate build fixes and testing

## [5.2.10] - 2025-01-24

### 🔧 Build Fix

#### Critical: Rebuilt dist/ with Latest Changes
- **Fixed**: Previous v5.2.9 npm package had stale `dist/` files
- **Issue**: `npm run build` wasn't cleaning old compiled files, causing runtime to use old code
- **Solution**: Ran `npm run rebuild` to clean and recompile everything
- **Impact**: Now the published package actually contains the path validation fixes from v5.2.9

### 📦 Package Changes
- Package size reduced: 204.8 kB → 183.0 kB (cleaned build)
- File count reduced: 239 → 191 files (removed stale artifacts)

**Note:** If you installed v5.2.9, please update to v5.2.10 to get the actual fixes!

## [5.2.9] - 2025-01-24

### 🐛 Bug Fixes

#### Critical: Removed Redundant Path Validation in extractGitDiff
- **Fixed**: `extractGitDiff` no longer calls `validateSecurePath` which was causing false "Path traversal" errors
- **Root Cause**: Double validation - main analyzer validates path, then `extractGitDiff` re-validated with stricter rules
- **Solution**: Direct filesystem checks (null bytes, existence, directory type) without containment validation
- **Impact**: **COMPLETELY ELIMINATES** "Path traversal detected" errors when using `includeChanges` with external projects

### 🔧 Changes
- `extractGitDiff`: Replaced `validateSecurePath` call with direct `fs.stat()` checks
- Removed `validateSecurePath` and `BASE_DIR` imports from `gitDiffAnalyzer.ts`
- Maintains security: null byte prevention, existence checks, directory validation
- Allows analyzing ANY valid local git repository path

### 🧪 Testing
- All gitDiffAnalyzer tests passing ✅
- Verified with external project paths

## [5.2.8] - 2025-01-24

### 🐛 Bug Fixes

#### Critical Double-Slash Fix in sanitization.ts
- **Fixed**: Double-slash (`//`) issue in `sanitizePath` when root directory is `/`
- **Root Cause**: When `rootDir` or `currentWorkingDir` is `/`, adding `path.sep` created `//` causing path comparison failures
- **Solution**: Check if directory already ends with `path.sep` before appending
- **Impact**: Fixes path validation on Unix/Linux systems when using filesystem root

#### Enhanced Circular Reference Handling
- **Fixed**: `sanitizeForLogging` now uses `WeakSet` instead of `structuredClone`
- **Benefit**: Better handling of circular references, Error objects, and complex types
- **Result**: No more "[Log Sanitization Failed]" errors in logs

### 🔧 Changes
- `sanitizePath`: Fixed `rootDirWithSep` and `cwdWithSep` to avoid double-slash
- `sanitizeForLogging`: Replaced `structuredClone` with custom `WeakSet`-based clone function
- Both `rootDir` and `CWD` checks now handle filesystem root (`/`) correctly

### 🧪 Testing
- gitDiffAnalyzer tests: 10/10 passing ✅
- Core functionality verified on Unix systems

## [5.2.7] - 2025-01-24

### 🚀 Enhancements

#### Definitive Path Traversal Fix (Unlocked Local Access)
- **Removed**: Strict path containment check in `validateSecurePath`
- **Reason**: To allow seamless analysis of any local project directory (e.g., analyzing `/project-a` while running in `/project-b`)
- **Impact**: Path traversal errors ("attempts to escape the defined root directory") are **completely eliminated** for local usage
- **Security Note**: Basic validation (null bytes, empty paths) and existence checks remain. This is intended for local-first tools where the user explicitly provides the target path.

### 🔧 Changes
- `validateSecurePath`: Removed `isWithinBase` containment logic - now allows ANY valid local path
- `calculateTokenCountLogic`: Updated to explicitly resolve absolute paths before validation, aligning with `geminiCodebaseAnalyzer`
- `gitDiffAnalyzer`: Already uses filesystem root for validation
- `geminiCodebaseAnalyzer`: Already uses filesystem root for validation

### 🧪 Testing
- Added test to verify external paths are accepted
- Updated test descriptions to reflect relaxed security model
- All tests passing (10/10 in gitDiffAnalyzer.test.ts)

## [5.2.6] - 2025-01-24

### 🐛 Bug Fixes

#### Critical Path Validation Fix (Complete Solution)
- **Fixed**: Path traversal error preventing analysis of external projects
  - Changed path validation to use filesystem root instead of `process.cwd()`
  - Allows analyzing ANY valid directory on the system (e.g., `/home/user/project-a` from `/home/user/project-b`)
  - Simplified `validateSecurePath` to bypass overly restrictive `sanitizePath` checks
  - Fixed filesystem root handling to avoid double-slash issues on Unix systems
  - Maintains security by checking for null bytes and validating directory existence

### 🔧 Changes
- `extractGitDiff`: Now uses `path.parse(resolvedPath).root` as validation anchor
- `geminiCodebaseAnalyzerLogic`: Now uses `path.parse(resolvedPath).root` as validation anchor
- `validateSecurePath`: Simplified to perform basic security checks without CWD restrictions

### 🧪 Testing
- Updated test to check for null byte injection instead of relative path traversal
- All tests passing (9/9 in gitDiffAnalyzer.test.ts)

## [5.2.5] - 2025-01-24

### 🐛 Bug Fixes

#### Critical Path Validation Fix
- **Fixed**: Path traversal error in git diff analysis
  - Changed `extractGitDiff` to use `process.cwd()` instead of `BASE_DIR` for path validation
  - Aligns git diff security model with main analysis tool
  - Allows analyzing repositories outside the tool's installation directory
  - Fixes "Path traversal detected" error when using `includeChanges` with `revision: "."`

### 🧪 Testing
- Updated test descriptions to reflect `process.cwd()` usage
- All tests passing (9/9 in gitDiffAnalyzer.test.ts)

## [5.2.4] - 2025-01-21

### 🐛 Bug Fixes

#### Critical Stability Improvements
- **Fixed**: Memory leak in HTTP transport session management
  - Added session idle timeout (1 hour default)
  - Implemented automatic cleanup interval (5 minutes)
  - Added `lastActivity` tracking for all sessions
  - Process exit handlers for cleanup interval
- **Fixed**: Race condition in Redis rate limiter
  - Implemented atomic INCR+PEXPIRE using Lua script
  - Added fallback for environments without EVAL support
  - Prevents zombie keys without TTL
- **Fixed**: Command line argument limit (E2BIG) in git diff
  - Implemented batch processing (100 files per batch)
  - Added progress logging for large file sets
  - Prevents crashes on large changesets

#### High Priority Fixes
- **Fixed**: Deadlock risk in AsyncLock
  - Added timeout mechanism (60s default)
  - Implemented `LockTimeoutError` exception
  - Added queue monitoring methods (`getWaitQueueLength`, `isLocked`)
  - Automatic timer cleanup on lock release
- **Fixed**: Circular reference handling in log sanitization
  - Replaced `structuredClone` with WeakSet-based approach
  - Preserves context instead of losing all data
  - Handles Date, Error, Array objects gracefully

#### Medium Priority Fixes
- **Fixed**: Brittle marker detection in project bootstrap
  - Changed from strict equality to `includes()` for tolerance
  - More robust against whitespace variations
- **Fixed**: Silent Tree-sitter degradation
  - First failure now logs as warning instead of debug
  - Added hint about WASM file installation
  - Prevents spam with global flag
- **Fixed**: Gemini CLI authentication error messages
  - Detects 401/unauthenticated errors specifically
  - Provides actionable error message with login command
  - Uses structured `McpError` with hints

### 🔒 Security
- **Enhanced**: Session lifecycle management prevents resource exhaustion
- **Enhanced**: Atomic Redis operations prevent race conditions
- **Enhanced**: Better error messages don't leak sensitive information

### ⚡ Performance
- **Improved**: Git diff operations handle large changesets efficiently
- **Improved**: Lock timeout prevents indefinite blocking
- **Improved**: Reduced log noise from Tree-sitter failures

### 📚 Breaking Changes
- None - All changes are backward compatible

### 🎯 Migration Notes
- No action required - all improvements are automatic
- Optional: Configure session timeout via environment variables (future)
- Optional: Configure batch size for git operations (future)

---

## [5.1.0] - 2025-01-20

### ✨ New Features

#### `weigh` Tool
- **Added**: `includeChanges` parameter for git diff token counting
  - Support uncommitted changes with `revision: "."`
  - Support specific commits, branches, or commit ranges
  - Support last N commits with `count` parameter
  - Returns `gitDiffTokens` and `gitDiffCharacters` in response
  - Graceful degradation: continues without git diff if extraction fails
  - Perfect for planning code review analysis before running `insight`

#### `forge` Tool
- **Added**: `list` action to list all available analysis modes
  - Lists both standard and custom modes
  - Returns mode metadata (name, path, type, size)
  - Helps discover available analysis personas
- **Added**: `delete` action to remove custom analysis modes
  - Validates mode name to prevent path traversal
  - Returns deleted mode information
  - Enables cleanup of unused custom modes
- **Enhanced**: `create` action remains default for backward compatibility

### 🔒 Security
- **Fixed**: TOCTOU race condition in `delete` action (atomic `fs.unlink`)
- **Enhanced**: Strict regex validation for `modeName` (alphanumeric + dash/underscore only)
- **Verified**: All paths validated with `validateSecurePath`

### 📚 API Changes
- `weigh`: New optional `includeChanges` parameter
- `forge`: New optional `action` parameter (default: "create")
- All changes are backward compatible

### 🎯 Use Cases
```json
// Count tokens including uncommitted changes
{
  "projectPath": ".",
  "includeChanges": { "revision": "." }
}

// Count tokens for last 5 commits
{
  "projectPath": ".",
  "includeChanges": { "count": 5 }
}

// List all analysis modes
{
  "action": "list"
}

// Delete a custom mode
{
  "action": "delete",
  "modeName": "my-custom-mode"
}
```

### 📝 Documentation Updates
- **Updated**: All orchestrator references removed from documentation
- **Updated**: Error messages now suggest `.mcpignore` and subdirectory analysis
- **Updated**: Tool status tables reflect current active tools
- **Added**: v5.1.0 features documented in all relevant guides

## [5.0.1] - 2025-01-18

### 🔧 Bug Fixes
- **Fixed**: Removed all references to deleted orchestrator tools from error messages
- **Fixed**: Updated tool description to remove orchestrator references
- **Fixed**: Marked `autoOrchestrate`, `orchestratorThreshold`, `maxTokensPerGroup` as DEPRECATED in schema
- **Improved**: All error messages now provide clear guidance using `.mcpignore` and `temporaryIgnore`

## [5.0.0] - 2025-01-18

### 💥 BREAKING CHANGES
- **Removed**: `project_orchestrator_create` tool completely removed
- **Removed**: `project_orchestrator_analyze` tool completely removed
- **Removed**: `orchestrationService.ts` removed
- **Removed**: `autoOrchestrate` feature removed from `insight`

### 📝 Migration Guide
For large projects, use these alternatives:
1. **Use `.mcpignore`**: Add patterns to exclude unnecessary files (node_modules/, dist/, *.test.ts)
2. **Use `temporaryIgnore`**: Exclude files for specific analysis
3. **Analyze subdirectories**: Focus on specific parts of your project

### 🎯 Rationale
- Simplified codebase by removing complex orchestration logic
- Reduced maintenance burden
- Clearer user experience with explicit file exclusion
- Removed 1,675 lines of code

## [4.2.0] - 2025-01-18 (Deprecated)

### ⚠️ This version was superseded by v5.0.0

### 🚀 Major Enhancement: Integrated Project Orchestration (REMOVED IN v5.0.0)

**Unified Analysis Workflow**
- **✨ Integrated Orchestration**: `insight` now includes built-in orchestration capabilities for large projects
- **🔄 Seamless User Experience**: Users no longer need separate tools for large project analysis - single tool handles everything
- **🎯 Smart Decision Logic**: Tool automatically determines when to use orchestration based on project size and user preferences
- **⚡ Manual Override**: Set `orchestratorThreshold: 0` to force orchestration for any project size

**New Parameters**
- `autoOrchestrate`: When `true`, automatically uses orchestration for projects exceeding token limits
- `orchestratorThreshold`: Controls when to trigger orchestration (0-0.95, default 0.75)
- `maxTokensPerGroup`: Optional token limit per orchestration group (default ~1M)

**Deprecations**
- ⚠️ **`project_orchestrator_create`** tool marked as deprecated - use `insight` with `autoOrchestrate=true`
- ⚠️ **`project_orchestrator_analyze`** tool marked as deprecated - functionality now integrated into main analyzer
- Both tools will show deprecation warnings and recommend the new integrated approach

**Technical Improvements**
- **Service Architecture**: Created `orchestrationService.ts` for reusable orchestration logic
- **Enhanced Decision Logic**: Projects near threshold receive recommendations, very large projects trigger automatic orchestration
- **Backward Compatibility**: Existing `project_orchestrator_*` tools still functional but show warnings
- **Schema Validation**: Updated `orchestratorThreshold` to accept `0` for manual orchestration forcing

**Migration Path**
- **Old**: Use `project_orchestrator_create` → `project_orchestrator_analyze` separately
- **New**: Use `insight({ autoOrchestrate: true })` for seamless integration

**Testing**
- Added comprehensive test coverage for integrated orchestration functionality
- Added deprecation warning tests for orchestration tools
- Enhanced schema validation tests for new parameters

### 🔧 Technical: Created Orchestration Service
- **New**: `src/mcp-server/services/orchestrationService.ts` - unified orchestration logic
- **Extracted**: Group creation and analysis logic from separate tools
- **Reusable**: Service can be used across multiple tools and contexts

### 📝 Documentation Updates
- **README.md**: Updated to reflect new integrated workflow
- **Auto-Orchestration Section**: Expanded with clear examples and migration guidance
- **User Experience**: Simplified - users now only need one tool regardless of project size

## [4.1.2] - 2025-01-17