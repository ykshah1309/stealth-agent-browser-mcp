import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import type { Page } from "rebrowser-playwright";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface ReadResult {
  title: string;
  excerpt: string;
  markdown: string;
  wordCount: number;
  contentHash: string;
  delta: boolean;
}

// Nodes that are either non-textual or pathological for Readability/Turndown.
// SVG and <canvas> can blow up recursion depth; <video>/<audio>/<iframe>
// contribute no readable text and often carry heavy attribute payloads.
const STRIP_TAGS = ["svg", "canvas", "video", "audio", "iframe", "noscript"] as const;

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

function stripHeavyNodes(doc: Document): void {
  for (const tag of STRIP_TAGS) {
    const nodes = doc.querySelectorAll(tag);
    for (let i = nodes.length - 1; i >= 0; i--) {
      nodes[i]?.remove();
    }
  }
}

export async function readableMarkdown(page: Page, prevHash: string | null): Promise<ReadResult> {
  const html = await page.content();
  const url = page.url();
  const dom = new JSDOM(html, { url });
  stripHeavyNodes(dom.window.document);

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const title = article?.title ?? (await page.title().catch(() => "")) ?? "";
  const excerpt = article?.excerpt ?? "";
  const htmlContent = article?.content ?? "";
  const markdown = htmlContent ? turndown.turndown(htmlContent) : "";
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const contentHash = hash(markdown);
  const delta = prevHash !== null && prevHash !== contentHash;

  return { title, excerpt, markdown, wordCount, contentHash, delta };
}
