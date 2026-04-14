# Changelog

All notable changes to this project will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

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
