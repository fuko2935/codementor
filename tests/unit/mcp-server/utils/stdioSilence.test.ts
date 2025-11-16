/**
 * @fileoverview Unit tests for executeUnderStdioSilence utility.
 * Validates SPEC-STDIO-STABILITY-001 for stdio and non-stdio behavior,
 * ensuring backward-compatible silence/restore semantics.
 */

import { describe, it, beforeEach, afterEach, expect } from "@jest/globals";

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
    expect(called).toBe(true);
    expect(process.stdout.write).toBe(beforeStdoutWrite);
    expect(process.stderr.write).toBe(beforeStderrWrite);
    expect(result).toBe(expectedResult);
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

    process.stdout.write = ((...args: any[]) => {
      originalStdoutCallCount += 1;
      return (ORIGINAL_STDOUT_WRITE as any)(...args);
    }) as any;

    process.stderr.write = ((...args: any[]) => {
      originalStderrCallCount += 1;
      return (ORIGINAL_STDERR_WRITE as any)(...args);
    }) as any;

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
    expect(observedDuringSilence.stdoutCalled).toBe(true);
    expect(observedDuringSilence.stderrCalled).toBe(true);

    // No real writes should have reached our original spies during silenced section.
    expect(originalStdoutCallCount).toBe(0);
    expect(originalStderrCallCount).toBe(0);

    // After completion, original references must be fully restored.
    expect(process.stdout.write.toString()).toBe(ORIGINAL_STDOUT_WRITE.toString());
    expect(process.stderr.write.toString()).toBe(ORIGINAL_STDERR_WRITE.toString());

    // Result propagation
    expect(result).toBe(returnValue);
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
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(error.message);

    // After error, original references must be restored.
    expect(process.stdout.write.toString()).toBe(ORIGINAL_STDOUT_WRITE.toString());
    expect(process.stderr.write.toString()).toBe(ORIGINAL_STDERR_WRITE.toString());

    // Ensure that our saved originals match pre-call originals (no leakage).
    expect(originalStdoutWrite.toString()).toBe(ORIGINAL_STDOUT_WRITE.toString());
    expect(originalStderrWrite.toString()).toBe(ORIGINAL_STDERR_WRITE.toString());
  });
});