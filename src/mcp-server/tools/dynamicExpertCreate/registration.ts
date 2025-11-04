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
  DynamicExpertCreateInputSchema,
  dynamicExpertCreateLogic,
  type DynamicExpertCreateInput,
} from "./logic.js";

export const registerDynamicExpertCreate = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "gemini_dynamic_expert_create";
  const toolDescription =
    "Generates a custom expert persona prompt tailored to your project.";

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
        DynamicExpertCreateInputSchema.shape,
        async (params: DynamicExpertCreateInput): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "DynamicExpertCreate",
              projectPath: params.projectPath,
            });
          try {
            const result = await dynamicExpertCreateLogic(params, toolContext);
            return {
              content: [
                {
                  type: "text",
                  text: `# Dynamic Expert Created Successfully!\n\n## Project: ${result.projectPath}\n**Files Processed:** ${result.filesProcessed}\n**Total Characters:** ${result.totalCharacters.toLocaleString()}\n\n---\n\n## Generated Expert Prompt\n\n\`\`\`\n${result.expertPrompt}\n\`\`\``,
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
                    `Dynamic expert creation failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Dynamic expert creation failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `# Dynamic Expert Create - Error\n\n${mcpError.message}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterDynamicExpertCreate",
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
