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

// Serialize the live DOM with shadow roots expanded inline. `page.content()`
// returns outer HTML only and silently drops everything inside open shadow
// roots — which is precisely where modern web components keep their text.
// The AOM pipeline (ariaSnapshot) pierces shadow DOM natively, so without
// this the agent sees interactive refs that have no readable context,
// producing hallucination-grade confusion. Closed shadow roots remain
// inaccessible by spec.
async function shadowPiercingHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    function expand(node: Element): Element {
      const out = node.cloneNode(false) as Element;
      if (node.tagName === "SLOT") {
        const slot = node as HTMLSlotElement;
        const assigned = slot.assignedNodes({ flatten: true });
        const src: Iterable<Node> =
          assigned.length > 0 ? assigned : Array.from(node.childNodes);
        for (const child of src) {
          if (child.nodeType === 1) out.appendChild(expand(child as Element));
          else out.appendChild(child.cloneNode(true));
        }
        return out;
      }
      const root = (node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const children: Iterable<Node> = root ? root.childNodes : node.childNodes;
      for (const child of children) {
        if (child.nodeType === 1) out.appendChild(expand(child as Element));
        else out.appendChild(child.cloneNode(true));
      }
      return out;
    }
    const expanded = expand(document.documentElement);
    return "<!doctype html>" + expanded.outerHTML;
  });
}

export async function readableMarkdown(page: Page, prevHash: string | null): Promise<ReadResult> {
  const html = await shadowPiercingHtml(page);
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
