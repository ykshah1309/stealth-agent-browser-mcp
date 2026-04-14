import type { Page } from "rebrowser-playwright";
import { annotateScreenshot, type Annotation } from "./annotate.js";
import { logger } from "./logger.js";

export type SnapshotMode = "aom" | "vision" | "hybrid";

export interface SnapshotResult {
  url: string;
  title: string;
  aom?: string;
  screenshotBase64?: string;
  refs: string[];
  truncatedTo?: number;
}

const REF_REGEX = /\[ref=([a-zA-Z0-9_-]+)\]/g;

export function extractRefs(yaml: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = REF_REGEX.exec(yaml)) !== null) {
    const ref = m[1];
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

export async function takeSnapshot(
  page: Page,
  mode: SnapshotMode,
  options: { maxAnnotated: number },
): Promise<SnapshotResult> {
  const [url, title] = await Promise.all([page.url(), page.title().catch(() => "")]);

  let aom: string | undefined;
  let refs: string[] = [];
  if (mode === "aom" || mode === "hybrid") {
    aom = await page.locator("body").ariaSnapshot({ ref: true });
    refs = extractRefs(aom);
  }

  if (mode === "aom") {
    return { url, title, aom, refs };
  }

  const rawShot = await page.screenshot({ type: "png", fullPage: false });

  if (mode === "vision") {
    return { url, title, screenshotBase64: rawShot.toString("base64"), refs };
  }

  // hybrid
  const annotations = await collectAnnotations(page, refs, options.maxAnnotated);
  const annotated = await annotateScreenshot(rawShot, annotations);

  return {
    url,
    title,
    aom,
    screenshotBase64: annotated.toString("base64"),
    refs,
    truncatedTo: annotations.length < refs.length ? annotations.length : undefined,
  };
}

// Score candidates for annotation priority. We want the sweet-spot click targets
// (buttons, inputs, links ~= 400..10_000 px²) first; decorative specks and
// layout-sized overlay divs last. Large generic overlays used to win under the
// previous "bigger first" sort and pushed real CTAs past the maxAnnotated cap.
function rankScore(areaPx: number): number {
  if (areaPx < 100) return 0; // too small — likely decorative / icon-only
  if (areaPx >= 400 && areaPx <= 10_000) return 3; // sweet spot for interactive controls
  if (areaPx < 400) return 2; // small but usable
  if (areaPx <= 50_000) return 1; // medium blocks
  return 0; // giant layout divs / overlays — deprioritize
}

async function collectAnnotations(
  page: Page,
  refs: string[],
  max: number,
): Promise<Annotation[]> {
  const viewport = page.viewportSize();
  if (!viewport) return [];

  // Playwright's boundingBox() is already viewport-relative per the Playwright
  // docs ("calculated relative to the main frame viewport"). Do NOT subtract
  // scroll offsets here — an earlier attempt to do so double-corrected every
  // coordinate and pushed all elements off-canvas, resulting in zero
  // annotations ever landing. The viewport-clip test below is the sole filter.
  const candidates: Annotation[] = [];
  const CHUNK = 20;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    const resolved = await Promise.all(
      slice.map(async (ref) => {
        try {
          const box = await page.locator(`aria-ref=${ref}`).first().boundingBox({ timeout: 250 });
          if (!box) return null;
          if (box.width < 4 || box.height < 4) return null;
          if (
            box.x + box.width < 0 ||
            box.y + box.height < 0 ||
            box.x > viewport.width ||
            box.y > viewport.height
          ) {
            return null;
          }
          return { ref, x: box.x, y: box.y, width: box.width, height: box.height } as Annotation;
        } catch {
          return null;
        }
      }),
    );
    for (const r of resolved) if (r) candidates.push(r);
  }

  candidates.sort((a, b) => {
    const sa = rankScore(a.width * a.height);
    const sb = rankScore(b.width * b.height);
    if (sb !== sa) return sb - sa;
    // Tie-break: earlier-in-AOM refs (preserves DOM order) win.
    return refs.indexOf(a.ref) - refs.indexOf(b.ref);
  });

  if (candidates.length > max) {
    logger.debug({ total: candidates.length, kept: max }, "truncating annotations");
    return candidates.slice(0, max);
  }
  return candidates;
}
