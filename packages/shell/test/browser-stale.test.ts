import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateManifest } from "../src/browser/crx.ts";
import { EXTENSION_ID } from "../src/browser/native.ts";
import { parseFromBrowser } from "../src/browser/protocol.ts";
import { olderVersion, packagedExtensionVersion, staleExtensionWatch } from "../src/browser/stale.ts";

describe("an extension older than the package's", () => {
  test("the package's version is read from the update manifest it installs", () => {
    const path = join(mkdtempSync(join(tmpdir(), "dashi-updates-")), "updates.xml");
    writeFileSync(path, updateManifest(EXTENSION_ID, "0.9.0", "file:///usr/share/dashi/browser/dashi-browser.crx"));
    expect(packagedExtensionVersion(path)).toBe("0.9.0");
    expect(packagedExtensionVersion(join(path, "missing"))).toBeNull();
  });

  test("versions compare number by number", () => {
    expect(olderVersion("0.5.0", "0.9.0")).toBe(true);
    expect(olderVersion("0.9.0", "0.10.0")).toBe(true);
    expect(olderVersion("0.9", "0.9.0")).toBe(false);
    expect(olderVersion("0.9.0.1", "0.9.0")).toBe(false);
  });

  test("the extension's version reaches the shell in the host's line, or in the extension's own", () => {
    const host = parseFromBrowser(`{"event":"host","browserPid":4242,"extension":"${EXTENSION_ID}","version":"0.9.0","extensionVersion":"0.5.0"}`);
    expect(host.kind === "hello" && host.hello.extensionVersion).toBe("0.5.0");
    expect(parseFromBrowser('{"event":"hello","version":"0.5.0"}')).toEqual({ kind: "extension", version: "0.5.0" });
    expect(parseFromBrowser('{"event":"hello","version":"<b>"}').kind).toBe("invalid");
  });

  test("it is said once, with what to do; the packaged version or a newer one says nothing", () => {
    const notices: string[] = [];
    const watch = staleExtensionWatch(
      (notice) => notices.push(`${notice.summary}: ${notice.body}`),
      () => "0.9.0",
    );
    watch("0.9.0");
    watch("0.10.0");
    expect(notices).toEqual([]);
    watch("0.5.0");
    watch("0.5.0");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Quit Helium and open it again");
    expect(notices[0]).toContain("0.5.0");
    // No package (a checkout without dashi-helium): nothing to compare with.
    const silent: string[] = [];
    staleExtensionWatch(
      (notice) => silent.push(notice.summary),
      () => null,
    )("0.5.0");
    expect(silent).toEqual([]);
  });
});
