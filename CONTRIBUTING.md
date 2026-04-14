# Contributing

Thanks for your interest! This project follows the conventions used across the [modelcontextprotocol](https://github.com/modelcontextprotocol) organisation.

## Ground rules

- **Apache-2.0** for all contributions. By submitting a PR you agree to license your work under it.
- **No `console.log`.** stdio MCP reserves stdout for JSON-RPC. Always use the `logger` (writes to stderr).
- **Refs are the only addressing scheme.** Do not introduce selector/CSS/XPath APIs to the agent tool surface.
- **Additions need tests.** `test/` uses a local HTTP fixture server; add a fixture page for each scenario.
- **Stealth changes need a bench run.** `npm run bench:stealth` must not regress.

## Development loop

```bash
npm install
npx playwright-core install chromium
npm run dev        # tsc watch
npm run test:watch
```

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`. Keep the subject < 72 chars. Body explains *why*, not *what*.

## Pull request checklist

- [ ] `npm run lint` passes (typecheck)
- [ ] `npm test` passes
- [ ] If stealth-adjacent, `npm run bench:stealth` passes with the same score or better
- [ ] Docs updated (README tool table, config env vars, or tool descriptions)
- [ ] No new `console.log` / stray stdout writes

## Reporting issues

Please include: OS, Node version, exact `SAB_*` env vars, and a minimal repro. For stealth regressions, include the output of `npm run bench:stealth`.
