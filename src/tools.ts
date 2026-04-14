import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "rebrowser-playwright";
import type { Config } from "./config.js";
import type { Session, SessionManager } from "./session.js";
import { takeSnapshot, type SnapshotMode, type SnapshotResult } from "./snapshot.js";
import { readableMarkdown } from "./reader.js";
import { solveCaptcha } from "./captcha.js";
import { logger } from "./logger.js";

export const SnapshotModeSchema = z.enum(["aom", "vision", "hybrid"]).default("aom");

const NavigateInput = {
  url: z.string().url().describe("Fully-qualified URL to navigate to."),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle", "commit"])
    .default("domcontentloaded")
    .describe("Page lifecycle event to wait for."),
  mode: SnapshotModeSchema.describe(
    "Snapshot mode to return after navigation. 'aom' is cheapest; 'hybrid' adds a Set-of-Mark annotated screenshot.",
  ),
};

const SnapshotInput = {
  mode: SnapshotModeSchema.describe(
    "'aom' = accessibility YAML only (cheap). 'vision' = raw screenshot. 'hybrid' = YAML + screenshot with red-boxed refs overlaid.",
  ),
};

const ClickInput = {
  ref: z.string().describe("A [ref=eN] id taken from the last aom/hybrid snapshot."),
  button: z.enum(["left", "right", "middle"]).default("left"),
  clickCount: z.number().int().min(1).max(3).default(1),
};

const TypeInput = {
  ref: z.string().describe("Ref of an input/textarea element."),
  text: z.string(),
  submit: z.boolean().default(false).describe("Press Enter after typing."),
  clear: z.boolean().default(true).describe("Clear the field before typing."),
};

const SelectInput = {
  ref: z.string(),
  values: z.array(z.string()).min(1),
};

const ScrollReadInput = {
  direction: z.enum(["down", "up", "top", "bottom"]).default("down"),
  pixels: z.number().int().positive().default(800),
  deltaOnly: z
    .boolean()
    .default(true)
    .describe("Return markdown only if the readable content changed since the last call."),
};

const WaitForInput = {
  text: z.string().optional().describe("Substring to wait for in page text."),
  ref: z.string().optional().describe("Ref that must resolve to a visible element."),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
};

const TabsInput = {
  action: z.enum(["list", "new", "close", "switch"]),
  index: z.number().int().nonnegative().optional(),
  url: z.string().url().optional(),
};

const EvalInput = {
  expression: z
    .string()
    .describe(
      "JS expression (not a statement). Executes in the page's MAIN execution world — observable by page scripts. Use sparingly; prefer AOM + actions.",
    ),
};

const ProxyInput = {
  server: z.string().optional().describe("e.g. http://host:port — omit to clear."),
  username: z.string().optional(),
  password: z.string().optional(),
};

const RestartInput = {} as z.ZodRawShape;

const CaptchaInput = {
  type: z
    .enum(["turnstile", "hcaptcha", "recaptcha-v2", "recaptcha-v3"])
    .optional()
    .describe("Override auto-detection. Otherwise the active page is scanned for a known widget."),
  sitekey: z.string().optional().describe("Provide explicitly when auto-detection fails."),
  pageUrl: z
    .string()
    .url()
    .optional()
    .describe("Page URL the captcha is bound to. Defaults to the current page."),
};

const ProxyPoolInput = {
  pool: z
    .string()
    .optional()
    .describe(
      "Residential proxy pool: comma-separated URLs (http://u:p@host:port) or a JSON array. Omit to clear.",
    ),
  rotation: z
    .enum(["per-session", "per-restart", "static"])
    .optional()
    .describe("Rotation strategy. Default: per-restart."),
};

// Wait for the page to settle after a user-triggered mutation. Modern SPAs
// with telemetry, WebSockets, or background polling never reach Playwright's
// `networkidle` — an earlier revision waited out a 1.5s timeout on every
// click, injecting ~1.65s of dead latency. We now rely on a short DOM-quiet
// debounce: `domcontentloaded` (instantly satisfied if already past it) plus
// a brief delay for modal/animation paint.
export async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
  } catch {
    /* best-effort */
  }
  await page.waitForTimeout(250);
}

function fmtSnapshot(s: SnapshotResult): CallToolResult {
  const content: CallToolResult["content"] = [];
  const header = [
    `url: ${s.url}`,
    `title: ${s.title}`,
    `refs: ${s.refs.length}${s.truncatedTo ? ` (annotated ${s.truncatedTo})` : ""}`,
  ].join("\n");
  content.push({ type: "text", text: header });
  if (s.aom) content.push({ type: "text", text: "```yaml\n" + s.aom + "\n```" });
  if (s.screenshotBase64) {
    content.push({ type: "image", data: s.screenshotBase64, mimeType: "image/png" });
  }
  return { content };
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(err: unknown): CallToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

async function refLocator(session: Session, ref: string) {
  return session.page.locator(`aria-ref=${ref}`).first();
}

// Any action that mutates the DOM invalidates the read-delta cache, otherwise
// a later scroll_read(deltaOnly=true) might report "no change" against a hash
// taken before the mutation and lock the agent out of the fresh content.
function invalidateReadCache(session: Session): void {
  session.lastReadHash = null;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export function buildTools(sessions: SessionManager, config: Config): ToolDef[] {
  const maxAnnotated = config.maxAnnotatedElements;

  return [
    {
      name: "browser_navigate",
      description:
        "Navigate the active session's page to a URL. Returns a snapshot (default: aom-only, cheapest).",
      inputSchema: NavigateInput,
      handler: async (args) => {
        const input = z.object(NavigateInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          await s.page.goto(input.url, {
            waitUntil: input.waitUntil,
            timeout: config.defaultTimeoutMs,
          });
          invalidateReadCache(s);
          const snap = await takeSnapshot(s.page, input.mode, { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Take a snapshot of the current page. 'aom' returns the accessibility YAML (token-lean); 'hybrid' adds a Set-of-Mark screenshot with numeric red boxes matching each ref.",
      inputSchema: SnapshotInput,
      handler: async (args) => {
        const input = z.object(SnapshotInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const snap = await takeSnapshot(s.page, input.mode as SnapshotMode, { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_click",
      description:
        "Click an element addressed by its ref. When SAB_HUMAN_MOUSE=true (default), the cursor travels via a Bezier path with pre-click hesitation — this defeats trajectory analyzers like Datadome that flag teleporting mice.",
      inputSchema: ClickInput,
      handler: async (args) => {
        const input = z.object(ClickInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const loc = await refLocator(s, input.ref);
          if (s.humanMouse && input.clickCount === 1) {
            // Human-style path. Double/triple clicks use Playwright's direct
            // click to preserve exact inter-click timing expected by the UI.
            await s.humanMouse.click(loc, { button: input.button });
          } else {
            await loc.click({
              button: input.button,
              clickCount: input.clickCount,
              timeout: config.defaultTimeoutMs,
            });
          }
          invalidateReadCache(s);
          await settle(s.page);
          const snap = await takeSnapshot(s.page, "aom", { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_type",
      description: "Type into an input or textarea addressed by ref.",
      inputSchema: TypeInput,
      handler: async (args) => {
        const input = z.object(TypeInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const loc = await refLocator(s, input.ref);
          if (input.clear) await loc.fill("");
          await loc.pressSequentially(input.text, { delay: 12 });
          if (input.submit) await loc.press("Enter");
          invalidateReadCache(s);
          await settle(s.page);
          const snap = await takeSnapshot(s.page, "aom", { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_select",
      description: "Select one or more options in a <select> addressed by ref.",
      inputSchema: SelectInput,
      handler: async (args) => {
        const input = z.object(SelectInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const loc = await refLocator(s, input.ref);
          await loc.selectOption(input.values);
          invalidateReadCache(s);
          await settle(s.page);
          const snap = await takeSnapshot(s.page, "aom", { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_scroll_read",
      description:
        "Scroll and return a Readability-extracted Markdown view. With deltaOnly=true, returns '(no change)' if nothing new became visible — keeps context windows lean.",
      inputSchema: ScrollReadInput,
      handler: async (args) => {
        const input = z.object(ScrollReadInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const px =
            input.direction === "up"
              ? -input.pixels
              : input.direction === "down"
                ? input.pixels
                : 0;
          if (input.direction === "top") {
            await s.page.evaluate(() => window.scrollTo(0, 0));
          } else if (input.direction === "bottom") {
            await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          } else {
            await s.page.evaluate((dy: number) => window.scrollBy(0, dy), px);
          }
          // Same rationale as settle(): no networkidle. Short debounce covers
          // lazy-load/image-decoding without taxing polling SPAs.
          await s.page.waitForTimeout(200);

          const r = await readableMarkdown(s.page, input.deltaOnly ? s.lastReadHash : null);
          s.lastReadHash = r.contentHash;

          if (input.deltaOnly && !r.delta && r.wordCount === 0) {
            return textResult("(no readable content change)");
          }

          const header = `# ${r.title}\n\n_${r.wordCount} words — excerpt: ${r.excerpt.slice(0, 140)}_\n\n`;
          return textResult(header + r.markdown);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_wait_for",
      description:
        "Wait until either some text appears on the page or a given ref resolves to a visible element.",
      inputSchema: WaitForInput,
      handler: async (args) => {
        const input = z.object(WaitForInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          if (input.text) {
            await s.page
              .getByText(input.text, { exact: false })
              .first()
              .waitFor({ state: "visible", timeout: input.timeoutMs });
          } else if (input.ref) {
            await s.page
              .locator(`aria-ref=${input.ref}`)
              .first()
              .waitFor({ state: "visible", timeout: input.timeoutMs });
          } else {
            return errorResult("provide 'text' or 'ref'");
          }
          const snap = await takeSnapshot(s.page, "aom", { maxAnnotated });
          return fmtSnapshot(snap);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_tabs",
      description: "Manage browser tabs: list, new, close, switch.",
      inputSchema: TabsInput,
      handler: async (args) => {
        const input = z.object(TabsInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const pages = s.context.pages();
          if (input.action === "list") {
            const rows = await Promise.all(
              pages.map(async (p, i) => {
                const t = await p.title().catch(() => "");
                return `${i === pages.indexOf(s.page) ? "*" : " "} [${i}] ${p.url()} — ${t}`;
              }),
            );
            return textResult(rows.join("\n") || "(no tabs)");
          }
          if (input.action === "new") {
            const np = await s.context.newPage();
            if (input.url) await np.goto(input.url, { waitUntil: "domcontentloaded" });
            s.page = np;
            invalidateReadCache(s);
            return textResult(`opened tab: ${np.url()}`);
          }
          if (input.action === "close") {
            if (input.index === undefined) return errorResult("index required");
            const target = pages[input.index];
            if (!target) return errorResult("tab index out of range");
            await target.close();
            const remaining = s.context.pages();
            if (remaining.length > 0) s.page = remaining[0]!;
            invalidateReadCache(s);
            return textResult(`closed tab ${input.index}`);
          }
          if (input.action === "switch") {
            if (input.index === undefined) return errorResult("index required");
            const target = pages[input.index];
            if (!target) return errorResult("tab index out of range");
            s.page = target;
            invalidateReadCache(s);
            return textResult(`switched to tab ${input.index}: ${target.url()}`);
          }
          return errorResult("unknown action");
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_eval",
      description:
        "Evaluate a JS EXPRESSION in the page's MAIN execution world. Observable by page scripts; use sparingly. Prefer AOM + action tools.",
      inputSchema: EvalInput,
      handler: async (args) => {
        const input = z.object(EvalInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const result = await s.page.evaluate(`(() => (${input.expression}))()`);
          invalidateReadCache(s);
          return textResult(JSON.stringify(result));
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_set_proxy",
      description:
        "Update the proxy config. Call 'browser_restart' after this for the change to take effect (browser-level constraint — an existing context cannot be re-routed).",
      inputSchema: ProxyInput,
      handler: async (args) => {
        const input = z.object(ProxyInput).parse(args);
        config.proxyServer = input.server;
        config.proxyUsername = input.username;
        config.proxyPassword = input.password;
        logger.info({ proxy: Boolean(config.proxyServer) }, "proxy updated");
        return textResult(
          `proxy set to ${config.proxyServer ?? "(none)"}. Call browser_restart to apply.`,
        );
      },
    },
    {
      name: "browser_restart",
      description:
        "Close the active browser session and start a fresh one with the current config. Required after 'browser_set_proxy' to actually route new requests through the proxy.",
      inputSchema: RestartInput,
      handler: async () => {
        try {
          await sessions.restart();
          return textResult("session restarted with current config");
        } catch (e) {
          return errorResult(e);
        }
      },
    },
    {
      name: "browser_set_proxy_pool",
      description:
        "Replace the residential proxy pool at runtime. Takes effect on the next 'browser_restart'. Supports sticky sessions via SAB_PROXY_STICKY_TEMPLATE.",
      inputSchema: ProxyPoolInput,
      handler: async (args) => {
        const input = z.object(ProxyPoolInput).parse(args);
        sessions.setProxyPool(input.pool, input.rotation);
        return textResult(
          `proxy pool size: ${sessions.poolSize()}. Call browser_restart to cycle.`,
        );
      },
    },
    {
      name: "browser_solve_captcha",
      description:
        "Fallback captcha solver. Detects Turnstile/hCaptcha/reCAPTCHA on the current page (or takes an explicit sitekey), submits to the configured provider (CapSolver or 2Captcha per SAB_CAPTCHA_PROVIDER + SAB_CAPTCHA_API_KEY), polls for a token, and injects it into the widget's response field.",
      inputSchema: CaptchaInput,
      handler: async (args) => {
        const input = z.object(CaptchaInput).parse(args);
        const s = await sessions.getOrCreate();
        try {
          const override: Parameters<typeof solveCaptcha>[2] = {};
          if (input.type) override.type = input.type;
          if (input.sitekey) override.sitekey = input.sitekey;
          if (input.pageUrl) override.pageUrl = input.pageUrl;
          const r = await solveCaptcha(s.page, config, override);
          if ("error" in r) return errorResult(r.error);
          return textResult(`solved ${r.type}; token=${r.tokenPreview}`);
        } catch (e) {
          return errorResult(e);
        }
      },
    },
  ];
}
