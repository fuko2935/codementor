# Repository Guidelines for AI Agents

## Project Snapshot

Single TypeScript project implementing a Model Context Protocol (MCP) server/client. Built with TypeScript (strict mode), MCP SDK, Hono (HTTP transport), Zod (validation), and Winston (logging). Production builds compile to `dist/` via `tsc`. For detailed guidance on specific modules, see sub-folder AGENTS.md files.

---

## Root Setup Commands

**Install dependencies:**
```bash
npm install
```

**Build TypeScript (outputs to `dist/`):**
```bash
npm run build
```

**Development (ts-node with `.env`):**
```bash
npm run start:local
```

**Run compiled server (stdio, default):**
```bash
npm start
```

**Run with HTTP transport:**
```bash
npm run start:http
```

**Lint & format:**
```bash
npm run lint          # Check for issues
npm run lint:fix       # Auto-fix issues
npm run format         # Format with Prettier
```

**Typecheck (via build):**
```bash
npm run build  # TypeScript compiler validates types
```

**Run validation tests:**
```bash
npm run validate:startup     # Logger initialization check
npm run test:integration     # STDIO + HTTP transport tests
npm run test:all             # Full validation suite
```

---

## Universal Conventions

**TypeScript:**
- `strict` mode enforced
- Import paths **MUST** include `.js` extensions inside `src/` (ESM requirement)
- Target: ES2020, Module: ESNext
- All sources in `src/`, compiled output in `dist/`

**Code Style:**
- Prettier for formatting (run `npm run format` before committing)
- ESLint for static analysis (run `npm run lint:fix`)
- PascalCase for classes (`McpClientManager`)
- camelCase for functions/variables (`requestContextService`)
- UPPER_SNAKE_CASE for environment keys (`MCP_TRANSPORT_TYPE`)

**Commit Format:**
- Use Conventional Commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Keep subject lines under 72 characters
- Examples: `feat: add new auth middleware`, `fix: resolve transport startup race condition`

**Branch Strategy:**
- Feature branches from `main`
- PRs should explain scope, list key commands run, reference issues

**Pull Request Requirements:**
- All checks must pass (`npm run build && npm run lint`)
- Update documentation (README, AGENTS files) when adding config flags, tools, or commands
- For transport changes, provide logs or screenshots

---

## Security & Secrets

**Never commit:**
- `.env` files (use `.env.example` for templates)
- API keys or tokens
- Secrets in logs (use structured context, never log plaintext secrets)

**Configuration:**
- All config loaded via `src/config/index.ts` with Zod validation
- Environment variables validated at startup
- For HTTP transport auth:
  - JWT mode: Requires `MCP_AUTH_SECRET_KEY` (min 32 chars)
  - OAuth mode: Requires `OAUTH_ISSUER_URL`, `OAUTH_AUDIENCE` (+ optional `OAUTH_JWKS_URI`)

**Input Sanitization:**
- Always sanitize user-provided strings using `src/utils/security/sanitization.ts`
- Use Zod schemas for validation (see tool patterns in `src/mcp-server/tools/echoTool/`)

---

## JIT Index (What to Open, Not What to Paste)

### Package Structure

- **MCP Server**: `src/mcp-server/` → [see src/mcp-server/AGENTS.md](src/mcp-server/AGENTS.md)
  - Tools, resources, transports, authentication
- **MCP Client**: `src/mcp-client/` → [see src/mcp-client/AGENTS.md](src/mcp-client/AGENTS.md)
  - Connection manager, config loading, transport factory
- **Shared Utils**: `src/utils/` → [see src/utils/AGENTS.md](src/utils/AGENTS.md)
  - Logger, error handling, metrics, security, parsing, network
- **Services**: `src/services/llm-providers/` → LLM provider abstractions (OpenRouter, Gemini CLI)
- **Configuration**: `src/config/index.ts` → Zod-validated env parsing
- **Validation Tests**: `src/validation/` → Startup and integration validation scripts
- **Entry Points**: `src/index.ts`, `src/simple-server.ts` → Main application startup

### Quick Find Commands

**Find a tool registration:**
```bash
rg -n "register.*Tool" src/mcp-server/tools/
```

**Find a transport implementation:**
```bash
rg -n "startHttpTransport|connectStdioTransport" src/mcp-server/transports/
```

**Find a utility export:**
```bash
rg -n "export.*from" src/utils/index.ts
```

**Find error handling usage:**
```bash
rg -n "ErrorHandler\.tryCatch" src/
```

**Find logger usage:**
```bash
rg -n "logger\.(info|debug|error|warn)" src/
```

**Find configuration schema:**
```bash
rg -n "EnvSchema|z\.object" src/config/index.ts
```

**Find tool blueprints (examples):**
```bash
ls src/mcp-server/tools/echoTool/
ls src/mcp-server/tools/catFactFetcher/
```

---

## Definition of Done

Before creating a PR, ensure:

- [ ] Code compiles: `npm run build` succeeds
- [ ] Linting passes: `npm run lint` (or `npm run lint:fix`)
- [ ] If adding tools/resources: Tool blueprint pattern followed (`src/mcp-server/tools/echoTool/`)
- [ ] If modifying config: Zod schema updated in `src/config/index.ts`
- [ ] If adding utilities: Exported via `src/utils/index.ts` barrel file
- [ ] Documentation updated (README, AGENTS.md) for new config flags, commands, or tools
- [ ] Secrets never logged or committed (use structured context)
- [ ] Error handling uses `ErrorHandler.tryCatch` pattern
- [ ] Logging uses `RequestContext` (see `src/utils/internal/logger.ts`)
