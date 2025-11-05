import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { type RequestContext, createIgnoreInstance } from "../../../utils/index.js";
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

  let full = "";
  for (const file of files) {
    try {
      const p = path.join(projectPath, file);
      const c = await fs.readFile(p, "utf-8");
      full += `--- File: ${file} ---\n${c}\n\n`;
    } catch {
      // no-op: unreadable file
    }
  }
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
