/**
 * @fileoverview Unit tests for executeUnderStdioSilence utility.
 * Validates SPEC-STDIO-STABILITY-001 for stdio and non-stdio behavior,
 * ensuring backward-compatible silence/restore semantics.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeUnderStdioSilence } from "../../../../src/mcp-server/utils/stdioSilence.js";
import { config } from "../../../../src/config/index.js";

/**
 * NOTE:
 * - config.mcpTransportType is derived from process.env.MCP_TRANSPORT_TYPE.
 * - Tests manipulate process.env and reload the module behavior indirectly through this config.
 * - To keep isolation, we snapshot/restore:
 *   - process.env.MCP_TRANSPORT_TYPE
 *   - process.stdout.write / process.stderr.write
 */

const ORIGINAL_STDOUT_WRITE = process.stdout.write;
const ORIGINAL_STDERR_WRITE = process.stderr.write;
const ORIGINAL_MCP_TRANSPORT_TYPE = process.env.MCP_TRANSPORT_TYPE;

describe("executeUnderStdioSilence", () => {
  beforeEach(() => {
    // Restore IO write references before each test to ensure isolation.
    process.stdout.write = ORIGINAL_STDOUT_WRITE;
    process.stderr.write = ORIGINAL_STDERR_WRITE;

    // Ensure MCP transport type is aligned with current config/env snapshot by test.
    if (ORIGINAL_MCP_TRANSPORT_TYPE === undefined) {
      delete process.env.MCP_TRANSPORT_TYPE;
    } else {
      process.env.MCP_TRANSPORT_TYPE = ORIGINAL_MCP_TRANSPORT_TYPE;
    }
  });

  afterEach(() => {
    // Always restore original write methods and MCP env to avoid cross-test leakage.
    process.stdout.write = ORIGINAL_STDOUT_WRITE;
    process.stderr.write = ORIGINAL_STDERR_WRITE;

    if (ORIGINAL_MCP_TRANSPORT_TYPE === undefined) {
      delete process.env.MCP_TRANSPORT_TYPE;
    } else {
      process.env.MCP_TRANSPORT_TYPE = ORIGINAL_MCP_TRANSPORT_TYPE;
    }
  });

  it("runs operation directly when not in stdio mode without altering stdio streams", async () => {
    // Arrange: ensure a non-stdio mode (e.g., http) while respecting config semantics.
    process.env.MCP_TRANSPORT_TYPE = "http";
    // The config object itself is constructed at module load; its current value reflects env at that time.
    // We assert behavior based on the implementation: it checks config.mcpTransportType.
    // Current implementation: default is "stdio" and strictly "stdio" or "http".
    // For SPEC-STDIO-STABILITY-001, if config.mcpTransportType !== "stdio", no suppression should occur.

    const expectedResult = { ok: true, value: 42 };
    let called = false;

    const operationToSilence = async () => {
      called = true;
      return expectedResult;
    };

    const beforeStdoutWrite = process.stdout.write;
    const beforeStderrWrite = process.stderr.write;

    // Act
    const result = await executeUnderStdioSilence(operationToSilence);

    // Assert
    assert.strictEqual(called, true, "operationToSilence should be invoked");
    assert.strictEqual(
      process.stdout.write,
      beforeStdoutWrite,
      "process.stdout.write must not be replaced in non-stdio mode",
    );
    assert.strictEqual(
      process.stderr.write,
      beforeStderrWrite,
      "process.stderr.write must not be replaced in non-stdio mode",
    );
    assert.strictEqual(
      result,
      expectedResult,
      "Result must equal the operation's return value in non-stdio mode",
    );
  });

  it("suppresses stdout/stderr during execution in stdio mode and restores afterwards (success case)", async () => {
    // Arrange: force stdio mode via env to match SPEC expectations.
    process.env.MCP_TRANSPORT_TYPE = "stdio";

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const observedDuringSilence = {
      stdoutCalled: false,
      stderrCalled: false,
      stdoutSuppressed: false,
      stderrSuppressed: false,
    };

    // Spy on original to detect real writes (should not be hit while silenced)
    let originalStdoutCallCount = 0;
    let originalStderrCallCount = 0;

    process.stdout.write = ((...args: unknown[]) => {
      originalStdoutCallCount += 1;
      return (ORIGINAL_STDOUT_WRITE as typeof process.stdout.write)(...args);
    }) as typeof process.stdout.write;

    process.stderr.write = ((...args: unknown[]) => {
      originalStderrCallCount += 1;
      return (ORIGINAL_STDERR_WRITE as typeof process.stderr.write)(...args);
    }) as typeof process.stderr.write;

    const returnValue = "silenced-ok";

    const operationToSilence = async () => {
      // While inside executeUnderStdioSilence, stdout/stderr.write should be replaced with no-op.
      const currentStdoutWrite = process.stdout.write;
      const currentStderrWrite = process.stderr.write;

      // Attempt writes
      const stdoutResult = currentStdoutWrite("should-be-suppressed-stdout");
      const stderrResult = currentStderrWrite("should-be-suppressed-stderr");

      observedDuringSilence.stdoutCalled = true;
      observedDuringSilence.stderrCalled = true;

      // If correctly suppressed, those write calls should be the no-op implementations
      // returning true without delegating to our spies.
      observedDuringSilence.stdoutSuppressed = stdoutResult === true;
      observedDuringSilence.stderrSuppressed = stderrResult === true;

      return returnValue;
    };

    // Act
    const result = await executeUnderStdioSilence(operationToSilence);

    // Assert: inside call, we must have attempted writes
    assert.ok(
      observedDuringSilence.stdoutCalled,
      "operationToSilence should attempt stdout.write",
    );
    assert.ok(
      observedDuringSilence.stderrCalled,
      "operationToSilence should attempt stderr.write",
    );

    // No real writes should have reached our original spies during silenced section.
    assert.strictEqual(
      originalStdoutCallCount,
      0,
      "stdout writes must be suppressed in stdio mode",
    );
    assert.strictEqual(
      originalStderrCallCount,
      0,
      "stderr writes must be suppressed in stdio mode",
    );

    // After completion, original references must be fully restored.
    assert.strictEqual(
      process.stdout.write,
      ORIGINAL_STDOUT_WRITE,
      "process.stdout.write must be restored after successful execution",
    );
    assert.strictEqual(
      process.stderr.write,
      ORIGINAL_STDERR_WRITE,
      "process.stderr.write must be restored after successful execution",
    );

    // Result propagation
    assert.strictEqual(
      result,
      returnValue,
      "executeUnderStdioSilence must return the operation result in stdio mode",
    );
  });

  it("restores stdout/stderr and propagates error when operation throws in stdio mode", async () => {
    // Arrange
    process.env.MCP_TRANSPORT_TYPE = "stdio";

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const error = new Error("test-error");
    const operationToSilence = async () => {
      // While silenced, writes should not reach original.
      process.stdout.write("error-path-stdout");
      process.stderr.write("error-path-stderr");
      throw error;
    };

    // Act
    let caught: unknown;
    try {
      await executeUnderStdioSilence(operationToSilence);
    } catch (err) {
      caught = err;
    }

    // Assert: error must be propagated as-is
    assert.ok(caught instanceof Error, "Thrown value must be an Error");
    assert.strictEqual(
      (caught as Error).message,
      error.message,
      "Error message must be preserved",
    );

    // After error, original references must be restored.
    assert.strictEqual(
      process.stdout.write,
      ORIGINAL_STDOUT_WRITE,
      "process.stdout.write must be restored after error",
    );
    assert.strictEqual(
      process.stderr.write,
      ORIGINAL_STDERR_WRITE,
      "process.stderr.write must be restored after error",
    );

    // Ensure that our saved originals match pre-call originals (no leakage).
    assert.strictEqual(
      originalStdoutWrite,
      ORIGINAL_STDOUT_WRITE,
      "Original stdout reference must remain unchanged",
    );
    assert.strictEqual(
      originalStderrWrite,
      ORIGINAL_STDERR_WRITE,
      "Original stderr reference must remain unchanged",
    );
  });
});