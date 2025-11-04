/**
 * @fileoverview AI-powered file grouping service.
 * Uses Gemini AI to group project files into logically coherent, functionally
 * related clusters based on extracted metadata.
 * @module src/mcp-server/services/aiGroupingService
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";
import { logger, type RequestContext } from "../../utils/index.js";
import { config } from "../../config/index.js";
import { createGeminiCliModel } from "../../services/llm-providers/geminiCliProvider.js";
import type { FileMetadata } from "../utils/codeParser.js";

/**
 * Represents a group of related files with AI-generated metadata.
 */
export interface ProjectGroup {
  groupIndex: number;
  name: string;
  description: string;
  totalTokens: number;
  files: string[];
  metadata: FileMetadata[]; // Metadata for analyze step
}

/**
 * Creates a Gemini model instance based on the configured provider.
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
 * Constructs the system prompt for AI grouping.
 */
function buildSystemPrompt(maxTokensPerGroup: number): string {
  return `You are an expert software architect specializing in analyzing and structuring large codebases. Your task is to group a list of project files into logically coherent and functionally related clusters.

You will be provided with a JSON array of file metadata. Each object in the array represents a file and contains its path, estimated token count, and a list of classes, functions, imports, and exports within it.

Your goal is to organize these files into groups based on their purpose and interdependencies. For example, files related to "authentication", "UI components", "database services", or "API routing" should be clustered together.

**CONSTRAINTS:**
1. The total \`estimatedTokens\` of all files in a single group MUST NOT exceed ${maxTokensPerGroup}.
2. Every file from the input list MUST be assigned to exactly one group.
3. Aim to create the most logically cohesive groups possible, even if it means creating more groups with fewer files. Quality of grouping is more important than minimizing the number of groups.

**INPUT FORMAT:**
You will receive a JSON stringified array of objects with the following structure:
\`\`\`json
[
  {
    "filePath": "src/services/auth/jwtMiddleware.ts",
    "language": "typescript",
    "classes": [],
    "functions": ["jwtAuthMiddleware", "verifyToken"],
    "imports": ["jsonwebtoken", "./authContext"],
    "exports": ["jwtAuthMiddleware"],
    "estimatedTokens": 450
  },
  {
    "filePath": "src/utils/database.ts",
    "language": "typescript",
    "classes": ["DatabaseConnection"],
    "functions": ["connect", "query"],
    "imports": ["pg"],
    "exports": ["DatabaseConnection"],
    "estimatedTokens": 300
  }
]
\`\`\`

**OUTPUT FORMAT:**
You MUST respond with ONLY a single JSON array of group objects, with no extra text, explanations, or markdown. The JSON array must conform to the following schema:
\`\`\`json
[
  {
    "groupIndex": 0,
    "name": "Authentication Services",
    "description": "Handles user authentication, token validation, and session management.",
    "totalTokens": 750,
    "files": [
      "src/services/auth/jwtMiddleware.ts",
      "src/services/auth/authContext.ts"
    ],
    "metadata": [
      {
        "filePath": "src/services/auth/jwtMiddleware.ts",
        "language": "typescript",
        "classes": [],
        "functions": ["jwtAuthMiddleware", "verifyToken"],
        "imports": ["jsonwebtoken", "./authContext"],
        "exports": ["jwtAuthMiddleware"],
        "estimatedTokens": 450
      }
    ]
  },
  {
    "groupIndex": 1,
    "name": "Database Utilities",
    "description": "Manages database connections and query execution.",
    "totalTokens": 300,
    "files": [
      "src/utils/database.ts"
    ],
    "metadata": [
      {
        "filePath": "src/utils/database.ts",
        "language": "typescript",
        "classes": ["DatabaseConnection"],
        "functions": ["connect", "query"],
        "imports": ["pg"],
        "exports": ["DatabaseConnection"],
        "estimatedTokens": 300
      }
    ]
  }
]
\`\`\`

IMPORTANT: 
- Return ONLY valid JSON, no markdown code blocks, no explanations
- Include the full metadata object for each file in the metadata array
- Ensure totalTokens matches the sum of estimatedTokens for all files in the group
- Every file from the input MUST appear in exactly one group's files array`;
}

/**
 * Validates and parses the AI response into ProjectGroup array.
 */
function parseAIResponse(
  responseText: string,
  metadata: FileMetadata[],
): ProjectGroup[] {
  // Remove markdown code blocks if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  let groups: ProjectGroup[];
  try {
    groups = JSON.parse(cleaned);
  } catch (error) {
    throw new McpError(
      BaseErrorCode.PARSING_ERROR,
      `Failed to parse AI response as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(groups)) {
    throw new McpError(
      BaseErrorCode.PARSING_ERROR,
      "AI response is not a JSON array",
    );
  }

  // Validate groups structure
  const metadataMap = new Map(metadata.map((m) => [m.filePath, m]));
  const processedFiles = new Set<string>();

  for (const group of groups) {
    if (
      typeof group.groupIndex !== "number" ||
      typeof group.name !== "string" ||
      typeof group.description !== "string" ||
      typeof group.totalTokens !== "number" ||
      !Array.isArray(group.files) ||
      !Array.isArray(group.metadata)
    ) {
      throw new McpError(
        BaseErrorCode.PARSING_ERROR,
        `Invalid group structure: missing required fields`,
      );
    }

    // Verify all files exist in metadata
    for (const filePath of group.files) {
      if (!metadataMap.has(filePath)) {
        throw new McpError(
          BaseErrorCode.PARSING_ERROR,
          `Group contains unknown file: ${filePath}`,
        );
      }
      if (processedFiles.has(filePath)) {
        throw new McpError(
          BaseErrorCode.PARSING_ERROR,
          `File appears in multiple groups: ${filePath}`,
        );
      }
      processedFiles.add(filePath);
    }

    // Verify metadata matches files
    if (group.files.length !== group.metadata.length) {
      throw new McpError(
        BaseErrorCode.PARSING_ERROR,
        `Group ${group.groupIndex}: files and metadata arrays have different lengths`,
      );
    }

    // Verify totalTokens matches sum
    const calculatedTotal = group.metadata.reduce(
      (sum, m) => sum + m.estimatedTokens,
      0,
    );
    if (Math.abs(group.totalTokens - calculatedTotal) > 1) {
      // Allow 1 token difference for rounding
      logger.warning("Group totalTokens mismatch, correcting", {
        requestId: "ai-grouping-validation",
        timestamp: new Date().toISOString(),
        groupIndex: group.groupIndex,
        reported: group.totalTokens,
        calculated: calculatedTotal,
      });
      group.totalTokens = calculatedTotal;
    }
  }

  // Verify all files are assigned
  if (processedFiles.size !== metadata.length) {
    const missing = metadata
      .filter((m) => !processedFiles.has(m.filePath))
      .map((m) => m.filePath);
    throw new McpError(
      BaseErrorCode.PARSING_ERROR,
      `Not all files were assigned to groups. Missing: ${missing.join(", ")}`,
    );
  }

  return groups;
}

/**
 * Groups files using AI based on their metadata.
 *
 * @param metadata - Array of file metadata to group
 * @param maxTokensPerGroup - Maximum tokens allowed per group
 * @param context - Request context for logging
 * @param apiKey - Optional Gemini API key override
 * @returns Promise resolving to array of ProjectGroup
 * @throws {McpError} If grouping fails or response is invalid
 */
export async function groupFilesWithAI(
  metadata: FileMetadata[],
  maxTokensPerGroup: number,
  context: RequestContext,
  apiKey?: string,
): Promise<ProjectGroup[]> {
  if (metadata.length === 0) {
    return [];
  }

  logger.info("Starting AI-powered file grouping", {
    ...context,
    fileCount: metadata.length,
    maxTokensPerGroup,
  });

  // Create model instance
  const model = createModelByProvider(
    config.llmDefaultModel,
    {
      maxOutputTokens: 65536,
      temperature: 0.3, // Lower temperature for more consistent grouping
      topK: 40,
      topP: 0.95,
    },
    apiKey,
  );

  // Build prompt
  const systemPrompt = buildSystemPrompt(maxTokensPerGroup);
  const inputJson = JSON.stringify(metadata, null, 2);
  const userPrompt = `Here is the file metadata array:\n\n${inputJson}\n\nGroup these files into logically coherent clusters.`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  logger.debug("Sending grouping request to AI", {
    ...context,
    promptLength: fullPrompt.length,
    metadataCount: metadata.length,
  });

  let retries = 1;
  let lastError: Error | null = null;

  while (retries >= 0) {
    try {
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const responseText = response.text();

      logger.debug("Received AI grouping response", {
        ...context,
        responseLength: responseText.length,
      });

      // Parse and validate response
      const groups = parseAIResponse(responseText, metadata);

      // Verify token limits
      const violations = groups.filter(
        (g) => g.totalTokens > maxTokensPerGroup,
      );
      if (violations.length > 0) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Groups exceed token limit: ${violations.map((v) => `Group ${v.groupIndex} (${v.totalTokens} tokens)`).join(", ")}`,
        );
      }

      logger.info("AI grouping completed successfully", {
        ...context,
        groupCount: groups.length,
        totalFiles: metadata.length,
      });

      return groups;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on validation/parsing errors
      if (
        error instanceof McpError &&
        (error.code === BaseErrorCode.PARSING_ERROR ||
          error.code === BaseErrorCode.VALIDATION_ERROR)
      ) {
        throw error;
      }

      // Retry on network/API errors
      if (retries > 0) {
        logger.warning("AI grouping failed, retrying", {
          ...context,
          error: lastError.message,
          retriesLeft: retries,
        });
        retries--;
        // Wait a bit before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Final failure
      logger.error("AI grouping failed after retries", {
        ...context,
        error: lastError.message,
      });

      throw new McpError(
        BaseErrorCode.SERVICE_UNAVAILABLE,
        `AI grouping service failed: ${lastError.message}`,
        { cause: lastError },
      );
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "AI grouping service failed unexpectedly",
  );
}

