/**
 * @fileoverview MCP Setup Guide tool tests
 * @module tests/unit/tools/mcpSetupGuide
 */

import {
  projectBootstrapLogic,
  type ProjectBootstrapInput as McpSetupGuideInput,
} from "../../../src/mcp-server/tools/projectBootstrap/logic.js";
import {
  MCP_CODEMENTOR_START_MARKER as MCP_CONTENT_START_MARKER,
  MCP_CODEMENTOR_END_MARKER as MCP_CONTENT_END_MARKER,
} from "../../../src/mcp-server/utils/mcpConfigValidator.js";
import { requestContextService } from "../../../src/utils/index.js";
import { registerProjectBootstrap } from "../../../src/mcp-server/tools/projectBootstrap/registration.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { promises as fs } from "fs";
import path from "path";

// Mock dependencies
jest.mock("../../../src/utils/index.js", () => ({
  requestContextService: {
    createRequestContext: jest.fn().mockReturnValue({
      requestId: "test-request-id",
      timestamp: new Date().toISOString(),
      operation: "test-operation",
    }),
  },
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("fs", () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    copyFile: jest.fn(),
    stat: jest.fn(),
    open: jest.fn(),
  },
}));

jest.mock("../../../src/config/clientProfiles.js", () => ({
  CLIENT_PROFILES: {
    cursor: {
      directory: ".cursor",
      file: "mcp.json",
    },
    "claude-code": {
      directory: ".claude",
      file: "claude_desktop_config.json",
    },
  },
  getAllClientNames: jest.fn().mockReturnValue(["cursor", "claude-code"]),
}));

jest.mock("../../../src/mcp-server/utils/securePathValidator.js", () => ({
  validateSecurePath: jest.fn().mockImplementation((path) => Promise.resolve(path)),
}));

jest.mock("../../../src/mcp-server/utils/mcpConfigValidator.js", () => ({
  MCP_CODEMENTOR_START_MARKER: "<!-- MCP:CODEMENTOR:START -->",
  MCP_CODEMENTOR_END_MARKER: "<!-- MCP:CODEMENTOR:END -->",
  refreshMcpConfigCache: jest.fn(),
}));

jest.mock("js-yaml", () => ({
  load: jest.fn().mockImplementation((yamlStr) => {
    try {
      return JSON.parse(yamlStr.replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
    } catch {
      return {};
    }
  }),
}));

describe("MCP Setup Guide Tool", () => {
  let mockServer: jest.Mocked<McpServer>;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServer = {
      setRequestHandler: jest.fn(),
    } as any;
    mockContext = requestContextService.createRequestContext();
  });

  describe("projectBootstrapLogic", () => {
    const validParams: McpSetupGuideInput = {
      client: "cursor",
      projectPath: ".",
      force: false,
    };

    it("should create MCP configuration successfully", async () => {
      // Mock file operations
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValueOnce({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.actions).toHaveLength(2); // .mcpignore exists, config created
    });

    it("should handle existing configuration with same hash", async () => {
      // Mock existing config with same content
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockResolvedValueOnce(undefined); // config file exists

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(
          `${MCP_CONTENT_START_MARKER}\ntest content\n${MCP_CONTENT_END_MARKER}`
        ); // existing config

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.actions.some(a => a.type === "skipped")).toBe(true);
    });

    it("should create .mcpignore from example when missing", async () => {
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error("File not found")) // .mcpignore doesn't exist
        .mockResolvedValueOnce(undefined) // .mcpignore.example exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Example content"); // .mcpignore.example content

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      expect(fs.copyFile).toHaveBeenCalled();
    });

    it("should create default .mcpignore when no example exists", async () => {
      (fs.access as jest.Mock)
        .mockRejectedValue(new Error("File not found")); // all files don't exist

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".mcpignore"),
        expect.stringContaining("# Default .mcpignore patterns"),
        "utf-8"
      );
    });

    it("should handle project rules from CODEMENTOR.md", async () => {
      const paramsWithRules: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",
        force: false,
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockResolvedValueOnce(undefined) // config file exists
        .mockResolvedValueOnce(undefined); // CODEMENTOR.md exists

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(
          `${MCP_CONTENT_START_MARKER}\nold content\n${MCP_CONTENT_END_MARKER}`
        ) // existing config
        .mockResolvedValueOnce(
          "---\nopenSourceStatus: open-source\ntargetAudience: \"public\"\n---\n# Project docs"
        ); // CODEMENTOR.md with frontmatter

      (fs.stat as jest.Mock).mockResolvedValue({ size: 200 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 200 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(paramsWithRules, mockContext);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should force update when force flag is true", async () => {
      const paramsWithForce: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",
        force: true,
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockResolvedValueOnce(undefined); // config file exists

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(
          `${MCP_CONTENT_START_MARKER}\nsame content\n${MCP_CONTENT_END_MARKER}`
        ); // existing config with same content

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(paramsWithForce, mockContext);

      expect(result.success).toBe(true);
      expect(result.actions.some(a => a.type === "updated")).toBe(true);
    });

    it("should handle different client profiles", async () => {
      const claudeParams: McpSetupGuideInput = {
        client: "claude-code",
        projectPath: ".",
        force: false,
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(claudeParams, mockContext);

      expect(result.success).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(".claude"),
        { recursive: true }
      );
    });

    it("should handle file system errors gracefully", async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error("Permission denied"));

      await expect(
        projectBootstrapLogic(validParams, mockContext)
      ).rejects.toThrow();
    });

    it("should validate project path security", async () => {
      const { validateSecurePath } = require("../../../src/mcp-server/utils/securePathValidator.js");
      validateSecurePath.mockRejectedValue(new Error("Invalid path"));

      await expect(
        projectBootstrapLogic(validParams, mockContext)
      ).rejects.toThrow("Invalid path");
    });

    it("should handle template loading failures", async () => {
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockRejectedValue(new Error("Template not found")); // template loading fails

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      // Should still succeed with empty template
    });

    it("should handle cache update failures", async () => {
      const { refreshMcpConfigCache } = require("../../../src/mcp-server/utils/mcpConfigValidator.js");
      refreshMcpConfigCache.mockImplementation(() => {
        throw new Error("Cache update failed");
      });

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      // Should succeed despite cache failure
    });

    it("should handle YAML parsing errors in CODEMENTOR.md", async () => {
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockResolvedValueOnce(undefined) // config file exists
        .mockResolvedValueOnce(undefined); // CODEMENTOR.md exists

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(
          `${MCP_CONTENT_START_MARKER}\nold content\n${MCP_CONTENT_END_MARKER}`
        ) // existing config
        .mockResolvedValueOnce("---\ninvalid: yaml: content:\n---\n# Project docs"); // invalid YAML

      (fs.stat as jest.Mock).mockResolvedValue({ size: 200 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 200 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(validParams, mockContext);

      expect(result.success).toBe(true);
      // Should continue with default rules
    });

    it("should handle project rules validation errors", async () => {
      const paramsWithInvalidRules: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",
        force: false,
        projectRules: {
          openSourceStatus: "invalid-value" as any,
        },
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      await expect(
        projectBootstrapLogic(paramsWithInvalidRules, mockContext)
      ).rejects.toThrow();
    });

    it("should handle empty project path", async () => {
      const emptyPathParams: McpSetupGuideInput = {
        client: "cursor",
        projectPath: "",
        force: false,
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(emptyPathParams, mockContext);

      expect(result.success).toBe(true);
    });

    it("should handle complex project rules", async () => {
      const complexRules: McpSetupGuideInput = {
        client: "cursor",
        projectPath: ".",
        force: false,
        projectRules: {
          openSourceStatus: "open-source",
          distributionModel: "saas",
          targetAudience: "enterprise",
          licenseConstraints: ["MIT", "Apache-2.0"],
          packageConstraints: ["only official registry"],
          deploymentNotes: "Internal deployment only\nNo external data sharing",
        },
      };

      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // .mcpignore exists
        .mockRejectedValueOnce(new Error("File not found")); // config file doesn't exist

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce("# Test content") // .mcpignore content
        .mockResolvedValueOnce(""); // empty config file

      (fs.stat as jest.Mock).mockResolvedValue({ size: 100 });

      const mockFileHandle = {
        read: jest.fn().mockResolvedValue({ bytesRead: 100 }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);

      const result = await projectBootstrapLogic(complexRules, mockContext);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe("registerProjectBootstrap", () => {
    it("should register the tool with the server", () => {
      registerProjectBootstrap(mockServer);

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });
  });

  describe("Marker Constants", () => {
    it("should have correct marker values", () => {
      expect(MCP_CONTENT_START_MARKER).toBe("<!-- MCP:CODEMENTOR:START -->");
      expect(MCP_CONTENT_END_MARKER).toBe("<!-- MCP:CODEMENTOR:END -->");
    });
  });
});