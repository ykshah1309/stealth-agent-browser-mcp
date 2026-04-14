import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TestServer {
  url: (path: string) => string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<TestServer> {
  const dir = resolve(import.meta.dirname, "fixtures");
  const server = createServer((req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0]!;
      const name = path === "/" ? "/index.html" : path;
      const file = readFileSync(resolve(dir, "." + name));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(file);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  const port = addr.port;
  return {
    url: (p) => `http://127.0.0.1:${port}${p.startsWith("/") ? p : "/" + p}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}
