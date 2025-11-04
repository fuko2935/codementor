/**
 * @fileoverview Main entry point for the MCP (Model Context Protocol) server.
 * This file orchestrates the server's lifecycle:
 * 1. Initializes the core `McpServer` instance (from `@modelcontextprotocol/sdk`) with its identity and capabilities.
 * 2. Registers available resources and tools, making them discoverable and usable by clients.
 * 3. Selects and starts the appropriate communication transport (stdio or Streamable HTTP)
 *    based on configuration.
 * 4. Handles top-level error management during startup.
 *
 * MCP Specification References:
 * - Lifecycle: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/lifecycle.mdx
 * - Overview (Capabilities): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/index.mdx
 * - Transports: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx
 * @module src/mcp-server/server
 */

import { ServerType } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config, environment } from "../config/index.js";
import { ErrorHandler, logger, requestContextService } from "../utils/index.js";
import { BaseErrorCode } from "../types-global/errors.js";
import { registerGeminiCodebaseAnalyzer } from "./tools/geminiCodebaseAnalyzer/index.js";
import { registerGeminiCodeSearch } from "./tools/geminiCodeSearch/index.js";
import { registerDynamicExpertCreate } from "./tools/dynamicExpertCreate/index.js";
import { registerDynamicExpertAnalyze } from "./tools/dynamicExpertAnalyze/index.js";
import { registerCalculateTokenCount } from "./tools/calculateTokenCount/index.js";
import { registerProjectOrchestratorCreate } from "./tools/projectOrchestratorCreate/index.js";
import { registerProjectOrchestratorAnalyze } from "./tools/projectOrchestratorAnalyze/index.js";
import { startHttpTransport } from "./transports/httpTransport.js";
import { connectStdioTransport } from "./transports/stdioTransport.js";
import { warmupTreeSitter } from "./utils/codeParser.js";

/**
 * Creates and configures a new instance of the `McpServer`.
 *
 * @returns A promise resolving with the configured `McpServer` instance.
 * @throws {McpError} If any resource or tool registration fails.
 * @private
 */
async function createMcpServerInstance(): Promise<McpServer> {
  const context = requestContextService.createRequestContext({
    operation: "createMcpServerInstance",
  });
  logger.info("Initializing MCP server instance", context);

  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment,
  });

  // Pre-initialize Tree-sitter WASM before STDIO transport starts
  // This prevents WASM loading messages from polluting stdout/JSON-RPC stream
  if (config.mcpTransportType === "stdio") {
    try {
      logger.debug("Pre-initializing Tree-sitter for STDIO transport", context);
      
      // Temporarily suppress console output during Tree-sitter initialization
      // to prevent WASM loading messages from polluting JSON-RPC stream
      const originalLog = console.log;
      const originalInfo = console.info;
      const originalWarn = console.warn;
      const originalError = console.error;
      
      console.log = () => {};
      console.info = () => {};
      console.warn = () => {};
      console.error = () => {};
      
      try {
        await warmupTreeSitter(["javascript", "typescript", "python"]);
      } finally {
        // Restore console methods
        console.log = originalLog;
        console.info = originalInfo;
        console.warn = originalWarn;
        console.error = originalError;
      }
      
      logger.debug("Tree-sitter pre-initialization completed", context);
    } catch (error) {
      // Non-critical - Tree-sitter will be initialized on first use
      logger.debug("Tree-sitter pre-initialization failed, will retry on first use", {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const server = new McpServer(
    { name: config.mcpServerName, version: config.mcpServerVersion },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: true },
      },
    },
  );

  await ErrorHandler.tryCatch(
    async () => {
      logger.debug("Registering resources and tools...", context);
      await registerGeminiCodebaseAnalyzer(server);
      await registerGeminiCodeSearch(server);
      await registerDynamicExpertCreate(server);
      await registerDynamicExpertAnalyze(server);
      await registerCalculateTokenCount(server);
      await registerProjectOrchestratorCreate(server);
      await registerProjectOrchestratorAnalyze(server);
      logger.info("Resources and tools registered successfully", context);
    },
    {
      operation: "registerAllCapabilities",
      context,
      errorCode: BaseErrorCode.INITIALIZATION_FAILED,
      critical: true,
    },
  );

  return server;
}

/**
 * Selects, sets up, and starts the appropriate MCP transport layer based on configuration.
 *
 * @returns Resolves with `McpServer` for 'stdio', `http.Server` for 'http', or `void`.
 * @throws {Error} If transport type is unsupported or setup fails.
 * @private
 */
async function startTransport(): Promise<McpServer | ServerType | void> {
  const transportType = config.mcpTransportType;
  const context = requestContextService.createRequestContext({
    operation: "startTransport",
    transport: transportType,
  });
  logger.info(`Starting transport: ${transportType}`, context);

  if (transportType === "http") {
    return startHttpTransport(createMcpServerInstance, context);
  }

  if (transportType === "stdio") {
    const server = await createMcpServerInstance();
    await connectStdioTransport(server, context);
    return server;
  }

  throw new Error(
    `Unsupported transport type: ${transportType}. Must be 'stdio' or 'http'.`,
  );
}

/**
 * Main application entry point. Initializes and starts the MCP server.
 */
export async function initializeAndStartServer(): Promise<
  void | McpServer | ServerType
> {
  const context = requestContextService.createRequestContext({
    operation: "initializeAndStartServer",
  });
  logger.info("MCP Server initialization sequence started.", context);
  try {
    const result = await startTransport();
    logger.info(
      "MCP Server initialization sequence completed successfully.",
      context,
    );
    return result;
  } catch (err) {
    ErrorHandler.handleError(err, {
      operation: "initializeAndStartServer",
      context: context,
      critical: true,
      rethrow: false,
    });
    logger.info(
      "Exiting process due to critical initialization error.",
      context,
    );
    process.exit(1);
  }
}
