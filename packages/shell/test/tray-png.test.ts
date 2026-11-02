import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { iconFile, PixmapFiles } from "../src/tray/icon.ts";
import { argbToRgba, encodePng, type Pixmap, parsePixmaps, pickPixmap } from "../src/tray/png.ts";

const pixmap = (width: number, height = width): Pixmap => ({ width, height, data: new Uint8Array(width * height * 4) });

interface Chunk {
  type: string;
  data: Uint8Array;
  crc: number;
}

/** A PNG's chunks, read the way a decoder would. */
function chunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + length), crc: view.getUint32(at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

describe("argbToRgba", () => {
  test("moves alpha from first to last", () => {
    expect([...argbToRgba(Uint8Array.of(0x80, 1, 2, 3, 0xff, 10, 20, 30))]).toEqual([1, 2, 3, 0x80, 10, 20, 30, 0xff]);
  });
});

describe("parsePixmaps", () => {
  test("keeps only whole pixmaps of sane size", () => {
    const good = [16, 16, new Uint8Array(16 * 16 * 4)];
    const parsed = parsePixmaps([
      good,
      [16, 16, new Uint8Array(10)],
      [0, 0, new Uint8Array(0)],
      [1024, 1, new Uint8Array(4096)],
      [2, "2", new Uint8Array(16)],
      "junk",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.width).toBe(16);
    expect(parsePixmaps("nope")).toEqual([]);
  });
});

describe("pickPixmap", () => {
  test("takes the size nearest the bar's, the bigger on a tie", () => {
    expect(pickPixmap([pixmap(16), pixmap(22), pixmap(64)])?.width).toBe(22);
    expect(pickPixmap([pixmap(16), pixmap(48)])?.width).toBe(48);
    expect(pickPixmap([pixmap(128), pixmap(32), pixmap(16)])?.width).toBe(32);
    expect(pickPixmap([pixmap(24), pixmap(64)], 44)?.width).toBe(64);
    expect(pickPixmap([])).toBeNull();
  });
});

describe("encodePng", () => {
  const width = 3;
  const height = 2;
  const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 37) & 0xff);
  const png = encodePng(width, height, rgba);

  test("starts with the signature and has IHDR, IDAT, IEND in order", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunks(png).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  test("says its size and format in IHDR", () => {
    const header = chunks(png)[0]?.data as Uint8Array;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    expect(header.length).toBe(13);
    expect(view.getUint32(0)).toBe(width);
    expect(view.getUint32(4)).toBe(height);
    expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  });

  test("checks every chunk's CRC against the standard's (IEND's is AE426082)", () => {
    for (const chunk of chunks(png)) {
      const typed = new Uint8Array(4 + chunk.data.length);
      typed.set(new TextEncoder().encode(chunk.type));
      typed.set(chunk.data, 4);
      expect(chunk.crc).toBe(Bun.hash.crc32(typed));
    }
    expect(chunks(png)[2]?.crc).toBe(0xae426082);
  });

  test("holds the pixels, each row behind a filter byte of 0", () => {
    const raw = inflateSync(chunks(png)[1]?.data as Uint8Array);
    expect(raw.length).toBe((width * 4 + 1) * height);
    for (let row = 0; row < height; row++) {
      const start = row * (width * 4 + 1);
      expect(raw[start]).toBe(0);
      expect([...raw.subarray(start + 1, start + 1 + width * 4)]).toEqual([...rgba.subarray(row * width * 4, (row + 1) * width * 4)]);
    }
  });

  test("refuses data that doesn't match the size", () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(RangeError);
    expect(() => encodePng(0, 2, new Uint8Array(0))).toThrow(RangeError);
  });
});

describe("PixmapFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-tray-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("writes a picture once, as a PNG, and removes it with its last user", () => {
    const files = new PixmapFiles(join(dir, "cache"));
    const picture = { width: 2, height: 2, data: Uint8Array.from({ length: 16 }, (_, i) => i) };
    const first = files.acquire(picture);
    const second = files.acquire({ ...picture, data: picture.data.slice() });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    const path = first as string;
    expect([...readFileSync(path).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const other = files.acquire({ ...picture, data: new Uint8Array(16) });
    expect(other).not.toBe(first);
    files.release(path);
    expect(existsSync(path)).toBe(true);
    files.release(path);
    expect(existsSync(path)).toBe(false);
    files.release("/not/ours.png");
    files.clear();
    expect(existsSync(other as string)).toBe(false);
  });
});

describe("iconFile", () => {
  test("refuses names that climb out of a theme, and absolute paths that don't exist", () => {
    expect(iconFile("../../etc/passwd", "", [])).toBeNull();
    expect(iconFile("a/b", "", [])).toBeNull();
    expect(iconFile("/does/not/exist.png", "", [])).toBeNull();
    expect(iconFile("", "", [])).toBeNull();
  });

  test("finds an icon in the item's own directory, flat or in hicolor", () => {
    const own = mkdtempSync(join(tmpdir(), "dashi-tray-icons-"));
    try {
      mkdirSync(join(own, "hicolor/22x22/status"), { recursive: true });
      writeFileSync(join(own, "flat.png"), "x");
      writeFileSync(join(own, "hicolor/22x22/status/deep.png"), "x");
      expect(iconFile("flat", own, [])).toBe(join(own, "flat.png"));
      expect(iconFile("deep", own, [])).toBe(join(own, "hicolor/22x22/status/deep.png"));
      expect(iconFile("deep", "", [own])).toBe(join(own, "hicolor/22x22/status/deep.png"));
      expect(iconFile("missing", own, [])).toBeNull();
      expect(iconFile("flat", "relative/dir", [])).toBeNull();
      expect(iconFile(join(own, "flat.png"), "", [])).toBe(join(own, "flat.png"));
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
});
