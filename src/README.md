# Source Directory Overview

The `src` directory contains the TypeScript sources that power the `codementor` CLI and the reusable MCP server scaffolding. The codebase has been trimmed to focus on local execution—no Supabase, DuckDB, or agent framework remains.

## Key Modules

| Path                      | Purpose                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `index.ts`                | Main entry point and CLI bootstrap that initializes the server and handles STDIO or HTTP transport.     |
| `config/`                 | Loads environment variables with Zod validation and exposes configuration settings.                      |
| `mcp-server/`             | Modular server scaffolding (tool registration, HTTP & STDIO transports, auth middleware).                |
| `services/llm-providers/` | LLM provider integrations (Gemini CLI, OpenRouter, etc.) for AI-powered analysis.                       |
| `utils/`                  | Shared utilities: logging, error handling, request context tracking, metrics, parsing, security.         |
| `types-global/`           | Global type definitions and error codes used across the codebase.                                        |

## Coding Guidelines

1. **Request Contexts** – Create a `RequestContext` as soon as you enter tool or transport code. Pass it through to logging and downstream helpers for traceability.
2. **Validation** – Define Zod schemas next to the tool logic. Use `.describe()` generously so calling LLMs receive user-friendly help text.
3. **Configuration** – Always use the `config` object from `src/config/` instead of reading `process.env` directly. This ensures validation and type safety.
4. **Logging** – Use the shared Winston logger from `utils/internal/logger`. Never use `console.log` when running on STDIO transport as it breaks the protocol.
5. **Separation of Concerns** – Keep heavy business logic in helper functions. Catch errors at the boundary, format them with the `ErrorHandler`, and return structured results.
6. **Security** – Always validate file paths with `validateSecurePath` to prevent path traversal attacks. Sanitize sensitive data before logging.

## Adding a New Tool

Tools are organized in `src/mcp-server/tools/` with a consistent structure:

```
tools/myTool/
├── index.ts         # Barrel file: exports registerMyTool
├── logic.ts         # Schema, types, and pure business logic
└── registration.ts  # MCP registration and error handling
```

**Steps:**
1. Create the tool directory structure
2. Define Zod schema with `.describe()` on all fields
3. Implement pure logic function that throws `McpError` on failure
4. Create registration handler that wraps logic in try-catch
5. Register the tool in `src/mcp-server/server.ts`
6. Write unit tests for the logic function

For detailed guidelines, see `.kiro/steering/mcp-workflows.md` in the repository.

## Testing & Debugging

- Run `npm run start:local` to execute the TypeScript entry directly (respects `.env`).
- Logs land in `logs/activity.log` and `logs/error.log`. Clear the directory if you need a fresh run.
- Use the HTTP transport (`MCP_TRANSPORT_TYPE=http`) when you need live console output during development.

Happy building!
