/**
 * @fileoverview Client profile definitions for mcp_setup_guide tool
 * Maps AI client names to their configuration file paths and directories
 * @module src/config/clientProfiles
 */

/**
 * Client profile structure
 */
export interface ClientProfile {
  /** The filename for the configuration/documentation file */
  file: string;
  /** Optional directory path (null for root directory) */
  directory: string | null;
}

/**
 * Comprehensive mapping of AI clients to their configuration file conventions
 * 
 * This mapping covers popular AI coding assistants and IDEs that support
 * AI integration. Each client has specific conventions for where they look
 * for agent configuration files.
 * 
 * @example
 * // Cursor looks for AGENTS.md in project root
 * CLIENT_PROFILES.cursor // { file: "AGENTS.md", directory: null }
 * 
 * // Cline looks for files in .clinerules directory
 * CLIENT_PROFILES.cline // { file: "mcp-guide.md", directory: ".clinerules" }
 */
export const CLIENT_PROFILES = {
  // Root-level AGENTS.md clients
  cursor: { file: "AGENTS.md", directory: null },
  "codex-cli": { file: "AGENTS.md", directory: null },
  "codex-ide": { file: "AGENTS.md", directory: null },
  droidcli: { file: "AGENTS.md", directory: null },
  "droid-factory": { file: "AGENTS.md", directory: null },
  "roo-code": { file: "AGENTS.md", directory: null },
  "kilo-code": { file: "AGENTS.md", directory: null },
  zed: { file: "AGENTS.md", directory: null },
  "vscode-copilot": { file: "AGENTS.md", directory: null },
  aider: { file: "AGENTS.md", directory: null },
  opencode: { file: "AGENTS.md", directory: null },
  amp: { file: "AGENTS.md", directory: null },

  // Client-specific named files in root
  "gemini-cli": { file: "GEMINI.md", directory: null },
  "qwen-code": { file: "QWEN.md", directory: null },
  "claude-code": { file: "CLAUDE.md", directory: null },
  warp: { file: "WARP.md", directory: null },

  // Clients with custom directory structures
  cline: { file: "mcp-guide.md", directory: ".clinerules" },
  kiro: { file: "mcp-guide.md", directory: ".kiro/steering" },
  "qoder-cli": { file: "AGENTS.md", directory: ".qoder" },
  "qoder-ide": { file: "AGENTS.md", directory: ".qoder" },

  // Default fallback for unlisted clients
  other: { file: "AGENTS.md", directory: null },
} as const satisfies Record<string, ClientProfile>;

/**
 * Type-safe client names
 */
export type ClientName = keyof typeof CLIENT_PROFILES;

/**
 * Helper function to get all supported client names
 */
export function getAllClientNames(): ClientName[] {
  return Object.keys(CLIENT_PROFILES) as ClientName[];
}

/**
 * Helper function to check if a client is supported
 */
export function isClientSupported(client: string): client is ClientName {
  return client in CLIENT_PROFILES;
}

/**
 * Helper function to get a client profile with type safety
 */
export function getClientProfile(client: ClientName): ClientProfile {
  return CLIENT_PROFILES[client];
}

