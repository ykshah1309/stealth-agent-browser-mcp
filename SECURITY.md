# Security & Responsible Use

## Reporting vulnerabilities

Please **do not** open public issues for security reports. Email the maintainers directly (see `package.json` → `author`) with:

- A description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Any suggested mitigation

You can expect an acknowledgement within 72 hours.

## Responsible use policy

This server provides anti-detection features. Those features exist to support **authorized** use cases:

- Accessibility and QA automation against sites you own or are contracted to test
- Automation of your own logged-in accounts
- Security research within scope of a written authorization (pentest, bug bounty)
- Educational and research contexts (CTFs, course material)

**Out of scope and not supported:**

- Evading detection to violate a website's Terms of Service
- Circumventing access controls you are not authorized to bypass
- Mass credential testing, account takeover, or automated harassment
- Any use that would violate applicable law in your jurisdiction

The maintainers will refuse to assist with issues that clearly describe abusive use.

## Operational security

- The `browser_eval_safe` tool evaluates agent-supplied JavaScript in the page. Treat the agent's input as untrusted — do not expose this MCP server to untrusted LLMs on hosts with sensitive local state.
- Persistent profiles (`SAB_USER_DATA_DIR`) store cookies and storage on disk. Protect the directory accordingly.
- Proxy credentials are passed to Chromium via launch args; on multi-user hosts they may be briefly visible in `ps` output.
