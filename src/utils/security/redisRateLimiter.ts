/**
 * @fileoverview Redis-backed RateLimiterStore and RateLimiter factory.
 * - Implements RateLimiterStore contract over Redis.
 * - Used by createRateLimiter in src/utils/security/rateLimiter.ts
 *   when MCP_RATE_LIMIT_STORE=redis is selected.
 *
 * This module does not directly depend on a real Redis client:
 * - Defines a minimal, mockable RedisClientAdapter interface.
 * - Default createRedisClientAdapter implementation expects a `redis`-like
 *   client; host environment can provide or override this adapter.
 */

import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import {
  type RateLimiter,
  type RateLimiterIncrementResult,
  type RateLimiterStatus,
  type RateLimiterStore,
  resolveRateLimitKey,
  type RequestContextLike,
} from "./rateLimiter.js";
import { logger, requestContextService } from "../index.js";

/**
 * Minimal Redis command adapter.
 * Actual implementation can be provided by project/host.
 */
export interface RedisClientAdapter {
  incr(key: string): Promise<number>;
  pExpire(key: string, ttlMs: number): Promise<void>;
  pTtl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Optional factory for creating Redis connection.
 * This repository only defines the signature here to avoid locking into
 * a specific redis package. Host environment can override this function.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createRedisClientAdapter(redisUrl: string): RedisClientAdapter {
  throw new Error(
    "createRedisClientAdapter not implemented. " +
      "When using MCP_RATE_LIMIT_STORE=redis, host environment must provide a RedisClientAdapter.",
  );
}

export interface RedisRateLimiterStoreOptions {
  redisUrl: string;
  prefix?: string;
  clientFactory?: (redisUrl: string) => RedisClientAdapter;
}

/**
 * Redis-based RateLimiterStore.
 *
 * Atomic window behavior:
 * - Counter is incremented with INCR.
 * - If new counter is 1, window duration is set with PEXPIRE.
 * - Remaining time is read with PTTL to calculate resetTime.
 */
export class RedisRateLimiterStore implements RateLimiterStore {
  private readonly client: RedisClientAdapter;
  private readonly prefix: string;

  constructor(options: RedisRateLimiterStoreOptions) {
    const factory = options.clientFactory ?? createRedisClientAdapter;
    this.client = factory(options.redisUrl);
    this.prefix = options.prefix ?? "mcp:rate_limit";
  }

  private k(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimiterIncrementResult> {
    const now = Date.now();
    const redisKey = this.k(key);

    // Atomic behavior using Lua script to prevent race condition
    // This ensures INCR and PEXPIRE happen atomically
    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    let count: number;
    try {
      const result = await this.client.eval(luaScript, 1, redisKey, windowMs);
      count = Number(result);
    } catch (err) {
      // Fallback to non-atomic approach if eval is not supported
      const fallbackContext = requestContextService.createRequestContext({
        operation: "RedisRateLimiterStore.increment.evalFallback",
      });
      logger.warning("Redis EVAL not supported, falling back to non-atomic increment", {
        ...fallbackContext,
        error: err instanceof Error ? err.message : String(err),
      });
      count = await this.client.incr(redisKey);
      if (count === 1) {
        await this.client.pExpire(redisKey, windowMs);
      }
    }

    const ttl = await this.client.pTtl(redisKey);
    const resetTime =
      ttl > 0 ? now + ttl : now + windowMs;

    if (count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - count),
      resetTime,
    };
  }

  async getStatus(key: string): Promise<RateLimiterStatus | null> {
    const redisKey = this.k(key);
    const raw = await this.client.get(redisKey);
    if (raw == null) {
      return null;
    }

    const current = Number(raw);
    if (!Number.isFinite(current)) {
      return null;
    }

    const ttl = await this.client.pTtl(redisKey);
    const now = Date.now();
    const resetTime =
      ttl > 0 ? now + ttl : now;

    return {
      current,
      limit: current, // Actual limit comes from upper RateLimiter; minimal data returned here.
      remaining: 0,
      resetTime,
    };
  }

  async reset(key: string): Promise<void> {
    const redisKey = this.k(key);
    await this.client.del(redisKey);
  }

  async dispose(): Promise<void> {
    await this.client.quit();
  }
}

export interface CreateRedisRateLimiterOptions {
  redisUrl: string;
  prefix?: string;
  windowMs: number;
  maxRequests: number;
  errorMessage?: string;
  skipInDevelopment?: boolean;
  clientFactory?: (redisUrl: string) => RedisClientAdapter;
}

/**
 * RateLimiter factory using Redis backend.
 * RateLimiter.check generates key using identity/IP context and delegates to RedisRateLimiterStore.
 */
export function createRedisRateLimiter(options: CreateRedisRateLimiterOptions): RateLimiter {
  const {
    redisUrl,
    prefix,
    windowMs,
    maxRequests,
    errorMessage,
    skipInDevelopment,
    clientFactory,
  } = options;

  if (!redisUrl) {
    throw new Error(
      "createRedisRateLimiter: redisUrl is required.",
    );
  }

  const store = new RedisRateLimiterStore({
    redisUrl,
    prefix,
    clientFactory,
  });

  const limiter: RateLimiter = {
    async check(baseKey: string, context?: unknown): Promise<void> {
      if (skipInDevelopment && process.env.NODE_ENV === "development") {
        return;
      }

      const rateCtx = (context ?? {}) as RequestContextLike;
      const identityKey = resolveRateLimitKey(rateCtx);
      const effectiveKey = `${baseKey}:${identityKey}`;

      const now = Date.now();
      let result: RateLimiterIncrementResult;

      try {
        result = await store.increment(
          effectiveKey,
          windowMs,
          maxRequests,
        );
      } catch (err) {
        const logContext = requestContextService.createRequestContext({
          operation: "RedisRateLimiterStore.increment.error",
          key: effectiveKey,
          error:
            err instanceof Error ? err.message : String(err),
        });
        logger.error(
          "Redis rate limiter increment failed",
          logContext,
        );
        // Fail-fast: If Redis is selected, should be caught during boot; be conservative here too.
        throw new McpError(
          BaseErrorCode.INTERNAL_ERROR,
          "Rate limiting backend error (redis).",
        );
      }

      if (!result.allowed) {
        const waitTime = Math.max(
          0,
          Math.ceil((result.resetTime - now) / 1000),
        );
        const messageTemplate =
          errorMessage ??
          "Rate limit exceeded. Please try again in {waitTime} seconds.";
        const msg = messageTemplate.replace(
          "{waitTime}",
          waitTime.toString(),
        );

        throw new McpError(BaseErrorCode.RATE_LIMITED, msg, {
          waitTimeSeconds: waitTime,
          key: effectiveKey,
          limit: maxRequests,
          windowMs,
        });
      }
    },

    async getStatus(key: string): Promise<RateLimiterStatus | null> {
      try {
        const status = await store.getStatus(key);
        if (!status) {
          return null;
        }
        return status;
      } catch (err) {
        const logContext = requestContextService.createRequestContext({
          operation: "RedisRateLimiterStore.getStatus.error",
          key,
          error:
            err instanceof Error ? err.message : String(err),
        });
        logger.error(
          "Redis rate limiter getStatus failed",
          logContext,
        );
        return null;
      }
    },

    async dispose(): Promise<void> {
      await store.dispose?.();
    },
  };

  return limiter;
}