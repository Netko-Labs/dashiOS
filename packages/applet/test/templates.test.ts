import { describe, expect, test } from "bun:test";
import { sdkPaths } from "../src/cli/lib/templates.ts";

describe("sdkPaths", () => {
  test("a checkout: the UI packages beside the SDK, mirin beside Dashi", () => {
    expect(sdkPaths("/home/alexk/Developer/dashiOS/packages/applet")).toEqual({
      applet: "/home/alexk/Developer/dashiOS/packages/applet",
      ui: "/home/alexk/Developer/dashiOS/packages/dashi-ui",
      metal: "/home/alexk/Developer/mirin/packages/mirin-metal",
    });
  });

  test("installed: the packages under /usr/share/dashi/node_modules, by their names", () => {
    expect(sdkPaths("/usr/share/dashi/node_modules/@dashi/applet")).toEqual({
      applet: "/usr/share/dashi/node_modules/@dashi/applet",
      ui: "/usr/share/dashi/node_modules/@dashi/ui",
      metal: "/usr/share/dashi/node_modules/@mirinjs/metal",
    });
  });

  test("by default, this checkout's own SDK", () => {
    expect(sdkPaths().applet.endsWith("packages/applet")).toBe(true);
  });
});
