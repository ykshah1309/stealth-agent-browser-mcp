import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/session.js";
import { takeSnapshot, extractRefs } from "../src/snapshot.js";
import { readableMarkdown } from "../src/reader.js";
import { startFixtureServer, type TestServer } from "./server.js";

describe("snapshot pipeline", () => {
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

  it("extracts refs from an aria snapshot YAML", () => {
    const yaml = `- heading "Sign in" [level=1] [ref=e1]\n- textbox "email" [ref=e2]`;
    expect(extractRefs(yaml)).toEqual(["e1", "e2"]);
  });

  it("aom mode returns YAML with refs and no image", async () => {
    const s = await sessions.getOrCreate();
    await s.page.goto(fixture.url("/login.html"));
    const snap = await takeSnapshot(s.page, "aom", { maxAnnotated: 50 });
    expect(snap.url).toContain("login.html");
    expect(snap.aom).toBeTruthy();
    expect(snap.refs.length).toBeGreaterThan(0);
    expect(snap.screenshotBase64).toBeUndefined();
  }, 30_000);

  it("hybrid mode returns both YAML and annotated image", async () => {
    const s = await sessions.getOrCreate();
    await s.page.goto(fixture.url("/login.html"));
    const snap = await takeSnapshot(s.page, "hybrid", { maxAnnotated: 50 });
    expect(snap.aom).toBeTruthy();
    expect(snap.screenshotBase64).toBeTruthy();
    // Base64 PNG starts with iVBORw when decoded properly.
    const header = Buffer.from(snap.screenshotBase64!.slice(0, 16), "base64").toString("hex");
    expect(header.startsWith("89504e47")).toBe(true);
  }, 30_000);

  it("readability extracts the article section to markdown", async () => {
    const s = await sessions.getOrCreate();
    await s.page.goto(fixture.url("/login.html"));
    const r = await readableMarkdown(s.page, null);
    expect(r.markdown.length).toBeGreaterThan(0);
    expect(r.wordCount).toBeGreaterThan(0);
  }, 30_000);
});
