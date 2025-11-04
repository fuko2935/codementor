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
  ProjectOrchestratorCreateInputSchema,
  projectOrchestratorCreateLogic,
  type ProjectOrchestratorCreateInput,
} from "./logic.js";

export const registerProjectOrchestratorCreate = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "project_orchestrator_create";
  const toolDescription =
    "🎭 PROJECT ORCHESTRATOR CREATE - STEP 1: Create intelligent groups for massive projects to stay within token limits.";

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
        ProjectOrchestratorCreateInputSchema.shape,
        async (
          params: ProjectOrchestratorCreateInput,
        ): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "ProjectOrchestratorCreate",
              projectPath: params.projectPath,
            });
          try {
            const result = await projectOrchestratorCreateLogic(
              params,
              toolContext,
            );
            return {
              content: [{ type: "text", text: result.groupsData }],
              isError: false,
            };
          } catch (error) {
            const mcpError =
              error instanceof McpError
                ? error
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    `Project orchestrator (create) failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Project orchestrator (create) failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `{"error":"${mcpError.message.replace(/"/g, '\\"')}"}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterProjectOrchestratorCreate",
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
