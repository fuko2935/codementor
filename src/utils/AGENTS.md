# Utils Module Guide

> Not: Bu dosya geliştirici içindir; AI asistan kullanım rehberi değildir ve MCP `mcp_setup_guide` tarafından enjekte edilmez.

## Package Identity

Shared utilities for logging, error handling, metrics, security, parsing, and network operations. Used across both MCP server and client modules. Provides structured logging with RequestContext, centralized error handling, and common helpers.

**Primary Purpose**: Cross-cutting concerns, reusable utilities

---

## Setup & Run

**Build required:**
```bash
cd ../..  # From src/utils/
npm run build
```

**No separate module tests** - utilities tested via integration tests in `src/validation/`

---

## Patterns & Conventions

### Barrel Export Pattern (Critical)

All utilities exported via `index.ts` barrel files:

**✅ DO**: Export through `src/utils/index.ts`:
```typescript
// src/utils/index.ts
export * from "./internal/index.js";
export * from "./metrics/index.js";
export * from "./security/index.js";
```

**✅ DO**: Import from barrel:
```typescript
import { logger, ErrorHandler, requestContextService } from "../utils/index.js";
```

**❌ DON'T**: Import directly from subdirectories (breaks encapsulation):
```typescript
import { logger } from "../utils/internal/logger.js";  // ❌
```

**Structure**: Each subdirectory has its own `index.ts` that re-exports its contents

### Logger Pattern (Critical)

Always use structured logging with **RequestContext**:

**✅ DO**: Use logger with RequestContext:
```typescript
import { logger, requestContextService } from "../utils/index.js";

const context = requestContextService.createRequestContext({
  operation: "MyOperation",
  toolName: "my_tool",
});

logger.info("Operation started", context);
logger.debug("Debug info", { ...context, additionalData: value });
logger.error("Error occurred", { ...context, error: err });
```

**✅ DO**: Create child contexts using `parentRequestId`:
```typescript
const childContext = requestContextService.createRequestContext({
  parentRequestId: parentContext.requestId,
  operation: "ChildOperation",
});
```

**❌ DON'T**: Log without RequestContext, log plaintext secrets, use console.log

**See**: `src/utils/internal/logger.ts` for logger implementation

**Logger initialization**: Logger must be initialized before first use (handled in `src/index.ts`)

### ErrorHandler Pattern (Critical)

Wrap async operations with `ErrorHandler.tryCatch()`:

**✅ DO**: Use ErrorHandler wrapper:
```typescript
import { ErrorHandler, BaseErrorCode } from "../utils/index.js";

await ErrorHandler.tryCatch(
  async () => {
    // Operation that might throw
    await someOperation();
  },
  {
    operation: "OperationName",
    context: requestContext,
    errorCode: BaseErrorCode.INTERNAL_ERROR,
    critical: false,  // true for initialization failures
  },
);
```

**✅ DO**: Convert errors to McpError:
```typescript
import { McpError, BaseErrorCode } from "../types-global/errors.js";

throw new McpError(BaseErrorCode.INVALID_REQUEST, "Error message", { detail: value });
```

**❌ DON'T**: Let errors escape without handling, forget to set `critical: true` for initialization errors

**See**: `src/utils/internal/errorHandler.ts` for handler implementation

**Error codes**: Defined in `src/types-global/errors.ts` (`BaseErrorCode` enum)

### RequestContext Pattern

RequestContext provides traceability and structured logging:

**✅ DO**: Create context for each operation:
```typescript
const context = requestContextService.createRequestContext({
  operation: "OperationName",
  toolName: "my_tool",
  input: params,  // Optional: capture input for debugging
});
```

**✅ DO**: Pass context to utility functions:
```typescript
export async function myUtility(params: Input, context: RequestContext): Promise<Output> {
  logger.debug("Utility called", { ...context, params });
  // ...
}
```

**See**: `src/utils/internal/requestContext.ts` for context service

---

## Touch Points / Key Files

**Core utilities (exported via `index.ts`):**
- `src/utils/internal/logger.ts` - Winston logger with file/console transports
- `src/utils/internal/errorHandler.ts` - Centralized error handling wrapper
- `src/utils/internal/requestContext.ts` - RequestContext service for traceability
- `src/utils/index.ts` - Main barrel export

**Metrics:**
- `src/utils/metrics/tokenCounter.ts` - Token counting utilities
- `src/utils/metrics/index.ts` - Metrics barrel export

**Security:**
- `src/utils/security/sanitization.ts` - Input sanitization helpers
- `src/utils/security/rateLimiter.ts` - Rate limiting utilities
- `src/utils/security/idGenerator.ts` - ID generation utilities
- `src/utils/security/index.ts` - Security barrel export

**Parsing:**
- `src/utils/parsing/jsonParser.ts` - JSON parsing with error handling
- `src/utils/parsing/dateParser.ts` - Date parsing utilities
- `src/utils/parsing/index.ts` - Parsing barrel export

**Network:**
- `src/utils/network/fetchWithTimeout.ts` - Fetch with timeout wrapper
- `src/utils/network/index.ts` - Network barrel export

**Scheduling:**
- `src/utils/scheduling/` - Scheduling utilities (if present)

---

## JIT Index Hints

**Find logger initialization:**
```bash
rg -n "logger\.initialize|initialize.*logger" ../index.ts
```

**Find error handler usage:**
```bash
rg -n "ErrorHandler\.tryCatch" ../**/*.ts
```

**Find RequestContext creation:**
```bash
rg -n "requestContextService\.createRequestContext" ../**/*.ts
```

**Find utility exports:**
```bash
rg -n "export.*from" index.ts
```

**Find logger usage patterns:**
```bash
rg -n "logger\.(info|debug|error|warn)" internal/logger.ts
```

**Find security utilities:**
```bash
ls security/
```

**Find metrics utilities:**
```bash
ls metrics/
```

**Find network utilities:**
```bash
ls network/
```

---

## Common Gotchas

**1. Import from barrel**: Always import from `src/utils/index.ts`, not subdirectories

**2. RequestContext required**: Logger methods expect RequestContext - always create and pass context

**3. Logger initialization**: Logger must be initialized before first use (done in `src/index.ts` startup)

**4. ErrorHandler wrapper**: Wrap async operations that might throw - especially during initialization (`critical: true`)

**5. Error codes**: Use `BaseErrorCode` enum from `src/types-global/errors.ts`, don't hardcode error codes

**6. Secrets in logs**: Never log plaintext secrets - use structured context, sanitize sensitive data

**7. Barrel exports**: When adding new utilities, export through appropriate subdirectory `index.ts`, then re-export from main `index.ts`

**8. Context inheritance**: Use `parentRequestId` to link child operations to parent operations for traceability

---

## Pre-PR Checks

Before creating a PR for utils changes:

```bash
npm run build && npm run lint
```

**Additional checks if adding utilities:**
- [ ] Utility exported through appropriate subdirectory `index.ts`
- [ ] Utility re-exported from main `src/utils/index.ts`
- [ ] Utility uses RequestContext if it logs
- [ ] Utility uses ErrorHandler if it calls async operations
- [ ] Utility documented with JSDoc comments

**Additional checks if modifying logger/error handler:**
- [ ] Backward compatibility maintained (existing call sites still work)
- [ ] RequestContext structure unchanged (or migration path documented)
- [ ] Error codes follow existing patterns

