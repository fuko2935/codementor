# forge Tool

The `forge` tool enables you to create custom expert system prompts for specialized code analysis. It supports three modes: manual definition, AI-assisted generation, and project-specific AI generation.

## Two-Step Workflow

**Step 1: Create the Analysis Mode**

Use `forge` to generate a custom expert prompt:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "Create a security-focused code reviewer",
    "withAi": true,
    "projectPath": "."
  }
}
```

**Response:**
```json
{
  "modeType": "ai_project_generated",
  "analysisModePrompt": "You are a security expert familiar with this project's architecture...",
  "sourceHint": "Create a security-focused code reviewer"
}
```

**Step 2: Use in Codebase Analyzer**

Pass the generated prompt to `insight`:

```json
{
  "tool_name": "insight",
  "params": {
    "projectPath": ".",
    "question": "Find security vulnerabilities",
    "customExpertPrompt": "You are a security expert familiar with this project's architecture..."
  }
}
```

## Mode Examples

### 1. Manual Mode (Direct Control)

Provide your own expert prompt without AI assistance:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "You are a React performance expert. Focus on identifying unnecessary re-renders, inefficient hooks usage, and bundle size issues.",
    "withAi": false
  }
}
```

**Use case:** When you have a specific prompt template or want complete control over the expert persona.

### 2. AI-Assisted General Mode

Let AI generate a general expert prompt based on your hint:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "Create an accessibility expert focused on WCAG compliance",
    "withAi": true
  }
}
```

**Use case:** Quick generation of expert prompts without project-specific context.

### 3. Project-Specific Mode (Recommended)

AI analyzes your project and creates a tailored expert prompt:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "Create a database optimization expert",
    "withAi": true,
    "projectPath": ".",
    "temporaryIgnore": ["tests/**", "docs/**"]
  }
}
```

**Use case:** Best for project-specific analysis where the expert should understand your codebase's architecture, patterns, and conventions.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expertiseHint` | string | Yes | Mode description. Used directly as prompt if `withAi=false`, or as hint for AI generation if `withAi=true` |
| `withAi` | boolean | No | Whether to use AI for mode generation (default: `false`) |
| `projectPath` | string | No | Project path for project-specific mode generation (only used when `withAi=true`) |
| `returnFormat` | enum | No | Response format: `"json"` (default) returns full structured response, `"prompt_only"` returns only the prompt text for easier chaining |
| `geminiApiKey` | string | No | Optional Gemini API key override |
| `temporaryIgnore` | string[] | No | Additional ignore patterns for this run only |

## Response Format

### JSON Format (default)

```typescript
{
  "modeType": "manual" | "ai_generated" | "ai_project_generated",
  "analysisModePrompt": string,  // The expert prompt to use
  "sourceHint": string            // Original expertiseHint
}
```

### Prompt-Only Format

When `returnFormat: "prompt_only"` is specified, the tool returns only the prompt text directly:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "Create a security expert",
    "withAi": true,
    "returnFormat": "prompt_only"
  }
}
```

**Response:** (plain text)
```
You are a security expert specialized in identifying vulnerabilities...
```

This format is useful for:
- Direct piping to other tools
- Simplified tool chaining
- Reduced parsing overhead

## Integration with insight

The generated `analysisModePrompt` can be used with the `customExpertPrompt` parameter:

```json
{
  "tool_name": "insight",
  "params": {
    "projectPath": ".",
    "question": "Your analysis question",
    "customExpertPrompt": "<generated-prompt-from-forge>"
  }
}
```

This allows you to:
- Create reusable expert personas for different analysis types
- Combine project-specific knowledge with specialized expertise
- Maintain consistent analysis approaches across team members

## Best Practices

1. **Use Project-Specific Mode** when analyzing a specific codebase for the most relevant insights
2. **Cache Generated Prompts** for reuse across multiple analyses
3. **Combine with `.mcpignore`** to focus the project context on relevant files
4. **Use `returnFormat: "prompt_only"`** when chaining tools for simpler integration
5. **Iterate on `expertiseHint`** to refine the generated expert persona

## Error Handling

The tool throws structured errors for common issues:

- `VALIDATION_ERROR`: Invalid input parameters
- `UNAUTHORIZED`: Missing API key (AI modes)
- `NOT_FOUND`: Project directory doesn't exist (project-specific mode)
- `SERVICE_UNAVAILABLE`: Gemini API call failed (AI modes)

All errors include detailed context for troubleshooting.
