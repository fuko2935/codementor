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

> **Note:** For high‑traffic or production environments, using an API Key with the native SDK is recommended to avoid the `stdoutLock` bottleneck.

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

### HTTP Authentication (Optional)

For HTTP transport, you can enable simple API key authentication:

```bash
# Set an API key to require authentication
export MCP_API_KEY="your-secure-api-key-here"
export MCP_TRANSPORT_TYPE=http
npm start
```

When `MCP_API_KEY` is set, all HTTP requests must include the API key via:
- **Authorization header:** `Authorization: Bearer <your-api-key>`
- **Custom header:** `x-api-key: <your-api-key>`

If no `MCP_API_KEY` is configured, authentication is disabled and all requests are allowed (suitable for local development).

> **⚠️ Security Note:** This is a lightweight authentication mechanism suitable for development and trusted environments. For production deployments, use a reverse proxy with proper JWT/OIDC authentication, mTLS, or API gateway.

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

> **⚠️ Multi-Instance Deployment Warning:**  
> When running multiple server instances (cluster/Kubernetes) with HTTP transport, you **MUST** enable **Sticky Session (Session Affinity)** on your load balancer. Without sticky sessions, SSE (Server-Sent Events) connections may break when requests are routed to different instances. Use Redis-backed session coordination (`MCP_SESSION_STORE=redis`) to track session ownership across instances.

---

## Tool Highlights

The server exposes a comprehensive analysis workflow including:

- **Comprehensive project analysis** with expert persona selection and AI-powered insights.
- **Targeted code search** utilities for locating files, functions, or patterns inside large repositories.
- **Knowledge capture tools** for usage guides, FAQ synthesis, and report generation.
- **Token accounting** (Gemini-compatible) to plan safe response sizes with git diff support.
- **Efficient codebase analysis** with smart context filtering via .mcpignore and subdirectory analysis.

Each tool validates input with Zod schemas and automatically records structured logs that include the request context ID for easy tracing.

---

## Tool Highlights

The server exposes a comprehensive analysis workflow via the **CodeMentor Elemental Suite**:

- **🔥 ignite**: Initializes your project, sets up optimization rules, and prepares the environment.
- **👁️ insight**: The core analysis engine. Reviews code, explains architecture, and finds bugs using Gemini.
- **🔨 forge**: Creates specialized expert personas (e.g., "Database Optimizer", "Security Auditor") tailored to your project.
- **⚖️ weigh**: Calculates token usage to help you plan analysis strategies and avoid limits.

---

## Code Review with Git Diff Analysis

The `insight` tool supports code review mode with git diff integration:

### Review Uncommitted Changes

```json
{
  "tool_name": "insight",
  "params": {
    "projectPath": "./",
    "question": "Review my changes for security issues and code quality",
    "analysisMode": "review",
    "includeChanges": { "revision": "." }
  }
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

#### Handling Large Projects

For projects that exceed token limits, use these strategies:

1. **Use `.mcpignore`**: Add patterns to exclude unnecessary files (similar to `.gitignore`)
   ```
   node_modules/
   dist/
   *.test.ts
   docs/
   ```

2. **Use `temporaryIgnore`**: Exclude files for a specific analysis
   ```json
   {
     "projectPath": "./",
     "question": "Analyze core logic",
     "temporaryIgnore": ["tests/**", "docs/**"]
   }
   ```

3. **Analyze subdirectories**: Focus on specific parts of your project
   ```json
   {
     "projectPath": "./src/core",
     "question": "Review core functionality"
   }
   ```

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

## Custom Analysis Modes

CodeMentor now supports **custom analysis modes** that allow you to create, save, and reuse specialized expert prompts for code analysis.

### Creating a Custom Mode

Use `forge` with the `saveAs` parameter to save your custom mode:

```json
{
  "tool_name": "forge",
  "params": {
    "expertiseHint": "Create a React performance optimization expert",
    "withAi": true,
    "saveAs": "react-perf-expert"
  }
}
```

This creates `.mcp/analysis_modes/react-perf-expert.md` in your project.

### Listing Available Modes

List all available analysis modes (standard + custom):

```json
{
  "tool_name": "forge",
  "params": {
    "action": "list"
  }
}
```

### Deleting a Custom Mode

Remove a custom analysis mode:

```json
{
  "tool_name": "forge",
  "params": {
    "action": "delete",
    "modeName": "react-perf-expert"
  }
}
```

### Using a Custom Mode

Reference your saved mode in `insight` with the `custom:` prefix:

```json
{
  "tool_name": "insight",
  "params": {
    "projectPath": ".",
    "analysisMode": "custom:react-perf-expert",
    "question": "Analyze the ProductDetail component for performance issues"
  }
}
```

### Benefits

- ✅ **Reusable**: Create once, use many times
- ✅ **Shareable**: Commit to version control for team use
- ✅ **Flexible**: Manual, AI-assisted, or project-specific modes
- ✅ **Organized**: Stored in `.mcp/analysis_modes/` directory
- ✅ **Manageable**: List and delete modes as needed (v5.1.0+)

**📖 For complete documentation, see [CUSTOM_ANALYSIS_MODES.md](CUSTOM_ANALYSIS_MODES.md)**

**📖 For forge tool details, see [docs/tools/forge.md](docs/tools/forge.md)**

---

## Security / Authentication

### API Key Authentication (HTTP Transport)

When using the HTTP transport, the server supports simple API key authentication via the `MCP_API_KEY` environment variable:

```bash
# Enable API key authentication
export MCP_API_KEY="your-secure-api-key-here"
export MCP_TRANSPORT_TYPE=http
npm start
```

**Authentication Methods:**
- **Authorization header:** `Authorization: Bearer <your-api-key>`
- **Custom header:** `x-api-key: <your-api-key>`

If no `MCP_API_KEY` is configured, authentication is disabled and all requests are allowed (suitable for local development).

### Production Security Recommendations

**⚠️ Important Security Notes:**
- No JWT/OAuth layer is provided by the server itself
- The API key authentication is a lightweight mechanism suitable for development and trusted environments
- For production deployments, place a reverse proxy (e.g., Nginx) in front of the server for additional security

**Recommended Production Setup:**
- Use a reverse proxy with proper authentication/authorization
- Implement TLS termination at the proxy level
- Consider mTLS, JWT/OIDC validation, or API gateway solutions
- Apply network segmentation and IP allowlists
- Use Web Application Firewall (WAF) for additional protection

### Access Model

- HTTP and STDIO MCP endpoints do not implement built-in scope-based authorization
- This server is intended for local and controlled environments (e.g., running alongside your editor or behind your own infrastructure)
- Tools and resources are callable without server-side scope checks; any `withRequiredScopes` helper is a no-op kept only for backwards-compatible imports and MUST NOT be treated as a security control

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

**Security Hardening Guide:**
For comprehensive production hardening recommendations, see `docs/security-hardening.md` in the repository.

**Key Security Principles:**
- Treat this MCP server as an internal component
- Terminate TLS at a reverse proxy or API gateway
- Perform authentication/authorization at the gateway level
- Enforce network boundaries and IP allowlists
- Never hardcode API keys in configuration files

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
├── config/            # Environment parsing & validation with Zod schemas
├── mcp-server/        # Reusable MCP server scaffolding (STDIO + HTTP transports)
│   ├── tools/        # MCP tool implementations
│   ├── transports/   # STDIO and HTTP transport layers
│   └── utils/        # Server-specific utilities
├── services/
│   └── llm-providers/ # LLM provider integrations (Gemini CLI, OpenRouter, etc.)
├── utils/             # Shared utilities (logging, error handling, security, parsing)
├── types-global/      # Global type definitions
└── index.ts           # Main entry point and CLI bootstrap
```

**Note:** Legacy agent, Supabase, DuckDB, and deployment artifacts have been removed. If you need them, check the Git history before the `2.0.0` release.

## Architecture Overview

The codebase follows a layered architecture with clear separation of concerns:

- **Entry Point** (`src/index.ts`): Programmatic bootstrap for embedding the MCP server
- **Configuration** (`src/config/`): Environment parsing & validation with Zod
- **MCP Server** (`src/mcp-server/`): Reusable server scaffolding with STDIO and HTTP transports
- **Tools** (`src/mcp-server/tools/`): MCP tool implementations (analysis, token counting, etc.)
- **Services** (`src/services/`): External service integrations (LLM providers)
- **Utilities** (`src/utils/`): Shared utilities (logging, error handling, security, parsing)

For detailed architecture documentation including component maps, request flows, and security considerations, see the `docs/` directory in the repository.

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

## Known Limitations

### Gemini CLI Provider Concurrency

When using the `gemini-cli` provider (default), concurrent requests are serialized to prevent stdout conflicts. This is a known limitation of the `ai-sdk-provider-gemini-cli` library.

**Impact:**
- Multiple simultaneous requests will be processed sequentially
- May affect performance under high load
- Not an issue for typical single-user IDE usage

**Workarounds:**
- For high-concurrency scenarios, use API key-based providers (`gemini`, `google`, `openai`)
- Set `LLM_DEFAULT_PROVIDER=gemini` and provide `GOOGLE_API_KEY` environment variable
- API key providers support full concurrent request processing

**Example:**
```bash
# Switch to API key provider for better concurrency
export GOOGLE_API_KEY="your-api-key"
export LLM_DEFAULT_PROVIDER=gemini
npx codementor
```

This limitation is documented in the codebase at `src/services/llm-providers/geminiCliProvider.ts` and does not affect the security or correctness of the system.

---

## Next Steps

- Add new tools to `src/mcp-server/tools/` following the established pattern (see `.kiro/steering/mcp-workflows.md`)
- Extend LLM provider support by adding new providers to `src/services/llm-providers/`
- Rebuild API documentation with `npm run docs:generate` after making changes
- Customize analysis modes with `forge` for your specific use cases

Enjoy the leaner setup!