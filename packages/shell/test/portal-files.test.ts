import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutService, forgetCheckoutPortal, linkCheckoutPortal } from "../src/session/portal-files.ts";

test("a checkout's session links dashi.portal and writes a service file; an installed one removes only that", () => {
  const root = mkdtempSync(join(tmpdir(), "dashi-portal-files-"));
  const session = join(root, "session");
  const data = join(root, "data");
  try {
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, "dashi.portal"), "[portal]\n");
    writeFileSync(join(session, "dashi-portal"), "#!/bin/sh\n");
    const env = { XDG_DATA_HOME: data };
    linkCheckoutPortal(session, env, () => {});
    expect(readFileSync(join(data, "xdg-desktop-portal/portals/dashi.portal"), "utf8")).toBe("[portal]\n");
    const service = join(data, "dbus-1/services/org.freedesktop.impl.portal.desktop.dashi.service");
    expect(readFileSync(service, "utf8")).toBe(checkoutService(session));
    expect(checkoutService(session)).toContain(`Exec=${session}/dashi-portal`);
    forgetCheckoutPortal(env);
    expect(existsSync(service)).toBe(false);
    // One the person wrote stays.
    writeFileSync(service, "[D-BUS Service]\nName=mine\n");
    linkCheckoutPortal(session, env, () => {});
    forgetCheckoutPortal(env);
    expect(readFileSync(service, "utf8")).toBe("[D-BUS Service]\nName=mine\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
