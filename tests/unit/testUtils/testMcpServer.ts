import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ToolHandler = (
  params: unknown,
) => Promise<CallToolResult>;

/**
 * Helper to invoke a tool handler on a server.
 */
export async function callTool(
  server: McpServer,
  toolName: string,
  params: unknown,
): Promise<CallToolResult> {
  const toolsMap = (server as unknown as { tools: Map<string, unknown> }).tools;
  const tool = toolsMap.get(toolName) as
    | {
        handler: ToolHandler;
      }
    | undefined;

  if (!tool || typeof tool.handler !== "function") {
    throw new Error(`Tool handler for '${toolName}' not found or invalid.`);
  }

  return tool.handler(params);
}

/**
 * Test MCP Server class that matches the expected interface
 */
export class TestMcpServer extends McpServer {
  private tools = new Map<string, { handler: ToolHandler }>();

  constructor() {
    super({
      name: "test-server",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });
  }

  tool(name: string, cb: any): void {
    // Extract the handler from the callback function
    // The MCP SDK passes a callback that returns the tool definition
    const toolDef = cb();
    this.tools.set(name, {
      handler: toolDef.handler,
    });
  }

  getTools() {
    return this.tools;
  }
}