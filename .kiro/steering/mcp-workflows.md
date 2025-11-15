---
inclusion: always
---

# Development Workflows

This document defines standard workflows for common development tasks in the CodeMentor project.

## Adding a New MCP Tool

### Prerequisites
- Understand the tool's purpose and requirements
- Review existing tools for similar patterns
- Identify required dependencies and services

### Step-by-Step Workflow

#### 1. Create Directory Structure

```bash
# Create tool directory
mkdir -p src/mcp-server/tools/myTool

# Create required files
touch src/mcp-server/tools/myTool/index.ts
touch src/mcp-server/tools/myTool/logic.ts
touch src/mcp-server/tools/myTool/registration.ts
```

#### 2. Define Schema and Logic (`logic.ts`)

```typescript
/**
 * @fileoverview Core logic for the my_tool MCP tool
 * @module src/mcp-server/tools/myTool/logic
 */
import { z } from "zod";
import { logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { BASE_DIR } from "../../../index.js";

// 1. Define Zod schema with descriptions
export const MyToolInputSchema = z.object({
  projectPath: z.string()
    .min(1, "Project path cannot be empty")
    .describe("Absolute path to the project directory to analyze"),
  
  option: z.enum(["fast", "thorough"])
    .default("fast")
    .describe("Analysis mode: 'fast' for quick scan, 'thorough' for deep analysis"),
  
  maxResults: z.number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Maximum number of results to return (default: 100)")
});

// 2. Infer TypeScript types
export type MyToolInput = z.infer<typeof MyToolInputSchema>;

// 3. Define response interface
export interface MyToolResponse {
  summary: string;
  results: Array<{
    file: string;
    score: number;
  }>;
  metadata: {
    totalFiles: number;
    duration: number;
  };
}

// 4. Implement core logic
/**
 * Executes the my_tool analysis logic
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @returns Analysis results
 * @throws {McpError} VALIDATION_ERROR - Invalid input or path
 * @throws {McpError} RESOURCE_NOT_FOUND - Project directory not found
 * @throws {McpError} INTERNAL_ERROR - Unexpected processing error
 */
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  const startTime = Date.now();
  
  logger.info("Starting my_tool analysis", {
    ...context,
    params: { ...params, projectPath: "[SANITIZED]" }
  });

  // Validate path (MANDATORY)
  const validatedPath = validateSecurePath(params.projectPath, BASE_DIR);
  
  // Check if directory exists
  if (!fs.existsSync(validatedPath)) {
    throw new McpError(
      BaseErrorCode.RESOURCE_NOT_FOUND,
      "Project directory not found",
      { path: params.projectPath }
    );
  }

  // Check if it's a directory
  const stats = fs.statSync(validatedPath);
  if (!stats.isDirectory()) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Path must be a directory",
      { path: params.projectPath }
    );
  }

  // Business logic
  try {
    const results = await analyzeProject(validatedPath, params.option);
    const duration = Date.now() - startTime;

    logger.info("Analysis complete", {
      ...context,
      resultCount: results.length,
      duration
    });

    return {
      summary: `Analyzed ${results.length} files in ${duration}ms`,
      results: results.slice(0, params.maxResults || 100),
      metadata: {
        totalFiles: results.length,
        duration
      }
    };
  } catch (error) {
    logger.error("Analysis failed", {
      ...context,
      error: error.message,
      stack: error.stack
    });
    
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      "Analysis processing failed",
      { originalError: error.message }
    );
  }
}

// Helper functions
async function analyzeProject(path: string, mode: string) {
  // Implementation
  return [];
}
```

#### 3. Implement Registration (`registration.ts`)

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
  requestContextService,
  sanitization
} from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import {
  MyToolInputSchema,
  myToolLogic,
  type MyToolInput
} from "./logic.js";

/**
 * Registers the my_tool with the MCP server
 * @param server - MCP server instance
 */
export const registerMyTool = async (server: McpServer): Promise<void> => {
  const toolName = "my_tool";
  const toolDescription = "Analyzes project structure and provides insights";

  server.tool(
    toolName,
    toolDescription,
    MyToolInputSchema.shape,
    async (params: MyToolInput, mcpContext: any): Promise<CallToolResult> => {
      // Create request context
      const context = requestContextService.createRequestContext({
        userId: mcpContext?.userId,
        clientId: mcpContext?.clientId,
        operation: toolName
      });

      try {
        logger.info(`${toolName} invoked`, {
          ...context,
          params: sanitization.sanitizeForLogging(params)
        });

        // Call core logic
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
        // Handle errors
        const handledError = ErrorHandler.handleError(error, {
          operation: toolName,
          context,
          params: sanitization.sanitizeForLogging(params)
        });

        // Convert to McpError
        const mcpError = handledError instanceof McpError
          ? handledError
          : new McpError(
              BaseErrorCode.INTERNAL_ERROR,
              "Unexpected error occurred",
              { originalError: String(error) }
            );

        logger.error(`${toolName} failed`, {
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
    }
  );

  logger.info(`Registered tool: ${toolName}`);
};
```

#### 4. Create Barrel File (`index.ts`)

```typescript
/**
 * @fileoverview Exports for my_tool
 * @module src/mcp-server/tools/myTool
 */
export { registerMyTool } from "./registration.js";
```

#### 5. Register Tool in Server

Edit `src/mcp-server/server.ts`:

```typescript
// Add import
import { registerMyTool } from "./tools/myTool/index.js";

// In createMcpServerInstance function, add registration
export async function createMcpServerInstance(): Promise<McpServer> {
  const server = new McpServer(/* ... */);

  // Register existing tools
  await registerEchoTool(server);
  await registerGeminiCodebaseAnalyzer(server);
  // ... other tools ...

  // Register new tool
  await registerMyTool(server);

  return server;
}
```

#### 6. Write Unit Tests

Create `tests/unit/tools/myTool.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { myToolLogic } from "../../../src/mcp-server/tools/myTool/logic.js";
import { BaseErrorCode } from "../../../src/types-global/errors.js";

describe("myToolLogic", () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      requestId: "test-request-id",
      userId: "test-user",
      operation: "my_tool"
    };
  });

  describe("validation", () => {
    it("should throw VALIDATION_ERROR for empty path", async () => {
      const params = { projectPath: "", option: "fast" };

      await expect(myToolLogic(params, mockContext))
        .rejects.toMatchObject({
          code: BaseErrorCode.VALIDATION_ERROR,
          message: expect.stringContaining("empty")
        });
    });

    it("should throw VALIDATION_ERROR for path traversal", async () => {
      const params = { projectPath: "../../../etc", option: "fast" };

      await expect(myToolLogic(params, mockContext))
        .rejects.toMatchObject({
          code: BaseErrorCode.VALIDATION_ERROR
        });
    });
  });

  describe("success cases", () => {
    it("should analyze valid project", async () => {
      const params = { projectPath: ".", option: "fast" };

      const result = await myToolLogic(params, mockContext);

      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("metadata");
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("should respect maxResults parameter", async () => {
      const params = {
        projectPath: ".",
        option: "fast",
        maxResults: 10
      };

      const result = await myToolLogic(params, mockContext);

      expect(result.results.length).toBeLessThanOrEqual(10);
    });
  });
});
```

#### 7. Test Manually

```bash
# Build the project
npm run build

# Run in STDIO mode
npm start

# Or run with ts-node for development
npm run start:local
```

Test the tool using an MCP client or the validation script.

#### 8. Update Documentation

Add tool documentation to `README.md`:

```markdown
### my_tool

Analyzes project structure and provides insights.

**Parameters:**
- `projectPath` (string, required) - Path to project directory
- `option` (enum, optional) - Analysis mode: "fast" or "thorough" (default: "fast")
- `maxResults` (number, optional) - Maximum results to return (default: 100)

**Example:**
\`\`\`json
{
  "projectPath": "./my-project",
  "option": "thorough",
  "maxResults": 50
}
\`\`\`
```

### Checklist

Before submitting PR:

- [ ] Directory structure follows pattern
- [ ] Zod schema with descriptions
- [ ] Logic throws McpError on failure
- [ ] Registration handles errors properly
- [ ] Path validation implemented
- [ ] Request context propagated
- [ ] Structured logging used
- [ ] Unit tests written and passing
- [ ] Tool registered in server.ts
- [ ] Documentation updated
- [ ] Manual testing completed
- [ ] No console.log statements
- [ ] No hardcoded secrets

## Adding a New Utility Function

### When to Add a Utility

Add to `src/utils/` when:
- Function is reusable across multiple tools
- Function is generic and not MCP-specific
- Function provides common functionality (logging, parsing, security)

Add to `src/mcp-server/utils/` when:
- Function is specific to MCP server operations
- Function deals with code parsing, git operations, etc.

### Utility Structure

```typescript
/**
 * @fileoverview Description of utility purpose
 * @module src/utils/category/myUtility
 */

/**
 * Does something useful
 * @param input - Input parameter
 * @returns Processed result
 * @throws {Error} When validation fails
 */
export function myUtility(input: string): string {
  if (!input) {
    throw new Error("Input cannot be empty");
  }
  
  return processInput(input);
}

// Export from category index
// src/utils/category/index.ts
export { myUtility } from "./myUtility.js";

// Export from main utils index
// src/utils/index.ts
export * from "./category/index.js";
```

### Testing Utilities

```typescript
import { describe, it, expect } from "vitest";
import { myUtility } from "../../../src/utils/category/myUtility.js";

describe("myUtility", () => {
  it("should process valid input", () => {
    const result = myUtility("test");
    expect(result).toBe("processed-test");
  });

  it("should throw on empty input", () => {
    expect(() => myUtility("")).toThrow("Input cannot be empty");
  });
});
```

## Adding a New LLM Provider

### Provider Structure

```typescript
/**
 * @fileoverview My LLM provider implementation
 * @module src/services/llm-providers/myProvider
 */
import { GenerativeModel } from "@google/generative-ai";

export interface MyProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class MyProvider {
  private client: any;
  private config: MyProviderConfig;

  constructor(config: MyProviderConfig) {
    this.config = config;
    this.client = this.initializeClient();
  }

  private initializeClient() {
    // Initialize API client
    return createClient(this.config);
  }

  async generateContent(prompt: string): Promise<string> {
    try {
      const response = await this.client.generate({
        prompt,
        model: this.config.model
      });
      return response.text;
    } catch (error) {
      throw new McpError(
        BaseErrorCode.EXTERNAL_SERVICE_ERROR,
        "Provider API call failed",
        {
          provider: "my-provider",
          error: error.message
        }
      );
    }
  }
}

// Export singleton instance
export const myProvider = new MyProvider({
  apiKey: config.MY_PROVIDER_API_KEY,
  model: config.MY_PROVIDER_MODEL
});
```

### Register in Model Factory

Edit `src/services/llm-providers/modelFactory.ts`:

```typescript
import { myProvider } from "./myProvider.js";

export function createModelByProvider(
  provider: string,
  model?: string
): GenerativeModel {
  switch (provider.toLowerCase()) {
    case "gemini-cli":
      return geminiCliProvider.getModel(model);
    case "my-provider":
      return myProvider.getModel(model);
    // ... other providers
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

## Updating Configuration

### Adding New Environment Variable

1. **Define in config schema** (`src/config/index.ts`):

```typescript
export const configSchema = z.object({
  // ... existing config ...
  
  MY_NEW_CONFIG: z.string()
    .default("default-value")
    .describe("Description of what this config does"),
  
  MY_REQUIRED_CONFIG: z.string()
    .min(1, "MY_REQUIRED_CONFIG is required")
});
```

2. **Add to `.env.example`**:

```bash
# My Feature Configuration
MY_NEW_CONFIG=default-value
MY_REQUIRED_CONFIG=required-value
```

3. **Document in README.md**:

```markdown
| Variable | Description | Default |
|----------|-------------|---------|
| `MY_NEW_CONFIG` | Description | `default-value` |
```

4. **Use in code**:

```typescript
import { config } from "../config/index.js";

const value = config.MY_NEW_CONFIG;
```

## Running Tests

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- myTool.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Integration Tests

```bash
# Run validation tests
npm run validate:startup

# Test STDIO transport
npm start

# Test HTTP transport
npm run start:http
```

### Manual Testing

```bash
# Build and run
npm run build
npm start

# Development mode with hot reload
npm run start:local
```

## Code Review Checklist

### For Reviewers

- [ ] Code follows established patterns
- [ ] Security best practices followed
- [ ] Error handling is comprehensive
- [ ] Tests are thorough and passing
- [ ] Documentation is complete
- [ ] No hardcoded secrets or paths
- [ ] Logging is structured and sanitized
- [ ] Performance considerations addressed

### For Authors

Before requesting review:

- [ ] All tests passing locally
- [ ] Code formatted with Prettier
- [ ] Linting passes with no errors
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Commit messages are clear
- [ ] No debug code or console.logs
- [ ] Security checklist completed

## Release Process

### Version Bumping

```bash
# Patch release (bug fixes)
npm version patch

# Minor release (new features)
npm version minor

# Major release (breaking changes)
npm version major
```

### Publishing

```bash
# Build and test
npm run build
npm test

# Publish to npm
npm publish

# Create GitHub release
git push --tags
```

### Changelog

Update `CHANGELOG.md` following Keep a Changelog format:

```markdown
## [1.2.0] - 2024-01-15

### Added
- New my_tool for project analysis
- Support for thorough analysis mode

### Changed
- Improved error messages in validation

### Fixed
- Path traversal vulnerability in file operations

### Security
- Updated dependencies to patch vulnerabilities
```

## Troubleshooting Common Issues

### Build Failures

```bash
# Clean and rebuild
npm run rebuild

# Check TypeScript errors
npx tsc --noEmit

# Check for missing dependencies
npm install
```

### Test Failures

```bash
# Run tests with verbose output
npm test -- --reporter=verbose

# Run single test file
npm test -- path/to/test.ts

# Clear test cache
rm -rf node_modules/.vitest
```

### Runtime Errors

```bash
# Check logs
tail -f logs/error.log
tail -f logs/activity.log

# Increase log level
MCP_LOG_LEVEL=debug npm start

# Validate configuration
node -e "require('./dist/config/index.js')"
```
