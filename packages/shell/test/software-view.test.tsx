// Software's window on a stand-in for the Metal host: Flathub from fixtures, flatpak and pkcon faked
// (nothing is installed anywhere), and the applets from a test catalog signed with throwaway keys.

import { expect, test } from "bun:test";
import { harness, isolateRuntime, WIDE } from "./support/software-view.tsx";
import { settle } from "./support/time.ts";

isolateRuntime();

test("an app's page leads with the trust card, and an app that reaches far asks before it installs", async () => {
  const { view, press, store, log, opened } = harness();
  await settle(120);
  await press(`card:${WIDE}`);
  await settle(80);
  const page = view.lastTree() ?? "";
  // Who made it, what it reaches, what changed, how many use it.
  expect(view.nodeId("trust-card")).toBeDefined();
  expect(page).toContain("Not verified by Flathub");
  expect(page).toContain("Read and change all your files");
  expect(page).toContain("Use the network");
  expect(page).toContain("Faster opening.");
  expect(page).toContain("Version 2.0");
  expect(page).toContain("120K installs last month");
  // The License row says Proprietary, not Flathub's raw reference.
  expect(page).toContain('"Proprietary"');
  expect(page).not.toContain("LicenseRef");
  expect(page).toContain("Get…");

  // The website opens in the browser.
  await press("link:Website");
  expect(opened).toEqual(["https://example.com/wide"]);

  // Get… asks first; nothing is installed until the sheet says yes.
  await press("install");
  await settle(40);
  expect(view.nodeId("get-sheet")).toBeDefined();
  expect(view.lastTree()).toContain("Its code isn’t open");
  expect(log.some((line) => line.startsWith("flatpak install"))).toBe(false);
  await press("get-sheet:get");
  await settle(60);
  expect(view.nodeId("get-sheet")).toBeUndefined();
  expect(log.some((line) => line === `flatpak install --user -y flathub ${WIDE}`)).toBe(true);
  expect(store.getSnapshot().failure).toBeNull();
  view.unmount();
});

test("the update notice's Show opens Software on Updates", async () => {
  const { view } = harness({ initialPage: "updates" });
  await settle(200);
  expect(view.nodeId("updates")).toBeDefined();
  expect(view.nodeId("discover")).toBeUndefined();
});

test("a card says Get… once its app's page is known to ask first, as the page does", async () => {
  const { view, press } = harness();
  await settle(120);
  const pill = (): string => {
    const tree = view.lastTree() ?? "";
    const at = tree.indexOf(`"id":"${view.nodeId(`pill:${WIDE}`)}"`);
    expect(at).toBeGreaterThan(0);
    return tree.slice(at, at + 400);
  };
  expect(pill()).toContain('"Get"');
  await press(`card:${WIDE}`);
  await settle(80);
  await press("back");
  await settle(80);
  expect(pill()).toContain('"Get…"');
  view.unmount();
});
