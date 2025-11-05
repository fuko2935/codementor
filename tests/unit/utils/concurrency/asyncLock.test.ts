/**
 * @fileoverview Unit tests for AsyncLock class.
 * Tests thread-safety, FIFO ordering, exception handling, and concurrent operations.
 * @module tests/unit/utils/concurrency/asyncLock
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { AsyncLock } from "../../../../src/utils/concurrency/asyncLock.js";

describe("AsyncLock", () => {
  describe("Sequential Acquisition", () => {
    it("should execute operations in order when multiple acquires happen concurrently", async () => {
      const lock = new AsyncLock();
      const executionOrder: number[] = [];

      // Start 3 concurrent operations
      const op1 = (async () => {
        await lock.acquire();
        try {
          executionOrder.push(1);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          lock.release();
        }
      })();

      const op2 = (async () => {
        await lock.acquire();
        try {
          executionOrder.push(2);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          lock.release();
        }
      })();

      const op3 = (async () => {
        await lock.acquire();
        try {
          executionOrder.push(3);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          lock.release();
        }
      })();

      await Promise.all([op1, op2, op3]);

      // Verify FIFO ordering
      assert.deepStrictEqual(executionOrder, [1, 2, 3]);
    });
  });

  describe("Lock Release", () => {
    it("should properly release lock after use", async () => {
      const lock = new AsyncLock();
      let acquired = false;

      // First acquire
      await lock.acquire();
      try {
        acquired = true;
      } finally {
        lock.release();
      }

      assert.strictEqual(acquired, true);

      // Second acquire should succeed immediately
      const startTime = Date.now();
      await lock.acquire();
      const endTime = Date.now();
      lock.release();

      // Should acquire immediately (no waiting)
      assert.ok(endTime - startTime < 10, "Lock should be released immediately");
    });
  });

  describe("Queue FIFO Behavior", () => {
    it("should process multiple waiters in FIFO order", async () => {
      const lock = new AsyncLock();
      const order: number[] = [];

      // Hold lock initially
      await lock.acquire();

      // Queue 5 operations
      const promises = [1, 2, 3, 4, 5].map((num) => {
        return (async () => {
          await lock.acquire();
          try {
            order.push(num);
            await new Promise((resolve) => setTimeout(resolve, 5));
          } finally {
            lock.release();
          }
        })();
      });

      // Release initial lock to start processing
      lock.release();

      await Promise.all(promises);

      // Verify FIFO order
      assert.deepStrictEqual(order, [1, 2, 3, 4, 5]);
    });
  });

  describe("Exception Safety", () => {
    it("should release lock even when operation throws an error", async () => {
      const lock = new AsyncLock();
      let lockReleased = false;

      try {
        await lock.acquire();
        try {
          throw new Error("Test error");
        } finally {
          lock.release();
          lockReleased = true;
        }
      } catch (error) {
        // Expected error
        assert.strictEqual((error as Error).message, "Test error");
      }

      assert.strictEqual(lockReleased, true, "Lock should be released in finally block");

      // Verify next waiter can acquire successfully (should not throw)
      await lock.acquire();
      lock.release();
      assert.ok(true, "Next waiter should be able to acquire lock");
    });

    it("should allow next waiter to acquire after exception", async () => {
      const lock = new AsyncLock();
      let secondOperationExecuted = false;

      // First operation throws
      const op1 = (async () => {
        await lock.acquire();
        try {
          throw new Error("Operation failed");
        } finally {
          lock.release();
        }
      })();

      // Second operation waits and should succeed
      const op2 = (async () => {
        await lock.acquire();
        try {
          secondOperationExecuted = true;
        } finally {
          lock.release();
        }
      })();

      await Promise.allSettled([op1, op2]);

      assert.strictEqual(secondOperationExecuted, true, "Second operation should execute after first releases lock");
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle realistic concurrent scenario without overlapping critical sections", async () => {
      const lock = new AsyncLock();
      const activeOperations = new Set<number>();
      const completedOperations: number[] = [];
      let maxConcurrent = 0;

      // Create 10 parallel operations
      const operations = Array.from({ length: 10 }, (_, i) => {
        return (async () => {
          await lock.acquire();
          try {
            activeOperations.add(i);
            maxConcurrent = Math.max(maxConcurrent, activeOperations.size);

            // Simulate work
            await new Promise((resolve) => setTimeout(resolve, 5));

            completedOperations.push(i);
          } finally {
            activeOperations.delete(i);
            lock.release();
          }
        })();
      });

      await Promise.all(operations);

      // Verify no overlapping critical sections
      assert.strictEqual(maxConcurrent, 1, "Only one operation should be active at a time");

      // Verify all operations completed
      assert.strictEqual(completedOperations.length, 10, "All operations should complete");
      assert.strictEqual(activeOperations.size, 0, "All operations should release lock");
    });

    it("should serialize operations with delays correctly", async () => {
      const lock = new AsyncLock();
      const timestamps: number[] = [];

      // Create operations with varying delays
      const operations = [
        async () => {
          await lock.acquire();
          try {
            timestamps.push(Date.now());
            await new Promise((resolve) => setTimeout(resolve, 20));
          } finally {
            lock.release();
          }
        },
        async () => {
          await lock.acquire();
          try {
            timestamps.push(Date.now());
            await new Promise((resolve) => setTimeout(resolve, 10));
          } finally {
            lock.release();
          }
        },
        async () => {
          await lock.acquire();
          try {
            timestamps.push(Date.now());
            await new Promise((resolve) => setTimeout(resolve, 15));
          } finally {
            lock.release();
          }
        },
      ];

      await Promise.all(operations.map((op) => op()));

      // Verify operations executed sequentially (timestamps should be in order)
      for (let i = 1; i < timestamps.length; i++) {
        assert.ok(
          timestamps[i] >= timestamps[i - 1],
          `Operation ${i} should start after operation ${i - 1} completes`,
        );
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid acquire/release cycles", async () => {
      const lock = new AsyncLock();

      // Rapid cycles
      for (let i = 0; i < 100; i++) {
        await lock.acquire();
        lock.release();
      }

      // Should still work correctly
      await lock.acquire();
      lock.release();
      assert.ok(true, "Lock should handle rapid cycles");
    });

    it("should handle single operation without issues", async () => {
      const lock = new AsyncLock();

      await lock.acquire();
      try {
        assert.ok(true, "Single operation should work");
      } finally {
        lock.release();
      }

      // Should be able to acquire again
      await lock.acquire();
      lock.release();
      assert.ok(true, "Lock should be reusable");
    });
  });
});

