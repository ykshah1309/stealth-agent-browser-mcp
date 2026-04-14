import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { SessionManager } from "./session.js";
import { buildTools } from "./tools.js";
import { logger } from "./logger.js";

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const sessions = new SessionManager(config);

  const server = new McpServer(
    { name: "stealth-agent-browser-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const tools = buildTools(sessions, config);
  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      async (args) => t.handler(args as Record<string, unknown>),
    );
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await sessions.closeAll();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ tools: tools.length, stealthLevel: config.stealthLevel }, "MCP server ready");
}
