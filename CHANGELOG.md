# Changelog

## [Unreleased]

### 🚀 Major Enhancement: Integrated Project Orchestration

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