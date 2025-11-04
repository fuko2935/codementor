# Project Structure & Organization

## Root Directory Layout

```
├── src/                    # Source code (TypeScript)
├── dist/                   # Compiled JavaScript output
├── docs/                   # Documentation files
├── scripts/                # Utility scripts
├── logs/                   # Runtime log files
├── .kiro/                  # Kiro IDE configuration
├── .github/                # GitHub workflows and templates
└── node_modules/           # Dependencies
```

## Source Code Architecture (`src/`)

### Three-Part MCP Architecture

#### 1. Agent Framework (`src/agent/`)

- **Purpose**: Autonomous agent that connects to MCP servers and executes tasks
- **Key Files**: Core agent logic, CLI interface, task execution
- **Usage**: `npm run start:agent`

#### 2. MCP Server (`src/mcp-server/`)

- **Purpose**: Hosts tools and resources for MCP clients
- **Structure**:
  - `tools/` - Individual tool implementations
  - `resources/` - Resource providers
  - `transports/` - Communication protocols (stdio, HTTP)
  - `server.ts` - Main server orchestration

#### 3. MCP Client (`src/mcp-client/`)

- **Purpose**: Connects to and interacts with external MCP servers
- **Structure**:
  - `client-config/` - Server connection configuration
  - `core/` - Client logic and session management
  - `transports/` - Transport layer implementations

### Supporting Infrastructure

#### Configuration (`src/config/`)

- Environment variable loading and validation
- Application configuration management
- Zod schemas for type-safe config

#### Services (`src/services/`)

- **External integrations**: DuckDB, OpenRouter, Supabase
- **Singleton pattern**: Shared service instances
- **Examples**: Database connections, LLM providers

#### Utilities (`src/utils/`)

- **`internal/`**: Core utilities (logger, error handler, request context)
- **`metrics/`**: Token counting and performance metrics
- **`network/`**: HTTP utilities with timeout handling
- **`parsing/`**: Date and JSON parsing utilities
- **`security/`**: ID generation, rate limiting, sanitization

#### Types (`src/types-global/`)

- Shared TypeScript interfaces and types
- Error definitions (`McpError`, `BaseErrorCode`)
- Global type declarations

## Tool Development Pattern

### Standard Tool Structure

```
src/mcp-server/tools/toolName/
├── index.ts           # Barrel export
├── logic.ts           # Business logic + Zod schemas
└── registration.ts    # MCP server registration
```

### Key Principles

- **Logic throws, handlers catch**: Clear error handling separation
- **Zod validation**: All inputs validated with descriptive schemas
- **Request context**: Traceable operations with unique IDs
- **Type safety**: Full TypeScript coverage with inferred types

## Resource Development Pattern

### Standard Resource Structure

```
src/mcp-server/resources/resourceName/
├── index.ts           # Barrel export
├── logic.ts           # Data retrieval logic
└── registration.ts    # MCP server registration
```

## Documentation Structure (`docs/`)

- **`api-references/`**: Generated TypeDoc API documentation
- **`best-practices.md`**: Development standards and patterns
- **`tree.md`**: Auto-generated project structure

## Scripts Directory (`scripts/`)

Utility scripts for development workflow:

- **`clean.ts`**: Remove build artifacts
- **`tree.ts`**: Generate project structure documentation
- **`fetch-openapi-spec.ts`**: Download and process API specifications
- **`make-executable.ts`**: Set executable permissions (Unix)

## Configuration Files

### Core Configuration

- **`package.json`**: Dependencies, scripts, metadata
- **`tsconfig.json`**: TypeScript compilation settings
- **`eslint.config.js`**: Code linting rules
- **`.clinerules`**: AI assistant development guidelines

### Environment & Deployment

- **`.env.example`**: Environment variable template
- **`mcp.json`**: MCP inspector configuration
- **`claude_desktop_config.example.json`**: Claude Desktop setup

### Build & Quality

- **`typedoc.json`**: Documentation generation
- **`tsdoc.json`**: TSDoc configuration
- **`.gitignore`**: Version control exclusions
- **`.dockerignore`**: Docker build exclusions

## Naming Conventions

### Files & Directories

- **camelCase**: TypeScript files (`requestContext.ts`)
- **kebab-case**: Configuration files (`eslint.config.js`)
- **PascalCase**: Type definitions (`McpError`)

### Code Structure

- **Barrel exports**: `index.ts` files for clean imports
- **Descriptive names**: Self-documenting function and variable names
- **Module organization**: Related functionality grouped together

## Import Patterns

### Relative Imports

- Use relative paths within the same module
- Prefer `../` over deep relative paths

### Absolute Imports

- Import from `src/utils/index.js` for utilities
- Import specific modules for services and types

### ESM Extensions

- Always use `.js` extensions in imports (TypeScript requirement)
- Maintain ESM compatibility throughout
