import { describe, expect, it } from "vitest";
import {
  ProxyPool,
  interpolateStickyUsername,
  parseProxyPool,
} from "../src/proxy.js";

describe("proxy pool — parsing, rotation, sticky sessions", () => {
  it("parses comma-separated URL list with embedded auth", () => {
    const entries = parseProxyPool(
      "http://user1:pass1@host1.example.com:8000,http://host2.example.com:8001",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      server: "http://host1.example.com:8000",
      username: "user1",
      password: "pass1",
    });
    expect(entries[1]).toEqual({ server: "http://host2.example.com:8001" });
  });

  it("parses JSON array form", () => {
    const json = JSON.stringify([
      { server: "http://a.example.com:7000", username: "u", password: "p" },
      { server: "http://b.example.com:7000" },
    ]);
    const entries = parseProxyPool(json);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.username).toBe("u");
  });

  it("returns [] on empty / malformed input without throwing", () => {
    expect(parseProxyPool(undefined)).toEqual([]);
    expect(parseProxyPool("")).toEqual([]);
    expect(parseProxyPool("not a url,also-bad")).toEqual([]);
    // malformed JSON falls back to empty (not crash)
    expect(parseProxyPool("[{broken}")).toEqual([]);
  });

  it("per-session rotation advances on each next() call", () => {
    const pool = new ProxyPool(
      [
        { server: "http://a:1" },
        { server: "http://b:1" },
        { server: "http://c:1" },
      ],
      "per-session",
    );
    const a = pool.next("s1");
    const b = pool.next("s2");
    const c = pool.next("s3");
    const d = pool.next("s4"); // wraps
    expect(a?.server).toBe("http://a:1");
    expect(b?.server).toBe("http://b:1");
    expect(c?.server).toBe("http://c:1");
    expect(d?.server).toBe("http://a:1");
  });

  it("static rotation always returns the first entry", () => {
    const pool = new ProxyPool(
      [{ server: "http://a:1" }, { server: "http://b:1" }],
      "static",
    );
    expect(pool.next("x")?.server).toBe("http://a:1");
    expect(pool.next("y")?.server).toBe("http://a:1");
  });

  it("sticky username template interpolates ${sessionId}", () => {
    const v = interpolateStickyUsername("brd-customer-c1234-zone-res-session-${sessionId}", {
      sessionId: "abc-xyz",
    });
    expect(v).toBe("brd-customer-c1234-zone-res-session-abc-xyz");
  });

  it("sticky username flows through ProxyPool.next()", () => {
    const pool = new ProxyPool(
      [{ server: "http://brd.superproxy.io:22225", password: "secret" }],
      "per-session",
      "brd-customer-c1-zone-res-session-${sessionId}",
    );
    const r = pool.next("session-42");
    expect(r?.username).toBe("brd-customer-c1-zone-res-session-session-42");
    expect(r?.password).toBe("secret");
  });

  it("returns undefined when pool is empty", () => {
    const pool = new ProxyPool([], "per-session");
    expect(pool.next("x")).toBeUndefined();
  });
});
