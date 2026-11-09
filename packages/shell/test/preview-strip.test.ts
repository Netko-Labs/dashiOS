import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shapeOf } from "../apps/preview/folder.ts";
import {
  anchorAt,
  anchorY,
  clampScroll,
  currentPage,
  fitPageScale,
  fitWidthScale,
  layoutPages,
  MARGIN,
  PAGE_GAP,
  scrollToPage,
  visiblePages,
} from "../apps/preview/layout.ts";
import { pageSizes, parsePdfInfo, pdfinfoArgs, pdftotextArgs } from "../apps/preview/pdf.ts";
import { faded, SHAPE, STRIP, scrollIntoView, stripRows, stripWidth, thumbWidth } from "../apps/preview/strip.tsx";
import { FIT_MARGIN, fitArea, fitScale } from "../apps/preview/zoom.ts";

// A PDF as one scrolling surface (layout.ts), the page strip (strip.tsx), and the pages' sizes from pdfinfo (pdf.ts).

const letter = { width: 612, height: 792 };
const wide = { width: 792, height: 612 };

describe("the pages, stacked", () => {
  test("each page at its own size, centred in a column at least the area wide, a gap between them", () => {
    const layout = layoutPages([letter, wide, letter], 1, 1000);
    expect(layout.width).toBe(1000);
    expect(layout.boxes.map((box) => box.top)).toEqual([MARGIN, MARGIN + 792 + PAGE_GAP, MARGIN + 792 + PAGE_GAP + 612 + PAGE_GAP]);
    expect(layout.boxes[0]?.left).toBe((1000 - 612) / 2);
    expect(layout.boxes[1]?.left).toBe((1000 - 792) / 2);
    expect(layout.height).toBe(MARGIN * 2 + 792 * 2 + 612 + PAGE_GAP * 2);
    // Zoomed past the area, the column is the widest page and its margins: it scrolls sideways.
    expect(layoutPages([letter, wide], 2, 1000).width).toBe(792 * 2 + MARGIN * 2);
    expect(layoutPages([], 1, 500)).toEqual({ boxes: [], width: 500, height: 0 });
  });

  test("fit to width fits the widest page; fit to a page fits the largest whole", () => {
    expect(fitWidthScale([letter, wide], 824)).toBe((824 - MARGIN * 2) / 792);
    expect(fitPageScale([letter], { width: 2000, height: 824 })).toBe((824 - MARGIN * 2) / 792);
    expect(fitWidthScale([], 824)).toBe(1);
  });

  test("only the pages near the screen are drawn and rendered", () => {
    const sizes = Array.from({ length: 1000 }, () => letter);
    const { boxes } = layoutPages(sizes, 1, 800);
    const step = 792 + PAGE_GAP;
    expect(visiblePages(boxes, 0, 600)).toEqual([1]);
    expect(visiblePages(boxes, MARGIN + step * 500, 600)).toEqual([501]);
    expect(visiblePages(boxes, MARGIN + step * 500 + 700, 600)).toEqual([501, 502]);
    // Overscan reaches a screen's share past either edge.
    expect(visiblePages(boxes, MARGIN + step * 500, 600, 1)).toEqual([500, 501, 502]);
  });

  test("the current page is the one under the middle of the screen", () => {
    const { boxes } = layoutPages([letter, letter, letter], 1, 800);
    expect(currentPage(boxes, 0, 600)).toBe(1);
    expect(currentPage(boxes, 792 + PAGE_GAP, 600)).toBe(2);
    expect(currentPage(boxes, 10_000, 600)).toBe(3);
    expect(currentPage([], 0, 600)).toBe(1);
  });

  test("a zoom keeps the same place on the same page in the middle", () => {
    const sizes = [letter, wide, letter];
    const before = layoutPages(sizes, 1, 800);
    const anchor = anchorAt(before.boxes, 1000);
    expect(anchor.page).toBe(2);
    const after = layoutPages(sizes, 2.5, 800);
    const y = anchorY(after.boxes, anchor);
    expect(anchorAt(after.boxes, y).page).toBe(2);
    expect(anchorAt(after.boxes, y).fraction).toBeCloseTo(anchor.fraction, 6);
  });

  test("going to a page puts its top a margin under the screen's top; the scroll stays in the document", () => {
    const { boxes, height } = layoutPages([letter, letter], 1, 800);
    expect(scrollToPage(boxes, 2)).toBe(792 + PAGE_GAP);
    expect(scrollToPage(boxes, 9)).toBe(792 + PAGE_GAP);
    expect(clampScroll(-40, height, 600)).toBe(0);
    expect(clampScroll(99_999, height, 600)).toBe(height - 600);
    expect(clampScroll(50, 300, 600)).toBe(0);
  });
});

describe("the page strip", () => {
  test("each row has its page's shape, held to a sane range", () => {
    const { rows, height } = stripRows([
      { key: "1", label: "1", source: null, shape: 792 / 612 },
      { key: "2", label: "2", source: null, shape: 612 / 792 },
      { key: "3", label: "3", source: null, shape: 40 },
    ]);
    expect(rows[0]?.height).toBeGreaterThan(rows[1]?.height ?? 0);
    expect(rows[2]?.height).toBe(Math.round(150 * 2.5) + 8 + 18);
    expect(height).toBe((rows[2]?.top ?? 0) + (rows[2]?.height ?? 0) + 6);
  });

  test("a 4:1 panorama is drawn whole, as a band: its row is no taller than the band and its label", () => {
    const { rows } = stripRows([{ key: "p", label: "panorama-tagus.jpg", source: null, shape: 0.25 }]);
    expect(SHAPE.least).toBeLessThanOrEqual(0.25);
    expect(rows[0]?.height).toBe(Math.round(150 * 0.25) + 8 + 18);
  });

  test("the strip is a share of the window, between its least and most, and gives way in a narrow one", () => {
    expect(stripWidth(null)).toBe(STRIP.most);
    expect(stripWidth(1000)).toBe(200);
    expect(stripWidth(1600)).toBe(200);
    expect(stripWidth(800)).toBe(160);
    expect(stripWidth(520)).toBe(STRIP.least);
    expect(stripWidth(479)).toBe(0);
    expect(stripWidth(359)).toBe(0);
    // Its thumbnails keep the strip's margins: 150 in the widest, narrower with it.
    expect(thumbWidth(200)).toBe(150);
    expect(thumbWidth(STRIP.least)).toBe(STRIP.least - STRIP.margins);
    const narrow = stripRows([{ key: "1", label: "1", source: null, shape: 1 }], thumbWidth(STRIP.least));
    expect(narrow.rows[0]?.width).toBe(STRIP.least - STRIP.margins + 8);
  });

  test("the fade under the window controls is the sidebar's own color, thinning out", () => {
    expect(faded("#e8e8ec", 1)).toBe("#e8e8ecff");
    expect(faded("#e8e8ec", 0.5)).toBe("#e8e8ec80");
    expect(faded("#29292c80", 0.5)).toBe("#29292c40");
    expect(faded("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
  });

  test("the open row is scrolled into view, moving as little as it can", () => {
    const { rows } = stripRows(Array.from({ length: 50 }, (_, index) => ({ key: String(index), label: "", source: null, shape: 1.3 })));
    expect(scrollIntoView(rows[0], 0, 500)).toBe(0);
    const far = rows[30];
    const scroll = scrollIntoView(far, 0, 500);
    expect(scroll + 500).toBe((far?.top ?? 0) + (far?.height ?? 0) + 6);
    expect(scrollIntoView(rows[2], scroll, 500)).toBe((rows[2]?.top ?? 0) - 6);
    expect(scrollIntoView(undefined, 120, 500)).toBe(120);
  });
});

describe("pages from pdfinfo", () => {
  const out = [
    "Title:           Lease",
    "Pages:           4",
    "Encrypted:       no",
    "Page    1 size:  612 x 792 pts (letter)",
    "Page    1 rot:   0",
    "Page    2 size:  612 x 792 pts (letter)",
    "Page    2 rot:   90",
    "Page    3 size:  595.276 x 841.89 pts (A4)",
    "Page    3 rot:   270",
  ].join("\n");

  test("each page's size as shown: its own rotation applied, an unlisted page like the one before", () => {
    expect(pageSizes(out, 4)).toEqual([letter, wide, { width: 841.89, height: 595.276 }, { width: 841.89, height: 595.276 }]);
    const info = parsePdfInfo(out);
    expect(info?.pages).toBe(4);
    expect(info?.title).toBe("Lease");
    expect(info?.pageSize).toEqual(letter);
    expect(info?.pageSizes).toHaveLength(4);
  });

  test("a lone page size (an older pdfinfo) is page 1's; nothing measured is a letter page", () => {
    expect(pageSizes("Pages: 1\nPage size: 200 x 100 pts\n", 1)).toEqual([{ width: 200, height: 100 }]);
    expect(parsePdfInfo("Pages: 2\n")?.pageSize).toBeNull();
    expect(pageSizes("Pages: 2\n", 2)).toEqual([letter, letter]);
  });

  test("poppler is asked for every page, and for one page's words, with the path last", () => {
    expect(pdfinfoArgs("/home/alexk/a.pdf")).toEqual(["pdfinfo", "-f", "1", "-l", "5000", "/home/alexk/a.pdf"]);
    expect(pdftotextArgs("/home/alexk/a.pdf", 3)).toEqual(["pdftotext", "-bbox-layout", "-enc", "UTF-8", "-f", "3", "-l", "3", "/home/alexk/a.pdf", "-"]);
  });
});

describe("a picture's shape, from its header", () => {
  test("height over width, upright; nothing for what has no header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-preview-shape-"));
    try {
      // A PNG's IHDR: 400 × 100.
      const png = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
      png.writeUInt32BE(13, 8);
      png.write("IHDR", 12, "latin1");
      png.writeUInt32BE(400, 16);
      png.writeUInt32BE(100, 20);
      writeFileSync(join(dir, "wide.png"), png);
      writeFileSync(join(dir, "broken.png"), "not a picture");
      expect(await shapeOf(join(dir, "wide.png"))).toBe(0.25);
      expect(await shapeOf(join(dir, "broken.png"))).toBeNull();
      expect(await shapeOf(join(dir, "missing.png"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a picture at fit", () => {
  test("keeps the PDF's margin on every side, and is never blown up past its size", () => {
    const area = { width: 800, height: 632 };
    const portrait = { width: 900, height: 1600 };
    const scale = fitScale(portrait, fitArea(area));
    expect(portrait.height * scale).toBeCloseTo(area.height - FIT_MARGIN * 2);
    // 18: the toolbar's inset after the strip, so a fitted page or picture starts under the title.
    expect(FIT_MARGIN).toBe(18);
    expect(fitScale({ width: 100, height: 100 }, fitArea(area))).toBe(1);
    expect(fitArea({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
    expect(fitArea({ width: 20, height: 20 })).toEqual({ width: 1, height: 1 });
  });
});
