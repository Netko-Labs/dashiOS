import { describe, expect, test } from "bun:test";
import { defaultScale } from "../src/index.ts";

const screen = (name: string, width: number, height: number, widthMm: number, heightMm: number) => ({ name, width, height, widthMm, heightMm });

describe("defaultScale: the scale a screen gets when nobody chose one", () => {
  test("the owner's laptop panel (2880 × 1800, 300 × 190 mm) comes up at 2", () => {
    expect(defaultScale(screen("eDP-1", 2880, 1800, 300, 190))).toBe(2);
  });

  test("a desk monitor keeps what it had: 24-inch 1080p at 1, 27-inch 1440p at 1, 27-inch 4K at 1.5", () => {
    expect(defaultScale(screen("DP-1", 1920, 1080, 531, 299))).toBe(1);
    expect(defaultScale(screen("DP-1", 2560, 1440, 597, 336))).toBe(1);
    expect(defaultScale(screen("DP-1", 3840, 2160, 597, 336))).toBe(1.5);
  });

  test("a 34-inch ultrawide (3440 × 1440, as tall as a 27-inch) stays at 1", () => {
    expect(defaultScale(screen("DP-1", 3440, 1440, 800, 335))).toBe(1);
  });

  test("a 40-inch TV-sized screen (890 × 500 mm): 4K at 1.5, not 1; 1080p and 1440p at 1", () => {
    expect(defaultScale(screen("HDMI-A-1", 3840, 2160, 890, 500))).toBe(1.5);
    expect(defaultScale(screen("HDMI-A-1", 1920, 1080, 890, 500))).toBe(1);
    expect(defaultScale(screen("HDMI-A-1", 2560, 1440, 890, 500))).toBe(1);
  });

  test("a 55-inch 4K TV comes up at 1.5 too: seen from farther in step with its size", () => {
    expect(defaultScale(screen("HDMI-A-1", 3840, 2160, 1210, 680))).toBe(1.5);
  });

  test("a 32-inch 4K monitor comes up at 1.5", () => {
    expect(defaultScale(screen("DP-2", 3840, 2160, 698, 393))).toBe(1.5);
  });

  test("a monitor turned on its side gets what it gets upright", () => {
    expect(defaultScale(screen("DP-1", 2160, 3840, 336, 597))).toBe(defaultScale(screen("DP-1", 3840, 2160, 597, 336)));
    expect(defaultScale(screen("HDMI-A-1", 2160, 3840, 500, 890))).toBe(1.5);
  });

  test("a screen that says no size, or a made-up one, stays at 1", () => {
    expect(defaultScale(screen("Virtual-1", 1920, 1080, 0, 0))).toBe(1);
    expect(defaultScale(screen("HDMI-A-1", 3840, 2160, 16, 9))).toBe(1);
  });
});
