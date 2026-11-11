import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadThumbnailers, sandboxed, withThumbInfo } from "../src/shared/file-browser/lib/thumbnailer.ts";
import { parseThumbnailer, splitExec, thumbnailerArgv } from "../src/shared/file-browser/lib/thumbnailer-spec.ts";
import { thumbMtime } from "../src/shared/file-browser/lib/thumbs.ts";

const GLYCIN = `[Thumbnailer Entry]
TryExec=/usr/bin/glycin-thumbnailer
Exec=/usr/bin/glycin-thumbnailer --input %u --output %o --size %s
MimeType=image/jpeg;image/png;
`;

test("a .thumbnailer file: its command, its types, its TryExec", () => {
  expect(parseThumbnailer(GLYCIN)).toEqual({
    exec: ["/usr/bin/glycin-thumbnailer", "--input", "%u", "--output", "%o", "--size", "%s"],
    mimeTypes: ["image/jpeg", "image/png"],
    tryExec: "/usr/bin/glycin-thumbnailer",
  });
  expect(parseThumbnailer("[Desktop Entry]\nExec=x\nMimeType=a/b;")).toBeNull();
  expect(splitExec('a "b c" d')).toEqual(["a", "b c", "d"]);
});

test("field codes fill in; the URI is escaped", () => {
  expect(
    thumbnailerArgv(["t", "-i", "%i", "-u", "%u", "-o", "%o", "-s", "%s", "100%%"], { input: "/h/My Photo.jpg", output: "/tmp/o.png", size: 256 }),
  ).toEqual(["t", "-i", "/h/My Photo.jpg", "-u", "file:///h/My%20Photo.jpg", "-o", "/tmp/o.png", "-s", "256", "100%"]);
});

test("the first data dir wins, and a thumbnailer whose program is missing doesn't count", () => {
  const root = mkdtempSync(join(tmpdir(), "thumbers-"));
  for (const [dir, name, text] of [
    ["a", "x.thumbnailer", GLYCIN],
    ["b", "y.thumbnailer", "[Thumbnailer Entry]\nExec=other %i %o\nMimeType=image/png;video/mp4;"],
    ["b", "z.thumbnailer", "[Thumbnailer Entry]\nTryExec=missing\nExec=missing %i %o\nMimeType=audio/mpeg;"],
  ] as const) {
    mkdirSync(join(root, dir, "thumbnailers"), { recursive: true });
    writeFileSync(join(root, dir, "thumbnailers", name), text);
  }
  const map = loadThumbnailers([join(root, "a"), join(root, "b")], (program) => (program === "missing" ? null : program));
  expect(map.get("image/png")?.[0]).toBe("/usr/bin/glycin-thumbnailer");
  expect(map.get("video/mp4")?.[0]).toBe("other");
  expect(map.has("audio/mpeg")).toBe(false);
});

test("the cache's PNG carries the file's URI and modification time", () => {
  // The smallest PNG: signature, IHDR (13 bytes of data), IEND.
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0,
    0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const out = withThumbInfo(png, "file:///h/a.png", 1_700_000_000);
  expect(out).not.toBeNull();
  expect(thumbMtime(out as Uint8Array)).toBe(1_700_000_000);
  expect(withThumbInfo(new Uint8Array([1, 2, 3]), "file:///x", 1)).toBeNull();
});

test("in the sandbox the system is read-only and only the work folder takes writes", () => {
  const argv = sandboxed(["t", "%o"], "/tmp/work", "/usr/bin/bwrap");
  expect(argv.slice(0, 4)).toEqual(["/usr/bin/bwrap", "--ro-bind", "/", "/"]);
  expect(argv).toContain("--unshare-all");
  expect(argv.slice(argv.indexOf("--bind"), argv.indexOf("--bind") + 3)).toEqual(["--bind", "/tmp/work", "/tmp/work"]);
  expect(argv.slice(-2)).toEqual(["t", "%o"]);
  expect(sandboxed(["t"], "/w", null)).toEqual(["t"]);
});
