# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when editing this repository.

## Project Snapshot

- **Name:** `gemini-mcp-local`
- **Purpose:** Local-first MCP server exposing a Gemini-driven analysis toolkit over STDIO or HTTP.
- **Entry Points:**
  - CLI: `src/simple-server.ts` → `dist/simple-server.js`
  - Programmatic: `src/index.ts`
- **Transports:** STDIO (default) and streamable HTTP (`/mcp`).
- **Logging:** JSON logs to `logs/activity.log` & `logs/error.log` (managed by Winston).

Legacy Supabase, DuckDB, Smithery, and agent packages were removed in release `2.0.0`. Focus on the lean local tool unless a task explicitly requests otherwise.

## Daily Commands

| Command | When to use |
| --- | --- |
| `npm run build` | Compile TypeScript into `dist/`. Always run before publishing. |
| `npm start` | Launch compiled CLI on STDIO. |
| `npm run start:local` | Run TypeScript entry with `ts-node` (uses `.env`). Ideal for rapid iteration. |
| `npm run start:http` | Start compiled CLI with HTTP transport. |
| `npm run lint` / `npm run lint:fix` | Lint the codebase. |
| `npm run docs:generate` | Regenerate TypeDoc docs. |

## Configuration Cheatsheet

### Core runtime variables

- `MCP_TRANSPORT_TYPE` (`stdio` | `http`)
- `MCP_HTTP_PORT`, `MCP_HTTP_HOST`
- `MCP_LOG_LEVEL`, `LOGS_DIR`

### Provider API keys (optional)

Provide whichever vendors you need. The resolver checks request parameters → environment variables (via `config.providerApiKeys`) → raw `process.env` fallback.

`GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `OLLAMA_API_KEY`, `OLLAMA_HOST`.

## Source Layout

```
src/
├── simple-server.ts        # CLI entry, tool definitions, provider key resolver
├── config/                 # Zod-backed environment parsing
├── mcp-server/             # Reusable MCP server scaffolding (stdio + HTTP)
├── services/llm-providers/ # OpenRouter helper (still available)
├── utils/                  # Logger, error handler, metrics, parsing, security
└── index.ts                # Programmatic bootstrap for MCP servers
```

The CLI remains opinionated and self-contained. If you add reusable tools, consider porting them into `src/mcp-server` modules for cleaner separation.

## Coding Conventions

1. **Request Contexts Everywhere** – Create a `RequestContext` at the boundary of every handler and pass it into dependencies. Logs must include the context payload.
2. **Logic Throws, Handlers Catch** – Business logic (typically helper functions inside `simple-server.ts`) should throw typed errors. Handlers catch and format them through the central `ErrorHandler` when applicable.
3. **Zod for Validation** – Input schemas live next to the tool definitions. Annotate fields with `.describe()` so downstream LLMs get helpful metadata.
4. **Shared Provider Credentials** – Always call `resolveProviderApiKeys` or `requireProviderApiKeys` from `simple-server.ts` when interacting with an external LLM. Do not reach for `process.env` directly.
5. **Logging** – Use the Winston logger from `simple-server.ts` (or `utils/internal/logger`) and include contextual metadata. Do not `console.log` (except for the intentional HTTP startup notice).

## Working on `simple-server.ts`

- The file is long but deliberately flat. Add helper functions near related logic and keep the top-level tool registration readable.
- When creating new tools:
  1. Define a Zod schema for inputs.
  2. Parse `request.params.arguments` with that schema.
  3. Resolve provider credentials with the shared helper.
  4. Wrap LLM calls in the existing retry + key rotation utilities if you need resilience.
  5. Return `CallToolResult` objects with a single `type: "text"` entry unless binary content is required.

## HTTP Transport Notes

- Authentication supports `jwt` (shared secret) and `oauth` (remote JWKS). See `src/mcp-server/transports/auth`.
- CORS allowed origins are parsed from `MCP_ALLOWED_ORIGINS` (comma-separated).
- Every HTTP request is wrapped with rate limiting (`utils/security/rateLimiter`) and sanitisation helpers.

## Documentation & Samples

- Root README: user-facing quick start, configuration, and tool highlights.
- `claude_desktop_config.example.json`: Copy/paste config referencing the new CLI name and provider keys.
- `docs/tree.md`: Directory overview (regenerate after structural changes).
- `CHANGELOG.md`: Add a new section for any user-facing change.

## QA Checklist Before Shipping

1. `npm run build`
2. `npm run lint`
3. Launch the CLI with representative env vars (`GOOGLE_API_KEY` etc.) and run a smoke tool (e.g., quick code search) either via STDIO or HTTP.
4. Update docs + changelog, then ensure `docs/tree.md` and `.env.example` stay in sync with config changes.

Happy hacking! The project now optimises for fast local iteration—keep it lean.

