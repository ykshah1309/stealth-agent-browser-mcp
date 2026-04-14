# Changelog

All notable changes to this project will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-14

### Added
- **Residential proxy pool** (`SAB_PROXY_POOL`) with three rotation strategies (`per-session`, `per-restart`, `static`) and sticky-session username templates (`SAB_PROXY_STICKY_TEMPLATE` with `${sessionId}` interpolation) for Bright Data / DataImpulse / Oxylabs-style backends. New `browser_set_proxy_pool` tool cycles the pool at runtime.
- **Human-like mouse paths** (`SAB_HUMAN_MOUSE`, default on). `browser_click` now drives the cursor through a Bezier curve (ghost-cursor math module, Playwright mouse driver) with pre-click hesitation. Defeats trajectory analysis employed by Datadome and similar. Falls back to `locator.click()` for double/triple clicks.
- **Captcha solver** (`SAB_CAPTCHA_PROVIDER`, `SAB_CAPTCHA_API_KEY`). New `browser_solve_captcha` tool. Auto-detects Turnstile / hCaptcha / reCAPTCHA v2+v3 on the active page, submits sitekey+URL to CapSolver or 2Captcha, polls for the token, and injects it into the widget's response field. Intended as a fallback when fingerprint + proxy rotation fail.

### Documentation
- README now includes a **TLS / JA3 architecture note** explaining why no Node-layer TLS spoofing is needed: all traffic exits through Chromium's BoringSSL, which emits Chrome's real ClientHello. Node-layer spoofing (`curl-impersonate`, `node-tls-client`) applies only to pure-Node HTTP scrapers that bypass the browser.

## [0.1.2] - 2026-04-14

### Fixed
- **Latency tax (Round 2 audit #1):** `settle()` no longer awaits `networkidle`. Modern SPAs with background polling never reach true network idle, so the old path paid the full 1.5s timeout on every click/type/select. Replaced with `domcontentloaded` + 250ms debounce. `browser_scroll_read` same treatment.
- **Shadow DOM blindness (Round 2 audit #2):** `reader.ts` now pierces open shadow roots via a page-side recursive clone (with `<slot>` expansion via `assignedNodes`). The AOM snapshot already pierced shadow DOM; the reader did not — producing hallucination when agents tried to read context around web-component refs. Closed shadow roots remain inaccessible by spec.
- **Restart race (Round 2 audit #3):** `SessionManager.restart()` now holds `initPromise` synchronously for the entire close+create window. Previously, a parallel `browser_navigate` firing during the close phase would see an empty session map and null mutex, spawning a twin Chromium.
- **Deprecated Playwright API (Round 2 audit #4):** `browser_type` migrated from `locator.type()` to `locator.pressSequentially()`. Eliminates deprecation warnings in host stderr.

### Added
- Round 2 regression tests: settle-latency budget, shadow-DOM piercing, restart-race concurrency, pressSequentially smoke.
- Test fixtures: `shadow.html` (custom element with open shadow root + slotted light DOM), `polling.html` (continuous background XHR).

## [0.1.1] - 2026-04-13

### Changed
- Added `mcpName` field to `package.json` (required by the MCP Registry publisher).
- Trimmed server.json description to ≤100 chars to pass registry validation.

## [0.1.0] - 2026-04-13

### Added
- Initial MCP server with stdio transport
- Stealth Chromium launcher via `rebrowser-playwright`
- AOM snapshot pipeline using `ariaSnapshot({ ref: true })`
- Set-of-Mark screenshot annotator (sharp-based SVG overlay) with sweet-spot ranking (400–10k px² interactive controls prioritized over large overlay divs)
- Readability-based `browser_scroll_read` with SHA-1 delta detection
- Tool surface: `navigate`, `snapshot`, `click`, `type`, `select`, `scroll_read`, `wait_for`, `tabs`, `eval`, `set_proxy`, `restart`
- Per-session rotatable fingerprint profiles
- Concurrency-safe session manager (mutex on cold-start)
- `settle()` debounce after every DOM-mutating action so snapshots reflect post-mutation state
- Heavy-node stripping (`<svg>`, `<canvas>`, `<video>`, `<audio>`, `<iframe>`, `<noscript>`) in reader to avoid Turndown recursion spikes
- Benchmark harness against public bot-detection test pages
- vitest test suite: 17 tests across snapshot, tools, audit regressions, and full stdio MCP integration
