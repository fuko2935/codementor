import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import {
  ErrorHandler,
  logger,
  RequestContext,
  requestContextService,
} from "../../../utils/index.js";
import {
  ProjectBootstrapInputSchema,
  projectBootstrapLogic,
  type ProjectBootstrapInput,
} from "./logic.js";

/**
 * Registers the `project_bootstrap` tool.
 *
 * This is the REQUIRED FIRST STEP for all MCP workflows. It prepares the project for
 * analysis by creating essential configuration files:
 * - Creates/updates AI client configuration (e.g., AGENTS.md) with a full MCP usage guide
 * - Creates a default .mcpignore file to optimize context by excluding irrelevant files
 * - Embeds project-specific rules and constraints into the guide for the AI to follow
 * - Documents .gitignore + .mcpignore based context control
 */
export const registerProjectBootstrap = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "project_bootstrap";
  const toolDescription =
    "🔧 PROJECT BOOTSTRAP - **REQUIRED FIRST STEP**: Initializes the project for AI analysis. Creates essential configuration files and an optimized MCP guide tailored for the current toolset (v5+). Run this once per project.";

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
        ProjectBootstrapInputSchema.shape,
        async (
          params: ProjectBootstrapInput,
          _mcpContext,
        ): Promise<CallToolResult> => {
          // Enforce required authorization scopes for this tool.
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

            const result = await projectBootstrapLogic(
              params,
              handlerContext,
            );

            logger.info(`Tool '${toolName}' executed successfully`, {
              ...handlerContext,
              actions: result.actions,
              summary: result.summary,
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
            const handledError = ErrorHandler.handleError(error, {
              operation: `${toolName}_handler`,
              context: handlerContext,
            });

            const mcpError =
              handledError instanceof McpError
                ? handledError
                : new McpError(
                  BaseErrorCode.INTERNAL_ERROR,
                  "An unexpected error occurred during project_bootstrap",
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