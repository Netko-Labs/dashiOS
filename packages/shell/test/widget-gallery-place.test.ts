// The widget gallery's place beside the column (notifications/lib/place.ts): on the screen, whatever its width.
import { expect, test } from "bun:test";
import { galleryPlace } from "../src/notifications/lib/place.ts";
import { GALLERY, GALLERY_LEAST, galleryFit } from "../src/widgets/index.ts";

const leftEdge = (screen: number): number => {
  const place = galleryPlace(screen);
  return screen - place.right - place.width;
};

test("on a wide screen it is 700 wide beside the column, its list 240", () => {
  const place = galleryPlace(1440);
  expect(place).toMatchObject({ width: GALLERY.width, list: GALLERY.list, right: 394 });
  expect(galleryPlace(null)).toMatchObject({ width: GALLERY.width, list: GALLERY.list, right: 394 });
});

test("on a 1024-wide screen it narrows its list and stays beside the column, inside the screen", () => {
  const place = galleryPlace(1024);
  expect(place.right).toBe(394);
  expect(place.width).toBeLessThan(GALLERY.width);
  expect(place.list).toBeLessThan(GALLERY.list);
  expect(place.list).toBeGreaterThanOrEqual(GALLERY.leastList);
  expect(leftEdge(1024)).toBeGreaterThanOrEqual(12);
});

test("too narrow even for that, it moves left over the column, never past the screen's left edge", () => {
  for (const screen of [960, 900, 800, 720]) {
    const place = galleryPlace(screen);
    expect(place.width).toBe(GALLERY_LEAST);
    expect(leftEdge(screen)).toBeGreaterThanOrEqual(Math.min(12, screen - GALLERY_LEAST - 12));
    expect(place.right).toBeGreaterThanOrEqual(12);
  }
});

test("the list gives way before the previews: a whole Wide preview always fits", () => {
  for (const room of [500, 609, 640, 700, 900]) {
    const fit = galleryFit(room);
    expect(fit.width - fit.list).toBeGreaterThanOrEqual(GALLERY_LEAST - GALLERY.leastList);
  }
});
