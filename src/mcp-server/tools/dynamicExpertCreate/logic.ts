import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { type RequestContext, sanitization, createIgnoreInstance } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createGeminiCliModel } from "../../../services/llm-providers/geminiCliProvider.js";

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
  const sanitized = sanitization.sanitizePath(params.projectPath, {
    rootDir: process.cwd(),
    allowAbsolute: true,
  });
  const normalizedPath = path.resolve(process.cwd(), sanitized.sanitizedPath);
  const stats = await fs.stat(normalizedPath).catch((e) => {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Invalid project path: ${normalizedPath}`,
      { cause: e },
    );
  });
  if (!stats.isDirectory()) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Project path is not a directory: ${normalizedPath}`,
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
