import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/session.js";
import { detectCaptcha, injectToken } from "../src/captcha.js";
import { startFixtureServer, type TestServer } from "./server.js";

// Provider API calls are NOT exercised end-to-end (would require a live
// CapSolver/2Captcha key + funds). We verify the two pieces that don't
// involve the network: widget detection and token injection.
describe("captcha — detection + token injection", () => {
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

  it("detectCaptcha finds a Turnstile widget by data-sitekey", async () => {
    const s = await sessions.getOrCreate();
    await s.page.goto(fixture.url("/turnstile.html"), { waitUntil: "domcontentloaded" });
    const target = await detectCaptcha(s.page);
    expect(target).not.toBeNull();
    expect(target?.type).toBe("turnstile");
    expect(target?.sitekey).toBe("0x4AAAAAAA_test_sitekey");
  }, 30_000);

  it("injectToken populates the widget's response field", async () => {
    const s = await sessions.getOrCreate();
    await s.page.goto(fixture.url("/turnstile.html"), { waitUntil: "domcontentloaded" });
    await injectToken(s.page, "turnstile", "FAKE_TOKEN_12345");
    const value = await s.page.evaluate(
      () =>
        (document.getElementsByName("cf-turnstile-response")[0] as HTMLInputElement | undefined)
          ?.value,
    );
    expect(value).toBe("FAKE_TOKEN_12345");
  }, 30_000);
});
