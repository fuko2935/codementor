/**
 * @fileoverview Shared orchestration service for large project analysis
 * @module src/mcp-server/services/orchestrationService
 * 
 * This service provides the core orchestration logic for analyzing large projects
 * that exceed token limits. It's used by both the main analyzer (with autoOrchestrate)
 * and the legacy orchestrator tools (for backward compatibility).
 */

import type { RequestContext } from "../../utils/index.js";
import {
  projectOrchestratorCreateLogic,
  type ProjectOrchestratorCreateInput,
  type ProjectOrchestratorCreateResponse
} from "../tools/projectOrchestratorCreate/logic.js";
import {
  projectOrchestratorAnalyzeLogic,
  type ProjectOrchestratorAnalyzeInput,
  type ProjectOrchestratorAnalyzeResponse
} from "../tools/projectOrchestratorAnalyze/logic.js";

/**
 * Creates intelligent file groups for large projects
 * 
 * @param params - Orchestration parameters
 * @param context - Request context for logging and tracing
 * @returns File groups data for analysis
 */
export async function createProjectGroups(
  params: ProjectOrchestratorCreateInput,
  context: RequestContext
): Promise<ProjectOrchestratorCreateResponse> {
  return projectOrchestratorCreateLogic(params, context);
}

/**
 * Analyzes project groups and combines results
 * 
 * @param params - Analysis parameters with file groups
 * @param context - Request context for logging and tracing
 * @returns Combined analysis results
 */
export async function analyzeProjectGroups(
  params: ProjectOrchestratorAnalyzeInput,
  context: RequestContext
): Promise<ProjectOrchestratorAnalyzeResponse> {
  return projectOrchestratorAnalyzeLogic(params, context);
}

// Type for orchestrator analysis modes
type OrchestratorMode = "general" | "implementation" | "refactoring" | "explanation" | "debugging" | "audit" | "security" | "performance" | "testing" | "documentation";

/**
 * Full orchestration workflow: create groups and analyze
 * 
 * @param projectPath - Path to the project
 * @param question - Analysis question
 * @param analysisMode - Analysis mode to use
 * @param maxTokensPerGroup - Maximum tokens per group
 * @param temporaryIgnore - Optional temporary ignore patterns
 * @param ignoreMcpignore - Whether to ignore .mcpignore file
 * @param geminiApiKey - Optional Gemini API key
 * @param context - Request context
 * @returns Combined analysis results with file count metadata
 */
export async function orchestrateFullAnalysis(
  projectPath: string,
  question: string,
  analysisMode: OrchestratorMode,
  maxTokensPerGroup: number,
  temporaryIgnore: string[] | undefined,
  ignoreMcpignore: boolean | undefined,
  geminiApiKey: string | undefined,
  context: RequestContext
): Promise<ProjectOrchestratorAnalyzeResponse & { filesProcessed?: number }> {
  // Step 1: Create groups
  const groupsResult = await createProjectGroups(
    {
      projectPath,
      question,
      analysisMode,
      maxTokensPerGroup,
      temporaryIgnore,
      ignoreMcpignore: ignoreMcpignore ?? false,
      geminiApiKey
    },
    context
  );

  // Extract file count from groups data
  let filesProcessed = 0;
  try {
    const groupsData = JSON.parse(groupsResult.groupsData);
    filesProcessed = groupsData.totalFiles ?? 0;
  } catch {
    // Ignore parse errors
  }

  // Step 2: Analyze groups
  const analysisResult = await analyzeProjectGroups(
    {
      projectPath,
      question,
      fileGroupsData: groupsResult.groupsData, // Correct property name
      analysisMode,
      maxTokensPerGroup,
      temporaryIgnore,
      geminiApiKey
    },
    context
  );

  // Return result with file count metadata
  return {
    ...analysisResult,
    filesProcessed
  };
}
