// Software's window on a stand-in for the Metal host: Flathub from fixtures, flatpak and pkcon faked
// (nothing is installed anywhere), and the applets from a test catalog signed with throwaway keys.

import { expect, test } from "bun:test";
import { generateKeys, readInstalled } from "@dashi/applet";
import { harness, isolateRuntime, testCatalog } from "./support/software-view.tsx";
import { settle } from "./support/time.ts";

isolateRuntime();

test("Catalogs…: one that doesn't check isn't added, one that does lists its applets “From” it, never reviewed", async () => {
  const { view, press, type, saved, root } = harness();
  const team = testCatalog({ id: "dev.alexk.timer", name: "Team Timer" });
  const wrong = generateKeys();
  await settle(150);
  await press("nav:applets");
  await press("catalogs");
  await press("catalogs:add");
  await type("add-catalog:name", "Team");
  await type("add-catalog:url", team.url);
  await type("add-catalog:key", wrong.publicKey);
  await press("add-catalog:add");
  await settle(100);
  expect(view.nodeId("add-catalog:error")).toBeDefined();
  expect(view.lastTree()).toContain("isn’t signed with this key");
  expect(saved()).toEqual([]);

  await type("add-catalog:key", team.key);
  await press("add-catalog:add");
  await settle(150);
  expect(view.nodeId("add-catalog")).toBeUndefined();
  expect(saved()).toMatchObject([{ name: "Team", url: team.url }]);
  expect(view.nodeId("catalog:Team")).toBeDefined();
  expect(view.lastTree()).toContain("1 applet · ");
  await press("catalogs:done");

  // Listed beside Dashi's, from its catalog, without Dashi's review mark.
  expect(view.nodeId("applet:dev.alexk.timer")).toBeDefined();
  expect(view.nodeId("applet:dev.netko.asus-control")).toBeDefined();
  expect(view.lastTree()).toContain("From Team");
  await press("applet:dev.alexk.timer:open");
  expect(view.lastTree()).toContain("From Team · not reviewed by Dashi");
  expect(view.nodeId("mark:reviewed")).toBeUndefined();
  await press("get");
  await press("consent-add");
  await settle(150);
  expect(readInstalled(root).find((each) => each.manifest.id === "dev.alexk.timer")?.record.catalog).toBe(team.url);

  // Removing the catalog keeps what came from it, with no updates.
  await press("nav:applets");
  await press("catalogs");
  await press("catalog:Team:remove");
  await press("remove-catalog:confirm");
  await settle(150);
  expect(saved()).toEqual([]);
  expect(view.nodeId("catalog:Team")).toBeUndefined();
  await press("catalogs:done");
  expect(view.nodeId("applet:dev.alexk.timer")).toBeUndefined();
  await press("nav:installed");
  expect(view.lastTree()).toContain("catalog removed");
  view.unmount();
});
