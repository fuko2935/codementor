/**
 * @fileoverview Integration test for complete startup sequence validation.
 * Tests both STDIO and HTTP transport startup without logger initialization issues.
 * @module src/validation/integrationTest
 */

import { spawn, ChildProcess } from "child_process";
import { config } from "../config/index.js";

interface TestResult {
  success: boolean;
  output: string;
  errors: string[];
  duration: number;
}

/**
 * Tests STDIO transport startup sequence.
 */
async function testStdioTransportStartup(): Promise<TestResult> {
  console.log("🧪 Testing STDIO Transport Startup...");

  const startTime = Date.now();
  const errors: string[] = [];
  let output = "";

  return new Promise((resolve) => {
    // Set environment for STDIO transport
    const env = {
      ...process.env,
      MCP_TRANSPORT_TYPE: "stdio",
      MCP_LOG_LEVEL: "debug",
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

      // Check for console interference (should not happen in STDIO)
      if (chunk.includes("console.log") || chunk.includes("console.warn")) {
        errors.push("Console interference detected in STDIO transport");
      }
    });

    // Test with a simple MCP request after startup
    setTimeout(() => {
      if (child.stdin) {
        const testRequest =
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test-client", version: "1.0.0" },
            },
          }) + "\n";

        child.stdin.write(testRequest);
      }
    }, 2000);

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill("SIGTERM");
    }, 5000);

    child.on("close", (code) => {
      const duration = Date.now() - startTime;
      output = `STDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}`;

      // Check if stdout contains valid JSON-RPC response
      let hasValidJsonRpc = false;
      try {
        const lines = stdoutData.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.jsonrpc === "2.0" && parsed.id === 1) {
            hasValidJsonRpc = true;
            break;
          }
        }
      } catch (e) {
        errors.push("Invalid JSON-RPC response format");
      }

      if (!hasValidJsonRpc && errors.length === 0) {
        errors.push("No valid JSON-RPC response received");
      }

      const success = errors.length === 0 && hasValidJsonRpc;

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

    child.on("close", (code) => {
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
