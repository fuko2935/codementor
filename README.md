# Gemini MCP Local Tool

Gemini MCP Local is a lightweight Model Context Protocol (MCP) server that you can run directly on your machine or launch ad-hoc with `npx`. It exposes the same rich analysis workflow used in the original Smithery-compatible server without the Supabase, DuckDB, or agent dependencies. Bring your own API keys via environment variables, pick a transport (`stdio` by default, `http` when you need it), and you are ready to connect from Claude Desktop or any MCP-compliant client.

---

## Quick Start

### Run instantly with `npx`

```bash
GOOGLE_API_KEY="your-google-or-gemini-key" npx gemini-mcp-local
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

### Core server settings

| Variable | Description | Default |
| --- | --- | --- |
| `MCP_TRANSPORT_TYPE` | `stdio` or `http`. Controls how the MCP server communicates. | `stdio` |
| `MCP_HTTP_PORT` | Port used when `MCP_TRANSPORT_TYPE=http`. | `3010` |
| `MCP_HTTP_HOST` | Host interface for HTTP transport. | `127.0.0.1` |
| `MCP_LOG_LEVEL` | Logging level (`debug`, `info`, `warning`, ...). | `debug` |
| `LOGS_DIR` | Directory where `activity.log` and `error.log` are written. | `./logs` |

### Provider API keys (all optional)

Set whichever providers you plan to call; the shared resolver looks at request parameters first and then these environment variables.

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

> Gemini tooling still honours `geminiApiKey` request parameters and the `GEMINI_API_KEY` environment variable for backwards compatibility.

---

## Transports

- **STDIO (default):** Ideal for Claude Desktop or any local MCP orchestrator. Start with `npx gemini-mcp-local` or `npm start` and point your client at the binary.
- **HTTP:** Set `MCP_TRANSPORT_TYPE=http` (and optionally `MCP_HTTP_PORT` / `MCP_HTTP_HOST`). The server exposes the MCP streamable HTTP endpoint at `http://<host>:<port>/mcp`.

Logs for both transports land in `logs/activity.log` and `logs/error.log`. Delete the directory to reset.

---

## Tool Highlights

The bundled `simple-server.ts` exposes the same analysis workflow that powers the previous Smithery build, including:

- **Comprehensive project analysis** with expert persona selection and grouped summaries.
- **Targeted code search** utilities for locating files, functions, or patterns inside large repositories.
- **Knowledge capture tools** for usage guides, FAQ synthesis, and report generation.
- **Token accounting** (Gemini-compatible) to plan safe response sizes.
- **Project orchestration helpers** that break large codebases into manageable analysis batches.

Each tool validates input with Zod schemas and automatically records structured logs that include the request context ID for easy tracing.

---

## Development Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript into `dist/`. |
| `npm start` | Run the compiled CLI on STDIO. |
| `npm run start:local` | Run the TypeScript entry directly with `ts-node` (honours `.env`). |
| `npm run start:http` | Launch the compiled CLI but force HTTP transport. |
| `npm run lint` / `npm run lint:fix` | Static analysis with ESLint. |
| `npm run docs:generate` | Generate TypeDoc API docs. |

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

## Connecting from Claude Desktop

Use the sample in [`claude_desktop_config.example.json`](./claude_desktop_config.example.json) or copy the block below and replace the values you need:

```json
{
  "mcpServers": {
    "gemini-mcp-local": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-local"],
      "env": {
        "GOOGLE_API_KEY": "set-if-using-google-gemini"
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

