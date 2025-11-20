/**
 * @fileoverview Provides a service class (`ProxyProvider`) for interacting with
 * an OpenAI-compatible proxy (e.g., local Gemini 3 Pro proxy).
 * This class adapts the OpenAI API to match the Google Generative AI SDK interface
 * expected by the rest of the application.
 * @module src/services/llm-providers/proxyProvider
 */
import OpenAI from "openai";
import { config } from "../../config/index.js";
import { logger } from "../../utils/internal/logger.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

import {
    requestContextService,
} from "../../utils/internal/requestContext.js";

/**
 * Adapts the OpenAI-compatible API to the Google Generative AI interface.
 */
export class ProxyModel {
    private client: OpenAI;
    private modelId: string;

    constructor(apiKey: string, baseURL: string, modelId: string) {
        const effectiveApiKey = apiKey || "dummy";
        
        // Log when using placeholder API key for transparency
        if (effectiveApiKey === "dummy") {
            const context = requestContextService.createRequestContext({
                operation: "ProxyProvider.constructor",
            });
            logger.debug("No API key provided for Proxy provider, using placeholder. This is normal for local proxies (LM Studio, Ollama).", {
                ...context,
                baseURL,
                modelId,
            });
        }
        
        this.client = new OpenAI({
            apiKey: effectiveApiKey,
            baseURL: baseURL,
        });
        this.modelId = modelId;
    }

    /**
     * Generates content using the proxy provider.
     * Matches the signature expected by geminiCodebaseAnalyzerLogic.
     * 
     * @param prompt - The prompt to send to the model.
     * @returns An object mimicking the Google Generative AI response structure.
     */
    async generateContent(prompt: string) {
        const context = requestContextService.createRequestContext({
            operation: "ProxyProvider.generateContent",
        });

        try {
            logger.debug("Sending request to Proxy Provider", {
                ...context,
                model: this.modelId,
                baseURL: this.client.baseURL,
                promptLength: prompt.length,
            });

            const response = await this.client.chat.completions.create({
                model: this.modelId,
                messages: [{ role: "user", content: prompt }],
            });

            const text = response.choices[0]?.message?.content || "";

            return {
                response: Promise.resolve({
                    text: () => text,
                }),
            };
        } catch (error: unknown) {
            const err = error as Error;
            logger.error("Proxy Provider request failed", {
                ...context,
                error: err.message,
                stack: err.stack,
            });
            throw new McpError(
                BaseErrorCode.INTERNAL_ERROR,
                `Proxy Provider API error: ${err.message}`,
                { originalError: err }
            );
        }
    }
}

/**
 * Creates a configured ProxyModel instance.
 * 
 * @param modelId - The model identifier.
 * @param apiKey - Optional API key override.
 * @returns A new ProxyModel instance.
 */
export function createProxyModel(modelId: string, apiKey?: string) {
    const key = apiKey || config.proxyApiKey || "dummy";
    const baseURL = config.proxyBaseUrl;
    // Use the passed modelId if it's not the default gemini one, otherwise fall back to config
    // This handles the case where createModelByProvider passes config.llmDefaultModel
    const effectiveModelId = modelId === "gemini-2.5-pro" ? config.proxyModelId : modelId;

    return new ProxyModel(key, baseURL, effectiveModelId);
}
