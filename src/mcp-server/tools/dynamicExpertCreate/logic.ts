import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { type RequestContext } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { validateProjectSize } from "../../utils/projectSizeValidator.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { validateMcpConfigExists } from "../../utils/mcpConfigValidator.js";
import { prepareFullContext } from "../../utils/contextBuilder.js";

export const DynamicExpertCreateInputSchema = z.object({
  projectPath: z.string().optional(),
  temporaryIgnore: z.array(z.string()).optional(),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  expertiseHint: z.string().min(1).max(200),
  geminiApiKey: z.string().min(1).optional(),
});

export type DynamicExpertCreateInput = z.infer<
  typeof DynamicExpertCreateInputSchema
>;

export type DynamicExpertCreateResponse = string;

/**
 * Creates an expert prompt based on project context.
 * This function analyzes the project files and generates a specialized expert persona.
 * 
 * @param projectPath - Required project path to analyze
 * @param params - Input parameters including expertiseHint
 * @param context - Request context for logging
 * @returns Generated expert prompt string
 */
async function createExpertFromProject(
  projectPath: string,
  params: DynamicExpertCreateInput,
  context: RequestContext,
): Promise<string> {
  // Validate MCP configuration exists before expert creation
  await validateMcpConfigExists(projectPath, context);

  // Validate and secure the project path
  const normalizedPath = await validateSecurePath(projectPath, process.cwd(), context);

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

  const expertGenerationPrompt = `Based on this project's content and the user's request (${params.expertiseHint}), write the best possible expert system prompt to analyze this codebase.`;

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 4096, temperature: 0.3, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );
  const expertResult = await model.generateContent(expertGenerationPrompt);
  const expertPrompt = (await expertResult.response).text();

  return expertPrompt;
}

/**
 * Creates an expert prompt based only on the expertise hint.
 * This function generates a general expert persona without project-specific context.
 * 
 * @param params - Input parameters including expertiseHint
 * @param context - Request context for logging
 * @returns Generated expert prompt string
 */
async function createExpertFromHint(
  params: DynamicExpertCreateInput,
  context: RequestContext,
): Promise<string> {
  const expertGenerationPrompt = `Based on the user's description (${params.expertiseHint}), write the best possible expert system prompt for analyzing a codebase.`;

  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 4096, temperature: 0.3, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );
  const expertResult = await model.generateContent(expertGenerationPrompt);
  const expertPrompt = (await expertResult.response).text();

  return expertPrompt;
}

/**
 * Main logic function for creating dynamic expert prompts.
 * Routes to appropriate helper function based on whether projectPath is provided.
 * 
 * @param params - Input parameters
 * @param context - Request context for logging
 * @returns Generated expert prompt string
 */
export async function dynamicExpertCreateLogic(
  params: DynamicExpertCreateInput,
  context: RequestContext,
): Promise<DynamicExpertCreateResponse> {
  if (params.projectPath) {
    // Pass projectPath as a separate, required parameter for type safety
    return createExpertFromProject(params.projectPath, params, context);
  } else {
    return createExpertFromHint(params, context);
  }
}