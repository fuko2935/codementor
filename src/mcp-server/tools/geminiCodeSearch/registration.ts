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
  GeminiCodeSearchInputSchema,
  geminiCodeSearchLogic,
  type GeminiCodeSearchInput,
} from "./logic.js";

export const registerGeminiCodeSearch = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "gemini_code_search";
  const toolDescription =
    "Searches a codebase for snippets matching a query and explains findings.";

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
        GeminiCodeSearchInputSchema.shape,
        async (params: GeminiCodeSearchInput): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "GeminiCodeSearch",
              projectPath: params.projectPath,
            });

          try {
            const result = await geminiCodeSearchLogic(params, toolContext);
            return {
              content: [
                {
                  type: "text",
                  text: `# Gemini Code Search Results\n\n## Project: ${result.projectPath}\n**Query:** ${result.query}\n**Files Scanned:** ${result.totalFiles}\n**Relevant Files:** ${result.relevantCount}\n\n---\n\n## Analysis\n\n${result.analysis}`,
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
                    `Code search failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
            logger.error("Gemini code search failed", {
              ...toolContext,
              error: mcpError.message,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `# Gemini Code Search - Error\n\n${mcpError.message}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterGeminiCodeSearch",
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
