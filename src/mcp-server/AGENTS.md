# MCP Server Module Guide

## Package Identity

MCP (Model Context Protocol) server implementation providing tools, resources, and transport layers (stdio/HTTP). Built on `@modelcontextprotocol/sdk`, supports both STDIO (for local processes) and HTTP (for network services). All tools and resources register with a transport-agnostic `McpServer` instance created in `server.ts`.

**Primary Framework**: MCP SDK, Hono (HTTP transport)

---

## Setup & Run

**Build required:**
```bash
cd ../..  # From src/mcp-server/
npm run build
```

**No separate dev server** - server runs via root entry points:
- `npm run start:local` (ts-node, `src/index.ts`)
- `npm start` (compiled, `dist/index.js`)

**Test transport integration:**
```bash
npm run test:integration  # Tests both stdio and HTTP transports
```

---

## Patterns & Conventions

### Tool Structure (Critical Pattern)

Every tool follows a **three-file structure**:

1. **`logic.ts`**: Zod schemas + core business logic
2. **`registration.ts`**: SDK registration + error handling wrapper
3. **`index.ts`**: Barrel export (`export { registerXTool } from "./registration.js"`)

**✅ DO**: Copy pattern from `src/mcp-server/tool-blueprints/echoTool/` (synchronous blueprint) or `src/mcp-server/tool-blueprints/catFactFetcher/` (async/external API blueprint) or `src/mcp-server/tool-blueprints/imageTest/` (image/blob handling blueprint)

**Example structure:**
```
tools/myNewTool/
├── logic.ts          # Zod schema + core function
├── registration.ts   # registerMyNewTool(server: McpServer)
└── index.ts          # export { registerMyNewTool }
```

**✅ Tool logic pattern** (`logic.ts`):
```typescript
import { z } from "zod";

export const MyToolInputSchema = z.object({
  param: z.string().min(1).describe("Parameter description"),
});

export type MyToolInput = z.infer<typeof MyToolInputSchema>;

export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext,
): Promise<MyToolResponse> {
  // Core logic here
}
```

**✅ Tool registration pattern** (`registration.ts`):
```typescript
import { ErrorHandler, logger, requestContextService } from "../../../utils/index.js";
import { MyToolInputSchema, myToolLogic } from "./logic.js";

export const registerMyTool = async (server: McpServer): Promise<void> => {
  const context = requestContextService.createRequestContext({
    operation: "RegisterTool",
    toolName: "my_tool",
  });

  await ErrorHandler.tryCatch(
    async () => {
      server.tool(
        "my_tool",
        "Tool description",
        MyToolInputSchema.shape,
        async (params, mcpContext): Promise<CallToolResult> => {
          const handlerContext = requestContextService.createRequestContext({
            parentRequestId: context.requestId,
            operation: "HandleToolRequest",
            toolName: "my_tool",
          });
          try {
            const result = await myToolLogic(params, handlerContext);
            return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
          } catch (error) {
            // Error handling...
          }
        },
      );
    },
    { operation: "RegisterTool_my_tool", context, errorCode: BaseErrorCode.INITIALIZATION_FAILED, critical: true },
  );
};
```

**❌ DON'T**: Mix logic and registration in one file, skip Zod validation, forget ErrorHandler wrapper

### Resource Pattern

Resources follow similar structure: `logic.ts` + `registration.ts` + `index.ts`

**✅ DO**: See `src/mcp-server/resources/echoResource/` as example

**Resource registration uses** `server.resource()` instead of `server.tool()`:
```typescript
server.resource(
  "resource-name",
  { uri: "template://{param}" },
  { name: "Resource Name" },
  async (uri, params) => {
    // Return { contents: [{ uri, blob, mimeType }] }
  },
);
```

### Transport Pattern

**Transport-agnostic registration**: Tools/resources register on `McpServer` instance before transport starts. Transport selection happens in `server.ts` based on `MCP_TRANSPORT_TYPE`.

**✅ DO**: Register tools in `createMcpServerInstance()` (see `server.ts:66-80`)

**✅ DO**: Transport setup separated in `startTransport()`:
- STDIO: `connectStdioTransport(server, context)` (`src/mcp-server/transports/stdioTransport.ts`)
- HTTP: `startHttpTransport(createMcpServerInstance, context)` (`src/mcp-server/transports/httpTransport.ts`)

**❌ DON'T**: Add transport-specific code in tool logic; transports are selected at server startup

### Authentication (HTTP Transport Only)

**Two modes** (configurable via `MCP_AUTH_MODE`):

1. **JWT mode** (default): Uses `MCP_AUTH_SECRET_KEY` for signing
2. **OAuth mode**: Validates Bearer tokens from external issuer

**✅ DO**: Use `withRequiredScopes()` in tool/resource handlers for scope checks:
```typescript
import { withRequiredScopes } from "../../transports/auth/index.js";

async (params) => {
  withRequiredScopes(["tool:use"]);  // Throws if missing scope
  // ... tool logic
}
```

**See**: `src/mcp-server/transports/auth/` for auth utilities

---

## Touch Points / Key Files

**Server initialization:**
- `src/mcp-server/server.ts` - Main server lifecycle (`createMcpServerInstance`, `startTransport`)

**Tool blueprints (DO NOT REMOVE - architectural examples):**
- `src/mcp-server/tool-blueprints/echoTool/` - Synchronous tool pattern
- `src/mcp-server/tool-blueprints/catFactFetcher/` - Async/external API pattern
- `src/mcp-server/tool-blueprints/imageTest/` - Image/blob handling pattern

**Resource blueprints (DO NOT REMOVE - architectural examples):**
- `src/mcp-server/resource-blueprints/echoResource/` - Basic resource pattern

**Transport implementations:**
- `src/mcp-server/transports/stdioTransport.ts` - STDIO wrapper
- `src/mcp-server/transports/httpTransport.ts` - HTTP with Hono + middleware
- `src/mcp-server/transports/auth/` - JWT/OAuth middleware

**Resource blueprint:**
- `src/mcp-server/resource-blueprints/echoResource/` - Basic resource pattern (architectural example only, not active)

**Prompts & utilities:**
- `src/mcp-server/prompts.ts` - System prompts for LLM tools
- `src/mcp-server/utils/tokenizer.ts` - Token counting utilities

---

## JIT Index Hints

**Find all tool registrations:**
```bash
rg -n "register.*Tool" tools/
```

**Find where tools are registered in server.ts:**
```bash
rg -n "await register.*Tool\|await register.*Resource" server.ts
```

**Find transport selection logic:**
```bash
rg -n "startHttpTransport|connectStdioTransport" server.ts
```

**Find a specific tool's logic:**
```bash
rg -n "export.*Logic" tools/myTool/logic.ts
```

**Find error handling patterns in tools:**
```bash
rg -n "ErrorHandler\.tryCatch" tools/**/registration.ts
```

**Find authentication usage:**
```bash
rg -n "withRequiredScopes" tools/
```

**List all tools:**
```bash
ls tools/
```

**Find resource registrations:**
```bash
rg -n "register.*Resource" resources/
```

---

## Common Gotchas

**1. Import extensions**: Always use `.js` extensions in imports (ESM requirement):
```typescript
import { logger } from "../../utils/index.js";  // ✅
import { logger } from "../../utils/index";      // ❌
```

**2. ErrorHandler wrapper**: Always wrap registration in `ErrorHandler.tryCatch()`:
```typescript
await ErrorHandler.tryCatch(async () => { /* registration */ }, { operation, context, errorCode, critical: true });
```

**3. Transport agnostic**: Tool logic doesn't know about transport - don't add transport checks in tools

**4. RequestContext**: Always pass `RequestContext` to tool logic functions for logging

**5. Return format**: Tool handlers MUST return `CallToolResult`: `{ content: Array<{type: "text", text: string}>, isError: boolean }`

**6. Zod schema shape**: Use `.shape` when passing to `server.tool()`:
```typescript
server.tool("name", "desc", MySchema.shape, handler);  // ✅
server.tool("name", "desc", MySchema, handler);        // ❌
```

**7. Tool names**: Use snake_case for tool names (e.g., `echo_message`, not `echoMessage`)

---

## Pre-PR Checks

Before creating a PR for server changes:

```bash
npm run build && npm run lint
```

**Additional checks if adding tools:**
- [ ] Tool follows three-file structure (`logic.ts`, `registration.ts`, `index.ts`)
- [ ] Tool registered in `server.ts` `createMcpServerInstance()`
- [ ] Zod schema validates all inputs
- [ ] ErrorHandler.tryCatch wraps registration
- [ ] RequestContext passed to logic function
- [ ] Return format matches `CallToolResult` type

