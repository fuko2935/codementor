# MCP Client Module Guide

> Not: Bu dosya geliştirici içindir; AI asistan kullanım rehberi değildir ve MCP `ignite` tarafından enjekte edilmez.

## Package Identity

Production-grade MCP (Model Context Protocol) client for connecting to and interacting with MCP servers. Supports both STDIO (spawns processes) and HTTP (network) transports. Designed for agent swarm scenarios where multiple independent agents connect to the same servers without interference.

**Primary Framework**: MCP SDK Client, isolated connection management

---

## Setup & Run

**Build required:**
```bash
cd ../..  # From src/mcp-client/
npm run build
```

**No separate dev server** - client is used programmatically by other modules

**Configuration file:**
- `src/mcp-client/client-config/mcp-config.json` - All server definitions (validated with Zod)

---

## Patterns & Conventions

### Manager Pattern (Critical)

Each agent should create its own **isolated `McpClientManager` instance**:

**✅ DO**: Create manager per agent:
```typescript
import { createMcpClientManager } from "./src/mcp-client";

const manager = createMcpClientManager();  // Isolated connection pool
const client = await manager.connectMcpClient("server-name");
```

**❌ DON'T**: Share manager instances between agents - each manager has isolated cache

**Key insight**: Each manager has its own private connection cache. Agent A's connection to `server-1` is separate from Agent B's connection to the same server.

### Config-Driven Pattern

All server connections defined in `mcp-config.json`:

**✅ DO**: Use config loader:
```typescript
import { loadMcpClientConfig, getMcpServerConfig } from "./src/mcp-client";

const config = loadMcpClientConfig();
const serverConfig = getMcpServerConfig("server-name");
```

**Config structure** (validated by Zod in `configLoader.ts`):
```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": { "KEY": "value" },
      "transportType": "stdio",
      "disabled": false
    }
  }
}
```

**❌ DON'T**: Hardcode server configs - use `mcp-config.json`

### Transport Factory Pattern

Transport creation handled by factory based on `transportType`:

**✅ DO**: Use factory (internal):
```typescript
// Factory handles: stdio spawns process, http creates HTTP transport
const transport = createTransport(serverConfig);
```

**stdio transport**: Spawns new server process per agent (maximum isolation)

**http transport**: Connects to shared HTTP endpoint (concurrent connections)

**See**: `src/mcp-client/transports/transportFactory.ts`

### Connection Lifecycle

**✅ DO**: Handle lifecycle properly:
```typescript
const manager = createMcpClientManager();

try {
  const client = await manager.connectMcpClient("server-name");
  // Use client...
} finally {
  await manager.disconnectAllMcpClients();  // Cleanup on shutdown
}
```

**Connection flow** (internal, `clientConnectionLogic.ts`):
1. Check manager's cache (if exists, return)
2. Load config via `configLoader.ts`
3. Create transport via `transportFactory.ts`
4. Instantiate MCP SDK `Client`
5. Set error/close handlers (call `disconnectMcpClient` on error)
6. Perform MCP handshake (`client.connect(transport)`)
7. Cache client in manager
8. Return client

---

## Touch Points / Key Files

**Core manager:**
- `src/mcp-client/core/clientManager.ts` - `McpClientManager` class (isolated connection pools)

**Configuration:**
- `src/mcp-client/client-config/configLoader.ts` - Loads and validates `mcp-config.json` with Zod
- `src/mcp-client/client-config/mcp-config.json.example` - Example config structure

**Connection logic:**
- `src/mcp-client/core/clientConnectionLogic.ts` - Step-by-step connection establishment

**Transports:**
- `src/mcp-client/transports/transportFactory.ts` - Factory for creating stdio/HTTP transports
- `src/mcp-client/transports/stdioClientTransport.ts` - STDIO transport wrapper
- `src/mcp-client/transports/httpClientTransport.ts` - HTTP transport wrapper

**Exports:**
- `src/mcp-client/index.ts` - Public API (`createMcpClientManager`, `loadMcpClientConfig`, etc.)

---

## JIT Index Hints

**Find config schema definition:**
```bash
rg -n "mcpServers|z\.object" client-config/configLoader.ts
```

**Find manager implementation:**
```bash
rg -n "class McpClientManager|connectMcpClient|disconnectMcpClient" core/clientManager.ts
```

**Find transport factory:**
```bash
rg -n "createTransport|transportType" transports/transportFactory.ts
```

**Find connection logic:**
```bash
rg -n "establishNewMcpConnection|client\.connect" core/clientConnectionLogic.ts
```

**Find error handling in client:**
```bash
rg -n "ErrorHandler\.tryCatch|onerror|onclose" core/
```

**Find all transport types:**
```bash
ls transports/
```

**Check config file location:**
```bash
find . -name "mcp-config.json*"
```

---

## Common Gotchas

**1. Manager isolation**: Each manager is isolated - don't share managers between agents if you want separate connections

**2. stdio transports spawn processes**: Each agent connecting via stdio gets its own server process (by design)

**3. http transports share endpoint**: All agents using http transport connect to the same server (concurrent connections supported)

**4. Config validation**: Config is validated with Zod at load time - invalid config throws early

**5. Error handlers**: Client sets `onerror`/`onclose` handlers that call `disconnectMcpClient` - ensures cleanup on server crashes

**6. Connection caching**: Manager caches connections - second call to `connectMcpClient` with same name returns cached client

**7. Cleanup**: Always call `disconnectAllMcpClients()` on shutdown to close all connections gracefully

**8. Config file location**: Default is `src/mcp-client/client-config/mcp-config.json` - can be overridden via environment or passed to loader

---

## Pre-PR Checks

Before creating a PR for client changes:

```bash
npm run build && npm run lint
```

**Additional checks if modifying config:**
- [ ] Zod schema updated in `configLoader.ts`
- [ ] Example config (`mcp-config.json.example`) updated if structure changed
- [ ] Transport factory handles new transport types (if adding)

**Additional checks if modifying manager:**
- [ ] Isolation guarantees preserved (each manager has own cache)
- [ ] Error handlers properly clean up on connection errors
- [ ] Lifecycle methods (`disconnectAllMcpClients`) properly close all connections

