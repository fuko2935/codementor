/**
 * @fileoverview Project Bootstrap tool logic - Generates AI client configuration files
 * with MCP usage guide, project-specific rules, and context control documentation.
 * @module src/mcp-server/tools/projectBootstrap/logic
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { z } from "zod";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";
import { logger, type RequestContext } from "../../../utils/index.js";
import {
  CLIENT_PROFILES,
  type ClientName,
  getAllClientNames,
} from "../../../config/clientProfiles.js";
import { validateSecurePath } from "../../utils/securePathValidator.js";
import {
  MCP_CODEMENTOR_START_MARKER as MCP_BLOCK_START_MARKER,
  MCP_CODEMENTOR_END_MARKER as MCP_BLOCK_END_MARKER,
  MCP_CONTENT_START_MARKER as LEGACY_BLOCK_START_MARKER,
  MCP_CONTENT_END_MARKER as LEGACY_BLOCK_END_MARKER,
  refreshMcpConfigCache,
} from "../../utils/mcpConfigValidator.js";

import yaml from "js-yaml";
// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema for project-specific rules (minimal but extensible)
export const ProjectRulesSchema = z
  .object({
    openSourceStatus: z
      .enum(["proprietary", "open-source", "source-available"])
      .optional()
      .describe(
        "Project openness level. Use 'proprietary' for closed/internal projects.",
      ),
    distributionModel: z
      .enum(["saas", "on-premise", "library", "cli-tool", "desktop-app"])
      .optional()
      .describe("Primary distribution model for this project."),
    targetAudience: z
      .string()
      .optional()
      .describe(
        "Intended audience (e.g., 'internal-developers', 'end-users', 'enterprise').",
      ),
    licenseConstraints: z
      .array(z.string())
      .optional()
      .describe(
        "License constraints for dependencies (e.g., 'No GPL', 'MIT/Apache-2.0 only').",
      ),
    packageConstraints: z
      .array(z.string())
      .optional()
      .describe(
        "Package/dependency constraints (e.g., 'only official registry', 'no beta deps').",
      ),
    deploymentNotes: z
      .string()
      .optional()
      .describe(
        "Short notes about deployment context (e.g., 'internal only', 'no external data sharing').",
      ),
  })
  .strict()
  .optional();

/**
 * Helper functions for idempotent project bootstrap (Architect plan Adım 1)
 */

/**
 * Safely loads and validates a YAML string against the ProjectRulesSchema.
 * Note: Uses `js-yaml`'s `load()` function, which is safe by default and does not
 * execute arbitrary code, unlike some other YAML parsers.
 */
export function loadAndValidateProjectRules(
  yamlStr: string,
  context?: RequestContext
): z.infer<typeof ProjectRulesSchema> | null {
  try {
    const parsed = yaml.load(yamlStr);
    const result = ProjectRulesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    } else {
      if (context) {
        logger.warning("[loadAndValidateProjectRules] Schema validation failed", {
          ...context,
          validationErrors: result.error.format(),
        });
      }
      return null;
    }
  } catch (error) {
    if (context) {
      logger.warning("[loadAndValidateProjectRules] YAML parse error", {
        ...context,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

/**
 * Extract managed block between custom markers with line positions.
 * Supports both new (CODEMENTOR) and legacy (GEMINI-MCP-LOCAL) markers.
 */
export function extractManagedBlock(content: string): { block: string; startLine: number; endLine: number } | null {
  const lines = content.split(/\r?\n/);

  // Try new markers first
  let startIdx = lines.findIndex((line) => line.trim() === MCP_BLOCK_START_MARKER);
  let endMarker = MCP_BLOCK_END_MARKER;

  // If not found, try legacy markers
  if (startIdx === -1) {
    startIdx = lines.findIndex((line) => line.trim() === LEGACY_BLOCK_START_MARKER);
    endMarker = LEGACY_BLOCK_END_MARKER;
  }

  if (startIdx === -1) return null;

  const endIdx = lines.slice(startIdx + 1).findIndex((line) => line.trim() === endMarker);
  if (endIdx === -1) return null;

  const fullEndIdx = startIdx + 1 + endIdx;
  const blockLines = lines.slice(startIdx + 1, fullEndIdx);
  const block = blockLines.join('\n');

  return {
    block,
    startLine: startIdx + 1, // 1-based
    endLine: fullEndIdx + 1,
  };
}

/**
 * Insert or replace managed block at position.
 */
export function insertManagedBlock(
  content: string,
  block: string,
  mode: 'replace' | 'append',
  pos?: number
): string {
  const newBlock = `${MCP_BLOCK_START_MARKER}\n${block}\n${MCP_BLOCK_END_MARKER}`;

  if (mode === 'replace') {
    const extracted = extractManagedBlock(content);
    if (!extracted) {
      // Fallback to append if no block found
      return insertManagedBlock(content, block, 'append');
    }

    const lines = content.split(/\r?\n/);
    const startIdx = extracted.startLine - 1;
    const endIdx = extracted.endLine - 1;
    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx + 1);
    const newLines = [...before, ...newBlock.split(/\r?\n/), ...after];
    return newLines.join('\n');
  } else {
    // append
    let insertIdx = content.length;
    if (pos !== undefined) {
      insertIdx = content.split(/\r?\n/).slice(0, pos).join('\n').length + (content.includes('\n') ? 1 : 0);
    }
    const before = content.slice(0, insertIdx);
    const after = content.slice(insertIdx);
    const sep = before.endsWith('\n') ? '\n' : '\n\n';
    return before + sep + newBlock + (after ? '\n' + after : '');
  }
}

/**
 * Load the master MCP guide template.
 * Ignores the client parameter and always loads templates/mcp-guide.md.
 */
export async function loadClientTemplate(client: ClientName): Promise<string> {
  const baseDir = __dirname;
  // Always use the master template
  const mcpPath = path.join(baseDir, './templates', 'mcp-guide.md');

  try {
    return (await fs.readFile(mcpPath, 'utf-8')).trimEnd();
  } catch (error) {
    // If master template is missing, this is a critical error
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Critical: Master MCP guide template not found at ${mcpPath}`,
      { path: mcpPath }
    );
  }
}
export const ProjectBootstrapInputSchema = z.object({
  client: z
    .enum(getAllClientNames() as [ClientName, ...ClientName[]])
    .describe(
      `AI client name. Choose from: ${getAllClientNames().join(", ")}`,
    ),
  projectPath: z
    .string()
    .min(1)
    .default(".")
    .describe(
      "Project directory path where the configuration file will be created. Defaults to current directory ('.').",
    ),
  projectRules: ProjectRulesSchema.describe(
    "Optional project-specific rules and constraints to embed into the MCP guide.",
  ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, overwrites the existing MCP content section even if unchanged.",
    ),
});

export type ProjectBootstrapInput = z.infer<typeof ProjectBootstrapInputSchema>;

export interface ProjectBootstrapResponse {
  success: boolean;
  message: string;
  actions: Array<{ type: "created" | "updated" | "skipped" | "exists"; file: string; details?: string }>;
  summary: string;
}

// Placeholder used in the template for injecting project rules YAML.
const PROJECT_RULES_PLACEHOLDER = "{{rules}}";

/**
 * Generate the base MCP guide content from template.
 * This is the canonical AI-facing guide injected into client config files.
 */
async function generateMcpGuideContent(
  client: ClientName,
  context: RequestContext,
): Promise<string> {
  const template = await loadClientTemplate(client);
  if (!template) {
    logger.warning(`[projectBootstrap] Client-specific template not found for ${client}, falling back to empty`, {
      ...context,
    });
    return "";
  }
  return template.trimEnd();
}

/**
 * Render project rules into a YAML-like block using the project-rules template.
 * If no rules are provided, emits a conservative default block.
 */
interface ProjectRulesBlock {
  rendered: string;
  yaml: string;
  hash: string;
}

async function generateProjectRulesBlock(
  rules: z.infer<typeof ProjectRulesSchema>,
  context: RequestContext,
): Promise<ProjectRulesBlock> {
  const templatePath = path.join(__dirname, "templates", "project-rules.md");
  let template: string;
  try {
    template = await fs.readFile(templatePath, "utf-8");
  } catch (error) {
    logger.error("Project rules template file not found - critical error", {
      ...context,
      templatePath,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      [
        "CRITICAL: The project rules template file is missing. This indicates a build or packaging issue.",
        "Expected location:",
        `  ${templatePath}`,
      ].join("\n"),
      { templatePath },
    );
  }

  const yamlLines: string[] = [];

  if (rules && Object.keys(rules).length > 0) {
    if (rules.openSourceStatus) {
      yamlLines.push(
        `openSourceStatus: ${rules.openSourceStatus}`,
      );
    }
    if (rules.distributionModel) {
      yamlLines.push(
        `distributionModel: ${rules.distributionModel}`,
      );
    }
    if (rules.targetAudience) {
      yamlLines.push(`targetAudience: ${JSON.stringify(rules.targetAudience)}`);
    }
    if (rules.licenseConstraints && rules.licenseConstraints.length > 0) {
      yamlLines.push("licenseConstraints:");
      for (const item of rules.licenseConstraints) {
        yamlLines.push(`  - ${JSON.stringify(item)}`);
      }
    }
    if (rules.packageConstraints && rules.packageConstraints.length > 0) {
      yamlLines.push("packageConstraints:");
      for (const item of rules.packageConstraints) {
        yamlLines.push(`  - ${JSON.stringify(item)}`);
      }
    }
    if (rules.deploymentNotes) {
      yamlLines.push("deploymentNotes: |");
      yamlLines.push(
        ...rules.deploymentNotes
          .split("\n")
          .map((line) => `  ${line.trimEnd()}`),
      );
    }
  } else {
    // Conservative defaults when no explicit rules are provided
    yamlLines.push("# No explicit projectRules provided.");
    yamlLines.push(
      "# Default assumptions (edit via project_bootstrap.projectRules to override):",
    );
    yamlLines.push('openSourceStatus: proprietary');
    yamlLines.push('distributionModel: saas');
    yamlLines.push('targetAudience: "internal-developers"');
    yamlLines.push("licenseConstraints:");
    yamlLines.push('  - "Avoid copyleft licenses (e.g., GPL, AGPL) unless explicitly approved."');
    yamlLines.push("packageConstraints:");
    yamlLines.push(
      '  - "Do not add new runtime dependencies without strong justification."',
    );
    yamlLines.push("deploymentNotes: |");
    yamlLines.push(
      "  Treat this project as security-sensitive and internal by default.",
    );
    yamlLines.push(
      "  Do not assume public deployment or data sharing unless rules explicitly allow it.",
    );
  }

  const yamlStr = yamlLines.join("\n");

  const validatedRules = loadAndValidateProjectRules(yamlStr, context);
  if (!validatedRules) {
    logger.warning("[generateProjectRulesBlock] Generated YAML failed schema validation", {
      ...context,
    });
  }

  const hash = crypto.createHash("md5").update(yamlStr).digest("hex");

  const rendered = template.replace(PROJECT_RULES_PLACEHOLDER, yamlStr);

  return {
    rendered: rendered.trimEnd(),
    yaml: yamlStr,
    hash,
  };
}

/**
 * Compute the target config file path for the given client and project.
 */
function getTargetFilePath(
  client: ClientName,
  normalizedProjectPath: string,
): { targetDir: string; filePath: string } {
  const profile = CLIENT_PROFILES[client];
  const targetDir = profile.directory
    ? path.join(normalizedProjectPath, profile.directory)
    : normalizedProjectPath;
  const filePath = path.join(targetDir, profile.file);
  return { targetDir, filePath };
}

async function updateConfigCache(
  normalizedPath: string,
  filePath: string,
  client: ClientName,
  context: RequestContext,
): Promise<void> {
  const entry = { exists: true, filePath, client } as const;

  try {
    // Delegate to centralized cache in mcpConfigValidator
    await refreshMcpConfigCache(normalizedPath, entry);
  } catch (error) {
    logger.warning("Failed to refresh global MCP config validator cache", {
      tool: "project_bootstrap",
      action: "refresh_config_cache",
      normalizedPath,
      filePath,
      client,
      error: error instanceof Error ? error.message : String(error),
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    } as RequestContext);
  }
}

/**
 * Ensures the .gitignore file exists and contains an entry for the MCP cache directory.
 * This function is idempotent and safe to call multiple times.
 *
 * @param normalizedPath The validated, absolute path to the project directory.
 * @param context The request context for logging.
 * @returns A promise that resolves with an object indicating the action taken.
 */
async function ensureGitignoreHasMcpCache(
  normalizedPath: string,
  context: RequestContext,
): Promise<{ type: "created" | "updated" | "exists"; file: string }> {
  const gitignorePath = path.join(normalizedPath, ".gitignore");
  const mcpCacheEntry = ".mcp/cache/";

  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const hasEntry = lines.some((line) => line.trim() === mcpCacheEntry);

    if (hasEntry) {
      logger.debug(".gitignore already contains .mcp/cache/ entry", { ...context });
      return { type: "exists", file: ".gitignore" };
    } else {
      // Append the entry to the existing file
      const contentToAppend = (content.trim().length > 0 && !content.endsWith("\n") ? "\n" : "") + mcpCacheEntry + "\n";
      await fs.appendFile(gitignorePath, contentToAppend, "utf-8");
      logger.info("Appended .mcp/cache/ to .gitignore", { ...context });
      return { type: "updated", file: ".gitignore" };
    }
  } catch (error) {
    // If the file doesn't exist, create it
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      await fs.writeFile(gitignorePath, mcpCacheEntry + "\n", "utf-8");
      logger.info("Created .gitignore with .mcp/cache/ entry", { ...context });
      return { type: "created", file: ".gitignore" };
    }
    // For any other read/write error, re-throw it
    throw error;
  }
}

/**
 * Core logic for the project_bootstrap tool.
 */
export async function projectBootstrapLogic(
  params: ProjectBootstrapInput,
  context: RequestContext,
): Promise<ProjectBootstrapResponse> {
  const validated = ProjectBootstrapInputSchema.parse(params);

  const normalizedPath = await validateSecurePath(
    validated.projectPath,
    process.cwd(),
    context,
  );

  const actions: Array<{ type: "created" | "updated" | "skipped" | "exists"; file: string; details?: string }> = [];

  // Manage .gitignore for MCP cache
  const gitignoreAction = await ensureGitignoreHasMcpCache(normalizedPath, context);
  actions.push(gitignoreAction);

  // Manage .mcpignore file (FR-2)
  const mcpignorePath = path.join(normalizedPath, ".mcpignore");
  try {
    await fs.access(mcpignorePath);
    actions.push({ type: "exists", file: ".mcpignore" });
  } catch {
    const examplePath = path.join(normalizedPath, ".mcpignore.example");
    let createdFrom = "";
    try {
      await fs.access(examplePath);
      await fs.copyFile(examplePath, mcpignorePath);
      createdFrom = "copied from .mcpignore.example";
    } catch {
      const defaultContent = `# Default .mcpignore patterns for MCP tools
node_modules/
dist/
build/
*.log
.env*
.DS_Store
.vscode/settings.json
!.mcpignore.example`;
      await fs.writeFile(mcpignorePath, defaultContent, "utf-8");
      createdFrom = "default created";
    }
    actions.push({ type: "created", file: ".mcpignore", details: createdFrom });
  }

  // Effective rules: param > CODEMENTOR.md frontmatter YAML > default
  let effectiveRules = validated.projectRules;
  if (!effectiveRules) {
    const codementorPath = path.join(normalizedPath, "CODEMENTOR.md");
    try {
      const codementorContent = await fs.readFile(codementorPath, "utf-8");
      const frontmatterMatch = codementorContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
      if (frontmatterMatch) {
        const yamlStr = frontmatterMatch[1];
        const parsedRules = loadAndValidateProjectRules(yamlStr, context);
        if (parsedRules) {
          effectiveRules = parsedRules;
        }
      }
    } catch (err) {
      logger.warning("[projectBootstrapLogic] CODEMENTOR.md YAML parse failed (warn+continue)", {
        ...context,
        codementorPath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { targetDir, filePath } = getTargetFilePath(validated.client, normalizedPath);

  // SECURITY: Validate final paths to prevent path traversal via malicious client profiles
  const validatedTargetDir = await validateSecurePath(targetDir, process.cwd(), context);
  const validatedFilePath = path.join(validatedTargetDir, path.basename(filePath));

  await fs.mkdir(validatedTargetDir, { recursive: true });

  logger.info("Running project_bootstrap", {
    ...context,
    client: validated.client,
    projectPath: normalizedPath,
    targetDir: validatedTargetDir,
    filePath: validatedFilePath,
  });

  const rulesBlockResult = await generateProjectRulesBlock(effectiveRules || {}, context);
  const guideTemplate = await generateMcpGuideContent(validated.client, context);
  const innerBlock = guideTemplate.replace(/\{\{rules\}\}/g, rulesBlockResult.rendered).trimEnd();

  const newHash = crypto.createHash("md5").update(innerBlock).digest("hex");

  let existingContent = "";
  let fileExists = false;
  let extracted = null;
  let currentHash = "";

  try {
    existingContent = await fs.readFile(validatedFilePath, "utf-8");
    fileExists = true;
    extracted = extractManagedBlock(existingContent);
    if (extracted) {
      currentHash = crypto.createHash("md5").update(extracted.block).digest("hex");
    }
  } catch { }

  let targetAction: { type: "created" | "updated" | "skipped" | "exists"; file: string; details?: string };
  let newContent: string;

  if (fileExists && extracted && currentHash === newHash && !validated.force) {
    targetAction = { type: "skipped", file: path.basename(validatedFilePath), details: "content hash match" };
  } else {
    const baseContent = fileExists ? existingContent : `# ${validated.client.toUpperCase()} Configuration\n\n`;
    newContent = insertManagedBlock(baseContent, innerBlock, extracted ? "replace" : "append");
    await fs.writeFile(validatedFilePath, newContent, "utf-8");
    targetAction = { type: fileExists ? "updated" : "created", file: path.basename(validatedFilePath) };
  }

  actions.push(targetAction);

  try {
    await updateConfigCache(normalizedPath, validatedFilePath, validated.client, context);
  } catch (err) {
    logger.warning("[projectBootstrapLogic] Cache update failed (warn+continue)", {
      ...context,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const summary = "Idempotent bootstrap complete. Verified .mcpignore and updated client configuration file with the latest MCP guide.";
  const message = `Success: ${actions.map((a) => `${a.type} ${a.file}${a.details ? ` (${a.details})` : ""}`).join(", ")}`;

  return { success: true, message, actions, summary };
}
