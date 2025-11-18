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
  
  if (!toolsMap) {
    throw new Error(`Tools map not found on server instance.`);
  }
  
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
export class TestMcpServer {
  private tools = new Map<string, { handler: ToolHandler }>();
  private mcpServer: McpServer;

  constructor() {
    this.mcpServer = new McpServer({
      name: "test-server",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });
  }

  tool(name: string, description: string, schema: any, handler: ToolHandler): any {
    // Store the tool with its handler for testing
    this.tools.set(name, { handler });
    
    // Call the real MCP server's tool method
    return this.mcpServer.tool(name, description, schema, handler);
  }

  getTools() {
    return this.tools;
  }

  // Expose other McpServer methods if needed
  get server() {
    return this.mcpServer;
  }
}