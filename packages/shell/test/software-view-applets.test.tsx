// Software's window on a stand-in for the Metal host: Flathub from fixtures, flatpak and pkcon faked
// (nothing is installed anywhere), and the applets from a test catalog signed with throwaway keys.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, readInstalled } from "@dashi/applet";
import { harness, isolateRuntime } from "./support/software-view.tsx";
import { settle } from "./support/time.ts";

isolateRuntime();

test("applets are a section of Software: one search, the trust card, and the consent sheet on a Sheet", async () => {
  const { view, press, root } = harness();
  await settle(150);
  expect(view.nodeId("nav:applets")).toBeDefined();
  // Discover shows a few, this computer's first.
  expect(view.nodeId("section:applets")).toBeDefined();
  expect(view.lastTree()).toContain("Made for this computer");

  await press("applet:dev.netko.asus-control:open");
  const page = view.lastTree() ?? "";
  expect(view.nodeId("trust-card")).toBeDefined();
  expect(page).toContain("Reviewed by Dashi");
  expect(page).toContain("Signed by its author");
  expect(page).toContain("Change the power mode, battery charge limit and processor boost");
  expect(page).toContain("Lights follow the power mode.");
  expect(view.nodeId("mark:verified")).toBeUndefined();
  expect(view.nodeId("mark:reviewed")).toBeDefined();

  // Get… shows the consent sheet; nothing is installed until it says yes.
  await press("get");
  expect(view.nodeId("applet-consent")).toBeDefined();
  expect(view.lastTree()).toContain("Get “ASUS Control”?");
  expect(readInstalled(root)).toEqual([]);
  await press("consent-add");
  await settle(150);
  expect(view.nodeId("applet-consent")).toBeUndefined();
  expect(readInstalled(root)[0]?.record.consent).toEqual(["hardware.power", "notifications"]);
  // Installed, it can be managed: turned off, and on again.
  expect(view.nodeId("manage")).toBeDefined();
  await press("manage:on");
  expect(readInstalled(root)[0]?.record.disabled).toEqual({ reason: "off" });
  await press("manage:on");
  expect(readInstalled(root)[0]?.record.disabled).toBeUndefined();
  view.unmount();
});

test("without a key for Dashi's catalog, the applets' place is where another catalog is added", async () => {
  const { view, press } = harness({ key: false });
  await settle(120);
  expect(view.nodeId("section:applets")).toBeUndefined();
  await press("nav:applets");
  expect(view.nodeId("applets-coming")).toBeDefined();
  await press("catalogs");
  expect(view.nodeId("catalogs")).toBeDefined();
  expect(view.lastTree()).toContain("Built in · not set up in this Dashi yet");
  expect(view.nodeId("catalog:Dashi:remove")).toBeUndefined();
  view.unmount();
});

test("an applet this Dashi can't read is left out and counted under the list; one installed that no longer reads needs an update", async () => {
  const newer = {
    manifest: {
      id: "dev.example.lights",
      name: "Lights",
      version: "0.1.0",
      dashi: ">=0.9",
      entry: "src/main.tsx",
      summary: "x",
      author: { name: "Alex Kim" },
      permissions: ["lights.everywhere"],
    },
    authorKey: generateKeys().publicKey.split("\n")[1],
    source: { url: "https://github.com/x/lights", commit: "abcdef0" },
    versions: [{ version: "0.1.0", dashi: ">=0.9", url: "https://github.com/x", sha256: "0".repeat(64), size: 1, signature: "x", released: "2026-11-04" }],
  };
  // Installed before, from a catalog this list no longer has: its applet.json names a permission this Dashi doesn't know.
  const root = mkdtempSync(join(tmpdir(), "dashi-software-root-"));
  mkdirSync(join(root, "dev.example.clock"));
  writeFileSync(join(root, "dev.example.clock", "applet.json"), JSON.stringify({ ...newer.manifest, id: "dev.example.clock", name: "Clock" }));
  writeFileSync(
    join(root, "dev.example.clock", "install.json"),
    JSON.stringify({ version: "0.1.0", sha256: "0".repeat(64), authorKey: null, source: "local", consent: [] }),
  );
  const { view, press } = harness({ extra: [newer], root });
  await settle(150);
  await press("nav:applets");
  expect(view.nodeId("applet:dev.netko.asus-control")).toBeDefined();
  expect(view.nodeId("applet:dev.example.lights")).toBeUndefined();
  expect(view.nodeId("applets-skipped")).toBeDefined();
  expect(view.lastTree()).toContain("1 applet needs a newer Dashi");
  await press("nav:installed");
  expect(view.nodeId("installed:dev.example.clock")).toBeDefined();
  expect(view.lastTree()).toContain("0.1.0 · Needs an update");
  await press("installed:dev.example.clock:open");
  expect(view.nodeId("mend")).toBeDefined();
  await press("remove");
  expect(view.nodeId("remove-sheet")).toBeDefined();
  await press("remove-sheet:confirm");
  await settle(150);
  expect(existsSync(join(root, "dev.example.clock"))).toBe(false);
  view.unmount();
});
