---
inclusion: always
---

# Development Patterns & Conventions

This document defines mandatory development patterns, coding conventions, and architectural standards for the CodeMentor project. All code contributions must adhere to these patterns.

## Core Design Principles

### 1. Logic Throws, Handlers Catch

This is the cornerstone of our error-handling architecture.

**Logic Layer (`logic.ts`):**
- Contains pure business logic only
- MUST throw structured `McpError` on failure
- MUST NOT contain try-catch blocks for response formatting
- MUST be testable in isolation
- MUST accept `RequestContext` as the last parameter

**Handler Layer (`registration.ts`):**
- Wraps logic calls in try-catch blocks
- Processes errors via `ErrorHandler.handleError()`
- Formats responses as `CallToolResult`
- Manages MCP protocol concerns

**Example:**
```typescript
// logic.ts - THROWS on error
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  if (!params.valid) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Invalid input"
    );
  }
  return { result: "success" };
}

// registration.ts - CATCHES and formats
export const registerMyTool = async (server: McpServer) => {
  server.tool(name, description, schema, async (params) => {
    const context = requestContextService.createRequestContext({...});
    try {
      const result = await myToolLogic(params, context);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false
      };
    } catch (error) {
      const handled = ErrorHandler.handleError(error, {...});
      return {
        content: [{ type: "text", text: JSON.stringify({error: {...}}) }],
        isError: true
      };
    }
  });
};
```

### 2. Separation of Concerns

**Module Boundaries:**
- `src/utils/` - Generic, reusable utilities (logging, security, parsing)
- `src/mcp-server/utils/` - Server-specific utilities (code parsing, git analysis)
- `src/mcp-server/tools/` - Tool implementations (registration + logic)
- `src/services/` - External service integrations (LLM providers)
- `src/config/` - Configuration management (single source of truth)

**Tool Structure (MANDATORY):**
```
tools/myTool/
├── index.ts         # Barrel file: exports registerMyTool only
├── logic.ts         # Schema, types, and pure business logic
└── registration.ts  # MCP registration and error handling
```

### 3. Schema-First Development

**All inputs MUST be validated with Zod:**
```typescript
// Define schema with descriptions for AI assistants
export const MyToolInputSchema = z.object({
  projectPath: z.string()
    .min(1)
    .describe("Absolute path to the project directory"),
  option: z.enum(["a", "b"])
    .describe("Processing option: a for X, b for Y")
});

// Infer TypeScript types from schema
export type MyToolInput = z.infer<typeof MyToolInputSchema>;
```

**Benefits:**
- Runtime validation prevents invalid data
- Type safety via `z.infer`
- Self-documenting via `.describe()`
- Automatic JSON Schema generation for MCP

### 4. Request Context Propagation

**Every operation MUST:**
1. Create a `RequestContext` at the entry point
2. Pass context through all function calls
3. Include context in all log statements

```typescript
const context = requestContextService.createRequestContext({
  userId: mcpContext?.userId,
  clientId: mcpContext?.clientId,
  operation: "my_tool_operation"
});

logger.info("Starting operation", { ...context, params });
const result = await myLogic(params, context);
logger.info("Operation complete", { ...context, result });
```

## Tool Development Workflow

### Step 1: Create Directory Structure
```bash
mkdir -p src/mcp-server/tools/myTool
touch src/mcp-server/tools/myTool/{index.ts,logic.ts,registration.ts}
```

### Step 2: Define Schema and Logic (`logic.ts`)

```typescript
/**
 * @fileoverview Core logic for the my_tool MCP tool
 * @module src/mcp-server/tools/myTool/logic
 */
import { z } from "zod";
import { logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";

// 1. Define Zod schema
export const MyToolInputSchema = z.object({
  param1: z.string().min(1).describe("Description for AI"),
  param2: z.number().optional().describe("Optional parameter")
});

// 2. Infer types
export type MyToolInput = z.infer<typeof MyToolInputSchema>;

export interface MyToolResponse {
  result: string;
  metadata: Record<string, unknown>;
}

// 3. Implement logic (throws on error)
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  logger.debug("Processing my_tool logic", { ...context, params });
  
  // Validation
  if (someCondition) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Validation failed",
      { detail: "specific reason" }
    );
  }
  
  // Business logic
  const result = await processData(params);
  
  logger.info("Logic complete", { ...context });
  return { result, metadata: {} };
}
```

### Step 3: Implement Registration (`registration.ts`)

```typescript
/**
 * @fileoverview Registration handler for my_tool
 * @module src/mcp-server/tools/myTool/registration
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ErrorHandler,
  logger,
  requestContextService
} from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { MyToolInputSchema, myToolLogic, type MyToolInput } from "./logic.js";

export const registerMyTool = async (server: McpServer): Promise<void> => {
  const toolName = "my_tool";
  const toolDescription = "Brief description of what this tool does";

  server.tool(
    toolName,
    toolDescription,
    MyToolInputSchema.shape,
    async (params: MyToolInput, mcpContext: any): Promise<CallToolResult> => {
      const context = requestContextService.createRequestContext({
        userId: mcpContext?.userId,
        clientId: mcpContext?.clientId,
        operation: toolName
      });

      try {
        logger.info(`${toolName} invoked`, { ...context, params });
        
        // Call pure logic
        const result = await myToolLogic(params, context);
        
        // Format success response
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          isError: false
        };
      } catch (error) {
        // Handle all errors
        const handledError = ErrorHandler.handleError(error, {
          operation: toolName,
          context,
          params
        });

        // Format error response
        const mcpError = handledError instanceof McpError
          ? handledError
          : new McpError(
              BaseErrorCode.INTERNAL_ERROR,
              "Unexpected error",
              { originalError: String(error) }
            );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                code: mcpError.code,
                message: mcpError.message,
                details: mcpError.details
              }
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  logger.info(`Registered tool: ${toolName}`);
};
```

### Step 4: Export and Integrate

**Create barrel file (`index.ts`):**
```typescript
export { registerMyTool } from "./registration.js";
```

**Register in server (`src/mcp-server/server.ts`):**
```typescript
import { registerMyTool } from "./tools/myTool/index.js";

// Inside createMcpServerInstance:
await registerMyTool(server);
```

## Security Patterns

### Path Validation (MANDATORY)

**All file/directory paths MUST be validated:**
```typescript
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { BASE_DIR } from "../../../index.js";

// At the start of logic function
const validatedPath = validateSecurePath(params.projectPath, BASE_DIR);
// Now safe to use validatedPath for file operations
```

### Input Sanitization

**Use sanitization utilities for untrusted input:**
```typescript
import { sanitization } from "../../../utils/index.js";

// Sanitize before logging
logger.info("User input", {
  ...context,
  input: sanitization.sanitizeForLogging(userInput)
});

// Sanitize HTML content
const safe = sanitization.sanitizeHtml(htmlContent);

// Sanitize URLs
const safeUrl = sanitization.sanitizeUrl(userUrl);
```

### Secrets Management

**NEVER hardcode secrets:**
```typescript
// ❌ WRONG
const apiKey = "sk-1234567890";

// ✅ CORRECT
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
```

## Logging Patterns

### Structured Logging

**Always use the centralized logger:**
```typescript
import { logger } from "../../../utils/index.js";

// ❌ WRONG - Never use console.log in server code
console.log("Something happened");

// ✅ CORRECT - Use logger with context
logger.info("Operation started", {
  ...context,
  operation: "my_operation",
  params: { sanitized: "data" }
});

logger.error("Operation failed", {
  ...context,
  error: error.message,
  stack: error.stack
});
```

### Log Levels

- `debug` - Detailed diagnostic information (development only)
- `info` - General informational messages (operation lifecycle)
- `warning` - Warning messages (degraded functionality)
- `error` - Error messages (operation failures)

## Testing Patterns

### Unit Tests

**Test logic functions in isolation:**
```typescript
import { describe, it, expect } from "vitest";
import { myToolLogic } from "./logic.js";
import { createMockContext } from "../../../test-utils.js";

describe("myToolLogic", () => {
  it("should process valid input", async () => {
    const params = { param1: "test" };
    const context = createMockContext();
    
    const result = await myToolLogic(params, context);
    
    expect(result.result).toBe("expected");
  });

  it("should throw on invalid input", async () => {
    const params = { param1: "" };
    const context = createMockContext();
    
    await expect(myToolLogic(params, context))
      .rejects.toThrow(McpError);
  });
});
```

## Code Quality Standards

### TypeScript

- Use strict mode (enabled in tsconfig.json)
- Prefer interfaces for object shapes
- Use type aliases for unions and primitives
- Avoid `any` - use `unknown` and type guards

### Naming Conventions

- Files: camelCase (e.g., `myTool.ts`)
- Directories: camelCase (e.g., `myTool/`)
- Functions: camelCase (e.g., `myFunction`)
- Classes: PascalCase (e.g., `MyClass`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_SIZE`)
- Interfaces: PascalCase (e.g., `MyInterface`)
- Types: PascalCase (e.g., `MyType`)

### Documentation

**JSDoc is mandatory for:**
- All exported functions
- All exported types/interfaces
- All modules (fileoverview)

```typescript
/**
 * @fileoverview Brief description of file purpose
 * @module path/to/module
 */

/**
 * Processes data according to specified rules
 * @param data - The input data to process
 * @param options - Processing options
 * @returns Processed result
 * @throws {McpError} When validation fails
 */
export async function processData(
  data: string,
  options: Options
): Promise<Result> {
  // implementation
}
```

## Performance Considerations

### Async Operations

- Use `Promise.all()` for parallel operations
- Use `AsyncLock` for serialized access to shared resources
- Set appropriate timeouts for external API calls

### Memory Management

- Stream large files instead of loading into memory
- Use pagination for large result sets
- Respect `MAX_GIT_BLOB_SIZE_BYTES` for git operations
- Use project orchestrator for large codebases

### Caching

- Cache expensive computations when appropriate
- Use singleton pattern for shared resources
- Clear caches on configuration changes

## Common Pitfalls to Avoid

### ❌ Don't Do This

```typescript
// Mixing logic and registration
server.tool("my_tool", "desc", schema, async (params) => {
  // Business logic directly in handler - WRONG
  const result = complexCalculation();
  return { content: [...] };
});

// Using console.log in server code
console.log("Debug info"); // Breaks STDIO transport

// Hardcoding paths
const filePath = "/absolute/path/to/file"; // Security risk

// Ignoring errors
try {
  await riskyOperation();
} catch (e) {
  // Silent failure - WRONG
}

// Not validating paths
const userPath = params.path;
fs.readFileSync(userPath); // Path traversal vulnerability
```

### ✅ Do This Instead

```typescript
// Separate logic and registration
// logic.ts
export async function myToolLogic(params, context) {
  return complexCalculation(params);
}

// registration.ts
server.tool("my_tool", "desc", schema, async (params) => {
  try {
    const result = await myToolLogic(params, context);
    return formatSuccess(result);
  } catch (error) {
    return formatError(error);
  }
});

// Use structured logging
logger.info("Debug info", { ...context });

// Use BASE_DIR and validation
const validPath = validateSecurePath(params.path, BASE_DIR);

// Handle errors properly
try {
  await riskyOperation();
} catch (error) {
  const handled = ErrorHandler.handleError(error, {...});
  throw handled;
}

// Always validate paths
const validPath = validateSecurePath(params.path, BASE_DIR);
const content = fs.readFileSync(validPath);
```

## Reference Implementations

Study these exemplary implementations:

- `src/mcp-server/tools/echoTool/` - Minimal synchronous tool
- `src/mcp-server/tools/geminiCodebaseAnalyzer/` - Complex async tool
- `src/mcp-server/tools/calculateTokenCount/` - Utility tool pattern
- `src/mcp-server/tool-blueprints/` - Additional reference patterns

## Checklist for New Tools

Before submitting a new tool, verify:

- [ ] Directory structure follows `tools/myTool/{index,logic,registration}.ts`
- [ ] Zod schema defined with `.describe()` on all fields
- [ ] Logic function throws `McpError` on failure
- [ ] Registration wraps logic in try-catch with `ErrorHandler`
- [ ] All paths validated with `validateSecurePath`
- [ ] `RequestContext` created and propagated
- [ ] Structured logging with context included
- [ ] JSDoc comments on all exports
- [ ] Unit tests for logic function
- [ ] Tool registered in `server.ts`
- [ ] No console.log statements
- [ ] No hardcoded secrets or paths
- [ ] Input sanitization where appropriate
