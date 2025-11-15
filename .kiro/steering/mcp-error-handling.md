---
inclusion: always
---

# Error Handling Standards

This document defines the comprehensive error handling strategy for the CodeMentor project. All code must follow these patterns for consistent, traceable, and user-friendly error management.

## Error Architecture

### Error Hierarchy

```
Error (JavaScript base)
  └── McpError (Custom structured error)
       ├── VALIDATION_ERROR
       ├── AUTHENTICATION_ERROR
       ├── AUTHORIZATION_ERROR
       ├── RATE_LIMITED
       ├── RESOURCE_NOT_FOUND
       ├── EXTERNAL_SERVICE_ERROR
       ├── CONFIGURATION_ERROR
       └── INTERNAL_ERROR
```

### McpError Structure

```typescript
class McpError extends Error {
  code: BaseErrorCode;        // Enum for error classification
  message: string;            // Human-readable message
  details?: Record<string, unknown>;  // Additional context
  statusCode?: number;        // HTTP status code (for HTTP transport)
}
```

## Error Codes and Usage

### VALIDATION_ERROR
**When to use:** Input validation failures, schema violations, constraint violations

**Examples:**
```typescript
// Empty required field
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Project path cannot be empty"
);

// Invalid format
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Invalid revision format",
  { revision: params.revision, expected: "commit-hash or range" }
);

// Path traversal attempt
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Path traversal detected",
  { path: params.path }
);

// Size limit exceeded
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Project exceeds maximum token limit",
  { 
    tokenCount: 1500000,
    maxTokens: 1000000,
    suggestion: "Use .mcpignore to exclude files"
  }
);
```

### AUTHENTICATION_ERROR
**When to use:** Missing or invalid credentials

**Examples:**
```typescript
// Missing API key
throw new McpError(
  BaseErrorCode.AUTHENTICATION_ERROR,
  "API key not configured",
  { provider: "gemini", envVar: "GOOGLE_API_KEY" }
);

// Invalid token
throw new McpError(
  BaseErrorCode.AUTHENTICATION_ERROR,
  "Invalid authentication token"
);
```

### AUTHORIZATION_ERROR
**When to use:** Insufficient permissions, scope violations

**Examples:**
```typescript
// Missing required scope
throw new McpError(
  BaseErrorCode.AUTHORIZATION_ERROR,
  "Insufficient permissions",
  { required: ["codebase:read"], provided: ["basic:read"] }
);

// Access denied
throw new McpError(
  BaseErrorCode.AUTHORIZATION_ERROR,
  "Access denied to resource",
  { resource: "project-config" }
);
```

### RATE_LIMITED
**When to use:** Rate limit exceeded

**Examples:**
```typescript
// Rate limit hit
throw new McpError(
  BaseErrorCode.RATE_LIMITED,
  "Rate limit exceeded",
  {
    limit: 100,
    window: "1 minute",
    retryAfter: 45
  }
);
```

### RESOURCE_NOT_FOUND
**When to use:** Requested resource doesn't exist

**Examples:**
```typescript
// File not found
throw new McpError(
  BaseErrorCode.RESOURCE_NOT_FOUND,
  "Project directory not found",
  { path: validatedPath }
);

// Git repository not found
throw new McpError(
  BaseErrorCode.RESOURCE_NOT_FOUND,
  "Not a git repository",
  { path: projectPath }
);

// Commit not found
throw new McpError(
  BaseErrorCode.RESOURCE_NOT_FOUND,
  "Commit not found",
  { revision: params.revision }
);
```

### EXTERNAL_SERVICE_ERROR
**When to use:** External API/service failures

**Examples:**
```typescript
// LLM API error
throw new McpError(
  BaseErrorCode.EXTERNAL_SERVICE_ERROR,
  "Gemini API request failed",
  {
    provider: "gemini",
    statusCode: 503,
    message: originalError.message
  }
);

// Network timeout
throw new McpError(
  BaseErrorCode.EXTERNAL_SERVICE_ERROR,
  "Request timeout",
  {
    service: "gemini-api",
    timeout: 30000
  }
);

// Service unavailable
throw new McpError(
  BaseErrorCode.EXTERNAL_SERVICE_ERROR,
  "Service temporarily unavailable",
  {
    service: "redis",
    retryable: true
  }
);
```

### CONFIGURATION_ERROR
**When to use:** Invalid configuration, missing required config

**Examples:**
```typescript
// Invalid config value
throw new McpError(
  BaseErrorCode.CONFIGURATION_ERROR,
  "Invalid transport type",
  {
    provided: config.MCP_TRANSPORT_TYPE,
    allowed: ["stdio", "http"]
  }
);

// Missing required config
throw new McpError(
  BaseErrorCode.CONFIGURATION_ERROR,
  "Required configuration missing",
  {
    variable: "MCP_AUTH_SECRET_KEY",
    required: "when MCP_AUTH_MODE=jwt"
  }
);
```

### INTERNAL_ERROR
**When to use:** Unexpected errors, programming errors, last resort

**Examples:**
```typescript
// Unexpected state
throw new McpError(
  BaseErrorCode.INTERNAL_ERROR,
  "Unexpected internal state",
  { state: currentState }
);

// Unhandled case
throw new McpError(
  BaseErrorCode.INTERNAL_ERROR,
  "Unhandled analysis mode",
  { mode: params.analysisMode }
);
```

## Error Handler Usage

### In Logic Layer

**Logic functions MUST throw McpError:**
```typescript
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  // Validate input
  if (!params.required) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Required field missing",
      { field: "required" }
    );
  }

  // Validate paths
  const validPath = validateSecurePath(params.path, BASE_DIR);
  if (!fs.existsSync(validPath)) {
    throw new McpError(
      BaseErrorCode.RESOURCE_NOT_FOUND,
      "Path does not exist",
      { path: params.path }
    );
  }

  // Handle external service errors
  try {
    const result = await externalApi.call();
    return processResult(result);
  } catch (error) {
    throw new McpError(
      BaseErrorCode.EXTERNAL_SERVICE_ERROR,
      "External API failed",
      {
        service: "external-api",
        originalError: error.message
      }
    );
  }
}
```

### In Registration Layer

**Handlers MUST catch and process errors:**
```typescript
export const registerMyTool = async (server: McpServer) => {
  server.tool(name, description, schema, async (params, mcpContext) => {
    const context = requestContextService.createRequestContext({...});

    try {
      // Call logic
      const result = await myToolLogic(params, context);
      
      // Format success
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false
      };
    } catch (error) {
      // Process error through ErrorHandler
      const handledError = ErrorHandler.handleError(error, {
        operation: "my_tool",
        context,
        params: sanitization.sanitizeForLogging(params)
      });

      // Convert to McpError if needed
      const mcpError = handledError instanceof McpError
        ? handledError
        : new McpError(
            BaseErrorCode.INTERNAL_ERROR,
            "Unexpected error occurred",
            { originalError: String(error) }
          );

      // Log error with context
      logger.error("Tool execution failed", {
        ...context,
        error: mcpError.code,
        message: mcpError.message,
        details: mcpError.details
      });

      // Format error response
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
  });
};
```

## Error Context and Logging

### Always Include Context

```typescript
// ✅ CORRECT - Rich context
logger.error("Operation failed", {
  ...context,  // requestId, userId, clientId, operation
  error: error.code,
  message: error.message,
  details: error.details,
  params: sanitization.sanitizeForLogging(params),
  duration: Date.now() - startTime
});

// ❌ WRONG - No context
logger.error("Error occurred", { message: error.message });
```

### Sanitize Before Logging

```typescript
// ✅ CORRECT - Sanitized
logger.error("Authentication failed", {
  ...context,
  params: sanitization.sanitizeForLogging(params),  // Redacts secrets
  error: error.message
});

// ❌ WRONG - May leak secrets
logger.error("Authentication failed", {
  ...context,
  params,  // May contain API keys, tokens
  error: error.message
});
```

## HTTP Transport Error Mapping

The HTTP transport automatically maps error codes to HTTP status codes:

```typescript
const errorStatusMap: Record<BaseErrorCode, number> = {
  [BaseErrorCode.VALIDATION_ERROR]: 400,
  [BaseErrorCode.AUTHENTICATION_ERROR]: 401,
  [BaseErrorCode.AUTHORIZATION_ERROR]: 403,
  [BaseErrorCode.RESOURCE_NOT_FOUND]: 404,
  [BaseErrorCode.RATE_LIMITED]: 429,
  [BaseErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [BaseErrorCode.CONFIGURATION_ERROR]: 500,
  [BaseErrorCode.INTERNAL_ERROR]: 500
};
```

## Error Response Format

### Success Response
```json
{
  "result": "data",
  "metadata": {}
}
```

### Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Project path cannot be empty",
    "details": {
      "field": "projectPath",
      "constraint": "min length 1"
    }
  }
}
```

## Graceful Degradation

### Fallback Strategies

```typescript
// Try primary method, fall back to secondary
try {
  return await treeSitterParse(file);
} catch (error) {
  logger.warning("Tree-sitter parsing failed, falling back to regex", {
    ...context,
    file,
    error: error.message
  });
  return regexParse(file);
}

// Skip problematic items, continue processing
const results = [];
for (const file of files) {
  try {
    results.push(await processFile(file));
  } catch (error) {
    logger.warning("Skipping file due to error", {
      ...context,
      file,
      error: error.message
    });
    // Continue with next file
  }
}
return results;
```

### Size Limits and Early Exit

```typescript
// Check size before processing
if (fileSize > MAX_GIT_BLOB_SIZE_BYTES) {
  logger.info("Skipping large file", {
    ...context,
    file,
    size: fileSize,
    limit: MAX_GIT_BLOB_SIZE_BYTES
  });
  return null;  // Skip, don't error
}

// Check token count before analysis
if (tokenCount > MAX_PROJECT_TOKENS) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Project exceeds token limit",
    {
      tokenCount,
      maxTokens: MAX_PROJECT_TOKENS,
      suggestion: "Use project orchestrator or add .mcpignore patterns"
    }
  );
}
```

## Error Recovery Patterns

### Retry with Backoff

```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries && isRetryable(error)) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warning("Retrying after error", {
          attempt,
          maxRetries,
          delay,
          error: error.message
        });
        await sleep(delay);
      } else {
        break;
      }
    }
  }
  
  throw lastError;
}
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure: number = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new McpError(
        BaseErrorCode.EXTERNAL_SERVICE_ERROR,
        "Circuit breaker open",
        { retryAfter: this.timeout }
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    return this.failures >= this.threshold &&
           Date.now() - this.lastFailure < this.timeout;
  }

  private onSuccess(): void {
    this.failures = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }
}
```

## Testing Error Scenarios

### Unit Tests for Error Cases

```typescript
describe("myToolLogic", () => {
  it("should throw VALIDATION_ERROR for empty path", async () => {
    const params = { projectPath: "" };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toThrow(McpError);
    
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining("empty")
      });
  });

  it("should throw RESOURCE_NOT_FOUND for missing directory", async () => {
    const params = { projectPath: "/nonexistent" };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.RESOURCE_NOT_FOUND
      });
  });

  it("should throw EXTERNAL_SERVICE_ERROR on API failure", async () => {
    mockApi.mockRejectedValue(new Error("API down"));
    
    const params = { projectPath: "." };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.EXTERNAL_SERVICE_ERROR,
        details: expect.objectContaining({
          service: "external-api"
        })
      });
  });
});
```

## Common Error Patterns

### Path Validation Errors

```typescript
// Always validate paths first
const validPath = validateSecurePath(params.projectPath, BASE_DIR);

// Check existence
if (!fs.existsSync(validPath)) {
  throw new McpError(
    BaseErrorCode.RESOURCE_NOT_FOUND,
    "Project directory not found",
    { path: params.projectPath }
  );
}

// Check if directory
if (!fs.statSync(validPath).isDirectory()) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Path must be a directory",
    { path: params.projectPath }
  );
}
```

### Git Operation Errors

```typescript
// Check if git repository
if (!fs.existsSync(path.join(validPath, ".git"))) {
  throw new McpError(
    BaseErrorCode.RESOURCE_NOT_FOUND,
    "Not a git repository",
    { path: params.projectPath }
  );
}

// Validate revision
if (!isValidRevision(params.revision)) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Invalid git revision format",
    {
      revision: params.revision,
      expected: "commit-hash, branch, or range"
    }
  );
}
```

### Configuration Errors

```typescript
// Check required config
if (!config.GOOGLE_API_KEY && config.LLM_DEFAULT_PROVIDER === "gemini") {
  throw new McpError(
    BaseErrorCode.CONFIGURATION_ERROR,
    "API key required for gemini provider",
    {
      envVar: "GOOGLE_API_KEY",
      provider: config.LLM_DEFAULT_PROVIDER
    }
  );
}
```

## Error Documentation

### Document Error Conditions

```typescript
/**
 * Analyzes project codebase
 * 
 * @throws {McpError} VALIDATION_ERROR - Invalid or empty project path
 * @throws {McpError} RESOURCE_NOT_FOUND - Project directory doesn't exist
 * @throws {McpError} VALIDATION_ERROR - Project exceeds token limit
 * @throws {McpError} EXTERNAL_SERVICE_ERROR - LLM API call failed
 * @throws {McpError} INTERNAL_ERROR - Unexpected processing error
 */
export async function analyzeCodebase(
  params: AnalyzeInput,
  context: RequestContext
): Promise<AnalyzeResponse> {
  // implementation
}
```

## Checklist for Error Handling

Before submitting code, verify:

- [ ] All error paths throw structured `McpError`
- [ ] Error codes match the error condition
- [ ] Error messages are clear and actionable
- [ ] Error details include relevant context
- [ ] Errors are caught and processed in handlers
- [ ] Errors are logged with full context
- [ ] Sensitive data is sanitized before logging
- [ ] Unit tests cover error scenarios
- [ ] Error documentation is complete
- [ ] Graceful degradation where appropriate
