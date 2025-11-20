// src/mcp-server/utils/stdioSilence.ts

import { config } from "../../config/index.js";

/**
 * Executes a specified async function while temporarily silencing all stdout
 * and stderr output, but only if MCP_TRANSPORT_TYPE='stdio'.
 * Guarantees restoration of original streams even if an error occurs.
 *
 * @param operationToSilence The async function to execute.
 * @returns Returns the function's return value.
 * @template T The function's return type.
 */
export async function executeUnderStdioSilence<T>(
  operationToSilence: () => Promise<T>
): Promise<T> {
  if (config.mcpTransportType !== "stdio") {
    // If not in stdio mode, do nothing, just execute directly.
    return operationToSilence();
  }

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  try {
    // Block all output
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    // Execute the actual operation
    return await operationToSilence();
  } finally {
    // Restore original functions even if error occurs
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}