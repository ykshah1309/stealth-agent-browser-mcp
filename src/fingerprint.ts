// Plausible fingerprint profiles. Rotated per session for entropy at the
// fingerprint layer, on top of CDP-level patches from rebrowser.
// User-agents intentionally current-ish; update periodically.

export interface FingerprintProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  timezoneId: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  acceptLanguage: string;
}

const PROFILES: FingerprintProfile[] = [
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    platform: "Win32",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/Chicago",
    platform: "Win32",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    platform: "MacIntel",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 1,
    locale: "en-GB",
    timezoneId: "Europe/London",
    platform: "Linux x86_64",
    acceptLanguage: "en-GB,en;q=0.9",
  },
];

export function pickFingerprint(seed?: string): FingerprintProfile {
  if (!seed) {
    const idx = Math.floor(Math.random() * PROFILES.length);
    return PROFILES[idx] ?? PROFILES[0]!;
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PROFILES[h % PROFILES.length] ?? PROFILES[0]!;
}
