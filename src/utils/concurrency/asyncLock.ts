/**
 * @fileoverview Provides an AsyncLock class for asynchronous mutex/semaphore operations.
 * This utility ensures thread-safe execution of critical sections by serializing
 * concurrent operations through a FIFO queue.
 *
 * @module src/utils/concurrency/asyncLock
 */

/**
 * Timeout error thrown when lock acquisition times out
 */
export class LockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Lock acquisition timeout after ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
  }
}

/**
 * A simple asynchronous mutex lock implementation for serializing critical sections.
 *
 * This class provides a mechanism to ensure that only one asynchronous operation
 * can execute a critical section at a time. Other operations wait in a FIFO queue
 * until the lock is released.
 *
 * Thread-safety guarantees:
 * - Only one operation can hold the lock at any given time
 * - Operations are processed in FIFO (First-In, First-Out) order
 * - Lock is always released, even if the operation throws an exception
 *   (when used with try...finally pattern)
 * - Timeout protection prevents indefinite deadlocks
 *
 * @example
 * ```typescript
 * const lock = new AsyncLock();
 *
 * async function criticalOperation() {
 *   await lock.acquire(60000); // 60 second timeout
 *   try {
 *     // Only one operation executes this section at a time
 *     await doSomething();
 *   } finally {
 *     lock.release();
 *   }
 * }
 * ```
 */
export class AsyncLock {
  private locked = false;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }> = [];

  /**
   * Acquires the lock. If the lock is already held, the promise resolves
   * when the lock becomes available (in FIFO order).
   *
   * @param timeoutMs - Maximum time to wait for lock acquisition in milliseconds (default: 60000ms = 1 minute)
   * @returns A promise that resolves when the lock is acquired
   * @throws {LockTimeoutError} If the lock cannot be acquired within the timeout period
   */
  async acquire(timeoutMs: number = 60000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        // Set up timeout
        const timer = setTimeout(() => {
          // Remove from queue
          const index = this.waitQueue.findIndex(item => item.resolve === resolve);
          if (index > -1) {
            this.waitQueue.splice(index, 1);
          }
          reject(new LockTimeoutError(timeoutMs));
        }, timeoutMs);

        this.waitQueue.push({ resolve, reject, timer });
      }
    });
  }

  /**
   * Releases the lock. If there are operations waiting in the queue,
   * the next one (FIFO) immediately acquires the lock. Otherwise,
   * the lock is fully released.
   *
   * Important: Always call release() in a finally block to ensure
   * the lock is released even if an exception occurs.
   */
  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      // Clear the timeout timer
      clearTimeout(next.timer);
      // Pass the lock to the next waiting acquirer without unlocking.
      // This maintains the lock state while transferring ownership.
      next.resolve();
    } else {
      // If no one is waiting, fully release the lock.
      this.locked = false;
    }
  }

  /**
   * Gets the current number of operations waiting for the lock.
   * Useful for monitoring and debugging.
   *
   * @returns The number of operations in the wait queue
   */
  getWaitQueueLength(): number {
    return this.waitQueue.length;
  }

  /**
   * Checks if the lock is currently held.
   *
   * @returns True if the lock is held, false otherwise
   */
  isLocked(): boolean {
    return this.locked;
  }
}

