import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

// Residential proxy pool with three rotation strategies. Per-session rotation
// is the default because Chromium's --proxy-server is set at launch and cannot
// be changed without a restart — if you want per-request rotation, front the
// pool with a local backconnect proxy and point SAB_PROXY_SERVER at it.
//
// On TLS/JA3: all traffic exits through Chromium's BoringSSL, which emits
// Chrome's real ClientHello because it IS Chrome. Node-layer JA3 spoofing
// (curl-impersonate, node-tls-client) only applies to pure-Node scrapers that
// bypass the browser. Residential proxies route TCP and preserve the
// Chromium handshake end-to-end; they do not MITM TLS.

export type RotationStrategy = "per-session" | "per-restart" | "static";

export interface ProxyEntry {
  server: string;
  username?: string;
  password?: string;
}

export interface ResolvedProxy {
  server: string;
  username?: string;
  password?: string;
}

// Providers like Bright Data / DataImpulse / Oxylabs use username-embedded
// session ids to pin a residential IP for the lifetime of a session
// (sticky IPs survive captcha flows; rotating IPs don't). Template variables:
//   ${sessionId} — per-session random id
//   ${rand}     — per-call random suffix (for per-request rotation when
//                 chained through a backconnect that respects the field)
export function interpolateStickyUsername(
  template: string | undefined,
  ctx: { sessionId: string },
): string | undefined {
  if (!template) return undefined;
  return template
    .replaceAll("${sessionId}", ctx.sessionId)
    .replaceAll("${rand}", randomUUID().slice(0, 8));
}

// Accept either:
//   "http://a:b@host1:port,http://host2:port"        (comma-separated URLs)
//   '[{"server":"http://host:port","username":"u"}]' (JSON array)
export function parseProxyPool(raw: string | undefined): ProxyEntry[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((e): e is ProxyEntry => {
        return typeof e === "object" && e !== null && typeof (e as ProxyEntry).server === "string";
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "SAB_PROXY_POOL JSON parse failed — ignoring");
      return [];
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseUrlEntry(s))
    .filter((e): e is ProxyEntry => e !== null);
}

function parseUrlEntry(s: string): ProxyEntry | null {
  try {
    const u = new URL(s);
    const entry: ProxyEntry = { server: `${u.protocol}//${u.host}` };
    if (u.username) entry.username = decodeURIComponent(u.username);
    if (u.password) entry.password = decodeURIComponent(u.password);
    return entry;
  } catch {
    return null;
  }
}

export class ProxyPool {
  private idx = 0;
  constructor(
    private readonly entries: ProxyEntry[],
    private readonly strategy: RotationStrategy,
    private readonly stickyUsernameTemplate?: string,
  ) {}

  static empty(): ProxyPool {
    return new ProxyPool([], "static");
  }

  size(): number {
    return this.entries.length;
  }

  // Pull the next proxy per rotation strategy. Called on each session create.
  next(sessionId: string): ResolvedProxy | undefined {
    if (this.entries.length === 0) return undefined;
    let entry: ProxyEntry;
    if (this.strategy === "per-session" || this.strategy === "per-restart") {
      entry = this.entries[this.idx % this.entries.length]!;
      this.idx++;
    } else {
      entry = this.entries[0]!;
    }
    const username =
      interpolateStickyUsername(this.stickyUsernameTemplate, { sessionId }) ?? entry.username;
    const resolved: ResolvedProxy = { server: entry.server };
    if (username !== undefined) resolved.username = username;
    if (entry.password !== undefined) resolved.password = entry.password;
    return resolved;
  }
}
