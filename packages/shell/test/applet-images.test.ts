import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreImages } from "../src/shared/applet-store/images.ts";

test("a picture is in the cache whole or not at all", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-applet-images-"));
  try {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    let left: string[] = [];
    const fetch = async (): Promise<Response> => new Response(bytes);
    const images = new StoreImages(dir, fetch, () => ["catalog.example"]);
    const url = "https://catalog.example/fans/icon.png";
    expect(images.cached(url)).toBeNull();
    const path = await images.file(url);
    left = readdirSync(dir);
    if (path === null) throw new Error("not fetched");
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes);
    expect(images.cached(url)).toBe(path);
    // Nothing half-written is left beside it, and the name it was written under never ends like a picture.
    expect(left).toEqual([path.slice(dir.length + 1)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
