import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext, sanitization, createIgnoreInstance } from "../../../utils/index.js";
import { countTokens } from "../../../utils/metrics/tokenCounter.js";
import { countTokensLocally } from "../../utils/tokenizer.js";

export const CalculateTokenCountInputSchema = z.object({
  projectPath: z.string().min(1).optional(),
  textToAnalyze: z.string().min(1).optional(),
  temporaryIgnore: z.array(z.string()).optional(),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  fileExtensions: z.array(z.string()).optional(),
  maxFileSize: z.number().optional().default(1_000_000),
  tokenizerModel: z
    .enum(["gemini-2.0-flash", "gpt-4o"])
    .optional()
    .default("gemini-2.0-flash"),
  geminiApiKey: z.string().min(1).optional(),
});

export type CalculateTokenCountInput = z.infer<
  typeof CalculateTokenCountInputSchema
>;

export interface CalculateTokenCountResponse {
  mode: "direct_text" | "project_analysis";
  tokenCount: number;
  characterCount?: number;
  modelUsedForTokenization: string;
  projectPath?: string;
  summary?: {
    totalTokens: number;
    totalCharacters: number;
    analyzedFiles: number;
    skippedFiles: number;
    totalFiles: number;
  };
  topFiles?: Array<{ file: string; tokens: number; characters: number }>;
}

export async function calculateTokenCountLogic(
  params: CalculateTokenCountInput,
  context: RequestContext,
): Promise<CalculateTokenCountResponse> {
  if (!params.projectPath && !params.textToAnalyze) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "Either projectPath or textToAnalyze must be provided",
    );
  }

  // Direct text mode
  if (params.textToAnalyze) {
    const modelUsed = params.tokenizerModel ?? "gemini-2.0-flash";
    const tokenCount =
      modelUsed === "gemini-2.0-flash"
        ? countTokensLocally(params.textToAnalyze, "gemini-2.0-flash")
        : await countTokens(params.textToAnalyze, context);

    return {
      mode: "direct_text",
      tokenCount,
      characterCount: params.textToAnalyze.length,
      modelUsedForTokenization: modelUsed,
    };
  }

  // Project analysis mode
  const sanitized = sanitization.sanitizePath(params.projectPath!, {
    rootDir: process.cwd(),
    allowAbsolute: true,
  });
  const normalizedPath = path.resolve(process.cwd(), sanitized.sanitizedPath);
  logger.info("Starting project token analysis", {
    ...context,
    projectPath: normalizedPath,
  });

  const ig = await createIgnoreInstance({
    projectPath: normalizedPath,
    temporaryIgnore: params.temporaryIgnore,
    ignoreMcpignore: params.ignoreMcpignore,
    context,
  });

  const pattern =
    params.fileExtensions && params.fileExtensions.length > 0
      ? `**/*@(${params.fileExtensions.join("|")})`
      : "**/*";
  const allFiles = await glob(pattern, {
    cwd: normalizedPath,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });
  const filteredFiles = allFiles.filter((f) => !ig.ignores(f));

  const fileContents: Array<{
    file: string;
    content: string;
    characters: number;
  }> = [];
  let skippedFiles = 0;
  for (const file of filteredFiles) {
    try {
      const filePath = path.join(normalizedPath, file);
      const stats = await fs.stat(filePath);
      if (stats.size > (params.maxFileSize ?? 1_000_000) || stats.size === 0) {
        skippedFiles++;
        continue;
      }
      const content = await fs.readFile(filePath, "utf-8");
      if (content.includes("\0")) {
        skippedFiles++;
        continue;
      }
      fileContents.push({ file, content, characters: content.length });
    } catch {
      skippedFiles++;
      // no-op: unreadable file
    }
  }

  let totalTokens = 0;
  let totalCharacters = 0;
  const breakdown: Array<{ file: string; tokens: number; characters: number }> =
    [];
  const useGeminiTokenizer =
    (params.tokenizerModel ?? "gemini-2.0-flash") === "gemini-2.0-flash";

  if (useGeminiTokenizer) {
    // Count per-file locally for determinism
    for (const f of fileContents) {
      const tokens = countTokensLocally(f.content, "gemini-2.0-flash");
      totalTokens += tokens;
      totalCharacters += f.characters;
      breakdown.push({ file: f.file, tokens, characters: f.characters });
    }
  } else {
    for (const f of fileContents) {
      const tokens = await countTokens(f.content, context);
      totalTokens += tokens;
      totalCharacters += f.characters;
      breakdown.push({ file: f.file, tokens, characters: f.characters });
    }
  }

  breakdown.sort((a, b) => b.tokens - a.tokens);

  return {
    mode: "project_analysis",
    tokenCount: totalTokens,
    projectPath: normalizedPath,
    modelUsedForTokenization: useGeminiTokenizer
      ? "gemini-2.0-flash"
      : "gpt-4o",
    summary: {
      totalTokens,
      totalCharacters,
      analyzedFiles: fileContents.length,
      skippedFiles,
      totalFiles: filteredFiles.length,
    },
    topFiles: breakdown.slice(0, 10),
  };
}
