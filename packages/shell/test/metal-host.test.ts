import { expect, test } from "bun:test";
import { hostTextAntialiasing } from "@dashi/ui";
import { appNameEnv, SHELL_APP_NAME, shellHostOptions } from "../src/shared/metal/host.ts";

test("the shell's hosts are Dashi to a screen reader", () => {
  expect(SHELL_APP_NAME).toBe("Dashi");
  expect(shellHostOptions({ appId: "dev.dashi.shell", deferred: true })).toEqual({
    appId: "dev.dashi.shell",
    deferred: true,
    textAntialiasing: "subpixel",
    env: { MIRIN_METAL_APP_NAME: "Dashi" },
  });
});

test("Dashi's hosts draw subpixel text, unless the session's environment names another way or the caller does", () => {
  expect(hostTextAntialiasing({})).toBe("subpixel");
  expect(hostTextAntialiasing({ MIRIN_METAL_TEXT: "grayscale" })).toBe("grayscale");
  expect(hostTextAntialiasing({ MIRIN_METAL_TEXT: "blurry" })).toBe("subpixel");
  expect(shellHostOptions({ textAntialiasing: "grayscale" }).textAntialiasing).toBe("grayscale");
});

test("an environment the caller gives is kept, and may name the host itself", () => {
  expect(shellHostOptions({ title: "Menu bar", env: { MIRIN_METAL_TRACE: "1" } }).env).toEqual({ MIRIN_METAL_APP_NAME: "Dashi", MIRIN_METAL_TRACE: "1" });
  expect(shellHostOptions({ env: appNameEnv("Text Editor") }).env).toEqual({ MIRIN_METAL_APP_NAME: "Text Editor" });
});

test("the name is never put in the shell's own environment, which apps inherit", () => {
  shellHostOptions({ appId: "dev.dashi.shell" });
  expect(process.env.MIRIN_METAL_APP_NAME).toBeUndefined();
});
