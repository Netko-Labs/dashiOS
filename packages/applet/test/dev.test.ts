import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutMetalHost, metalHostLine, vmCommand } from "../src/cli/lib/dev.ts";

const HOME = "/home/alex";

test("dev --vm names the checkout's Metal host, so a popover isn't drawn by the VM's installed one", () => {
  const command = vmCommand(`${HOME}/Developer/weather`, `${HOME}/Developer/dashiOS/packages/applet`, HOME);
  const host = "/mnt/developer/mirin/crates/mirin-metal/target/release/mirin-metal-host";
  expect(checkoutMetalHost("/mnt/developer/dashiOS/packages/applet")).toBe(host);
  expect(command).toContain(`export DASHI_METAL_HOST='${host}'`);
  // After the folder and the display, before the applet starts.
  expect(command?.indexOf("DASHI_METAL_HOST")).toBeLessThan(command?.indexOf("exec ") ?? 0);
  expect(vmCommand("/srv/weather", `${HOME}/Developer/dashiOS/packages/applet`, HOME)).toBeNull();
});

test("an installed SDK has no checkout's host to name", () => {
  expect(checkoutMetalHost("/usr/share/dashi/node_modules/@dashi/applet")).toBeNull();
});

test("the host is named only once it is built, and one already named is kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-dev-"));
  const host = join(dir, "mirin-metal-host");
  const say = (env: Record<string, string>): string => {
    const run = Bun.spawnSync(["sh", "-c", `${metalHostLine(host)} && printf %s "\${DASHI_METAL_HOST:-none}"`], {
      env: { PATH: process.env.PATH ?? "/usr/bin", ...env },
    });
    expect(run.exitCode).toBe(0);
    return run.stdout.toString();
  };
  expect(say({})).toBe("none");
  writeFileSync(host, "#!/bin/sh\n");
  chmodSync(host, 0o755);
  expect(say({})).toBe(host);
  expect(say({ DASHI_METAL_HOST: "/other/host" })).toBe("/other/host");
});
