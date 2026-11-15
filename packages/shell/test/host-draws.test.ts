import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostDraws, hostDrawsFile, iconPath, resolveIcon } from "../src/shared/apps/index.ts";
import { FORMATS, type Format, sniff } from "../src/shared/files/index.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const TIFF = bytes(0x49, 0x49, 42, 0, 8, 0, 0, 0);
const XPM = text('/* XPM */\nstatic char *icon[] = {\n"1 1 1 1",\n"a c #000000",\n"a"};\n');
const HEIC = bytes(0, 0, 0, 24, ...text("ftypheic"), 0, 0, 0, 0);
const AVIF = bytes(0, 0, 0, 28, ...text("ftypavif"), 0, 0, 0, 0);

test("the host draws PNG, JPEG, GIF, WebP, BMP, ICO and SVG as they are", () => {
  expect(hostDraws(PNG)).toBe(true);
  expect(hostDraws(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
  expect(hostDraws(text("GIF89a"))).toBe(true);
  expect(hostDraws(bytes(...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")))).toBe(true);
  expect(hostDraws(bytes(...text("BM"), ...new Array<number>(24).fill(0)))).toBe(true);
  expect(hostDraws(bytes(0, 0, 1, 0, 1, 0))).toBe(true);
  expect(hostDraws(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
});

test("the host does not draw a TIFF (mirin's sumi engine), an XPM, a HEIC, an AVIF, a PDF, or nothing at all", () => {
  for (const head of [TIFF, bytes(0x4d, 0x4d, 0, 42), XPM, HEIC, AVIF, text("%PDF-1.7"), text("P6\n1 1\n255\n"), bytes()]) expect(hostDraws(head)).toBe(false);
  // Preview converts a TIFF as it does a HEIC, and says it cannot when ImageMagick is missing.
  expect(FORMATS.tiff.native).toBe(false);
  expect(FORMATS.tiff.coder).toBe("tiff");
});

test("an icon by path that the host does not draw gets the generic icon, never a blank", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-host-draws-"));
  try {
    const file = (name: string, content: Uint8Array): string => {
      writeFileSync(join(dir, name), content);
      return join(dir, name);
    };
    const generic = iconPath("generic");
    expect(resolveIcon(file("app.png", PNG))).toBe(join(dir, "app.png"));
    expect(resolveIcon(file("app.xpm", XPM))).toBe(generic);
    expect(resolveIcon(file("app.tiff", TIFF))).toBe(generic);
    // The bytes decide, not the name: a TIFF called .png is still a TIFF.
    expect(resolveIcon(file("liar.png", TIFF))).toBe(generic);
    expect(resolveIcon(file("liar.svg", TIFF))).toBe(generic);
    // An SVG whose `<svg` comes late is believed by its name.
    expect(resolveIcon(file("late.svg", text(`<!--${"x".repeat(5000)}--><svg/>`)))).toBe(join(dir, "late.svg"));
    expect(resolveIcon(join(dir, "missing.png"))).toBe(generic);
    expect(hostDrawsFile(dir)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a picture rewritten in place is asked about again", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-host-draws-"));
  try {
    const path = join(dir, "alexk");
    writeFileSync(path, TIFF);
    expect(hostDrawsFile(path)).toBe(false);
    writeFileSync(path, bytes(...PNG, 0, 0, 0, 13));
    expect(hostDrawsFile(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Preview's table and the icons' rule agree on what the host draws", () => {
  const heads: Record<Exclude<Format, "pdf">, Uint8Array> = {
    png: PNG,
    jpeg: bytes(0xff, 0xd8, 0xff, 0xe0),
    gif: text("GIF89a"),
    webp: bytes(...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")),
    bmp: bytes(...text("BM"), ...new Array<number>(24).fill(0)),
    tiff: TIFF,
    svg: text('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    heic: HEIC,
    avif: AVIF,
    jxl: bytes(0xff, 0x0a, 0, 0),
  };
  for (const [format, head] of Object.entries(heads) as [Format, Uint8Array][]) {
    if (format !== "svg") expect(sniff(head)).toBe(format);
    expect(hostDraws(head)).toBe(FORMATS[format].native);
  }
});
