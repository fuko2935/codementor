/**
 * @fileoverview Provides an AsyncLock class for asynchronous mutex/semaphore operations.
 * This utility ensures thread-safe execution of critical sections by serializing
 * concurrent operations through a FIFO queue.
 *
 * @module src/utils/concurrency/asyncLock
 */

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
 *
 * @example
 * ```typescript
 * const lock = new AsyncLock();
 *
 * async function criticalOperation() {
 *   await lock.acquire();
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
  private waitQueue: Array<() => void> = [];

  /**
   * Acquires the lock. If the lock is already held, the promise resolves
   * when the lock becomes available (in FIFO order).
   *
   * @returns A promise that resolves when the lock is acquired
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waitQueue.push(resolve);
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
      // Pass the lock to the next waiting acquirer without unlocking.
      // This maintains the lock state while transferring ownership.
      next();
    } else {
      // If no one is waiting, fully release the lock.
      this.locked = false;
    }
  }
}

