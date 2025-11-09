interface MinimalRedisClient {
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}
import { randomUUID } from "node:crypto";
import { createRequire } from "module";
const requireMod = createRequire(import.meta.url);
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

/**
 * Session coordinator interface that tracks session ownership across instances.
 * Note: We DO NOT persist StreamableHTTPServerTransport objects in Redis.
 * We only store ownership (instance ID) to enforce sticky sessions in multi-instance setups.
 */
export interface SessionCoordinator {
  setOwner(sessionId: string, ownerId: string, ttlSeconds?: number): Promise<void>;
  getOwner(sessionId: string): Promise<string | null>;
  deleteOwner(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-memory coordinator: single-process scenarios.
 */
export class InMemoryCoordinator implements SessionCoordinator {
  private map = new Map<string, { owner: string; expiresAt?: number }>();

  async setOwner(sessionId: string, ownerId: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.map.set(sessionId, { owner: ownerId, expiresAt });
  }

  async getOwner(sessionId: string): Promise<string | null> {
    const entry = this.map.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.map.delete(sessionId);
      return null;
    }
    return entry.owner;
  }

  async deleteOwner(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }

  async close(): Promise<void> {
    this.map.clear();
  }
}

/**
 * Redis-based coordinator: distributes ownership info for sticky sessions.
 */
export class RedisCoordinator implements SessionCoordinator {
  private readonly redis: MinimalRedisClient;
  private readonly keyPrefix: string;

  /**
   * Validates sessionId for safe Redis key usage.
   * Allows only A-Z, a-z, 0-9, ':', '_', '-' characters.
   */
  private sanitizeSessionKey(sessionId: string): string {
    if (!/^[A-Za-z0-9:_-]+$/.test(sessionId)) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "Invalid session ID format for session store key.",
        { sessionIdPreview: String(sessionId).slice(0, 40) },
      );
    }
    return sessionId;
  }

  constructor(redis: MinimalRedisClient, keyPrefix: string) {
    this.redis = redis;
    this.keyPrefix = keyPrefix.endsWith(":") ? keyPrefix : keyPrefix + ":";
  }

  private key(sessionId: string): string {
    const safe = this.sanitizeSessionKey(sessionId);
    return `${this.keyPrefix}${safe}`;
  }

  async setOwner(sessionId: string, ownerId: string, ttlSeconds?: number): Promise<void> {
    const k = this.key(sessionId);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(k, ownerId, "EX", ttlSeconds);
    } else {
      await this.redis.set(k, ownerId);
    }
  }

  async getOwner(sessionId: string): Promise<string | null> {
    const k = this.key(sessionId);
    const v = await this.redis.get(k);
    return v ?? null;
  }

  async deleteOwner(sessionId: string): Promise<void> {
    const k = this.key(sessionId);
    await this.redis.del(k);
  }

  async close(): Promise<void> {
    // Do not quit here; lifecycle is owned by caller if shared.
  }
}

/**
 * Factory to create a coordinator from config-like parameters.
 * sessionStore: 'memory' | 'redis'
 * redisUrl: e.g., redis://localhost:6379
 * redisPrefix: key prefix for session ownership, default 'mcp:sessions:'
 */
export async function createSessionCoordinator(params: {
  sessionStore: "memory" | "redis";
  redisUrl?: string;
  redisPrefix?: string;
  // Provide an already-initialized Redis client optionally (for tests/DI)
  redisClientFactory?: () => Promise<any> | any;
}): Promise<SessionCoordinator> {
  if (params.sessionStore === "redis") {
    const prefix = params.redisPrefix || "mcp:sessions:";
    let client: any | undefined;

    if (params.redisClientFactory) {
      const maybe = params.redisClientFactory();
      client = (maybe as Promise<any>)?.then ? await (maybe as Promise<any>) : (maybe as any);
    } else {
      if (!params.redisUrl) {
        throw new Error("REDIS_URL must be provided when MCP_SESSION_STORE=redis");
      }
      // Lazy require to avoid TypeScript module resolution at build time
      let IORedis: any;
      try {
        const mod = requireMod("ioredis");
        IORedis = mod?.default ?? mod;
      } catch (_e) {
        throw new Error(
          "The 'ioredis' package is required for Redis session store but is not installed. Please run 'npm install ioredis' to add it as an optional dependency, or set MCP_SESSION_STORE=memory to use the in-memory store."
        );
      }
      client = new IORedis(params.redisUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
      });
    }

    return new RedisCoordinator(client! as MinimalRedisClient, prefix);
  }

  // Default: memory
  return new InMemoryCoordinator();
}

/**
 * Helper to generate an instance ID for ownership records.
 */
export function generateInstanceId(): string {
  return randomUUID();
}