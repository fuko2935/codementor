# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when editing this repository.

## Project Snapshot

- **Name:** `gemini-mcp-local`
- **Purpose:** Local-first MCP server exposing a Gemini-driven analysis toolkit over STDIO or HTTP.
- **Entry Points:**
  - CLI: `src/index.ts` → `dist/index.js` (main entry point)
  - Programmatic: `src/index.ts`
- **Transports:** STDIO (default) and streamable HTTP (`/mcp`).
- **Logging:** JSON logs to `logs/activity.log` & `logs/error.log` (managed by Winston).

Legacy Supabase, DuckDB, Smithery, and agent packages were removed in release `2.0.0`. Focus on the lean local tool unless a task explicitly requests otherwise.

## Daily Commands

| Command                             | When to use                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `npm run build`                     | Compile TypeScript into `dist/`. Always run before publishing.                |
| `npm start`                         | Launch compiled CLI on STDIO.                                                 |
| `npm run start:local`               | Run TypeScript entry with `ts-node` (uses `.env`). Ideal for rapid iteration. |
| `npm run start:http`                | Start compiled CLI with HTTP transport.                                       |
| `npm run lint` / `npm run lint:fix` | Lint the codebase.                                                            |
| `npm run docs:generate`             | Regenerate TypeDoc docs.                                                      |

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
├── index.ts                # Main entry point, server initialization
├── config/                 # Zod-backed environment parsing
├── mcp-server/            # MCP server scaffolding (stdio + HTTP)
│   ├── server.ts           # Server instance creation
│   ├── tools/              # Tool implementations
│   ├── transports/         # STDIO and HTTP transports
│   └── utils/              # Tree-sitter parser, code parser utilities
├── services/llm-providers/ # LLM provider abstractions (Gemini CLI, OpenRouter)
├── utils/                  # Logger, error handler, metrics, parsing, security
└── types-global/           # Shared TypeScript types and error definitions
```

The CLI is modular and well-structured. When adding new tools, follow the pattern in `src/mcp-server/tools/` with separate `logic.ts` and `registration.ts` files.

## Coding Conventions

1. **Request Contexts Everywhere** – Create a `RequestContext` at the boundary of every handler and pass it into dependencies. Logs must include the context payload.
2. **Logic Throws, Handlers Catch** – Business logic (in `logic.ts` files) should throw typed errors. Registration handlers catch and format them through the central `ErrorHandler`.
3. **Zod for Validation** – Input schemas live in `logic.ts` files. Annotate fields with `.describe()` so downstream LLMs get helpful metadata.
4. **Provider Credentials** – Use `config.providerApiKeys` or the provider-specific config helpers. Do not reach for `process.env` directly.
5. **Logging** – Use the Winston logger from `utils/internal/logger` and include contextual metadata. Do not `console.log` (except for intentional HTTP startup notices).
6. **Security** – Always use `validateSecurePath` for project paths. Never allow absolute paths from user input. Use `validateProjectSize` before LLM API calls.
7. **Path Security** – All project paths must be validated against `process.cwd()` using `validateSecurePath` to prevent path traversal attacks.

## Working on Tools

- Tools are organized in `src/mcp-server/tools/` with a clear separation:
  - `logic.ts`: Core business logic (throws errors)
  - `registration.ts`: Tool registration with MCP server (catches and handles errors)
- When creating new tools:
  1. Define a Zod schema for inputs in `logic.ts`
  2. Implement the core logic function
  3. Register the tool in `registration.ts` using `ErrorHandler.tryCatch`
  4. Export from `index.ts` and register in `server.ts`
  5. Follow the pattern: Logic throws, Handlers catch

## HTTP Transport Notes

- Authentication supports `jwt` (shared secret) and `oauth` (remote JWKS). See `src/mcp-server/transports/auth`.
- CORS allowed origins are parsed from `MCP_ALLOWED_ORIGINS` (comma-separated).
- Every HTTP request is wrapped with rate limiting (`utils/security/rateLimiter`) and sanitisation helpers.

## Documentation & Samples

- Root README: user-facing quick start, configuration, and tool highlights.
- `claude_desktop_config.example.json`: Copy/paste config referencing the server (uses `gemini-cli` provider by default).
- `CURSOR_SETUP.md`: Setup guide for Cursor IDE integration.
- `SETUP.md`: Quick setup guide for Claude Desktop.
- `CHANGELOG.md`: Add a new section for any user-facing change.

## QA Checklist Before Shipping

1. `npm run build`
2. `npm run lint`
3. Launch the CLI with representative env vars (`GOOGLE_API_KEY` etc.) and run a smoke tool (e.g., quick code search) either via STDIO or HTTP.
4. Update docs + changelog, then ensure `docs/tree.md` and `.env.example` stay in sync with config changes.

Happy hacking! The project now optimises for fast local iteration—keep it lean.
