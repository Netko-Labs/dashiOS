/**
 * The desktop's layout (main.tsx): Spaces, a Desktop for each full-screen
 * window, the screens' scale and arrangement, where windows open and tile,
 * the menu bar over full screen, Mission Control and the touchpad's gestures.
 */

import { Arranger } from "../arrange.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import { DisplayManager, DisplayStore, keepSheet, watchLid } from "../display-config/index.ts";
import { scaleForMonitor } from "../display-config/scale.ts";
import { startDisplays } from "../displays.ts";
import { FullscreenBars } from "../fullscreen.ts";
import { startGestures } from "../gestures.ts";
import type { Arrange } from "../layout.ts";
import { openOverlay } from "../overlay.tsx";
import { OverviewController } from "../overview/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { FullscreenDesktops, type SpacesRuntime, startSpaces } from "../spaces/index.ts";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Screens } from "./session.ts";

interface DesktopsNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  screens: Screens;
  services: Services;
  late: Late<LateParts>;
}

export interface Desktops {
  spaces: SpacesRuntime | null;
  fullscreenDesktops: FullscreenDesktops | null;
  displays: DisplayManager | null;
}

/** Spaces, a Desktop for each full-screen window, and the screens' scale and arrangement. */
export async function startDesktops({ compositor, settingsStore, screens, services, late }: DesktopsNeeds): Promise<Desktops> {
  // Spaces: desktops side by side (spaces/). The count lives in settings.json; the
  // compositor keeps each window's Space and slides them, the rest is decided here.
  const spaces = compositor
    ? startSpaces({
        compositor,
        open: openOverlay,
        screen: () => screens.whereIsPerson(),
        leaveOverview: (): Promise<void> => late.get("overview")?.leave(0) ?? Promise.resolve(),
        saveCount: (count) => settingsStore.patch("spaces", { count }),
        saveNames: (names) => settingsStore.patch("spaces", { names: names.length > 0 ? names : undefined }),
        appName: (window: CompositorWindow) => late.peek("nameApp")?.(window) ?? window.appId,
      })
    : null;
  services.add("spaces", () => spaces?.close());
  // A full-screen window gets a Desktop of its own (spaces/fullscreen.ts; settings.json `spaces.fullscreenDesktop`).
  const fullscreenDesktops =
    compositor && spaces ? new FullscreenDesktops({ compositor, desktops: spaces.controller, changed: () => void late.get("fullscreenBars")?.sync() }) : null;
  services.add("full-screen desktops", fullscreenDesktops?.start() ?? (() => {}));
  const stopDisplays = compositor
    ? startDisplays(
        compositor,
        (name) => settingsStore.displayScale(name),
        (name) => settingsStore.displayVrr(name),
      )
    : () => {};
  services.add("displays", stopDisplays);
  // Where each screen sits, what it runs, and which is the main display: saved per set of connected
  // monitors and restored when they are plugged in; the lid shut with a monitor attached turns the
  // built-in panel off (display-config/). Resolution and rotation changes are asked about, and go
  // back by themselves (the sheet is on the main display).
  const displayLid = compositor ? await watchLid() : null;
  const displays = compositor
    ? new DisplayManager({
        compositor,
        store: new DisplayStore(),
        scaleFor: scaleForMonitor((name) => settingsStore.displayScale(name)),
        lid: displayLid,
        ask: keepSheet(openOverlay, () => late.get("menuBars").primaryName ?? undefined),
      })
    : null;
  const stopArrangements = displays?.start() ?? (() => {});
  services.add("display arrangement", () => {
    stopArrangements();
    displayLid?.close();
  });
  return { spaces, fullscreenDesktops, displays };
}

export interface Arranging {
  arranger: Arranger | null;
  /** Tiles, fills or centers a window (layout.ts). */
  tile: (window: number, to: Arrange) => Promise<void>;
  /** How a window is arranged now, if the arranger placed it. */
  arrangement: (window: number) => ReturnType<Arranger["arrangement"]> | null;
  fullscreenBars: FullscreenBars | null;
}

/** Where windows open, tiles, Fill, drag zones, and the square (arrange.ts, layout.ts); the menu bar over full screen. */
export async function startArranging(compositor: Compositor | null, desktops: Desktops, services: Services, late: Late<LateParts>): Promise<Arranging> {
  const { spaces, fullscreenDesktops } = desktops;
  const arranger = compositor ? new Arranger(compositor) : null;
  services.add("arranging", arranger ? await arranger.start() : () => {});
  const tile = (window: number, to: Arrange): Promise<void> => arranger?.arrange(window, to) ?? Promise.resolve();
  const arrangement = (window: number): ReturnType<Arranger["arrangement"]> | null => arranger?.arrangement(window) ?? null;
  // The menu bar comes down over a full-screen window at the top edge (fullscreen.ts).
  const fullscreenBars = late.set("fullscreenBars", compositor ? new FullscreenBars(compositor, MENU_BAR_HEIGHT) : null);
  if (arranger) arranger.afterFullscreen = () => void fullscreenBars?.sync();
  if (arranger && fullscreenDesktops) arranger.desktops = fullscreenDesktops;
  // The × on a full-screen Desktop in Mission Control takes its window out of full screen.
  if (arranger && spaces) spaces.controller.leaveFullscreen = (window) => void arranger.fullscreen(window, false);
  services.add("full screen", fullscreenBars?.start() ?? (() => {}));
  return { arranger, tile, arrangement, fullscreenBars };
}

/** Mission Control (⌃↑): the layout is decided here, the compositor draws it; and the touchpad's swipes. */
export function startOverview(
  compositor: Compositor | null,
  spaces: SpacesRuntime | null,
  services: Services,
  late: Late<LateParts>,
): OverviewController | null {
  const overview = late.set("overview", compositor ? new OverviewController(compositor, spaces?.overviewExtras) : null);
  services.add("overview", overview?.start() ?? (() => {}));
  // Three fingers up or down on a touchpad: Mission Control; sideways: Spaces (gestures.ts).
  const stopGestures =
    compositor && overview
      ? startGestures(compositor, {
          overview: (open) => void (open ? overview.enter() : overview.leave()),
          ...(spaces ? { spaces: spaces.controller } : {}),
        })
      : () => {};
  services.add("gestures", stopGestures);
  return overview;
}
