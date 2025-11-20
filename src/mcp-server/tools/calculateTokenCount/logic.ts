import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext, createIgnoreInstance } from "../../../utils/index.js";
import { countTokens } from "../../../utils/metrics/tokenCounter.js";
import { countTokensLocally } from "../../utils/tokenizer.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { extractGitDiff } from "../../utils/gitDiffAnalyzer.js";

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
  includeChanges: z
    .object({
      revision: z.string().optional().describe("Git revision (commit hash, branch, range, or '.' for uncommitted)"),
      count: z.number().int().positive().optional().describe("Number of recent commits to analyze")
    })
    .optional()
    .describe("Include git diff tokens in calculation. Specify 'revision' or 'count'."),
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
    gitDiffTokens?: number;
    gitDiffCharacters?: number;
  };
  topFiles?: Array<{ file: string; tokens: number; characters: number }>;
  gitDiffIncluded?: boolean;
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
  const normalizedPath = await validateSecurePath(params.projectPath!, process.cwd(), context);
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

  // Handle git diff if includeChanges is specified
  let gitDiffTokens = 0;
  let gitDiffCharacters = 0;
  let gitDiffIncluded = false;

  if (params.includeChanges) {
    try {
      logger.info("Extracting git diff for token calculation", {
        ...context,
        revision: params.includeChanges.revision,
        count: params.includeChanges.count
      });

      const diffResult = await extractGitDiff(
        normalizedPath,
        {
          revision: params.includeChanges.revision,
          count: params.includeChanges.count
        },
        context
      );

      // Convert diff result to string for token counting
      const diffText = JSON.stringify(diffResult, null, 2);
      gitDiffCharacters = diffText.length;

      // Count tokens based on selected tokenizer
      if (useGeminiTokenizer) {
        gitDiffTokens = countTokensLocally(diffText, "gemini-2.0-flash");
      } else {
        gitDiffTokens = await countTokens(diffText, context);
      }

      totalTokens += gitDiffTokens;
      totalCharacters += gitDiffCharacters;
      gitDiffIncluded = true;

      logger.info("Git diff tokens calculated", {
        ...context,
        gitDiffTokens,
        gitDiffCharacters
      });
    } catch (error) {
      logger.warning("Failed to extract git diff, continuing without it", {
        ...context,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue without git diff - don't fail the entire operation
    }
  }

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
      ...(gitDiffIncluded && {
        gitDiffTokens,
        gitDiffCharacters
      })
    },
    topFiles: breakdown.slice(0, 10),
    gitDiffIncluded
  };
}
