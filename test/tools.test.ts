import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/session.js";
import { buildTools } from "../src/tools.js";
import { startFixtureServer, type TestServer } from "./server.js";

describe("tools end-to-end", () => {
  let fixture: TestServer;
  let sessions: SessionManager;
  let tools: ReturnType<typeof buildTools>;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    const cfg = { ...loadConfig(), headless: true };
    sessions = new SessionManager(cfg);
    tools = buildTools(sessions, cfg);
  }, 60_000);

  afterAll(async () => {
    await sessions.closeAll();
    await fixture.close();
  });

  function tool(name: string) {
    const t = tools.find((t) => t.name === name);
    if (!t) throw new Error(`missing tool ${name}`);
    return t;
  }

  it("navigate + click + type flow uses refs", async () => {
    const nav = await tool("browser_navigate").handler({
      url: fixture.url("/login.html"),
      waitUntil: "domcontentloaded",
      mode: "aom",
    });
    expect(nav.isError).not.toBe(true);
    const yamlBlock = nav.content.find((c) => c.type === "text" && c.text.includes("[ref="));
    expect(yamlBlock).toBeTruthy();
    const yaml = (yamlBlock as { text: string }).text;

    // Find the email textbox ref
    const emailMatch = yaml.match(/textbox\s+"email"\s+\[ref=([a-zA-Z0-9]+)\]/);
    expect(emailMatch).toBeTruthy();
    const emailRef = emailMatch![1]!;

    const typed = await tool("browser_type").handler({
      ref: emailRef,
      text: "claude@example.com",
      submit: false,
      clear: true,
    });
    expect(typed.isError).not.toBe(true);

    // Find the submit button ref (re-snapshot to get fresh refs)
    const snap2 = await tool("browser_snapshot").handler({ mode: "aom" });
    const yaml2 = (snap2.content.find(
      (c) => c.type === "text" && c.text.includes("[ref="),
    ) as { text: string }).text;
    const btnMatch = yaml2.match(/button\s+"submit"\s+\[ref=([a-zA-Z0-9]+)\]/);
    expect(btnMatch).toBeTruthy();
    const btnRef = btnMatch![1]!;

    const clicked = await tool("browser_click").handler({
      ref: btnRef,
      button: "left",
      clickCount: 1,
    });
    expect(clicked.isError).not.toBe(true);
  }, 45_000);

  it("scroll_read returns readable markdown", async () => {
    await tool("browser_navigate").handler({
      url: fixture.url("/login.html"),
      waitUntil: "domcontentloaded",
      mode: "aom",
    });
    const r = await tool("browser_scroll_read").handler({
      direction: "top",
      pixels: 800,
      deltaOnly: false,
    });
    expect(r.isError).not.toBe(true);
    const text = (r.content[0] as { text: string }).text;
    expect(text.toLowerCase()).toContain("fixture");
  }, 30_000);

  it("eval returns a JSON result", async () => {
    const r = await tool("browser_eval").handler({ expression: "1 + 1" });
    expect(r.isError).not.toBe(true);
    expect((r.content[0] as { text: string }).text).toBe("2");
  });
});
