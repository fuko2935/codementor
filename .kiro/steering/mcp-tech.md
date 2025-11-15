---
inclusion: always
---

---
inclusion: always
---

# Tech Stack

## Core Technologies

- **Runtime**: Node.js ≥20.0.0
- **Language**: TypeScript 5.8+ (strict mode, ES2020 target)
- **Module System**: ESNext with ESM exports
- **Build Tool**: TypeScript compiler (tsc)

## TypeScript Configuration

### Compiler Options
- **Strict Mode**: Enabled for maximum type safety
- **Target**: ES2020 for modern JavaScript features
- **Module**: ESNext for native ES modules
- **Module Resolution**: Node16 for proper ESM support
- **Declaration**: true (generates .d.ts files)
- **Source Maps**: true for debugging

### Key Settings
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

## Key Dependencies

### MCP & AI
- `@modelcontextprotocol/sdk` - Model Context Protocol implementation
- `@google/generative-ai` - Gemini API client
- `ai-sdk-provider-gemini-cli` - OAuth-based Gemini CLI provider
- `openai` - OpenAI API client (multi-provider support)

### Web Framework
- `hono` - Lightweight web framework for HTTP transport
- `@hono/node-server` - Node.js adapter for Hono

### Code Analysis
- `web-tree-sitter` - AST parsing for multiple languages
- `tree-sitter-*` - Language grammars (Java, Go, Rust, C#, Ruby, PHP, Python)
- `@babel/parser` + `@babel/traverse` - JavaScript/TypeScript AST parsing
- `simple-git` - Git operations for diff analysis

### Utilities
- `zod` - Schema validation and type inference
- `winston` - Structured logging
- `tiktoken` - Token counting
- `ignore` - .gitignore/.mcpignore pattern matching
- `sanitize-html` + `validator` - Input sanitization

### Optional
- `ioredis` - Redis client for distributed rate limiting and session coordination

## Common Commands

### Development
```bash
npm run build              # Compile TypeScript to dist/
npm run start:local        # Run with ts-node (respects .env)
npm start                  # Run compiled CLI (STDIO transport)
npm run start:http         # Run with HTTP transport
npm run rebuild            # Clean and rebuild
```

### Code Quality
```bash
npm run lint               # Run ESLint
npm run lint:fix           # Auto-fix ESLint issues
npm run format             # Format with Prettier
npm run depcheck           # Check for unused dependencies
```

### Documentation
```bash
npm run docs:generate      # Generate TypeDoc API docs
npm run tree               # Generate project tree
```

### Testing
```bash
npm test                   # Run tests
npm test -- --coverage     # Run with coverage report
npm test -- --watch        # Run in watch mode
npm run validate:startup   # Validate server startup
```

## Development Best Practices

### Import Conventions

**Always use .js extensions in imports (required for ESM):**
```typescript
// ✅ CORRECT
import { logger } from "../utils/index.js";
import { MyType } from "./types.js";

// ❌ WRONG
import { logger } from "../utils/index";
import { MyType } from "./types";
```

### Type Safety

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

### Async/Await Patterns

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

## Build System

- **Compiler**: `tsc` with declaration files
- **Asset Copying**: Custom script (`scripts/copy-assets.ts`) for templates
- **Output**: `dist/` directory with compiled JS + type definitions
- **Entry Point**: `dist/index.js` (executable via shebang)

## Code Style

- **Linter**: ESLint 9+ with TypeScript plugin
- **Formatter**: Prettier
- **Unused Vars**: Prefix with `_` to ignore
- **Globals**: Combined browser + Node.js globals
- **Ignored**: `dist/`, `dist-test/`, `node_modules/`

## Environment Configuration

All configuration via environment variables (validated with Zod):

### Transport
- `MCP_TRANSPORT_TYPE` - `stdio` (default) or `http`
- `MCP_HTTP_PORT` - HTTP port (default: 3010)
- `MCP_HTTP_HOST` - HTTP host (default: 127.0.0.1)

### LLM Providers
- `LLM_DEFAULT_PROVIDER` - `gemini-cli` (default), `gemini`, `google`, etc.
- `LLM_DEFAULT_MODEL` - Default model (default: `gemini-2.5-pro`)
- Provider API keys: `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.

### Logging & Security
- `MCP_LOG_LEVEL` - `debug`, `info`, `warning`, etc.
- `LOGS_DIR` - Log directory (default: `./logs`)
- `MAX_GIT_BLOB_SIZE_BYTES` - Max file size for git diff (default: 4MB)

### Optional Redis
- `MCP_RATE_LIMIT_STORE` - `memory` (default) or `redis`
- `MCP_SESSION_STORE` - `memory` (default) or `redis`
- `REDIS_URL` - Redis connection string


## Performance Considerations

### Memory Management

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

### Caching Strategies

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

### Concurrency Control

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

## Error Handling Patterns

### Custom Error Types

**Always use McpError for structured errors:**
```typescript
import { McpError, BaseErrorCode } from "../types-global/errors.js";

// ✅ CORRECT
throw new McpError(
  BaseErrorCode.VALIDATION_ERROR,
  "Invalid input",
  { field: "projectPath", value: params.projectPath }
);

// ❌ WRONG
throw new Error("Invalid input");
```

### Error Propagation

**Let errors bubble up from logic layer:**
```typescript
// logic.ts - THROWS
export async function myLogic(params: Input): Promise<Output> {
  if (!isValid(params)) {
    throw new McpError(/* ... */);
  }
  return result;
}

// registration.ts - CATCHES
export const registerTool = async (server: McpServer) => {
  server.tool(name, desc, schema, async (params) => {
    try {
      const result = await myLogic(params);
      return formatSuccess(result);
    } catch (error) {
      return formatError(error);
    }
  });
};
```

## Logging Best Practices

### Structured Logging

**Always use structured logging with context:**
```typescript
import { logger } from "../utils/index.js";

// ✅ CORRECT
logger.info("Operation started", {
  ...context,
  operation: "analyze",
  params: { projectPath: "[SANITIZED]" }
});

// ❌ WRONG
console.log("Operation started");
```

### Log Levels

- **debug**: Detailed diagnostic information (development only)
- **info**: General informational messages
- **warning**: Warning messages (degraded functionality)
- **error**: Error messages (operation failures)

### Sanitization

**Always sanitize sensitive data before logging:**
```typescript
import { sanitization } from "../utils/index.js";

logger.info("Request received", {
  ...context,
  params: sanitization.sanitizeForLogging(params)
});
```

## Testing Patterns

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("MyFunction", () => {
  let mockContext;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  afterEach(() => {
    // Cleanup
  });

  describe("validation", () => {
    it("should validate input correctly", () => {
      // Test validation
    });
  });

  describe("success cases", () => {
    it("should process valid input", async () => {
      // Test success path
    });
  });

  describe("error cases", () => {
    it("should throw on invalid input", async () => {
      await expect(myFunction(invalid))
        .rejects.toThrow(McpError);
    });
  });
});
```

### Mocking

```typescript
import { vi } from "vitest";

// Mock external dependencies
vi.mock("../services/api.js", () => ({
  fetchData: vi.fn().mockResolvedValue({ data: "test" })
}));

// Mock file system
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("content"),
  existsSync: vi.fn().mockReturnValue(true)
}));
```

## Code Organization Principles

### Single Responsibility

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

### Dependency Injection

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

### Interface Segregation

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

## Naming Conventions

### Files and Directories
- **Files**: camelCase (e.g., `myTool.ts`, `userService.ts`)
- **Directories**: camelCase (e.g., `myTool/`, `llmProviders/`)
- **Test files**: `*.test.ts` (e.g., `myTool.test.ts`)

### Code Elements
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

## Documentation Standards

### JSDoc Comments

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

### File Headers

**Every file must have a fileoverview:**
```typescript
/**
 * @fileoverview Core logic for user data processing
 * @module src/services/userProcessor
 */
```

## Git Workflow

### Commit Messages

Follow conventional commits format:
```
type(scope): subject

body

footer
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/tooling changes

**Examples:**
```
feat(tools): add project analysis tool

Implements comprehensive project analysis with support for
multiple analysis modes and token counting.

Closes #123
```

```
fix(security): prevent path traversal in file operations

Adds validateSecurePath check to all file system operations
to prevent directory traversal attacks.

BREAKING CHANGE: All tools now require paths relative to BASE_DIR
```

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring
- `test/description` - Test additions/changes

## CI/CD Integration

### Pre-commit Checks

```bash
# Run before committing
npm run lint
npm run format
npm test
npm run build
```

### GitHub Actions

The project uses GitHub Actions for:
- **CI**: Lint, build, test, security audit
- **CodeQL**: Static security analysis
- **Dependabot**: Automated dependency updates
- **Publish**: Automated npm publishing on version tags

## Troubleshooting

### Common Issues

**Build errors:**
```bash
# Clean and rebuild
npm run rebuild

# Check TypeScript errors
npx tsc --noEmit
```

**Import errors:**
```bash
# Ensure .js extensions in imports
# Check module resolution in tsconfig.json
```

**Test failures:**
```bash
# Run with verbose output
npm test -- --reporter=verbose

# Clear cache
rm -rf node_modules/.vitest
```

**Runtime errors:**
```bash
# Check logs
tail -f logs/error.log

# Increase log level
MCP_LOG_LEVEL=debug npm start
```
