/**
 * @fileoverview Loads, validates, and exports application configuration.
 * This module centralizes configuration management, sourcing values from
 * environment variables and `package.json`. It uses Zod for schema validation
 * to ensure type safety and correctness of configuration parameters.
 *
 * Key responsibilities:
 * - Load environment variables from a `.env` file.
 * - Read `package.json` for default server name and version.
 * - Define a Zod schema for all expected environment variables.
 * - Validate environment variables against the schema.
 * - Construct and export a comprehensive `config` object.
 * - Export individual configuration values like `logLevel` and `environment` for convenience.
 *
 * @module src/config/index
 */

import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

dotenv.config();

// --- Determine Project Root ---
/**
 * Finds the project root directory by searching upwards for package.json.
 * @param startDir The directory to start searching from.
 * @returns The absolute path to the project root, or throws an error if not found.
 */
const findProjectRoot = (startDir: string): string => {
  let currentDir = startDir;
  while (true) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached the root of the filesystem without finding package.json
      throw new Error(
        `Could not find project root (package.json) starting from ${startDir}`,
      );
    }
    currentDir = parentDir;
  }
};

let projectRoot: string;
try {
  // For ESM, __dirname is not available directly.
  // import.meta.url gives the URL of the current module.
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  projectRoot = findProjectRoot(currentModuleDir);
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `FATAL: Error determining project root: ${errorMessage}\n`,
  );
  // Fallback to process.cwd() if project root cannot be determined.
  // This might happen in unusual execution environments.
  projectRoot = process.cwd();
  process.stderr.write(
    `Warning: Using process.cwd() (${projectRoot}) as fallback project root.\n`,
  );
}
// --- End Determine Project Root ---

const pkgPath = join(projectRoot, "package.json"); // Use determined projectRoot
let pkg = { name: "mcp-ts-template", version: "0.0.0" };

try {
  pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
} catch (error) {
  // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
  if (process.stdout.isTTY) {
    process.stderr.write(
      `Warning: Could not read package.json for default config values. Using hardcoded defaults. Error: ${error}\n`,
    );
  }
}

/**
 * Zod schema for validating environment variables.
 * Provides type safety, validation, defaults, and clear error messages.
 * @private
 */
const EnvSchema = z.object({
  /** Optional. The desired name for the MCP server. Defaults to `package.json` name. */
  MCP_SERVER_NAME: z.string().optional(),
  /** Optional. The version of the MCP server. Defaults to `package.json` version. */
  MCP_SERVER_VERSION: z.string().optional(),
  /** Minimum logging level. See `McpLogLevel` in logger utility. Default: "debug". */
  MCP_LOG_LEVEL: z
    .enum([
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "crit",
      "alert",
      "emerg",
    ])
    .default("debug"),
  /** Directory for log files. Defaults to "logs" in project root. */
  LOGS_DIR: z.string().default(path.join(projectRoot, "logs")),
  /** Runtime environment (e.g., "development", "production"). Default: "development". */
  NODE_ENV: z.string().default("development"),
  /** MCP communication transport ("stdio" or "http"). Default: "stdio". */
  MCP_TRANSPORT_TYPE: z.enum(["stdio", "http"]).default("stdio"),
  /** HTTP server port (if MCP_TRANSPORT_TYPE is "http"). Default: 3010. */
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3010),
  /** HTTP server host (if MCP_TRANSPORT_TYPE is "http"). Default: "127.0.0.1". */
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  /** Session store type for HTTP transport. Default: "memory". Options: "memory", "redis". */
  MCP_SESSION_STORE: z.enum(["memory", "redis"]).default("memory"),
  /** Redis connection URL for session coordination (e.g., redis://localhost:6379). */
  REDIS_URL: z.string().optional(),
  /** Redis key prefix for session ownership records. Default: "mcp:sessions:". */
  REDIS_PREFIX: z.string().optional(),
  /** Optional. Comma-separated allowed origins for CORS (HTTP transport). */
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  /** Optional. API key for HTTP transport authentication. If set, all HTTP requests must include this key. */
  MCP_API_KEY: z.string().optional(),

  /** Optional. Application URL for OpenRouter integration. */
  OPENROUTER_APP_URL: z
    .string()
    .url("OPENROUTER_APP_URL must be a valid URL (e.g., http://localhost:3000)")
    .optional(),
  /** Optional. Application name for OpenRouter. Defaults to MCP_SERVER_NAME or package name. */
  OPENROUTER_APP_NAME: z.string().optional(),
  /** Optional. API key for OpenRouter services. */
  OPENROUTER_API_KEY: z.string().optional(),
  /** Optional. API key for Google Gemini services. */
  GEMINI_API_KEY: z.string().optional(),
  /** Optional. API key for Proxy provider. */
  PROXY_API_KEY: z.string().optional(),
  /** Optional. Base URL for Proxy provider. Default: "http://localhost:2048/v1". */
  PROXY_BASE_URL: z.string().default("http://localhost:2048/v1"),
  /** Optional. Model ID for Proxy provider. Default: "gemini-3-pro-preview". */
  PROXY_MODEL_ID: z.string().default("gemini-3-pro-preview"),
  /** Default LLM provider. Default: "gemini-cli". */
  LLM_DEFAULT_PROVIDER: z
    .enum([
      "gemini",
      "google",
      "gemini-cli",
      "openai",
      "anthropic",
      "perplexity",
      "mistral",
      "groq",
      "openrouter",
      "xai",
      "azureOpenAI",
      "ollama",
      "proxy",
    ])
    .default("gemini-cli"),
  /** Default LLM model. Default: "gemini-2.5-pro". */
  LLM_DEFAULT_MODEL: z.string().default("gemini-2.5-pro"),
  /** Optional. Default LLM temperature (0.0-2.0). */
  LLM_DEFAULT_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  /** Optional. Default LLM top_p (0.0-1.0). */
  LLM_DEFAULT_TOP_P: z.coerce.number().min(0).max(1).optional(),
  /** Optional. Default LLM max tokens (positive integer). */
  LLM_DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  /** Optional. Default LLM top_k (non-negative integer). */
  LLM_DEFAULT_TOP_K: z.coerce.number().int().nonnegative().optional(),
  /** Optional. Default LLM min_p (0.0-1.0). */
  LLM_DEFAULT_MIN_P: z.coerce.number().min(0).max(1).optional(),

  /** Optional. Google AI Studio API key. */
  GOOGLE_API_KEY: z.string().optional(),
  /** Optional. OpenAI API key. */
  OPENAI_API_KEY: z.string().optional(),
  /** Optional. Anthropic API key. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Optional. Perplexity API key. */
  PERPLEXITY_API_KEY: z.string().optional(),
  /** Optional. Mistral API key. */
  MISTRAL_API_KEY: z.string().optional(),
  /** Optional. Groq API key. */
  GROQ_API_KEY: z.string().optional(),
  /** Optional. XAI API key. */
  XAI_API_KEY: z.string().optional(),
  /** Optional. Azure OpenAI API key. */
  AZURE_OPENAI_API_KEY: z.string().optional(),
  /** Optional. Azure OpenAI endpoint. */
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  /** Optional. Azure OpenAI deployment name. */
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  /** Optional. Ollama API key for remote usage. */
  OLLAMA_API_KEY: z.string().optional(),
  /** Optional. Ollama host when targeting remote instances. */
  OLLAMA_HOST: z.string().optional(),
  /** Maximum allowed project tokens before rejecting LLM API calls. Default: 20,000,000 (20M). */
  MAX_PROJECT_TOKENS: z.coerce.number().int().positive().optional(),
  /** Maximum allowed git blob size in bytes for diff operations. Default: 4MB. Files exceeding this limit will be skipped. */
  MAX_GIT_BLOB_SIZE_BYTES: z.coerce.number().int().positive().optional(),
});

const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
  if (process.stdout.isTTY) {
    process.stderr.write(
      `❌ Invalid environment variables found: ${JSON.stringify(parsedEnv.error.flatten().fieldErrors)}\n`,
    );
  }
  // No special-casing for GEMINI_API_KEY; it is optional now. Throw generic error for other invalid vars.
  throw new Error(
    `Invalid environment variables: ${JSON.stringify(parsedEnv.error.flatten().fieldErrors)}`,
  );
}

const env = parsedEnv.data;

const providerApiKeys = {
  google: env.GOOGLE_API_KEY || env.GEMINI_API_KEY,
  gemini: env.GEMINI_API_KEY,
  "gemini-cli": undefined, // Uses OAuth, no API key
  openai: env.OPENAI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  perplexity: env.PERPLEXITY_API_KEY,
  mistral: env.MISTRAL_API_KEY,
  groq: env.GROQ_API_KEY,
  openrouter: env.OPENROUTER_API_KEY,
  xai: env.XAI_API_KEY,
  azureOpenAI: env.AZURE_OPENAI_API_KEY,
  ollama: env.OLLAMA_API_KEY,
  proxy: env.PROXY_API_KEY,
};

const providerOptions = {
  azureOpenAI: {
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
  },
  ollama: {
    host: env.OLLAMA_HOST,
  },
  proxy: {
    baseURL: env.PROXY_BASE_URL,
    modelId: env.PROXY_MODEL_ID,
  },
};

// --- Directory Ensurance Function ---
/**
 * Ensures a directory exists and is within the project root.
 * @param dirPath The desired path for the directory (can be relative or absolute).
 * @param rootDir The root directory of the project to contain the directory.
 * @param dirName The name of the directory type for logging (e.g., "logs").
 * @returns The validated, absolute path to the directory, or null if invalid.
 */
const ensureDirectory = (
  dirPath: string,
  rootDir: string,
  dirName: string,
): string | null => {
  const resolvedDirPath = path.isAbsolute(dirPath)
    ? dirPath
    : path.resolve(rootDir, dirPath);

  // Ensure the resolved path is within the project root boundary
  if (
    !resolvedDirPath.startsWith(rootDir + path.sep) &&
    resolvedDirPath !== rootDir
  ) {
    // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
    if (process.stdout.isTTY) {
      process.stderr.write(
        `Error: ${dirName} path "${dirPath}" resolves to "${resolvedDirPath}", which is outside the project boundary "${rootDir}".\n`,
      );
    }
    return null;
  }

  if (!existsSync(resolvedDirPath)) {
    try {
      mkdirSync(resolvedDirPath, { recursive: true });
      if (process.stdout.isTTY) {
        console.log(`Created ${dirName} directory: ${resolvedDirPath}`);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
      if (process.stdout.isTTY) {
        process.stderr.write(
          `Error creating ${dirName} directory at ${resolvedDirPath}: ${errorMessage}\n`,
        );
      }
      return null;
    }
  } else {
    try {
      const stats = statSync(resolvedDirPath);
      if (!stats.isDirectory()) {
        // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
        if (process.stdout.isTTY) {
          process.stderr.write(
            `Error: ${dirName} path ${resolvedDirPath} exists but is not a directory.\n`,
          );
        }
        return null;
      }
    } catch (statError: unknown) {
      // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
      if (process.stdout.isTTY) {
        const statErrorMessage =
          statError instanceof Error ? statError.message : String(statError);
        process.stderr.write(
          `Error accessing ${dirName} path ${resolvedDirPath}: ${statErrorMessage}\n`,
        );
      }
      return null;
    }
  }
  return resolvedDirPath;
};
// --- End Directory Ensurance Function ---

// --- Logs Directory Handling ---
let validatedLogsPath: string | null = ensureDirectory(
  env.LOGS_DIR,
  projectRoot,
  "logs",
);

if (!validatedLogsPath) {
  // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
  if (process.stdout.isTTY) {
    process.stderr.write(
      `Warning: Custom logs directory ('${env.LOGS_DIR}') is invalid or outside the project boundary. Falling back to default.\n`,
    );
  }
  // Try again with the absolute default path
  const defaultLogsDir = path.join(projectRoot, "logs");
  validatedLogsPath = ensureDirectory(defaultLogsDir, projectRoot, "logs");

  if (!validatedLogsPath) {
    // Use stderr to avoid interfering with STDIO transport JSON-RPC on stdout
    if (process.stdout.isTTY) {
      // This is just a warning now, not fatal.
      process.stderr.write(
        "Warning: Default logs directory could not be created. File logging will be disabled.\n",
      );
    }
    // Do not exit. validatedLogsPath remains null, and the logger will handle it.
  }
}
// --- End Logs Directory Handling ---

/**
 * Main application configuration object.
 * Aggregates settings from validated environment variables and `package.json`.
 */
export const config = {
  /** Information from package.json. */
  pkg,
  /** MCP server name. Env `MCP_SERVER_NAME` > `package.json` name > "mcp-ts-template". */
  mcpServerName: env.MCP_SERVER_NAME || pkg.name,
  /** MCP server version. Env `MCP_SERVER_VERSION` > `package.json` version > "0.0.0". */
  mcpServerVersion: env.MCP_SERVER_VERSION || pkg.version,
  /** Logging level. From `MCP_LOG_LEVEL` env var. Default: "debug". */
  logLevel: env.MCP_LOG_LEVEL,
  /** Absolute path to the logs directory. From `LOGS_DIR` env var. */
  logsPath: validatedLogsPath,
  /** Runtime environment. From `NODE_ENV` env var. Default: "development". */
  environment: env.NODE_ENV,
  /** MCP transport type ('stdio' or 'http'). From `MCP_TRANSPORT_TYPE` env var. Default: "stdio". */
  mcpTransportType: env.MCP_TRANSPORT_TYPE,
  /** HTTP server port (if http transport). From `MCP_HTTP_PORT` env var. Default: 3010. */
  mcpHttpPort: env.MCP_HTTP_PORT,
  /** HTTP server host (if http transport). From `MCP_HTTP_HOST` env var. Default: "127.0.0.1". */
  mcpHttpHost: env.MCP_HTTP_HOST,
  /** HTTP session store mode ('memory' | 'redis'). From `MCP_SESSION_STORE`. */
  sessionStore: env.MCP_SESSION_STORE,
  /** Redis URL for session coordination. From `REDIS_URL`. */
  redisUrl: env.REDIS_URL,
  /** Redis prefix for session ownership keys. From `REDIS_PREFIX`. */
  redisPrefix: env.REDIS_PREFIX,
  /** Array of allowed CORS origins (http transport). From `MCP_ALLOWED_ORIGINS` (comma-separated). */
  mcpAllowedOrigins: env.MCP_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Optional API key for HTTP transport authentication. From `MCP_API_KEY`. */
  mcpApiKey: env.MCP_API_KEY,
  /** OpenRouter App URL. From `OPENROUTER_APP_URL`. Default: "http://localhost:3000". */
  openrouterAppUrl: env.OPENROUTER_APP_URL || "http://localhost:3000",
  /** OpenRouter App Name. From `OPENROUTER_APP_NAME`. Defaults to `mcpServerName`. */
  openrouterAppName: env.OPENROUTER_APP_NAME || pkg.name || "MCP TS App",
  /** Provider API key map resolved from environment variables. */
  providerApiKeys,
  /** Provider-specific optional configuration (non-key values). */
  providerOptions,
  /** OpenRouter API Key. From `OPENROUTER_API_KEY`. */
  openrouterApiKey: providerApiKeys.openrouter,
  /** Gemini API Key. From `GEMINI_API_KEY`. */
  geminiApiKey: providerApiKeys.gemini,
  /** Google API Key. From `GOOGLE_API_KEY` or `GEMINI_API_KEY`. */
  googleApiKey: providerApiKeys.google,
  /** OpenAI API Key. From `OPENAI_API_KEY`. */
  openaiApiKey: providerApiKeys.openai,
  /** Anthropic API Key. From `ANTHROPIC_API_KEY`. */
  anthropicApiKey: providerApiKeys.anthropic,
  /** Perplexity API Key. From `PERPLEXITY_API_KEY`. */
  perplexityApiKey: providerApiKeys.perplexity,
  /** Mistral API Key. From `MISTRAL_API_KEY`. */
  mistralApiKey: providerApiKeys.mistral,
  /** Groq API Key. From `GROQ_API_KEY`. */
  groqApiKey: providerApiKeys.groq,
  /** XAI API Key. From `XAI_API_KEY`. */
  xaiApiKey: providerApiKeys.xai,
  /** Azure OpenAI API Key. From `AZURE_OPENAI_API_KEY`. */
  azureOpenAiApiKey: providerApiKeys.azureOpenAI,
  /** Azure OpenAI endpoint. From `AZURE_OPENAI_ENDPOINT`. */
  azureOpenAiEndpoint: providerOptions.azureOpenAI.endpoint,
  /** Azure OpenAI deployment name. From `AZURE_OPENAI_DEPLOYMENT`. */
  azureOpenAiDeployment: providerOptions.azureOpenAI.deployment,
  /** Ollama API Key. From `OLLAMA_API_KEY`. */
  ollamaApiKey: providerApiKeys.ollama,
  /** Ollama host override. From `OLLAMA_HOST`. */
  ollamaHost: providerOptions.ollama.host,
  /** Proxy API Key. From `PROXY_API_KEY`. */
  proxyApiKey: providerApiKeys.proxy,
  /** Proxy Base URL. From `PROXY_BASE_URL`. */
  proxyBaseUrl: providerOptions.proxy.baseURL,
  /** Proxy Model ID. From `PROXY_MODEL_ID`. */
  proxyModelId: providerOptions.proxy.modelId,
  /** Maximum project tokens limit. From `MAX_PROJECT_TOKENS`. Default: 20,000,000. */
  maxProjectTokens: env.MAX_PROJECT_TOKENS ?? 20_000_000,
  /** Maximum git blob size in bytes for diff operations. From `MAX_GIT_BLOB_SIZE_BYTES`. Default: 4MB. */
  maxGitBlobSizeBytes: env.MAX_GIT_BLOB_SIZE_BYTES ?? 4 * 1024 * 1024,
  /** Default LLM provider. From `LLM_DEFAULT_PROVIDER`. */
  llmDefaultProvider: env.LLM_DEFAULT_PROVIDER,
  /** Default LLM model. From `LLM_DEFAULT_MODEL`. */
  llmDefaultModel: env.LLM_DEFAULT_MODEL,
  /** Default LLM temperature. From `LLM_DEFAULT_TEMPERATURE`. */
  llmDefaultTemperature: env.LLM_DEFAULT_TEMPERATURE,
  /** Default LLM top_p. From `LLM_DEFAULT_TOP_P`. */
  llmDefaultTopP: env.LLM_DEFAULT_TOP_P,
  /** Default LLM max tokens. From `LLM_DEFAULT_MAX_TOKENS`. */
  llmDefaultMaxTokens: env.LLM_DEFAULT_MAX_TOKENS,
  /** Default LLM top_k. From `LLM_DEFAULT_TOP_K`. */
  llmDefaultTopK: env.LLM_DEFAULT_TOP_K,
  /** Default LLM min_p. From `LLM_DEFAULT_MIN_P`. */
  llmDefaultMinP: env.LLM_DEFAULT_MIN_P,
};

/**
 * Configured logging level for the application.
 * Exported for convenience.
 */
export const logLevel: string = config.logLevel;

/**
 * Configured runtime environment ("development", "production", etc.).
 * Exported for convenience.
 */
export const environment: string = config.environment;
