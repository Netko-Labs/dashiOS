/**
 * How the session looks and idles (main.tsx): the blank-and-sleep clock, the
 * compositor's window chrome, the wallpaper, the pointer, the text size, the
 * input method and X11 scaling, all applied from settings.json.
 */

import { type AppearanceDeps, ChromeStyle, CornerFeed, sessionDeps, WindowStyleSync } from "../appearance/index.ts";
import type { Compositor } from "../compositor/index.ts";
import type { DockPrefs } from "../dock/index.ts";
import { IdlePolicy } from "../idle.ts";
import { InputMethodRunner } from "../input-method.ts";
import { PointerSync } from "../pointer.ts";
import { idleOffReason } from "../power/index.ts";
import { type Settings, startSettings } from "../settings/index.ts";
import { DEFAULT_POINTER_SIZE } from "../shared/appearance/index.ts";
import type { System } from "../system/index.ts";
import { TextSize } from "../text-size.ts";
import { reportWallpaper, type WallpaperChoice, WallpaperSync } from "../wallpaper/index.ts";
import { LiveWallpaperController } from "../wallpaper/live/controller.ts";
import { DEFAULT_X11_SCALING, type XwaylandChoice, type XwaylandScaling } from "../xwayland-scale.ts";
import type { Desktops } from "./desktop.ts";
import type { Services } from "./services.ts";

/** What the settings last said, for the pieces that read it later, and the ones made later. */
export interface LookState {
  /** Settings → Appearance → Reduce Motion, for what the shell itself animates (the Dock's entrance). */
  reduceMotion: boolean;
  wallpaperChoice: WallpaperChoice | null;
  // Live wallpapers (the compositor's shaders and videos) pause by the system store, so their
  // controller starts after it; until then a choice goes to the plain sync (wallpaper/live/).
  liveWallpaper: LiveWallpaperController | null;
  /** What X11 apps hear (xwayland-scale.ts): the settings say it, X11 scaling follows. */
  xwaylandChoice: XwaylandChoice;
  xwaylandScaling: XwaylandScaling | null;
}

export interface Look {
  state: LookState;
  idle: IdlePolicy | null;
  chromeStyle: ChromeStyle | null;
  windowStyle: WindowStyleSync | null;
  gtkCorners: CornerFeed;
  wallpaper: WallpaperSync | null;
  appearanceDeps: AppearanceDeps;
}

/** The pieces settings.json drives. */
interface Applied extends Look {
  pointer: PointerSync | null;
  textSize: TextSize;
  inputMethod: InputMethodRunner | null;
}

/** Idle, the window chrome, the wallpaper, the pointer, the text size and the input method; settings.json applied to them. */
export function startLook(compositor: Compositor | null, desktops: Desktops, dockPrefs: DockPrefs, services: Services): Look {
  const look = makeLook(compositor, services);
  const stopSettings = compositor ? startSettings(compositor, (settings) => applySettings(look, settings, desktops, dockPrefs)) : () => {};
  services.add("settings", stopSettings);
  return look;
}

function makeLook(compositor: Compositor | null, services: Services): Applied {
  // ~/.config/dashi/settings.json: input devices and the layout go to dashi-comp;
  // idle is ours (blank the screens when the user is away), except inside
  // another desktop, whose idle clock keeps the real screen (power/nested.ts).
  const idleOff = idleOffReason();
  if (compositor && idleOff) console.error(`dashi-shell: idle: off (${idleOff}; DASHI_IDLE=1 turns it on)`);
  const idle = compositor && !idleOff ? new IdlePolicy(compositor) : null;
  services.add("idle", () => idle?.stop());
  // How the compositor draws window chrome: Dark Mode's title bars and the
  // Appearance setting's corners, both over IPC `chrome` (appearance/chrome.ts).
  const chromeStyle = compositor ? new ChromeStyle(compositor) : null;
  // The depth between windows: shadows, the hairline, the optional ring (IPC `window-style`; appearance/window-style.ts).
  const windowStyle = compositor ? new WindowStyleSync(compositor) : null;
  // GTK apps round their own windows to the same radius (shared/appearance/gtk-colors.ts).
  const gtkCorners = new CornerFeed();
  // The wallpaper behind the windows and the lock screen (IPC `wallpaper`; wallpaper/).
  const wallpaper = compositor ? new WallpaperSync(compositor) : null;
  const stopWallpaperEvents = compositor?.on((event) => event.event === "wallpaper" && reportWallpaper(event));
  services.add("wallpaper events", () => stopWallpaperEvents?.());
  const state: LookState = {
    reduceMotion: false,
    wallpaperChoice: null,
    liveWallpaper: null,
    xwaylandChoice: { scaling: DEFAULT_X11_SCALING, pointerSize: DEFAULT_POINTER_SIZE },
    xwaylandScaling: null,
  };
  services.add("live wallpaper", () => state.liveWallpaper?.stop());
  // What other apps read about Dark Mode, the font, and the pointer (appearance/, pointer.ts).
  const appearanceDeps = sessionDeps();
  // The pointer's size: the compositor's, GTK's, and X11's (pointer.ts).
  const pointer = compositor ? new PointerSync({ compositor, gate: appearanceDeps.gate, has: appearanceDeps.has, run: appearanceDeps.run }) : null;
  // Text size: the shell's surfaces (through @dashi/ui) and GTK's (text-size.ts).
  const textSize = new TextSize(compositor ? { gate: appearanceDeps.gate, has: appearanceDeps.has, run: appearanceDeps.run } : null).connect();
  // The input method the person picked, run as the shell's own child (input-method.ts); only in a real
  // session, where the shell may change what apps read: a nested run would replace the host's.
  const inputMethod =
    compositor && appearanceDeps.gate.on
      ? new InputMethodRunner({
          has: appearanceDeps.has,
          env: process.env,
          spawn: (command) => {
            const child = Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
            return { exited: child.exited, kill: () => child.kill() };
          },
        })
      : null;
  services.add("input method", () => inputMethod?.stop());
  return { state, idle, chromeStyle, windowStyle, gtkCorners, wallpaper, appearanceDeps, pointer, textSize, inputMethod };
}

/** settings.json, read or changed: every piece it drives follows. */
function applySettings(look: Applied, settings: Settings, desktops: Desktops, dockPrefs: DockPrefs): void {
  const { state, idle, chromeStyle, windowStyle, gtkCorners, wallpaper } = look;
  const { fullscreenDesktops, spaces } = desktops;
  state.reduceMotion = settings.appearance.reduceMotion;
  void look.pointer?.apply(settings.appearance.pointerSize);
  void look.textSize.apply(settings.appearance.textSize);
  look.inputMethod?.apply(settings.inputMethod.engine);
  const choice = { scaling: settings.appearance.x11Apps, pointerSize: settings.appearance.pointerSize };
  if (choice.scaling !== state.xwaylandChoice.scaling || choice.pointerSize !== state.xwaylandChoice.pointerSize) {
    state.xwaylandChoice = choice;
    state.xwaylandScaling?.refresh();
  }
  void idle?.blankAfter(settings.idle.blankAfterSeconds);
  void idle?.sleepAfter(settings.idle.sleepAfterSeconds);
  chromeStyle?.setCorners(settings.appearance.cornerRadius);
  gtkCorners.set(settings.appearance.cornerRadius);
  chromeStyle?.setReduceMotion(settings.appearance.reduceMotion);
  windowStyle?.set({ highlight: settings.appearance.highlightActiveWindow, reduceMotion: settings.appearance.reduceMotion });
  state.wallpaperChoice = settings.appearance.wallpaper;
  if (state.liveWallpaper) state.liveWallpaper.apply(state.wallpaperChoice);
  else wallpaper?.apply(state.wallpaperChoice);
  dockPrefs.apply(settings.dock);
  if (fullscreenDesktops) fullscreenDesktops.enabled = settings.spaces.fullscreenDesktop;
  void spaces?.controller.apply(settings.spaces);
}

/** Live wallpapers, once the system store they pause by is up. */
export function startLiveWallpaper(look: Look, compositor: Compositor | null, system: System): void {
  const { wallpaper, idle, state } = look;
  if (!compositor || !wallpaper) return;
  const controller = new LiveWallpaperController({
    compositor,
    sync: wallpaper,
    battery: () => system.store.getSnapshot().battery,
  });
  state.liveWallpaper = controller;
  if (idle) idle.onBlanked = (blanked) => controller.screensBlanked(blanked);
  system.store.subscribe(() => controller.powerChanged());
  if (state.wallpaperChoice) controller.apply(state.wallpaperChoice);
  void controller.start().catch((error) => console.error("dashi-shell: live wallpapers did not start:", error));
}
