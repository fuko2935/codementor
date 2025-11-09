import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  BaseErrorCode,
  McpError,
} from "../../../src/types-global/errors.js";
import { authContext } from "../../../src/mcp-server/transports/auth/core/authContext.js";

// Tool + resource registrations
import { registerGeminiCodebaseAnalyzer } from "../../../src/mcp-server/tools/geminiCodebaseAnalyzer/registration.js";
import { registerProjectOrchestratorCreate } from "../../../src/mcp-server/tools/projectOrchestratorCreate/registration.js";
import { registerProjectOrchestratorAnalyze } from "../../../src/mcp-server/tools/projectOrchestratorAnalyze/registration.js";
import { registerMcpSetupGuide } from "../../../src/mcp-server/tools/mcpSetupGuide/registration.js";
import { registerDynamicExpertCreate } from "../../../src/mcp-server/tools/dynamicExpertCreate/registration.js";
import { registerDynamicExpertAnalyze } from "../../../src/mcp-server/tools/dynamicExpertAnalyze/registration.js";
import { registerCalculateTokenCount } from "../../../src/mcp-server/tools/calculateTokenCount/registration.js";
import { registerEchoResource } from "../../../src/mcp-server/resource-blueprints/echoResource/registration.js";
import { registerEchoTool } from "../../../src/mcp-server/tool-blueprints/echoTool/registration.js";
import { registerCatFactFetcherTool } from "../../../src/mcp-server/tool-blueprints/catFactFetcher/registration.js";
import { registerFetchImageTestTool } from "../../../src/mcp-server/tool-blueprints/imageTest/registration.js";

/**
 * Ortak yardımcılar
 */

class TestMcpServer extends McpServer {
  // Sadece bu test dosyasında ihtiyaç duyduğumuz minimal yüzey:
  public registeredTools: Map<
    string,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (params: any, mcpContext?: any) => Promise<CallToolResult>;
    }
  > = new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, _description: string, _schema: any, handler: any): void {
    this.registeredTools.set(name, { handler });
    // Gerçek McpServer.tool davranışını taklit etmek için super çağrısı gerekmiyor;
    // testler sadece handler erişimine ihtiyaç duyuyor.
  }
}

/**
 * Tüm testler için:
 * - scopes dolu ise authContext.run ile çalıştır.
 * - scopes null ise auth context olmadan handler çağır (misconfiguration senaryosu).
 */
function runWithScopes<T>(
  scopes: string[] | null,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  if (!scopes) {
    // Auth context yok: fn doğrudan çağrılır.
    return fn();
  }

  return authContext.run(
    {
      authInfo: {
        clientId: "test-client",
        subject: "test-subject",
        scopes,
      },
    } as any,
    fn,
  );
}

/**
 * MCP Server SDK'nın dahili kayıt yapılarına doğrudan dokunmak yerine,
 * her kayıt fonksiyonu için minimal, kararlı bir erişim yardımcıları.
 */

// Generic tool handler fetcher (TestMcpServer üzerinden)
type GenericToolHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpContext?: any,
) => Promise<CallToolResult>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolHandlerFromTestServer(
  server: TestMcpServer,
  name: string,
): GenericToolHandler {
  const def = server.registeredTools.get(name);
  assert.ok(def, `Tool '${name}' should be registered`);
  return def.handler;
}

// Echo / catFact / imageTest gibi blueprint'ler için gerçek McpServer.tools map'ine eriş.
type BlueprintToolHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpContext?: any,
) => Promise<{ content: unknown; isError?: boolean }>;

function getBlueprintToolHandler(
  server: McpServer,
  name: string,
): BlueprintToolHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyServer = server as any;
  const tools: Map<string, { handler: BlueprintToolHandler }> | undefined =
    anyServer.tools;
  assert.ok(tools, "Server should expose tools map for blueprint handlers");

  const tool = tools.get(name);
  assert.ok(tool, `Tool '${name}' should be registered`);
  assert.equal(typeof tool.handler, "function");
  return tool.handler;
}

type EchoResourceHandler = (uri: URL, params: any) => Promise<any>;

function getEchoResourceHandler(server: McpServer): EchoResourceHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyServer = server as any;
  const resources: Map<string, { handler: EchoResourceHandler }> | undefined =
    anyServer.resources;
  assert.ok(resources, "Server should expose resources map for echo-resource");

  const resource = resources.get("echo-resource");
  assert.ok(resource, "echo-resource should be registered");
  assert.equal(typeof resource.handler, "function");
  return resource.handler;
}

/**
 * Aşağıdaki test grupları:
 * - Her araç / blueprint için:
 *   - Eksik scope -> FORBIDDEN
 *   - Eksik auth context -> INTERNAL_ERROR
 *
 * Pozitif (allow) testleri ilgili spesifik dosyalarda zaten mevcut;
 * burada sadece negatif davranışlar doğrulanır.
 */

describe("authorization scopes - centralized negative coverage", () => {
  /**
   * gemini_codebase_analyzer
   * required: ["analysis:read", "codebase:read"]
   */
  describe("gemini_codebase_analyzer", () => {
    it("should return FORBIDDEN when required scope is missing", async () => {
      const server = new TestMcpServer();
      await registerGeminiCodebaseAnalyzer(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_codebase_analyzer",
      );

      await assert.rejects(
        () =>
          runWithScopes(["analysis:read"], () =>
            handler({
              projectPath: ".",
              question: "test",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerGeminiCodebaseAnalyzer(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_codebase_analyzer",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              question: "test",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * project_orchestrator_create
   * required: ["orchestration:write"]
   */
  describe("project_orchestrator_create", () => {
    it("should return FORBIDDEN when orchestration:write scope is missing", async () => {
      const server = new TestMcpServer();
      await registerProjectOrchestratorCreate(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "project_orchestrator_create",
      );

      await assert.rejects(
        () =>
          runWithScopes(["orchestration:read"], () =>
            handler({
              projectPath: ".",
              question: "test",
              analysisMode: "general",
              maxTokensPerGroup: 100000,
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerProjectOrchestratorCreate(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "project_orchestrator_create",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              question: "test",
              analysisMode: "general",
              maxTokensPerGroup: 100000,
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * project_orchestrator_analyze
   * required: ["orchestration:read"]
   */
  describe("project_orchestrator_analyze", () => {
    it("should return FORBIDDEN when orchestration:read is missing", async () => {
      const server = new TestMcpServer();
      await registerProjectOrchestratorAnalyze(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "project_orchestrator_analyze",
      );

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({
              projectPath: ".",
              question: "test",
              fileGroupsData: '{"groups":[],"totalFiles":0}',
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerProjectOrchestratorAnalyze(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "project_orchestrator_analyze",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              question: "test",
              fileGroupsData: '{"groups":[],"totalFiles":0}',
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * mcp_setup_guide
   * required: ["config:read"]
   */
  describe("mcp_setup_guide", () => {
    it("should return FORBIDDEN when config:read scope is missing", async () => {
      const server = new TestMcpServer();
      await registerMcpSetupGuide(server);

      const handler = getToolHandlerFromTestServer(server, "mcp_setup_guide");

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({
              client: "cursor",
              projectPath: ".",
              force: false,
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerMcpSetupGuide(server);

      const handler = getToolHandlerFromTestServer(server, "mcp_setup_guide");

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              client: "cursor",
              projectPath: ".",
              force: false,
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * gemini_dynamic_expert_create
   * required: ["expert:create"]
   */
  describe("gemini_dynamic_expert_create", () => {
    it("should return FORBIDDEN when expert:create is missing", async () => {
      const server = new TestMcpServer();
      await registerDynamicExpertCreate(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_dynamic_expert_create",
      );

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({
              projectPath: ".",
              expertiseHint: "test",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerDynamicExpertCreate(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_dynamic_expert_create",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              expertiseHint: "test",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * gemini_dynamic_expert_analyze
   * required: ["expert:analyze"]
   */
  describe("gemini_dynamic_expert_analyze", () => {
    it("should return FORBIDDEN when expert:analyze is missing", async () => {
      const server = new TestMcpServer();
      await registerDynamicExpertAnalyze(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_dynamic_expert_analyze",
      );

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({
              projectPath: ".",
              question: "test",
              expertPrompt: "prompt",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new TestMcpServer();
      await registerDynamicExpertAnalyze(server);

      const handler = getToolHandlerFromTestServer(
        server,
        "gemini_dynamic_expert_analyze",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              question: "test",
              expertPrompt: "prompt",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * calculate_token_count
   * required: ["analysis:read"]
   */
  describe("calculate_token_count", () => {
    it("should return FORBIDDEN when analysis:read scope is missing", async () => {
      const server = new McpServer();
      await registerCalculateTokenCount(server);

      const handler = getBlueprintToolHandler(server, "calculate_token_count");

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({
              projectPath: ".",
              textToAnalyze: "test",
              tokenizerModel: "gemini-2.0-flash",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new McpServer();
      await registerCalculateTokenCount(server);

      const handler = getBlueprintToolHandler(server, "calculate_token_count");

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({
              projectPath: ".",
              textToAnalyze: "test",
              tokenizerModel: "gemini-2.0-flash",
            }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * echo_resource
   * required: ["resource:read"]
   */
  describe("echo_resource", () => {
    it("should return FORBIDDEN when resource:read scope is missing", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      await registerEchoResource(server);

      const handler = getEchoResourceHandler(server);

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler(new URL("echo://test"), { message: "hi" }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      await registerEchoResource(server);

      const handler = getEchoResourceHandler(server);

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler(new URL("echo://test"), { message: "hi" }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * echo_tool
   * required: ["utility:use"]
   */
  describe("echo_tool", () => {
    it("should return FORBIDDEN when utility:use scope is missing", async () => {
      const server = new McpServer();
      await registerEchoTool(server);

      const handler = getBlueprintToolHandler(server, "echo_message");

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({ message: "hi" }, {}),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new McpServer();
      await registerEchoTool(server);

      const handler = getBlueprintToolHandler(server, "echo_message");

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({ message: "hi" }, {}),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * cat_fact_fetcher
   * required: ["external:fetch"]
   */
  describe("cat_fact_fetcher", () => {
    it("should return FORBIDDEN when external:fetch is missing", async () => {
      const server = new McpServer();
      await registerCatFactFetcherTool(server);

      const handler = getBlueprintToolHandler(
        server,
        "get_random_cat_fact",
      );

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler({ maxLength: 64 }, {}),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new McpServer();
      await registerCatFactFetcherTool(server);

      const handler = getBlueprintToolHandler(
        server,
        "get_random_cat_fact",
      );

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler({ maxLength: 64 }, {}),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });

  /**
   * image_test
   * required: ["image:analyze"]
   */
  describe("image_test", () => {
    it("should return FORBIDDEN when image:analyze is missing", async () => {
      const server = new McpServer();
      await registerFetchImageTestTool(server);

      const handler = getBlueprintToolHandler(server, "fetch_image_test");

      await assert.rejects(
        () =>
          runWithScopes(["some:other"], () =>
            handler(
              {
                imageUrl: "https://example.com/image.png",
              },
              {},
            ),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.FORBIDDEN);
          return true;
        },
      );
    });

    it("should return INTERNAL_ERROR when auth context is missing", async () => {
      const server = new McpServer();
      await registerFetchImageTestTool(server);

      const handler = getBlueprintToolHandler(server, "fetch_image_test");

      await assert.rejects(
        () =>
          runWithScopes(null, () =>
            handler(
              {
                imageUrl: "https://example.com/image.png",
              },
              {},
            ),
          ),
        (error: unknown) => {
          assert.ok(error instanceof McpError);
          assert.equal(error.code, BaseErrorCode.INTERNAL_ERROR);
          return true;
        },
      );
    });
  });
});