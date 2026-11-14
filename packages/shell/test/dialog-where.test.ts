import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cannotShow } from "../apps/dialog/lib/where.ts";

const HOST = "/usr/libexec/dashi/mirin-metal-host";
const there =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("dashi-dialog started outside the session", () => {
  test("in the session, with its host, a dialog can be shown", () => {
    expect(cannotShow({ WAYLAND_DISPLAY: "wayland-1", XDG_RUNTIME_DIR: "/run/user/1000" }, HOST, there(HOST, "/run/user/1000/wayland-1"))).toBeNull();
    // No WAYLAND_DISPLAY but the default socket is there (ssh into a machine whose session is wayland-0).
    expect(cannotShow({ XDG_RUNTIME_DIR: "/run/user/1000" }, HOST, there(HOST, "/run/user/1000/wayland-0"))).toBeNull();
  });

  test("no display at all is said plainly, with what to do, before anything about the host", () => {
    for (const env of [{}, { XDG_RUNTIME_DIR: "/run/user/1000" }, { WAYLAND_DISPLAY: "wayland-7", XDG_RUNTIME_DIR: "/run/user/1000" }]) {
      const said = cannotShow(env, HOST, there("/run/user/1000/wayland-1"));
      expect(said).toContain("there is no display to show a dialog on");
      expect(said).toContain("WAYLAND_DISPLAY and XDG_RUNTIME_DIR");
    }
  });

  test("a display but no host names the host's path", () => {
    expect(cannotShow({ WAYLAND_DISPLAY: "wayland-1", XDG_RUNTIME_DIR: "/run/user/1000" }, HOST, there("/run/user/1000/wayland-1"))).toBe(
      `dashi-dialog: no Metal host at ${HOST}; set DASHI_METAL_HOST`,
    );
  });

  test("the launcher gives the packaged host when the variable is not set, as dashi-portal does", () => {
    const launcher = readFileSync(join(import.meta.dir, "../../../session/dashi-dialog"), "utf8");
    expect(launcher).toMatch(/-z "\$\{DASHI_METAL_HOST:-\}" \] && \[ -x "\$base\/libexec\/dashi\/mirin-metal-host" \]/);
    expect(launcher).toContain("export DASHI_METAL_HOST");
  });
});
