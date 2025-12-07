/**
 * @fileoverview Handles the registration of the `sketch` tool with an MCP server instance.
 * This module defines the tool's metadata, its input schema shape,
 * and the asynchronous handler function that processes file selection requests.
 * @module src/mcp-server/tools/sketch/registration
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
import { config } from "../../../config/index.js";
import {
  SketchInput,
  SketchInputSchemaBase,
  sketchLogic,
} from "./logic.js";

/**
 * Registers the 'sketch' tool and its handler with the provided MCP server instance.
 *
 * @param server - The MCP server instance to register the tool with.
 * @returns A promise that resolves when the tool registration is complete.
 */
export const registerSketch = async (
  server: McpServer,
): Promise<void> => {
  const toolName = "sketch";
  const toolDescription =
    "📐 SKETCH - Intelligently selects relevant files for your task using AI analysis. " +
    "Use this FIRST when starting a new task to identify which files you need to work with. " +
    "Supports hybrid strategies: 'auto' (recommended) chooses between full file reading and metadata mapping based on project size, " +
    "'full' reads complete file contents (for smaller projects), 'map' uses Tree-sitter metadata (for larger projects). " +
    "Returns a ranked list of files with relevance scores and reasons.";

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
        SketchInputSchemaBase.shape,
        async (
          params: SketchInput,
        ): Promise<CallToolResult> => {
          const toolContext: RequestContext =
            requestContextService.createRequestContext({
              operation: "SketchFileSelection",
              projectPath: params.projectPath,
              questionLength: params.question.length,
            });

          logger.info("Processing sketch file selection request", {
            ...toolContext,
            projectPath: params.projectPath,
            question:
              params.question.substring(0, 100) +
              (params.question.length > 100 ? "..." : ""),
            strategy: params.strategy,
          });

          try {
            const result = await sketchLogic(
              params,
              toolContext,
            );

            logger.info("Sketch file selection completed successfully", {
              ...toolContext,
              strategyUsed: result.strategyUsed,
              selectedFilesCount: result.selectedFiles.length,
              totalFilesScanned: result.totalFilesScanned,
            });

            // Format the selected files as a readable list
            const filesList = result.selectedFiles
              .map((file, index) =>
                `${index + 1}. **${file.path}** (score: ${file.relevanceScore.toFixed(2)})\n   └─ ${file.reason}`
              )
              .join("\n\n");

            // Skeptical Agent Protocol: Output Guardrail
            const agentInstruction = `

---

🛡️ **SYSTEM INSTRUCTION TO AI AGENT:**

The file selection above is a **GENERATED RECOMMENDATION** based on structural analysis.

1. **STATUS:** This is an AI-suggested file list, not a definitive answer.
2. **ACTION REQUIRED:** Before making changes, READ the selected files using your file reading capabilities (e.g., \`read_file\`, \`readFile\`).
3. **VALIDATION:** Verify that the selected files are actually relevant to your task by examining their contents.
4. **CRITICAL:** Do NOT assume file contents based on names alone. Always read and verify.
5. **SCOPE:** If important files are missing from this list, use your judgment to search for additional relevant files.`;

            return {
              content: [
                {
                  type: "text",
                  text: `# Sketch File Selection Results

## Project: ${result.projectPath}

**Task:** ${result.question}

**Strategy Used:** ${result.strategyUsed}${result.fallbackOccurred ? " (fallback occurred)" : ""}
**Files Scanned:** ${result.totalFilesScanned}
**Files Selected:** ${result.selectedFiles.length}
**Tokens Used:** ~${result.tokensUsedEstimate.toLocaleString()}

---

## AI Reasoning

${result.reasoning}

---

## Selected Files

${filesList}
${agentInstruction}

---

*Analysis powered by ${config.llmDefaultModel}*`,
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
                    `File selection failed: ${error instanceof Error ? error.message : String(error)}`,
                    { originalError: error },
                  );

            const handledError = ErrorHandler.handleError(mcpError, {
              operation: "SketchFileSelection",
              context: toolContext,
              errorCode: BaseErrorCode.INTERNAL_ERROR,
              critical: false,
            });

            logger.error("Sketch file selection failed", {
              ...toolContext,
              error: handledError.message,
              projectPath: params.projectPath,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `# Sketch File Selection - Error

**Project:** ${params.projectPath}
**Task:** ${params.question}

## Error Details

${handledError.message}

### Troubleshooting Tips:
- Verify the project path exists and is accessible
- Ensure your Gemini API key is valid (if using API mode)
- Check that the project directory contains readable files
- Try with a smaller project or more specific question
- Use .mcpignore to exclude large directories (node_modules, dist, etc.)
- Try with strategy: "map" for very large projects

*For support, check your API key at: https://makersuite.google.com/app/apikey*`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    },
    {
      operation: "RegisterSketch",
      context: registrationContext,
      errorCode: BaseErrorCode.INTERNAL_ERROR,
      critical: true,
    },
  );

  logger.info(
    `Successfully registered tool: '${toolName}'`,
    registrationContext,
  );
};
