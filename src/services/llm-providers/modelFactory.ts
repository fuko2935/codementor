/**
 * @fileoverview Centralized model factory for creating LLM provider instances.
 * This module provides a single source of truth for initializing Gemini models
 * with support for both OAuth (gemini-cli) and API key authentication.
 * @module src/services/llm-providers/modelFactory
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../../config/index.js";
import { createGeminiCliModel } from "./geminiCliProvider.js";
import { createProxyModel } from "./proxyProvider.js";
import { McpError, BaseErrorCode } from "../../types-global/errors.js";

/**
 * Configuration options for model generation.
 */
export interface GenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
}

/**
 * Creates a model instance based on the configured provider.
 * Supports both gemini-cli (OAuth) and direct API key authentication.
 *
 * @param modelId - The model identifier (e.g., 'gemini-2.5-pro')
 * @param generationConfig - Optional generation configuration (temperature, tokens, etc.)
 * @param apiKey - Optional API key override (takes precedence over config)
 * @returns The configured model instance
 * @throws {McpError} If API key is missing when required
 */
export function createModelByProvider(
  modelId: string,
  generationConfig?: GenerationConfig,
  apiKey?: string,
) {
  const provider = config.llmDefaultProvider as
    | "gemini"
    | "google"
    | "gemini-cli"
    | "proxy";

  if (provider === "gemini-cli") {
    return createGeminiCliModel(modelId, {}, generationConfig);
  }

  if (provider === "proxy") {
    return createProxyModel(modelId, apiKey);
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

