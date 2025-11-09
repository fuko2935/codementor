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
  ProjectOrchestratorAnalyzeInputSchema,
  projectOrchestratorAnalyzeLogic,
  type ProjectOrchestratorAnalyzeInput,
} from "./logic.js";

export const registerProjectOrchestratorAnalyze = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "project_orchestrator_analyze";
  const toolDescription =
    "🎭 PROJECT ORCHESTRATOR ANALYZE - STEP 2: Analyze each group and combine results into a single report.";

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
        ProjectOrchestratorAnalyzeInputSchema.shape,
        async (
          params: ProjectOrchestratorAnalyzeInput,
        ): Promise<CallToolResult> => {
          // Enforce required orchestration:read scope before any business logic.
          // withRequiredScopes:
          // - Throws BaseErrorCode.INTERNAL_ERROR when auth context is missing (misconfiguration).
          // - Throws BaseErrorCode.FORBIDDEN when required scopes are missing (403 semantics).
          withRequiredScopes(["orchestration:read"]);

          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "ProjectOrchestratorAnalyze",
              projectPath: params.projectPath,
            });
          try {
            const result = await projectOrchestratorAnalyzeLogic(
              params,
              toolContext,
            );
            return {
              content: [{ type: "text", text: result.analysis }],
              isError: false,
            };
          } catch (error) {
            const mcpError =
              error instanceof McpError
                ? error
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    `Project orchestrator (analyze) failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Project orchestrator (analyze) failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `# Project Orchestrator Analyze - Error\n\n${mcpError.message}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterProjectOrchestratorAnalyze",
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
