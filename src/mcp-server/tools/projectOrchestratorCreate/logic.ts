import { promises as fs } from "fs";
import path from "path";
import { glob } from "glob";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext, sanitization } from "../../../utils/index.js";

export const ProjectOrchestratorCreateInputSchema = z.object({
  projectPath: z.string().min(1),
  temporaryIgnore: z.array(z.string()).optional(),
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

function estimateTokens(content: string): number {
  // Simple heuristic sufficient for grouping (exact count not required)
  const basic = Math.ceil(content.length / 4);
  const newlines = (content.match(/\n/g) || []).length;
  const specials = (content.match(/[{}[\]();,.<>/\\=+\-*&|!@#$%^`~]/g) || [])
    .length;
  return basic + Math.ceil(newlines * 0.5) + Math.ceil(specials * 0.2);
}

export async function projectOrchestratorCreateLogic(
  params: ProjectOrchestratorCreateInput,
  context: RequestContext,
): Promise<ProjectOrchestratorCreateResponse> {
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

  // Load files
  let gitignoreRules: string[] = [];
  try {
    const gitignorePath = path.join(normalizedPath, ".gitignore");
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    gitignoreRules = gitignoreContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    // no-op
  }

  const ignorePatterns = [
    ...gitignoreRules,
    ...(params.temporaryIgnore || []),
    "node_modules/**",
    ".git/**",
    "*.log",
    ".env*",
    "dist/**",
    "build/**",
    "*.map",
    "*.lock",
    ".cache/**",
    "coverage/**",
    "logs/**",
  ];
  const files = await glob("**/*", {
    cwd: normalizedPath,
    ignore: ignorePatterns,
    nodir: true,
    dot: true, // Include dotfiles (e.g., .roomodes, .roo/)
  });

  const fileInfos: Array<{
    filePath: string;
    tokens: number;
    content: string;
  }> = [];
  let totalProjectTokens = 0;
  for (const file of files) {
    try {
      const p = path.join(normalizedPath, file);
      const c = await fs.readFile(p, "utf-8");
      const t = estimateTokens(c);
      totalProjectTokens += t;
      fileInfos.push({ filePath: file, tokens: t, content: c });
    } catch {
      // no-op
    }
  }

  // Greedy grouping by size
  const maxPerGroup = params.maxTokensPerGroup ?? 900000;
  const sorted = [...fileInfos].sort((a, b) => b.tokens - a.tokens);
  const groups: Array<{
    files: Array<{ filePath: string; tokens: number }>;
    totalTokens: number;
    groupIndex: number;
    name?: string;
    description?: string;
    reasoning?: string;
    customPrompt?: string;
  }> = [];
  let groupIndex = 0;
  let current: (typeof groups)[number] = {
    files: [],
    totalTokens: 0,
    groupIndex,
  };
  for (const f of sorted) {
    if (
      current.totalTokens + f.tokens > maxPerGroup &&
      current.files.length > 0
    ) {
      groups.push(current);
      groupIndex += 1;
      current = { files: [], totalTokens: 0, groupIndex };
    }
    current.files.push({ filePath: f.filePath, tokens: f.tokens });
    current.totalTokens += f.tokens;
  }
  if (current.files.length > 0) groups.push(current);

  // Annotate minimal prompts per group (simple blueprint)
  for (const g of groups) {
    g.name = `Group ${g.groupIndex + 1}`;
    g.description = "Automatically grouped files by estimated token size.";
    g.reasoning = "Greedy grouping to stay within token limits.";
    g.customPrompt =
      "You are a Senior Codebase Analyst. Focus only on the files listed for this group; summarize architecture and answer the user question precisely.";
  }

  const groupsData = JSON.stringify({
    groups,
    totalFiles: fileInfos.length,
    totalTokens: totalProjectTokens,
    projectPath: normalizedPath,
    analysisMode: params.analysisMode,
    maxTokensPerGroup: maxPerGroup,
  });

  logger.info("Project orchestrator (create) built groups", {
    ...context,
    groups: groups.length,
    totalFiles: fileInfos.length,
  });
  return { groupsData };
}
