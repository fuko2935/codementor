/**
 * @fileoverview Redis-backed RateLimiterStore ve RateLimiter factory.
 * - RateLimiterStore kontratını Redis üzerinde uygular.
 * - MCP_RATE_LIMIT_STORE=redis seçildiğinde src/utils/security/rateLimiter.ts
 *   içindeki createRateLimiter tarafından kullanılır.
 *
 * Bu modül, gerçek Redis istemcisine doğrudan bağımlılık eklemez:
 * - Minimal, mocklanabilir bir RedisClientAdapter arayüzü tanımlar.
 * - Varsayılan createRedisClientAdapter implementasyonu `redis` benzeri bir
 *   istemci bekler; host ortamı bu adaptörü sağlayabilir veya override edebilir.
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
 * Minimal Redis komut adaptörü.
 * Gerçek implementasyon, proje/host tarafında sağlanabilir.
 */
export interface RedisClientAdapter {
  incr(key: string): Promise<number>;
  pExpire(key: string, ttlMs: number): Promise<void>;
  pTtl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
}

/**
 * Redis bağlantısı oluşturmak için opsiyonel factory.
 * Bu repository, doğrudan bir redis paketine kilitlenmemek için burada sadece
 * imza tanımlar. Host ortam, bu fonksiyonu override edebilir.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createRedisClientAdapter(redisUrl: string): RedisClientAdapter {
  throw new Error(
    "createRedisClientAdapter uygulanmadı. " +
      "MCP_RATE_LIMIT_STORE=redis kullanırken host ortam bir RedisClientAdapter sağlamalıdır.",
  );
}

export interface RedisRateLimiterStoreOptions {
  redisUrl: string;
  prefix?: string;
  clientFactory?: (redisUrl: string) => RedisClientAdapter;
}

/**
 * Redis tabanlı RateLimiterStore.
 *
 * Atomic pencere davranışı:
 * - INCR ile sayaç artırılır.
 * - Yeni sayaç 1 ise PEXPIRE ile pencere süresi atanır.
 * - PTTL ile kalan süre okunarak resetTime hesaplanır.
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

    // Atomic davranış: INCR + PEXPIRE (yalnızca ilk istekte)
    const count = await this.client.incr(redisKey);
    if (count === 1) {
      await this.client.pExpire(redisKey, windowMs);
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
      limit: current, // Gerçek limit üst RateLimiter'dan gelir; burada minimal veri döndürülür.
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
 * Redis backend kullanan RateLimiter factory.
 * RateLimiter.check, kimlik/IP bağlamını kullanarak key üretir ve RedisRateLimiterStore'a delegasyon yapar.
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
      "createRedisRateLimiter: redisUrl zorunludur.",
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
        // Fail-fast: Redis seçili ise boot sırasında yakalanmalı; burada da konservatif davran.
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