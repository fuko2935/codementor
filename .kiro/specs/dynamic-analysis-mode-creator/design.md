# Design Document

## Overview

The `create_analysis_mode` tool provides a unified interface for creating expert system prompts through three distinct modes: manual definition, AI-assisted generation, and project-specific AI generation. The tool integrates with the existing `gemini_codebase_analyzer` by producing prompts compatible with its `customExpertPrompt` parameter.

## Architecture

### High-Level Flow

```
User Input → Validation → Mode Detection → Processing → Structured Output
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
              Manual Mode          AI-Assisted Mode
              (Direct Use)              ↓
                                  ┌─────┴─────┐
                                  ↓           ↓
                            General      Project-Specific
                            (Hint Only)  (Hint + Context)
```

### Tool Location

```
src/mcp-server/tools/createAnalysisMode/
├── index.ts           # Barrel export
├── logic.ts           # Core business logic
└── registration.ts    # MCP registration
```

## Components and Interfaces

### Input Schema (Zod)

```typescript
export const CreateAnalysisModeInputSchema = z.object({
  expertiseHint: z.string()
    .min(1, "Expertise hint cannot be empty")
    .describe("Mode description. If withAi=false, used directly as prompt. If withAi=true, used as AI hint."),
  
  withAi: z.boolean()
    .optional()
    .default(false)
    .describe("Whether to use AI for mode generation. Default: false (manual mode)."),
  
  projectPath: z.string()
    .min(1)
    .optional()
    .describe("Project path for project-specific mode generation. Only used when withAi=true."),
  
  geminiApiKey: z.string()
    .min(1)
    .optional()
    .describe("Optional Gemini API key override."),
  
  temporaryIgnore: z.array(z.string())
    .optional()
    .describe("Additional ignore patterns for this run only.")
});

export type CreateAnalysisModeInput = z.infer<typeof CreateAnalysisModeInputSchema>;
```

### Output Interface

```typescript
export interface CreateAnalysisModeResponse {
  modeType: "manual" | "ai_generated" | "ai_project_generated";
  analysisModePrompt: string;
  sourceHint: string;
}
```

### Core Logic Function

```typescript
export async function createAnalysisModeLogic(
  params: CreateAnalysisModeInput,
  context: RequestContext
): Promise<CreateAnalysisModeResponse>
```

## Data Models

### Mode Type Enum

```typescript
type ModeType = "manual" | "ai_generated" | "ai_project_generated";
```

### AI Prompt Templates

**General Mode Template:**
```
You are an expert system prompt generator. Based on the user's hint: "{expertiseHint}", 
create the best possible expert system prompt for analyzing a codebase. The prompt should 
define the expert's role, focus areas, and analysis approach.
```

**Project-Specific Mode Template:**
```
You are an expert system prompt generator. Based on the project context below and the 
user's hint: "{expertiseHint}", create the best possible expert system prompt for 
analyzing this specific codebase.

Project Context:
{projectContext}

The prompt should reference project-specific patterns, architecture, and conventions.
```

## Error Handling

### Error Scenarios

| Scenario | Error Code | Details |
|----------|-----------|---------|
| Empty expertiseHint | VALIDATION_ERROR | Field is required |
| Invalid projectPath | VALIDATION_ERROR | Path traversal or invalid format |
| Project not found | NOT_FOUND | Directory does not exist |
| AI service failure | SERVICE_UNAVAILABLE | Gemini API error |
| Missing API key | UNAUTHORIZED | API key not configured |

### Error Response Format

```typescript
{
  error: {
    code: BaseErrorCode,
    message: string,
    details?: Record<string, unknown>
  }
}
```

## Processing Logic

### Mode Detection Algorithm

```typescript
function detectMode(params: CreateAnalysisModeInput): ModeType {
  if (!params.withAi) {
    return "manual";
  }
  
  if (params.projectPath) {
    return "ai_project_generated";
  }
  
  return "ai_generated";
}
```

### Manual Mode Processing

1. Validate `expertiseHint` is non-empty
2. Return `expertiseHint` directly as `analysisModePrompt`
3. Set `modeType` to "manual"
4. No AI invocation

### AI-Assisted Mode Processing

1. Validate `expertiseHint` is non-empty
2. Construct AI prompt with general template
3. Invoke Gemini API with prompt
4. Extract generated prompt from AI response
5. Set `modeType` to "ai_generated"
6. Return structured response

### Project-Specific Mode Processing

1. Validate `expertiseHint` and `projectPath`
2. Validate path with `validateSecurePath(projectPath, BASE_DIR)`
3. Check directory exists
4. Read project context using `prepareFullContext`
5. Construct AI prompt with project-specific template
6. Invoke Gemini API with prompt and context
7. Extract generated prompt from AI response
8. Set `modeType` to "ai_project_generated"
9. Return structured response

## Integration with gemini_codebase_analyzer

### Workflow

```
Step 1: Create Mode
User → create_analysis_mode → {analysisModePrompt}

Step 2: Use Mode
User → gemini_codebase_analyzer(customExpertPrompt: analysisModePrompt)
```

### Example Integration

```json
// Step 1: Create mode
{
  "tool_name": "create_analysis_mode",
  "params": {
    "expertiseHint": "Create a security-focused code reviewer",
    "withAi": true,
    "projectPath": "."
  }
}

// Response
{
  "modeType": "ai_project_generated",
  "analysisModePrompt": "You are a security expert familiar with this project's architecture...",
  "sourceHint": "Create a security-focused code reviewer"
}

// Step 2: Use in analyzer
{
  "tool_name": "gemini_codebase_analyzer",
  "params": {
    "projectPath": ".",
    "question": "Find security vulnerabilities",
    "customExpertPrompt": "You are a security expert familiar with this project's architecture..."
  }
}
```

## Security Considerations

### Path Validation

- All `projectPath` values MUST be validated with `validateSecurePath`
- Paths MUST be relative to `BASE_DIR`
- Path traversal attempts MUST be rejected with VALIDATION_ERROR

### Input Sanitization

- All parameters MUST be sanitized before logging
- API keys MUST be redacted in logs
- Use `sanitization.sanitizeForLogging(params)`

### Request Context

- Every operation MUST create and propagate `RequestContext`
- Context MUST include: requestId, userId, clientId, operation
- All log statements MUST include context

## Dependencies

### External Services

- **Gemini API**: Required for AI-assisted modes (withAi=true)
- **File System**: Required for project-specific mode

### Internal Utilities

- `validateSecurePath` from `src/mcp-server/utils/securePathValidator.ts`
- `prepareFullContext` from `src/mcp-server/utils/contextBuilder.ts`
- `logger` from `src/utils/internal/logger.ts`
- `sanitization` from `src/utils/security/sanitization.ts`
- `requestContextService` from `src/utils/internal/requestContext.ts`
- `ErrorHandler` from `src/utils/internal/errorHandler.ts`

### LLM Provider

- Use `modelFactory.createModelByProvider()` for Gemini access
- Respect `config.LLM_DEFAULT_PROVIDER` and `config.LLM_DEFAULT_MODEL`
- Handle API key from `config.GOOGLE_API_KEY` or `params.geminiApiKey`

## Performance Considerations

### Token Limits

- Project context reading respects existing token limits
- Use `.mcpignore` patterns via `temporaryIgnore` parameter
- No additional token limit enforcement (handled by context builder)

### Caching

- No caching implemented (stateless operation)
- Each invocation generates fresh output

### Timeouts

- AI requests inherit default Gemini API timeout
- No custom timeout configuration

## Deprecation Strategy

### Affected Tools

- `gemini_dynamic_expert_create`: Superseded by this tool
- `gemini_dynamic_expert_analyze`: Functionality merged into `gemini_codebase_analyzer`

### Migration Path

1. Mark old tools as deprecated in documentation
2. Update examples to use new tool
3. Maintain backward compatibility for 1 major version
4. Remove old tools in next major version

### Backward Compatibility

- Old tools remain functional during deprecation period
- No breaking changes to `gemini_codebase_analyzer`
- New tool uses different name to avoid conflicts
