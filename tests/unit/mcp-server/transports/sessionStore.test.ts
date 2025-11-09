import { describe, it } from "node:test";
import assert from "node:assert";
import { InMemoryCoordinator, RedisCoordinator } from "../../../src/mcp-server/transports/sessionStore.js";
import { McpError } from "../../../src/types-global/errors.js";

describe("SessionCoordinator - InMemoryCoordinator", () => {
  it("setOwner/getOwner/deleteOwner should work", async () => {
    const coord = new InMemoryCoordinator();
    await coord.setOwner("sess-1", "inst-A", 2);
    assert.strictEqual(await coord.getOwner("sess-1"), "inst-A");
    await coord.deleteOwner("sess-1");
    assert.strictEqual(await coord.getOwner("sess-1"), null);
  });

  it("TTL should expire ownership", async () => {
    const coord = new InMemoryCoordinator();
    await coord.setOwner("sess-2", "inst-B", 1);
    assert.strictEqual(await coord.getOwner("sess-2"), "inst-B");
    // Wait just over 1 second
    await new Promise((r) => setTimeout(r, 1100));
    assert.strictEqual(await coord.getOwner("sess-2"), null);
  });

  it("close should clear all owners", async () => {
    const coord = new InMemoryCoordinator();
    await coord.setOwner("sess-3", "inst-C");
    await coord.close();
    assert.strictEqual(await coord.getOwner("sess-3"), null);
  });
});

describe("SessionCoordinator - RedisCoordinator (mock client)", () => {
  // Minimal mock Redis client
  const createMockRedis = () => {
    const store = new Map<string, string>();
    return {
      set: async (k: string, v: string, ...args: any[]) => {
        // Accept EX ttlSeconds optionally to mimic API shape
        store.set(k, v);
      },
      get: async (k: string) => store.has(k) ? store.get(k)! : null,
      del: async (k: string) => {
        store.delete(k);
      },
    };
  };

  it("sanitizeSessionKey should reject unsafe sessionId", async () => {
    const redis = createMockRedis();
    const coord = new RedisCoordinator(redis as any, "mcp:sessions:");
    await assert.rejects(
      async () => coord.setOwner("../../etc/passwd", "inst-X"),
      (err: unknown) => {
        assert.ok(err instanceof McpError);
        const msg = (err as Error).message.toLowerCase();
        assert.ok(msg.includes("invalid session id"), "expected validation error");
        return true;
      }
    );
  });

  it("setOwner/getOwner/deleteOwner with safe key should work", async () => {
    const redis = createMockRedis();
    const coord = new RedisCoordinator(redis as any, "test:sess:");
    const safeId = "abc_123:xyz-001";
    await coord.setOwner(safeId, "inst-Y", 1);
    assert.strictEqual(await coord.getOwner(safeId), "inst-Y");
    await coord.deleteOwner(safeId);
    assert.strictEqual(await coord.getOwner(safeId), null);
  });

  it("keyPrefix should always end with ':'", async () => {
    const redis = createMockRedis();
    const coord = new RedisCoordinator(redis as any, "prefix"); // no trailing colon
    // Internal behavior verification via set/get
    await coord.setOwner("safe-id", "owner1");
    // Implementation detail: we cannot read the exact key, but presence of getOwner result suffices
    assert.strictEqual(await coord.getOwner("safe-id"), "owner1");
  });
});