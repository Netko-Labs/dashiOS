/**
 * The overlays the shell opens on demand, other than the launcher (main.tsx):
 * the shortcut sheet, the app switcher, and the screenshot tools (⇧❖3, ⇧❖4's
 * selection, ⇧❖5's toolbar and the recorder).
 */

import type { CaptureKind } from "../actions/sources/commands.ts";
import { appFor, displayName, registerShellApp, SCREENSHOT_APP_ID } from "../apps.ts";
import { placedOutputs } from "../arrange.ts";
import type { Compositor, Frame } from "../compositor.ts";
import type { Entry } from "../entries.ts";
import { withSwitcher } from "../keymap.ts";
import { currentKeymap, idleKeymap } from "../keymap-state.ts";
import type { RankingMemory } from "../launcher/ranking/index.ts";
import type { Menus } from "../menus/index.ts";
import type { Notifications } from "../notifications/index.ts";
import { openOverlay } from "../overlay.tsx";
import type { OverlaySlots } from "../overlay-slots.ts";
import { type Capture, startCapture } from "../recorder/index.ts";
import type { ScreenCapture } from "../screen-capture.ts";
import { type AreaCapture, areaCapture, captureScreenNear } from "../screenshot-area.tsx";
import { takeScreenshot } from "../screenshots.ts";
import type { App } from "../shared/apps/index.ts";
import { iconPath } from "../shared/apps/index.ts";
import { SHEET, ShortcutSheet } from "../sheet.tsx";
import { centeredOn, type SwitcherApp, SwitcherController, SwitcherPanel, type SwitcherState, SwitcherStore } from "../switcher/index.ts";
import type { ToplevelStore } from "../toplevels.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import { onScreen, type Screens } from "./session.ts";

export type OverlayKind = "launcher" | "sheet" | "switcher";

/** How long a screenshot from the launcher waits once its window is hidden: the host takes it down, then the compositor draws without it. */
const LAUNCHER_GONE_MS = 150;

/** The screen holding `window` (else the primary), for the capture toolbar and the selection overlay. */
export async function screenOf(compositor: Pick<Compositor, "outputs" | "windows"> | null, window: number | null) {
  if (!compositor) return { origin: { x: 0, y: 0 } };
  const [outputs, windows] = await Promise.all([compositor.outputs(), compositor.windows().catch(() => [])]);
  return captureScreenNear(outputs, windows.find((each) => each.id === window)?.frame ?? null);
}

/** Screenshots and the screen recorder (recorder/, screenshot-area.tsx, screenshots.ts). */
export class Screenshots {
  /** ⇧❖5's toolbar and the recorder; none without a compositor. */
  readonly tools: Capture | null;
  /** ⇧❖4's selection overlay, made on first use. */
  private area: AreaCapture | undefined;
  private focusedAtCapture: number | null = null;

  constructor(
    private readonly compositor: Compositor | null,
    deps: { capture: ScreenCapture | null; notifications: Notifications },
    services: Services,
    private readonly late: Late<LateParts>,
  ) {
    this.tools = compositor
      ? startCapture({
          compositor,
          open: openOverlay,
          allow: (path) => deps.capture?.allow(path) ?? (() => {}),
          notifications: deps.notifications.store,
          screen: (window) => screenOf(compositor, window),
          captureArea: (window) => this.selectArea(window),
        })
      : null;
    services.add("screen recording", () => this.tools?.close());
    services.add("screenshot selection", () => this.area?.close());
  }

  /** ⇧❖4, and Capture Area in ⇧❖5's toolbar: drag out an area of the screen holding `window`. */
  selectArea(window: number | null): void {
    const compositor = this.compositor;
    if (!compositor) return;
    this.focusedAtCapture = window;
    this.area ??= areaCapture({
      open: openOverlay,
      // The focused window's screen, else the primary: named for the surface, and its corner for the area.
      screen: () => screenOf(compositor, this.focusedAtCapture),
      captureArea: (rect) => takeScreenshot(compositor, { rect }),
      captureWindow: async () => (this.focusedAtCapture === null ? undefined : takeScreenshot(compositor, { window: this.focusedAtCapture })),
    });
    this.area();
  }

  /** Takes the selection down, capturing nothing (the screen locked). */
  closeArea(): void {
    this.area?.close();
  }

  /**
   * ⇧❖3, ⇧❖4 and ⇧❖5, and the launcher's Screenshot rows (actions/sources/commands.ts). Chosen in the launcher,
   * it is taken down first and the capture waits until it is gone, so it isn't in the picture; "the focused
   * window" is then the one it was over (Space in ⇧❖4, Capture Window in the toolbar).
   */
  run = async (what: CaptureKind, window: number | null): Promise<void> => {
    const compositor = this.compositor;
    if (!compositor) return;
    const overlays = this.late.get("overlays");
    if (overlays.has("launcher")) {
      await overlays.closeAndWait("launcher");
      await Bun.sleep(LAUNCHER_GONE_MS);
    }
    const front = window ?? (await compositor.windows().catch(() => [])).find((each) => each.focused)?.id ?? null;
    switch (what) {
      case "screen":
        await takeScreenshot(compositor);
        return;
      case "area":
        return this.selectArea(front);
      case "toolbar":
        return this.tools?.toolbar(front);
    }
  };

  /** Screenshot as an app (All apps, the Dock): ⇧❖5's toolbar, over the window in front. */
  registerApp(services: Services): void {
    const stopScreenshotApp = this.compositor ? registerShellApp(SCREENSHOT_APP_ID, () => void this.run("toolbar", null)) : null;
    services.add("screenshot app", () => stopScreenshotApp?.());
  }
}

interface SheetNeeds {
  overlays: OverlaySlots<OverlayKind>;
  screens: Screens;
  toplevels: ToplevelStore;
  apps: App[];
  installedApp: (appId: string) => Entry | undefined;
  published: () => Parameters<typeof ShortcutSheet>[0]["published"];
}

/** The shortcut sheet; `pinned` (from the Help menu) closes on a click or Esc instead of on releasing ❖. */
export function sheetOpener({ overlays, screens, toplevels, apps, installedApp, published }: SheetNeeds): (pinned?: boolean, appName?: string) => void {
  return (pinned, appName) => {
    const active = toplevels.getSnapshot().find((window) => window.activated);
    void overlays.showOn("sheet", screens.whereIsPerson, (onClosed, output) =>
      openOverlay(
        {
          title: "Shortcuts",
          width: SHEET.width + 40,
          height: SHEET.height + 40,
          surface: { layer: "overlay", keyboard: pinned === true ? "exclusive" : "none", namespace: "dashi.shortcuts", ...onScreen(output) },
        },
        <ShortcutSheet
          appName={appName ?? (active ? appFor(apps, active, installedApp).name : "Desktop")}
          published={published()}
          onClose={pinned === true ? () => overlays.close("sheet") : undefined}
        />,
        onClosed,
      ),
    );
  };
}

interface SwitcherNeeds {
  compositor: Compositor | null;
  overlays: OverlaySlots<OverlayKind>;
  screens: Screens;
  installedApp: (appId: string) => Entry | undefined;
  rankingMemory: RankingMemory;
}

export interface Switcher {
  controller: SwitcherController | null;
  show(state: SwitcherState): void;
}

/** The app switcher (⌘⇥): its panel, its windows' live pictures, and its own keys while it is up. */
export function startSwitcher({ compositor, overlays, screens, installedApp, rankingMemory }: SwitcherNeeds): Switcher {
  const switcher = new SwitcherStore();
  /** The switcher names apps as the Dock does: the shared catalog, hidden entries included (T3 Code's window matches its NoDisplay entry). */
  const identify = (app: SwitcherApp): { name: string; icon: string } => {
    const entry = installedApp(app.appId);
    return entry ? { name: entry.name, icon: entry.icon } : { name: displayName(app.appId, app.title), icon: iconPath("generic") };
  };
  /** Where the switcher's surface is on screen (global logical), once it is open: its window pictures go from there. */
  let switcherOrigin: Promise<{ x: number; y: number } | null> = Promise.resolve(null);
  let controller: SwitcherController | null = null;

  const show = (state: SwitcherState): void => {
    switcher.set(state);
    if (overlays.has("switcher")) return;
    const { width, height } = state.size;
    void overlays.showOn("switcher", screens.whereIsPerson, (onClosed, output) => {
      // Layer-shell centers it in what the menu bar and the Dock leave free (switcher/layout.ts).
      switcherOrigin = (compositor?.outputs() ?? Promise.resolve([]))
        .then((answer) => {
          const outputs = placedOutputs(answer);
          const screen = outputs.find((each) => each.name === output) ?? outputs[0];
          return screen ? centeredOn(screen.usable, state.size) : null;
        })
        .catch(() => null);
      return openOverlay(
        { title: "Switcher", width, height, surface: { layer: "overlay", namespace: "dashi.switcher", ...onScreen(output) } },
        <SwitcherPanel
          store={switcher}
          identify={identify}
          onPoint={(app, window) => controller?.point(app, window)}
          onPick={(app, window) => controller?.pick(app, window)}
        />,
        onClosed,
      );
    });
  };

  /** The chosen app's windows as live pictures in the switcher (`window-thumbnails`); none clears them. */
  const pictures = (rects: ReadonlyArray<{ window: number; rect: Frame }>): void => {
    if (!compositor) return;
    void switcherOrigin
      .then((origin) => {
        const placed = origin ? rects.map(({ window, rect }) => ({ window, x: origin.x + rect.x, y: origin.y + rect.y, w: rect.width, h: rect.height })) : [];
        return compositor.windowThumbnails({ rects: placed });
      })
      .catch((error) => console.error("dashi-shell: the switcher's pictures:", error));
  };

  /** The switcher session's own keys come and go with it (keymap.ts `withSwitcher`). */
  const switcherKeys = {
    begin: () => void compositor?.keymap(withSwitcher(currentKeymap())).catch((error) => console.error("dashi-shell: the switcher's keys:", error)),
    end: () => void compositor?.keymap(idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error)),
  };

  controller = compositor
    ? new SwitcherController(
        compositor,
        { show, hide: () => overlays.close("switcher"), pictures },
        (group) => identify({ appId: group.appId, title: group.title, count: group.windows.length, away: false }).name,
        switcherKeys,
        (window) => rankingMemory.opened(installedApp(window.appId)?.id ?? window.appId),
      )
    : null;
  return { controller, show };
}

/**
 * The screen locking takes down everything of ours that is up: the lock screen is the only thing that
 * may be on screen then (Force Quit and the agents' sheets do the same, each in its own place).
 */
export function closeOnLock(
  compositor: Compositor | null,
  { menus, overlays, screenshots }: { menus: Menus; overlays: OverlaySlots<OverlayKind>; screenshots: Screenshots },
  services: Services,
): void {
  const stopClosingOnLock = compositor
    ? compositor.on((event) => {
        if (event.event !== "lock" || !event.locked) return;
        menus.dismissAll();
        overlays.closeAll();
        screenshots.closeArea();
        screenshots.tools?.close();
      })
    : () => {};
  services.add("lock watch", stopClosingOnLock);
}
