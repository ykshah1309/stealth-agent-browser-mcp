import sharp from "sharp";

export interface Annotation {
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Escape text for safe SVG inclusion.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function buildSvg(width: number, height: number, items: Annotation[]): string {
  const boxes = items
    .map((a) => {
      const x = Math.max(0, Math.round(a.x));
      const y = Math.max(0, Math.round(a.y));
      const w = Math.max(1, Math.round(a.width));
      const h = Math.max(1, Math.round(a.height));
      const label = esc(a.ref);
      // Label pill: place top-left of the box.
      const padX = 4;
      const padY = 2;
      const charW = 7.2;
      const labelW = Math.round(label.length * charW + padX * 2);
      const labelH = 16;
      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff2d2d" stroke-width="2" />
        <rect x="${x}" y="${y}" width="${labelW}" height="${labelH}" fill="#ff2d2d" />
        <text x="${x + padX}" y="${y + labelH - padY - 2}" font-family="monospace" font-size="12" fill="white" font-weight="bold">${label}</text>
      `;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${boxes}
  </svg>`;
}

export async function annotateScreenshot(
  png: Buffer,
  items: Annotation[],
): Promise<Buffer> {
  if (items.length === 0) return png;
  const img = sharp(png);
  const meta = await img.metadata();
  const w = meta.width ?? 1366;
  const h = meta.height ?? 768;
  const svg = Buffer.from(buildSvg(w, h, items));
  return img.composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}
