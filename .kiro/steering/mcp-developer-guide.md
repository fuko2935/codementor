# Developer Guide

Comprehensive development standards and guidelines for the Gemini MCP Local project.

## Table of Contents

- [1. Product Overview](#1-product-overview)
- [2. Architecture & Technology Stack](#2-architecture--technology-stack)
- [3. Development Patterns](#3-development-patterns)
- [4. Security Practices](#4-security-practices)
- [5. Error Handling](#5-error-handling)
- [6. Workflows](#6-workflows)
- [7. Reference](#7-reference)

---

## 1. Product Overview

Gemini MCP Local is a lightweight Model Context Protocol (MCP) server for local-first AI-powered codebase analysis. It runs directly on your machine or via `npx`, exposing rich analysis workflows without external dependencies like Supabase or DuckDB.

### Core Capabilities

- **Codebase Analysis**: Comprehensive project analysis with AI-powered insights, code search, and pattern detection
- **Code Review**: Git diff integration for reviewing uncommitted changes, specific commits, or commit ranges (see [Workflows](#6-workflows) for implementation details)
- **Project Orchestration**: Intelligent grouping for large codebases that exceed token limits (see [Architecture & Technology Stack](#2-architecture--technology-stack) for technical details)
- **Token Management**: Accurate token counting for Gemini models to plan safe response sizes
- **Multi-Transport**: Supports both STDIO (for IDE/desktop clients) and HTTP (for web/remote access) (see [Architecture & Technology Stack](#2-architecture--technology-stack) for transport configuration)

### Target Users

- Developers using AI assistants (Claude Desktop, Cursor, etc.)
- Teams needing local-first code analysis without cloud dependencies
- Projects requiring secure, on-premise AI tooling (see [Security Practices](#4-security-practices) for security architecture)

### Key Differentiators

- **Local-first**: No external services required; bring your own API keys
- **Flexible Authentication**: OAuth via Gemini CLI (default) or API key-based (see [Security Practices](#4-security-practices) for authentication details)
- **Transport Agnostic**: Works with STDIO for local clients or HTTP for remote access (see [Architecture & Technology Stack](#2-architecture--technology-stack))
- **Security Focused**: Path traversal protection, input sanitization, rate limiting (see [Security Practices](#4-security-practices) for comprehensive security standards)

---

## 2. Architecture & Technology Stack

### Project Structure

The codebase follows a layered architecture with clear module boundaries:

```
src/                    # TypeScript source code
├── config/            # Environment configuration & validation
├── mcp-server/        # MCP server implementation
├── mcp-client/        # Optional MCP client (reusable)
├── services/          # External service integrations
├── utils/             # Shared utilities
├── types-global/      # Global type definitions
├── validation/        # Startup & integration validation
└── index.ts           # Programmatic entry point

dist/                  # Compiled JavaScript output
docs/                  # Architecture & API documentation
scripts/               # Build & maintenance scripts
tests/                 # Unit tests
logs/                  # Runtime logs (activity, error, debug)
```

### Core Technologies

- **Runtime**: Node.js ≥20.0.0
- **Language**: TypeScript 5.8+ (strict mode, ES2020 target)
- **Module System**: ESNext with ESM exports
- **Build Tool**: TypeScript compiler (tsc)
- **Compiler Output**: `dist/` directory with compiled JS + type definitions
- **Entry Point**: `dist/index.js` (executable via shebang)

### TypeScript Configuration

**Compiler Options:**
- **Strict Mode**: Enabled for maximum type safety
- **Target**: ES2020 for modern JavaScript features
- **Module**: ESNext for native ES modules
- **Module Resolution**: Node16 for proper ESM support
- **Declaration**: true (generates .d.ts files)
- **Source Maps**: true for debugging

**Key Settings:**
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "esModuleInterop": true,
  "skipLibCheck": true
}
```

### Key Dependencies

**MCP & AI:**
- `@modelcontextprotocol/sdk` - Model Context Protocol implementation
- `@google/generative-ai` - Gemini API client
- `ai-sdk-provider-gemini-cli` - OAuth-based Gemini CLI provider (see [`src/services/llm-providers/geminiCliProvider.ts`](../../src/services/llm-providers/geminiCliProvider.ts))
- `openai` - OpenAI API client (multi-provider support via [`src/services/llm-providers/openRouterProvider.ts`](../../src/services/llm-providers/openRouterProvider.ts))

**Web Framework:**
- `hono` - Lightweight web framework for HTTP transport (see [`src/mcp-server/transports/httpTransport.ts`](../../src/mcp-server/transports/httpTransport.ts))
- `@hono/node-server` - Node.js adapter for Hono

**Code Analysis:**
- `web-tree-sitter` - AST parsing for multiple languages (see [`src/mcp-server/utils/treeSitterParser.ts`](../../src/mcp-server/utils/treeSitterParser.ts))
- `tree-sitter-*` - Language grammars (Java, Go, Rust, C#, Ruby, PHP, Python)
- `@babel/parser` + `@babel/traverse` - JavaScript/TypeScript AST parsing (see [`src/mcp-server/utils/codeParser.ts`](../../src/mcp-server/utils/codeParser.ts))
- `simple-git` - Git operations for diff analysis (see [`src/mcp-server/utils/gitDiffAnalyzer.ts`](../../src/mcp-server/utils/gitDiffAnalyzer.ts))

**Utilities:**
- `zod` - Schema validation and type inference (see [Development Patterns](#3-development-patterns))
- `winston` - Structured logging (see [`src/utils/internal/logger.ts`](../../src/utils/internal/logger.ts))
- `tiktoken` - Token counting (see [`src/mcp-server/utils/tokenizer.ts`](../../src/mcp-server/utils/tokenizer.ts))
- `ignore` - .gitignore/.mcpignore pattern matching (see [`src/utils/parsing/ignorePatterns.ts`](../../src/utils/parsing/ignorePatterns.ts))
- `sanitize-html` + `validator` - Input sanitization (see [`src/utils/security/sanitization.ts`](../../src/utils/security/sanitization.ts))

**Optional:**
- `ioredis` - Redis client for distributed rate limiting and session coordination (see [`src/utils/security/redisRateLimiter.ts`](../../src/utils/security/redisRateLimiter.ts))

### Core Modules

#### `src/config/`
Environment variable loading and validation. Single source of truth for configuration.

- [`index.ts`](../../src/config/index.ts) - Main config with Zod schemas
- [`clientProfiles.ts`](../../src/config/clientProfiles.ts) - MCP client profiles for different AI assistants

**Configuration via environment variables (validated with Zod):**

**Transport:**
- `MCP_TRANSPORT_TYPE` - `stdio` (default) or `http`
- `MCP_HTTP_PORT` - HTTP port (default: 3010)
- `MCP_HTTP_HOST` - HTTP host (default: 127.0.0.1)

**LLM Providers:**
- `LLM_DEFAULT_PROVIDER` - `gemini-cli` (default), `gemini`, `google`, etc.
- `LLM_DEFAULT_MODEL` - Default model (default: `gemini-2.5-pro`)
- Provider API keys: `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.

**Logging & Security:**
- `MCP_LOG_LEVEL` - `debug`, `info`, `warning`, etc.
- `LOGS_DIR` - Log directory (default: `./logs`)
- `MAX_GIT_BLOB_SIZE_BYTES` - Max file size for git diff (default: 4MB)

**Optional Redis:**
- `MCP_RATE_LIMIT_STORE` - `memory` (default) or `redis`
- `MCP_SESSION_STORE` - `memory` (default) or `redis`
- `REDIS_URL` - Redis connection string

#### `src/mcp-server/`
MCP server scaffolding and tool implementations.

```
mcp-server/
├── server.ts                    # Server creation & tool registration
├── prompts.ts                   # MCP prompts
├── transports/                  # Transport layer implementations
│   ├── stdioTransport.ts       # STDIO transport for local clients
│   ├── httpTransport.ts        # HTTP transport with Hono
│   ├── sessionStore.ts         # Session coordination (memory/Redis)
│   ├── httpErrorHandler.ts     # HTTP error handling
│   └── auth/                   # Authentication strategies (JWT, OAuth)
├── tools/                       # MCP tool implementations
│   ├── geminiCodebaseAnalyzer/ # Main codebase analysis tool
│   ├── projectOrchestratorCreate/  # Large project grouping (step 1)
│   ├── projectOrchestratorAnalyze/ # Large project analysis (step 2)
│   ├── dynamicExpertCreate/    # Custom expert persona generation
│   ├── dynamicExpertAnalyze/   # Expert-guided analysis
│   ├── calculateTokenCount/    # Token counting utility
│   ├── mcpSetupGuide/          # MCP setup documentation
│   └── projectBootstrap/       # Project initialization
├── tool-blueprints/            # Reference implementations (not active)
│   ├── echoTool/              # Minimal synchronous tool example
│   ├── catFactFetcher/        # Async/external API example
│   └── imageTest/             # Binary data handling example
├── resource-blueprints/        # Resource examples (not active)
│   └── echoResource/          # Basic resource template
├── services/                   # Server-specific services
│   └── aiGroupingService.ts   # AI-powered file grouping
└── utils/                      # Server-specific utilities
    ├── codeParser.ts          # AST parsing & metadata extraction
    ├── gitDiffAnalyzer.ts     # Git diff processing
    ├── tokenizer.ts           # Token counting
    ├── treeSitterLoader.ts    # Tree-sitter grammar loading
    ├── treeSitterParser.ts    # Tree-sitter AST parsing
    ├── securePathValidator.ts # Path traversal protection
    ├── projectSizeValidator.ts # Project size checks
    └── mcpConfigValidator.ts  # MCP config validation
```

**Tool Implementation Pattern:**

Each tool follows a consistent structure (see [Development Patterns](#3-development-patterns) for details):

```
tools/toolName/
├── logic.ts           # Pure business logic (throws McpError)
├── registration.ts    # Zod schema + handler registration
└── index.ts           # Public exports
```

**Key Principles:**
- **Separation of Concerns**: Logic is separate from registration
- **Logic Throws, Handlers Catch**: Core logic throws structured errors; handlers wrap with ErrorHandler (see [Error Handling](#5-error-handling))
- **Schema-First**: Zod schemas define inputs and generate JSON Schema for MCP
- **Testable**: Pure logic functions are easy to unit test

#### `src/services/`
External service integrations (LLM providers, APIs).

```
services/
└── llm-providers/
    ├── geminiCliProvider.ts    # Gemini CLI OAuth provider
    ├── openRouterProvider.ts   # OpenRouter API wrapper
    ├── modelFactory.ts         # Provider factory pattern
    └── index.ts
```

#### `src/utils/`
Shared utilities used across the codebase.

```
utils/
├── internal/                   # Core infrastructure
│   ├── logger.ts              # Winston-based structured logging
│   ├── errorHandler.ts        # Centralized error handling
│   └── requestContext.ts      # Request tracing context
├── security/                   # Security utilities
│   ├── sanitization.ts        # Input sanitization
│   ├── rateLimiter.ts         # Rate limiting (memory/Redis)
│   ├── redisRateLimiter.ts    # Redis-backed rate limiter
│   └── idGenerator.ts         # Secure ID generation
├── parsing/                    # Data parsing utilities
│   ├── ignorePatterns.ts      # .gitignore/.mcpignore handling
│   ├── jsonParser.ts          # Partial JSON parsing
│   └── dateParser.ts          # Natural language date parsing
├── metrics/                    # Metrics & monitoring
│   └── tokenCounter.ts        # Token counting utilities
├── network/                    # Network utilities
│   └── fetchWithTimeout.ts    # HTTP client with timeout
└── concurrency/                # Concurrency control
    └── asyncLock.ts           # Async mutex/lock
```

#### `src/mcp-client/`
Optional reusable MCP client for connecting to other MCP servers.

```
mcp-client/
├── core/                       # Client logic
│   ├── clientManager.ts       # Client lifecycle management
│   └── clientConnectionLogic.ts # Connection handling
├── transports/                 # Client transports
│   ├── stdioClientTransport.ts
│   ├── httpClientTransport.ts
│   └── transportFactory.ts
└── client-config/              # Client configuration
    └── configLoader.ts
```

### Architectural Layers

```
Entry (index.ts)
    ↓
Server (mcp-server/server.ts)
    ↓
Transports (stdio/http)
    ↓
Tools & Resources
    ↓
Services & Utils
```

**Dependency Flow:**
- One-way dependencies (utils → services → mcp-server → tools)
- No circular dependencies
- Tools depend on server and shared utils
- Clients are optional consumers

### Development Best Practices

#### Import Conventions

**Always use .js extensions in imports (required for ESM):**
```typescript
// ✅ CORRECT
import { logger } from "../utils/index.js";
import { MyType } from "./types.js";

// ❌ WRONG
import { logger } from "../utils/index";
import { MyType } from "./types";
```

#### Type Safety

**Prefer explicit types over implicit:**
```typescript
// ✅ CORRECT
export async function processData(
  input: string,
  options: ProcessOptions
): Promise<ProcessResult> {
  // implementation
}

// ❌ AVOID
export async function processData(input, options) {
  // implementation
}
```

**Use type guards for unknown types:**
```typescript
// ✅ CORRECT
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

if (isError(error)) {
  console.log(error.message);
}

// ❌ WRONG
if ((error as any).message) {
  console.log((error as any).message);
}
```

#### Async/Await Patterns

**Always handle promise rejections:**
```typescript
// ✅ CORRECT
try {
  const result = await asyncOperation();
  return result;
} catch (error) {
  logger.error("Operation failed", { error });
  throw new McpError(/* ... */);
}

// ❌ WRONG
const result = await asyncOperation();  // Unhandled rejection
return result;
```

**Use Promise.all for parallel operations:**
```typescript
// ✅ CORRECT - Parallel execution
const [users, posts, comments] = await Promise.all([
  fetchUsers(),
  fetchPosts(),
  fetchComments()
]);

// ❌ INEFFICIENT - Sequential execution
const users = await fetchUsers();
const posts = await fetchPosts();
const comments = await fetchComments();
```

### Performance Considerations

#### Memory Management

**Stream large files instead of loading into memory:**
```typescript
// ✅ CORRECT - Streaming
import { createReadStream } from "fs";

const stream = createReadStream(filePath);
for await (const chunk of stream) {
  await processChunk(chunk);
}

// ❌ WRONG - Loads entire file
import { readFileSync } from "fs";
const content = readFileSync(filePath, "utf-8");
```

**Use pagination for large datasets:**
```typescript
// ✅ CORRECT
async function* fetchAllItems() {
  let page = 1;
  while (true) {
    const items = await fetchPage(page);
    if (items.length === 0) break;
    yield* items;
    page++;
  }
}

// ❌ WRONG - Loads everything
const allItems = await fetchAllItems();
```

#### Caching Strategies

**Cache expensive computations:**
```typescript
const cache = new Map<string, Result>();

async function getResult(key: string): Promise<Result> {
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  
  const result = await expensiveComputation(key);
  cache.set(key, result);
  return result;
}
```

**Use singleton pattern for shared resources:**
```typescript
// ✅ CORRECT - Singleton
let instance: MyService | null = null;

export function getMyService(): MyService {
  if (!instance) {
    instance = new MyService();
  }
  return instance;
}

// ❌ WRONG - Creates new instance each time
export function getMyService(): MyService {
  return new MyService();
}
```

#### Concurrency Control

**Use AsyncLock for serialized access:**
```typescript
import { AsyncLock } from "../utils/concurrency/asyncLock.js";

const lock = new AsyncLock();

async function criticalSection() {
  await lock.acquire();
  try {
    // Only one execution at a time
    await sharedResourceOperation();
  } finally {
    lock.release();
  }
}
```

See [`src/utils/concurrency/asyncLock.ts`](../../src/utils/concurrency/asyncLock.ts) for implementation details.

### Code Organization Principles

#### Single Responsibility

**Each module should have one clear purpose:**
```typescript
// ✅ CORRECT - Single responsibility
// userValidator.ts
export function validateUser(user: User): boolean {
  return isValidEmail(user.email) && isValidAge(user.age);
}

// ❌ WRONG - Multiple responsibilities
// userUtils.ts
export function validateUser(user: User): boolean { /* ... */ }
export function saveUser(user: User): Promise<void> { /* ... */ }
export function sendEmail(user: User): Promise<void> { /* ... */ }
```

#### Dependency Injection

**Inject dependencies rather than importing directly:**
```typescript
// ✅ CORRECT
export class MyService {
  constructor(
    private logger: Logger,
    private config: Config
  ) {}
  
  async process() {
    this.logger.info("Processing");
  }
}

// ❌ WRONG
import { logger } from "../utils/logger.js";

export class MyService {
  async process() {
    logger.info("Processing");  // Hard dependency
  }
}
```

#### Interface Segregation

**Define focused interfaces:**
```typescript
// ✅ CORRECT - Focused interfaces
interface Readable {
  read(): Promise<string>;
}

interface Writable {
  write(data: string): Promise<void>;
}

// ❌ WRONG - Bloated interface
interface FileOperations {
  read(): Promise<string>;
  write(data: string): Promise<void>;
  delete(): Promise<void>;
  rename(newName: string): Promise<void>;
  // ... many more methods
}
```

### Naming Conventions

**Files and Directories:**
- **Files**: camelCase (e.g., `myTool.ts`, `userService.ts`)
- **Directories**: camelCase (e.g., `myTool/`, `llmProviders/`)
- **Test files**: `*.test.ts` (e.g., `myTool.test.ts`)

**Code Elements:**
- **Variables**: camelCase (e.g., `userName`, `isValid`)
- **Functions**: camelCase (e.g., `processData`, `validateInput`)
- **Classes**: PascalCase (e.g., `UserService`, `DataProcessor`)
- **Interfaces**: PascalCase (e.g., `UserData`, `ConfigOptions`)
- **Types**: PascalCase (e.g., `UserId`, `ErrorCode`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_SIZE`, `DEFAULT_TIMEOUT`)
- **Enums**: PascalCase with UPPER_SNAKE_CASE values

```typescript
// Examples
const userName = "john";
function processData(input: string): string { /* ... */ }
class UserService { /* ... */ }
interface UserData { /* ... */ }
type UserId = string;
const MAX_RETRIES = 3;
enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND"
}
```

### Documentation Standards

#### JSDoc Comments

**All exported functions must have JSDoc:**
```typescript
/**
 * Processes user data and returns formatted result
 * 
 * @param userData - The user data to process
 * @param options - Processing options
 * @returns Formatted user data
 * @throws {McpError} VALIDATION_ERROR - When user data is invalid
 * @throws {McpError} INTERNAL_ERROR - When processing fails
 * 
 * @example
 * ```typescript
 * const result = await processUserData(
 *   { name: "John", age: 30 },
 *   { format: "json" }
 * );
 * ```
 */
export async function processUserData(
  userData: UserData,
  options: ProcessOptions
): Promise<FormattedData> {
  // implementation
}
```

#### File Headers

**Every file must have a fileoverview:**
```typescript
/**
 * @fileoverview Core logic for user data processing
 * @module src/services/userProcessor
 */
```

### Configuration Files

- `.env` - Local environment variables (gitignored)
- `.env.example` - Environment variable template
- `tsconfig.json` - TypeScript compiler config
- `eslint.config.js` - ESLint configuration
- `typedoc.json` - API documentation config
- `.mcpignore` - Files to exclude from MCP analysis (additive to .gitignore)

### Special Directories

- `.test-temp/` - Temporary test artifacts (gitignored)
- `logs/` - Runtime logs (gitignored)
- `coverage/` - Test coverage reports (gitignored)
- `dist/` - Compiled output (gitignored)
- `.kiro/` - Kiro IDE configuration and steering rules

---

## 3. Development Patterns

This section defines mandatory development patterns, coding conventions, and architectural standards for the Gemini MCP Local project. All code contributions must adhere to these patterns.

### Core Design Principles

#### 1. Logic Throws, Handlers Catch

This is the cornerstone of our error-handling architecture (see [Error Handling](#5-error-handling) for comprehensive error management details).

**Logic Layer (`logic.ts`):**
- Contains pure business logic only
- MUST throw structured `McpError` on failure (see [Error Codes](#5-error-handling) for available codes)
- MUST NOT contain try-catch blocks for response formatting
- MUST be testable in isolation
- MUST accept `RequestContext` as the last parameter

**Handler Layer (`registration.ts`):**
- Wraps logic calls in try-catch blocks
- Processes errors via `ErrorHandler.handleError()` (see [Error Handler Usage](#5-error-handling))
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

#### 2. Separation of Concerns

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

#### 3. Schema-First Development

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

#### 4. Request Context Propagation

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

### Tool Development Workflow

See [Workflows](#6-workflows) for the complete step-by-step guide to adding new tools.

#### Step 1: Create Directory Structure
```bash
mkdir -p src/mcp-server/tools/myTool
touch src/mcp-server/tools/myTool/{index.ts,logic.ts,registration.ts}
```

#### Step 2: Define Schema and Logic (`logic.ts`)

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
  
  // Validation - see Error Handling section for error codes
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

#### Step 3: Implement Registration (`registration.ts`)

See the complete registration pattern in [Workflows](#6-workflows). Key points:
- Wrap logic calls in try-catch
- Use `ErrorHandler.handleError()` for error processing
- Format responses as `CallToolResult`
- Log with full context

#### Step 4: Export and Integrate

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

### Security Patterns

See [Security Practices](#4-security-practices) for comprehensive security standards.

#### Path Validation (MANDATORY)

**All file/directory paths MUST be validated:**
```typescript
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { BASE_DIR } from "../../../index.js";

// At the start of logic function
const validatedPath = validateSecurePath(params.projectPath, BASE_DIR);
// Now safe to use validatedPath for file operations
```

See [Path Security](#4-security-practices) for detailed path validation rules and security architecture.

#### Input Sanitization

**Use sanitization utilities for untrusted input:**
```typescript
import { sanitization } from "../../../utils/index.js";

// Sanitize before logging
logger.info("User input", {
  ...context,
  input: sanitization.sanitizeForLogging(userInput)
});
```

See [Input Sanitization](#4-security-practices) for all sanitization utilities and patterns.

#### Secrets Management

**NEVER hardcode secrets:**
```typescript
// ❌ WRONG
const apiKey = "sk-1234567890";

// ✅ CORRECT
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
```

See [Secrets Management](#4-security-practices) for complete secrets handling guidelines.

### Logging Patterns

#### Structured Logging

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

#### Log Levels

- `debug` - Detailed diagnostic information (development only)
- `info` - General informational messages (operation lifecycle)
- `warning` - Warning messages (degraded functionality)
- `error` - Error messages (operation failures)

### Testing Patterns

#### Unit Tests

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

See [Workflows](#6-workflows) for complete testing procedures and best practices.

### Code Quality Standards

#### TypeScript

- Use strict mode (enabled in tsconfig.json)
- Prefer interfaces for object shapes
- Use type aliases for unions and primitives
- Avoid `any` - use `unknown` and type guards

See [Type Safety](#2-architecture--technology-stack) for detailed TypeScript patterns.

#### Naming Conventions

See [Naming Conventions](#2-architecture--technology-stack) for complete naming standards.

#### Documentation

**JSDoc is mandatory for:**
- All exported functions
- All exported types/interfaces
- All modules (fileoverview)

See [Documentation Standards](#2-architecture--technology-stack) for JSDoc patterns and examples.

### Performance Considerations

#### Async Operations

- Use `Promise.all()` for parallel operations
- Use `AsyncLock` for serialized access to shared resources
- Set appropriate timeouts for external API calls

#### Memory Management

- Stream large files instead of loading into memory
- Use pagination for large result sets
- Respect `MAX_GIT_BLOB_SIZE_BYTES` for git operations
- Use project orchestrator for large codebases

#### Caching

- Cache expensive computations when appropriate
- Use singleton pattern for shared resources
- Clear caches on configuration changes

See [Performance Considerations](#2-architecture--technology-stack) for detailed performance patterns.

### Common Pitfalls to Avoid

#### ❌ Don't Do This

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

#### ✅ Do This Instead

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

// Handle errors properly - see Error Handling section
try {
  await riskyOperation();
} catch (error) {
  const handled = ErrorHandler.handleError(error, {...});
  throw handled;
}

// Always validate paths - see Security Practices section
const validPath = validateSecurePath(params.path, BASE_DIR);
const content = fs.readFileSync(validPath);
```

### Reference Implementations

Study these exemplary implementations:

- `src/mcp-server/tools/echoTool/` - Minimal synchronous tool
- `src/mcp-server/tools/geminiCodebaseAnalyzer/` - Complex async tool
- `src/mcp-server/tools/calculateTokenCount/` - Utility tool pattern
- `src/mcp-server/tool-blueprints/` - Additional reference patterns

### Checklist for New Tools

Before submitting a new tool, verify:

- [ ] Directory structure follows `tools/myTool/{index,logic,registration}.ts`
- [ ] Zod schema defined with `.describe()` on all fields
- [ ] Logic function throws `McpError` on failure (see [Error Handling](#5-error-handling))
- [ ] Registration wraps logic in try-catch with `ErrorHandler`
- [ ] All paths validated with `validateSecurePath` (see [Security Practices](#4-security-practices))
- [ ] `RequestContext` created and propagated
- [ ] Structured logging with context included
- [ ] JSDoc comments on all exports
- [ ] Unit tests for logic function
- [ ] Tool registered in `server.ts`
- [ ] No console.log statements
- [ ] No hardcoded secrets or paths
- [ ] Input sanitization where appropriate (see [Security Practices](#4-security-practices))

---

## 4. Security Practices

This section defines mandatory security practices for the Gemini MCP Local project. All code must adhere to these security standards to prevent vulnerabilities and protect user data.

### Security Architecture

#### Defense in Depth

The project implements multiple layers of security:

1. **Input Validation** - Zod schemas, path validation, sanitization (see [Schema-First Development](#3-development-patterns))
2. **Path Security** - BASE_DIR constraints, traversal prevention (see [Path Validation](#path-validation-mandatory) below)
3. **Authentication** - External layer (reverse proxy, mTLS) (see [Authentication & Authorization](#authentication--authorization))
4. **Rate Limiting** - Identity-based request throttling (see [Rate Limiting](#rate-limiting))
5. **Logging Security** - Sensitive data redaction (see [Logging Security](#logging-security))
6. **Dependency Security** - Automated scanning and updates (see [Dependency Security](#dependency-security))

For comprehensive security hardening guidelines, see [`docs/security-hardening.md`](../../docs/security-hardening.md).

### Path Security (CRITICAL)

#### BASE_DIR Constraint

**All file system operations MUST be constrained to BASE_DIR:**

```typescript
import { BASE_DIR } from "../../../index.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";

// ✅ CORRECT - Always validate paths
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  // First line of defense
  const validPath = validateSecurePath(params.projectPath, BASE_DIR);
  
  // Now safe to use
  const files = fs.readdirSync(validPath);
  return processFiles(files);
}

// ❌ WRONG - Never use paths directly
export async function badToolLogic(params: MyToolInput) {
  // SECURITY VULNERABILITY - Path traversal possible
  const files = fs.readdirSync(params.projectPath);
  return processFiles(files);
}
```

See [`src/mcp-server/utils/securePathValidator.ts`](../../src/mcp-server/utils/securePathValidator.ts) for the implementation of `validateSecurePath`.

#### Path Validation Rules

The [`validateSecurePath`](../../src/mcp-server/utils/securePathValidator.ts) function enforces:

1. **Non-empty** - Path cannot be empty or whitespace
2. **No null bytes** - Prevents null byte injection
3. **No absolute paths** - Only relative paths allowed
4. **No traversal** - `..` segments are blocked
5. **Within BASE_DIR** - Resolved path must be inside BASE_DIR

**Example violations:**
```typescript
// These will throw VALIDATION_ERROR
validateSecurePath("", BASE_DIR);              // Empty
validateSecurePath("/etc/passwd", BASE_DIR);   // Absolute
validateSecurePath("../../../etc", BASE_DIR);  // Traversal
validateSecurePath("path\x00.txt", BASE_DIR);  // Null byte
```

#### Path Security Checklist

For every function that accepts a path parameter:

- [ ] Import `BASE_DIR` and `validateSecurePath`
- [ ] Call `validateSecurePath` as first operation
- [ ] Use validated path for all file operations
- [ ] Document path validation in JSDoc
- [ ] Test with malicious path inputs

See [Development Patterns - Path Validation](#path-validation-mandatory) for integration with tool development workflow.

### Input Sanitization

#### Sanitization Utilities

**Use appropriate sanitization for each input type:**

```typescript
import { sanitization } from "../../../utils/index.js";

// HTML content
const safeHtml = sanitization.sanitizeHtml(userHtml);

// URLs
const safeUrl = sanitization.sanitizeUrl(userUrl);

// File paths
const safePath = sanitization.sanitizePath(userPath);

// Text content
const safeText = sanitization.sanitizeText(userText);

// Numbers
const safeNumber = sanitization.sanitizeNumber(userNumber);

// JSON
const safeJson = sanitization.sanitizeJson(userJson);
```

See [`src/utils/security/sanitization.ts`](../../src/utils/security/sanitization.ts) for all available sanitization utilities.

#### Logging Sanitization (MANDATORY)

**Always sanitize before logging:**

```typescript
// ✅ CORRECT - Sanitized logging
logger.info("User input received", {
  ...context,
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG - May leak secrets
logger.info("User input received", {
  ...context,
  params  // May contain API keys, tokens, passwords
});
```

See [Logging Patterns](#logging-patterns) in Development Patterns for structured logging guidelines.

#### Sensitive Field Redaction

The sanitization layer automatically redacts these fields:

- `password`
- `token`
- `secret`
- `key`
- `apiKey`
- `access_key`
- `secret_key`
- `api_token`
- `authorization`
- `jwt`

**Example:**
```typescript
const input = {
  username: "user",
  password: "secret123",
  apiKey: "sk-1234567890"
};

const sanitized = sanitization.sanitizeForLogging(input);
// Result: { username: "user", password: "[REDACTED]", apiKey: "[REDACTED]" }
```

### Secrets Management

#### Environment Variables Only

**NEVER hardcode secrets:**

```typescript
// ❌ WRONG - Hardcoded secret
const apiKey = "sk-1234567890abcdef";
const dbPassword = "mypassword123";

// ✅ CORRECT - From environment
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
const dbPassword = config.DATABASE_PASSWORD;
```

See [Configuration](#src-config) in Architecture & Technology Stack for environment variable configuration.

#### Configuration Validation

**All secrets MUST be validated at startup:**

```typescript
// In config/index.ts
export const configSchema = z.object({
  GOOGLE_API_KEY: z.string()
    .min(1, "GOOGLE_API_KEY is required")
    .optional(),
  MCP_AUTH_SECRET_KEY: z.string()
    .min(32, "MCP_AUTH_SECRET_KEY must be at least 32 characters")
    .optional()
});

// Fails fast on startup if invalid
export const config = configSchema.parse(process.env);
```

See [`src/config/index.ts`](../../src/config/index.ts) for the complete configuration schema.

#### Secret Storage Best Practices

**Development:**
- Use `.env` file (gitignored)
- Never commit `.env` to version control
- Provide `.env.example` with dummy values

**Production:**
- Use secret management service (AWS Secrets Manager, HashiCorp Vault)
- Use environment variables from orchestrator (Kubernetes secrets, Docker secrets)
- Rotate secrets regularly
- Use different secrets per environment

### Git Command Security

#### Revision Validation

**Always validate git revisions:**

```typescript
import { validateRevision } from "../../utils/gitDiffAnalyzer.js";

// ✅ CORRECT - Validated revision
const revision = validateRevision(params.revision);
const diff = await git.diff([revision]);

// ❌ WRONG - Unvalidated revision (command injection risk)
const diff = await git.diff([params.revision]);
```

See [`src/mcp-server/utils/gitDiffAnalyzer.ts`](../../src/mcp-server/utils/gitDiffAnalyzer.ts) for git operations and revision validation.

#### Allowed Revision Formats

The `validateRevision` function allows:

- Commit hashes: `a1b2c3d`, `a1b2c3d4e5f6`
- Branches: `main`, `feature/branch-name`
- Tags: `v1.0.0`, `release-2024`
- Ranges: `main..feature`, `HEAD~3..HEAD`
- Special: `.` (uncommitted changes), `HEAD`, `HEAD~1`

**Blocked patterns:**
- Shell metacharacters: `;`, `|`, `&`, `$`, `` ` ``
- Command injection: `$(command)`, `` `command` ``
- Path traversal: `../../../`

#### Safe Git Operations

```typescript
import simpleGit from "simple-git";

// ✅ CORRECT - Using simple-git (no shell execution)
const git = simpleGit(validatedPath);
const diff = await git.diff([validatedRevision]);

// ❌ WRONG - Direct shell execution
const { stdout } = await exec(`git diff ${params.revision}`);
```

### Rate Limiting

#### Identity-Based Rate Limiting

**Rate limits are applied based on identity hierarchy:**

1. `userId` (if authenticated) → `id:{userId}`
2. `clientId` (if provided) → `client:{clientId}`
3. IP address → `ip:{address}`
4. Anonymous → `anon:global`

```typescript
// In HTTP transport
const context = {
  userId: authContext?.userId,
  clientId: req.header("x-client-id"),
  ip: req.header("x-forwarded-for") || req.ip
};

const rateLimitResult = await rateLimiter.check("http:mcp", context);

if (rateLimitResult.allowed === false) {
  return c.json({
    error: {
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
      retryAfter: rateLimitResult.retryAfter
    }
  }, 429);
}
```

See [`src/utils/security/rateLimiter.ts`](../../src/utils/security/rateLimiter.ts) and [`src/utils/security/redisRateLimiter.ts`](../../src/utils/security/redisRateLimiter.ts) for rate limiting implementations.

#### Rate Limit Configuration

**Configure appropriate limits:**

```bash
# .env
RATE_LIMIT_WINDOW_MS=60000        # 1 minute window
RATE_LIMIT_MAX_REQUESTS=100       # 100 requests per window
RATE_LIMIT_STORE=memory           # or 'redis' for distributed
```

#### Rate Limit Best Practices

- **Authenticated users** - Higher limits (100-1000 req/min)
- **Anonymous users** - Lower limits (10-50 req/min)
- **Expensive operations** - Separate, stricter limits
- **Production** - Use Redis for distributed rate limiting

### Authentication & Authorization

#### External Authentication Model

**This server does NOT implement authentication:**

```typescript
// ❌ WRONG - Don't implement auth in this server
server.tool("my_tool", "desc", schema, async (params) => {
  if (!validateJWT(params.token)) {
    throw new Error("Unauthorized");
  }
  // ...
});

// ✅ CORRECT - Assume auth is handled externally
server.tool("my_tool", "desc", schema, async (params, mcpContext) => {
  // mcpContext.userId is already validated by external layer
  const context = requestContextService.createRequestContext({
    userId: mcpContext?.userId,
    clientId: mcpContext?.clientId
  });
  // ...
});
```

See [`src/mcp-server/transports/auth/`](../../src/mcp-server/transports/auth/) for authentication strategy implementations.

#### Recommended External Auth

**Production deployments MUST use:**

1. **Reverse Proxy with JWT/OIDC**
   - Nginx, Envoy, Traefik
   - Validates tokens before forwarding
   - Adds user context to headers

2. **mTLS (Mutual TLS)**
   - Client certificate validation
   - Strong cryptographic identity

3. **API Gateway**
   - AWS API Gateway, Kong, Apigee
   - Centralized auth and rate limiting

4. **Network Segmentation**
   - Private network only
   - VPN or zero-trust network

#### Scope Checking (No-Op)

**The `withRequiredScopes` helper is a no-op:**

```typescript
// This does NOT enforce security
const handler = withRequiredScopes(["codebase:read"], async (params) => {
  // ...
});

// It's kept for backwards compatibility only
// Real scope enforcement MUST be done externally
```

### Size Limits and Resource Protection

#### File Size Limits

**Enforce size limits to prevent DoS:**

```typescript
// Git blob size limit
const MAX_GIT_BLOB_SIZE_BYTES = config.MAX_GIT_BLOB_SIZE_BYTES || 4194304; // 4MB

if (fileSize > MAX_GIT_BLOB_SIZE_BYTES) {
  logger.info("Skipping large file", {
    ...context,
    file,
    size: fileSize,
    limit: MAX_GIT_BLOB_SIZE_BYTES
  });
  return null;  // Skip, don't fail
}
```

#### Token Limits

**Enforce token limits for LLM operations:**

```typescript
const MAX_PROJECT_TOKENS = 1000000;  // 1M tokens

if (tokenCount > MAX_PROJECT_TOKENS) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Project exceeds maximum token limit",
    {
      tokenCount,
      maxTokens: MAX_PROJECT_TOKENS,
      suggestion: "Use .mcpignore to exclude files or use project orchestrator"
    }
  );
}
```

See [`src/mcp-server/utils/projectSizeValidator.ts`](../../src/mcp-server/utils/projectSizeValidator.ts) for project size validation utilities.

#### Memory Limits

**Stream large files instead of loading into memory:**

```typescript
// ✅ CORRECT - Streaming
const stream = fs.createReadStream(filePath);
for await (const chunk of stream) {
  processChunk(chunk);
}

// ❌ WRONG - Loads entire file into memory
const content = fs.readFileSync(filePath, "utf-8");
processContent(content);
```

See [Memory Management](#memory-management) in Architecture & Technology Stack for detailed patterns.

### Dependency Security

#### Automated Scanning

**CI pipeline includes security checks:**

```yaml
# .github/workflows/ci.yml
- name: Security audit
  run: npm audit --production --audit-level=high

- name: CodeQL analysis
  uses: github/codeql-action/analyze@v2
```

#### Dependency Updates

**Dependabot configuration:**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
```

#### Dependency Best Practices

- Review dependency updates before merging
- Pin exact versions in `package-lock.json`
- Audit new dependencies before adding
- Remove unused dependencies regularly
- Use `npm audit` locally before committing

### Transport Security

#### STDIO Transport

**STDIO is secure by design:**
- Runs in same process as client
- No network exposure
- Inherits client's security context

**Best for:**
- Local IDE integrations (Cursor, VS Code)
- Desktop applications (Claude Desktop)
- Single-user development environments

See [`src/mcp-server/transports/stdioTransport.ts`](../../src/mcp-server/transports/stdioTransport.ts) for STDIO transport implementation.

#### HTTP Transport

**HTTP requires external security:**

```typescript
// ❌ WRONG - Direct internet exposure
MCP_TRANSPORT_TYPE=http
MCP_HTTP_HOST=0.0.0.0  // Exposed to internet
MCP_HTTP_PORT=3010

// ✅ CORRECT - Behind reverse proxy
MCP_TRANSPORT_TYPE=http
MCP_HTTP_HOST=127.0.0.1  // Localhost only
MCP_HTTP_PORT=3010
// Reverse proxy handles TLS, auth, rate limiting
```

See [`src/mcp-server/transports/httpTransport.ts`](../../src/mcp-server/transports/httpTransport.ts) for HTTP transport implementation.

#### HTTPS/TLS

**Always use TLS in production:**

```nginx
# Nginx reverse proxy
server {
  listen 443 ssl http2;
  server_name mcp.example.com;
  
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  
  location /mcp {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

#### CORS Configuration

**Restrict allowed origins:**

```bash
# .env
MCP_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

```typescript
// In HTTP transport
app.use("*", cors({
  origin: config.MCP_ALLOWED_ORIGINS.split(","),
  credentials: true
}));
```

### Logging Security

#### Structured Logging

**Use structured logging with sanitization:**

```typescript
// ✅ CORRECT
logger.info("Operation started", {
  ...context,
  operation: "analyze_codebase",
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG - Unstructured, may leak secrets
console.log(`User ${params.userId} with key ${params.apiKey} started operation`);
```

See [`src/utils/internal/logger.ts`](../../src/utils/internal/logger.ts) for logger implementation and [Logging Patterns](#logging-patterns) for usage guidelines.

#### Log Levels in Production

**Set appropriate log level:**

```bash
# Development
MCP_LOG_LEVEL=debug

# Production
MCP_LOG_LEVEL=info  # or warning
```

#### Log Retention

**Implement log rotation:**

```typescript
// Winston configuration
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: "error.log",
      level: "error",
      maxsize: 10485760,  // 10MB
      maxFiles: 5,
      tailable: true
    })
  ]
});
```

### Security Testing

#### Security Test Cases

**Test security controls:**

```typescript
describe("Path Security", () => {
  it("should reject path traversal attempts", async () => {
    const params = { projectPath: "../../../etc/passwd" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining("traversal")
      });
  });

  it("should reject absolute paths", async () => {
    const params = { projectPath: "/etc/passwd" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR
      });
  });

  it("should reject null byte injection", async () => {
    const params = { projectPath: "path\x00.txt" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR
      });
  });
});

describe("Input Sanitization", () => {
  it("should redact sensitive fields in logs", () => {
    const input = {
      username: "user",
      password: "secret",
      apiKey: "sk-123"
    };
    const sanitized = sanitization.sanitizeForLogging(input);
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.apiKey).toBe("[REDACTED]");
  });
});

describe("Rate Limiting", () => {
  it("should block requests after limit exceeded", async () => {
    // Make requests up to limit
    for (let i = 0; i < 100; i++) {
      await rateLimiter.check("test", context);
    }
    
    // Next request should be blocked
    const result = await rateLimiter.check("test", context);
    expect(result.allowed).toBe(false);
  });
});
```

See [Testing Patterns](#testing-patterns) for general testing guidelines and [Workflows](#6-workflows) for testing procedures.

### Security Checklist

Before deploying or merging code:

#### Input Validation
- [ ] All paths validated with [`validateSecurePath`](../../src/mcp-server/utils/securePathValidator.ts)
- [ ] All inputs validated with Zod schemas (see [Schema-First Development](#3-development-patterns))
- [ ] Git revisions validated with `validateRevision` (see [`src/mcp-server/utils/gitDiffAnalyzer.ts`](../../src/mcp-server/utils/gitDiffAnalyzer.ts))
- [ ] Size limits enforced for files and requests

#### Secrets Management
- [ ] No hardcoded secrets in code
- [ ] All secrets from environment variables (see [`src/config/index.ts`](../../src/config/index.ts))
- [ ] `.env` file in `.gitignore`
- [ ] Secrets sanitized in logs (see [`src/utils/security/sanitization.ts`](../../src/utils/security/sanitization.ts))

#### Authentication & Authorization
- [ ] External auth layer documented
- [ ] No auth logic in server code
- [ ] User context propagated correctly (see [Request Context Propagation](#4-request-context-propagation))

#### Rate Limiting
- [ ] Rate limits configured appropriately
- [ ] Identity-based rate limiting implemented (see [`src/utils/security/rateLimiter.ts`](../../src/utils/security/rateLimiter.ts))
- [ ] Rate limit errors handled gracefully

#### Logging
- [ ] Structured logging used throughout (see [`src/utils/internal/logger.ts`](../../src/utils/internal/logger.ts))
- [ ] Sensitive data sanitized before logging
- [ ] Appropriate log levels set
- [ ] Request context included in logs

#### Dependencies
- [ ] `npm audit` passes with no high/critical issues
- [ ] Dependencies up to date
- [ ] No unused dependencies
- [ ] Lock file committed

#### Transport Security
- [ ] STDIO for local use only (see [`src/mcp-server/transports/stdioTransport.ts`](../../src/mcp-server/transports/stdioTransport.ts))
- [ ] HTTP behind reverse proxy in production (see [`src/mcp-server/transports/httpTransport.ts`](../../src/mcp-server/transports/httpTransport.ts))
- [ ] TLS/HTTPS enforced
- [ ] CORS configured restrictively

#### Testing
- [ ] Security test cases added
- [ ] Path traversal tests pass
- [ ] Input sanitization tests pass
- [ ] Rate limiting tests pass

### Security Incident Response

#### If a vulnerability is discovered:

1. **Assess severity** - CVSS score, exploitability
2. **Create private security advisory** - GitHub Security tab
3. **Develop fix** - In private branch
4. **Test thoroughly** - Security and regression tests
5. **Coordinate disclosure** - CVE if needed
6. **Release patch** - Semantic versioning (patch bump)
7. **Notify users** - Security advisory, changelog
8. **Post-mortem** - Document lessons learned

#### Security Contacts

- Report vulnerabilities via GitHub Security Advisories
- Do not disclose publicly until patch is available
- Include reproduction steps and impact assessment

For additional security hardening guidelines and best practices, see [`docs/security-hardening.md`](../../docs/security-hardening.md).

---

## 5. Error Handling

This section defines the comprehensive error handling strategy for the Gemini MCP Local project. All code must follow these patterns for consistent, traceable, and user-friendly error management.

### Error Architecture

#### Error Hierarchy

```
Error (JavaScript base)
  └── McpError (Custom structured error)
       ├── VALIDATION_ERROR
       ├── UNAUTHORIZED
       ├── FORBIDDEN
       ├── RATE_LIMITED
       ├── RESOURCE_NOT_FOUND
       ├── EXTERNAL_SERVICE_ERROR
       ├── CONFIGURATION_ERROR
       └── INTERNAL_ERROR
```

#### McpError Structure

```typescript
class McpError extends Error {
  code: BaseErrorCode;        // Enum for error classification
  message: string;            // Human-readable message
  details?: Record<string, unknown>;  // Additional context
  statusCode?: number;        // HTTP status code (for HTTP transport)
}
```

See [`src/types-global/errors.ts`](../../src/types-global/errors.ts) for the complete error type definitions.

### Error Codes and Usage

#### VALIDATION_ERROR
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

#### UNAUTHORIZED
**When to use:** Missing or invalid credentials (authentication failures)

**Semantic meaning:** The request lacks valid authentication credentials. The client must authenticate itself to get the requested response. This is about **who you are** (identity verification).

**Examples:**
```typescript
// Missing API key
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "API key not configured",
  { provider: "gemini", envVar: "GOOGLE_API_KEY" }
);

// Invalid token
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "Invalid authentication token"
);

// Expired credentials
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "Authentication token has expired",
  { expiredAt: "2024-01-15T10:30:00Z" }
);
```

#### FORBIDDEN
**When to use:** Insufficient permissions, scope violations (authorization failures)

**Semantic meaning:** The client is authenticated but does not have permission to access the requested resource. This is about **what you can do** (permission verification).

**Examples:**
```typescript
// Missing required scope
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "Insufficient permissions",
  { required: ["codebase:read"], provided: ["basic:read"] }
);

// Access denied
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "Access denied to resource",
  { resource: "project-config" }
);

// Role-based access control
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "User role does not permit this action",
  { userRole: "viewer", requiredRole: "editor" }
);
```

**UNAUTHORIZED vs FORBIDDEN:**
- **UNAUTHORIZED (401)**: "I don't know who you are" - Authentication failed or missing
- **FORBIDDEN (403)**: "I know who you are, but you can't do that" - Authorization failed

#### RATE_LIMITED
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

See [`src/utils/security/rateLimiter.ts`](../../src/utils/security/rateLimiter.ts) for rate limiting implementation.

#### RESOURCE_NOT_FOUND
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

#### EXTERNAL_SERVICE_ERROR
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

See [`src/services/llm-providers/`](../../src/services/llm-providers/) for LLM provider implementations.

#### CONFIGURATION_ERROR
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

See [`src/config/index.ts`](../../src/config/index.ts) for configuration management.

#### INTERNAL_ERROR
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

### Error Handler Usage

#### In Logic Layer

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

See [Development Patterns - Logic Throws, Handlers Catch](#1-logic-throws-handlers-catch) for the architectural pattern.

#### In Registration Layer

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

See [`src/utils/internal/errorHandler.ts`](../../src/utils/internal/errorHandler.ts) for the ErrorHandler implementation.

### Error Context and Logging

#### Always Include Context

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

See [Development Patterns - Request Context Propagation](#4-request-context-propagation) for context management.

#### Sanitize Before Logging

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

See [Security Practices - Logging Sanitization](#logging-sanitization-mandatory) for sanitization requirements.

### HTTP Transport Error Mapping

The HTTP transport automatically maps error codes to HTTP status codes:

```typescript
const errorStatusMap: Record<BaseErrorCode, number> = {
  [BaseErrorCode.VALIDATION_ERROR]: 400,
  [BaseErrorCode.UNAUTHORIZED]: 401,
  [BaseErrorCode.FORBIDDEN]: 403,
  [BaseErrorCode.RESOURCE_NOT_FOUND]: 404,
  [BaseErrorCode.RATE_LIMITED]: 429,
  [BaseErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [BaseErrorCode.CONFIGURATION_ERROR]: 500,
  [BaseErrorCode.INTERNAL_ERROR]: 500
};
```

See [`src/mcp-server/transports/httpTransport.ts`](../../src/mcp-server/transports/httpTransport.ts) for HTTP transport implementation.

### Error Response Format

#### Success Response
```json
{
  "result": "data",
  "metadata": {}
}
```

#### Error Response
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

### Graceful Degradation

#### Fallback Strategies

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

#### Size Limits and Early Exit

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

See [Security Practices - Size Limits and Resource Protection](#size-limits-and-resource-protection) for resource protection patterns.

### Error Recovery Patterns

#### Retry with Backoff

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

#### Circuit Breaker Pattern

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

### Testing Error Scenarios

#### Unit Tests for Error Cases

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

  it("should throw UNAUTHORIZED for missing credentials", async () => {
    const params = { apiKey: "" };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.UNAUTHORIZED,
        message: expect.stringContaining("credentials")
      });
  });

  it("should throw FORBIDDEN for insufficient permissions", async () => {
    const params = { action: "delete" };
    const context = createMockContext({ userRole: "viewer" });

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.FORBIDDEN,
        message: expect.stringContaining("permission")
      });
  });
});
```

See [Development Patterns - Testing Patterns](#testing-patterns) for general testing guidelines.

### Common Error Patterns

#### Path Validation Errors

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

See [Security Practices - Path Security](#path-security-critical) for path validation requirements.

#### Git Operation Errors

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

See [`src/mcp-server/utils/gitDiffAnalyzer.ts`](../../src/mcp-server/utils/gitDiffAnalyzer.ts) for git operations.

#### Configuration Errors

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

See [`src/config/index.ts`](../../src/config/index.ts) for configuration validation.

#### Authentication and Authorization Errors

```typescript
// Authentication failure (missing/invalid credentials)
if (!token || !isValidToken(token)) {
  throw new McpError(
    BaseErrorCode.UNAUTHORIZED,
    "Valid authentication token required",
    { hint: "Provide a valid API key or JWT token" }
  );
}

// Authorization failure (insufficient permissions)
if (!hasPermission(user, "codebase:write")) {
  throw new McpError(
    BaseErrorCode.FORBIDDEN,
    "Write permission required for this operation",
    { 
      userPermissions: user.permissions,
      requiredPermission: "codebase:write"
    }
  );
}
```

### Error Documentation

#### Document Error Conditions

```typescript
/**
 * Analyzes project codebase
 * 
 * @param params - Analysis parameters
 * @param context - Request context for logging and tracing
 * @returns Analysis results with insights and recommendations
 * 
 * @throws {McpError} VALIDATION_ERROR - Invalid or empty project path
 * @throws {McpError} RESOURCE_NOT_FOUND - Project directory doesn't exist
 * @throws {McpError} VALIDATION_ERROR - Project exceeds token limit
 * @throws {McpError} UNAUTHORIZED - Missing or invalid API credentials
 * @throws {McpError} FORBIDDEN - Insufficient permissions for analysis
 * @throws {McpError} EXTERNAL_SERVICE_ERROR - LLM API call failed
 * @throws {McpError} INTERNAL_ERROR - Unexpected processing error
 * 
 * @example
 * ```typescript
 * const result = await analyzeCodebase(
 *   { projectPath: ".", analysisMode: "security" },
 *   context
 * );
 * ```
 */
export async function analyzeCodebase(
  params: AnalyzeInput,
  context: RequestContext
): Promise<AnalyzeResponse> {
  // implementation
}
```

See [Architecture & Technology Stack - Documentation Standards](#documentation-standards) for JSDoc requirements.

### Checklist for Error Handling

Before submitting code, verify:

- [ ] All error paths throw structured `McpError`
- [ ] Error codes match the error condition (UNAUTHORIZED for auth, FORBIDDEN for authz)
- [ ] Error messages are clear and actionable
- [ ] Error details include relevant context
- [ ] Errors are caught and processed in handlers
- [ ] Errors are logged with full context
- [ ] Sensitive data is sanitized before logging (see [Security Practices](#4-security-practices))
- [ ] Unit tests cover error scenarios
- [ ] Error documentation is complete
- [ ] Graceful degradation where appropriate
- [ ] UNAUTHORIZED used for authentication failures (who you are)
- [ ] FORBIDDEN used for authorization failures (what you can do)

---

## 6. Workflows

This section defines standard workflows for common development tasks in the Gemini MCP Local project.

### Tool Status Reference

Before starting development, understand which tools are active and which are reference implementations:

| Tool | Status | Purpose | Location |
|------|--------|---------|----------|
| **Active Tools** | | | |
| `gemini_codebase_analyzer` | ✅ Active | Main codebase analysis tool | `src/mcp-server/tools/geminiCodebaseAnalyzer/` |
| `project_orchestrator_create` | ✅ Active | Large project grouping (step 1) | `src/mcp-server/tools/projectOrchestratorCreate/` |
| `project_orchestrator_analyze` | ✅ Active | Large project analysis (step 2) | `src/mcp-server/tools/projectOrchestratorAnalyze/` |
| `gemini_dynamic_expert_create` | ✅ Active | Custom expert persona generation | `src/mcp-server/tools/dynamicExpertCreate/` |
| `gemini_dynamic_expert_analyze` | ✅ Active | Expert-guided analysis | `src/mcp-server/tools/dynamicExpertAnalyze/` |
| `calculate_token_count` | ✅ Active | Token counting utility | `src/mcp-server/tools/calculateTokenCount/` |
| `project_bootstrap` | ✅ Active | Project initialization with MCP guide | `src/mcp-server/tools/projectBootstrap/` |
| `mcp_setup_guide` | ⚠️ Superseded | Legacy setup guide (use `project_bootstrap`) | `src/mcp-server/tools/mcpSetupGuide/` |
| **Blueprint Examples** | | | |
| `echoTool` | 📘 Blueprint | Minimal synchronous tool example | `src/mcp-server/tool-blueprints/echoTool/` |
| `catFactFetcher` | 📘 Blueprint | Async/external API example | `src/mcp-server/tool-blueprints/catFactFetcher/` |
| `imageTest` | 📘 Blueprint | Binary data handling example | `src/mcp-server/tool-blueprints/imageTest/` |

**Note:** `mcp_setup_guide` is superseded by `project_bootstrap`, which provides the same functionality plus additional project-specific rules and context control. Use `project_bootstrap` for all new projects.

### Project Bootstrap (First Step)

**Before starting any development work, bootstrap your project:**

The `project_bootstrap` tool creates or updates AI client configuration with:
- MCP usage guide tailored to your AI client
- Project-specific rules and constraints
- Context control settings

**Usage:**
```json
{
  "tool_name": "project_bootstrap",
  "params": {
    "client": "kiro",
    "projectPath": ".",
    "projectRules": {
      "openSourceStatus": "proprietary",
      "distributionModel": "library",
      "targetAudience": "developers",
      "licenseConstraints": ["MIT/Apache-2.0 only"],
      "packageConstraints": ["only official registry"],
      "deploymentNotes": "internal only"
    }
  }
}
```

**Supported clients:** cursor, codex-cli, codex-ide, droidcli, droid-factory, roo-code, kilo-code, zed, vscode-copilot, aider, opencode, amp, gemini-cli, qwen-code, claude-code, warp, cline, kiro, qoder-cli, qoder-ide, other

**When to run:**
- Once per project before using analysis tools
- When switching AI clients
- When project rules or constraints change

See [`src/mcp-server/tools/projectBootstrap/`](../../src/mcp-server/tools/projectBootstrap/) for implementation details.

### Adding a New MCP Tool

#### Prerequisites
- Run `project_bootstrap` for your AI client (see above)
- Understand the tool's purpose and requirements
- Review existing tools for similar patterns (see [Tool Status Reference](#tool-status-reference))
- Identify required dependencies and services

#### Step-by-Step Workflow

##### 1. Create Directory Structure

```bash
# Create tool directory
mkdir -p src/mcp-server/tools/myTool

# Create required files
touch src/mcp-server/tools/myTool/index.ts
touch src/mcp-server/tools/myTool/logic.ts
touch src/mcp-server/tools/myTool/registration.ts
```

##### 2. Define Schema and Logic (`logic.ts`)

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

  // Validate path (MANDATORY) - see Security Practices section
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

See [Development Patterns - Schema-First Development](#3-schema-first-development) for schema design guidelines and [Security Practices - Path Security](#path-security-critical) for path validation requirements.

##### 3. Implement Registration (`registration.ts`)

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
        // Handle errors - see Error Handling section
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

See [Development Patterns - Logic Throws, Handlers Catch](#1-logic-throws-handlers-catch) for the error handling pattern and [Error Handling](#5-error-handling) for comprehensive error management.

##### 4. Create Barrel File (`index.ts`)

```typescript
/**
 * @fileoverview Exports for my_tool
 * @module src/mcp-server/tools/myTool
 */
export { registerMyTool } from "./registration.js";
```

##### 5. Register Tool in Server

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

See [`src/mcp-server/server.ts`](../../src/mcp-server/server.ts) for the complete server implementation.

##### 6. Write Unit Tests

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

See [Development Patterns - Testing Patterns](#testing-patterns) for testing guidelines.

##### 7. Test Manually

```bash
# Build the project
npm run build

# Run in STDIO mode
npm start

# Or run with ts-node for development
npm run start:local
```

Test the tool using an MCP client or the validation script.

##### 8. Update Documentation

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

#### New Tool Checklist

Before submitting PR, verify all requirements are met:

**Structure & Code Quality:**
- [ ] Directory structure follows `tools/myTool/{index,logic,registration}.ts` pattern
- [ ] Zod schema defined with `.describe()` on all fields (see [Schema-First Development](#3-schema-first-development))
- [ ] Logic function throws `McpError` on failure (see [Error Handling](#5-error-handling))
- [ ] Registration wraps logic in try-catch with `ErrorHandler`
- [ ] JSDoc comments on all exports (see [Documentation Standards](#documentation-standards))
- [ ] No console.log statements (use structured logging)
- [ ] No hardcoded secrets or paths

**Security (CRITICAL):**
- [ ] All paths validated with `validateSecurePath` (see [Path Security](#path-security-critical))
- [ ] Input sanitization where appropriate (see [Input Sanitization](#input-sanitization))
- [ ] Sensitive data sanitized before logging (see [Logging Sanitization](#logging-sanitization-mandatory))
- [ ] No hardcoded secrets (use environment variables)
- [ ] Path traversal tests included

**Error Handling:**
- [ ] Appropriate error codes used (VALIDATION_ERROR, RESOURCE_NOT_FOUND, etc.)
- [ ] Error messages are clear and actionable
- [ ] Error details include relevant context
- [ ] Errors logged with full context
- [ ] Unit tests cover error scenarios

**Context & Logging:**
- [ ] `RequestContext` created and propagated (see [Request Context Propagation](#4-request-context-propagation))
- [ ] Structured logging with context included
- [ ] Logging uses appropriate levels (debug, info, warning, error)

**Testing:**
- [ ] Unit tests for logic function
- [ ] Tests for success cases
- [ ] Tests for error cases (validation, not found, etc.)
- [ ] Tests for edge cases
- [ ] All tests passing locally

**Integration:**
- [ ] Tool registered in `server.ts`
- [ ] Documentation updated in README.md
- [ ] Manual testing completed
- [ ] CHANGELOG.md updated

**Code Review:**
- [ ] Code follows established patterns (see [Development Patterns](#3-development-patterns))
- [ ] Security best practices followed (see [Security Practices](#4-security-practices))
- [ ] Performance considerations addressed
- [ ] Code formatted with Prettier
- [ ] Linting passes with no errors

### Adding a New Utility Function

#### When to Add a Utility

**Add to `src/utils/` when:**
- Function is reusable across multiple tools
- Function is generic and not MCP-specific
- Function provides common functionality (logging, parsing, security)

**Add to `src/mcp-server/utils/` when:**
- Function is specific to MCP server operations
- Function deals with code parsing, git operations, etc.

See [Architecture & Technology Stack - Core Modules](#core-modules) for module organization.

#### Utility Structure

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

#### Testing Utilities

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

#### Utility Checklist

Before submitting utility code:

- [ ] Placed in correct directory (`src/utils/` vs `src/mcp-server/utils/`)
- [ ] Single responsibility principle followed
- [ ] JSDoc documentation complete
- [ ] Exported from category and main index
- [ ] Unit tests written and passing
- [ ] Error handling appropriate
- [ ] No side effects (pure functions preferred)
- [ ] TypeScript types explicit

### Adding a New LLM Provider

#### Provider Structure

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

See [`src/services/llm-providers/`](../../src/services/llm-providers/) for existing provider implementations.

#### Register in Model Factory

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

#### LLM Provider Checklist

Before submitting provider code:

- [ ] Provider class implements required interface
- [ ] Configuration validated with Zod schema
- [ ] API key from environment variables (see [Secrets Management](#secrets-management))
- [ ] Error handling with appropriate error codes
- [ ] Singleton pattern used for shared instance
- [ ] Registered in model factory
- [ ] Documentation updated with provider details
- [ ] Environment variables documented in `.env.example`

### Updating Configuration

#### Adding New Environment Variable

**1. Define in config schema** (`src/config/index.ts`):

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

**2. Add to `.env.example`**:

```bash
# My Feature Configuration
MY_NEW_CONFIG=default-value
MY_REQUIRED_CONFIG=required-value
```

**3. Document in README.md**:

```markdown
| Variable | Description | Default |
|----------|-------------|---------|
| `MY_NEW_CONFIG` | Description | `default-value` |
```

**4. Use in code**:

```typescript
import { config } from "../config/index.js";

const value = config.MY_NEW_CONFIG;
```

See [`src/config/index.ts`](../../src/config/index.ts) for the complete configuration schema.

#### Configuration Checklist

Before submitting configuration changes:

- [ ] Schema defined with Zod validation
- [ ] Default values provided where appropriate
- [ ] Required fields marked with validation
- [ ] Added to `.env.example` with example values
- [ ] Documented in README.md
- [ ] No secrets in `.env.example` (use placeholders)
- [ ] Validation tested at startup

### Running Tests

#### Unit Tests

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

#### Integration Tests

```bash
# Run validation tests
npm run validate:startup

# Test STDIO transport
npm start

# Test HTTP transport
npm run start:http
```

#### Manual Testing

```bash
# Build and run
npm run build
npm start

# Development mode with hot reload
npm run start:local
```

#### Testing Checklist

Before submitting code:

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Manual testing completed
- [ ] Edge cases tested
- [ ] Error scenarios tested
- [ ] Security tests included (path traversal, injection, etc.)
- [ ] Performance acceptable
- [ ] No test warnings or errors

### Code Review Process

#### For Reviewers

Review checklist:

- [ ] Code follows established patterns (see [Development Patterns](#3-development-patterns))
- [ ] Security best practices followed (see [Security Practices](#4-security-practices))
- [ ] Error handling is comprehensive (see [Error Handling](#5-error-handling))
- [ ] Tests are thorough and passing
- [ ] Documentation is complete
- [ ] No hardcoded secrets or paths
- [ ] Logging is structured and sanitized
- [ ] Performance considerations addressed
- [ ] TypeScript types are explicit
- [ ] No console.log statements

#### For Authors

Before requesting review:

- [ ] All tests passing locally
- [ ] Code formatted with Prettier (`npm run format`)
- [ ] Linting passes with no errors (`npm run lint`)
- [ ] Documentation updated (README, JSDoc, CHANGELOG)
- [ ] Commit messages are clear and descriptive
- [ ] No debug code or console.logs
- [ ] Security checklist completed (see [Security Checklist](#security-checklist))
- [ ] All checklist items verified

### Release Process

#### Version Bumping

```bash
# Patch release (bug fixes)
npm version patch

# Minor release (new features)
npm version minor

# Major release (breaking changes)
npm version major
```

#### Publishing

```bash
# Build and test
npm run build
npm test

# Publish to npm
npm publish

# Create GitHub release
git push --tags
```

#### Changelog

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

#### Release Checklist

Before releasing:

- [ ] Version bumped appropriately
- [ ] CHANGELOG.md updated
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Security audit clean (`npm audit`)
- [ ] Build successful
- [ ] Manual testing completed
- [ ] Git tags created
- [ ] Release notes prepared

### Troubleshooting Common Issues

#### Build Failures

```bash
# Clean and rebuild
npm run rebuild

# Check TypeScript errors
npx tsc --noEmit

# Check for missing dependencies
npm install
```

#### Test Failures

```bash
# Run tests with verbose output
npm test -- --reporter=verbose

# Run single test file
npm test -- path/to/test.ts

# Clear test cache
rm -rf node_modules/.vitest
```

#### Runtime Errors

```bash
# Check logs
tail -f logs/error.log
tail -f logs/activity.log

# Increase log level
MCP_LOG_LEVEL=debug npm start

# Validate configuration
node -e "require('./dist/config/index.js')"
```

#### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Path traversal error | Using absolute or `..` paths | Use relative paths, validate with `validateSecurePath` |
| Import errors | Missing `.js` extension | Add `.js` to all imports (ESM requirement) |
| Token limit exceeded | Project too large | Use `project_orchestrator` or add `.mcpignore` patterns |
| Rate limit errors | Too many requests | Implement backoff, check rate limit configuration |
| Authentication errors | Missing API key | Set environment variables, check configuration |
| Build errors | TypeScript issues | Run `npx tsc --noEmit`, fix type errors |

See [Architecture & Technology Stack](#2-architecture--technology-stack) for detailed troubleshooting guidance.

---

## 7. Reference

[Content to be consolidated from multiple sources with corrected error codes]

## 4. Security Practices

This section defines mandatory security practices for the Gemini MCP Local project. All code must adhere to these security standards to prevent vulnerabilities and protect user data.

### Security Architecture

The project implements multiple layers of security:

1. **Input Validation** - Zod schemas, path validation, sanitization
2. **Path Security** - BASE_DIR constraints, traversal prevention
3. **Authentication** - External layer (reverse proxy, mTLS)
4. **Rate Limiting** - Identity-based request throttling
5. **Logging Security** - Sensitive data redaction
6. **Dependency Security** - Automated scanning and updates

### Path Security (CRITICAL)

#### BASE_DIR Constraint

**All file system operations MUST be constrained to BASE_DIR:**

```typescript
import { BASE_DIR } from "../../../index.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";

// ✅ CORRECT - Always validate paths
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  // First line of defense
  const validPath = validateSecurePath(params.projectPath, BASE_DIR);
  
  // Now safe to use
  const files = fs.readdirSync(validPath);
  return processFiles(files);
}

// ❌ WRONG - Never use paths directly
export async function badToolLogic(params: MyToolInput) {
  // SECURITY VULNERABILITY - Path traversal possible
  const files = fs.readdirSync(params.projectPath);
  return processFiles(files);
}
```

#### Path Validation Rules

The `validateSecurePath` function enforces:

1. **Non-empty** - Path cannot be empty or whitespace
2. **No null bytes** - Prevents null byte injection
3. **No absolute paths** - Only relative paths allowed
4. **No traversal** - `..` segments are blocked
5. **Within BASE_DIR** - Resolved path must be inside BASE_DIR

**Example violations:**
```typescript
// These will throw VALIDATION_ERROR
validateSecurePath("", BASE_DIR);              // Empty
validateSecurePath("/etc/passwd", BASE_DIR);   // Absolute
validateSecurePath("../../../etc", BASE_DIR);  // Traversal
validateSecurePath("path\x00.txt", BASE_DIR);  // Null byte
```

### Input Sanitization

#### Sanitization Utilities

**Use appropriate sanitization for each input type:**

```typescript
import { sanitization } from "../../../utils/index.js";

// HTML content
const safeHtml = sanitization.sanitizeHtml(userHtml);

// URLs
const safeUrl = sanitization.sanitizeUrl(userUrl);

// File paths
const safePath = sanitization.sanitizePath(userPath);

// Text content
const safeText = sanitization.sanitizeText(userText);

// Numbers
const safeNumber = sanitization.sanitizeNumber(userNumber);

// JSON
const safeJson = sanitization.sanitizeJson(userJson);
```

#### Logging Sanitization (MANDATORY)

**Always sanitize before logging:**

```typescript
// ✅ CORRECT - Sanitized logging
logger.info("User input received", {
  ...context,
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG - May leak secrets
logger.info("User input received", {
  ...context,
  params  // May contain API keys, tokens, passwords
});
```

#### Sensitive Field Redaction

The sanitization layer automatically redacts these fields:

- `password`, `token`, `secret`, `key`
- `apiKey`, `access_key`, `secret_key`
- `api_token`, `authorization`, `jwt`

### Secrets Management

#### Environment Variables Only

**NEVER hardcode secrets:**

```typescript
// ❌ WRONG - Hardcoded secret
const apiKey = "sk-1234567890abcdef";
const dbPassword = "mypassword123";

// ✅ CORRECT - From environment
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
const dbPassword = config.DATABASE_PASSWORD;
```

#### Configuration Validation

**All secrets MUST be validated at startup:**

```typescript
// In config/index.ts
export const configSchema = z.object({
  GOOGLE_API_KEY: z.string()
    .min(1, "GOOGLE_API_KEY is required")
    .optional(),
  MCP_AUTH_SECRET_KEY: z.string()
    .min(32, "MCP_AUTH_SECRET_KEY must be at least 32 characters")
    .optional()
});

// Fails fast on startup if invalid
export const config = configSchema.parse(process.env);
```

### Git Command Security

#### Revision Validation

**Always validate git revisions:**

```typescript
import { validateRevision } from "../../utils/gitDiffAnalyzer.js";

// ✅ CORRECT - Validated revision
const revision = validateRevision(params.revision);
const diff = await git.diff([revision]);

// ❌ WRONG - Unvalidated revision (command injection risk)
const diff = await git.diff([params.revision]);
```

#### Allowed Revision Formats

The `validateRevision` function allows:

- Commit hashes: `a1b2c3d`, `a1b2c3d4e5f6`
- Branches: `main`, `feature/branch-name`
- Tags: `v1.0.0`, `release-2024`
- Ranges: `main..feature`, `HEAD~3..HEAD`
- Special: `.` (uncommitted changes), `HEAD`, `HEAD~1`

**Blocked patterns:**
- Shell metacharacters: `;`, `|`, `&`, `$`, `` ` ``
- Command injection: `$(command)`, `` `command` ``
- Path traversal: `../../../`

### Rate Limiting

#### Identity-Based Rate Limiting

**Rate limits are applied based on identity hierarchy:**

1. `userId` (if authenticated) → `id:{userId}`
2. `clientId` (if provided) → `client:{clientId}`
3. IP address → `ip:{address}`
4. Anonymous → `anon:global`

```typescript
// In HTTP transport
const context = {
  userId: authContext?.userId,
  clientId: req.header("x-client-id"),
  ip: req.header("x-forwarded-for") || req.ip
};

const rateLimitResult = await rateLimiter.check("http:mcp", context);

if (rateLimitResult.allowed === false) {
  return c.json({
    error: {
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
      retryAfter: rateLimitResult.retryAfter
    }
  }, 429);
}
```

### Authentication & Authorization

#### External Authentication Model

**This server does NOT implement authentication:**

```typescript
// ❌ WRONG - Don't implement auth in this server
server.tool("my_tool", "desc", schema, async (params) => {
  if (!validateJWT(params.token)) {
    throw new Error("Unauthorized");
  }
  // ...
});

// ✅ CORRECT - Assume auth is handled externally
server.tool("my_tool", "desc", schema, async (params, mcpContext) => {
  // mcpContext.userId is already validated by external layer
  const context = requestContextService.createRequestContext({
    userId: mcpContext?.userId,
    clientId: mcpContext?.clientId
  });
  // ...
});
```

#### Recommended External Auth

**Production deployments MUST use:**

1. **Reverse Proxy with JWT/OIDC**
   - Nginx, Envoy, Traefik
   - Validates tokens before forwarding
   - Adds user context to headers

2. **mTLS (Mutual TLS)**
   - Client certificate validation
   - Strong cryptographic identity

3. **API Gateway**
   - AWS API Gateway, Kong, Apigee
   - Centralized auth and rate limiting

4. **Network Segmentation**
   - Private network only
   - VPN or zero-trust network

#### Scope Checking (No-Op)

**The `withRequiredScopes` helper is a no-op:**

```typescript
// This does NOT enforce security
const handler = withRequiredScopes(["codebase:read"], async (params) => {
  // ...
});

// It's kept for backwards compatibility only
// Real scope enforcement MUST be done externally
```

### Security Checklist

Before deploying or merging code:

#### Input Validation
- [ ] All paths validated with `validateSecurePath`
- [ ] All inputs validated with Zod schemas
- [ ] Git revisions validated with `validateRevision`
- [ ] Size limits enforced for files and requests

#### Secrets Management
- [ ] No hardcoded secrets in code
- [ ] All secrets from environment variables
- [ ] `.env` file in `.gitignore`
- [ ] Secrets sanitized in logs

#### Authentication & Authorization
- [ ] External auth layer documented
- [ ] No auth logic in server code
- [ ] User context propagated correctly

#### Rate Limiting
- [ ] Rate limits configured appropriately
- [ ] Identity-based rate limiting implemented
- [ ] Rate limit errors handled gracefully

#### Logging
- [ ] Structured logging used throughout
- [ ] Sensitive data sanitized before logging
- [ ] Appropriate log levels set
- [ ] Request context included in logs

---

## 5. Error Handling

This section defines the comprehensive error handling strategy for the Gemini MCP Local project. All code must follow these patterns for consistent, traceable, and user-friendly error management.

### Error Architecture

#### Error Hierarchy

```
Error (JavaScript base)
  └── McpError (Custom structured error)
       ├── VALIDATION_ERROR
       ├── UNAUTHORIZED
       ├── FORBIDDEN
       ├── NOT_FOUND
       ├── CONFLICT
       ├── RATE_LIMITED
       ├── TIMEOUT
       ├── SERVICE_UNAVAILABLE
       ├── CONFIGURATION_ERROR
       ├── INITIALIZATION_FAILED
       ├── INTERNAL_ERROR
       └── UNKNOWN_ERROR
```

#### McpError Structure

```typescript
class McpError extends Error {
  code: BaseErrorCode;        // Enum for error classification
  message: string;            // Human-readable message
  details?: Record<string, unknown>;  // Additional context
}
```

### Error Codes and Usage

#### VALIDATION_ERROR
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

#### UNAUTHORIZED
**When to use:** Missing or invalid credentials

**Examples:**
```typescript
// Missing API key
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "API key not configured",
  { provider: "gemini", envVar: "GOOGLE_API_KEY" }
);

// Invalid token
throw new McpError(
  BaseErrorCode.UNAUTHORIZED,
  "Invalid authentication token"
);
```

#### FORBIDDEN
**When to use:** Insufficient permissions, scope violations

**Examples:**
```typescript
// Missing required scope
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "Insufficient permissions",
  { required: ["codebase:read"], provided: ["basic:read"] }
);

// Access denied
throw new McpError(
  BaseErrorCode.FORBIDDEN,
  "Access denied to resource",
  { resource: "project-config" }
);
```

#### RATE_LIMITED
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

#### NOT_FOUND
**When to use:** Requested resource doesn't exist

**Examples:**
```typescript
// File not found
throw new McpError(
  BaseErrorCode.NOT_FOUND,
  "Project directory not found",
  { path: validatedPath }
);

// Git repository not found
throw new McpError(
  BaseErrorCode.NOT_FOUND,
  "Not a git repository",
  { path: projectPath }
);

// Commit not found
throw new McpError(
  BaseErrorCode.NOT_FOUND,
  "Commit not found",
  { revision: params.revision }
);
```

#### SERVICE_UNAVAILABLE
**When to use:** External API/service failures

**Examples:**
```typescript
// LLM API error
throw new McpError(
  BaseErrorCode.SERVICE_UNAVAILABLE,
  "Gemini API request failed",
  {
    provider: "gemini",
    statusCode: 503,
    message: originalError.message
  }
);

// Network timeout
throw new McpError(
  BaseErrorCode.TIMEOUT,
  "Request timeout",
  {
    service: "gemini-api",
    timeout: 30000
  }
);
```

#### CONFIGURATION_ERROR
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

#### INTERNAL_ERROR
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

### Error Handler Usage

#### In Logic Layer

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
      BaseErrorCode.NOT_FOUND,
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
      BaseErrorCode.SERVICE_UNAVAILABLE,
      "External API failed",
      {
        service: "external-api",
        originalError: error.message
      }
    );
  }
}
```

#### In Registration Layer

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

### Error Context and Logging

#### Always Include Context

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

#### Sanitize Before Logging

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

### HTTP Transport Error Mapping

The HTTP transport automatically maps error codes to HTTP status codes:

```typescript
const errorStatusMap: Record<BaseErrorCode, number> = {
  [BaseErrorCode.VALIDATION_ERROR]: 400,
  [BaseErrorCode.UNAUTHORIZED]: 401,
  [BaseErrorCode.FORBIDDEN]: 403,
  [BaseErrorCode.NOT_FOUND]: 404,
  [BaseErrorCode.CONFLICT]: 409,
  [BaseErrorCode.RATE_LIMITED]: 429,
  [BaseErrorCode.TIMEOUT]: 504,
  [BaseErrorCode.SERVICE_UNAVAILABLE]: 503,
  [BaseErrorCode.CONFIGURATION_ERROR]: 500,
  [BaseErrorCode.INTERNAL_ERROR]: 500,
  [BaseErrorCode.UNKNOWN_ERROR]: 500
};
```

### Error Response Format

#### Success Response
```json
{
  "result": "data",
  "metadata": {}
}
```

#### Error Response
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

### Testing Error Scenarios

#### Unit Tests for Error Cases

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

  it("should throw NOT_FOUND for missing directory", async () => {
    const params = { projectPath: "/nonexistent" };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.NOT_FOUND
      });
  });

  it("should throw SERVICE_UNAVAILABLE on API failure", async () => {
    mockApi.mockRejectedValue(new Error("API down"));
    
    const params = { projectPath: "." };
    const context = createMockContext();

    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.SERVICE_UNAVAILABLE,
        details: expect.objectContaining({
          service: "external-api"
        })
      });
  });
});
```

### Error Handling Checklist

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

---
