/**
 * @fileoverview Integration test for complete startup sequence validation.
 * Tests both STDIO and HTTP transport startup without logger initialization issues.
 * @module src/validation/integrationTest
 */

import { spawn, ChildProcess } from "child_process";

interface TestResult {
  success: boolean;
  output: string;
  errors: string[];
  duration: number;
}

/**
 * Tests STDIO transport startup sequence and validates that stdout only emits
 * valid JSON-RPC messages (SPEC-STDIO-STABILITY-001 / §6.2).
 *
 * This is implemented to be:
 * - Realistic: uses the built dist/index.js entrypoint with MCP_TRANSPORT_TYPE=stdio
 * - Strict enough: rejects any non-JSON / non-object lines on stdout
 * - Practical: allows whitespace-only lines and terminates within a bounded time
 */
async function testStdioTransportStartup(): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let output = "";

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      MCP_TRANSPORT_TYPE: "stdio",
      MCP_LOG_LEVEL: "info",
      NODE_ENV: "test",
    };

    const child: ChildProcess = spawn("node", ["dist/index.js"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrData = "";

    // How many valid JSON-RPC messages we require before considering startup stable.
    const requiredValidMessages = 2;
    let validJsonRpcCount = 0;
    let closed = false;

    const finalize = (successOverride?: boolean) => {
      if (closed) return;
      closed = true;

      if (!child.killed) {
        child.kill("SIGTERM");
      }

      const duration = Date.now() - startTime;
      output = `STDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrData}`;

      const success =
        typeof successOverride === "boolean"
          ? successOverride
          : errors.length === 0 && validJsonRpcCount >= requiredValidMessages;

      resolve({
        success,
        output,
        errors,
        duration,
      });
    };

    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      // Keep the last partial line (if any) in the buffer
      stdoutBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          // Allow empty/whitespace lines
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          errors.push(`Non-JSON stdout line detected: ${rawLine}`);
          finalize(false);
          return;
        }

        if (parsed === null || typeof parsed !== "object") {
          errors.push(`Non-object JSON stdout line detected: ${rawLine}`);
          finalize(false);
          return;
        }

        const msg = parsed as { jsonrpc?: unknown };

        if (Object.prototype.hasOwnProperty.call(msg, "jsonrpc")) {
          if (msg.jsonrpc !== "2.0") {
            errors.push(
              `Invalid jsonrpc version on stdout line. Expected "2.0", got: ${JSON.stringify(
                msg.jsonrpc,
              )}`,
            );
            finalize(false);
            return;
          }
        }

        validJsonRpcCount += 1;

        if (validJsonRpcCount >= requiredValidMessages) {
          finalize(true);
          return;
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stderrData += chunk;

      // These should not appear during stable startup; treat as regression signals.
      if (
        chunk.includes("WASM") ||
        chunk.includes("wasm") ||
        chunk.includes("Tree-sitter") ||
        chunk.includes("Logger not initialized") ||
        chunk.includes("message dropped") ||
        chunk.includes("WASM module loaded")
      ) {
        errors.push(
          "Unexpected noisy stderr output during stdio startup (possible warmup regression).",
        );
      }
    });

    child.on("error", (error) => {
      errors.push(`Process error: ${error.message}`);
      finalize(false);
    });

    child.on("close", () => {
      // If process exits before we reached the required JSON-RPC messages and
      // no other error decided the outcome, consider this a failure.
      if (!closed) {
        if (validJsonRpcCount < requiredValidMessages) {
          errors.push(
            "STDIO server exited before emitting sufficient valid JSON-RPC messages.",
          );
        }
        finalize();
      }
    });

    // Global timeout safeguard: ensure determinism (10 seconds).
    setTimeout(() => {
      if (!closed) {
        errors.push("STDIO startup validation timed out.");
        finalize(false);
      }
    }, 10_000);
  });
}

/**
 * Tests HTTP transport startup sequence.
 */
async function testHttpTransportStartup(): Promise<TestResult> {
  console.log("🧪 Testing HTTP Transport Startup...");

  const startTime = Date.now();
  const errors: string[] = [];
  let output = "";

  return new Promise((resolve) => {
    // Set environment for HTTP transport
    const env = {
      ...process.env,
      MCP_TRANSPORT_TYPE: "http",
      MCP_HTTP_PORT: "3011", // Use different port to avoid conflicts
      MCP_LOG_LEVEL: "info",
      NODE_ENV: "test",
    };

    const child: ChildProcess = spawn("node", ["dist/index.js"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutData = "";
    let stderrData = "";

    child.stdout?.on("data", (data) => {
      stdoutData += data.toString();
    });

    child.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderrData += chunk;

      // Check for logger initialization issues
      if (
        chunk.includes("Logger not initialized") ||
        chunk.includes("message dropped")
      ) {
        errors.push("Logger initialization warning found in stderr");
      }
    });

    // Test HTTP endpoint after startup
    setTimeout(async () => {
      try {
        const response = await fetch("http://127.0.0.1:3011/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "mcp-session-id": "test-session",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test-client", version: "1.0.0" },
            },
          }),
        });

        if (!response.ok) {
          errors.push(`HTTP request failed with status: ${response.status}`);
        }
      } catch (error) {
        errors.push(`HTTP request failed: ${error}`);
      }

      child.kill("SIGTERM");
    }, 3000);

    // Timeout after 8 seconds
    setTimeout(() => {
      child.kill("SIGTERM");
    }, 8000);

    child.on("close", (_code) => {
      const duration = Date.now() - startTime;
      output = `STDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}`;

      // Check for successful HTTP server startup
      const hasHttpStartup =
        stderrData.includes("MCP Server running at") ||
        stderrData.includes("HTTP transport listening");

      if (!hasHttpStartup) {
        errors.push("HTTP server startup confirmation not found");
      }

      const success = errors.length === 0;

      resolve({
        success,
        output,
        errors,
        duration,
      });
    });

    child.on("error", (error) => {
      errors.push(`Process error: ${error.message}`);
      resolve({
        success: false,
        output,
        errors,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Runs comprehensive integration tests.
 */
export async function runIntegrationTests(): Promise<boolean> {
  console.log("🚀 Starting Integration Tests...\n");

  // Ensure the project is built
  console.log("📦 Building project...");
  const buildResult = await new Promise<boolean>((resolve) => {
    const buildProcess = spawn("npm", ["run", "build"], {
      stdio: "inherit",
    });

    buildProcess.on("close", (code) => {
      resolve(code === 0);
    });
  });

  if (!buildResult) {
    console.error("❌ Build failed. Cannot run integration tests.");
    return false;
  }

  console.log("✅ Build completed successfully.\n");

  const tests = [
    { name: "STDIO Transport", test: testStdioTransportStartup },
    { name: "HTTP Transport", test: testHttpTransportStartup },
  ];

  let allPassed = true;

  for (const { name, test } of tests) {
    try {
      const result = await test();

      if (result.success) {
        console.log(`✅ ${name} test passed (${result.duration}ms)`);
      } else {
        console.log(`❌ ${name} test failed (${result.duration}ms)`);
        console.log("Errors:");
        result.errors.forEach((error) => console.log(`  - ${error}`));
        allPassed = false;
      }

      if (process.env.VERBOSE_TESTS) {
        console.log("Output:");
        console.log(result.output);
      }

      console.log();
    } catch (error) {
      console.error(`❌ ${name} test failed with exception:`, error);
      allPassed = false;
      console.log();
    }
  }

  if (allPassed) {
    console.log("🎉 All integration tests passed!");
  } else {
    console.log("❌ Some integration tests failed. Check the output above.");
  }

  return allPassed;
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal test error:", error);
      process.exit(1);
    });
}
