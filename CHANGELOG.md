# Changelog

## [5.1.0] - 2025-11-20

### ✨ New Features

#### `calculate_token_count` Tool
- **Added**: `includeChanges` parameter for git diff token counting
  - Support uncommitted changes with `revision: "."`
  - Support specific commits, branches, or commit ranges
  - Support last N commits with `count` parameter
  - Returns `gitDiffTokens` and `gitDiffCharacters` in response
  - Graceful degradation: continues without git diff if extraction fails

#### `create_analysis_mode` Tool
- **Added**: `list` action to list all available analysis modes
  - Lists both standard and custom modes
  - Returns mode metadata (name, path, type, size)
- **Added**: `delete` action to remove custom analysis modes
  - Validates mode name to prevent path traversal
  - Returns deleted mode information
- **Enhanced**: `create` action remains default for backward compatibility

### 🔒 Security
- **Fixed**: TOCTOU race condition in `delete` action (atomic `fs.unlink`)
- **Enhanced**: Strict regex validation for `modeName` (alphanumeric + dash/underscore only)
- **Verified**: All paths validated with `validateSecurePath`

### 📚 API Changes
- `calculate_token_count`: New optional `includeChanges` parameter
- `create_analysis_mode`: New optional `action` parameter (default: "create")
- All changes are backward compatible

### 🎯 Use Cases
```json
// Count tokens including uncommitted changes
{
  "projectPath": ".",
  "includeChanges": { "revision": "." }
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
- **Removed**: `autoOrchestrate` feature removed from `gemini_codebase_analyzer`

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
- **✨ Integrated Orchestration**: `gemini_codebase_analyzer` now includes built-in orchestration capabilities for large projects
- **🔄 Seamless User Experience**: Users no longer need separate tools for large project analysis - single tool handles everything
- **🎯 Smart Decision Logic**: Tool automatically determines when to use orchestration based on project size and user preferences
- **⚡ Manual Override**: Set `orchestratorThreshold: 0` to force orchestration for any project size

**New Parameters**
- `autoOrchestrate`: When `true`, automatically uses orchestration for projects exceeding token limits
- `orchestratorThreshold`: Controls when to trigger orchestration (0-0.95, default 0.75)
- `maxTokensPerGroup`: Optional token limit per orchestration group (default ~900k)

**Deprecations**
- ⚠️ **`project_orchestrator_create`** tool marked as deprecated - use `gemini_codebase_analyzer` with `autoOrchestrate=true`
- ⚠️ **`project_orchestrator_analyze`** tool marked as deprecated - functionality now integrated into main analyzer
- Both tools will show deprecation warnings and recommend the new integrated approach

**Technical Improvements**
- **Service Architecture**: Created `orchestrationService.ts` for reusable orchestration logic
- **Enhanced Decision Logic**: Projects near threshold receive recommendations, very large projects trigger automatic orchestration
- **Backward Compatibility**: Existing `project_orchestrator_*` tools still functional but show warnings
- **Schema Validation**: Updated `orchestratorThreshold` to accept `0` for manual orchestration forcing

**Migration Path**
- **Old**: Use `project_orchestrator_create` → `project_orchestrator_analyze` separately
- **New**: Use `gemini_codebase_analyzer({ autoOrchestrate: true })` for seamless integration

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