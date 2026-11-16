// The Store's window over the catalog on this computer: dnf and PackageKit from the stand-in's small computer
// (Fedora, Terra, Dashi's COPR, a COPR enabled by hand), Flathub from fixtures, nothing installed anywhere.

import { expect, test } from "bun:test";
import { harness, isolateRuntime } from "./support/software-view.tsx";
import { fakeClockEachTest, settle } from "./support/time.ts";

isolateRuntime();
fakeClockEachTest();

test("the window is the Store, with the shelves in the sidebar and categories off it", async () => {
  const { view } = harness();
  await settle(120);
  for (const id of ["nav:discover", "nav:apps", "nav:applets", "nav:widgets", "nav:extensions", "nav:installed", "nav:updates"])
    expect(view.nodeId(id)).toBeDefined();
  expect(view.nodeId("nav:category:AudioVideo")).toBeUndefined();
  view.unmount();
});

test("search finds an app in every source and says where it comes from; tools come under In Terminal", async () => {
  const { view, type } = harness();
  await settle(120);
  await type("search", "htop");
  await settle(120);
  expect(view.nodeId("search-results")).toBeDefined();
  const tree = view.lastTree() ?? "";
  expect(tree).toContain("Fedora package");
  // Terra's own app, only in Terra.
  expect(view.nodeId("entry:app:neohtop")).toBeDefined();
  expect(tree).toContain('"Terra"');
  await type("search", "ripgrep");
  await settle(120);
  expect(view.nodeId("tool:ripgrep")).toBeDefined();
  expect(view.lastTree()).toContain("In Terminal");
  expect(view.lastTree()).toContain("also in Terra");
  await type("search", "cowsay");
  await settle(120);
  expect(view.lastTree()).toContain("alexk/tiny-tools · Community build, not reviewed by Fedora");
  view.unmount();
});

test("a package's page says it isn't sandboxed, and Get asks before PackageKit installs it from the chosen source", async () => {
  const { view, type, press, log } = harness();
  await settle(120);
  await type("search", "ripgrep");
  await settle(120);
  await press("entry-pill:tool:ripgrep");
  await settle(40);
  expect(view.nodeId("get-package-sheet")).toBeDefined();
  expect(view.lastTree()).toContain("packages aren’t sandboxed");
  expect(log.some((line) => line.startsWith("pkcon -p -y install"))).toBe(false);
  await press("get-package-sheet:get");
  await settle(400);
  expect(log).toContain("pkcon -p -y install ripgrep;15.1.0-1.fc44;x86_64;fedora");
  view.unmount();
});

test("the Source pop-up shows the app from another source; the page names who vouches for it", async () => {
  const { view, type, press } = harness();
  await settle(120);
  await type("search", "ripgrep");
  await settle(120);
  await press("tool-open:ripgrep");
  await settle(80);
  expect(view.nodeId("package-page")).toBeDefined();
  expect(view.nodeId("source-pop-up")).toBeDefined();
  expect(view.lastTree()).toContain("Packaged by Fedora");
  expect(view.lastTree()).toContain("From Fedora: Fedora builds it from source and signs it.");
  view.unmount();
});

test("Sources lists Flathub, Fedora, Dashi, Terra and the hand-enabled COPR; Terra turns off and back on", async () => {
  const { view, press, log } = harness({ initialPage: "installed" });
  await settle(120);
  await press("sources");
  await settle(60);
  for (const id of ["flathub", "fedora", "copr:pejedev/dashi", "terra", "copr:alexk/tiny-tools"]) expect(view.nodeId(`source:${id}`)).toBeDefined();
  const tree = view.lastTree() ?? "";
  expect(tree).toContain("Community build, not reviewed by Fedora");
  expect(tree).not.toContain("Add Source");
  await press("source-switch:terra");
  await settle(200);
  expect(log).toContain("pkcon repo-disable terra");
  await press("source-switch:terra");
  await settle(200);
  expect(log).toContain("pkcon repo-enable terra");
  view.unmount();
});

test("Widgets is an empty shelf, and Launcher extensions says when there are none", async () => {
  const { view, press } = harness();
  await settle(120);
  await press("nav:widgets");
  expect(view.nodeId("widgets-shelf")).toBeDefined();
  await press("nav:extensions");
  await settle(80);
  expect(view.nodeId("no-extensions")).toBeDefined();
  view.unmount();
});

test("an app got as a package is on Installed with its source, Open and Remove…", async () => {
  const { view, type, press, log } = harness();
  await settle(120);
  await type("search", "neohtop");
  await settle(120);
  await press("entry-pill:app:neohtop");
  await press("get-package-sheet:get");
  await settle(400);
  expect(log).toContain("pkcon -p -y install neohtop;1.2.0-1.fc44;x86_64;terra");
  for (let step = 0; step < 6; step++) await settle(100);
  await press("nav:installed");
  await settle(120);
  expect(view.nodeId("installed-package:neohtop")).toBeDefined();
  expect(view.lastTree()).toContain("1.2.0-1.fc44 · Terra");
  await press("remove-package:neohtop");
  await settle(40);
  expect(view.nodeId("remove-package-sheet")).toBeDefined();
  view.unmount();
});
