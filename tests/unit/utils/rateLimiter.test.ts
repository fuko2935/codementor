import {
  RateLimiter,
  resolveRateLimitKey,
  type RequestContextLike,
  type RateLimiterConfig,
} from "../../../src/utils/security/rateLimiter.js";
import { BaseErrorCode, McpError } from "../../../src/types-global/errors.js";
import { expect } from "@jest/globals";

/**
 * Helper to assert that a function call is NOT rate limited.
 */
function assertNotRateLimited(fn: () => void, message?: string): void {
  try {
    fn();
  } catch (err) {
    throw new Error(
      message ??
        `Expected call to be allowed, but received error: ${String(err)}`,
    );
  }
}

/**
 * Helper to assert that a function call IS rate limited with the expected error shape.
 */
function assertRateLimited(fn: () => void, expectedKeyHint?: string): void {
  try {
    fn();
    throw new Error("Expected rate limiter to throw, but call was allowed");
  } catch (err) {
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(BaseErrorCode.RATE_LIMITED);

    if (expectedKeyHint && (err as McpError).details?.key) {
      const key = String((err as McpError).details?.key);
      expect(key).toContain(expectedKeyHint);
    }
  }
}

/**
 * Create a fresh RateLimiter instance suitable for unit tests.
 * - Small window and low limit for deterministic behavior.
 * - Very long cleanupInterval to avoid side-effect timer churn impacting tests.
 */
function createTestLimiter(
  overrides: Partial<RateLimiterConfig> = {},
): RateLimiter {
  const limiter = new RateLimiter({
    windowMs: 100,
    maxRequests: 2,
    cleanupInterval: 10_000, // long enough that periodic cleanup won't affect single-test flows
    ...overrides,
  });

  // Ensure no cross-test leakage from previous state.
  limiter.reset();
  return limiter;
}

// 1) Window filling and RATE_LIMITED behavior
describe("RateLimiter", () => {
  test("window fill and RATE_LIMITED when exceeding maxRequests", () => {
  const limiter = createTestLimiter();

  const baseKey = "test:window";
  const ctx: RequestContextLike = { authInfo: { userId: "user-1" } };

  // First two requests should be allowed
  assertNotRateLimited(() => limiter.check(baseKey, ctx));
  assertNotRateLimited(() => limiter.check(baseKey, ctx));

  // Third request in same window must be rate limited
  assertRateLimited(
    () => limiter.check(baseKey, ctx),
    `${baseKey}:id:user-1`,
  );
});

  // 2) Identity-based separation: userId / clientId
  test("separates buckets per userId for same base key", () => {
  const limiter = createTestLimiter();

  const baseKey = "test:identity:user";
  const ctxUser1: RequestContextLike = { authInfo: { userId: "user-1" } };
  const ctxUser2: RequestContextLike = { authInfo: { userId: "user-2" } };

  // Exhaust limit for user-1
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser1));
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser1));
  assertRateLimited(
    () => limiter.check(baseKey, ctxUser1),
    `${baseKey}:id:user-1`,
  );

  // user-2 should still be independent and allowed
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser2));
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser2));

  // And then user-2 should be limited independently
  assertRateLimited(
    () => limiter.check(baseKey, ctxUser2),
    `${baseKey}:id:user-2`,
  );
});

  test("falls back to clientId when userId missing", () => {
  const limiter = createTestLimiter();

  const baseKey = "test:identity:client";
  const ctxClient1: RequestContextLike = {
    authInfo: { clientId: "client-1" },
  };
  const ctxClient2: RequestContextLike = {
    authInfo: { clientId: "client-2" },
  };

  // Exhaust limit for client-1
  assertNotRateLimited(() => limiter.check(baseKey, ctxClient1));
  assertNotRateLimited(() => limiter.check(baseKey, ctxClient1));
  assertRateLimited(
    () => limiter.check(baseKey, ctxClient1),
    `${baseKey}:client:client-1`,
  );

  // client-2 should not be affected
  assertNotRateLimited(() => limiter.check(baseKey, ctxClient2));
  assertNotRateLimited(() => limiter.check(baseKey, ctxClient2));
  assertRateLimited(
    () => limiter.check(baseKey, ctxClient2),
    `${baseKey}:client:client-2`,
  );
});

  // 3) IP fallback behavior
  test("uses ip-based buckets when no auth identity", () => {
  const limiter = createTestLimiter();

  const baseKey = "test:ip";
  const ctxIp1: RequestContextLike = { ip: "203.0.113.10" };
  const ctxIp2: RequestContextLike = { ip: "203.0.113.11" };

  // Exhaust ip1
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp1));
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp1));
  assertRateLimited(
    () => limiter.check(baseKey, ctxIp1),
    `${baseKey}:ip:203.0.113.10`,
  );

  // ip2 should be independent
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp2));
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp2));
  assertRateLimited(
    () => limiter.check(baseKey, ctxIp2),
    `${baseKey}:ip:203.0.113.11`,
  );
});

  // 4) Anonymous global bucket behavior
  test("anonymous contexts share anon:global bucket", () => {
  const limiter = createTestLimiter();

  const baseKey = "test:anon";
  const anonContext1: RequestContextLike = {};
  const anonContext2: RequestContextLike = {}; // same shape, no authInfo, no ip

  // All calls with anonymous context should hit same anon:global bucket
  assertNotRateLimited(() => limiter.check(baseKey, anonContext1));
  assertNotRateLimited(() => limiter.check(baseKey, anonContext2));

  // Next call should be rate limited since limit is shared
  assertRateLimited(
    () => limiter.check(baseKey, anonContext1),
    `${baseKey}:anon:global`,
  );
});

  // 5) Composition of base key + resolveRateLimitKey (behavioral verification)
  test("base key + identity composition isolates buckets correctly", () => {
  const limiter = createTestLimiter();

  const baseKey = "http:mcp";

  const ctxUser1: RequestContextLike = { authInfo: { userId: "u1" } };
  const ctxUser2: RequestContextLike = { authInfo: { userId: "u2" } };
  const ctxIp: RequestContextLike = { ip: "203.0.113.20" };
  const ctxAnon: RequestContextLike = {};

  // Sanity: verify resolveRateLimitKey mapping used by check()
  expect(resolveRateLimitKey(ctxUser1)).toBe("id:u1");
  expect(resolveRateLimitKey(ctxUser2)).toBe("id:u2");
  expect(resolveRateLimitKey(ctxIp)).toBe("ip:203.0.113.20");
  expect(resolveRateLimitKey(ctxAnon)).toBe("anon:global");

  // Fill bucket for u1
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser1));
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser1));
  assertRateLimited(
    () => limiter.check(baseKey, ctxUser1),
    `${baseKey}:id:u1`,
  );

  // u2 unaffected by u1
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser2));
  assertNotRateLimited(() => limiter.check(baseKey, ctxUser2));
  assertRateLimited(
    () => limiter.check(baseKey, ctxUser2),
    `${baseKey}:id:u2`,
  );

  // IP-based bucket independent
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp));
  assertNotRateLimited(() => limiter.check(baseKey, ctxIp));
  assertRateLimited(
    () => limiter.check(baseKey, ctxIp),
    `${baseKey}:ip:203.0.113.20`,
  );

  // anon:global bucket independent from all above
  assertNotRateLimited(() => limiter.check(baseKey, ctxAnon));
  assertNotRateLimited(() => limiter.check(baseKey, ctxAnon));
  assertRateLimited(
    () => limiter.check(baseKey, ctxAnon),
    `${baseKey}:anon:global`,
  );
});

  // Ensure resolveRateLimitKey strategy is stable and human-readable on its own.
  describe("resolveRateLimitKey", () => {
    test("strategy for various contexts", () => {
      expect(
        resolveRateLimitKey({ authInfo: { userId: "user-x" } }),
      ).toBe("id:user-x");
      expect(
        resolveRateLimitKey({ authInfo: { clientId: "client-x" } }),
      ).toBe("client:client-x");
      expect(
        resolveRateLimitKey({ ip: "198.51.100.1" }),
      ).toBe("ip:198.51.100.1");
      expect(resolveRateLimitKey({})).toBe("anon:global");

      // Trim and guard cases
      expect(
        resolveRateLimitKey({
          authInfo: { userId: "  spaced " },
        }),
      ).toBe("id:  spaced ");
    });
  });
});