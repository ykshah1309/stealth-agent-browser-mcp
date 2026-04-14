# stealth-agent-browser-mcp

A Model Context Protocol (MCP) server that gives AI agents a **stealth-grade Chromium browser** with a **hybrid Accessibility-Object-Model + Set-of-Mark vision** interface. Built for Claude, works with any MCP-compatible host.

- **Stealth first.** Uses [`rebrowser-playwright`](https://github.com/rebrowser/rebrowser-playwright) to patch the `Runtime.Enable` CDP leak that bypasses `playwright-extra`-class stealth plugins. Passes modern bot-detection suites (CreepJS, bot.sannysoft.com) where vanilla Playwright fails.
- **Token-lean by default.** `browser_snapshot` returns [Playwright aria snapshot](https://playwright.dev/docs/aria-snapshots) YAML (~2–5 KB) instead of raw HTML (100KB+). Every interactive element carries a `[ref=eN]` id that actions consume directly — no selectors, no drift.
- **Hybrid vision when it matters.** Ask for `mode: "hybrid"` and the server overlays numbered red boxes on the screenshot so the model can ground visually ([Set-of-Mark prompting, Yang et al.](https://arxiv.org/abs/2310.11441)). The ref ids on the image match the ids in the YAML. No parallel numbering scheme to go out of sync.
- **Readability-based content extraction.** `browser_scroll_read` runs [Mozilla Readability](https://github.com/mozilla/readability) through JSDOM and returns clean Markdown — optionally delta-only, so re-reads cost nothing when nothing changed.
- **Proxy-ready.** Per-session proxy auth, useful with residential pools.

> **Authorized use only.** Stealth tooling has legitimate applications (accessibility auditing, your-own-account automation, QA against sites you own or have permission to test). Do not use this server to violate a site's terms of service or applicable law. See [SECURITY.md](./SECURITY.md).

---

## Install

```bash
npm install -g stealth-agent-browser-mcp
# Chromium binary is fetched automatically on first launch
npx playwright-core install chromium
```

Or run without install via `npx stealth-agent-browser-mcp`.

## Quickstart (Claude Desktop / Claude Code / Cursor)

Add to your MCP config:

```json
{
  "mcpServers": {
    "stealth-browser": {
      "command": "npx",
      "args": ["-y", "stealth-agent-browser-mcp"],
      "env": {
        "SAB_HEADLESS": "true",
        "SAB_STEALTH_LEVEL": "patched"
      }
    }
  }
}
```

Restart the host. The agent will see the tools listed below.

## Tools

| Tool | Purpose |
|---|---|
| `browser_navigate` | Navigate a URL and return a snapshot. |
| `browser_snapshot` | `aom` (YAML only, cheapest), `vision` (raw screenshot), or `hybrid` (YAML + Set-of-Mark screenshot). |
| `browser_click` | Click an element by its `[ref=eN]`. |
| `browser_type` | Type into an input/textarea by ref. |
| `browser_select` | Choose options in a `<select>` by ref. |
| `browser_scroll_read` | Scroll and return Readability Markdown (delta-only by default). |
| `browser_wait_for` | Wait for text or a ref to become visible. |
| `browser_tabs` | `list` / `new` / `close` / `switch`. |
| `browser_eval` | Evaluate a JS expression in the page's MAIN world; JSON result. |
| `browser_set_proxy` | Update single-proxy config (effective after `browser_restart`). |
| `browser_set_proxy_pool` | Replace residential proxy pool at runtime (effective after `browser_restart`). |
| `browser_solve_captcha` | Fallback captcha solver (CapSolver / 2Captcha). Detects Turnstile/hCaptcha/reCAPTCHA on the page. |
| `browser_restart` | Close + re-open the active browser session with current config. |

All action tools are addressed by the **ref** emitted in the last AOM snapshot. Refs are Playwright's own `aria-ref=eN` ids — there is no parallel numbering scheme.

## Configuration

All via environment variables:

| Var | Default | Notes |
|---|---|---|
| `SAB_HEADLESS` | `true` | `false` for a visible window (debugging). |
| `SAB_STEALTH_LEVEL` | `patched` | `off` \| `patched` \| `paranoid`. |
| `SAB_PROXY_SERVER` | — | Single-proxy mode. e.g. `http://host:port` |
| `SAB_PROXY_USERNAME` / `SAB_PROXY_PASSWORD` | — | |
| `SAB_PROXY_POOL` | — | Residential pool. Comma-separated URLs (`http://u:p@host:port,...`) or a JSON array of `{server, username, password}`. |
| `SAB_PROXY_ROTATION` | `per-restart` | `per-session` \| `per-restart` \| `static`. |
| `SAB_PROXY_STICKY_TEMPLATE` | — | Username template for sticky-IP providers. `${sessionId}` interpolates. Example: `brd-customer-c1-zone-res-session-${sessionId}`. |
| `SAB_HUMAN_MOUSE` | `true` | Bezier-path click with pre-click hesitation. Defeats Datadome trajectory analysis. |
| `SAB_CAPTCHA_PROVIDER` | `none` | `capsolver` \| `twocaptcha` \| `none`. |
| `SAB_CAPTCHA_API_KEY` | — | Provider API key. |
| `SAB_USER_DATA_DIR` | — | Persistent profile directory (cookies build reputation). |
| `SAB_DEFAULT_TIMEOUT_MS` | `15000` | Per-action timeout. |
| `SAB_MAX_ANNOTATED` | `75` | Max labelled boxes in hybrid mode. |
| `SAB_VIEWPORT_W` / `SAB_VIEWPORT_H` | `1366` / `768` | |
| `SAB_LOCALE` | `en-US` | |
| `SAB_TIMEZONE` | `America/New_York` | |
| `LOG_LEVEL` | `info` | `debug`, `warn`, etc. Always writes to stderr. |

## Architecture

```
src/
├── index.ts         # Entry (stdio)
├── server.ts        # MCP server + tool registration
├── tools.ts         # Tool handlers
├── browser.ts       # Stealth Chromium launcher (rebrowser-playwright)
├── session.ts       # Per-connection browser/context/page state
├── snapshot.ts      # AOM + Set-of-Mark pipeline
├── annotate.ts      # SVG overlay compositing (sharp)
├── reader.ts        # Readability → Markdown (pierces open shadow roots)
├── fingerprint.ts   # Rotatable UA/viewport/timezone profiles
├── proxy.ts         # Residential pool + rotation + sticky-session template
├── human-mouse.ts   # Bezier-curve cursor paths (ghost-cursor math)
├── captcha.ts       # CapSolver / 2Captcha REST adapters
├── config.ts        # Zod-validated env config
└── logger.ts        # pino → stderr (never stdout)
```

All logs go to **stderr** — stdout is reserved for JSON-RPC. Never add `console.log`.

## TLS / JA3 fingerprint — why there is no Node-layer spoofer here

A common ask for scrapers is: *"spoof the TLS ClientHello (JA3) to look like Chrome, via curl-impersonate or node-tls-client."*

**That applies to Node-layer HTTP scrapers** (`fetch`, `got`, `axios`) where the TCP connection originates from Node's OpenSSL, which emits a ClientHello signature distinct from Chrome's BoringSSL — and Cloudflare / Akamai Bot Manager drop it at the network layer before a single byte of JavaScript runs.

**This MCP does not have that architecture.** Every request exits through Chromium. Chromium's TLS stack *is* Chrome's TLS stack (literally the same BoringSSL build), so the ClientHello JA3 is Chrome's JA3 by construction. No JS-level rewriting is possible or necessary.

The one place TLS can still betray you is if you route through a proxy that terminates and re-initiates TLS (MITM). Residential proxy providers (Bright Data, DataImpulse, Oxylabs residential, SOAX) route at TCP — they do not MITM TLS — and the Chromium handshake reaches the origin unmodified. The products that *do* MITM TLS are managed scraping browsers (Bright Data's Scraping Browser, Oxylabs Web Unblocker), which ship their own headless Chrome and replace this MCP rather than layering on top of it.

**Bottom line:** with `rebrowser-playwright` + residential pool (P1) + human mouse (P2), the TLS fingerprint, CDP runtime, DOM surface, and behavioral layer all match real Chrome. Captcha solving (P3) is a fallback for the 1–5% of sessions that still get flagged.

## Benchmarks

`npm run bench:stealth` launches the configured browser against public bot-detection test pages (bot.sannysoft.com, CreepJS, pixelscan, BrowserLeaks WebRTC) and reports pass/fail. These are the same harnesses used by the `rebrowser-patches` and Patchright projects — see [rebrowser-bot-detector](https://github.com/rebrowser/rebrowser-bot-detector) for the reference suite.

Typical local-fixture test run (see `test/`):

| Test | Result |
|---|---|
| AOM YAML contains refs for all interactive elements | ✓ |
| `hybrid` mode returns PNG + YAML, refs match | ✓ |
| `click`/`type` by ref produces expected DOM change | ✓ |
| Readability extracts article to Markdown | ✓ |
| Delta-only scroll returns `(no readable content change)` on repeat | ✓ |

## Comparison

|  | stealth-agent-browser-mcp | [playwright-mcp](https://github.com/microsoft/playwright-mcp) | [browser-use MCP](https://docs.browser-use.com/customize/integrations/mcp-server) | [computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) |
|---|---|---|---|---|
| CDP-level stealth (Cloudflare/DataDome) | ✓ | ✗ | partial | ✗ |
| Accessibility-tree snapshots | ✓ | ✓ | ✓ | ✗ |
| Set-of-Mark vision (ref-labeled screenshot) | ✓ | ✗ | ✗ | pure vision |
| Readability-based scroll-and-read | ✓ | ✗ | ✗ | ✗ |
| Token-lean by default | ✓ | ✓ | ✗ | ✗ |
| Bundled agent loop | ✗ (host's model drives) | ✗ | ✓ | ✗ |

## Development

```bash
npm install
npx playwright-core install chromium
npm run build
npm test
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributions under Apache-2.0.

## License

[Apache-2.0](./LICENSE)
