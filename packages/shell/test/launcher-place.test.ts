import { expect, test } from "bun:test";
import { measuresFor, SURFACE, tallest } from "../src/launcher/lib/measures.ts";
import { LAUNCHER_GAP, LAUNCHER_TOP, launcherPlace } from "../src/launcher/place.ts";

// Passes 41 and 42: on the VM's 1098×686 screen the launcher's foot ran below the screen's edge, and a
// detail scrolled to its end showed its last line cut. Its top and height now follow the room under the bar.

const BAR = 28;
/** Points from the menu bar's foot to the bottom edge, on a screen `width`×`height` pixels at `scale`. */
const below = (height: number, scale: number) => Math.round(height / scale) - BAR;

test("a tall screen keeps the launcher 120 under the bar and 600 tall", () => {
  expect(launcherPlace(below(1600, 1))).toEqual({ top: LAUNCHER_TOP, height: SURFACE.height });
  expect(launcherPlace(undefined)).toEqual({ top: LAUNCHER_TOP, height: SURFACE.height });
});

test("on every short screen and scale, the foot stays on the screen with a gap under it", () => {
  const screens = [
    [800, 1],
    [800, 1.25],
    [800, 1.5],
    [800, 1.75],
    [1201, 1.75],
    [1200, 2],
    [1080, 2],
    [768, 1],
    [720, 1.5],
  ] as const;
  for (const [height, scale] of screens) {
    const room = below(height, scale);
    const place = launcherPlace(room);
    expect(place.top).toBeGreaterThanOrEqual(LAUNCHER_GAP);
    expect(place.top + place.height).toBeLessThanOrEqual(room - LAUNCHER_GAP);
    // The rows it lists fit in it, at every text size.
    for (const size of [1, 1.15, 1.3, 1.5]) {
      const m = measuresFor(size, place.height);
      expect(m.field + m.listRows * m.row + m.head).toBeLessThanOrEqual(place.height);
      expect(tallest(m.localRows, m.fileRows, m.row, m.head)).toBeLessThanOrEqual(Math.max(m.room, tallest(3, 1, m.row, m.head)));
    }
  }
  // The VM's screen: the gap above shrinks first, the launcher keeps its height.
  expect(launcherPlace(below(1201, 1.75))).toEqual({ top: 658 - 600 - LAUNCHER_GAP, height: 600 });
  // 1280×800 at 150%: shorter, and fewer rows.
  const short = launcherPlace(below(800, 1.5));
  expect(short.height).toBeLessThan(SURFACE.height);
  expect(measuresFor(1, short.height).listRows).toBeLessThan(measuresFor(1).listRows);
});
