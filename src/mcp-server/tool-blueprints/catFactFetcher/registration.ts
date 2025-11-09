/**
 * @fileoverview [ARCHITECTURAL BLUEPRINT] Handles the registration of the `get_random_cat_fact` tool.
 * This module serves as the primary template for creating new asynchronous tools.
 * DO NOT REMOVE: This tool is a living example of our architectural standards.
 * @module src/mcp-server/tools/catFactFetcher/registration
 */

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
  CatFactFetcherInput,
  CatFactFetcherInputSchema,
  catFactFetcherLogic,
} from "./logic.js";

/**
 * Registers the 'get_random_cat_fact' tool and its handler with the MCP server.
 *
 * @param server - The MCP server instance to register the tool with.
 * @returns A promise that resolves when tool registration is complete.
 */
export const registerCatFactFetcherTool = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "get_random_cat_fact";
  const toolDescription =
    "Fetches a random cat fact from the Cat Fact Ninja API. Optionally, a maximum length for the fact can be specified.";

  const registrationContext: RequestContext =
    requestContextService.createRequestContext({
      operation: "RegisterTool",
      toolName: toolName,
    });

  logger.info(`Registering tool: '${toolName}'`, registrationContext);

  await ErrorHandler.tryCatch(
    async () => {
      server.tool(
        toolName,
        toolDescription,
        CatFactFetcherInputSchema.shape,
        async (
          params: CatFactFetcherInput,
          mcpContext: unknown,
        ): Promise<CallToolResult> => {
          // Enforce required authorization scope for performing external fetch operations.
          // Throws:
          // - McpError(BaseErrorCode.INTERNAL_ERROR) if auth context is missing (misconfiguration).
          // - McpError(BaseErrorCode.FORBIDDEN) if "external:fetch" scope is not granted.
          // - Continues execution unchanged when the required scope is present.
          withRequiredScopes(["external:fetch"]);

          const handlerContext: RequestContext =
            requestContextService.createRequestContext({
              parentRequestId: registrationContext.requestId,
              operation: "HandleToolRequest",
              toolName: toolName,
              mcpToolContext: mcpContext,
              input: params,
            });

          try {
            const result = await catFactFetcherLogic(params, handlerContext);
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              isError: false,
            };
          } catch (error) {
            const handledError = ErrorHandler.handleError(error, {
              operation: "catFactFetcherToolHandler",
              context: handlerContext,
              input: params,
            });

            const mcpError =
              handledError instanceof McpError
                ? handledError
                : new McpError(
                    BaseErrorCode.INTERNAL_ERROR,
                    "An unexpected error occurred while fetching a cat fact.",
                    { originalErrorName: handledError.name },
                  );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: {
                      code: mcpError.code,
                      message: mcpError.message,
                      details: mcpError.details,
                    },
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      );

      logger.info(
        `Tool '${toolName}' registered successfully.`,
        registrationContext,
      );
    },
    {
      operation: `RegisteringTool_${toolName}`,
      context: registrationContext,
      errorCode: BaseErrorCode.INITIALIZATION_FAILED,
      critical: true,
    },
  );
};
