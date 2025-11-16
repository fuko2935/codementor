/**
 * @fileoverview Core logic for the createAnalysisMode MCP tool
 * @module src/mcp-server/tools/createAnalysisMode/logic
 */
import { z } from "zod";
import fs from "fs";
import { logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import { BASE_DIR } from "../../../index.js";
import { prepareFullContext } from "../../utils/contextBuilder.js";
import { createModelByProvider } from "../../../services/llm-providers/modelFactory.js";
import { config } from "../../../config/index.js";

// ============================================================================
// Task 2.1: Define CreateAnalysisModeInputSchema with Zod
// ============================================================================

/**
 * Input schema for createAnalysisMode tool
 * Validates all input parameters with descriptions for AI assistants
 */
export const CreateAnalysisModeInputSchema = z.object({
  expertiseHint: z.string()
    .min(1, "Expertise hint cannot be empty")
    .describe(
      "Mode description. If withAi=false, used directly as prompt. " +
      "If withAi=true, used as AI hint."
    ),
  
  withAi: z.boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to use AI for mode generation. Default: false (manual mode)."
    ),
  
  projectPath: z.string()
    .min(1)
    .optional()
    .describe(
      "Project path for project-specific mode generation. " +
      "Only used when withAi=true."
    ),
  
  returnFormat: z.enum(["json", "prompt_only"])
    .optional()
    .default("json")
    .describe(
      "Response format. 'json' returns full structured response, " +
      "'prompt_only' returns only the prompt text for easier chaining."
    ),
  
  geminiApiKey: z.string()
    .min(1)
    .optional()
    .describe("Optional Gemini API key override."),
  
  temporaryIgnore: z.array(z.string())
    .optional()
    .describe("Additional ignore patterns for this run only.")
});

// ============================================================================
// Task 2.3: Export input type using z.infer
// ============================================================================

/**
 * TypeScript type inferred from CreateAnalysisModeInputSchema
 */
export type CreateAnalysisModeInput = z.infer<typeof CreateAnalysisModeInputSchema>;

// ============================================================================
// Task 2.2: Define CreateAnalysisModeResponse interface
// ============================================================================

/**
 * Response interface for createAnalysisMode tool
 * Contains the generated mode information
 */
export interface CreateAnalysisModeResponse {
  /**
   * Type of mode created
   * - "manual": User-provided prompt used directly
   * - "ai_generated": AI-generated general prompt
   * - "ai_project_generated": AI-generated project-specific prompt
   */
  modeType: "manual" | "ai_generated" | "ai_project_generated";
  
  /**
   * The complete expert prompt text
   * Can be used directly with gemini_codebase_analyzer's customExpertPrompt parameter
   */
  analysisModePrompt: string;
  
  /**
   * The original user-provided expertiseHint
   * Preserved for reference and traceability
   */
  sourceHint: string;
}

// ============================================================================
// Task 3.1: Create detectMode helper function
// ============================================================================

/**
 * Detects the mode type based on input parameters
 * 
 * @param params - Validated input parameters
 * @returns The detected mode type
 * 
 * Mode detection logic:
 * - "manual": withAi is false - user provides prompt directly
 * - "ai_project_generated": withAi is true AND projectPath exists
 * - "ai_generated": withAi is true AND no projectPath
 */
function detectMode(
  params: CreateAnalysisModeInput
): "manual" | "ai_generated" | "ai_project_generated" {
  // Manual mode: user provides prompt directly without AI assistance
  if (!params.withAi) {
    return "manual";
  }
  
  // AI-assisted modes: check if project-specific or general
  if (params.projectPath) {
    return "ai_project_generated";
  }
  
  return "ai_generated";
}

// ============================================================================
// Task 4.1: Create processManualMode function
// ============================================================================

/**
 * Processes manual mode where user provides the expert prompt directly
 * 
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @returns Structured response with manual mode type
 * @throws {McpError} VALIDATION_ERROR - When expertiseHint is empty
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4
 * - Uses expertiseHint directly as the analysis mode prompt
 * - No AI service invocation
 * - Returns modeType: "manual"
 */
function processManualMode(
  params: CreateAnalysisModeInput,
  context: RequestContext
): CreateAnalysisModeResponse {
  logger.debug("Processing manual mode", {
    ...context,
    hintLength: params.expertiseHint.length
  });
  
  // Validate expertiseHint is non-empty (should already be validated by Zod)
  if (!params.expertiseHint || params.expertiseHint.trim().length === 0) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Expertise hint cannot be empty",
      { field: "expertiseHint" }
    );
  }
  
  // Return structured response with manual mode
  const response: CreateAnalysisModeResponse = {
    modeType: "manual",
    analysisModePrompt: params.expertiseHint,
    sourceHint: params.expertiseHint
  };
  
  logger.info("Manual mode processed successfully", {
    ...context,
    modeType: response.modeType,
    promptLength: response.analysisModePrompt.length
  });
  
  return response;
}

// ============================================================================
// Helper: Generate expert prompt with AI
// ============================================================================

/**
 * Helper function to generate expert prompt using Gemini API
 * Reduces code duplication between AI-assisted modes
 * 
 * @param aiPrompt - The prompt to send to Gemini API
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @param modeLabel - Label for logging (e.g., "general mode", "project-specific mode")
 * @returns Generated expert prompt text
 * @throws {McpError} SERVICE_UNAVAILABLE - When Gemini API call fails
 * @throws {McpError} CONFIGURATION_ERROR - When API key is missing
 */
async function _generateExpertPromptWithAI(
  aiPrompt: string,
  params: CreateAnalysisModeInput,
  context: RequestContext,
  modeLabel: string
): Promise<string> {
  logger.debug(`Constructed AI prompt for ${modeLabel}`, {
    ...context,
    promptLength: aiPrompt.length
  });
  
  try {
    // Create Gemini model instance
    const model = createModelByProvider(
      config.llmDefaultModel,
      {
        maxOutputTokens: 4096,
        temperature: 0.3,
        topK: 40,
        topP: 0.95
      },
      params.geminiApiKey
    );
    
    logger.debug(`Invoking Gemini API for ${modeLabel}`, {
      ...context,
      model: config.llmDefaultModel
    });
    
    // Invoke Gemini API
    const result = await model.generateContent(aiPrompt);
    
    // Extract generated prompt from response
    const generatedPrompt = (await result.response).text();
    
    if (!generatedPrompt || generatedPrompt.trim().length === 0) {
      throw new McpError(
        BaseErrorCode.SERVICE_UNAVAILABLE,
        "Gemini API returned empty response",
        {
          provider: "gemini",
          model: config.llmDefaultModel
        }
      );
    }
    
    logger.info(`AI-assisted ${modeLabel} processed successfully`, {
      ...context,
      generatedPromptLength: generatedPrompt.length
    });
    
    return generatedPrompt;
    
  } catch (error) {
    // Handle API errors
    if (error instanceof McpError) {
      throw error;
    }
    
    logger.error(`Gemini API call failed in ${modeLabel}`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    throw new McpError(
      BaseErrorCode.SERVICE_UNAVAILABLE,
      "Gemini API request failed",
      {
        provider: "gemini",
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

// ============================================================================
// Task 5.1: Create processAiGeneralMode function
// ============================================================================

/**
 * Processes AI-assisted general mode where AI generates an expert prompt
 * based on the user's hint without project-specific context
 * 
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @returns Structured response with ai_generated mode type
 * @throws {McpError} VALIDATION_ERROR - When expertiseHint is empty
 * @throws {McpError} SERVICE_UNAVAILABLE - When Gemini API call fails
 * @throws {McpError} CONFIGURATION_ERROR - When API key is missing
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 * - Constructs AI prompt using general template
 * - Invokes Gemini API with prompt
 * - Extracts generated prompt from response
 * - Returns modeType: "ai_generated"
 * - Handles API errors with SERVICE_UNAVAILABLE
 */
async function processAiGeneralMode(
  params: CreateAnalysisModeInput,
  context: RequestContext
): Promise<CreateAnalysisModeResponse> {
  logger.debug("Processing AI-assisted general mode", {
    ...context,
    hintLength: params.expertiseHint.length
  });
  
  // Validate expertiseHint is non-empty (should already be validated by Zod)
  if (!params.expertiseHint || params.expertiseHint.trim().length === 0) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Expertise hint cannot be empty",
      { field: "expertiseHint" }
    );
  }
  
  // Construct AI prompt using general template
  const aiPrompt = `You are an expert system prompt generator. Based on the user's hint: "${params.expertiseHint}", create the best possible expert system prompt for analyzing a codebase. The prompt should define the expert's role, focus areas, and analysis approach.`;
  
  // Use helper function to generate prompt with AI
  const generatedPrompt = await _generateExpertPromptWithAI(
    aiPrompt,
    params,
    context,
    "general mode"
  );
  
  // Return structured response
  const response: CreateAnalysisModeResponse = {
    modeType: "ai_generated",
    analysisModePrompt: generatedPrompt,
    sourceHint: params.expertiseHint
  };
  
  return response;
}

// ============================================================================
// Task 6.1: Create processProjectSpecificMode function
// ============================================================================

/**
 * Processes project-specific mode where AI generates an expert prompt
 * tailored to the specific project's codebase
 * 
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @returns Structured response with ai_project_generated mode type
 * @throws {McpError} VALIDATION_ERROR - When expertiseHint is empty or path is invalid
 * @throws {McpError} NOT_FOUND - When project directory doesn't exist
 * @throws {McpError} SERVICE_UNAVAILABLE - When Gemini API call fails
 * @throws {McpError} CONFIGURATION_ERROR - When API key is missing
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 * - Validates projectPath with validateSecurePath
 * - Checks directory exists, throws NOT_FOUND if missing
 * - Reads project context using prepareFullContext
 * - Constructs AI prompt with project-specific template
 * - Invokes Gemini API with prompt and context
 * - Extracts generated prompt from response
 * - Returns modeType: "ai_project_generated"
 */
async function processProjectSpecificMode(
  params: CreateAnalysisModeInput,
  context: RequestContext
): Promise<CreateAnalysisModeResponse> {
  logger.debug("Processing project-specific mode", {
    ...context,
    hintLength: params.expertiseHint.length,
    projectPath: params.projectPath
  });
  
  // Validate expertiseHint is non-empty (should already be validated by Zod)
  if (!params.expertiseHint || params.expertiseHint.trim().length === 0) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Expertise hint cannot be empty",
      { field: "expertiseHint" }
    );
  }
  
  // Validate projectPath is provided
  if (!params.projectPath) {
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Project path is required for project-specific mode",
      { field: "projectPath" }
    );
  }
  
  // Validate path with validateSecurePath (Requirement 3.2)
  // Note: validateSecurePath is async and also checks if path exists and is a directory
  const validatedPath = await validateSecurePath(params.projectPath, BASE_DIR, context);
  
  logger.debug("Path validated successfully", {
    ...context,
    validatedPath
  });
  
  logger.info("Reading project context", {
    ...context,
    projectPath: validatedPath
  });
  
  try {
    // Read project context using prepareFullContext (Requirement 3.1)
    const projectContext = await prepareFullContext(
      validatedPath,
      params.temporaryIgnore || [],
      false, // ignoreMcpignore
      context
    );
    
    logger.debug("Project context prepared", {
      ...context,
      contextLength: projectContext.length
    });
    
    // Construct AI prompt with project-specific template (Requirement 3.3)
    const aiPrompt = `You are an expert system prompt generator. Based on the project context below and the user's hint: "${params.expertiseHint}", create the best possible expert system prompt for analyzing this specific codebase.

Project Context:
${projectContext}

The prompt should reference project-specific patterns, architecture, and conventions.`;
    
    // Use helper function to generate prompt with AI (Requirement 3.3, 3.4)
    const generatedPrompt = await _generateExpertPromptWithAI(
      aiPrompt,
      params,
      context,
      "project-specific mode"
    );
    
    // Return structured response with ai_project_generated mode type (Requirement 3.4)
    const response: CreateAnalysisModeResponse = {
      modeType: "ai_project_generated",
      analysisModePrompt: generatedPrompt,
      sourceHint: params.expertiseHint
    };
    
    return response;
    
  } catch (error) {
    // Propagate McpError from helper or prepareFullContext
    if (error instanceof McpError) {
      throw error;
    }
    
    // Wrap unexpected errors from context preparation
    logger.error("Project-specific mode processing failed", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      "Failed to prepare project context",
      {
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

// ============================================================================
// Task 7.1: Create createAnalysisModeLogic function
// ============================================================================

/**
 * Main logic function for createAnalysisMode tool
 * Routes to appropriate processing function based on detected mode
 * 
 * @param params - Validated input parameters
 * @param context - Request context for logging and tracing
 * @returns Structured response with mode type and generated prompt
 * @throws {McpError} VALIDATION_ERROR - When input validation fails
 * @throws {McpError} NOT_FOUND - When project directory doesn't exist (project-specific mode)
 * @throws {McpError} SERVICE_UNAVAILABLE - When Gemini API call fails (AI modes)
 * @throws {McpError} CONFIGURATION_ERROR - When API key is missing (AI modes)
 * @throws {McpError} INTERNAL_ERROR - When unexpected error occurs
 * 
 * Requirements: 1.1, 2.1, 3.1, 6.5, 7.1, 7.2, 7.3, 7.4
 * 
 * Workflow:
 * 1. Log operation start with sanitized params
 * 2. Detect mode using detectMode helper
 * 3. Route to appropriate processing function:
 *    - manual: processManualMode
 *    - ai_generated: processAiGeneralMode
 *    - ai_project_generated: processProjectSpecificMode
 * 4. Log operation completion
 * 5. Return structured response
 * 6. Propagate errors as McpError
 */
export async function createAnalysisModeLogic(
  params: CreateAnalysisModeInput,
  context: RequestContext
): Promise<CreateAnalysisModeResponse> {
  // Log operation start with sanitized params (Requirement 7.1)
  logger.info("Starting createAnalysisMode operation", {
    ...context,
    params: {
      expertiseHint: params.expertiseHint.substring(0, 100) + (params.expertiseHint.length > 100 ? "..." : ""),
      withAi: params.withAi,
      hasProjectPath: !!params.projectPath,
      hasGeminiApiKey: !!params.geminiApiKey,
      temporaryIgnoreCount: params.temporaryIgnore?.length || 0
    }
  });
  
  try {
    // Detect mode using detectMode (Requirement 7.2)
    const mode = detectMode(params);
    
    logger.debug("Mode detected", {
      ...context,
      mode
    });
    
    // Route to appropriate processing function (Requirement 7.3)
    let response: CreateAnalysisModeResponse;
    
    switch (mode) {
      case "manual":
        response = processManualMode(params, context);
        break;
      
      case "ai_generated":
        response = await processAiGeneralMode(params, context);
        break;
      
      case "ai_project_generated":
        response = await processProjectSpecificMode(params, context);
        break;
      
      default:
        // This should never happen due to TypeScript exhaustiveness checking
        throw new McpError(
          BaseErrorCode.INTERNAL_ERROR,
          "Unhandled mode type",
          { mode }
        );
    }
    
    // Log operation completion (Requirement 7.4)
    logger.info("createAnalysisMode operation completed successfully", {
      ...context,
      modeType: response.modeType,
      promptLength: response.analysisModePrompt.length,
      sourceHintLength: response.sourceHint.length
    });
    
    return response;
    
  } catch (error) {
    // Propagate errors as McpError (Requirement 7.4)
    if (error instanceof McpError) {
      logger.error("createAnalysisMode operation failed with McpError", {
        ...context,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details
      });
      throw error;
    }
    
    // Wrap unexpected errors
    logger.error("createAnalysisMode operation failed with unexpected error", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      "Unexpected error during analysis mode creation",
      {
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  }
}
