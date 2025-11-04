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
  DynamicExpertAnalyzeInputSchema,
  dynamicExpertAnalyzeLogic,
  type DynamicExpertAnalyzeInput,
} from "./logic.js";

export const registerDynamicExpertAnalyze = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "gemini_dynamic_expert_analyze";
  const toolDescription =
    "Uses a custom expert persona prompt to analyze your project and answer a question.";

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
        DynamicExpertAnalyzeInputSchema.shape,
        async (params: DynamicExpertAnalyzeInput): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "DynamicExpertAnalyze",
              projectPath: params.projectPath,
            });
          try {
            const result = await dynamicExpertAnalyzeLogic(params, toolContext);
            return {
              content: [
                {
                  type: "text",
                  text: `# Dynamic Expert Analysis\n\n## Project: ${result.projectPath}\n\n${result.analysis}`,
                },
              ],
              isError: false,
            };
          } catch (error) {
            const mcpError =
              error instanceof McpError
                ? error
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    `Dynamic expert analysis failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Dynamic expert analysis failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `# Dynamic Expert Analyze - Error\n\n${mcpError.message}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterDynamicExpertAnalyze",
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
