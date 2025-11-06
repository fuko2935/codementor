# Gemini MCP Local Tool

Gemini MCP Local is a lightweight Model Context Protocol (MCP) server that you can run directly on your machine or launch ad-hoc with `npx`. It exposes the same rich analysis workflow used in the original Smithery-compatible server without the Supabase, DuckDB, or agent dependencies. Bring your own API keys via environment variables, pick a transport (`stdio` by default, `http` when you need it), and you are ready to connect from Claude Desktop or any MCP-compliant client.

---

## Quick Start

### Run instantly with `npx`

**With Gemini CLI Provider (Default - OAuth):**

```bash
# Make sure gemini CLI is installed and authenticated
npm install -g @google/gemini-cli
gemini  # Then select "Login with Google"

# Run the server
npx gemini-mcp-local
```

**With API Key (Alternative):**

```bash
# ⚠️ SECURITY WARNING: Never hardcode API keys in config files!
# Set the API key as an environment variable instead:
export GOOGLE_API_KEY="your-google-or-gemini-key"
LLM_DEFAULT_PROVIDER=gemini npx gemini-mcp-local
```

The CLI starts on STDIO transport by default so it is immediately ready for Claude Desktop and other local MCP clients.

### Install locally

```bash
git clone <repo-url>
cd gemini-mcp-local
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

- **STDIO (default):** Ideal for Claude Desktop or any local MCP orchestrator. Start with `npx gemini-mcp-local` or `npm start` and point your client at the binary.
- **HTTP:** Set `MCP_TRANSPORT_TYPE=http` (and optionally `MCP_HTTP_PORT` / `MCP_HTTP_HOST`). The server exposes the MCP streamable HTTP endpoint at `http://<host>:<port>/mcp`.

Logs for both transports land in `logs/activity.log` and `logs/error.log`. Delete the directory to reset.

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

## Security

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
    "gemini-mcp-local": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-local"],
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
    "gemini-mcp-local": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-local"],
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
