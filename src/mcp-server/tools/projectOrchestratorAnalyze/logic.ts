import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createGeminiCliModel } from "../../../services/llm-providers/geminiCliProvider.js";
import { getSystemPrompt } from "../../prompts.js";

// Common interface for LLM models (both Google AI and gemini-cli)
interface LLMModel {
  generateContent: (prompt: string) => Promise<{
    response: Promise<{ text: () => string }> | { text: () => string };
  }>;
}

export const ProjectOrchestratorAnalyzeInputSchema = z.object({
  projectPath: z.string().min(1),
  temporaryIgnore: z.array(z.string()).optional(),
  question: z.string().min(1).max(50000),
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
    .default("general"),
  fileGroupsData: z.string().min(1).max(50000),
  maxTokensPerGroup: z
    .number()
    .min(100000)
    .max(950000)
    .default(900000)
    .optional(),
  geminiApiKey: z.string().min(1).optional(),
});

export type ProjectOrchestratorAnalyzeInput = z.infer<
  typeof ProjectOrchestratorAnalyzeInputSchema
>;

export interface ProjectOrchestratorAnalyzeResponse {
  projectPath: string;
  analysis: string;
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
): LLMModel {
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
 * Calls LLM with retry mechanism.
 * First 3 retries: 1 second delay
 * 4th retry: 2 seconds delay
 * 5th retry: 4 seconds delay (exponential backoff)
 *
 * @param llmFunction - Function that returns a Promise<string>
 * @param maxRetries - Maximum number of retries (default: 5)
 * @param context - Request context for logging
 * @returns Promise resolving to the LLM response string
 */
async function callLLMWithRetry(
  llmFunction: () => Promise<string>,
  maxRetries: number = 5,
  context: RequestContext,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await llmFunction();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on validation/parsing errors
      if (
        error instanceof McpError &&
        (error.code === BaseErrorCode.PARSING_ERROR ||
          error.code === BaseErrorCode.VALIDATION_ERROR ||
          error.code === BaseErrorCode.INVALID_INPUT)
      ) {
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt === maxRetries) {
        logger.error("LLM call failed after all retries", {
          ...context,
          error: lastError.message,
          attempts: attempt + 1,
        });
        throw new McpError(
          BaseErrorCode.SERVICE_UNAVAILABLE,
          `LLM call failed after ${attempt + 1} attempts: ${lastError.message}`,
          { cause: lastError },
        );
      }

      // Calculate delay: first 3 retries = 1s, 4th = 2s, 5th = 4s
      let delay: number;
      if (attempt < 3) {
        delay = 1000; // 1 second
      } else if (attempt === 3) {
        delay = 2000; // 2 seconds
      } else {
        delay = 4000; // 4 seconds
      }

      logger.warning("LLM call failed, retrying", {
        ...context,
        error: lastError.message,
        attempt: attempt + 1,
        maxRetries,
        delayMs: delay,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "LLM call failed unexpectedly",
  );
}

/**
 * Processes groups using rapid-fire pattern: starts requests 500ms apart without waiting for responses.
 *
 * @param groups - Array of groups to process
 * @param model - LLM model instance
 * @param systemPrompt - System prompt for analysis
 * @param params - Analysis parameters
 * @param context - Request context for logging
 * @returns Promise resolving to array of group analysis results
 */
async function processGroupsRapidFire(
  groups: Array<{
    files: Array<{ filePath: string; tokens: number }>;
    totalTokens: number;
    groupIndex: number;
    name?: string;
    description?: string;
    reasoning?: string;
    customPrompt?: string;
    metadata?: Array<{
      filePath: string;
      language: string;
      classes: string[];
      functions: string[];
      imports: string[];
      exports: string[];
      estimatedTokens: number;
    }>;
  }>,
  model: LLMModel,
  systemPrompt: string,
  params: ProjectOrchestratorAnalyzeInput,
  context: RequestContext,
): Promise<string[]> {
  const promises: Promise<string>[] = [];

  for (const [i, g] of groups.entries()) {
    // Start the request (don't await yet)
    const promise = callLLMWithRetry(
      async () => {
        const prompt = `${g.customPrompt || systemPrompt}

Group Index: ${i + 1}
Analysis Mode: ${params.analysisMode}
User Question: ${params.question}

Files in this group (paths only, content omitted for brevity):
${g.files.map((f) => `- ${f.filePath} (${f.tokens} est. tokens)`).join("\n")}

Focus your analysis on the kinds of files listed and answer the user question grounded in typical content of these files.`;
        const result = await model.generateContent(prompt);
        const text = (await result.response).text();
        return text;
      },
      5,
      context,
    );

    promises.push(promise);

    // Wait 500ms before starting next request (except for the last one)
    if (i < groups.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Wait for all requests to complete
  return Promise.all(promises);
}

/**
 * Synthesizes all group analysis results into a single comprehensive response.
 *
 * @param groupAnalyses - Array of group analysis results
 * @param groups - Array of groups with metadata
 * @param params - Analysis parameters
 * @param model - LLM model instance
 * @param context - Request context for logging
 * @returns Promise resolving to synthesized analysis string
 */
async function synthesizeResults(
  groupAnalyses: string[],
  groups: Array<{
    files: Array<{ filePath: string; tokens: number }>;
    totalTokens: number;
    groupIndex: number;
    name?: string;
    description?: string;
    reasoning?: string;
    customPrompt?: string;
    metadata?: Array<{
      filePath: string;
      language: string;
      classes: string[];
      functions: string[];
      imports: string[];
      exports: string[];
      estimatedTokens: number;
    }>;
  }>,
  params: ProjectOrchestratorAnalyzeInput,
  model: LLMModel,
  context: RequestContext,
): Promise<string> {
  const systemPrompt = getSystemPrompt(params.analysisMode);

  // Build metadata summary
  const allMetadata = groups.flatMap((g) => g.metadata || []);
  const metadataSummary = allMetadata
    .map((m) => {
      const details = [
        `Language: ${m.language}`,
        m.classes.length > 0 ? `Classes: ${m.classes.join(", ")}` : "",
        m.functions.length > 0 ? `Functions: ${m.functions.join(", ")}` : "",
        m.imports.length > 0 ? `Imports: ${m.imports.slice(0, 5).join(", ")}${m.imports.length > 5 ? "..." : ""}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return `- ${m.filePath}: ${details}`;
    })
    .join("\n");

  // Build group summaries
  const groupSummaries = groups
    .map((g, i) => {
      return `Group ${i + 1} (${g.name || `Group ${i + 1}`}): ${g.description || "No description"} - ${groupAnalyses[i]?.substring(0, 200)}...`;
    })
    .join("\n\n");

  const synthesisPrompt = `${systemPrompt}

You are synthesizing the results of ${groups.length} group analyses into a single, comprehensive, and detailed response.

User Question: ${params.question}
Analysis Mode: ${params.analysisMode}

Group Analysis Results:
${groupSummaries}

File Metadata (for reference):
${metadataSummary}

Your task is to create a single, comprehensive, and detailed response that:
1. Directly answers the user's question based on all ${groups.length} group analyses
2. Synthesizes insights from all groups into a cohesive narrative
3. Provides detailed and comprehensive information (not just a summary)
4. Maintains focus on the analysis mode (${params.analysisMode})
5. References specific files, classes, functions, or patterns when relevant

Create a detailed, comprehensive response that fully addresses the user's question using insights from all the group analyses.`;

  return callLLMWithRetry(
    async () => {
      const result = await model.generateContent(synthesisPrompt);
      const text = (await result.response).text();
      return text;
    },
    5,
    context,
  );
}

export async function projectOrchestratorAnalyzeLogic(
  params: ProjectOrchestratorAnalyzeInput,
  context: RequestContext,
): Promise<ProjectOrchestratorAnalyzeResponse> {
  let groupsBlobUnknown: unknown;
  try {
    groupsBlobUnknown = JSON.parse(params.fileGroupsData);
  } catch (_e) {
    throw new McpError(BaseErrorCode.INVALID_INPUT, "Invalid fileGroupsData JSON");
  }
  const blob = groupsBlobUnknown as {
    groups?: Array<{
      files: Array<{ filePath: string; tokens: number }>;
      totalTokens: number;
      groupIndex: number;
      name?: string;
      description?: string;
      reasoning?: string;
      customPrompt?: string;
      metadata?: Array<{
        filePath: string;
        language: string;
        classes: string[];
        functions: string[];
        imports: string[];
        exports: string[];
        estimatedTokens: number;
      }>;
    }>;
    totalTokens?: number;
  };

  const groups: Array<{
    files: Array<{ filePath: string; tokens: number }>;
    totalTokens: number;
    groupIndex: number;
    name?: string;
    description?: string;
    reasoning?: string;
    customPrompt?: string;
    metadata?: Array<{
      filePath: string;
      language: string;
      classes: string[];
      functions: string[];
      imports: string[];
      exports: string[];
      estimatedTokens: number;
    }>;
  }> = blob.groups || [];

  if (!Array.isArray(groups) || groups.length === 0) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "fileGroupsData contains no groups",
    );
  }

  // Validate project size from fileGroupsData before making LLM API calls
  const totalTokens = blob.totalTokens ?? groups.reduce((sum, g) => sum + g.totalTokens, 0);
  const maxTokens = config.maxProjectTokens ?? 20_000_000;

  if (totalTokens > maxTokens) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      `Projenizin boyutu çok büyük (${totalTokens.toLocaleString()} token, limit: ${maxTokens.toLocaleString()}).\n\n` +
        `Lütfen şunları kontrol edin:\n` +
        `- .gitignore dosyanızda node_modules, dist, build klasörleri ignore edilmiş mi?\n` +
        `- .mcpignore dosyası oluşturup ek dosya/klasörleri ignore ettiniz mi?\n` +
        `- Gereksiz büyük binary, video, image dosyaları var mı?`,
      {
        tokenCount: totalTokens,
        maxTokens,
      },
    );
  }

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 65536, temperature: 0.5, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );

  const systemPrompt = getSystemPrompt(params.analysisMode);

  // Process groups using rapid-fire pattern
  logger.info("Starting rapid-fire group analysis", {
    ...context,
    groupCount: groups.length,
  });

  const groupAnalyses = await processGroupsRapidFire(
    groups,
    model,
    systemPrompt,
    params,
    context,
  );

  logger.info("Group analyses completed, synthesizing results", {
    ...context,
    groupCount: groups.length,
  });

  // Synthesize all results into a single comprehensive response
  const analysis = await synthesizeResults(
    groupAnalyses,
    groups,
    params,
    model,
    context,
  );

  logger.info("Project orchestrator (analyze) completed", {
    ...context,
    groups: groups.length,
  });

  return { projectPath: params.projectPath, analysis };
}
