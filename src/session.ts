import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "rebrowser-playwright";
import type { Config } from "./config.js";
import { launchStealthBrowser } from "./browser.js";
import type { FingerprintProfile } from "./fingerprint.js";
import { logger } from "./logger.js";

export interface Session {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  fingerprint: FingerprintProfile;
  lastReadHash: string | null;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  // Mutex for getOrCreate: parallel callers at cold-start race into a single
  // shared creation promise, so we never spawn twin Chromiums.
  private initPromise: Promise<Session> | null = null;

  constructor(private readonly config: Config) {}

  async getOrCreate(): Promise<Session> {
    const existing = this.sessions.values().next().value;
    if (existing) return existing;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.create().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async create(): Promise<Session> {
    const id = randomUUID();
    const { browser, context, fingerprint } = await launchStealthBrowser(this.config, id);
    const page = await context.newPage();
    const session: Session = { id, browser, context, page, fingerprint, lastReadHash: null };
    this.sessions.set(id, session);
    logger.info({ sessionId: id }, "session created");
    return session;
  }

  // Cycle the active session. Used after config mutations (e.g., proxy update)
  // so the new settings actually take effect at the Chromium layer.
  async restart(): Promise<Session> {
    logger.info("restarting active session");
    await this.closeAll();
    return this.create();
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  async closeAll(): Promise<void> {
    const closings = [...this.sessions.values()].map(async (s) => {
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
    });
    await Promise.all(closings);
    this.sessions.clear();
    this.initPromise = null;
  }
}
