---
inclusion: always
---

# MCP Developer Guide - CodeMentor

**Complete MCP development reference for the CodeMentor project.**

This guide consolidates all MCP development standards, patterns, and guidelines optimized for AI assistant context loading.

---

## AI Assistant Instructions

You are an expert developer working on the CodeMentor codebase. Follow these core principles:

1. **Follow established patterns** - Don't invent new patterns when existing ones work
2. **Prioritize security** - Path validation (`validateSecurePath` + `BASE_DIR`) is mandatory
3. **Write minimal code** - Only what's needed to solve the problem
4. **Test thoroughly** - Include tests for both success and error cases
5. **Document clearly** - JSDoc on all exports

**Core Architecture:**
- Logic throws `McpError`, handlers catch and format
- All inputs validated with Zod schemas
- Structured logging with sanitized context
- Request context propagated through all operations

---

## Quick Navigation

**Getting Started:**
- [Product Overview](#product-overview) - What we're building
- [Architecture](#architecture) - Codebase organization
- [Development Patterns](#development-patterns) - Core patterns

**Development:**
- [Adding a Tool](#adding-a-new-tool) - Complete workflow
- [Security](#security-practices) - Path validation, sanitization
- [Error Handling](#error-handling) - Error codes and patterns

**Reference:**
- [Error Codes](#error-codes-reference) - Complete error code table
- [Security Checklist](#security-checklist) - Pre-deployment verification
- [Tool Checklist](#tool-checklist) - Pre-submission verification

---

## Product Overview

CodeMentor is a lightweight Model Context Protocol (MCP) server for local-first AI-powered codebase analysis.

**Core Capabilities:**
- Codebase Analysis with AI-powered insights
- Code Review via Git diff integration
- Project Orchestration for large codebases
- Token Management for Gemini models
- Multi-Transport (STDIO/HTTP)

**Key Differentiators:**
- Local-first (no external services)
- Flexible Authentication (OAuth/API key)
- Security Focused (path traversal protection, input sanitization, rate limiting)

---

## Architecture

### Project Structure

```
src/
├── config/            # Environment configuration
├── mcp-server/        # MCP server implementation
│   ├── tools/        # Tool implementations
│   ├── transports/   # STDIO/HTTP transports
│   └── utils/        # Server-specific utilities
├── services/          # External service integrations (LLM providers)
├── utils/             # Shared utilities (logging, security, parsing)
└── index.ts           # Entry point

dist/                  # Compiled output
tests/                 # Unit tests
```

### Core Technologies

- **Runtime**: Node.js ≥20.0.0
- **Language**: TypeScript 5.8+ (strict mode, ES2020)
- **Module System**: ESNext with ESM exports
- **Build Tool**: TypeScript compiler (tsc)

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP implementation
- `@google/generative-ai` - Gemini API client
- `zod` - Schema validation
- `winston` - Structured logging
- `web-tree-sitter` - AST parsing

### Tool Implementation Pattern

```
tools/toolName/
├── logic.ts           # Pure business logic (throws McpError)
├── registration.ts    # Zod schema + handler registration
└── index.ts           # Public exports
```

**Key Principles:**
- Separation of Concerns (logic separate from registration)
- Logic Throws, Handlers Catch
- Schema-First (Zod schemas define inputs)
- Testable (pure logic functions)

---

## Development Patterns

### 1. Logic Throws, Handlers Catch

**Logic Layer (`logic.ts`):**
- Contains pure business logic
- MUST throw `McpError` on failure
- MUST accept `RequestContext` as last parameter

**Handler Layer (`registration.ts`):**
- Wraps logic in try-catch
- Processes errors via `ErrorHandler.handleError()`
- Formats responses as `CallToolResult`

```typescript
// logic.ts - THROWS
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  if (!params.valid) {
    throw new McpError(BaseErrorCode.VALIDATION_ERROR, "Invalid input");
  }
  return { result: "success" };
}

// registration.ts - CATCHES
export const registerMyTool = async (server: McpServer) => {
  server.tool(name, description, schema, async (params) => {
    const context = requestContextService.createRequestContext({...});
    try {
      const result = await myToolLogic(params, context);
      return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
    } catch (error) {
      const handled = ErrorHandler.handleError(error, {...});
      return { content: [{ type: "text", text: JSON.stringify({error: {...}}) }], isError: true };
    }
  });
};
```

### 2. Schema-First Development

**All inputs MUST be validated with Zod:**

```typescript
export const MyToolInputSchema = z.object({
  projectPath: z.string().min(1).describe("Path to project directory"),
  option: z.enum(["a", "b"]).describe("Processing option")
});

export type MyToolInput = z.infer<typeof MyToolInputSchema>;
```

### 3. Request Context Propagation

**Every operation MUST:**
1. Create `RequestContext` at entry point
2. Pass context through all function calls
3. Include context in all log statements

```typescript
const context = requestContextService.createRequestContext({
  userId: mcpContext?.userId,
  clientId: mcpContext?.clientId,
  operation: "my_tool"
});

logger.info("Starting operation", { ...context, params });
```

### 4. Structured Logging

```typescript
// ✅ CORRECT
logger.info("Operation started", {
  ...context,
  operation: "my_operation",
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG
console.log("Something happened");
```

---

## Security Practices

### Path Security (CRITICAL)

**All file system operations MUST be constrained to BASE_DIR:**

```typescript
import { BASE_DIR } from "../../../index.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";

// ✅ CORRECT
const validPath = validateSecurePath(params.projectPath, BASE_DIR);
const files = fs.readdirSync(validPath);

// ❌ WRONG - Security vulnerability
const files = fs.readdirSync(params.projectPath);
```

**Path Validation Rules:**
1. Non-empty
2. No null bytes
3. No absolute paths
4. No traversal (`..` segments blocked)
5. Within BASE_DIR

### Input Sanitization

**Always sanitize before logging:**

```typescript
// ✅ CORRECT
logger.info("User input", {
  ...context,
  params: sanitization.sanitizeForLogging(params)  // Redacts secrets
});

// ❌ WRONG
logger.info("User input", { ...context, params });  // May leak API keys
```

**Automatically redacted fields:**
`password`, `token`, `secret`, `key`, `apiKey`, `access_key`, `secret_key`, `api_token`, `authorization`, `jwt`

### Secrets Management

**NEVER hardcode secrets:**

```typescript
// ❌ WRONG
const apiKey = "sk-1234567890";

// ✅ CORRECT
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
```

### Security Checklist

- [ ] All paths validated with `validateSecurePath`
- [ ] All inputs validated with Zod schemas
- [ ] Secrets from environment variables
- [ ] Sensitive data sanitized before logging
- [ ] No hardcoded secrets or paths

---

## Error Handling

### Error Hierarchy

```
McpError
├── VALIDATION_ERROR (400)
├── UNAUTHORIZED (401)
├── FORBIDDEN (403)
├── RESOURCE_NOT_FOUND (404)
├── RATE_LIMITED (429)
├── EXTERNAL_SERVICE_ERROR (502)
├── CONFIGURATION_ERROR (500)
└── INTERNAL_ERROR (500)
```

### Error Codes Reference

| Code | HTTP | Usage | Example |
|------|------|-------|---------|
| `VALIDATION_ERROR` | 400 | Invalid input, schema violations | Empty required field, path traversal |
| `UNAUTHORIZED` | 401 | Missing/invalid credentials | Missing API key, invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions | Missing required scope |
| `RESOURCE_NOT_FOUND` | 404 | Resource doesn't exist | File not found, git repo not found |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Too many requests |
| `EXTERNAL_SERVICE_ERROR` | 502 | External API failures | LLM API error, network timeout |
| `CONFIGURATION_ERROR` | 500 | Invalid configuration | Missing required config |
| `INTERNAL_ERROR` | 500 | Unexpected errors | Programming errors |

**UNAUTHORIZED vs FORBIDDEN:**
- **UNAUTHORIZED (401)**: "I don't know who you are" - Authentication failed
- **FORBIDDEN (403)**: "I know who you are, but you can't do that" - Authorization failed

### Error Usage Examples

```typescript
// Validation error
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Project path cannot be empty"
);

// Authentication error
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "API key not configured",
  { provider: "gemini", envVar: "GOOGLE_API_KEY" }
);

// Authorization error
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "Insufficient permissions",
  { required: ["codebase:read"], provided: ["basic:read"] }
);

// Resource not found
throw new McpError(
  BaseErrorCode.RESOURCE_NOT_FOUND,
  "Project directory not found",
  { path: validatedPath }
);
```

---

## Adding a New Tool

### Prerequisites

1. Run `project_bootstrap` for your AI client
2. Review existing tools for patterns
3. Identify required dependencies

### Step-by-Step Workflow

#### 1. Create Directory Structure

```bash
mkdir -p src/mcp-server/tools/myTool
touch src/mcp-server/tools/myTool/{index.ts,logic.ts,registration.ts}
```

#### 2. Define Schema and Logic (`logic.ts`)

```typescript
import { z } from "zod";
import { logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { BASE_DIR } from "../../../index.js";

export const MyToolInputSchema = z.object({
  projectPath: z.string().min(1).describe("Path to project directory"),
  option: z.enum(["fast", "thorough"]).default("fast").describe("Analysis mode")
});

export type MyToolInput = z.infer<typeof MyToolInputSchema>;

export interface MyToolResponse {
  summary: string;
  results: Array<{ file: string; score: number }>;
}

export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  logger.info("Starting analysis", { ...context });

  // MANDATORY: Validate path
  const validPath = validateSecurePath(params.projectPath, BASE_DIR);
  
  if (!fs.existsSync(validPath)) {
    throw new McpError(
      BaseErrorCode.RESOURCE_NOT_FOUND,
      "Project directory not found",
      { path: params.projectPath }
    );
  }

  // Business logic
  const results = await analyzeProject(validPath, params.option);
  
  return {
    summary: `Analyzed ${results.length} files`,
    results
  };
}
```

#### 3. Implement Registration (`registration.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorHandler, logger, requestContextService, sanitization } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { MyToolInputSchema, myToolLogic } from "./logic.js";

export const registerMyTool = async (server: McpServer): Promise<void> => {
  server.tool("my_tool", "Analyzes project structure", MyToolInputSchema.shape, async (params, mcpContext) => {
    const context = requestContextService.createRequestContext({
      userId: mcpContext?.userId,
      clientId: mcpContext?.clientId,
      operation: "my_tool"
    });

    try {
      const result = await myToolLogic(params, context);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false
      };
    } catch (error) {
      const handled = ErrorHandler.handleError(error, { operation: "my_tool", context, params: sanitization.sanitizeForLogging(params) });
      const mcpError = handled instanceof McpError ? handled : new McpError(BaseErrorCode.INTERNAL_ERROR, "Unexpected error");
      
      logger.error("Tool failed", { ...context, error: mcpError.code, message: mcpError.message });
      
      return {
        content: [{ type: "text", text: JSON.stringify({ error: { code: mcpError.code, message: mcpError.message, details: mcpError.details } }, null, 2) }],
        isError: true
      };
    }
  });
};
```

#### 4. Create Barrel File (`index.ts`)

```typescript
export { registerMyTool } from "./registration.js";
```

#### 5. Register in Server

Edit `src/mcp-server/server.ts`:

```typescript
import { registerMyTool } from "./tools/myTool/index.js";

// In createMcpServerInstance:
await registerMyTool(server);
```

#### 6. Write Tests

```typescript
import { describe, it, expect } from "vitest";
import { myToolLogic } from "./logic.js";

describe("myToolLogic", () => {
  it("should throw VALIDATION_ERROR for empty path", async () => {
    await expect(myToolLogic({ projectPath: "" }, mockContext))
      .rejects.toMatchObject({ code: BaseErrorCode.VALIDATION_ERROR });
  });

  it("should analyze valid project", async () => {
    const result = await myToolLogic({ projectPath: "." }, mockContext);
    expect(result).toHaveProperty("summary");
  });
});
```

### Tool Checklist

- [ ] Directory structure: `tools/myTool/{index,logic,registration}.ts`
- [ ] Zod schema with `.describe()` on all fields
- [ ] Logic throws `McpError` on failure
- [ ] Registration wraps logic in try-catch
- [ ] All paths validated with `validateSecurePath`
- [ ] `RequestContext` created and propagated
- [ ] Structured logging with context
- [ ] JSDoc on all exports
- [ ] Unit tests for logic
- [ ] Tool registered in `server.ts`
- [ ] No console.log statements
- [ ] No hardcoded secrets

---

## Common Commands

```bash
# Development
npm run build              # Compile TypeScript
npm run start:local        # Run with ts-node
npm start                  # Run compiled CLI (STDIO)
npm run start:http         # Run with HTTP transport

# Testing
npm test                   # Run tests
npm test -- --coverage     # With coverage
npm test -- --watch        # Watch mode

# Code Quality
npm run lint               # Run ESLint
npm run format             # Format with Prettier
```

---

## Maintaining This Guide

**When code changes affect patterns or conventions, this guide MUST be updated.**

### When to Update

**MANDATORY updates:**
1. Adding/changing patterns
2. Adding/changing security requirements
3. Modifying project structure
4. Changing error handling patterns
5. Adding/modifying workflows
6. Updating technology stack
7. Changing configuration requirements

### Update Process

1. Make code changes
2. Identify affected sections in this guide
3. Update relevant content
4. Review for consistency
5. Test documentation
6. Commit code and docs together

### Commit Message Format

```
feat(tools): add new validation pattern

- Implement validateGitRevision utility
- Add security checks for git commands
- Update DEVELOPER_GUIDE.md with new pattern
```

**Remember:** If you change the code, update the docs. If you update the docs, test the code.

---

**End of Developer Guide**
