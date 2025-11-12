/**
 * @fileoverview Configures and starts the Streamable HTTP MCP transport using Hono.
 * This module integrates the `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`
 * into a Hono web server. Its responsibilities include:
 * - Creating a Hono server instance.
 * - Applying and configuring middleware for CORS and rate limiting.
 * - Defining the routes (`/mcp` endpoint for POST, GET, DELETE) to handle the MCP lifecycle.
 * - Orchestrating session management by mapping session IDs to SDK transport instances.
 * - Implementing port-binding logic with automatic retry on conflicts.
 *
 * The underlying implementation of the MCP Streamable HTTP specification, including
 * Server-Sent Events (SSE) for streaming, is handled by the SDK's transport class.
 *
 * Specification Reference:
 * https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx#streamable-http
 * @module src/mcp-server/transports/httpTransport
 */

import { HttpBindings, serve, ServerType } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Context, Hono, Next } from "hono";
import { cors } from "hono/cors";
import http from "http";
import { randomUUID } from "node:crypto";
import { config } from "../../config/index.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import {
  logger,
  RequestContext,
  requestContextService,
} from "../../utils/index.js";
import { createRateLimiter } from "../../utils/security/rateLimiter.js";
import { httpErrorHandler } from "./httpErrorHandler.js";
import { createSessionCoordinator, generateInstanceId } from "./sessionStore.js";

const HTTP_PORT = config.mcpHttpPort;
const HTTP_HOST = config.mcpHttpHost;
const MCP_ENDPOINT_PATH = "/mcp";
const MAX_PORT_RETRIES = 15;

// The transports map will store active sessions, keyed by session ID.
// NOTE: This is an in-memory session store, which is a known limitation for scalability.
// It will not work in a multi-process (clustered) or serverless environment.
// For a scalable deployment, this would need to be replaced with a distributed
// store like Redis or Memcached.
const transports: Record<string, StreamableHTTPServerTransport> = {};
// Unique identifier for this server instance (used for session ownership)
const INSTANCE_ID = generateInstanceId();

// HTTP transport için pluggable rate limiter (memory/redis).
// Seçim mantığı src/utils/security/rateLimiter.ts içindeki createRateLimiter tarafından yönetilir.
const httpRateLimiter = createRateLimiter();

async function isPortInUse(
  port: number,
  host: string,
  _parentContext: RequestContext,
): Promise<boolean> {
  return new Promise((resolve) => {
    const tempServer = http.createServer();
    tempServer
      .once("error", (err: NodeJS.ErrnoException) => {
        resolve(err.code === "EADDRINUSE");
      })
      .once("listening", () => {
        tempServer.close(() => resolve(false));
      })
      .listen(port, host);
  });
}

function startHttpServerWithRetry(
  app: Hono<{ Bindings: HttpBindings }>,
  initialPort: number,
  host: string,
  maxRetries: number,
  parentContext: RequestContext,
): Promise<ServerType> {
  const startContext = requestContextService.createRequestContext({
    ...parentContext,
    operation: "startHttpServerWithRetry",
  });

  return new Promise((resolve, reject) => {
    const tryBind = (port: number, attempt: number) => {
      if (attempt > maxRetries + 1) {
        reject(new Error("Failed to bind to any port after multiple retries."));
        return;
      }

      const attemptContext = { ...startContext, port, attempt };

      isPortInUse(port, host, attemptContext)
        .then((inUse) => {
          if (inUse) {
            logger.warning(
              `Port ${port} is in use, retrying...`,
              attemptContext,
            );
            setTimeout(() => tryBind(port + 1, attempt + 1), 50); // Small delay
            return;
          }

          try {
            const serverInstance = serve(
              { fetch: app.fetch, port, hostname: host },
              (info: { address: string; port: number }) => {
                const serverAddress = `http://${info.address}:${info.port}${MCP_ENDPOINT_PATH}`;
                logger.info(`HTTP transport listening at ${serverAddress}`, {
                  ...attemptContext,
                  address: serverAddress,
                });
                if (process.stdout.isTTY) {
                  console.log(`\n🚀 MCP Server running at: ${serverAddress}\n`);
                }
              },
            );
            resolve(serverInstance);
          } catch (err: unknown) {
            if (
              err &&
              typeof err === "object" &&
              "code" in err &&
              (err as { code: string }).code !== "EADDRINUSE"
            ) {
              reject(err);
            } else {
              setTimeout(() => tryBind(port + 1, attempt + 1), 50);
            }
          }
        })
        .catch((err) => reject(err));
    };

    tryBind(initialPort, 1);
  });
}

export async function startHttpTransport(
  createServerInstanceFn: () => Promise<McpServer>,
  parentContext: RequestContext,
): Promise<ServerType> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const transportContext = requestContextService.createRequestContext({
    ...parentContext,
    component: "HttpTransportSetup",
  });

  // Initialize session coordinator (memory by default, Redis if configured)
  const coordinator = await createSessionCoordinator({
    sessionStore: config.sessionStore === "redis" ? "redis" : "memory",
    redisUrl: config.redisUrl,
    redisPrefix: config.redisPrefix || "mcp:sessions:",
  });

  app.use(
    "*",
    cors({
      origin: config.mcpAllowedOrigins || [],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Mcp-Session-Id",
        "Last-Event-ID",
      ],
      credentials: true,
    }),
  );

  app.use("*", async (c: Context, next: Next) => {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    await next();
  });

  app.use(MCP_ENDPOINT_PATH, async (c: Context, next: Next) => {
    /**
     * Rate limiting for HTTP MCP requests without authentication context.
     *
     * Strategy:
     * - Resolve client IP best-effort from x-forwarded-for or socket remote address.
     * - Use a stable base key for HTTP transport ("http:mcp").
     * - Let the rate limiter derive a key from IP/path/method only.
     */
    const forwardedFor = c.req.header("x-forwarded-for");
    const ipFromHeader = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : undefined;
    const ip =
      (ipFromHeader && ipFromHeader.length > 0
        ? ipFromHeader
        : ((c.req.raw as any)?.socket?.remoteAddress as string | undefined)) ||
      undefined;

    const rateLimitContext = {
      ip,
      path: c.req.path,
      method: c.req.method,
    };

    const baseKey = "http:mcp";

    // Will throw McpError(BaseErrorCode.RATE_LIMITED, ...) on violation.
    await httpRateLimiter.check(baseKey, rateLimitContext);

    await next();
  });

  // Centralized Error Handling
  app.onError(httpErrorHandler);

  app.post(MCP_ENDPOINT_PATH, async (c: Context) => {
    const postContext = requestContextService.createRequestContext({
      ...transportContext,
      operation: "handlePost",
    });
    const body = await c.req.json();
    const sessionId = c.req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport | undefined = sessionId
      ? transports[sessionId]
      : undefined;

    if (isInitializeRequest(body)) {
      // If a transport already exists for a session, it's a re-initialization.
      if (transport) {
        logger.warning("Re-initializing existing session.", {
          ...postContext,
          sessionId,
        });
        await transport.close(); // This will trigger the onclose handler.
      }

      // Create a new transport for a new session.
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          transports[newId] = newTransport;
          // record ownership for sticky-session in multi-instance deployments
          Promise.resolve(coordinator.setOwner(newId, INSTANCE_ID, 3600)).catch((err) => {
            logger.warning("Failed to record session ownership in coordinator", {
              ...postContext,
              newSessionId: newId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          logger.info(`HTTP Session created: ${newId}`, {
            ...postContext,
            newSessionId: newId,
          });
        },
      });

      // Set up cleanup logic for when the transport is closed.
      newTransport.onclose = () => {
        const closedSessionId = newTransport.sessionId;
        if (closedSessionId && transports[closedSessionId]) {
          delete transports[closedSessionId];
          // cleanup ownership record
          Promise.resolve(coordinator.deleteOwner(closedSessionId)).catch((err) => {
            logger.warning("Failed to cleanup session ownership in coordinator", {
              ...postContext,
              closedSessionId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
          logger.info(`HTTP Session closed: ${closedSessionId}`, {
            ...postContext,
            closedSessionId,
          });
        }
      };

      // Connect the new transport to a new server instance.
      const server = await createServerInstanceFn();
      await server.connect(newTransport);
      transport = newTransport;
    } else if (!transport) {
      // If it's not an initialization request and no transport was found, it's an error.
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        "Invalid or expired session ID.",
      );
    }

    // Pass the request to the transport to handle.
    return await transport.handleRequest(c.env.incoming, c.env.outgoing, body);
  });

  // A reusable handler for GET and DELETE requests which operate on existing sessions.
  const handleSessionRequest = async (
    c: Context<{ Bindings: HttpBindings }>,
  ) => {
    const sessionId = c.req.header("mcp-session-id");
    const transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      // Hint for multi-instance: session may belong to another instance
      if (sessionId) {
        try {
          const owner = await coordinator.getOwner(sessionId);
          if (owner && owner !== INSTANCE_ID) {
            logger.info("Session ownership belongs to another instance", {
              ...requestContextService.createRequestContext({
                operation: "handleSessionRequest",
              }),
              sessionId,
              ownerInstance: owner,
              thisInstance: INSTANCE_ID,
            });
          }
        } catch {
          // ignore coordinator errors here; continue with NOT_FOUND
        }
      }
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        "Session not found or expired.",
      );
    }

    // Let the transport handle the streaming (GET) or termination (DELETE) request.
    return await transport.handleRequest(c.env.incoming, c.env.outgoing);
  };

  app.get(MCP_ENDPOINT_PATH, handleSessionRequest);
  app.delete(MCP_ENDPOINT_PATH, handleSessionRequest);

  return startHttpServerWithRetry(
    app,
    HTTP_PORT,
    HTTP_HOST,
    MAX_PORT_RETRIES,
    transportContext,
  );
}
