import type { Page } from "rebrowser-playwright";
import type { Config } from "./config.js";
import { logger } from "./logger.js";

// Captcha solver is a FALLBACK. If TLS/JA3 (real Chromium) + residential proxy
// rotation + human mouse paths are all in play, CAPTCHA hits should be rare.
// When they do hit, the API providers below expose a common REST pattern:
// submit (sitekey, pageUrl) → receive a task id → poll until solved → inject
// the solution token back into the page's form field.

export type CaptchaType = "turnstile" | "hcaptcha" | "recaptcha-v2" | "recaptcha-v3";

export interface CaptchaTarget {
  type: CaptchaType;
  sitekey: string;
  pageUrl: string;
}

// Inline signatures for each supported provider. Structure, not behavior —
// kept here rather than split across files because the whole flow is <150 lines.
interface Provider {
  name: "capsolver" | "twocaptcha";
  createTask(key: string, target: CaptchaTarget): Promise<string>; // returns task id
  pollResult(key: string, taskId: string): Promise<string>; // returns token
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

const capsolver: Provider = {
  name: "capsolver",
  async createTask(key, target) {
    const taskTypeMap: Record<CaptchaType, string> = {
      turnstile: "AntiTurnstileTaskProxyLess",
      hcaptcha: "HCaptchaTaskProxyLess",
      "recaptcha-v2": "ReCaptchaV2TaskProxyLess",
      "recaptcha-v3": "ReCaptchaV3TaskProxyLess",
    };
    const res = await fetch("https://api.capsolver.com/createTask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientKey: key,
        task: {
          type: taskTypeMap[target.type],
          websiteURL: target.pageUrl,
          websiteKey: target.sitekey,
        },
      }),
    });
    const json = (await res.json()) as { taskId?: string; errorDescription?: string };
    if (!json.taskId) throw new Error(`capsolver createTask failed: ${json.errorDescription}`);
    return json.taskId;
  },
  async pollResult(key, taskId) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await fetch("https://api.capsolver.com/getTaskResult", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
      });
      const json = (await res.json()) as {
        status?: string;
        solution?: { token?: string; gRecaptchaResponse?: string };
        errorDescription?: string;
      };
      if (json.status === "ready") {
        const token = json.solution?.token ?? json.solution?.gRecaptchaResponse;
        if (!token) throw new Error("capsolver ready but no token in solution");
        return token;
      }
      if (json.status && json.status !== "processing") {
        throw new Error(`capsolver error: ${json.errorDescription ?? json.status}`);
      }
    }
    throw new Error("capsolver poll timed out");
  },
};

const twocaptcha: Provider = {
  name: "twocaptcha",
  async createTask(key, target) {
    const methodMap: Record<CaptchaType, string> = {
      turnstile: "turnstile",
      hcaptcha: "hcaptcha",
      "recaptcha-v2": "userrecaptcha",
      "recaptcha-v3": "userrecaptcha",
    };
    const url = new URL("https://2captcha.com/in.php");
    url.searchParams.set("key", key);
    url.searchParams.set("method", methodMap[target.type]);
    url.searchParams.set("sitekey", target.sitekey);
    url.searchParams.set("pageurl", target.pageUrl);
    url.searchParams.set("json", "1");
    if (target.type === "recaptcha-v3") url.searchParams.set("version", "v3");
    const res = await fetch(url);
    const json = (await res.json()) as { status?: number; request?: string };
    if (json.status !== 1 || !json.request)
      throw new Error(`twocaptcha in.php failed: ${JSON.stringify(json)}`);
    return json.request;
  },
  async pollResult(key, taskId) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const url = new URL("https://2captcha.com/res.php");
      url.searchParams.set("key", key);
      url.searchParams.set("action", "get");
      url.searchParams.set("id", taskId);
      url.searchParams.set("json", "1");
      const res = await fetch(url);
      const json = (await res.json()) as { status?: number; request?: string };
      if (json.status === 1 && json.request) return json.request;
      if (json.request && json.request !== "CAPCHA_NOT_READY")
        throw new Error(`twocaptcha error: ${json.request}`);
    }
    throw new Error("twocaptcha poll timed out");
  },
};

function pickProvider(config: Config): Provider | null {
  if (config.captchaProvider === "capsolver") return capsolver;
  if (config.captchaProvider === "twocaptcha") return twocaptcha;
  return null;
}

// Scan the page for a known captcha widget. We check the iframe sources and
// the common sitekey attributes in DOM order so "first hit wins" matches
// user perception of which widget is blocking the flow.
export async function detectCaptcha(page: Page): Promise<CaptchaTarget | null> {
  return page.evaluate(() => {
    const url = window.location.href;
    // Turnstile
    const ts = document.querySelector<HTMLElement>("[data-sitekey].cf-turnstile, .cf-turnstile");
    if (ts) {
      const key = ts.getAttribute("data-sitekey");
      if (key) return { type: "turnstile" as const, sitekey: key, pageUrl: url };
    }
    // hCaptcha
    const hc = document.querySelector<HTMLElement>(".h-captcha[data-sitekey], [data-hcaptcha-widget-id]");
    if (hc) {
      const key = hc.getAttribute("data-sitekey");
      if (key) return { type: "hcaptcha" as const, sitekey: key, pageUrl: url };
    }
    // reCAPTCHA v2
    const rc = document.querySelector<HTMLElement>(".g-recaptcha[data-sitekey]");
    if (rc) {
      const key = rc.getAttribute("data-sitekey");
      if (key) return { type: "recaptcha-v2" as const, sitekey: key, pageUrl: url };
    }
    return null;
  });
}

// Inject the solved token into the widget's response field so the site's
// submit handler finds it on form submit. Field names are standardized per
// widget type; providers that need a JS callback (like Turnstile render()
// with a callback prop) require per-site tweaks that we don't attempt here.
export async function injectToken(
  page: Page,
  type: CaptchaType,
  token: string,
): Promise<void> {
  const fieldName = {
    turnstile: "cf-turnstile-response",
    hcaptcha: "h-captcha-response",
    "recaptcha-v2": "g-recaptcha-response",
    "recaptcha-v3": "g-recaptcha-response",
  }[type];
  await page.evaluate(
    ({ fieldName, token }) => {
      const nodes = document.getElementsByName(fieldName);
      for (const n of Array.from(nodes)) {
        (n as HTMLInputElement | HTMLTextAreaElement).value = token;
      }
      // Also expose for callback-style widgets that look in a JS object.
      (window as unknown as Record<string, unknown>).__sab_captcha_token = token;
    },
    { fieldName, token },
  );
}

export async function solveCaptcha(
  page: Page,
  config: Config,
  override?: Partial<CaptchaTarget>,
): Promise<{ type: CaptchaType; tokenPreview: string } | { error: string }> {
  const provider = pickProvider(config);
  if (!provider) return { error: "SAB_CAPTCHA_PROVIDER is 'none' — configure capsolver or twocaptcha" };
  if (!config.captchaApiKey) return { error: "SAB_CAPTCHA_API_KEY is not set" };

  const detected = await detectCaptcha(page);
  const target: CaptchaTarget = {
    type: override?.type ?? detected?.type ?? "turnstile",
    sitekey: override?.sitekey ?? detected?.sitekey ?? "",
    pageUrl: override?.pageUrl ?? detected?.pageUrl ?? page.url(),
  };
  if (!target.sitekey) return { error: "no sitekey detected or provided" };

  logger.info({ provider: provider.name, type: target.type }, "solving captcha");
  const taskId = await provider.createTask(config.captchaApiKey, target);
  const token = await provider.pollResult(config.captchaApiKey, taskId);
  await injectToken(page, target.type, token);
  return { type: target.type, tokenPreview: token.slice(0, 16) + "…" };
}
