import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext } from "../../../utils/index.js";
import { config } from "../../../config/index.js";
import { createGeminiCliModel } from "../../../services/llm-providers/geminiCliProvider.js";
import { getSystemPrompt } from "../../prompts.js";

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
    }>;
  };

  const groups: Array<{
    files: Array<{ filePath: string; tokens: number }>;
    totalTokens: number;
    groupIndex: number;
    name?: string;
    description?: string;
    reasoning?: string;
    customPrompt?: string;
  }> = blob.groups || [];

  if (!Array.isArray(groups) || groups.length === 0) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "fileGroupsData contains no groups",
    );
  }

  const analyses: string[] = [];
  const model = createModelByProvider(
    config.llmDefaultModel,
    { maxOutputTokens: 65536, temperature: 0.5, topK: 40, topP: 0.95 },
    params.geminiApiKey,
  );

  const systemPrompt = getSystemPrompt(params.analysisMode);

  for (const [i, g] of groups.entries()) {
    const prompt = `${g.customPrompt || systemPrompt}

Group Index: ${i + 1}
Analysis Mode: ${params.analysisMode}
User Question: ${params.question}

Files in this group (paths only, content omitted for brevity):
${g.files.map((f) => `- ${f.filePath} (${f.tokens} est. tokens)`).join("\n")}

Focus your analysis on the kinds of files listed and answer the user question grounded in typical content of these files.`;
    const result = await model.generateContent(prompt);
    const text = (await result.response).text();
    analyses.push(`### Group ${i + 1}\n\n${text}`);
  }

  const analysis = `# Project Orchestrator Analysis\n\n${analyses.join("\n\n---\n\n")}`;
  logger.info("Project orchestrator (analyze) completed", {
    ...context,
    groups: groups.length,
  });
  return { projectPath: params.projectPath, analysis };
}
