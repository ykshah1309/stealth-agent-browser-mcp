import type { Browser, BrowserContext, LaunchOptions } from "rebrowser-playwright";
import { chromium } from "rebrowser-playwright";
import type { Config } from "./config.js";
import { pickFingerprint, type FingerprintProfile } from "./fingerprint.js";
import { logger } from "./logger.js";

// Launch args tuned to avoid the most obvious automation tells while
// keeping Chromium functional. rebrowser-patches handles the CDP-level
// Runtime.Enable leak which userland flags cannot fix.
function buildLaunchArgs(level: Config["stealthLevel"]): string[] {
  const base = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
  ];
  if (level === "paranoid") {
    base.push(
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-update",
      "--disable-domain-reliability",
    );
  }
  return base;
}

export interface LaunchedBrowser {
  browser: Browser;
  context: BrowserContext;
  fingerprint: FingerprintProfile;
}

export async function launchStealthBrowser(
  config: Config,
  sessionSeed?: string,
): Promise<LaunchedBrowser> {
  const fingerprint = pickFingerprint(sessionSeed);

  const launchOptions: LaunchOptions = {
    headless: config.headless,
    args: buildLaunchArgs(config.stealthLevel),
    ignoreDefaultArgs: ["--enable-automation"],
  };

  if (config.proxyServer) {
    launchOptions.proxy = {
      server: config.proxyServer,
      username: config.proxyUsername,
      password: config.proxyPassword,
    };
  }

  logger.info(
    { stealthLevel: config.stealthLevel, proxy: Boolean(config.proxyServer) },
    "launching stealth browser",
  );

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: fingerprint.userAgent,
    viewport: fingerprint.viewport,
    deviceScaleFactor: fingerprint.deviceScaleFactor,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    extraHTTPHeaders: { "Accept-Language": fingerprint.acceptLanguage },
    bypassCSP: false,
  });

  // Soft-patch the most commonly fingerprinted surfaces. rebrowser handles
  // the deep CDP leaks; these handle a few still-checked JS properties.
  await context.addInitScript((platform: string) => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "platform", { get: () => platform });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      // Spoof plugin/mime length to non-zero (headless usually 0).
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      // chrome runtime object presence (headless Chromium lacks it).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = (window as any).chrome ?? { runtime: {} };
    } catch {
      // Never let init-script errors break the page.
    }
  }, fingerprint.platform);

  return { browser, context, fingerprint };
}
