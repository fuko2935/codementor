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
 * The generated analysisModePrompt can be used with gemini_codebase_analyzer's customExpertPrompt parameter.
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
  const toolName = "create_analysis_mode";
  const toolDescription = `Creates custom expert analysis modes for codebase analysis.

Supports three modes:
1. Manual Mode (withAi=false): Use expertiseHint directly as the expert prompt
2. AI-Assisted General (withAi=true, no projectPath): AI generates a general expert prompt based on your hint
3. AI-Assisted Project-Specific (withAi=true, with projectPath): AI generates a project-specific expert prompt

The generated analysisModePrompt can be used with gemini_codebase_analyzer's customExpertPrompt parameter.

Examples:
- Manual: {"expertiseHint": "You are a security expert...", "withAi": false}
- AI General: {"expertiseHint": "Create a security-focused code reviewer", "withAi": true}
- AI Project: {"expertiseHint": "Create a security expert for this project", "withAi": true, "projectPath": "."}`;

  // Register tool with MCP server (Requirement 5.1)
  server.tool(
    toolName,
    toolDescription,
    CreateAnalysisModeInputSchema.shape,
    async (params: CreateAnalysisModeInput, mcpContext: any): Promise<CallToolResult> => {
      // Create request context from mcpContext (Requirement 6.2)
      const context = requestContextService.createRequestContext({
        userId: mcpContext?.userId,
        clientId: mcpContext?.clientId,
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
          modeType: result.modeType,
          promptLength: result.analysisModePrompt.length,
          returnFormat: params.returnFormat || "json"
        });

        // Format success response based on returnFormat (Requirement 6.3)
        const responseText = params.returnFormat === "prompt_only"
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
