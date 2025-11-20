/**
 * @fileoverview Pluggable rate limiter abstraction (in-memory + extensible backends).
 * Provides:
 * - RequestContextLike + resolveRateLimitKey (identity/IP based keys)
 * - RateLimiterStore / RateLimiter interfaces
 * - InMemoryRateLimiterStore implementation
 * - createInMemoryRateLimiter factory
 * - Default singleton `rateLimiter` (in-memory, backward compatible)
 * - createRateLimiter factory (backend selection via MCP_RATE_LIMIT_STORE)
 * @module src/utils/security/rateLimiter
 */

import { environment } from "../../config/index.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import { logger, RequestContext, requestContextService } from "../index.js";
import { createRedisRateLimiter } from "./redisRateLimiter.js";

/**
 * Minimal, HTTP/transport independent identity context.
 */
export interface RequestContextLike {
  authInfo?: {
    userId?: string;
    clientId?: string;
  };
  ip?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Identity/IP based rate limit key generation.
 */
export function resolveRateLimitKey(ctx: RequestContextLike): string {
  const auth = ctx?.authInfo;

  if (auth) {
    if (auth.userId && typeof auth.userId === "string" && auth.userId.trim()) {
      return `id:${auth.userId}`;
    }
    if (
      auth.clientId &&
      typeof auth.clientId === "string" &&
      auth.clientId.trim()
    ) {
      return `client:${auth.clientId}`;
    }
  }

  if (ctx?.ip && typeof ctx.ip === "string" && ctx.ip.trim()) {
    return `ip:${ctx.ip}`;
  }

  // Shared bucket for completely anonymous requests.
  return "anon:global";
}

/**
 * Store.increment sonucu.
 */
export interface RateLimiterIncrementResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * Bir anahtar için anlık durum.
 */
export interface RateLimiterStatus {
  current: number;
  limit: number;
  remaining: number;
  resetTime: number;
}

/**
 * Pluggable rate limit store kontratı.
 */
export interface RateLimiterStore {
  increment(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimiterIncrementResult>;

  getStatus(key: string): Promise<RateLimiterStatus | null>;

  reset(key: string): Promise<void>;

  dispose?(): Promise<void> | void;
}

/**
 * Ortak RateLimiter kontratı.
 * check: mevcut kullanımla uyumlu olacak şekilde minimal tutuldu.
 */
export interface RateLimiter {
  check(key: string, context?: unknown): Promise<void> | void;

  getStatus?(
    key: string,
  ):
    | Promise<RateLimiterStatus | null>
    | RateLimiterStatus
    | null;

  dispose?(): Promise<void> | void;
}

/**
 * In-memory RateLimiter ayarları.
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  errorMessage?: string;
  skipInDevelopment?: boolean;
  keyGenerator?: (identifier: string, context?: RequestContext) => string;
  cleanupInterval?: number;
}

/**
 * InMemory entry.
 */
export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory RateLimiterStore implementasyonu.
 */
export class InMemoryRateLimiterStore implements RateLimiterStore {
  private limits: Map<string, RateLimitEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cleanupInterval?: number) {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    if (!this.cleanupInterval || this.cleanupInterval <= 0) {
      return;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredEntries(),
      this.cleanupInterval,
    );

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetTime) {
        this.limits.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      const logContext = requestContextService.createRequestContext({
        operation: "InMemoryRateLimiterStore.cleanupExpiredEntries",
        cleanedCount: expiredCount,
        totalRemainingAfterClean: this.limits.size,
      });
      logger.debug(
        `Cleaned up ${expiredCount} expired rate limit entries (memory store)`,
        logContext,
      );
    }
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimiterIncrementResult> {
    const now = Date.now();
    const existing = this.limits.get(key);

    if (!existing || now >= existing.resetTime) {
      const resetTime = now + windowMs;
      this.limits.set(key, { count: 1, resetTime });
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - 1),
        resetTime,
      };
    }

    if (existing.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: existing.resetTime,
      };
    }

    existing.count += 1;

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - existing.count),
      resetTime: existing.resetTime,
    };
  }

  async getStatus(key: string): Promise<RateLimiterStatus | null> {
    const entry = this.limits.get(key);
    if (!entry) {
      return null;
    }

    // limit/remaining üst seviye RateLimiter tarafından hesaplanır;
    // burada minimum veri sağlanır.
    return {
      current: entry.count,
      limit: entry.count,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  async reset(key: string): Promise<void> {
    this.limits.delete(key);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.limits.clear();
  }
}

/**
 * baseKey + context ile efektif key üretimi.
 */
function buildEffectiveKey(
  baseKey: string,
  context: unknown,
  keyGenerator?: (identifier: string, context?: RequestContext) => string,
): string {
  let effectiveKey = baseKey;

  if (context && typeof context === "object") {
    const rateCtx = context as RequestContextLike;
    const identityKey = resolveRateLimitKey(rateCtx);
    if (identityKey && typeof identityKey === "string") {
      effectiveKey = `${baseKey}:${identityKey}`;
    }
  }

  if (keyGenerator) {
    effectiveKey = keyGenerator(effectiveKey, context as RequestContext);
  }

  return effectiveKey;
}

/**
 * In-memory RateLimiter factory.
 * Supports `check(key, ctx)` usage for backward compatibility, but returns async.
 */
export function createInMemoryRateLimiter(
  config?: Partial<RateLimitConfig>,
): RateLimiter {
  const resolvedConfig: RateLimitConfig = {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    errorMessage:
      "Rate limit exceeded. Please try again in {waitTime} seconds.",
    skipInDevelopment: false,
    cleanupInterval: 5 * 60 * 1000,
    ...config,
  };

  const store = new InMemoryRateLimiterStore(resolvedConfig.cleanupInterval);

  const limiter: RateLimiter = {
    async check(key: string, context?: unknown): Promise<void> {
      if (resolvedConfig.skipInDevelopment && environment === "development") {
        return;
      }

      const effectiveKey = buildEffectiveKey(
        key,
        context,
        resolvedConfig.keyGenerator,
      );

      const now = Date.now();

      const result = await store.increment(
        effectiveKey,
        resolvedConfig.windowMs,
        resolvedConfig.maxRequests,
      );

      if (!result.allowed) {
        const waitTime = Math.max(
          0,
          Math.ceil((result.resetTime - now) / 1000),
        );
        const errorMessage = (
          resolvedConfig.errorMessage ??
          "Rate limit exceeded. Please try again in {waitTime} seconds."
        ).replace("{waitTime}", waitTime.toString());

        throw new McpError(BaseErrorCode.RATE_LIMITED, errorMessage, {
          waitTimeSeconds: waitTime,
          key: effectiveKey,
          limit: resolvedConfig.maxRequests,
          windowMs: resolvedConfig.windowMs,
        });
      }
    },

    async getStatus(key: string): Promise<RateLimiterStatus | null> {
      const status = await store.getStatus(key);
      if (!status) {
        return null;
      }

      const current = status.current;
      const limit = resolvedConfig.maxRequests;
      return {
        current,
        limit,
        remaining: Math.max(0, limit - current),
        resetTime: status.resetTime,
      };
    },

    dispose(): void {
      store.dispose?.();
    },
  };

  return limiter;
}

/**
 * Genel factory:
 * MCP_RATE_LIMIT_STORE üzerinden backend seçimini yapar.
 */
export function createRateLimiter(options?: {
  store?: "memory" | "redis";
  windowMs?: number;
  maxRequests?: number;
  errorMessage?: string;
  skipInDevelopment?: boolean;
  cleanupInterval?: number;
  redisUrl?: string;
  redisPrefix?: string;
}): RateLimiter {
  const envStore = process.env.MCP_RATE_LIMIT_STORE;
  const target =
    options?.store ??
    (envStore as "memory" | "redis" | undefined) ??
    "memory";

  if (target === "memory") {
    return createInMemoryRateLimiter({
      windowMs: options?.windowMs ?? 15 * 60 * 1000,
      maxRequests: options?.maxRequests ?? 100,
      errorMessage: options?.errorMessage,
      skipInDevelopment: options?.skipInDevelopment ?? false,
      cleanupInterval: options?.cleanupInterval ?? 5 * 60 * 1000,
    });
  }

  if (target === "redis") {
    const redisUrl = options?.redisUrl ?? process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error(
        "MCP_RATE_LIMIT_STORE=redis but REDIS_URL is not defined.",
      );
    }

    const prefix =
      options?.redisPrefix ?? process.env.MCP_RATE_LIMIT_PREFIX ?? "mcp:rate_limit";

    return createRedisRateLimiter({
      redisUrl,
      prefix,
      windowMs: options?.windowMs ?? 15 * 60 * 1000,
      maxRequests: options?.maxRequests ?? 100,
      errorMessage: options?.errorMessage,
      skipInDevelopment: options?.skipInDevelopment ?? false,
    });
  }

  throw new Error(
    "Invalid MCP_RATE_LIMIT_STORE value. Supported: memory, redis.",
  );
}

/**
 * Default singleton:
 * - InMemory backend (default if MCP_RATE_LIMIT_STORE is missing)
 * - Export name is preserved for backward compatibility.
 */
export const rateLimiter: RateLimiter = createRateLimiter();