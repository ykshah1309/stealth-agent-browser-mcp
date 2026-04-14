import { z } from "zod";

const ConfigSchema = z.object({
  headless: z.boolean().default(true),
  stealthLevel: z.enum(["off", "patched", "paranoid"]).default("patched"),
  proxyServer: z.string().optional(),
  proxyUsername: z.string().optional(),
  proxyPassword: z.string().optional(),
  userDataDir: z.string().optional(),
  defaultTimeoutMs: z.number().int().positive().default(15_000),
  maxAnnotatedElements: z.number().int().positive().default(75),
  viewportWidth: z.number().int().positive().default(1366),
  viewportHeight: z.number().int().positive().default(768),
  locale: z.string().default("en-US"),
  timezoneId: z.string().default("America/New_York"),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): Config {
  return ConfigSchema.parse({
    headless: parseBool(process.env.SAB_HEADLESS, true),
    stealthLevel: (process.env.SAB_STEALTH_LEVEL as Config["stealthLevel"]) ?? "patched",
    proxyServer: process.env.SAB_PROXY_SERVER,
    proxyUsername: process.env.SAB_PROXY_USERNAME,
    proxyPassword: process.env.SAB_PROXY_PASSWORD,
    userDataDir: process.env.SAB_USER_DATA_DIR,
    defaultTimeoutMs: process.env.SAB_DEFAULT_TIMEOUT_MS
      ? Number(process.env.SAB_DEFAULT_TIMEOUT_MS)
      : undefined,
    maxAnnotatedElements: process.env.SAB_MAX_ANNOTATED
      ? Number(process.env.SAB_MAX_ANNOTATED)
      : undefined,
    viewportWidth: process.env.SAB_VIEWPORT_W ? Number(process.env.SAB_VIEWPORT_W) : undefined,
    viewportHeight: process.env.SAB_VIEWPORT_H ? Number(process.env.SAB_VIEWPORT_H) : undefined,
    locale: process.env.SAB_LOCALE ?? undefined,
    timezoneId: process.env.SAB_TIMEZONE ?? undefined,
  });
}
