import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/session.js";
import { buildTools } from "../src/tools.js";
import { startFixtureServer, type TestServer } from "./server.js";

// We can't directly observe "is this trajectory humanlike" in a unit test,
// but we CAN verify that the cursor moves through multiple intermediate
// coordinates between clicks — whereas the raw locator.click() teleports
// without emitting any mousemove events on the way.
describe("human mouse — cursor emits intermediate movements before clicking", () => {
  let fixture: TestServer;

  beforeAll(async () => {
    fixture = await startFixtureServer();
  }, 60_000);

  afterAll(async () => {
    await fixture.close();
  });

  it("emits multiple mousemove events before the click lands", async () => {
    const cfg = { ...loadConfig(), headless: true, humanMouse: true };
    const sessions = new SessionManager(cfg);
    const tools = buildTools(sessions, cfg);
    try {
      const s = await sessions.getOrCreate();
      await s.page.goto(fixture.url("/login.html"), { waitUntil: "domcontentloaded" });
      // Instrument the page to count mousemove events.
      await s.page.evaluate(() => {
        (window as unknown as { __moves: number }).__moves = 0;
        document.addEventListener("mousemove", () => {
          (window as unknown as { __moves: number }).__moves++;
        });
      });

      const snap = await tools.find((t) => t.name === "browser_snapshot")!.handler({ mode: "aom" });
      const yaml = (snap.content.find((c) => c.type === "text" && c.text.includes("[ref="))! as {
        text: string;
      }).text;
      const btnRef = yaml.match(/button\s+"submit"\s+\[ref=([a-zA-Z0-9]+)\]/)![1]!;
      await tools
        .find((t) => t.name === "browser_click")!
        .handler({ ref: btnRef, button: "left", clickCount: 1 });

      const moves = await s.page.evaluate(
        () => (window as unknown as { __moves: number }).__moves,
      );
      // A bezier path with our step sizing emits ≥12 moves for any non-zero
      // distance; raw locator.click() typically emits 0.
      expect(moves).toBeGreaterThan(5);
    } finally {
      await sessions.closeAll();
    }
  }, 45_000);

  it("respects SAB_HUMAN_MOUSE=false (no intermediate moves)", async () => {
    const cfg = { ...loadConfig(), headless: true, humanMouse: false };
    const sessions = new SessionManager(cfg);
    const tools = buildTools(sessions, cfg);
    try {
      const s = await sessions.getOrCreate();
      await s.page.goto(fixture.url("/login.html"), { waitUntil: "domcontentloaded" });
      await s.page.evaluate(() => {
        (window as unknown as { __moves: number }).__moves = 0;
        document.addEventListener("mousemove", () => {
          (window as unknown as { __moves: number }).__moves++;
        });
      });
      const snap = await tools.find((t) => t.name === "browser_snapshot")!.handler({ mode: "aom" });
      const yaml = (snap.content.find((c) => c.type === "text" && c.text.includes("[ref="))! as {
        text: string;
      }).text;
      const btnRef = yaml.match(/button\s+"submit"\s+\[ref=([a-zA-Z0-9]+)\]/)![1]!;
      await tools
        .find((t) => t.name === "browser_click")!
        .handler({ ref: btnRef, button: "left", clickCount: 1 });

      const moves = await s.page.evaluate(
        () => (window as unknown as { __moves: number }).__moves,
      );
      // Playwright's locator.click() may fire 1 mousemove at the destination
      // to prime :hover but never a trajectory. Allow up to 2.
      expect(moves).toBeLessThanOrEqual(2);
    } finally {
      await sessions.closeAll();
    }
  }, 45_000);
});
