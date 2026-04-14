import type { Locator, Page } from "rebrowser-playwright";
// ghost-cursor's top-level export imports Puppeteer *types* (not runtime).
// We pull the pure-math Bezier helpers from the submodule path, which has no
// browser-engine type dependency, and drive Playwright's mouse ourselves.
import { bezierCurve, type Vector } from "ghost-cursor/lib/math.js";

export interface HumanClickOptions {
  button?: "left" | "right" | "middle";
  clickCount?: number;
}

// Tracks the cursor's "virtual" position so successive paths start from the
// previous end-point, not (0,0). Without this, every click draws a straight
// line from origin — exactly the Datadome-visible teleport we're avoiding.
export class HumanMouse {
  private pos: Vector = { x: 0, y: 0 };

  constructor(private readonly page: Page) {}

  async click(locator: Locator, opts: HumanClickOptions = {}): Promise<void> {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await locator.boundingBox();
    if (!box) {
      // Off-screen or detached — fall back to Playwright's direct click rather
      // than guessing coordinates. Rare in practice after scrollIntoView.
      await locator.click(opts);
      return;
    }

    // Aim for a random point inside the element's inner 40% — always hitting
    // dead-centre is itself a tell (bots, unlike fingers, are too precise).
    const target: Vector = {
      x: box.x + box.width * (0.3 + Math.random() * 0.4),
      y: box.y + box.height * (0.3 + Math.random() * 0.4),
    };

    const points = this.bezierPath(this.pos, target);
    for (const p of points) {
      await this.page.mouse.move(p.x, p.y);
      // ~5-15ms per step keeps total move under ~500ms for typical distances
      // while still preserving sub-16ms granularity below animation frames.
      await this.page.waitForTimeout(4 + Math.random() * 8);
    }
    this.pos = target;

    // Pre-click hesitation (50–150ms). Humans don't click the instant their
    // mouse lands; models of intentional clicks show this dwell consistently.
    await this.page.waitForTimeout(50 + Math.random() * 100);
    await this.page.mouse.click(target.x, target.y, {
      button: opts.button ?? "left",
      clickCount: opts.clickCount ?? 1,
    });
  }

  private bezierPath(start: Vector, end: Vector): Vector[] {
    const curve = bezierCurve(start, end);
    // Step count scales with distance so short moves don't stall on ~50 steps
    // and long moves don't get jagged. ~30px per step is plausible.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(12, Math.min(60, Math.round(dist / 30)));
    const out: Vector[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const pt = curve.get(t);
      out.push({ x: pt.x, y: pt.y });
    }
    return out;
  }
}
