import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import {
  ErrorHandler,
  logger,
  RequestContext,
  requestContextService,
} from "../../../utils/index.js";
import { withRequiredScopes } from "../../transports/auth/core/authUtils.js";

import {
  McpSetupGuideInputSchema,
  mcpSetupGuideLogic,
  type McpSetupGuideInput,
  CLIENT_PROFILES,
} from "./logic.js";

export const registerMcpSetupGuide = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "mcp_setup_guide";
  const clientList = Object.keys(CLIENT_PROFILES).join(", ");
  const toolDescription =
    `🔧 MCP SETUP GUIDE - REQUIRED FIRST STEP: Creates AI client configuration file with MCP tool usage guide. ` +
    `This tool generates a comprehensive usage guide for AI assistants in the format specific to your AI client. ` +
    `Supported clients: ${clientList}. ` +
    `**IMPORTANT:** Other MCP tools will not work until this setup is completed. ` +
    `The generated file contains tool descriptions, workflows, best practices, and examples for effective MCP usage.`;

  const registrationContext: RequestContext =
    requestContextService.createRequestContext({
      operation: "RegisterTool",
      toolName,
    });
  logger.info(`Registering tool: '${toolName}'`, registrationContext);

  await ErrorHandler.tryCatch(
    async () => {
      server.tool(
        toolName,
        toolDescription,
        McpSetupGuideInputSchema.shape,
        async (
          params: McpSetupGuideInput,
          _mcpContext,
        ): Promise<CallToolResult> => {
          // Enforce required authorization scopes for this tool.
          // - Missing auth context -> McpError(BaseErrorCode.INTERNAL_ERROR)
          // - Missing required scopes -> McpError(BaseErrorCode.FORBIDDEN)
          withRequiredScopes(["config:read"]);

          const handlerContext: RequestContext =
            requestContextService.createRequestContext({
              parentRequestId: registrationContext.requestId,
              operation: "HandleToolRequest",
              toolName,
            });

          try {
            logger.info(
              `Executing '${toolName}' with client: ${params.client}`,
              handlerContext,
            );

            const result = await mcpSetupGuideLogic(params, handlerContext);

            logger.info(`Tool '${toolName}' executed successfully`, {
              ...handlerContext,
              action: result.action,
              filePath: result.filePath,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
              isError: false,
            };
          } catch (error) {
            // Use central error handler for consistent error processing
            const handledError = ErrorHandler.handleError(error, {
              operation: `${toolName}_handler`,
              context: handlerContext,
            });

            // Convert to McpError if needed
            const mcpError =
              handledError instanceof McpError
                ? handledError
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    "An unexpected error occurred during setup",
                    { originalError: String(error) },
                  );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: false,
                      error: mcpError.message,
                      code: mcpError.code,
                      details: mcpError.details,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
        },
      );

      logger.info(
        `Successfully registered tool: '${toolName}'`,
        registrationContext,
      );
    },
    {
      operation: `RegisterTool_${toolName}`,
      context: registrationContext,
      errorCode: BaseErrorCode.INITIALIZATION_FAILED,
      critical: true,
    },
  );
};

