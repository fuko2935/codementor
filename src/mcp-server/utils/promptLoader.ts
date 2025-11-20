import { promises as fs } from "fs";
import path from "path";
import { BASE_DIR } from "../../index.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import { logger, type RequestContext } from "../../utils/index.js";
import { environment } from "../../config/index.js";

type TemplateData = Record<string, string>;

interface ResolvedPath {
  cacheKey: string;
  filePath: string;
  isCustom: boolean;
  modeName?: string;
}

export class PromptLoader {
  private static instance: PromptLoader;
  private cache = new Map<string, string>();
  private readonly isDevelopment = environment !== "production";

  private constructor() {}

  static getInstance(): PromptLoader {
    if (!PromptLoader.instance) {
      PromptLoader.instance = new PromptLoader();
    }
    return PromptLoader.instance;
  }

  async getPrompt(
    mode: string,
    projectPath?: string,
    templateData: TemplateData = {},
    context?: RequestContext,
  ): Promise<string> {
    const { cacheKey, filePath, isCustom, modeName } = this.resolvePath(
      mode,
      projectPath,
    );

    // In development, skip cache to allow hot-reloading of prompt files
    if (this.cache.has(cacheKey) && !this.isDevelopment) {
      const cached = this.cache.get(cacheKey) ?? "";
      return this.applyTemplate(cached, templateData);
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
      if (!content.trim()) {
        throw new Error("Prompt file is empty");
      }
    } catch (error) {
      if (isCustom) {
        const details = {
          requestedMode: mode,
          attemptedPath: filePath,
          projectPath: projectPath ? path.resolve(projectPath) : undefined,
          originalError:
            error instanceof Error ? error.message : String(error),
        };
        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          `Custom analysis mode "${modeName ?? mode}" not found. Create the prompt at ${filePath}`,
          details,
        );
      }

      const fallback = this.resolvePath("general", projectPath);
      const warningContext = context
        ? { ...context, requestedMode: mode, attemptedPath: filePath }
        : undefined;
      try {
        content = await fs.readFile(fallback.filePath, "utf-8");
        logger.warning("PromptLoader fallback to general mode prompt", warningContext);
      } catch (fallbackError) {
        const errorContext = context
          ? {
              ...context,
              requestedMode: mode,
              attemptedPath: filePath,
              fallbackPath: fallback.filePath,
            }
          : undefined;
        logger.error(
          "PromptLoader failed to load prompt content",
          fallbackError instanceof Error
            ? fallbackError
            : new Error(String(fallbackError)),
          errorContext,
        );
        throw fallbackError;
      }
    }

    // Only cache in production for performance
    if (!this.isDevelopment) {
      this.cache.set(cacheKey, content);
    }
    return this.applyTemplate(content, templateData);
  }

  private resolvePath(mode: string, projectPath?: string): ResolvedPath {
    if (mode.startsWith("custom:")) {
      const name = mode.substring("custom:".length);
      const resolvedProjectPath = path.resolve(projectPath ?? BASE_DIR);
      return {
        cacheKey: `custom:${resolvedProjectPath}:${name}`,
        filePath: path.join(
          resolvedProjectPath,
          ".mcp",
          "analysis_modes",
          `${name}.md`,
        ),
        isCustom: true,
        modeName: name,
      };
    }

    return {
      cacheKey: mode,
      filePath: path.join(BASE_DIR, "analysis_modes", `${mode}.md`),
      isCustom: false,
    };
  }

  private applyTemplate(content: string, data: TemplateData): string {
    return Object.entries(data).reduce<string>((acc, [key, value]) => {
      const placeholder = `{{${key}}}`;
      return acc.split(placeholder).join(value);
    }, content);
  }
}
