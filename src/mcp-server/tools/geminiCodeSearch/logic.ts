/**
 * @fileoverview Core logic and schema for the `gemini_code_search` tool.
 * Scans a project for relevant code snippets matching a text query and asks Gemini
 * to provide a focused explanation over the extracted snippets.
 */

import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import ignore from "ignore";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext, sanitization } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createGeminiCliModel } from "../../../services/llm-providers/geminiCliProvider.js";

export const GeminiCodeSearchInputSchema = z.object({
  projectPath: z
    .string()
    .min(1)
    .describe("Absolute or relative path to the project directory."),
  temporaryIgnore: z
    .array(z.string())
    .optional()
    .describe("Additional ignore globs for this run only."),
  searchQuery: z
    .string()
    .min(1)
    .max(500)
    .describe("What to find (function/class/pattern/etc)."),
  fileTypes: z
    .array(z.string())
    .optional()
    .describe("Limit search to specific file extensions."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max number of snippets to include (default 5)."),
  geminiApiKey: z
    .string()
    .min(1)
    .optional()
    .describe("Optional Gemini API key (not needed for gemini-cli provider)."),
});

export type GeminiCodeSearchInput = z.infer<typeof GeminiCodeSearchInputSchema>;

export interface GeminiCodeSearchResponse {
  analysis: string;
  totalFiles: number;
  relevantCount: number;
  projectPath: string;
  query: string;
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

function normalizeProjectPath(inputPath: string): string {
  const sanitized = sanitization.sanitizePath(inputPath, {
    rootDir: process.cwd(),
    allowAbsolute: true,
  });
  // Resolve relative to cwd to get absolute path
  return path.resolve(process.cwd(), sanitized.sanitizedPath);
}

async function findRelevantSnippets(
  projectPath: string,
  query: string,
  fileTypes: string[] | undefined,
  maxResults: number,
  temporaryIgnore: string[] | undefined,
): Promise<{
  totalFiles: number;
  snippets: Array<{ file: string; content: string }>;
}> {
  const ig = ignore();
  ig.add([
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "*.log",
    ".env*",
    "coverage/**",
  ]);
  if (temporaryIgnore?.length) ig.add(temporaryIgnore);

  try {
    const gitignorePath = path.join(projectPath, ".gitignore");
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
  } catch {
    // no-op: .gitignore optional
  }

  const pattern =
    fileTypes && fileTypes.length > 0
      ? `**/*@(${fileTypes.join("|")})`
      : "**/*";
  const allFiles = await glob(pattern, {
    cwd: projectPath,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });
  const files = allFiles.filter((f) => !ig.ignores(f));

  const lowerQuery = query.toLowerCase();
  const snippets: Array<{ file: string; content: string }> = [];
  for (const file of files) {
    try {
      const fullPath = path.join(projectPath, file);
      const content = await fs.readFile(fullPath, "utf-8");
      if (content.toLowerCase().includes(lowerQuery)) {
        snippets.push({ file, content });
        if (snippets.length >= maxResults) break;
      }
    } catch {
      // no-op: unreadable file
    }
  }
  return { totalFiles: files.length, snippets };
}

export async function geminiCodeSearchLogic(
  params: GeminiCodeSearchInput,
  context: RequestContext,
): Promise<GeminiCodeSearchResponse> {
  logger.info("Starting Gemini code search", {
    ...context,
    projectPath: params.projectPath,
    queryLen: params.searchQuery.length,
  });

  const normalizedPath = normalizeProjectPath(params.projectPath);
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

  const maxResults = params.maxResults ?? 5;
  const { totalFiles, snippets } = await findRelevantSnippets(
    normalizedPath,
    params.searchQuery,
    params.fileTypes,
    maxResults,
    params.temporaryIgnore,
  );

  if (snippets.length === 0) {
    return {
      analysis:
        "No matching code snippets were found for the given search query.",
      totalFiles,
      relevantCount: 0,
      projectPath: normalizedPath,
      query: params.searchQuery,
    };
  }

  let searchContext = "";
  for (const s of snippets) {
    searchContext += `--- File: ${s.file} ---\n` + s.content + "\n\n";
  }

  const prompt = `You are a senior AI Software Engineer analyzing specific code snippets from a project. Your task is to help another coding AI understand the most relevant parts of the codebase related to their search query.

SEARCH QUERY: "${params.searchQuery}"

RELEVANT CODE SNIPPETS:
${searchContext}

Please explain how these snippets relate to the query and highlight the most important parts with short inline code excerpts.`;

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 65536, temperature: 0.5, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );
  const result = await model.generateContent(prompt);
  const analysis = (await result.response).text();

  return {
    analysis,
    totalFiles,
    relevantCount: snippets.length,
    projectPath: normalizedPath,
    query: params.searchQuery,
  };
}
