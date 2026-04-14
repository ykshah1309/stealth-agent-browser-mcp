import pino from "pino";

// Critical: stdio MCP uses stdout for JSON-RPC. All logs must go to stderr.
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: { name: "stealth-agent-browser-mcp" },
  },
  pino.destination(2),
);
