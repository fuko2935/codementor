/**
 * @fileoverview Defines the core logic, schemas, and types for the `sketch` tool.
 * This module intelligently selects relevant files for a given task using AI analysis.
 * It uses a hybrid approach: Full (complete file contents) or Map (Tree-sitter metadata).
 * @module src/mcp-server/tools/sketch/logic
 */

import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { logger, type RequestContext, createIgnoreInstance } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { config } from "../../../config/index.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { extractMetadata, type FileMetadata } from "../../utils/codeParser.js";
import { countTokensLocally } from "../../utils/tokenizer.js";

/**
 * Maximum number of files for full strategy before forcing map strategy.
 */
const MAX_FULL_STRATEGY_FILES = 500;

/**
 * Maximum total bytes for full strategy (50MB).
 */
const MAX_FULL_STRATEGY_BYTES = 50 * 1024 * 1024;

/**
 * Base Zod schema for the `sketch` tool input.
 * This is used for MCP tool registration which requires `.shape` property.
 */
export const SketchInputSchemaBase = z.object({
  projectPath: z
    .string()
    .min(1, "Project path cannot be empty.")
    .describe(
      "Absolute path to the project directory to analyze. Must be a valid directory path.",
    ),
  question: z
    .string()
    .min(1, "Question cannot be empty.")
    .max(10000, "Question cannot exceed 10000 characters.")
    .describe(
      "Your question or task description about the codebase. " +
      "Examples: 'Where should I add user authentication?', 'Which files handle API routing?', " +
      "'Find files related to the payment processing feature', 'Where are database models defined?'",
    ),
  strategy: z
    .enum(["auto", "full", "map"])
    .default("auto")
    .describe(
      "Strategy for context retrieval. " +
      "'auto' (default): Automatically chooses based on project size. " +
      "'full': Reads complete file contents (for smaller projects). " +
      "'map': Uses Tree-sitter metadata extraction (for larger projects).",
    ),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe("Additional ignore globs for this run only."),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  maxFilesToSelect: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum number of files to select (1-100). Default: 20."),
  geminiApiKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Gemini API key (not needed for gemini-cli provider). " +
      "Your Gemini API key from Google AI Studio (https://makersuite.google.com/app/apikey)",
    ),
});

/**
 * Type definition for the input parameters of the sketch tool.
 */
export type SketchInput = z.infer<typeof SketchInputSchemaBase>;

/**
 * Interface for a selected file with relevance information.
 */
export interface SelectedFile {
  /** Relative path to the file from project root */
  path: string;
  /** Relevance score from 0.0 to 1.0 */
  relevanceScore: number;
  /** Reason why this file was selected */
  reason: string;
}

/**
 * Interface defining the response structure for the sketch tool.
 */
export interface SketchResponse {
  /** The strategy that was actually used */
  strategyUsed: "full" | "map";
  /** Whether a fallback from full to map occurred */
  fallbackOccurred: boolean;
  /** AI reasoning for file selection */
  reasoning: string;
  /** List of selected files with relevance scores */
  selectedFiles: SelectedFile[];
  /** Total number of files scanned in the project */
  totalFilesScanned: number;
  /** Estimated tokens used in the context */
  tokensUsedEstimate: number;
  /** Project path that was analyzed */
  projectPath: string;
  /** The question that was asked */
  question: string;
}

/**
 * Calculates the total token count for a project.
 *
 * @param projectPath - Path to the project directory
 * @param files - List of file paths to analyze
 * @param context - Request context for logging
 * @returns Promise containing total token count
 */
async function calculateProjectTokens(
  projectPath: string,
  files: string[],
  context: RequestContext,
): Promise<number> {
  let totalTokens = 0;

  for (const file of files) {
    try {
      const filePath = path.join(projectPath, file);
      const content = await fs.readFile(filePath, "utf-8");
      totalTokens += countTokensLocally(content);
    } catch {
      // Skip unreadable files
    }
  }

  logger.debug("Calculated project tokens", {
    ...context,
    totalTokens,
    fileCount: files.length,
  });

  return totalTokens;
}

/**
 * Prepares full context by reading all file contents.
 *
 * @param projectPath - Path to the project directory
 * @param files - List of file paths to include
 * @param context - Request context for logging
 * @returns Promise containing the formatted context string and stats
 */
async function prepareFullContext(
  projectPath: string,
  files: string[],
  context: RequestContext,
): Promise<{ context: string; processedFiles: number; totalBytes: number }> {
  const contextParts: string[] = [];
  let processedFiles = 0;
  let totalBytes = 0;

  for (const file of files) {
    if (processedFiles >= MAX_FULL_STRATEGY_FILES) {
      logger.warning("Max full strategy files reached", {
        ...context,
        processedFiles,
        maxFiles: MAX_FULL_STRATEGY_FILES,
      });
      break;
    }

    if (totalBytes >= MAX_FULL_STRATEGY_BYTES) {
      logger.warning("Max full strategy bytes reached", {
        ...context,
        totalBytes,
        maxBytes: MAX_FULL_STRATEGY_BYTES,
      });
      break;
    }

    try {
      const filePath = path.join(projectPath, file);
      const content = await fs.readFile(filePath, "utf-8");
      const contentBytes = Buffer.byteLength(content, "utf-8");

      contextParts.push(`--- File: ${file} ---\n${content}\n\n`);
      processedFiles++;
      totalBytes += contentBytes;
    } catch {
      // Skip binary/unreadable files
      logger.debug("Skipping unreadable file in full context", {
        ...context,
        file,
      });
    }
  }

  return {
    context: contextParts.join(""),
    processedFiles,
    totalBytes,
  };
}

/**
 * Prepares map context using Tree-sitter metadata extraction.
 *
 * @param projectPath - Path to the project directory
 * @param files - List of file paths to analyze
 * @param context - Request context for logging
 * @returns Promise containing the formatted metadata context string
 */
async function prepareMapContext(
  projectPath: string,
  files: string[],
  context: RequestContext,
): Promise<{ context: string; metadataList: FileMetadata[] }> {
  const metadataList: FileMetadata[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(projectPath, file);
      const content = await fs.readFile(filePath, "utf-8");
      const metadata = await extractMetadata(file, content, context);
      metadataList.push(metadata);
    } catch {
      // Skip unreadable files
      logger.debug("Skipping unreadable file in map context", {
        ...context,
        file,
      });
    }
  }

  // Format metadata into a readable context
  const contextParts = metadataList.map((meta) => {
    const parts = [`📄 ${meta.filePath} [${meta.language}] (~${meta.estimatedTokens} tokens)`];

    if (meta.classes.length > 0) {
      parts.push(`  Classes: ${meta.classes.join(", ")}`);
    }
    if (meta.functions.length > 0) {
      parts.push(`  Functions: ${meta.functions.join(", ")}`);
    }
    if (meta.imports.length > 0) {
      parts.push(`  Imports: ${meta.imports.slice(0, 10).join(", ")}${meta.imports.length > 10 ? "..." : ""}`);
    }
    if (meta.exports.length > 0) {
      parts.push(`  Exports: ${meta.exports.join(", ")}`);
    }

    return parts.join("\n");
  });

  return {
    context: contextParts.join("\n\n"),
    metadataList,
  };
}

/**
 * Parses the LLM JSON response, handling potential markdown formatting.
 *
 * @param rawResponse - The raw response string from the LLM
 * @returns Parsed JSON object
 * @throws Error if parsing fails
 */
function parseLlmJsonResponse(rawResponse: string): {
  reasoning: string;
  selectedFiles: SelectedFile[];
} {
  // Remove potential markdown code blocks
  let cleanedResponse = rawResponse.trim();

  // Handle ```json ... ``` format
  const jsonBlockMatch = cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleanedResponse = jsonBlockMatch[1].trim();
  }

  try {
    return JSON.parse(cleanedResponse);
  } catch (error) {
    throw new Error(`Failed to parse LLM response as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Core logic function for the sketch tool.
 * Analyzes a codebase and selects the most relevant files for a given task.
 *
 * @param params - The input parameters containing project path, question, and options
 * @param context - Request context for logging and tracking
 * @returns Promise containing the sketch response with selected files
 */
export async function sketchLogic(
  params: SketchInput,
  context: RequestContext,
): Promise<SketchResponse> {
  logger.info("Starting sketch file selection", {
    ...context,
    projectPath: params.projectPath,
    questionLength: params.question.length,
    strategy: params.strategy,
  });

  try {
    // Validate and secure the project path
    const resolvedPath = path.resolve(process.cwd(), params.projectPath);
    const root = path.parse(resolvedPath).root;

    const normalizedPath = await validateSecurePath(
      resolvedPath,
      root,
      context,
    );

    // Create ignore instance
    const ig = await createIgnoreInstance({
      projectPath: normalizedPath,
      temporaryIgnore: params.temporaryIgnore,
      ignoreMcpignore: params.ignoreMcpignore,
      context,
    });

    // Scan all files in the project
    const allFiles = await glob("**/*", {
      cwd: normalizedPath,
      nodir: true,
      dot: true,
    });

    // Filter files using ignore instance
    const files = allFiles.filter((f) => !ig.ignores(f));

    logger.info("Found files to analyze", {
      ...context,
      totalFiles: allFiles.length,
      filteredFiles: files.length,
      ignoredFiles: allFiles.length - files.length,
    });

    if (files.length === 0) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "No readable files found in the project directory. Check your .gitignore or .mcpignore files.",
        { projectPath: normalizedPath },
      );
    }

    // Determine strategy
    let effectiveStrategy: "full" | "map" = "full";
    let fallbackOccurred = false;

    if (params.strategy === "map") {
      effectiveStrategy = "map";
    } else if (params.strategy === "auto" || params.strategy === "full") {
      // Calculate token threshold
      const tokenThreshold = config.llmContextWindow * config.sketchContextThresholdRatio;

      // Calculate project tokens
      const projectTokens = await calculateProjectTokens(normalizedPath, files, context);

      logger.debug("Token analysis for strategy selection", {
        ...context,
        projectTokens,
        tokenThreshold,
        contextWindow: config.llmContextWindow,
        thresholdRatio: config.sketchContextThresholdRatio,
      });

      if (params.strategy === "auto") {
        effectiveStrategy = projectTokens >= tokenThreshold ? "map" : "full";
      } else {
        // strategy === "full" - use full but may fallback
        effectiveStrategy = "full";
        if (projectTokens >= tokenThreshold) {
          logger.warning("Full strategy requested but project exceeds threshold, falling back to map", {
            ...context,
            projectTokens,
            tokenThreshold,
          });
          effectiveStrategy = "map";
          fallbackOccurred = true;
        }
      }
    }

    logger.info("Strategy determined", {
      ...context,
      requestedStrategy: params.strategy,
      effectiveStrategy,
      fallbackOccurred,
    });

    // Prepare context based on strategy
    let projectContext: string;
    let tokensUsedEstimate: number;

    if (effectiveStrategy === "full") {
      const fullResult = await prepareFullContext(normalizedPath, files, context);
      projectContext = fullResult.context;
      tokensUsedEstimate = countTokensLocally(projectContext);

      // Check if we need to fallback after preparing context
      const tokenThreshold = config.llmContextWindow * config.sketchContextThresholdRatio;
      if (tokensUsedEstimate >= tokenThreshold) {
        logger.warning("Full context exceeds threshold after preparation, falling back to map", {
          ...context,
          tokensUsedEstimate,
          tokenThreshold,
        });
        effectiveStrategy = "map";
        fallbackOccurred = true;

        const mapResult = await prepareMapContext(normalizedPath, files, context);
        projectContext = mapResult.context;
        tokensUsedEstimate = countTokensLocally(projectContext);
      }
    } else {
      const mapResult = await prepareMapContext(normalizedPath, files, context);
      projectContext = mapResult.context;
      tokensUsedEstimate = countTokensLocally(projectContext);
    }

    // Initialize LLM model
    const model = createModelByProvider(
      config.llmDefaultModel,
      undefined,
      params.geminiApiKey,
    );

    // Build prompt for file selection
    const systemPrompt = `You are an expert code analyst tasked with selecting the most relevant files for a given task.

TASK DESCRIPTION:
${params.question}

PROJECT CONTEXT (${effectiveStrategy === "full" ? "Full file contents" : "Metadata map"}):
${projectContext}

INSTRUCTIONS:
1. Analyze the task description carefully
2. Review the project context provided
3. Select the top ${params.maxFilesToSelect} most relevant files for this task
4. Provide a brief reasoning for your selection
5. Score each file's relevance from 0.0 (low) to 1.0 (high)

RESPONSE FORMAT (JSON only):
{
  "reasoning": "Brief explanation of your selection strategy",
  "selectedFiles": [
    {
      "path": "relative/path/to/file.ext",
      "relevanceScore": 0.95,
      "reason": "Why this file is relevant"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown formatting
- Select files that are directly relevant to the task
- Consider file dependencies and relationships
- Prioritize implementation files over test files unless tests are explicitly needed
- Include configuration files only if they're directly relevant`;

    logger.info("Sending request to LLM for file selection", {
      ...context,
      promptLength: systemPrompt.length,
      tokensUsedEstimate,
    });

    // Send to LLM
    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const rawResponseText = response.text();

    // Parse LLM response
    let parsedResponse: { reasoning: string; selectedFiles: SelectedFile[] };
    try {
      parsedResponse = parseLlmJsonResponse(rawResponseText);
    } catch (parseError) {
      logger.error("Failed to parse LLM response", {
        ...context,
        rawResponse: rawResponseText.substring(0, 500),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        { rawResponse: rawResponseText.substring(0, 200) },
      );
    }

    // Validate selected files exist in the project
    const validatedFiles = parsedResponse.selectedFiles.filter((file) => {
      const exists = files.includes(file.path);
      if (!exists) {
        logger.debug("LLM selected non-existent file, filtering out", {
          ...context,
          selectedPath: file.path,
        });
      }
      return exists;
    });

    // Limit to maxFilesToSelect
    const finalFiles = validatedFiles.slice(0, params.maxFilesToSelect);

    logger.info("Sketch file selection completed", {
      ...context,
      strategyUsed: effectiveStrategy,
      fallbackOccurred,
      selectedFilesCount: finalFiles.length,
      totalFilesScanned: files.length,
    });

    return {
      strategyUsed: effectiveStrategy,
      fallbackOccurred,
      reasoning: parsedResponse.reasoning,
      selectedFiles: finalFiles,
      totalFilesScanned: files.length,
      tokensUsedEstimate,
      projectPath: normalizedPath,
      question: params.question,
    };
  } catch (error) {
    logger.error("Sketch file selection failed", {
      ...context,
      error: String(error),
      projectPath: params.projectPath,
    });

    // Re-throw McpError as-is, wrap others
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `File selection failed: ${error instanceof Error ? error.message : String(error)}`,
      { originalError: error },
    );
  }
}
