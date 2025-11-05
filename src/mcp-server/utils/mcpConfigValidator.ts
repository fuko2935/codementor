/**
 * @fileoverview MCP Configuration Validator
 * Checks if MCP setup guide has been configured before allowing tool usage
 * @module src/mcp-server/utils/mcpConfigValidator
 */

import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { logger, type RequestContext } from "../../utils/index.js";
import { mcpConfigExists, CLIENT_PROFILES } from "../tools/mcpSetupGuide/logic.js";

/**
 * Validates that MCP configuration exists in the project
 * Throws an error with helpful instructions if not found
 * 
 * @param projectPath - Project directory path to check
 * @param context - Request context for logging
 * @throws {McpError} If MCP configuration is not found
 */
export async function validateMcpConfigExists(
  projectPath: string,
  context: RequestContext,
): Promise<void> {
  const configCheck = await mcpConfigExists(projectPath, context);

  if (!configCheck.exists) {
    const errorMessage =
      `\n` +
      `█████████████████████████████████████████████████████████████████\n` +
      `█                                                               █\n` +
      `█  🚨 STOP - YOU MUST RUN 'mcp_setup_guide' TOOL FIRST 🚨     █\n` +
      `█                                                               █\n` +
      `█████████████████████████████████████████████████████████████████\n\n` +
      `⛔ THIS TOOL CANNOT RUN WITHOUT SETUP ⛔\n\n` +
      `REQUIRED FIRST STEP (takes 1 second):\n` +
      `Call mcp_setup_guide tool NOW:\n\n` +
      `  mcp_setup_guide({ \n` +
      `    client: "cursor",    // or: gemini-cli, claude-code, warp, cline, etc.\n` +
      `    projectPath: "."\n` +
      `  })\n\n` +
      `After setup completes, you can use all MCP analysis tools.\n\n` +
      `WHY THIS IS REQUIRED:\n` +
      `The setup guide provides essential documentation on how to use MCP tools\n` +
      `correctly. This ensures efficient analysis and avoids token limits or\n` +
      `incorrect operations. It takes 1 second to run.\n\n` +
      `❌ DO NOT try to analyze files manually\n` +
      `✅ DO call mcp_setup_guide first`;

    logger.warning("MCP config validation failed - setup required", {
      ...context,
      projectPath,
    });

    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      errorMessage,
      {
        projectPath,
        requiredAction: "call_mcp_setup_guide",
        availableClients: Object.keys(CLIENT_PROFILES),
      },
    );
  }

  logger.debug("MCP config validation passed", {
    ...context,
    projectPath,
    configFile: configCheck.filePath,
    client: configCheck.client,
  });
}

/**
 * Optional: Creates a more lenient validator that only logs a warning
 * Can be used for tools that should work even without MCP config
 * 
 * @param projectPath - Project directory path to check
 * @param context - Request context for logging
 */
export async function warnIfMcpConfigMissing(
  projectPath: string,
  context: RequestContext,
): Promise<void> {
  const configCheck = await mcpConfigExists(projectPath, context);

  if (!configCheck.exists) {
    logger.warning(
      "MCP config not found - tool will proceed but setup is recommended",
      {
        ...context,
        projectPath,
        recommendation: "call_mcp_setup_guide",
      },
    );
  }
}

