/**
 * @fileoverview Project Bootstrap tool logic - Generates AI client configuration files
 * with MCP usage guide, project-specific rules, and context control documentation.
 * @module src/mcp-server/tools/projectBootstrap/logic
 */

import { promises as fs } from "fs";
import path from "path";
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
  MCP_CONTENT_START_MARKER,
  MCP_CONTENT_END_MARKER,
  refreshMcpConfigCache,
} from "../../utils/mcpConfigValidator.js";

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
  filePath: string;
  action: "created" | "updated" | "skipped";
}

// Placeholder used in the template for injecting project rules YAML.
const PROJECT_RULES_PLACEHOLDER = "{{PROJECT_RULES_YAML}}";

/**
 * Generate the base MCP guide content from template.
 * This is the canonical AI-facing guide injected into client config files.
 */
async function generateMcpGuideContent(
  context: RequestContext,
): Promise<string> {
  const templatePath = path.join(__dirname, "templates", "mcp-guide.md");
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return content.trimEnd();
  } catch (error) {
    logger.error("MCP guide template file not found - critical error", {
      ...context,
      templatePath,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      [
        "CRITICAL: The MCP guide template file is missing. This indicates a build or packaging issue.",
        "Expected location:",
        `  ${templatePath}`,
      ].join("\n"),
      { templatePath },
    );
  }
}

/**
 * Render project rules into a YAML-like block using the project-rules template.
 * If no rules are provided, emits a conservative default block.
 */
interface ProjectRulesBlock {
  rendered: string;
  yaml: string;
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

  const yaml = yamlLines.join("\n");
  const rendered = template.replace(PROJECT_RULES_PLACEHOLDER, yaml);

  return {
    rendered: rendered.trimEnd(),
    yaml,
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
    refreshMcpConfigCache(normalizedPath, entry);
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
 * Core logic for the project_bootstrap tool.
 */
export async function projectBootstrapLogic(
  params: ProjectBootstrapInput,
  context: RequestContext,
): Promise<ProjectBootstrapResponse> {
  const validated = ProjectBootstrapInputSchema.parse(params);

  // SECURITY: Validate and normalize path to prevent path traversal attacks
  const normalizedPath = await validateSecurePath(
    validated.projectPath,
    process.cwd(),
    context,
  );

  const { targetDir, filePath } = getTargetFilePath(
    validated.client,
    normalizedPath,
  );

  logger.info("Running project_bootstrap", {
    ...context,
    client: validated.client,
    projectPath: normalizedPath,
    targetDir,
    filePath,
  });

  // Ensure directory exists
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (error) {
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to create directory: ${targetDir}`,
      { cause: error },
    );
  }

  const guideContent = await generateMcpGuideContent(context);
  const { rendered: rulesBlock, yaml: rulesYaml } =
    await generateProjectRulesBlock(
      validated.projectRules,
      context,
    );

  const combinedContent = guideContent.includes(PROJECT_RULES_PLACEHOLDER)
    ? guideContent.replace(PROJECT_RULES_PLACEHOLDER, rulesYaml)
    : `${guideContent}\n\n${rulesBlock}`;
  const wrappedContent = `${MCP_CONTENT_START_MARKER}\n${combinedContent}\n${MCP_CONTENT_END_MARKER}\n`;

  let existingContent = "";
  let fileExists = false;

  try {
    existingContent = await fs.readFile(filePath, "utf-8");
    fileExists = true;
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    // New file with MCP configuration
    const newContent = `# AI Assistant Configuration\n\n${wrappedContent}`;
    await fs.writeFile(filePath, newContent, "utf-8");
    logger.info("Created new bootstrap config file", {
      ...context,
      filePath,
    });

    await updateConfigCache(normalizedPath, filePath, validated.client, context);

    return {
      success: true,
      message: `Successfully created ${path.basename(
        filePath,
      )} with MCP bootstrap configuration`,
      filePath,
      action: "created",
    };
  }

  // Existing file: update or append MCP block
  const escapedStart = MCP_CONTENT_START_MARKER.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const escapedEnd = MCP_CONTENT_END_MARKER.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const mcpBlockRegex = new RegExp(
    `${escapedStart}[\\s\\S]*?${escapedEnd}(?:\\r?\\n)?`,
    "s",
  );

  let newContent: string;
  const action: ProjectBootstrapResponse["action"] = "updated";

  if (mcpBlockRegex.test(existingContent)) {
    // Replace existing managed block
    newContent = existingContent.replace(mcpBlockRegex, wrappedContent);
  } else {
    // Append a new managed block
    const sep = existingContent.endsWith("\n") ? "\n" : "\n\n";
    newContent = `${existingContent}${sep}${wrappedContent}`;
  }

  if (!validated.force && newContent === existingContent) {
    logger.info("MCP bootstrap content already up to date", {
      ...context,
      filePath,
    });

    await updateConfigCache(
      normalizedPath,
      filePath,
      validated.client,
      context,
    );

    return {
      success: true,
      message: `MCP bootstrap configuration is already up to date in ${path.basename(
        filePath,
      )}`,
      filePath,
      action: "skipped",
    };
  }

  await fs.writeFile(filePath, newContent, "utf-8");
  logger.info("Updated MCP bootstrap content", {
    ...context,
    filePath,
  });

  await updateConfigCache(normalizedPath, filePath, validated.client, context);

  return {
    success: true,
    message: `Successfully updated MCP bootstrap configuration in ${path.basename(
      filePath,
    )}`,
    filePath,
    action,
  };
}
