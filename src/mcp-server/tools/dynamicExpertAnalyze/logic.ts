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

export const DynamicExpertAnalyzeInputSchema = z.object({
  projectPath: z.string().min(1),
  temporaryIgnore: z.array(z.string()).optional(),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  question: z.string().min(1).max(50000),
  expertPrompt: z.string().min(1).max(10000),
  geminiApiKey: z.string().min(1).optional(),
});

export type DynamicExpertAnalyzeInput = z.infer<
  typeof DynamicExpertAnalyzeInputSchema
>;

export interface DynamicExpertAnalyzeResponse {
  projectPath: string;
  analysis: string;
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

  let full = "";
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

      full += `--- File: ${file} ---\n${c}\n\n`;
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

  logger.info("Project context prepared successfully", {
    ...context,
    processedFiles,
    totalCharacters: full.length,
    totalSizeBytes: totalSize,
  });

  return full;
}

export async function dynamicExpertAnalyzeLogic(
  params: DynamicExpertAnalyzeInput,
  context: RequestContext,
): Promise<DynamicExpertAnalyzeResponse> {
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

  const megaPrompt = `${params.expertPrompt}

PROJECT CONTEXT:
${fullContext}

CODING AI QUESTION:
${params.question}`;

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 65536, temperature: 0.5, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );
  const result = await model.generateContent(megaPrompt);
  const analysis = (await result.response).text();

  return { projectPath: normalizedPath, analysis };
}
