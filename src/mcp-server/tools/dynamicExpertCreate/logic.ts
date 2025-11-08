import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { type RequestContext, logger, createIgnoreInstance } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { validateProjectSize } from "../../utils/projectSizeValidator.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { validateMcpConfigExists } from "../../utils/mcpConfigValidator.js";

export const DynamicExpertCreateInputSchema = z.object({
  projectPath: z.string().min(1),
  temporaryIgnore: z.array(z.string()).optional(),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  expertiseHint: z.string().min(1).max(200).optional(),
  geminiApiKey: z.string().min(1).optional(),
});

export type DynamicExpertCreateInput = z.infer<
  typeof DynamicExpertCreateInputSchema
>;

export interface DynamicExpertCreateResponse {
  projectPath: string;
  filesProcessed: number;
  totalCharacters: number;
  expertPrompt: string;
}

/**
 * Maximum allowed total file size in bytes (100 MB).
 */
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

/**
 * Maximum allowed number of files to process.
 */
const MAX_FILE_COUNT = 1000;

async function prepareFullContext(
  projectPath: string,
  temporaryIgnore: string[] = [],
  ignoreMcpignore: boolean = false,
  context: RequestContext,
): Promise<string> {
  const ig = await createIgnoreInstance({
    projectPath,
    temporaryIgnore,
    ignoreMcpignore,
    context,
  });

  const allFiles = await glob("**/*", {
    cwd: projectPath,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });

  const files = allFiles.filter((f) => !ig.ignores(f));

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

  // Use array buffer instead of string concatenation to avoid memory waste
  // Each += operation creates a new string copy, which is inefficient for large content
  const contextParts: string[] = [];
  let processedFiles = 0;
  let totalSize = 0;

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

      const p = path.join(projectPath, file);
      const c = await fs.readFile(p, "utf-8");
      const contentSize = Buffer.byteLength(c, "utf-8");

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

      contextParts.push(`--- File: ${file} ---\n`, c, "\n\n");
      processedFiles++;
      totalSize += contentSize;
    } catch (error) {
      // Re-throw McpError (circuit breaker)
      if (error instanceof McpError) {
        throw error;
      }
      // Skip unreadable files
      logger.debug("Skipping unreadable file", {
        ...context,
        file,
        error: String(error),
      });
    }
  }

  const full = contextParts.join("");

  logger.debug("File processing completed", {
    ...context,
    processedFiles,
    ignoredFiles: allFiles.length - files.length,
    totalSizeBytes: totalSize,
    totalSizeMB: Math.round(totalSize / (1024 * 1024)),
  });

  logger.info("Project context prepared successfully", {
    ...context,
    processedFiles,
    totalCharacters: full.length,
    totalSizeBytes: totalSize,
  });

  return full;
}

export async function dynamicExpertCreateLogic(
  params: DynamicExpertCreateInput,
  context: RequestContext,
): Promise<DynamicExpertCreateResponse> {
  // Validate MCP configuration exists before expert creation
  await validateMcpConfigExists(params.projectPath, context);

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

  const fullContext = await prepareFullContext(
    normalizedPath,
    params.temporaryIgnore,
    params.ignoreMcpignore,
    context,
  );
  if (fullContext.length === 0) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "No readable files found in the project directory",
    );
  }

  const expertGenerationPrompt = `# Dynamic Expert Mode Generator

You are an AI system that creates custom expert personas for code analysis. Your task is to analyze the provided project and create a highly specialized expert persona that would be most effective for analyzing this specific codebase.

## Project Analysis Context:
${fullContext}

## User's Expertise Hint:
${params.expertiseHint || "No specific hint provided - auto-detect the best expert type"}

## Your Task:
Create a custom expert persona system prompt that:
1. Identifies the most relevant expertise needed for this project
2. Considers the specific technologies, patterns, and architecture used
3. Tailors the expert knowledge to the project's domain and complexity
4. Creates a comprehensive expert persona for future project analysis

Return ONLY the system prompt; do not include explanations.`;

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 4096, temperature: 0.3, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );
  const expertResult = await model.generateContent(expertGenerationPrompt);
  const expertPrompt = (await expertResult.response).text();

  const filesProcessed = fullContext.split("--- File:").length - 1;

  return {
    projectPath: normalizedPath,
    filesProcessed,
    totalCharacters: fullContext.length,
    expertPrompt,
  };
}
