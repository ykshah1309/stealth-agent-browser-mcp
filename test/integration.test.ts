// End-to-end MCP test: spawn the compiled server as a real subprocess,
// drive it with JSON-RPC over stdio exactly as an MCP host would.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type TestServer } from "./server.js";

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpClient {
  private nextId = 1;
  private buffer = "";
  private pending = new Map<number | string, (m: JsonRpc) => void>();

  constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpc;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const r = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          r(msg);
        }
      } catch {
        // Non-JSON line (shouldn't happen if stdout purity holds).
      }
    }
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<JsonRpc> {
    const id = this.nextId++;
    const msg: JsonRpc = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolveResp, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        resolveResp(m);
      });
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    const msg: JsonRpc = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

describe("full MCP stdio integration", () => {
  let fixture: TestServer;
  let proc: ChildProcessWithoutNullStreams;
  let client: McpClient;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    const entry = resolve(import.meta.dirname, "..", "dist", "index.js");
    proc = spawn(process.execPath, [entry], {
      env: { ...process.env, SAB_HEADLESS: "true", LOG_LEVEL: "warn" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Consume stderr to avoid backpressure (pino writes structured logs there).
    proc.stderr.on("data", () => {});
    client = new McpClient(proc);

    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "0" },
    });
    expect(init.error).toBeUndefined();
    client.notify("notifications/initialized");
  }, 60_000);

  afterAll(async () => {
    client.close();
    await fixture.close();
  });

  it("lists all tools", async () => {
    const r = await client.request("tools/list");
    expect(r.error).toBeUndefined();
    const tools = (r.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_scroll_read");
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it("navigates to the fixture and returns an AOM snapshot with refs", async () => {
    const r = await client.request("tools/call", {
      name: "browser_navigate",
      arguments: {
        url: fixture.url("/login.html"),
        waitUntil: "domcontentloaded",
        mode: "aom",
      },
    });
    expect(r.error).toBeUndefined();
    const content = (r.result as { content: Array<{ type: string; text?: string }> }).content;
    const yamlBlock = content.find((c) => c.type === "text" && c.text?.includes("[ref="));
    expect(yamlBlock).toBeTruthy();
    expect(yamlBlock!.text).toMatch(/textbox\s+"email"/);
  }, 30_000);

  it("hybrid snapshot returns an image block", async () => {
    const r = await client.request("tools/call", {
      name: "browser_snapshot",
      arguments: { mode: "hybrid" },
    });
    expect(r.error).toBeUndefined();
    const content = (r.result as {
      content: Array<{ type: string; data?: string; mimeType?: string }>;
    }).content;
    const img = content.find((c) => c.type === "image");
    expect(img).toBeTruthy();
    expect(img!.mimeType).toBe("image/png");
    expect((img!.data ?? "").length).toBeGreaterThan(500);
  }, 30_000);
});
