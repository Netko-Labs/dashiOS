import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { Banner, bannerHeight, buttonsFor } from "../src/notifications/banner.tsx";
import { NotificationStore } from "../src/notifications/store.ts";
import type { FlatpakUpdate } from "../src/software/flatpak-parse.ts";
import { openSoftwareUpdates, UpdateCheck } from "../src/software/update-check.ts";
import { settle } from "./support/time.ts";

// The daily update notice, clicked: from the banner (or its Show button, or the notification center)
// through the store and the update check to the shell's openWith, as main.tsx wires it.

async function posted(windows: { id: number; appId: string }[] = []) {
  const store = new NotificationStore({ schedule: () => () => {} });
  // As the D-Bus server answers: a sender of "" is no app on the bus.
  store.setPresence(async (sender) => sender !== "" && sender.startsWith(":"));
  const launched: Array<{ appId: string; env: Record<string, string> }> = [];
  const activated: number[] = [];
  const logged: string[] = [];
  const check = new UpdateCheck({
    software: {
      hasFlatpak: true,
      hasPackageKit: true,
      flatpakUpdates: async () => [
        { id: "org.videolan.VLC", version: "3.0.22" } as FlatpakUpdate,
        { id: "org.mozilla.firefox", version: "141" } as FlatpakUpdate,
      ],
      systemUpdates: async () => ({ updates: [{ name: "kernel" }] as never, restartCauses: [] }),
    },
    notifications: store,
    open: () =>
      openSoftwareUpdates({
        windows: () => windows,
        activate: (id) => activated.push(id),
        openWith: (appId, env) => launched.push({ appId, env }) > 0,
        log: (line) => logged.push(line),
      }),
    statePath: null,
    setTimer: () => () => {},
  });
  check.start();
  await check.look();
  const notice = store.getSnapshot().banners[0];
  if (!notice) throw new Error("no banner");
  return { store, notice, launched, activated, logged, check };
}

function banner(store: NotificationStore, id: number) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(<Banner store={store} id={id} />, transport);
  const press = async (testID: string): Promise<void> => {
    await settle();
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  return { root, press };
}

test("a click on the update banner starts Software on Updates", async () => {
  const { store, notice, launched, logged } = await posted();
  expect(notice.summary).toBe("Updates are ready");
  await banner(store, notice.id).press("banner");
  expect(launched).toEqual([{ appId: "dev.dashi.software", env: { DASHI_SOFTWARE_PAGE: "updates" } }]);
  expect(logged).toEqual(["dashi-shell: the update notice opens Software on Updates"]);
  expect(store.getSnapshot().banners).toEqual([]);
});

test("the banner draws the notice's Show button, and it opens Software too", async () => {
  const { store, notice, launched } = await posted();
  expect(buttonsFor(notice).map((action) => action.label)).toEqual(["Show"]);
  // Room for the button row under the two lines of body.
  expect(bannerHeight(notice)).toBe(12 * 2 + 18 + 4 + 2 * 16 + 8 + 26);
  const { press } = banner(store, notice.id);
  await press("banner-action:show");
  expect(launched.map((each) => each.appId)).toEqual(["dev.dashi.software"]);
});

test("with Software open, the click brings its window forward instead", async () => {
  const { store, notice, launched, activated } = await posted([{ id: 7, appId: "dev.dashi.software" }]);
  await banner(store, notice.id).press("banner");
  expect(activated).toEqual([7]);
  expect(launched).toEqual([]);
});

test("a click in the notification center runs it too: the shell posts it as its own", async () => {
  const { store, notice, launched } = await posted();
  store.setCenterOpen(true);
  expect(await store.activate(notice.id)).toBe(true);
  expect(launched.map((each) => each.appId)).toEqual(["dev.dashi.software"]);
});
