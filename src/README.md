# Source Directory Overview

The `src` directory contains the TypeScript sources that power the `gemini-mcp-local` CLI and the reusable MCP server scaffolding. The codebase has been trimmed to focus on local execution—no Supabase, DuckDB, or agent framework remains.

## Key Modules

| Path | Purpose |
| --- | --- |
| `simple-server.ts` | CLI entry that registers tools, resolves provider API keys, and connects to the STDIO or HTTP transport. |
| `config/` | Loads environment variables with Zod validation and exposes `config.providerApiKeys`. |
| `mcp-server/` | Optional modular server scaffolding (create/register tools, HTTP & STDIO transports, auth middleware). |
| `services/llm-providers/` | OpenRouter helper kept for reference when integrating additional providers. |
| `utils/` | Shared utilities: logging, error handling, request context tracking, metrics, parsing, security. |
| `index.ts` | Programmatic bootstrap for embedding the MCP server in other runtimes. |

## Coding Guidelines

1. **Request Contexts** – Create a `RequestContext` as soon as you enter tool or transport code. Pass it through to logging and downstream helpers.
2. **Validation** – Define Zod schemas next to the tool logic. Use `.describe()` generously so calling LLMs receive user-friendly help text.
3. **Provider Keys** – Always use `resolveProviderApiKeys` / `requireProviderApiKeys` (from `simple-server.ts`) instead of reading `process.env` directly.
4. **Logging** – Use the shared Winston logger (`utils/internal/logger` or the instance defined in `simple-server.ts`). Never `console.log` arbitrary text when running on STDIO.
5. **Separation of Concerns** – Keep heavy business logic in helper functions. Catch errors at the boundary, format them with the `ErrorHandler`, and return structured results.

## Adding a Tool to `simple-server.ts`

1. Define a Zod schema for the tool parameters.
2. Parse the incoming request (`request.params.arguments`).
3. Resolve provider credentials with the shared helper if the tool calls out to an external API.
4. Execute the logic; throw errors on failure.
5. Return a `{ content: [{ type: "text", text: "..." }] }` payload on success.

For larger features, consider moving the implementation into `src/mcp-server` and exposing a wrapper inside the CLI.

## Testing & Debugging

- Run `npm run start:local` to execute the TypeScript entry directly (respects `.env`).
- Logs land in `logs/activity.log` and `logs/error.log`. Clear the directory if you need a fresh run.
- Use the HTTP transport (`MCP_TRANSPORT_TYPE=http`) when you need live console output during development.

Happy building!

