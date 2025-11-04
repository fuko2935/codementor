/**
 * Gemini CLI Provider Service
 *
 * Implementation for interacting with Gemini models via Gemini CLI
 * using the ai-sdk-provider-gemini-cli package.
 * This provider uses OAuth authentication via the gemini CLI tool.
 */

import { generateText } from "ai";
import { createGeminiProvider } from "ai-sdk-provider-gemini-cli";
import { logger } from "../../utils/index.js";
import { requestContextService } from "../../utils/index.js";

export interface GeminiCliProviderOptions {
  apiKey?: string;
  baseURL?: string;
  authType?: "oauth-personal" | "api-key";
}

export interface GeminiCliGenerateTextParams {
  modelId: string;
  messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
  systemPrompt?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

/**
 * Type definition for Gemini usage statistics
 */
interface GeminiUsage {
  promptTokens?: number;
  inputTokens?: number;
  completionTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Creates a Gemini CLI provider instance
 */
export function createGeminiCliProvider(
  options: GeminiCliProviderOptions = {},
): ReturnType<typeof createGeminiProvider> {
  try {
    // Primary use case: Use existing gemini CLI authentication via OAuth
    // Secondary use case: Direct API key (for compatibility)
    let authOptions: {
      authType: "oauth-personal" | "api-key";
      apiKey?: string;
      baseURL?: string;
    };

    if (options.apiKey && options.apiKey !== "gemini-cli-no-key-required") {
      // API key provided - use it for compatibility
      authOptions = {
        authType: "api-key",
        apiKey: options.apiKey,
      };
    } else {
      // Expected case: Use gemini CLI authentication via OAuth
      authOptions = {
        authType: "oauth-personal",
      };
    }

    // Add baseURL if provided (for custom endpoints)
    if (options.baseURL) {
      authOptions.baseURL = options.baseURL;
    }

    // Create and return the provider
    return createGeminiProvider(authOptions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const context = requestContextService.createRequestContext({
      operation: "GeminiCliProvider.initialize",
    });
    logger.error(
      "Gemini CLI provider initialization failed",
      error as Error,
      context,
    );
    throw new Error(
      `Gemini CLI provider initialization failed: ${errorMessage}`,
    );
  }
}

/**
 * Extracts system messages from the messages array
 * This is needed because ai-sdk-provider-gemini-cli expects system prompts as a separate parameter
 */
export function extractSystemMessage(
  messages: Array<{ role: string; content: string }>,
): {
  systemPrompt: string | undefined;
  messages: Array<{ role: string; content: string }>;
} {
  if (!messages || !Array.isArray(messages)) {
    return { systemPrompt: undefined, messages: messages || [] };
  }

  const systemMessages = messages.filter((msg) => msg.role === "system");
  const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

  // Combine multiple system messages if present
  const systemPrompt =
    systemMessages.length > 0
      ? systemMessages.map((msg) => msg.content).join("\n\n")
      : undefined;

  return { systemPrompt, messages: nonSystemMessages };
}

/**
 * Generates text using Gemini CLI provider
 */
export async function generateTextWithGeminiCli(
  provider: ReturnType<typeof createGeminiProvider>,
  params: GeminiCliGenerateTextParams,
): Promise<{
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}> {
  try {
    // Extract system messages for separate handling
    const { systemPrompt, messages } = extractSystemMessage(params.messages);

    // Use the system prompt from params if provided, otherwise use extracted one
    const effectiveSystemPrompt = params.systemPrompt || systemPrompt;

    const result = await generateText({
      model: provider(params.modelId),
      system: effectiveSystemPrompt,
      messages: messages as Array<{
        role: "user" | "assistant";
        content: string;
      }>,
      maxOutputTokens: params.maxOutputTokens,
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
    });

    return {
      text: result.text,
      usage: {
        promptTokens:
          (result.usage as GeminiUsage)?.promptTokens ??
          (result.usage as GeminiUsage)?.inputTokens ??
          0,
        completionTokens:
          (result.usage as GeminiUsage)?.completionTokens ??
          (result.usage as GeminiUsage)?.outputTokens ??
          0,
        totalTokens: (result.usage as GeminiUsage)?.totalTokens ?? 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const context = requestContextService.createRequestContext({
      operation: "GeminiCliProvider.generateText",
    });
    logger.error("Gemini CLI text generation failed", error as Error, context);
    throw new Error(`Gemini CLI text generation failed: ${errorMessage}`);
  }
}

/**
 * Creates a model instance compatible with the existing GoogleGenerativeAI model interface
 * This wrapper allows the Gemini CLI provider to work with the existing retry logic
 */
export function createGeminiCliModel(
  modelId: string,
  options: GeminiCliProviderOptions = {},
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
  },
): {
  generateContent: (
    prompt: string,
  ) => Promise<{ response: { text: () => string } }>;
} {
  const provider = createGeminiCliProvider(options);

  return {
    async generateContent(prompt: string) {
      const result = await generateTextWithGeminiCli(provider, {
        modelId,
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: generationConfig?.maxOutputTokens,
        temperature: generationConfig?.temperature,
      });

      return {
        response: {
          text: () => result.text,
        },
      };
    },
  };
}
