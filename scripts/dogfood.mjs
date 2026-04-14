// Dogfood the MCP server: spawn it, navigate to a real URL,
// and print the AOM snapshot exactly as an MCP client sees it.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const entry = resolve("dist/index.js");
const proc = spawn(process.execPath, [entry], {
  env: { ...process.env, SAB_HEADLESS: "true", LOG_LEVEL: "warn" },
  stdio: ["pipe", "pipe", "pipe"],
});
proc.stderr.on("data", (b) => process.stderr.write(b));

let buf = "";
const pending = new Map();
let nextId = 1;
proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const r = pending.get(msg.id);
        pending.delete(msg.id);
        r(msg);
      }
    } catch {}
  }
});

function req(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((r) => {
    pending.set(id, r);
    proc.stdin.write(JSON.stringify(msg) + "\n");
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const target = process.argv[2] ?? "https://example.com";

(async () => {
  const init = await req("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "dogfood", version: "0" },
  });
  console.log("=== initialize ===");
  console.log(JSON.stringify(init.result, null, 2));

  notify("notifications/initialized");

  const list = await req("tools/list");
  console.log("\n=== tools ===");
  for (const t of list.result.tools) console.log(`- ${t.name}`);

  console.log(`\n=== navigating to ${target} ===`);
  const nav = await req("tools/call", {
    name: "browser_navigate",
    arguments: { url: target, waitUntil: "domcontentloaded", mode: "aom" },
  });
  for (const c of nav.result.content) {
    if (c.type === "text") console.log(c.text);
  }

  proc.stdin.end();
  proc.kill();
})();
