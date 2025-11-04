/**
 * @fileoverview AI-powered project orchestrator create logic.
 * Uses AI to group project files into logically coherent clusters based on
 * extracted code metadata (classes, functions, imports, exports).
 * @module src/mcp-server/tools/projectOrchestratorCreate/logic
 */

import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext, sanitization, createIgnoreInstance } from "../../../utils/index.js";
import { extractMetadata, type FileMetadata } from "../../utils/codeParser.js";
import { groupFilesWithAI, type ProjectGroup } from "../../services/aiGroupingService.js";

export const ProjectOrchestratorCreateInputSchema = z.object({
  projectPath: z.string().min(1),
  temporaryIgnore: z.array(z.string()).optional(),
  ignoreMcpignore: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ignores the .mcpignore file and only uses .gitignore patterns."),
  question: z.string().min(1).max(50000).optional(),
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
  maxTokensPerGroup: z
    .number()
    .min(100000)
    .max(950000)
    .default(900000)
    .optional(),
  geminiApiKey: z.string().min(1).optional(),
});

export type ProjectOrchestratorCreateInput = z.infer<
  typeof ProjectOrchestratorCreateInputSchema
>;

export interface ProjectOrchestratorCreateResponse {
  groupsData: string;
}

/**
 * Converts AI-generated ProjectGroup[] to the format expected by projectOrchestratorAnalyze.
 * Includes metadata for enhanced analysis capabilities.
 */
function convertGroupsToAnalyzeFormat(
  aiGroups: ProjectGroup[],
  totalFiles: number,
  totalTokens: number,
  projectPath: string,
  analysisMode: string,
  maxTokensPerGroup: number,
): string {
  const groups = aiGroups.map((aiGroup) => ({
    files: aiGroup.files.map((filePath) => {
      // Find metadata for this file to get token count
      const fileMetadata = aiGroup.metadata.find((m) => m.filePath === filePath);
      return {
        filePath,
        tokens: fileMetadata?.estimatedTokens || 0,
      };
    }),
    totalTokens: aiGroup.totalTokens,
    groupIndex: aiGroup.groupIndex,
    name: aiGroup.name,
    description: aiGroup.description,
    reasoning: `AI-powered logical grouping based on code structure and interdependencies. ${aiGroup.description}`,
    customPrompt: `You are a Senior Codebase Analyst. This group "${aiGroup.name}" contains files that are logically related: ${aiGroup.description}. Focus on analyzing these files together and summarize the architecture, then answer the user question precisely.`,
    // Include metadata for analyze step
    metadata: aiGroup.metadata,
  }));

  return JSON.stringify({
    groups,
    totalFiles,
    totalTokens,
    projectPath,
    analysisMode,
    maxTokensPerGroup,
  });
}

/**
 * Core logic for creating AI-powered file groups.
 * Extracts metadata from all files and uses Gemini AI to create logically coherent groups.
 */
export async function projectOrchestratorCreateLogic(
  params: ProjectOrchestratorCreateInput,
  context: RequestContext,
): Promise<ProjectOrchestratorCreateResponse> {
  // Validate and normalize project path
  const sanitized = sanitization.sanitizePath(params.projectPath, {
    rootDir: process.cwd(),
    allowAbsolute: true,
  });
  const normalizedPath = path.resolve(process.cwd(), sanitized.sanitizedPath);
  const stats = await fs.stat(normalizedPath).catch((e) => {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Invalid project path: ${normalizedPath}`,
      { cause: e },
    );
  });
  if (!stats.isDirectory())
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      `Project path is not a directory: ${normalizedPath}`,
    );

  logger.info("Starting project orchestrator create", {
    ...context,
    projectPath: normalizedPath,
    analysisMode: params.analysisMode,
  });

  const ig = await createIgnoreInstance({
    projectPath: normalizedPath,
    temporaryIgnore: params.temporaryIgnore,
    ignoreMcpignore: params.ignoreMcpignore,
    context,
  });

  // Discover all files
  const allFiles = await glob("**/*", {
    cwd: normalizedPath,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });

  // Filter files using ignore instance
  const files = allFiles.filter((f) => !ig.ignores(f));

  logger.info("Discovered files", {
    ...context,
    fileCount: files.length,
  });

  // Extract metadata from all files in parallel
  const metadataPromises = files.map(async (file) => {
    try {
      const filePath = path.join(normalizedPath, file);
      const content = await fs.readFile(filePath, "utf-8");
      const metadata = await extractMetadata(file, content, context);
      return metadata;
    } catch (error) {
      // Log and skip unreadable files
      logger.debug("Skipping unreadable file", {
        ...context,
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });

  const metadataResults = await Promise.all(metadataPromises);
  const metadata: FileMetadata[] = metadataResults.filter(
    (m): m is FileMetadata => m !== null,
  );

  if (metadata.length === 0) {
    throw new McpError(
      BaseErrorCode.INVALID_INPUT,
      "No readable files found in project directory",
    );
  }

  logger.info("Extracted metadata from files", {
    ...context,
    metadataCount: metadata.length,
    skippedFiles: files.length - metadata.length,
  });

  // Calculate total project tokens
  const totalProjectTokens = metadata.reduce(
    (sum, m) => sum + m.estimatedTokens,
    0,
  );

  // Use AI to group files
  const maxPerGroup = params.maxTokensPerGroup ?? 900000;
  logger.info("Starting AI-powered grouping", {
    ...context,
    maxTokensPerGroup: maxPerGroup,
    totalProjectTokens,
  });

  const aiGroups = await groupFilesWithAI(
    metadata,
    maxPerGroup,
    context,
    params.geminiApiKey,
    params.question,
  );

  // Convert to format expected by analyze step
  const groupsData = convertGroupsToAnalyzeFormat(
    aiGroups,
    metadata.length,
    totalProjectTokens,
    normalizedPath,
    params.analysisMode || "general",
    maxPerGroup,
  );

  logger.info("Project orchestrator (create) completed", {
    ...context,
    groups: aiGroups.length,
    totalFiles: metadata.length,
    totalTokens: totalProjectTokens,
  });

  return { groupsData };
}
