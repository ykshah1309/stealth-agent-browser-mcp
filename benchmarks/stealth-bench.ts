// Industry stealth benchmark: runs our browser against well-known fingerprint
// detection test pages and reports pass/fail summary. Run with:
//   npm run build && npm run bench:stealth
//
// We use public test pages (CreepJS, bot.sannysoft.com, fingerprint.com demo)
// as external ground truth. These are the same ones cited by rebrowser-patches
// and Patchright in their own benchmarks.

import { loadConfig } from "../src/config.js";
import { launchStealthBrowser } from "../src/browser.js";

interface Target {
  name: string;
  url: string;
  // A simple heuristic per target: some substring that indicates detection.
  detectSubstring?: string[];
}

const TARGETS: Target[] = [
  { name: "sannysoft", url: "https://bot.sannysoft.com/", detectSubstring: ["missing (failed)"] },
  { name: "creepjs", url: "https://abrahamjuliot.github.io/creepjs/" },
  { name: "pixelscan", url: "https://pixelscan.net/" },
  { name: "browserleaks-webrtc", url: "https://browserleaks.com/webrtc" },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const { browser, context, fingerprint } = await launchStealthBrowser(config, "bench");
  const page = await context.newPage();

  console.error(`fingerprint: ${fingerprint.userAgent}`);
  console.error(`stealth: ${config.stealthLevel}\n`);

  const results: Array<{ name: string; ok: boolean; note: string }> = [];

  for (const t of TARGETS) {
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Give detection scripts time to run.
      await page.waitForTimeout(4000);
      const text = await page.evaluate(() => document.body.innerText ?? "");
      let ok = true;
      let note = "loaded";
      if (t.detectSubstring) {
        for (const bad of t.detectSubstring) {
          if (text.toLowerCase().includes(bad.toLowerCase())) {
            ok = false;
            note = `detected: contains "${bad}"`;
            break;
          }
        }
      }
      results.push({ name: t.name, ok, note });
      console.error(`${ok ? "PASS" : "FAIL"}  ${t.name}  ${note}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ name: t.name, ok: false, note: `error: ${msg}` });
      console.error(`FAIL  ${t.name}  error: ${msg}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.error(`\n${passed}/${total} passed`);

  await context.close();
  await browser.close();
  process.exit(passed === total ? 0 : 1);
}

void main();
