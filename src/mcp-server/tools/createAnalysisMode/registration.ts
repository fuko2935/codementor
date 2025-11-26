/**
 * @fileoverview Registration handler for createAnalysisMode MCP tool
 * @module src/mcp-server/tools/createAnalysisMode/registration
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ErrorHandler,
  logger,
  requestContextService,
  sanitization
} from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import {
  CreateAnalysisModeInputSchema,
  createAnalysisModeLogic,
  type CreateAnalysisModeInput
} from "./logic.js";

/**
 * Registers the createAnalysisMode tool with the MCP server
 * 
 * @param server - MCP server instance
 * 
 * Requirements: 5.1, 5.2, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3
 * 
 * Tool Description:
 * Creates custom expert analysis modes through three approaches:
 * - Manual: User provides prompt directly (withAi=false)
 * - AI-Assisted General: AI generates prompt from hint (withAi=true, no projectPath)
 * - AI-Assisted Project-Specific: AI generates prompt tailored to project (withAi=true, with projectPath)
 * 
 * The generated analysisModePrompt can be used with insight's customExpertPrompt parameter.
 * 
 * Workflow:
 * 1. Create request context from mcpContext
 * 2. Wrap logic call in try-catch
 * 3. Format success response as CallToolResult
 * 4. Handle errors with ErrorHandler
 * 5. Convert to McpError and format error response
 * 6. Log all operations with context
 */
export const registerCreateAnalysisMode = async (server: McpServer): Promise<void> => {
  const toolName = "forge";
  const toolDescription = `🔨 FORGE - Crafts specialized expert personas (Analysis Modes) for specific tasks.

Actions:
1. create (default): Forge a new expert persona.
   - Manual: Define the prompt yourself.
   - AI-Assisted: Let AI craft the perfect persona based on your hint and project context.
2. list: List all available experts in your armory.
3. delete: Remove a custom expert.

Use the created modes with 'insight' by passing 'custom:mode-name' to analysisMode.

Examples:
- Create Manual: {"action": "create", "expertiseHint": "You are a security expert...", "withAi": false}
- Create AI: {"action": "create", "expertiseHint": "Create a security expert", "withAi": true, "projectPath": "."}
- List: {"action": "list"}
- Delete: {"action": "delete", "modeName": "my-custom-mode"}`;

  // Register tool with MCP server (Requirement 5.1)
  server.tool(
    toolName,
    toolDescription,
    CreateAnalysisModeInputSchema.shape,
    async (params: CreateAnalysisModeInput, mcpContext: unknown): Promise<CallToolResult> => {
      // Create request context from mcpContext (Requirement 6.2)
      const ctx = mcpContext as { userId?: string; clientId?: string } | undefined;
      const context = requestContextService.createRequestContext({
        userId: ctx?.userId,
        clientId: ctx?.clientId,
        operation: toolName
      });

      try {
        // Log tool invocation with sanitized params (Requirement 6.5, 7.1)
        logger.info(`${toolName} invoked`, {
          ...context,
          params: sanitization.sanitizeForLogging(params)
        });

        // Call core logic (Requirement 5.2, 7.2)
        const result = await createAnalysisModeLogic(params, context);

        // Log successful completion (Requirement 7.3)
        logger.info(`${toolName} completed successfully`, {
          ...context,
          action: result.action,
          modeType: result.modeType,
          promptLength: result.analysisModePrompt?.length,
          modesCount: result.modes?.length,
          returnFormat: params.returnFormat || "json"
        });

        // Format success response based on returnFormat (Requirement 6.3)
        const responseText = params.returnFormat === "prompt_only" && result.analysisModePrompt
          ? result.analysisModePrompt
          : JSON.stringify(result, null, 2);

        return {
          content: [{
            type: "text",
            text: responseText
          }],
          isError: false
        };
      } catch (error) {
        // Handle errors with ErrorHandler (Requirement 6.4)
        const handledError = ErrorHandler.handleError(error, {
          operation: toolName,
          context,
          input: sanitization.sanitizeForLogging(params)
        });

        // Convert to McpError (Requirement 6.4)
        const mcpError = handledError instanceof McpError
          ? handledError
          : new McpError(
              BaseErrorCode.INTERNAL_ERROR,
              "Unexpected error occurred",
              { originalError: String(error) }
            );

        // Log error with context (Requirement 6.5, 7.3)
        logger.error(`${toolName} failed`, {
          ...context,
          error: mcpError.code,
          message: mcpError.message,
          details: mcpError.details
        });

        // Format error response (Requirement 6.4)
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                code: mcpError.code,
                message: mcpError.message,
                details: mcpError.details
              }
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  logger.info(`Registered tool: ${toolName}`);
};
