# Technology Stack & Build System

## Core Technologies

- **TypeScript 5.8.3** - Primary language with strict type checking
- **Node.js 20+** - Runtime environment (ES2020 target, ESNext modules)
- **Zod** - Schema validation and type inference
- **Model Context Protocol SDK** - MCP server/client implementation

## Key Dependencies

### MCP & AI Integration
- `@modelcontextprotocol/sdk` - Core MCP functionality
- `@google/generative-ai` - Gemini AI integration
- `openai` - OpenAI API client
- `tiktoken` - Token counting utilities

### Server & Transport
- `hono` - Web framework for HTTP transport
- `@hono/node-server` - Node.js adapter for Hono
- `jose` - JWT handling for authentication

### Data & Storage
- `@duckdb/node-api` - In-process analytical database
- `@supabase/supabase-js` - Supabase client
- `js-yaml` - YAML parsing
- `partial-json` - Partial JSON parsing

### Utilities
- `winston` - Structured logging
- `dotenv` - Environment variable management
- `glob` - File pattern matching
- `ignore` - .gitignore pattern handling
- `sanitize-html` - Input sanitization
- `validator` - Data validation utilities
- `chrono-node` - Date parsing
- `node-cron` - Scheduled tasks

## Build System

### Core Commands
```bash
# Development
npm run start:local          # Run with ts-node and dotenv
npm run start:stdio          # Run built server (stdio transport)
npm run start:http           # Run built server (HTTP transport)
npm run start:agent          # Run autonomous agent

# Build & Deploy
npm run build               # TypeScript compilation
npm run rebuild             # Clean + build
npm run clean               # Remove dist/ and logs/

# Code Quality
npm run lint                # ESLint checking
npm run lint:fix            # Auto-fix linting issues
npm run format              # Prettier formatting
npm run depcheck            # Check unused dependencies

# Documentation & Utilities
npm run docs:generate       # Generate TypeDoc documentation
npm run tree                # Generate project structure
npm run fetch-spec          # Fetch OpenAPI specifications
npm run inspector           # Run MCP inspector tool
```

### TypeScript Configuration
- **Target**: ES2020 with DOM libraries
- **Module**: ESNext with Node resolution
- **Output**: `dist/` directory with declarations
- **Strict mode**: Enabled with consistent casing enforcement

### Code Quality Tools
- **ESLint**: TypeScript-ESLint with recommended rules
- **Prettier**: Automated formatting for TS/JS/JSON/MD/HTML/CSS
- **TypeDoc**: API documentation generation
- **Depcheck**: Dependency analysis

## Environment Configuration

### Required Variables
- `GEMINI_API_KEY` - Google Gemini API key
- `OPENROUTER_API_KEY` - OpenRouter API key (for agent)

### Optional Variables
- `MCP_TRANSPORT_TYPE` - `stdio` (default) or `http`
- `MCP_HTTP_PORT` - HTTP server port (default: 3010)
- `MCP_HTTP_HOST` - HTTP server host (default: 127.0.0.1)
- `MCP_AUTH_MODE` - `jwt` (default) or `oauth`
- `MCP_AUTH_SECRET_KEY` - JWT secret (required for production)
- `MCP_LOG_LEVEL` - Logging level (debug, info, warn, error)

## Package Distribution

- **Main entry**: `dist/simple-server.js`
- **Binary**: `gemini-mcp-server` command
- **Type definitions**: `dist/simple-server.d.ts`
- **ES Modules**: Full ESM support with `.js` extensions
- **Published files**: `dist/`, `README.md`, `SETUP.md`, config examples