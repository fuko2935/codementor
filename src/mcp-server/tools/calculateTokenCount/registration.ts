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
  CalculateTokenCountInputSchema,
  calculateTokenCountLogic,
  type CalculateTokenCountInput,
} from "./logic.js";

export const registerCalculateTokenCount = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "weigh";
  const toolDescription =
    "⚖️ WEIGH - Measures the token cost and size of your project or text. Essential for planning analysis strategies on large codebases. Can also weigh git diffs for review planning.";

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
        CalculateTokenCountInputSchema.shape,
        async (params: CalculateTokenCountInput): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "CalculateTokenCount",
              projectPath: params.projectPath || "direct_text",
            });
          try {
            const result = await calculateTokenCountLogic(params, toolContext);
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              isError: false,
            };
          } catch (error) {
            const mcpError =
              error instanceof McpError
                ? error
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    `Token count failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Token count failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: { message: mcpError.message },
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterCalculateTokenCount",
      context: registrationContext,
      errorCode: BaseErrorCode.INITIALIZATION_FAILED,
      critical: true,
    },
  );

  logger.info(
    `Successfully registered tool: '${toolName}'`,
    registrationContext,
  );
};
