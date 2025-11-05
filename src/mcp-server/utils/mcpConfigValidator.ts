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
    const clientList = Object.keys(CLIENT_PROFILES).join(", ");
    const errorMessage =
      `❌ MCP Setup Required: No MCP configuration found in project directory.\n\n` +
      `Before using MCP analysis tools, you must first set up the configuration file by calling the 'mcp_setup_guide' tool.\n\n` +
      `**Required Action:**\n` +
      `Call 'mcp_setup_guide' tool with your AI client name:\n` +
      `- client: Choose from: ${clientList}\n` +
      `- projectPath: "${projectPath}" (optional, defaults to current directory)\n\n` +
      `**Example:**\n` +
      `mcp_setup_guide({ client: "cursor", projectPath: "." })\n\n` +
      `This will create the necessary configuration file with comprehensive MCP usage guidelines for AI assistants.\n\n` +
      `**Why is this required?**\n` +
      `The setup guide creates a structured documentation file that helps AI assistants understand how to use MCP tools effectively. ` +
      `It includes tool descriptions, workflows, best practices, and examples. This ensures better tool usage and more accurate results.`;

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

