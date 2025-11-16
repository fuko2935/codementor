import { describe, it, expect } from "@jest/globals";

import {
  type RateLimiter,
  resolveRateLimitKey,
} from "../../../src/utils/security/rateLimiter.js";
import {
  createRedisRateLimiter,
  type RedisClientAdapter,
} from "../../../src/utils/security/redisRateLimiter.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";

/**
 * Basit in-memory fake Redis adapter.
 */
class FakeRedis implements RedisClientAdapter {
  private store = new Map<string, { value: number; expireAt?: number }>();

  async incr(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || (entry.expireAt && entry.expireAt <= now)) {
      const next = { value: 1, expireAt: entry?.expireAt };
      this.store.set(key, next);
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  async pExpire(key: string, ttlMs: number): Promise<void> {
    const entry = this.store.get(key);
    if (!entry) return;
    entry.expireAt = Date.now() + ttlMs;
  }

  async pTtl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || !entry.expireAt) return -1;
    return Math.max(0, entry.expireAt - Date.now());
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return String(entry.value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async quit(): Promise<void> {
    this.store.clear();
  }
}

function createTestRedisLimiter(windowMs = 100, maxRequests = 2): RateLimiter {
  const fake = new FakeRedis();
  return createRedisRateLimiter({
    redisUrl: "redis://fake",
    windowMs,
    maxRequests,
    prefix: "test:rl",
    clientFactory: () => fake,
  });
}

describe("redisRateLimiter", () => {
  it("resolveRateLimitKey ile anahtar üretimi tutarlı", () => {
    expect(resolveRateLimitKey({ authInfo: { userId: "u1" } })).toBe("id:u1");
    expect(resolveRateLimitKey({ authInfo: { clientId: "c1" } })).toBe("client:c1");
    expect(resolveRateLimitKey({ ip: "127.0.0.1" })).toBe("ip:127.0.0.1");
  });

  it("izin verilen istekler hata üretmez", async () => {
    const limiter = createTestRedisLimiter();
    const ctx = { authInfo: { userId: "user-1" } };

    await limiter.check?.("http:mcp", ctx);
    await limiter.check?.("http:mcp", ctx);
  });

  it("limit aşıldığında RATE_LIMITED fırlatır", async () => {
    const limiter = createTestRedisLimiter();
    const ctx = { authInfo: { userId: "user-2" } };

    await limiter.check?.("http:mcp", ctx);
    await limiter.check?.("http:mcp", ctx);

    await expect(() => limiter.check?.("http:mcp", ctx)).rejects.toThrow(McpError);
    await expect(() => limiter.check?.("http:mcp", ctx)).rejects.toMatchObject({
      code: BaseErrorCode.RATE_LIMITED
    });
  });

  it("farklı kimlikler için kovalar ayrılır", async () => {
    const limiter = createTestRedisLimiter();
    const ctx1 = { authInfo: { userId: "u1" } };
    const ctx2 = { authInfo: { userId: "u2" } };

    await limiter.check?.("http:mcp", ctx1);
    await limiter.check?.("http:mcp", ctx1);

    // u1 için üçüncü istekte hata beklenir
    await expect(() => limiter.check?.("http:mcp", ctx1)).rejects.toThrow(McpError);
    await expect(() => limiter.check?.("http:mcp", ctx1)).rejects.toMatchObject({
      code: BaseErrorCode.RATE_LIMITED
    });

    // u2 bağımsız olmalı
    await limiter.check?.("http:mcp", ctx2);
    await limiter.check?.("http:mcp", ctx2);
  });
});