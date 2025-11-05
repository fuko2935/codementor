/**
 * @fileoverview Defines the core logic, schemas, and types for the `gemini_codebase_analyzer` tool.
 * This module analyzes complete codebases using Gemini AI, providing comprehensive code analysis,
 * architecture insights, and answers to specific questions about the codebase.
 * @module src/mcp-server/tools/geminiCodebaseAnalyzer/logic
 */

import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { logger, type RequestContext, createIgnoreInstance } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { config } from "../../../config/index.js";
import { createGeminiCliModel } from "../../../services/llm-providers/geminiCliProvider.js";
import { getSystemPrompt } from "../../prompts.js";
import { validateProjectSize } from "../../utils/projectSizeValidator.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";

/**
 * Zod schema defining the input parameters for the `gemini_codebase_analyzer` tool.
 */
export const GeminiCodebaseAnalyzerInputSchema = z
  .object({
    projectPath: z
      .string()
      .min(1, "Project path cannot be empty.")
      .describe(
        "Absolute path to the project directory to analyze. Must be a valid directory path.",
      ),
    question: z
      .string()
      .min(1, "Question cannot be empty.")
      .max(50000, "Question cannot exceed 50000 characters.")
      .describe(
        "Your question about the codebase. Examples: 'What does this project do?', 'Find potential bugs', 'Explain the architecture', 'How to add a new feature?', 'Review code quality'",
      ),
    analysisMode: z
      .enum([
        "general",
        "implementation",
        "refactoring",
        "explanation",
        "debugging",
        "audit",
        "security",
        "performance",
        "testing",
        "documentation",
      ])
      .default("general")
      .optional()
      .describe(
        "Analysis mode that guides the type of analysis to perform. Options: general, implementation, refactoring, explanation, debugging, audit, security, performance, testing, documentation",
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
    geminiApiKey: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional Gemini API key (not needed for gemini-cli provider). Your Gemini API key from Google AI Studio (https://makersuite.google.com/app/apikey)",
      ),
  })
  .describe("Input parameters for analyzing a codebase with Gemini AI");

/**
 * Type definition for the input parameters of the Gemini codebase analyzer.
 */
export type GeminiCodebaseAnalyzerInput = z.infer<
  typeof GeminiCodebaseAnalyzerInputSchema
>;

/**
 * Interface defining the response structure for the codebase analysis.
 */
export interface GeminiCodebaseAnalyzerResponse {
  /** The AI-generated analysis response */
  analysis: string;
  /** Number of files processed */
  filesProcessed: number;
  /** Total characters in the codebase */
  totalCharacters: number;
  /** Project path that was analyzed */
  projectPath: string;
  /** The question that was asked */
  question: string;
}


/**
 * Maximum allowed total file size in bytes (100 MB).
 */
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

/**
 * Creates a model instance based on the configured provider.
 * Supports both gemini-cli (OAuth) and direct API key authentication.
 */
function createModelByProvider(
  modelId: string,
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
  },
  apiKey?: string,
) {
  const provider = config.llmDefaultProvider as
    | "gemini"
    | "google"
    | "gemini-cli";
  if (provider === "gemini-cli") {
    return createGeminiCliModel(modelId, {}, generationConfig);
  }
  const key =
    apiKey ||
    config.geminiApiKey ||
    config.googleApiKey ||
    process.env.GEMINI_API_KEY ||
    "";
  if (!key) {
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      "Missing Gemini API key. Provide geminiApiKey or set GEMINI_API_KEY.",
    );
  }
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: modelId,
    generationConfig: generationConfig || {},
  });
}

/**
 * Maximum allowed number of files to process.
 */
const MAX_FILE_COUNT = 1000;

/**
 * Prepares the full context of a project by reading all files and combining them.
 * Includes circuit breaker protection to prevent server crashes on large projects.
 *
 * @param projectPath - The path to the project directory
 * @param context - Request context for logging
 * @returns Promise containing the full project context as a string
 * @throws {McpError} If project exceeds size or file count limits
 */
async function prepareFullContext(
  projectPath: string,
  temporaryIgnore: string[] | undefined,
  ignoreMcpignore: boolean | undefined,
  context: RequestContext,
): Promise<string> {
  logger.debug("Starting project context preparation", {
    ...context,
    projectPath,
  });

  try {
    const ig = await createIgnoreInstance({
      projectPath,
      temporaryIgnore,
      ignoreMcpignore,
      context,
    });

    // Scan all files in the project (including dotfiles)
    const allFiles = await glob("**/*", {
      cwd: projectPath,
      nodir: true,
      dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
    });

    // Filter files using ignore instance
    const files = allFiles.filter((f) => !ig.ignores(f));

    logger.info("Found files to process", {
      ...context,
      fileCount: files.length,
    });

    // Check file count limit before processing
    if (files.length > MAX_FILE_COUNT) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Project too large: ${files.length} files found (maximum ${MAX_FILE_COUNT} allowed). ` +
          `For large projects, please use the \`project_orchestrator_create\` and \`project_orchestrator_analyze\` tools instead, ` +
          `which handle large codebases more efficiently by splitting them into manageable groups.`,
        {
          fileCount: files.length,
          maxFileCount: MAX_FILE_COUNT,
        },
      );
    }

    let fullContext = "";
    let processedFiles = 0;
    let totalSize = 0;

    // Read each file and combine content
    for (const file of files) {
      try {
        // Check file count limit during processing (safety check)
        if (processedFiles >= MAX_FILE_COUNT) {
          throw new McpError(
            BaseErrorCode.VALIDATION_ERROR,
            `Project too large: processed ${processedFiles} files (maximum ${MAX_FILE_COUNT} allowed). ` +
              `For large projects, please use the \`project_orchestrator_create\` and \`project_orchestrator_analyze\` tools instead.`,
            {
              processedFiles,
              maxFileCount: MAX_FILE_COUNT,
            },
          );
        }

        const filePath = path.join(projectPath, file);
        const content = await fs.readFile(filePath, "utf-8");
        const contentSize = Buffer.byteLength(content, "utf-8");

        // Check total size limit
        if (totalSize + contentSize > MAX_TOTAL_SIZE) {
          throw new McpError(
            BaseErrorCode.VALIDATION_ERROR,
            `Project too large: total size exceeds ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit ` +
              `(current: ${Math.round(totalSize / (1024 * 1024))}MB). ` +
              `For large projects, please use the \`project_orchestrator_create\` and \`project_orchestrator_analyze\` tools instead, ` +
              `which handle large codebases more efficiently by splitting them into manageable groups.`,
            {
              currentSize: totalSize,
              maxSize: MAX_TOTAL_SIZE,
              processedFiles,
            },
          );
        }

        fullContext += `--- File: ${file} ---\n`;
        fullContext += content;
        fullContext += "\n\n";
        processedFiles++;
        totalSize += contentSize;
      } catch (error) {
        // Re-throw McpError (circuit breaker)
        if (error instanceof McpError) {
          throw error;
        }
        // Skip binary files or unreadable files
        logger.debug("Skipping unreadable file", {
          ...context,
          file,
          error: String(error),
        });
      }
    }

    logger.info("Project context prepared successfully", {
      ...context,
      processedFiles,
      totalCharacters: fullContext.length,
      totalSizeBytes: totalSize,
    });

    return fullContext;
  } catch (error) {
    // Re-throw McpError as-is (circuit breaker)
    if (error instanceof McpError) {
      throw error;
    }
    logger.error("Failed to prepare project context", {
      ...context,
      error: String(error),
    });
    throw new Error(`Failed to prepare project context: ${error}`);
  }
}

/**
 * Core logic function for the Gemini codebase analyzer tool.
 * Analyzes a complete codebase using Gemini AI and returns comprehensive insights.
 *
 * @param params - The input parameters containing project path, question, and API key
 * @param context - Request context for logging and tracking
 * @returns Promise containing the analysis response
 */
export async function geminiCodebaseAnalyzerLogic(
  params: GeminiCodebaseAnalyzerInput,
  context: RequestContext,
): Promise<GeminiCodebaseAnalyzerResponse> {
  logger.info("Starting Gemini codebase analysis", {
    ...context,
    projectPath: params.projectPath,
    questionLength: params.question.length,
    analysisMode: params.analysisMode || "general",
  });

  try {
    // Validate and secure the project path
    const normalizedPath = await validateSecurePath(params.projectPath, process.cwd(), context);

    // Validate project size before making LLM API call
    const sizeValidation = await validateProjectSize(
      normalizedPath,
      undefined,
      params.temporaryIgnore,
      params.ignoreMcpignore,
      context,
    );

    if (!sizeValidation.valid) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        sizeValidation.error || "Project size exceeds token limit",
        {
          tokenCount: sizeValidation.tokenCount,
          maxTokens: config.maxProjectTokens ?? 20_000_000,
        },
      );
    }

    // Initialize model based on provider (supports gemini-cli OAuth or API key)
    const model = createModelByProvider(
      config.llmDefaultModel,
      {
        maxOutputTokens: 65536,
        temperature: 0.5,
        topK: 40,
        topP: 0.95,
      },
      params.geminiApiKey,
    );

    logger.debug("Gemini client initialized", {
      ...context,
    });

    // Prepare full project context
    const fullContext = await prepareFullContext(
      normalizedPath,
      params.temporaryIgnore,
      params.ignoreMcpignore,
      context,
    );

    if (fullContext.length === 0) {
      throw new Error("No readable files found in the project directory");
    }

    // Create the mega prompt using mode-specific system prompt
    const analysisMode = params.analysisMode || "general";
    const systemPrompt = getSystemPrompt(analysisMode);
    const megaPrompt = `${systemPrompt}

PROJECT CONTEXT:
${fullContext}

CODING AI QUESTION:
${params.question}`;

    logger.info("Sending request to Gemini AI", {
      ...context,
      promptLength: megaPrompt.length,
      contextLength: fullContext.length,
    });

    // Send to Gemini AI
    const result = await model.generateContent(megaPrompt);
    const response = await result.response;
    const analysis = response.text();

    logger.info("Gemini analysis completed successfully", {
      ...context,
      responseLength: analysis.length,
    });

    return {
      analysis,
      filesProcessed: fullContext.split("--- File:").length - 1,
      totalCharacters: fullContext.length,
      projectPath: normalizedPath,
      question: params.question,
    };
  } catch (error) {
    logger.error("Gemini codebase analysis failed", {
      ...context,
      error: String(error),
    });
    throw new Error(`Codebase analysis failed: ${error}`);
  }
}
