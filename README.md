# CodeMentor

Languages: English | Türkçe (README.tr.md)

CodeMentor is a lightweight Model Context Protocol (MCP) server that you can run directly on your machine or launch ad-hoc with `npx`. It exposes the same rich analysis workflow used in the original Smithery-compatible server without the Supabase, DuckDB, or agent dependencies. Bring your own API keys via environment variables, pick a transport (`stdio` by default, `http` when you need it), and you are ready to connect from Claude Desktop or any MCP-compliant client.

---

## Quick Start

### Run instantly with `npx`

**With Gemini CLI Provider (Default - OAuth):**

```bash
# Make sure gemini CLI is installed and authenticated
npm install -g @google/gemini-cli
gemini  # Then select "Login with Google"

# Run the server
npx codementor
```

**With API Key (Alternative):**

```bash
# ⚠️ SECURITY WARNING: Never hardcode API keys in config files!
# Set the API key as an environment variable instead:
export GOOGLE_API_KEY="your-google-or-gemini-key"
LLM_DEFAULT_PROVIDER=gemini npx codementor
```

The CLI starts on STDIO transport by default so it is immediately ready for Claude Desktop and other local MCP clients.

### Install locally

```bash
git clone <repo-url>
cd codementor
npm install
npm run build
npm start
```

Use `npm run start:local` during development if you want live TypeScript execution with `ts-node`.

---

## Configuration

All behaviour is driven by environment variables. Only the provider keys you need should be set.

### Default Provider

By default, the server uses the **Gemini CLI provider** (`gemini-cli`) with OAuth authentication via the `gemini` CLI tool. This allows you to use your existing Gemini Code Assist subscription without managing API keys.

To use the Gemini CLI provider:

1. Install the Gemini CLI globally: `npm install -g @google/gemini-cli`
2. Authenticate: `gemini` (then select "Login with Google" for OAuth)
3. The server will automatically use your OAuth credentials

To switch back to API key-based authentication, set `LLM_DEFAULT_PROVIDER=gemini` or `LLM_DEFAULT_PROVIDER=google`.

### Core server settings

| Variable               | Description                                                    | Default          |
| ---------------------- | -------------------------------------------------------------- | ---------------- |
| `MCP_TRANSPORT_TYPE`   | `stdio` or `http`. Controls how the MCP server communicates.   | `stdio`          |
| `MCP_HTTP_PORT`        | Port used when `MCP_TRANSPORT_TYPE=http`.                      | `3010`           |
| `MCP_HTTP_HOST`        | Host interface for HTTP transport.                             | `127.0.0.1`      |
| `MCP_LOG_LEVEL`        | Logging level (`debug`, `info`, `warning`, ...).               | `debug`          |
| `LOGS_DIR`             | Directory where `activity.log` and `error.log` are written.    | `./logs`         |
| `LLM_DEFAULT_PROVIDER` | Default LLM provider (`gemini-cli`, `gemini`, `google`, etc.). | `gemini-cli`     |
| `LLM_DEFAULT_MODEL`    | Default LLM model.                                             | `gemini-2.5-pro` |
| `MAX_GIT_BLOB_SIZE_BYTES` | Maximum file size (bytes) for git diff analysis. Files exceeding this limit are skipped. | `4194304` (4MB) |

### Provider API keys (all optional)

**⚠️ SECURITY WARNING:** Never hardcode API keys in configuration files! Always use environment variables or system-level secret management. API keys committed to version control can be exposed and lead to unauthorized access and financial loss.

**Gemini CLI Provider (Default - Recommended):**

- Uses OAuth authentication via `gemini` CLI tool
- No API keys required
- Requires `@google/gemini-cli` installed globally
- Supports `gemini-2.5-pro` and `gemini-2.5-flash` models

**Standard API Key Providers:**
Set whichever providers you plan to call; the shared resolver looks at request parameters first and then these environment variables.

**Set API keys as environment variables** (never in config files):

- `GOOGLE_API_KEY` / `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `PERPLEXITY_API_KEY`
- `MISTRAL_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `XAI_API_KEY`
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`
- `OLLAMA_API_KEY`, `OLLAMA_HOST`

> Gemini tooling still honours `geminiApiKey` request parameters and the `GEMINI_API_KEY` environment variable for backwards compatibility when using `gemini` or `google` providers.

---

## Transports

- **STDIO (default):** Ideal for Claude Desktop or any local MCP orchestrator. Start with `npx codementor` or `npm start` and point your client at the binary.
- **HTTP:** Set `MCP_TRANSPORT_TYPE=http` (and optionally `MCP_HTTP_PORT` / `MCP_HTTP_HOST`). The server exposes the MCP streamable HTTP endpoint at `http://<host>:<port>/mcp`.

Logs for both transports land in `logs/activity.log` and `logs/error.log`. Delete the directory to reset.

### HTTP Session Store (optional Redis)

By default, HTTP sessions are tracked in-memory, which is suitable for single-process deployments. For multi-instance or clustered deployments that require session stickiness behind a load balancer, enable Redis-backed session coordination:

```bash
# Enable Redis-backed session ownership tracking
export MCP_SESSION_STORE=redis
export REDIS_URL="redis://localhost:6379"
# Optional key prefix (defaults to mcp:sessions:)
export REDIS_PREFIX="mcp:sessions:"
```

Notes:
- Only session ownership metadata is persisted (instance ID), not transport objects.
- This enables routing layers to implement stickiness based on owner instance.
- If Redis is unavailable, fallbacks to in-memory when `MCP_SESSION_STORE=memory`.
- `ioredis` is declared as an optional dependency; install it only when enabling Redis session coordination (`MCP_SESSION_STORE=redis`). It is not required for the default in-memory mode.

---

## Tool Highlights

The server exposes a comprehensive analysis workflow including:

- **Comprehensive project analysis** with expert persona selection and grouped summaries.
- **Targeted code search** utilities for locating files, functions, or patterns inside large repositories.
- **Knowledge capture tools** for usage guides, FAQ synthesis, and report generation.
- **Token accounting** (Gemini-compatible) to plan safe response sizes.
- **Project orchestration helpers** that break large codebases into manageable analysis batches.

Each tool validates input with Zod schemas and automatically records structured logs that include the request context ID for easy tracing.

---

## Code Review with Git Diff Analysis

The `gemini_codebase_analyzer` tool now supports code review mode with git diff integration:

### Review Uncommitted Changes

```json
{
  "projectPath": "./",
  "question": "Review my changes for security issues and code quality",
  "analysisMode": "review",
  "includeChanges": { "revision": "." }
}
```

### Review Specific Commit

```json
{
  "projectPath": "./",
  "question": "Analyze this commit for potential bugs",
  "analysisMode": "review",
  "includeChanges": { "revision": "a1b2c3d" }
}
```

### Review Last N Commits

```json
{
  "projectPath": "./",
  "question": "Review recent changes",
  "analysisMode": "review",
  "includeChanges": { "count": 5 }
}
```

### Review Features

- **Specialized AI Prompt**: Expert code reviewer persona with focus on security, performance, and best practices
- **Structured JSON Diff**: AI receives changes in a machine-readable format
- **Full Context**: Changes analyzed alongside entire codebase
- **Edge Case Handling**: Works with initial commits, binary files, and empty diffs
- **Large File Protection**: Files exceeding `MAX_GIT_BLOB_SIZE_BYTES` (default 4MB) are automatically skipped to prevent memory issues. Skipped files are reported in the analysis output.

#### Auto-Orchestration (large projects)

- Set `autoOrchestrate=true` on `gemini_codebase_analyzer` to automatically fall back to the project orchestrator when token limits are exceeded.
- `orchestratorThreshold` (default `0.75`) controls when to suggest/fallback based on `tokenCount / maxTokens`.
- In fallback, `analysisMode: "review"` is not supported; the flow switches to `analysisMode: "general"` and synthesizes results from grouped batches.
- Prefer `.mcpignore` to trim context; for very large repositories use `project_orchestrator_create` → `project_orchestrator_analyze`.
### Analysis Modes

The `analysisMode` parameter supports the following modes:

- `general` - Comprehensive project analysis
- `implementation` - Feature implementation guidance
- `refactoring` - Code quality improvements
- `explanation` - Educational explanations
- `debugging` - Bug identification and fixes
- `audit` - Complete code audit
- `security` - Security vulnerability assessment
- `performance` - Performance optimization
- `testing` - Test strategy and creation
- `documentation` - Documentation generation
- **`review`** - Code change review with git diff analysis ⭐ NEW

---

## Access Model

- HTTP and STDIO MCP endpoints provided by this project do not implement any built-in authentication or scope-based authorization.
- This server is intended for local and controlled environments (e.g., running alongside your editor or behind your own infrastructure).
- In production or shared environments, you MUST protect access using external mechanisms such as:
  - Reverse proxy with JWT/OIDC validation
  - mTLS
  - IP allowlists / network segmentation
  - API gateways or WAF
- Tools and resources are callable without server-side scope checks; any `withRequiredScopes` helper is a no-op kept only for backwards-compatible imports and MUST NOT be treated as a security control.

## Security & Architecture Highlights

### Secure Path Handling (BASE_DIR + validateSecurePath)

All filesystem access is constrained to a well-defined project root (`BASE_DIR`). Helper utilities (such as [`validateSecurePath`](src/mcp-server/utils/securePathValidator.ts:1)) prevent path traversal and disallow resolving files outside this base directory. This applies to codebase analysis, diff loading, and any file-backed MCP resources.

### Rate Limiting & Redis Support

The server includes a defensive rate limiter to protect upstream LLM APIs and your infrastructure.

- Default store: in-memory (suitable for local/single-node use).
- Redis backend: enable with:
  - `MCP_RATE_LIMIT_STORE=redis`
  - `REDIS_URL=redis://user:pass@host:6379/0`
- Identity hierarchy for keys (most specific wins):
  1. `userId`
  2. `clientId`
  3. `ip`
  4. `anon:global`

This allows fair usage and abuse protection across heterogeneous clients.

### Session Store

HTTP session ownership metadata follows the same pluggable pattern:

- In-memory (default) for simple/local setups.
- Redis-backed when `MCP_SESSION_STORE=redis` is set, enabling consistent routing and stickiness across multiple instances.

### CI/CD Security Controls

The recommended pipeline is hardened around secure publishing:

- Dependency scanning (e.g. `npm audit --production --audit-level=high`) on critical paths.
- CodeQL (or equivalent) static analysis for security regressions.
- Automated dependency updates (e.g. Dependabot) for timely patching.
- `publish.yml` gated on semantic version tags (`v*.*.*`) to keep releases auditable.

### Log Redaction

Sensitive values are aggressively redacted from logs.

- Configure redaction via `MCP_REDACT_KEYS` (comma-separated).
- Secrets matching these keys are masked in structured logs produced by the internal logger.

---

## Security

Security Hardening Guide:
See [docs/security-hardening.md](docs/security-hardening.md:1) for comprehensive production hardening recommendations.
In particular:
- Treat this MCP server as an internal component.
- Terminate TLS, perform authentication/authorization, and enforce network boundaries at a dedicated gateway or reverse proxy.

### Git Command Execution

The review mode executes git commands to extract diffs. Security measures:

- All revision strings are validated against a strict regex
- Shell metacharacters are blocked
- Uses `simple-git` library to prevent command injection
- Path traversal protection via `validateSecurePath`

---

## .mcpignore Support

Optimize MCP context by excluding files beyond `.gitignore`. The `.mcpignore` file works **on top of** `.gitignore` (additive) to allow you to exclude test files, documentation, and other files from AI analysis without modifying your `.gitignore`.

### How it works

1. `.gitignore` patterns are loaded first
2. `.mcpignore` patterns are added on top
3. All MCP tools (code search, token count, codebase analyzer, etc.) respect both files

### Creating .mcpignore

Copy the example file and customize as needed:

```bash
cp .mcpignore.example .mcpignore
```

### Common Use Cases

**Exclude test files from AI context:**
```gitignore
# .mcpignore
**/*.test.ts
**/*.spec.ts
**/tests/**
__tests__/**
```

**Exclude documentation:**
```gitignore
# .mcpignore
docs/**
*.md
!README.md
```

**Exclude generated files:**
```gitignore
# .mcpignore
**/generated/**
**/*.generated.ts
```

See `.mcpignore.example` for more patterns and examples.

### Backward Compatibility

- If `.mcpignore` doesn't exist, tools work normally with just `.gitignore`
- All existing `.gitignore` functionality is preserved
- The feature is completely optional

---

## Code Metadata Extraction

The server includes advanced code metadata extraction powered by **Tree-sitter AST parsing** for improved accuracy, especially with complex syntax structures (nested classes, decorators, generics).

### Supported Languages

Tree-sitter parsing is enabled for:
- **Java** - Classes, interfaces, methods, imports
- **Go** - Types, functions, imports
- **Rust** - Structs, enums, traits, functions, use statements
- **C#** - Classes, interfaces, methods, using statements
- **Ruby** - Classes, modules, methods, require statements
- **PHP** - Classes, interfaces, traits, functions, use statements
- **Python** - Classes, functions, import statements

JavaScript/TypeScript files use Babel AST parsing (already implemented).

### Hybrid Fallback Strategy

The system uses a graceful degradation approach:

1. **Tree-sitter AST parsing** (best accuracy) - Primary method for supported languages
2. **Regex pattern matching** (acceptable) - Fallback if Tree-sitter fails or unavailable
3. **Minimal metadata** (basic) - Final fallback if all parsing methods fail

This ensures the system continues to work even if grammar packages are missing or parsing encounters errors.

### Performance

- Grammar loading: <500ms on first use (cached thereafter)
- Parse time: <100ms per file (average)
- Memory overhead: <50MB for all grammar caches
- Grammar packages are loaded lazily (only when needed)

### Troubleshooting

If Tree-sitter parsing fails:
- The system automatically falls back to regex parsing
- Check that optional grammar packages are installed: `npm install`
- Grammar packages are optional dependencies - missing packages trigger regex fallback
- Check logs for detailed error messages

---

## Development Commands

| Command                             | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `npm run build`                     | Compile TypeScript into `dist/`.                                   |
| `npm start`                         | Run the compiled CLI on STDIO.                                     |
| `npm run start:local`               | Run the TypeScript entry directly with `ts-node` (honours `.env`). |
| `npm run start:http`                | Launch the compiled CLI but force HTTP transport.                  |
| `npm run lint` / `npm run lint:fix` | Static analysis with ESLint.                                       |
| `npm run docs:generate`             | Generate TypeDoc API docs.                                         |

---

## Project Layout

```
src/
├── config/            # Environment parsing & validation (now provider-key centric)
├── mcp-server/        # Reusable MCP server scaffolding (stdio + HTTP transports)
├── services/
│   └── llm-providers/ # OpenRouter helper (kept for reference)
├── simple-server.ts   # Local CLI entry with tool definitions & provider key resolver
├── utils/             # Logger, error handler, metrics, parsing, security helpers
└── index.ts           # Programmatic entry point for embedding the server
```

Legacy agent, Supabase, DuckDB, and deployment artefacts have been removed. If you need them, check the Git history before the `2.0.0` release.

## Architecture Overview

For high-level component map, request flows, dependency layers, security and performance considerations, see the architecture document:
- [docs/architecture.md](docs/architecture.md:1)

- Component map and dependency layers
- HTTP (streamable) and STDIO sequence diagrams
- Security surfaces and controls
- Performance considerations

---

## Connecting from Cursor

Cursor'da MCP kullanmak için detaylı kurulum talimatları için [`CURSOR_SETUP.md`](./CURSOR_SETUP.md) dosyasına bakın.

**Hızlı Kurulum:**

1. Gemini CLI'yi yükleyin ve authenticate olun:

```bash
npm install -g @google/gemini-cli
gemini  # "Login with Google" seçeneğini seçin
```

2. Cursor MCP config dosyasını oluşturun ve `cursor_mcp_config.json` içeriğini ekleyin.

3. Cursor'u yeniden başlatın.

## Connecting from Claude Desktop

Use the sample in [`claude_desktop_config.example.json`](./claude_desktop_config.example.json) or copy the block below and replace the values you need:

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini-cli"
      }
    }
  }
}
```

Or with API key authentication (⚠️ **SECURITY WARNING:** Never hardcode API keys in config files! Use environment variables instead):

```json
{
  "mcpServers": {
    "codementor": {
      "command": "npx",
      "args": ["-y", "codementor"],
      "env": {
        "LLM_DEFAULT_PROVIDER": "gemini"
        // DO NOT add GOOGLE_API_KEY here - set it as an environment variable instead!
      }
    }
  }
}
```

---

## Next Steps

- Drop additional tools into `simple-server.ts` or migrate them into the modular `src/mcp-server` scaffolding if you need stronger type boundaries.
- Extend the provider key resolver to cover new vendors by adding aliases in one place.
- Rebuild documentation with `npm run docs:generate` after making API changes.

Enjoy the leaner setup!
