import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "rebrowser-playwright";
import type { Config } from "./config.js";
import { launchStealthBrowser } from "./browser.js";
import type { FingerprintProfile } from "./fingerprint.js";
import { HumanMouse } from "./human-mouse.js";
import { ProxyPool, parseProxyPool } from "./proxy.js";
import { logger } from "./logger.js";

export interface Session {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  fingerprint: FingerprintProfile;
  lastReadHash: string | null;
  proxyHost?: string;
  humanMouse?: HumanMouse;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  // Mutex for getOrCreate: parallel callers at cold-start race into a single
  // shared creation promise, so we never spawn twin Chromiums.
  private initPromise: Promise<Session> | null = null;
  private pool: ProxyPool;

  constructor(private readonly config: Config) {
    const entries = parseProxyPool(config.proxyPool);
    this.pool = new ProxyPool(entries, config.proxyRotation, config.proxyStickyUsernameTemplate);
    if (entries.length > 0) {
      logger.info(
        { poolSize: entries.length, rotation: config.proxyRotation },
        "proxy pool initialized",
      );
    }
  }

  // Swap in a new pool at runtime (browser_set_proxy with a pool payload).
  setProxyPool(raw: string | undefined, rotation?: Config["proxyRotation"]): void {
    const entries = parseProxyPool(raw);
    this.pool = new ProxyPool(
      entries,
      rotation ?? this.config.proxyRotation,
      this.config.proxyStickyUsernameTemplate,
    );
    logger.info({ poolSize: entries.length }, "proxy pool replaced");
  }

  poolSize(): number {
    return this.pool.size();
  }

  async getOrCreate(): Promise<Session> {
    const existing = this.sessions.values().next().value;
    if (existing) return existing;
    if (this.initPromise) return this.initPromise;
    
    let promise!: Promise<Session>;
    promise = this.create().finally(() => {
      // Only release the lock if it hasn't been overwritten by a concurrent restart()
      if (this.initPromise === promise) {
        this.initPromise = null;
      }
    });
    this.initPromise = promise;
    return promise;
  }

  async create(): Promise<Session> {
    const id = randomUUID();
    const proxy = this.pool.next(id);
    const { browser, context, fingerprint } = await launchStealthBrowser(this.config, id, proxy);
    const page = await context.newPage();
    const session: Session = {
      id,
      browser,
      context,
      page,
      fingerprint,
      lastReadHash: null,
    };
    if (proxy) session.proxyHost = new URL(proxy.server).host;
    if (this.config.humanMouse) session.humanMouse = new HumanMouse(page);
    this.sessions.set(id, session);
    logger.info({ sessionId: id, proxyHost: session.proxyHost }, "session created");
    return session;
  }

  // Cycle the active session. Used after config mutations (e.g., proxy update)
  // so the new settings actually take effect at the Chromium layer.
  //
  // Must hold `initPromise` for the ENTIRE close+create window, synchronously
  // installed before any await, so that a concurrent `getOrCreate()` (e.g.
  // from a parallel `browser_navigate` tool call) awaits the same promise
  // instead of racing into a second `create()` and leaking a twin Chromium.
  async restart(): Promise<Session> {
    logger.info("restarting active session");
    const task = (async () => {
      // Drain any in-flight cold-start first so we don't tear down a session
      // that a sibling caller is still waiting on.
      const pending = this.initPromise;
      if (pending) {
        try {
          await pending;
        } catch {
          /* ignore — cold-start failure is the caller's problem, not ours */
        }
      }
      await this.closeAll();
      return this.create();
    })();
    
    let promise!: Promise<Session>;
    promise = task.finally(() => {
      if (this.initPromise === promise) {
        this.initPromise = null;
      }
    });
    this.initPromise = promise;
    return promise;
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  async closeAll(): Promise<void> {
    // Clear the map FIRST so a concurrent `getOrCreate()` during teardown
    // falls through to the mutex (initPromise) instead of returning a
    // half-closed session.
    const existing = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      existing.map(async (s) => {
        try {
          await s.context.close();
        } catch {
          /* ignore */
        }
        try {
          await s.browser.close();
        } catch {
          /* ignore */
        }
      }),
    );
    // NB: do NOT clear `initPromise` here — `restart()` owns that mutex and
    // nulling it mid-restart would re-open the race this method closed.
  }
}
