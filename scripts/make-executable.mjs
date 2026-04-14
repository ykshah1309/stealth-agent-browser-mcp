// Adds a shebang + chmod +x to dist/index.js so it works as a CLI.
import { readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";

const entry = resolve("dist/index.js");
const source = await readFile(entry, "utf8");
const shebang = "#!/usr/bin/env node\n";

if (!source.startsWith(shebang)) {
  await writeFile(entry, shebang + source, "utf8");
}

try {
  await chmod(entry, 0o755);
} catch {
  // Windows: ignore.
}
