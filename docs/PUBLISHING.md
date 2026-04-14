# Publishing

## npm

1. Bump the version in `package.json` and `server.json` (keep them in sync).
2. Update `CHANGELOG.md`.
3. Create a GitHub release. The `publish.yml` workflow publishes to npm with provenance using the `NPM_TOKEN` secret.

Manual fallback:

```bash
npm login
npm run build
npm publish --access public
```

## MCP Registry

The Registry reads `server.json` from the published npm tarball (or a GitHub release). The name field must match your authenticated namespace:

- `io.github.<user>/<repo>` requires a GitHub-auth'd publish via the `mcp-publisher` CLI
- `io.npmjs.<scope>/<name>` requires npm-auth

Steps:

1. Install the publisher: `npm install -g @modelcontextprotocol/publisher` (or the current equivalent — see [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)).
2. `mcp-publisher login github` (or `npm`).
3. `mcp-publisher publish server.json`

The Registry validates:

- `name` namespace ownership
- `packages[].identifier` exists at the declared registry (npm package must be public and match `version`)
- Schema conformance against `https://static.modelcontextprotocol.io/schemas/.../server.schema.json`

Once accepted, the server appears in MCP-host registries automatically.
