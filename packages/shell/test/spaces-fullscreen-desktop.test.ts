/**
 * A full-screen window's own Desktop: going in and out of it (its dialogs along, the window carried
 * once its app has drawn it), a Desktop removed or a window closed meanwhile, and the arranger's route.
 */

import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange.ts";
import type { Compositor } from "../src/compositor.ts";
import { SpacesController } from "../src/spaces/controller.ts";
import { FullscreenDesktops } from "../src/spaces/fullscreen.ts";
import { desk, fakeCompositor, SETTINGS, win } from "./support/spaces-fullscreen.ts";
import { fakeClock, settle } from "./support/time.ts";

describe("a full-screen window's own Desktop", () => {
  test("entering: a Desktop right after its own, full screen where it is, then carried there", async () => {
    const { fake, desktops, saved, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    expect(fake.moves()).toEqual([
      ["space-add", { at: 1 }],
      ["fullscreen", { window: 1, on: true }],
      ["space-switch", { space: 1, carry: 1 }],
    ]);
    expect(fake.state.windows.find((each) => each.id === 1)?.space).toBe(1);
    const snapshot = desktops.getSnapshot();
    expect(snapshot.fullscreen).toEqual([null, 1, null]);
    expect(snapshot.current).toBe(1);
    expect(snapshot.labels).toEqual(["Desktop 1", "App 1", "App 2"]);
    // settings.json still says two Desktops.
    expect(saved).toEqual([]);
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(2);
  });

  test("leaving: out of full screen where it is, carried back as its Desktop slides in, then its Desktop goes", async () => {
    const { fake, desktops, saved, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.requests.length = 0;
    await toggle(1, false);
    expect(fake.moves()).toEqual([
      ["fullscreen", { window: 1, on: false }],
      ["space-switch", { space: 0, carry: 1 }],
      ["space-remove", { space: 1 }],
    ]);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
    expect(desktops.getSnapshot().current).toBe(0);
    expect(fake.state.windows.map((each) => each.space)).toEqual([0, 1]);
    expect(saved).toEqual([]);
  });

  test("carried only once its app has drawn it at the new size", async () => {
    const { fake, toggle } = await desk([win(1, 0), win(2, 1)]);
    const game = fake.state.windows.find((each) => each.id === 1);
    if (!game) throw new Error("no window 1");
    game.configuring = { width: 1646, height: 937 };
    const clock = fakeClock();
    const carried = toggle(1, true);
    // The app is still drawing: the window waits where it is.
    await clock.advance(100, 10);
    expect(fake.requests.some(([method]) => method === "space-switch")).toBe(false);
    game.configuring = undefined;
    await clock.advance(100, 10);
    await carried;
    clock.restore();
    expect(fake.requests.some(([method]) => method === "space-switch")).toBe(true);
  });

  test("its dialogs come along, and go back with it", async () => {
    const { fake, toggle } = await desk([win(1, 0), win(3, 0, { parent: 1 })]);
    await toggle(1, true);
    expect(fake.state.windows.map((each) => each.space)).toEqual([1, 1]);
    await toggle(1, false);
    expect(fake.state.windows.map((each) => each.space)).toEqual([0, 0]);
  });

  test("closed while full screen: the screen slides back and its Desktop goes", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.state.windows = fake.state.windows.filter((each) => each.id !== 1);
    fake.emit({ event: "window-closed", id: 1 });
    await settle();
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("minimized while full screen: out of full screen where it waits, and its Desktop goes", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.requests.length = 0;
    const game = fake.state.windows.find((each) => each.id === 1);
    if (game) game.state = "minimized";
    fake.emit({ event: "window-state", window: 1, state: "minimized" });
    await settle();
    expect(fake.moves()).toEqual([
      ["space-move", { window: 1, space: 0 }],
      ["fullscreen", { window: 1, on: false }],
      ["space-switch", { space: 0 }],
      ["space-remove", { space: 1 }],
    ]);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("its Desktop removed meanwhile: it goes back to the nearest one on the left", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 1), win(2, 0)], 3, { ...SETTINGS, count: 3 });
    await toggle(1, true);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null, 1, null]);
    await desktops.remove(1);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, null]);
    await toggle(1, false);
    expect(fake.state.windows.find((each) => each.id === 1)?.space).toBe(0);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("the first Desktop removed: its windows skip the full-screen Desktop beside it", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 0)], 2);
    await toggle(1, true);
    await desktops.switchTo(0);
    await settle();
    await desktops.remove(0);
    // Desktop 2 (now the second Space) took them, not the game's.
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(1);
    expect(desktops.getSnapshot().fullscreen).toEqual([1, null]);
  });

  test("the last Desktop stays, and a full-screen Desktop's × takes its window out of full screen", async () => {
    const { desktops, toggle } = await desk([win(1, 0)], 1, { ...SETTINGS, count: 1 });
    await toggle(1, true);
    const left: number[] = [];
    desktops.leaveFullscreen = (window) => left.push(window);
    await desktops.remove(0);
    expect(desktops.getSnapshot().count).toBe(2);
    await desktops.remove(1);
    expect(left).toEqual([1]);
  });

  test("two full screen from one Desktop: each its own, in the order they came", async () => {
    const { desktops, toggle } = await desk([win(1, 0), win(2, 0), win(3, 1)]);
    await toggle(1, true);
    await toggle(2, true);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, 2, null]);
    await toggle(1, false);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 2, null]);
  });

  test("a new window while one shows opens on the Desktop it came from; the app's dialogs stay", async () => {
    const { desktops, fullscreen, toggle } = await desk([win(1, 0), win(4, 0, { parent: 1 })]);
    await toggle(1, true);
    expect(desktops.getSnapshot().current).toBe(1);
    expect(await fullscreen.spaceFor({ id: 9, appId: "other", title: "", width: 300, height: 200 })).toBe(0);
    expect(await fullscreen.spaceFor({ id: 9, appId: "game", title: "", width: 300, height: 200, parent: 1 })).toBeNull();
    // A dialog of its dialog stays too; a dialog of a window elsewhere does not.
    expect(await fullscreen.spaceFor({ id: 9, appId: "game", title: "", width: 300, height: 200, parent: 4 })).toBeNull();
    await desktops.switchTo(0);
    await settle();
    expect(await fullscreen.spaceFor({ id: 9, appId: "other", title: "", width: 300, height: 200 })).toBeNull();
  });

  test("a window put onto a full-screen Desktop goes back, and the overview's drop is refused", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 0)]);
    await toggle(1, true);
    await desktops.move(2, 1);
    expect(fake.requests.some(([method, params]) => method === "space-move" && params.window === 2)).toBe(false);
    // Activation brought it here (switchOnActivate off), or an agent did.
    await fake.compositor.request("space-move", { window: 2, space: 1 });
    await settle();
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(0);
    expect(desktops.getSnapshot().current).toBe(0);
    // Nor does the full-screen window leave its own.
    fake.requests.length = 0;
    await desktops.move(1, 2);
    expect(fake.requests).toEqual([]);
  });

  test("renaming skips it: names are by Desktop", async () => {
    const names: Array<(string | null)[]> = [];
    const fake = fakeCompositor([win(1, 0)], 2);
    const desktops = new SpacesController(fake.compositor, () => {}, { saveNames: (each) => names.push(each) });
    desktops.start();
    await desktops.apply(SETTINGS);
    const fullscreen = new FullscreenDesktops({ compositor: fake.compositor, desktops, slideWaitMs: 200 });
    fullscreen.start();
    await fullscreen.around(win(1, 0), true, () => fake.compositor.request("fullscreen", { window: 1, on: true }).then(() => {}));
    desktops.rename(1, "Nope");
    desktops.rename(2, "Second");
    expect(names).toEqual([[null, "Second"]]);
  });

  test("turned off, full screen stays on the Desktop it is on", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0)], 2, { ...SETTINGS, fullscreenDesktop: false });
    await toggle(1, true);
    expect(fake.moves()).toEqual([["fullscreen", { window: 1, on: true }]]);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
  });

  test("after a restart of the shell: found again, not counted, and left as it is", async () => {
    const windows = [win(1, 0), win(2, 1, { fullscreen: true })];
    const { fake, desktops, saved, toggle } = await desk(windows, 3, { ...SETTINGS, count: 2 });
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 2, null]);
    expect(desktops.getSnapshot().labels[1]).toBe("App 2");
    expect(fake.state.count).toBe(3);
    expect(saved).toEqual([]);
    await toggle(2, false);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, fullscreen: [null, null] });
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(0);
  });

  test("through the arranger: every way in and out goes around its Desktop", async () => {
    const { fake, desktops, fullscreen } = await desk([win(1, 0, { focused: true })]);
    const arranger = new Arranger(fake.compositor as unknown as Compositor);
    arranger.desktops = fullscreen;
    await arranger.start();
    // The app asks itself, as a game or a video player does.
    fake.emit({ event: "fullscreen", window: 1, on: true });
    await settle();
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, null]);
    await arranger.toggleFullscreen(1);
    await settle();
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
    expect(fake.state.windows[0]?.fullscreen).toBeUndefined();
    // A new window while a full-screen Desktop shows is placed on the Desktop it came from.
    fake.emit({ event: "fullscreen", window: 1, on: true });
    await settle();
    fake.state.windows.push(win(5, 1));
    await arranger.place({ id: 5, appId: "other", title: "", width: 400, height: 300 });
    await settle();
    expect(fake.requests.find(([method, params]) => method === "place" && params.window === 5)?.[1]).toMatchObject({ space: 0 });
    expect(desktops.getSnapshot().current).toBe(0);
  });
});
