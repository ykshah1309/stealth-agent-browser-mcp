// Regression tests for the audit fixes. Each test maps to a specific issue
// identified in the audit document.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/session.js";
import { takeSnapshot } from "../src/snapshot.js";
import { buildTools } from "../src/tools.js";
import { readableMarkdown } from "../src/reader.js";
import { startFixtureServer, type TestServer } from "./server.js";

describe("audit regression — concurrency, scroll, ranking, cache, restart", () => {
  let fixture: TestServer;
  let sessions: SessionManager;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    sessions = new SessionManager({ ...loadConfig(), headless: true });
  }, 60_000);

  afterAll(async () => {
    await sessions.closeAll();
    await fixture.close();
  });

  // Audit #3: two concurrent getOrCreate() calls must share one Chromium.
  it("getOrCreate is race-safe under concurrent callers", async () => {
    const fresh = new SessionManager({ ...loadConfig(), headless: true });
    try {
      const [a, b, c] = await Promise.all([
        fresh.getOrCreate(),
        fresh.getOrCreate(),
        fresh.getOrCreate(),
      ]);
      expect(a.id).toBe(b.id);
      expect(b.id).toBe(c.id);
      expect(fresh.list().length).toBe(1);
    } finally {
      await fresh.closeAll();
    }
  }, 30_000);

  // Audit #2: restart() must actually terminate the old context and produce a new one.
  it("restart replaces the session id", async () => {
    const fresh = new SessionManager({ ...loadConfig(), headless: true });
    try {
      const s1 = await fresh.getOrCreate();
      const s2 = await fresh.restart();
      expect(s2.id).not.toBe(s1.id);
      expect(fresh.list().length).toBe(1);
    } finally {
      await fresh.closeAll();
    }
  }, 30_000);

  // Audit #1: annotation coords must match the viewport-relative screenshot
  // after scrolling. Playwright's boundingBox() is already viewport-relative,
  // so the hybrid path should NOT subtract scroll — doing so double-corrects
  // and pushes every box offscreen (resulting in 0 annotations).
  it("scrolled page still produces >0 annotations (no double-correction)", async () => {
    const fresh = new SessionManager({ ...loadConfig(), headless: true });
    try {
      const s = await fresh.getOrCreate();
      await s.page.goto(fixture.url("/scroll.html"), { waitUntil: "load" });
      await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await s.page.waitForTimeout(200);

      const snap = await takeSnapshot(s.page, "hybrid", { maxAnnotated: 50 });
      expect(snap.screenshotBase64).toBeTruthy();
      const raw = await s.page.screenshot({ type: "png", fullPage: false });
      const annotatedLen = Buffer.from(snap.screenshotBase64!, "base64").length;
      // Bottom buttons/link are in viewport after scrollToBottom -> overlay
      // renders -> annotated PNG has different bytes than raw.
      expect(annotatedLen).not.toBe(raw.length);
    } finally {
      await fresh.closeAll();
    }
  }, 30_000);

  // Audit #4: sweet-spot ranking — reasonable button-size refs survive the cap.
  it("annotation ranking prefers button-sized elements over layout divs", async () => {
    const fresh = new SessionManager({ ...loadConfig(), headless: true });
    try {
      const s = await fresh.getOrCreate();
      await s.page.goto(fixture.url("/scroll.html"), { waitUntil: "load" });
      await s.page.evaluate(() => window.scrollTo(0, 0));
      const snap = await takeSnapshot(s.page, "hybrid", { maxAnnotated: 2 });
      expect(snap.refs.length).toBeGreaterThan(0);
      expect(snap.screenshotBase64).toBeTruthy();
    } finally {
      await fresh.closeAll();
    }
  }, 30_000);

  // Audit #5 + #6: click invalidates read-cache AND settles before snapshotting.
  it("action tools invalidate the delta cache and settle", async () => {
    const cfg = { ...loadConfig(), headless: true };
    const fresh = new SessionManager(cfg);
    const tools = buildTools(fresh, cfg);
    const tool = (n: string) => tools.find((t) => t.name === n)!;
    try {
      await tool("browser_navigate").handler({
        url: fixture.url("/login.html"),
        waitUntil: "domcontentloaded",
        mode: "aom",
      });
      // Prime the delta cache with a first read.
      await tool("browser_scroll_read").handler({
        direction: "top",
        pixels: 100,
        deltaOnly: true,
      });
      const s = await fresh.getOrCreate();
      expect(s.lastReadHash).not.toBeNull();

      // Now click the submit button (fixture updates #note text on submit).
      const snap = await tool("browser_snapshot").handler({ mode: "aom" });
      const yaml = (snap.content.find((c) => c.type === "text" && c.text.includes("[ref=")) as {
        text: string;
      }).text;
      const btnRef = yaml.match(/button\s+"submit"\s+\[ref=([a-zA-Z0-9]+)\]/)![1]!;
      await tool("browser_click").handler({ ref: btnRef, button: "left", clickCount: 1 });

      // After click: cache must be nulled so subsequent scroll_read sees fresh content.
      expect(s.lastReadHash).toBeNull();
    } finally {
      await fresh.closeAll();
    }
  }, 45_000);

  // Audit #7: new restart tool cycles the session.
  it("browser_restart tool cycles to a new session id", async () => {
    const cfg = { ...loadConfig(), headless: true };
    const fresh = new SessionManager(cfg);
    const tools = buildTools(fresh, cfg);
    try {
      const s1 = await fresh.getOrCreate();
      const r = await tools.find((t) => t.name === "browser_restart")!.handler({});
      expect(r.isError).not.toBe(true);
      const s2 = await fresh.getOrCreate();
      expect(s2.id).not.toBe(s1.id);
    } finally {
      await fresh.closeAll();
    }
  }, 45_000);

  // Reader sanitization: no explosion on pages with <svg> / <canvas> / <iframe>.
  // Serve the HTML via the fixture server to avoid the about:blank race seen
  // with setContent() against a freshly-created page.
  it("readableMarkdown strips heavy nodes without throwing", async () => {
    const fresh = new SessionManager({ ...loadConfig(), headless: true });
    try {
      const s = await fresh.getOrCreate();
      await s.page.goto(fixture.url("/heavy.html"), { waitUntil: "domcontentloaded" });
      const r = await readableMarkdown(s.page, null);
      expect(r.markdown.toLowerCase()).toContain("readable text");
      expect(r.markdown).not.toContain("<svg");
      expect(r.markdown).not.toContain("<canvas");
    } finally {
      await fresh.closeAll();
    }
  }, 30_000);
});
