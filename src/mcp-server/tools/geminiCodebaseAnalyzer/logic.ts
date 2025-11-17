/**
 * @fileoverview Defines the core logic, schemas, and types for the `gemini_codebase_analyzer` tool.
 * This module analyzes complete codebases using Gemini AI, providing comprehensive code analysis,
 * architecture insights, and answers to specific questions about the codebase.
 * @module src/mcp-server/tools/geminiCodebaseAnalyzer/logic
 */

import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { logger, type RequestContext, createIgnoreInstance, sanitization } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { config } from "../../../config/index.js";
import { BASE_DIR } from "../../../index.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { getSystemPrompt } from "../../prompts.js";
import { validateProjectSize } from "../../utils/projectSizeValidator.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { extractGitDiff, type ExtractGitDiffParams } from "../../utils/gitDiffAnalyzer.js";
import { validateMcpConfigExists } from "../../utils/mcpConfigValidator.js";

// Önceden tanımlanmış analiz modları
const standardAnalysisModes = [
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
  "review",
] as const;

/**
 * Base Zod schema for the `gemini_codebase_analyzer` tool (before refinements).
 * This is used for MCP tool registration which requires `.shape` property.
 */
export const GeminiCodebaseAnalyzerInputSchemaBase = z.object({
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
      "Your question about the codebase. Works with both traditional analysisMode parameters and customExpertPrompt workflows. " +
      "Examples: 'What does this project do?', 'Find potential bugs', 'Explain the architecture', 'How to add a new feature?', 'Review code quality', " +
      "or specialized questions for custom expert personas (e.g., 'As a security expert, analyze this codebase for vulnerabilities')",
    ),
  // YENİ MANTIK: `analysisMode` artık standart enum veya "custom:..." string'i olabilir.
  analysisMode: z.union([
      z.enum(standardAnalysisModes),
      z.string().refine((val) => val.startsWith("custom:"), {
        message: "Custom mode must start with 'custom:'"
      })
    ])
    .default("general")
    .optional()
    .describe(
      "Analysis mode. Use a standard mode (e.g., 'security', 'review') or a custom saved mode with 'custom:your-mode-name'.",
    ),
  includeChanges: z
    .object({
      revision: z
        .string()
        .optional()
        .describe(
          "Commit hash, range (e.g., 'main..feature'), or '.' for uncommitted changes. Use '.' for staged/unstaged changes.",
        ),
      count: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of recent commits to analyze (e.g., 5 for last 5 commits)"),
    })
    .optional()
    .describe(
      "IMPORTANT: Only use with analysisMode='review'. Specifies which code changes to analyze alongside the codebase.",
    )
    .refine(
      (data) => {
        if (!data) return true;
        const hasRevision = data.revision !== undefined && data.revision.length > 0;
        const hasCount = data.count !== undefined;
        // Must specify either revision OR count, or neither (defaults to uncommitted)
        return (
          (hasRevision && !hasCount) || (!hasRevision && hasCount) || (!hasRevision && !hasCount)
        );
      },
      {
        message:
          "Specify either 'revision' OR 'count', not both. For uncommitted changes, use revision: '.'",
      },
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
  autoOrchestrate: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, automatically use project orchestrator when project size approaches or exceeds token limits.",
    ),
  orchestratorThreshold: z
    .number()
    .min(0.1)
    .max(0.95)
    .optional()
    .default(0.75)
    .describe(
      "When tokenCount / maxTokens >= threshold, orchestrator is suggested (or used if autoOrchestrate=true). Default: 0.75",
    ),
  maxTokensPerGroup: z
    .number()
    .min(100000)
    .max(950000)
    .optional()
    .describe(
      "Optional max tokens per orchestrator group (default ~900k if not provided).",
    ),
  customExpertPrompt: z
    .string()
    .optional()
    .describe(
      "DEPRECATED: Use custom analysis modes instead. Custom expert persona/system prompt. If provided, this prompt is used instead of the standard analysisMode, " +
      "enabling specialized domain-specific analysis. Combine with 'create_analysis_mode' tool for creating " +
      "dedicated expert personas before analysis.",
    ),
});

/**
 * Zod schema defining the input parameters for the `gemini_codebase_analyzer` tool.
 * Includes validation refinements.
 */
export const GeminiCodebaseAnalyzerInputSchema = GeminiCodebaseAnalyzerInputSchemaBase.refine(
  (data) => {
    // If includeChanges is provided, analysisMode must be "review"
    if (data.includeChanges && data.analysisMode !== "review") {
      return false;
    }
    return true;
  },
  {
    message:
      "The 'includeChanges' parameter can only be used with analysisMode='review'. " +
      "To analyze code changes, set analysisMode to 'review'.",
    path: ["includeChanges"],
  },
).describe("Input parameters for analyzing a codebase with Gemini AI");

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
 * Maximum allowed number of files to process.
 */
const MAX_FILE_COUNT = 1000;

// YENİ YARDIMCI FONKSİYON
/**
 * Loads a custom analysis mode prompt from the file system.
 * @param modeName - The sanitized name of the custom mode.
 * @param projectPath - The validated, absolute path to the project.
 * @param context - The request context.
 * @returns The content of the custom prompt file.
 * @throws {McpError} if the mode file is not found.
 */
async function loadCustomModePrompt(
  modeName: string,
  projectPath: string,
  context: RequestContext,
): Promise<string> {
  const modePath = path.join(projectPath, '.mcp', 'analysis_modes', `${modeName}.md`);
  logger.debug(`Attempting to load custom analysis mode`, { ...context, path: modePath });

  try {
    const prompt = await fs.readFile(modePath, 'utf-8');
    if (!prompt.trim()) {
      throw new Error("Custom mode file is empty.");
    }
    logger.info(`Successfully loaded custom analysis mode: ${modeName}`, context);
    return prompt;
  } catch (error) {
    logger.error(`Custom analysis mode '${modeName}' not found or is empty.`, {
      ...context,
      path: modePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new McpError(
      BaseErrorCode.NOT_FOUND,
      `Custom analysis mode '${modeName}' not found. Please create it first using the 'create_analysis_mode' tool with the 'saveAs' parameter.`,
      { modeName, expectedPath: modePath }
    );
  }
}

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
      ignoredFiles: allFiles.length - files.length,
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

    // Use array buffer instead of string concatenation to avoid memory waste
    // Each += operation creates a new string copy, which is inefficient for large content
    const contextParts: string[] = [];
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

        contextParts.push(`--- File: ${file} ---\n`, content, "\n\n");
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const fullContext = contextParts.join("");

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
      error: error instanceof Error ? error.message : String(error),
    });
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to prepare project context: ${error instanceof Error ? error.message : String(error)}`,
      { originalError: error }
    );
  }
}

/**
 * Core logic function for the Gemini codebase analyzer tool.
 * Analyzes a complete codebase using Gemini AI and returns comprehensive insights.
 *
 * @param params - The input parameters containing project path, question, and API key
 * @param context - Request context for logging and tracking
 * @returns Promise containing the analysis response
 *
 * @remarks This function deliberately integrates project orchestrator tools to provide a seamless
 *          fallback path for large projects (autoOrchestrate). This coupling is intentional to
 *          improve user experience and robustness under token/memory constraints.
 */
export async function geminiCodebaseAnalyzerLogic(
  params: GeminiCodebaseAnalyzerInput,
  context: RequestContext,
): Promise<GeminiCodebaseAnalyzerResponse> {
  // Validate MCP configuration exists before analysis
  await validateMcpConfigExists(params.projectPath, context);

  logger.info("Starting Gemini codebase analysis", {
    ...context,
    projectPath: params.projectPath,
    questionLength: params.question.length,
    analysisMode: params.analysisMode || "general",
    // Sanitize params to prevent API key leakage
    sanitizedParams: sanitization.sanitizeForLogging(params),
  });

  try {
    // Validate with refined schema (includes check that includeChanges requires review mode)
    const validatedParams = GeminiCodebaseAnalyzerInputSchema.parse(params);

    // Validate and secure the project path against the central BASE_DIR
    const normalizedPath = await validateSecurePath(
      validatedParams.projectPath,
      BASE_DIR,
      context,
    );

    // Validate project size before making LLM API call
    const sizeValidation = await validateProjectSize(
      normalizedPath,
      undefined,
      validatedParams.temporaryIgnore,
      validatedParams.ignoreMcpignore,
      context,
    );

    const maxTokens = config.maxProjectTokens ?? 20_000_000;
    const threshold = validatedParams.orchestratorThreshold ?? 0.75;
    const tokenCount = sizeValidation.tokenCount;
    const shouldSuggest =
      typeof tokenCount === "number" ? tokenCount / maxTokens >= threshold : false;

    if (!sizeValidation.valid) {
      if (validatedParams.autoOrchestrate) {
        logger.warning("Auto-orchestration requested but orchestrator has been removed", {
          ...context,
          tokenCount: sizeValidation.tokenCount,
          maxTokens,
        });
        
        // Orchestrator has been removed - suggest using .mcpignore instead
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Project size exceeds token limits (${(sizeValidation.tokenCount ?? 0).toLocaleString()} tokens, limit ${maxTokens.toLocaleString()}).\n\n` +
          `The auto-orchestration feature has been removed. Please use one of these alternatives:\n` +
          `1. Add patterns to .mcpignore to exclude unnecessary files\n` +
          `2. Use temporaryIgnore parameter to exclude files for this analysis\n` +
          `3. Analyze a subdirectory instead of the entire project\n\n` +
          `Example .mcpignore patterns:\n` +
          `  node_modules/\n` +
          `  dist/\n` +
          `  *.test.ts\n` +
          `  docs/`,
          {
            tokenCount: sizeValidation.tokenCount,
            maxTokens,
            suggestion: "Use .mcpignore or temporaryIgnore to reduce project size"
          }
        );
      }

      // Not auto orchestrating: throw with helpful guidance
      const guidance =
        `\n\nÖneri: Büyük projeler için 'project_orchestrator_create' ve 'project_orchestrator_analyze' araçlarını kullanın ` +
        `veya bu aracı 'autoOrchestrate=true' ile çağırın. Eşik ayarı için 'orchestratorThreshold' (varsayılan 0.75).`;
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        (sizeValidation.error || "Project size exceeds token limit") + guidance,
        {
          tokenCount: sizeValidation.tokenCount,
          maxTokens,
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
      validatedParams.temporaryIgnore,
      validatedParams.ignoreMcpignore,
      context,
    );

    if (fullContext.length === 0) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "No readable files found in the project directory. Check your .gitignore or .mcpignore files.",
        {
          projectPath: normalizedPath,
          processedFiles: 0,
        }
      );
    }

    // Extract git diff if includeChanges is provided
    // Note: The Zod schema already validates that includeChanges requires analysisMode='review'
    let changesData: string = "";
    if (validatedParams.includeChanges) {
      logger.info("Extracting git diff for review", {
        ...context,
        revision: validatedParams.includeChanges.revision,
        count: validatedParams.includeChanges.count,
      });

      // Create ignore instance for filtering git diffs (reuse existing ignore patterns)
      const ig = await createIgnoreInstance({
        projectPath: normalizedPath,
        temporaryIgnore: validatedParams.temporaryIgnore,
        ignoreMcpignore: validatedParams.ignoreMcpignore,
        context,
      });

      const diffParams: ExtractGitDiffParams = {
        revision: validatedParams.includeChanges.revision,
        count: validatedParams.includeChanges.count,
        ignoreInstance: ig,
      };

      const diffResult = await extractGitDiff(normalizedPath, diffParams, context);
      changesData = JSON.stringify(diffResult, null, 2);

      // Add warning if any files were skipped due to size
      if (diffResult.skippedFiles && diffResult.skippedFiles.length > 0) {
        const skippedFilesWarning = `\n\n---
**WARNING: Large Files Skipped**
The following files were excluded from the change analysis because their size exceeds the configured limit (${(config.maxGitBlobSizeBytes / 1024 / 1024).toFixed(2)} MB):
${diffResult.skippedFiles.map(f => `- ${f.path} (${(f.size / 1024 / 1024).toFixed(2)} MB)`).join('\n')}

These files were skipped to prevent memory issues during analysis. To include them, adjust the MAX_GIT_BLOB_SIZE_BYTES environment variable.
---`;
        changesData += skippedFilesWarning;
      }

      // Check diff size to prevent memory overflow
      const diffSizeBytes = Buffer.byteLength(changesData, "utf-8");
      const MAX_DIFF_SIZE = 50 * 1024 * 1024; // 50MB
      
      if (diffSizeBytes > MAX_DIFF_SIZE) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Git diff too large: ${Math.round(diffSizeBytes / (1024 * 1024))}MB (max ${MAX_DIFF_SIZE / (1024 * 1024)}MB). ` +
            `The changes are too extensive to analyze in one go. Consider: ` +
            `1) Analyzing specific commits or file ranges instead of large commit counts, ` +
            `2) Using temporaryIgnore to exclude large generated files, ` +
            `3) Breaking the review into smaller chunks.`,
          {
            diffSize: diffSizeBytes,
            maxSize: MAX_DIFF_SIZE,
            filesModified: diffResult.summary.filesModified,
          },
        );
      }

      logger.info("Git diff extracted successfully", {
        ...context,
        filesModified: diffResult.summary.filesModified,
        insertions: diffResult.summary.insertions,
        deletions: diffResult.summary.deletions,
        diffSizeBytes,
      });
    }

    // YENİ MANTIK: Sistem prompt'unu belirle
    let systemPrompt: string;
    const analysisMode = validatedParams.analysisMode || "general";

    if (validatedParams.customExpertPrompt && validatedParams.customExpertPrompt.trim()) {
      // Geriye dönük uyumluluk için customExpertPrompt'u önceliklendir
      systemPrompt = validatedParams.customExpertPrompt.trim();
      logger.info("Using provided 'customExpertPrompt'.", context);
    } else if (analysisMode.startsWith('custom:')) {
      // Özel modu yükle
      const modeName = analysisMode.substring('custom:'.length);
      // Güvenlik: Dosya adı olarak kullanmadan önce sanitize et
      if (!/^[a-zA-Z0-9_-]+$/.test(modeName)) {
        throw new McpError(BaseErrorCode.VALIDATION_ERROR, `Invalid custom mode name format: ${modeName}`);
      }
      systemPrompt = await loadCustomModePrompt(modeName, normalizedPath, context);
    } else {
      // Standart modu kullan
      systemPrompt = getSystemPrompt(analysisMode);
    }

    // Build prompt with optional changes section
    let megaPrompt = `${systemPrompt}

PROJECT CONTEXT:
${fullContext}`;

    if (changesData) {
      megaPrompt += `

CODE CHANGES TO REVIEW:
${changesData}`;
    }

    megaPrompt += `

CODING AI QUESTION:
${validatedParams.question}`;

    logger.info("Sending request to Gemini AI", {
      ...context,
      promptLength: megaPrompt.length,
      contextLength: fullContext.length,
    });

    // Send to Gemini AI
    const result = await model.generateContent(megaPrompt);
    const response = await result.response;
    const analysis = response.text();

    // Prepend recommendation note if near threshold (but not auto-orchestrating)
    let finalAnalysis = analysis;
    if (shouldSuggest && !validatedParams.autoOrchestrate) {
      const ratioPct =
        typeof tokenCount === "number"
          ? Math.round((tokenCount / maxTokens) * 100)
          : undefined;
      const note =
        `ℹ Recommendation: Project size is near the token limit` +
        (typeof ratioPct === "number" ? ` (~${ratioPct}%)` : "") +
        `. Consider using project orchestrator (set autoOrchestrate=true) ` +
        `or adjust orchestratorThreshold (default 0.75).`;
      finalAnalysis = `${note}\n\n${analysis}`;
    }

    logger.info("Gemini analysis completed successfully", {
      ...context,
      responseLength: finalAnalysis.length,
    });

    return {
      analysis: finalAnalysis,
      filesProcessed: fullContext.split("--- File:").length - 1,
      totalCharacters: fullContext.length,
      projectPath: normalizedPath,
      question: validatedParams.question,
    };
  } catch (error) {
    logger.error("Gemini codebase analysis failed", {
      ...context,
      error: String(error),
      // Sanitize params in error logs
      sanitizedParams: sanitization.sanitizeForLogging(params),
    });
    // Re-throw McpError as-is, wrap others
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Codebase analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      { originalError: error }
    );
  }
}
