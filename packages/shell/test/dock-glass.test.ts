/**
 * The Dock on glass (DK-2 to DK-6, decisions.md D800 to D802): magnification
 * by icon, the label's aim, apps' counts and downloads from the launcher API,
 * the Trash, and the setting.
 */

import { expect, test } from "bun:test";
import { GLASS } from "@dashi/ui";
import { appIdOfUri, badgeFor, DockBadges, readUpdate, showsBadge } from "../src/dock/badges.ts";
import { DockController } from "../src/dock/controller.ts";
import { countWords } from "../src/dock/lib/icon.tsx";
import { AT_REST, magnified, magnifiedSize, magnifyHeadroom } from "../src/dock/lib/magnify.ts";
import { buildTrashMenu } from "../src/dock/lib/menu.ts";
import { clickBounds, DOCK_HEADROOM, labelAim } from "../src/dock/lib/view.tsx";
import { EDGE_BAND } from "../src/dock/presenter.ts";
import { resolveDock } from "../src/dock/settings.ts";
import { DockTrash, EMPTY_QUESTION } from "../src/dock/trash.ts";
import { DOCK, DOCK_HEIGHT } from "../src/theme.ts";
import { settle } from "./support/time.ts";

const { peak, neighbour, lift } = GLASS.dock.magnify;

test("magnification: the icon under the pointer at the peak, its two neighbours a step, the rest at rest", () => {
  expect(magnified(3, 3)).toEqual({ scale: peak, lift });
  expect(magnified(2, 3).scale).toBe(neighbour);
  expect(magnified(4, 3).scale).toBe(neighbour);
  expect(magnified(4, 3).lift).toBeGreaterThan(0);
  expect(magnified(4, 3).lift).toBeLessThan(lift);
  expect(magnified(5, 3)).toEqual(AT_REST);
  expect(magnified(0, null)).toEqual(AT_REST);
  expect(magnifiedSize(DOCK.icon, magnified(3, 3))).toBe(Math.round(DOCK.icon * peak));
});

test("the surface keeps room above the panel for the tallest icon and its label; clicks reach the lifted icon only while lifted", () => {
  expect(magnifyHeadroom(DOCK.icon)).toBe(Math.round(DOCK.icon * peak) - DOCK.icon + lift);
  expect(DOCK_HEADROOM).toBe(magnifyHeadroom(DOCK.icon) + GLASS.dock.label.gap + GLASS.dock.label.height);
  const panel = { x: 400, y: 100, width: 500, height: DOCK_HEIGHT };
  expect(clickBounds(panel, false)).toEqual(panel);
  const grown = clickBounds(panel, true);
  expect(grown.y).toBe(panel.y - magnifyHeadroom(DOCK.icon));
  expect(grown.y + grown.height).toBe(panel.y + panel.height);
});

test("the label sits over the icon as drawn: higher when it is magnified", () => {
  const hovered = { key: "notes", index: 2, name: "Notes", bounds: { x: 100, y: 0, width: 48, height: 60 } };
  const rest = labelAim(hovered, false);
  const grown = labelAim(hovered, true);
  expect(rest).toEqual({ name: "Notes", centerX: 124, iconTop: DOCK_HEIGHT - DOCK.paddingTop });
  expect(grown?.iconTop).toBe(DOCK_HEIGHT - DOCK.paddingTop + magnifyHeadroom(DOCK.icon));
  expect(labelAim({ ...hovered, bounds: null }, true)).toBeNull();
});

const update = (body: unknown[], sender = ":1.42") => ({ body, sender });
const props = (entries: Record<string, unknown>) => new Map(Object.entries(entries));

test("a count and a download from the launcher API, merged, cleared when hidden", () => {
  expect(appIdOfUri("application://org.mozilla.firefox.desktop")).toBe("org.mozilla.firefox");
  expect(appIdOfUri("file:///x")).toBeNull();
  let badge = readUpdate({}, props({ count: 3n, "count-visible": true }));
  expect(badge).toEqual({ count: 3 });
  badge = readUpdate(badge, props({ progress: 0.42, "progress-visible": true }));
  expect(badge).toEqual({ count: 3, progress: 0.42 });
  badge = readUpdate(badge, props({ "count-visible": false }));
  expect(badge).toEqual({ progress: 0.42 });
  expect(readUpdate({}, props({ progress: 7 }))).toEqual({ progress: 1 });
  expect(showsBadge({ count: 0 })).toBe(false);
  expect(countWords(12)).toBe("12");
  expect(countWords(1200)).toBe("99+");
});

test("the store: an app's word stands until it is hidden or the app leaves the bus", () => {
  const store = new DockBadges();
  let heard = 0;
  store.subscribe(() => heard++);
  store.update(update(["application://helium.desktop", props({ count: 5, "count-visible": true })]));
  expect(badgeFor(store.getSnapshot(), "helium")).toEqual({ count: 5 });
  store.update(update(["application://helium.desktop", props({ "count-visible": false })]));
  expect(store.getSnapshot().has("helium")).toBe(false);
  store.update(update(["application://helium.desktop", props({ progress: 0.5, "progress-visible": true })]));
  store.gone(":1.9");
  expect(store.getSnapshot().has("helium")).toBe(true);
  store.gone(":1.42");
  expect(store.getSnapshot().has("helium")).toBe(false);
  expect(heard).toBe(4);
});

function trashWith(names: string[], answer: boolean) {
  const calls: string[] = [];
  const trash = new DockTrash({
    folder: "/trash",
    list: async () => names,
    watchFolder: () => null,
    open: () => calls.push("open"),
    trash: async (paths) => {
      calls.push(`trash:${paths.join(",")}`);
      names.push(...paths);
    },
    empty: async () => {
      calls.push("empty");
      names.length = 0;
    },
    confirm: async (question) => {
      calls.push(`ask:${question.title}`);
      return answer;
    },
  });
  return { trash, calls };
}

test("the Trash is full while its folder holds anything; Empty Trash asks first, and no keeps everything", async () => {
  const kept = trashWith(["a.txt"], false);
  kept.trash.start();
  await settle();
  expect(kept.trash.getSnapshot()).toBe(true);
  expect(await kept.trash.empty()).toBe(false);
  expect(kept.calls).toEqual([`ask:${EMPTY_QUESTION.title}`]);
  expect(kept.trash.getSnapshot()).toBe(true);

  const emptied = trashWith(["a.txt"], true);
  emptied.trash.start();
  await settle();
  expect(await emptied.trash.empty()).toBe(true);
  expect(emptied.calls).toEqual([`ask:${EMPTY_QUESTION.title}`, "empty"]);
  expect(emptied.trash.getSnapshot()).toBe(false);
  expect(EMPTY_QUESTION.danger).toBe(true);
  await emptied.trash.drop(["/home/alexk/old.txt"]);
  expect(emptied.calls.at(-1)).toBe("trash:/home/alexk/old.txt");
  expect(emptied.trash.getSnapshot()).toBe(true);
});

test("the Trash's menu: Open, and Empty Trash…, which the controller hands to the Trash", async () => {
  const menu = buildTrashMenu();
  expect(menu.map((entry) => (entry.kind === "item" ? entry.label : "—"))).toEqual(["Open", "—", "Empty Trash…"]);
  const done: string[] = [];
  const controller = new DockController({
    catalog: [],
    pins: { pin: () => {}, unpin: () => {} },
    toplevels: { act: () => {}, getSnapshot: () => [], subscribe: () => () => {} },
    compositor: null,
    launch: () => null,
  });
  controller.trash = {
    open: () => void done.push("open"),
    empty: async () => {
      done.push("empty");
      return true;
    },
  };
  await controller.run({ kind: "trash-open" });
  await controller.run({ kind: "trash-empty" });
  expect(done).toEqual(["open", "empty"]);
  controller.close();
});

test("magnification is on by default, and the hidden Dock's band is GLASS.dock's two points", () => {
  expect(resolveDock({}).magnify).toBe(true);
  expect(resolveDock({ magnify: false }).magnify).toBe(false);
  expect(resolveDock({ magnify: "yes" }).magnify).toBe(true);
  expect(EDGE_BAND).toBe(GLASS.dock.reveal.band);
});
