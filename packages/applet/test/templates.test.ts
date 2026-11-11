import { describe, expect, test } from "bun:test";
import sdk from "../package.json";
import { sdkPaths, templateFiles } from "../src/cli/lib/templates.ts";

describe("sdkPaths", () => {
  test("a checkout: the UI packages beside the SDK, mirin beside Dashi", () => {
    expect(sdkPaths("/home/alexk/Developer/dashiOS/packages/applet")).toEqual({
      applet: "/home/alexk/Developer/dashiOS/packages/applet",
      ui: "/home/alexk/Developer/dashiOS/packages/dashi-ui",
      metal: "/home/alexk/Developer/mirin/packages/mirin-metal",
      shape: "/home/alexk/Developer/dashiOS/packages/shape",
    });
  });

  test("installed: the packages under /usr/share/dashi/node_modules, by their names", () => {
    expect(sdkPaths("/usr/share/dashi/node_modules/@dashi/applet")).toEqual({
      applet: "/usr/share/dashi/node_modules/@dashi/applet",
      ui: "/usr/share/dashi/node_modules/@dashi/ui",
      metal: "/usr/share/dashi/node_modules/@mirinjs/metal",
      shape: "/usr/share/dashi/node_modules/@dashi/shape",
    });
  });

  test("by default, this checkout's own SDK", () => {
    expect(sdkPaths().applet.endsWith("packages/applet")).toBe(true);
  });
});

describe("a new applet's package.json", () => {
  // A new applet depends on the SDK by path, outside Dashi's workspace, where a `workspace:` dependency
  // of the SDK's fails `bun install` ("Workspace dependency not found"), in a checkout and installed.
  test("says by path where each of the SDK's workspace dependencies is", () => {
    const paths = sdkPaths("/home/alexk/Developer/dashiOS/packages/applet");
    const parsed: unknown = JSON.parse(templateFiles("weather", paths)["package.json"] ?? "{}");
    const overrides = typeof parsed === "object" && parsed && "overrides" in parsed ? parsed.overrides : {};
    const workspace = Object.entries(sdk.dependencies).filter(([, spec]) => spec.startsWith("workspace:"));
    expect(workspace.length).toBeGreaterThan(0);
    for (const [name] of workspace) expect(overrides).toHaveProperty([name], `file:${paths.shape}`);
  });
});
