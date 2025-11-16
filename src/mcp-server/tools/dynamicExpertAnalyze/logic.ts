import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { type RequestContext } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { validateProjectSize } from "../../utils/projectSizeValidator.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { validateMcpConfigExists } from "../../utils/mcpConfigValidator.js";
import { prepareFullContext } from "../../utils/contextBuilder.js";

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

export async function dynamicExpertAnalyzeLogic(
  params: DynamicExpertAnalyzeInput,
  context: RequestContext,
): Promise<DynamicExpertAnalyzeResponse> {
  // Validate MCP configuration exists before expert analysis
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
