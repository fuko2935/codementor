---
inclusion: always
---

# Project Structure

## Top-Level Organization

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

## Core Modules

### `src/config/`
Environment variable loading and validation. Single source of truth for configuration.

- `index.ts` - Main config with Zod schemas
- `clientProfiles.ts` - MCP client profiles for different AI assistants

### `src/mcp-server/`
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

### `src/services/`
External service integrations (LLM providers, APIs).

```
services/
└── llm-providers/
    ├── geminiCliProvider.ts    # Gemini CLI OAuth provider
    ├── openRouterProvider.ts   # OpenRouter API wrapper
    ├── modelFactory.ts         # Provider factory pattern
    └── index.ts
```

### `src/utils/`
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

### `src/mcp-client/`
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

## Tool Implementation Pattern

Each tool follows a consistent structure:

```
tools/toolName/
├── logic.ts           # Pure business logic (throws McpError)
├── registration.ts    # Zod schema + handler registration
└── index.ts           # Public exports
```

**Key Principles:**
- **Separation of Concerns**: Logic is separate from registration
- **Logic Throws, Handlers Catch**: Core logic throws structured errors; handlers wrap with ErrorHandler
- **Schema-First**: Zod schemas define inputs and generate JSON Schema for MCP
- **Testable**: Pure logic functions are easy to unit test

## Architectural Layers

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

## Configuration Files

- `.env` - Local environment variables (gitignored)
- `.env.example` - Environment variable template
- `tsconfig.json` - TypeScript compiler config
- `eslint.config.js` - ESLint configuration
- `typedoc.json` - API documentation config
- `.mcpignore` - Files to exclude from MCP analysis (additive to .gitignore)

## Special Directories

- `.test-temp/` - Temporary test artifacts (gitignored)
- `logs/` - Runtime logs (gitignored)
- `coverage/` - Test coverage reports (gitignored)
- `dist/` - Compiled output (gitignored)
- `.kiro/` - Kiro IDE configuration and steering rules
