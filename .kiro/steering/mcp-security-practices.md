---
inclusion: always
---

# Security Practices

This document defines mandatory security practices for the CodeMentor project. All code must adhere to these security standards to prevent vulnerabilities and protect user data.

## Security Architecture

### Defense in Depth

The project implements multiple layers of security:

1. **Input Validation** - Zod schemas, path validation, sanitization
2. **Path Security** - BASE_DIR constraints, traversal prevention
3. **Authentication** - External layer (reverse proxy, mTLS)
4. **Rate Limiting** - Identity-based request throttling
5. **Logging Security** - Sensitive data redaction
6. **Dependency Security** - Automated scanning and updates

## Path Security (CRITICAL)

### BASE_DIR Constraint

**All file system operations MUST be constrained to BASE_DIR:**

```typescript
import { BASE_DIR } from "../../../index.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";

// ✅ CORRECT - Always validate paths
export async function myToolLogic(
  params: MyToolInput,
  context: RequestContext
): Promise<MyToolResponse> {
  // First line of defense
  const validPath = validateSecurePath(params.projectPath, BASE_DIR);
  
  // Now safe to use
  const files = fs.readdirSync(validPath);
  return processFiles(files);
}

// ❌ WRONG - Never use paths directly
export async function badToolLogic(params: MyToolInput) {
  // SECURITY VULNERABILITY - Path traversal possible
  const files = fs.readdirSync(params.projectPath);
  return processFiles(files);
}
```

### Path Validation Rules

The `validateSecurePath` function enforces:

1. **Non-empty** - Path cannot be empty or whitespace
2. **No null bytes** - Prevents null byte injection
3. **No absolute paths** - Only relative paths allowed
4. **No traversal** - `..` segments are blocked
5. **Within BASE_DIR** - Resolved path must be inside BASE_DIR

**Example violations:**
```typescript
// These will throw VALIDATION_ERROR
validateSecurePath("", BASE_DIR);              // Empty
validateSecurePath("/etc/passwd", BASE_DIR);   // Absolute
validateSecurePath("../../../etc", BASE_DIR);  // Traversal
validateSecurePath("path\x00.txt", BASE_DIR);  // Null byte
```

### Path Security Checklist

For every function that accepts a path parameter:

- [ ] Import `BASE_DIR` and `validateSecurePath`
- [ ] Call `validateSecurePath` as first operation
- [ ] Use validated path for all file operations
- [ ] Document path validation in JSDoc
- [ ] Test with malicious path inputs

## Input Sanitization

### Sanitization Utilities

**Use appropriate sanitization for each input type:**

```typescript
import { sanitization } from "../../../utils/index.js";

// HTML content
const safeHtml = sanitization.sanitizeHtml(userHtml);

// URLs
const safeUrl = sanitization.sanitizeUrl(userUrl);

// File paths
const safePath = sanitization.sanitizePath(userPath);

// Text content
const safeText = sanitization.sanitizeText(userText);

// Numbers
const safeNumber = sanitization.sanitizeNumber(userNumber);

// JSON
const safeJson = sanitization.sanitizeJson(userJson);
```

### Logging Sanitization (MANDATORY)

**Always sanitize before logging:**

```typescript
// ✅ CORRECT - Sanitized logging
logger.info("User input received", {
  ...context,
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG - May leak secrets
logger.info("User input received", {
  ...context,
  params  // May contain API keys, tokens, passwords
});
```

### Sensitive Field Redaction

The sanitization layer automatically redacts these fields:

- `password`
- `token`
- `secret`
- `key`
- `apiKey`
- `access_key`
- `secret_key`
- `api_token`
- `authorization`
- `jwt`

**Example:**
```typescript
const input = {
  username: "user",
  password: "secret123",
  apiKey: "sk-1234567890"
};

const sanitized = sanitization.sanitizeForLogging(input);
// Result: { username: "user", password: "[REDACTED]", apiKey: "[REDACTED]" }
```

## Secrets Management

### Environment Variables Only

**NEVER hardcode secrets:**

```typescript
// ❌ WRONG - Hardcoded secret
const apiKey = "sk-1234567890abcdef";
const dbPassword = "mypassword123";

// ✅ CORRECT - From environment
import { config } from "../../../config/index.js";
const apiKey = config.GOOGLE_API_KEY;
const dbPassword = config.DATABASE_PASSWORD;
```

### Configuration Validation

**All secrets MUST be validated at startup:**

```typescript
// In config/index.ts
export const configSchema = z.object({
  GOOGLE_API_KEY: z.string()
    .min(1, "GOOGLE_API_KEY is required")
    .optional(),
  MCP_AUTH_SECRET_KEY: z.string()
    .min(32, "MCP_AUTH_SECRET_KEY must be at least 32 characters")
    .optional()
});

// Fails fast on startup if invalid
export const config = configSchema.parse(process.env);
```

### Secret Storage Best Practices

**Development:**
- Use `.env` file (gitignored)
- Never commit `.env` to version control
- Provide `.env.example` with dummy values

**Production:**
- Use secret management service (AWS Secrets Manager, HashiCorp Vault)
- Use environment variables from orchestrator (Kubernetes secrets, Docker secrets)
- Rotate secrets regularly
- Use different secrets per environment

## Git Command Security

### Revision Validation

**Always validate git revisions:**

```typescript
import { validateRevision } from "../../utils/gitDiffAnalyzer.js";

// ✅ CORRECT - Validated revision
const revision = validateRevision(params.revision);
const diff = await git.diff([revision]);

// ❌ WRONG - Unvalidated revision (command injection risk)
const diff = await git.diff([params.revision]);
```

### Allowed Revision Formats

The `validateRevision` function allows:

- Commit hashes: `a1b2c3d`, `a1b2c3d4e5f6`
- Branches: `main`, `feature/branch-name`
- Tags: `v1.0.0`, `release-2024`
- Ranges: `main..feature`, `HEAD~3..HEAD`
- Special: `.` (uncommitted changes), `HEAD`, `HEAD~1`

**Blocked patterns:**
- Shell metacharacters: `;`, `|`, `&`, `$`, `` ` ``
- Command injection: `$(command)`, `` `command` ``
- Path traversal: `../../../`

### Safe Git Operations

```typescript
import simpleGit from "simple-git";

// ✅ CORRECT - Using simple-git (no shell execution)
const git = simpleGit(validatedPath);
const diff = await git.diff([validatedRevision]);

// ❌ WRONG - Direct shell execution
const { stdout } = await exec(`git diff ${params.revision}`);
```

## Rate Limiting

### Identity-Based Rate Limiting

**Rate limits are applied based on identity hierarchy:**

1. `userId` (if authenticated) → `id:{userId}`
2. `clientId` (if provided) → `client:{clientId}`
3. IP address → `ip:{address}`
4. Anonymous → `anon:global`

```typescript
// In HTTP transport
const context = {
  userId: authContext?.userId,
  clientId: req.header("x-client-id"),
  ip: req.header("x-forwarded-for") || req.ip
};

const rateLimitResult = await rateLimiter.check("http:mcp", context);

if (rateLimitResult.allowed === false) {
  return c.json({
    error: {
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
      retryAfter: rateLimitResult.retryAfter
    }
  }, 429);
}
```

### Rate Limit Configuration

**Configure appropriate limits:**

```bash
# .env
RATE_LIMIT_WINDOW_MS=60000        # 1 minute window
RATE_LIMIT_MAX_REQUESTS=100       # 100 requests per window
RATE_LIMIT_STORE=memory           # or 'redis' for distributed
```

### Rate Limit Best Practices

- **Authenticated users** - Higher limits (100-1000 req/min)
- **Anonymous users** - Lower limits (10-50 req/min)
- **Expensive operations** - Separate, stricter limits
- **Production** - Use Redis for distributed rate limiting

## Authentication & Authorization

### External Authentication Model

**This server does NOT implement authentication:**

```typescript
// ❌ WRONG - Don't implement auth in this server
server.tool("my_tool", "desc", schema, async (params) => {
  if (!validateJWT(params.token)) {
    throw new Error("Unauthorized");
  }
  // ...
});

// ✅ CORRECT - Assume auth is handled externally
server.tool("my_tool", "desc", schema, async (params, mcpContext) => {
  // mcpContext.userId is already validated by external layer
  const context = requestContextService.createRequestContext({
    userId: mcpContext?.userId,
    clientId: mcpContext?.clientId
  });
  // ...
});
```

### Recommended External Auth

**Production deployments MUST use:**

1. **Reverse Proxy with JWT/OIDC**
   - Nginx, Envoy, Traefik
   - Validates tokens before forwarding
   - Adds user context to headers

2. **mTLS (Mutual TLS)**
   - Client certificate validation
   - Strong cryptographic identity

3. **API Gateway**
   - AWS API Gateway, Kong, Apigee
   - Centralized auth and rate limiting

4. **Network Segmentation**
   - Private network only
   - VPN or zero-trust network

### Scope Checking (No-Op)

**The `withRequiredScopes` helper is a no-op:**

```typescript
// This does NOT enforce security
const handler = withRequiredScopes(["codebase:read"], async (params) => {
  // ...
});

// It's kept for backwards compatibility only
// Real scope enforcement MUST be done externally
```

## Size Limits and Resource Protection

### File Size Limits

**Enforce size limits to prevent DoS:**

```typescript
// Git blob size limit
const MAX_GIT_BLOB_SIZE_BYTES = config.MAX_GIT_BLOB_SIZE_BYTES || 4194304; // 4MB

if (fileSize > MAX_GIT_BLOB_SIZE_BYTES) {
  logger.info("Skipping large file", {
    ...context,
    file,
    size: fileSize,
    limit: MAX_GIT_BLOB_SIZE_BYTES
  });
  return null;  // Skip, don't fail
}
```

### Token Limits

**Enforce token limits for LLM operations:**

```typescript
const MAX_PROJECT_TOKENS = 20_000_000;  // 20M tokens

if (tokenCount > MAX_PROJECT_TOKENS) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Project exceeds maximum token limit",
    {
      tokenCount,
      maxTokens: MAX_PROJECT_TOKENS,
      suggestion: "Use .mcpignore to exclude files or analyze subdirectories"
    }
  );
}
```

### Memory Limits

**Stream large files instead of loading into memory:**

```typescript
// ✅ CORRECT - Streaming
const stream = fs.createReadStream(filePath);
for await (const chunk of stream) {
  processChunk(chunk);
}

// ❌ WRONG - Loads entire file into memory
const content = fs.readFileSync(filePath, "utf-8");
processContent(content);
```

## Dependency Security

### Automated Scanning

**CI pipeline includes security checks:**

```yaml
# .github/workflows/ci.yml
- name: Security audit
  run: npm audit --production --audit-level=high

- name: CodeQL analysis
  uses: github/codeql-action/analyze@v2
```

### Dependency Updates

**Dependabot configuration:**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 10
```

### Dependency Best Practices

- Review dependency updates before merging
- Pin exact versions in `package-lock.json`
- Audit new dependencies before adding
- Remove unused dependencies regularly
- Use `npm audit` locally before committing

## Transport Security

### STDIO Transport

**STDIO is secure by design:**
- Runs in same process as client
- No network exposure
- Inherits client's security context

**Best for:**
- Local IDE integrations (Cursor, VS Code)
- Desktop applications (Claude Desktop)
- Single-user development environments

### HTTP Transport

**HTTP requires external security:**

```typescript
// ❌ WRONG - Direct internet exposure
MCP_TRANSPORT_TYPE=http
MCP_HTTP_HOST=0.0.0.0  // Exposed to internet
MCP_HTTP_PORT=3010

// ✅ CORRECT - Behind reverse proxy
MCP_TRANSPORT_TYPE=http
MCP_HTTP_HOST=127.0.0.1  // Localhost only
MCP_HTTP_PORT=3010
// Reverse proxy handles TLS, auth, rate limiting
```

### HTTPS/TLS

**Always use TLS in production:**

```nginx
# Nginx reverse proxy
server {
  listen 443 ssl http2;
  server_name mcp.example.com;
  
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  
  location /mcp {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### CORS Configuration

**Restrict allowed origins:**

```bash
# .env
MCP_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

```typescript
// In HTTP transport
app.use("*", cors({
  origin: config.MCP_ALLOWED_ORIGINS.split(","),
  credentials: true
}));
```

## Logging Security

### Structured Logging

**Use structured logging with sanitization:**

```typescript
// ✅ CORRECT
logger.info("Operation started", {
  ...context,
  operation: "analyze_codebase",
  params: sanitization.sanitizeForLogging(params)
});

// ❌ WRONG - Unstructured, may leak secrets
console.log(`User ${params.userId} with key ${params.apiKey} started operation`);
```

### Log Levels in Production

**Set appropriate log level:**

```bash
# Development
MCP_LOG_LEVEL=debug

# Production
MCP_LOG_LEVEL=info  # or warning
```

### Log Retention

**Implement log rotation:**

```typescript
// Winston configuration
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: "error.log",
      level: "error",
      maxsize: 10485760,  // 10MB
      maxFiles: 5,
      tailable: true
    })
  ]
});
```

## Security Testing

### Security Test Cases

**Test security controls:**

```typescript
describe("Path Security", () => {
  it("should reject path traversal attempts", async () => {
    const params = { projectPath: "../../../etc/passwd" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining("traversal")
      });
  });

  it("should reject absolute paths", async () => {
    const params = { projectPath: "/etc/passwd" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR
      });
  });

  it("should reject null byte injection", async () => {
    const params = { projectPath: "path\x00.txt" };
    await expect(myToolLogic(params, context))
      .rejects.toMatchObject({
        code: BaseErrorCode.VALIDATION_ERROR
      });
  });
});

describe("Input Sanitization", () => {
  it("should redact sensitive fields in logs", () => {
    const input = {
      username: "user",
      password: "secret",
      apiKey: "sk-123"
    };
    const sanitized = sanitization.sanitizeForLogging(input);
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.apiKey).toBe("[REDACTED]");
  });
});

describe("Rate Limiting", () => {
  it("should block requests after limit exceeded", async () => {
    // Make requests up to limit
    for (let i = 0; i < 100; i++) {
      await rateLimiter.check("test", context);
    }
    
    // Next request should be blocked
    const result = await rateLimiter.check("test", context);
    expect(result.allowed).toBe(false);
  });
});
```

## Security Checklist

Before deploying or merging code:

### Input Validation
- [ ] All paths validated with `validateSecurePath`
- [ ] All inputs validated with Zod schemas
- [ ] Git revisions validated with `validateRevision`
- [ ] Size limits enforced for files and requests

### Secrets Management
- [ ] No hardcoded secrets in code
- [ ] All secrets from environment variables
- [ ] `.env` file in `.gitignore`
- [ ] Secrets sanitized in logs

### Authentication & Authorization
- [ ] External auth layer documented
- [ ] No auth logic in server code
- [ ] User context propagated correctly

### Rate Limiting
- [ ] Rate limits configured appropriately
- [ ] Identity-based rate limiting implemented
- [ ] Rate limit errors handled gracefully

### Logging
- [ ] Structured logging used throughout
- [ ] Sensitive data sanitized before logging
- [ ] Appropriate log levels set
- [ ] Request context included in logs

### Dependencies
- [ ] `npm audit` passes with no high/critical issues
- [ ] Dependencies up to date
- [ ] No unused dependencies
- [ ] Lock file committed

### Transport Security
- [ ] STDIO for local use only
- [ ] HTTP behind reverse proxy in production
- [ ] TLS/HTTPS enforced
- [ ] CORS configured restrictively

### Testing
- [ ] Security test cases added
- [ ] Path traversal tests pass
- [ ] Input sanitization tests pass
- [ ] Rate limiting tests pass

## Security Incident Response

### If a vulnerability is discovered:

1. **Assess severity** - CVSS score, exploitability
2. **Create private security advisory** - GitHub Security tab
3. **Develop fix** - In private branch
4. **Test thoroughly** - Security and regression tests
5. **Coordinate disclosure** - CVE if needed
6. **Release patch** - Semantic versioning (patch bump)
7. **Notify users** - Security advisory, changelog
8. **Post-mortem** - Document lessons learned

### Security Contacts

- Report vulnerabilities via GitHub Security Advisories
- Do not disclose publicly until patch is available
- Include reproduction steps and impact assessment
