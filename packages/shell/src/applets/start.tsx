/**
 * Applets in the shell: everyone's socket (`dashi-applets.sock`), the
 * installed applets in their sandboxes (launcher.ts), the layer-shell grants
 * for popovers (grants.ts), the sheet that catches a click outside an open
 * popover, the consent sheet, and the power mode for applets that ask
 * for it (power.ts). main.tsx starts this once.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appletDataRoot, appletsRoot, appletsSocketPath, type InstalledApplet, type Placement, SDK_VERSION } from "@dashi/applet";
import { View } from "@mirinjs/metal";
import { watchKillSwitch } from "../applet-store/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { screensOf } from "../displays.ts";
import type { ExtrasStore } from "../extras/index.ts";
import type { OpenOverlay } from "../overlay.tsx";
import { APPLET_CONSENT, AppletConsentCard } from "../shared/applet-store/index.ts";
import { METAL_HOST } from "../shared/apps/index.ts";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import type { AppletCommands } from "./commands.ts";
import type { AppletControls } from "./controls.ts";
import { AppletLauncher } from "./launcher.ts";
import type { AppletContext } from "./lib/connection-context.ts";
import { AppletGrants } from "./lib/grants.ts";
import type { PopoverScreen } from "./lib/placement.ts";
import { serveApplets } from "./lib/server.ts";
import type { AppletPopovers } from "./popovers.ts";
import type { AppletPower } from "./power.ts";

export interface StartAppletsOptions {
  compositor: Compositor | null;
  extras: ExtrasStore;
  openOverlay: OpenOverlay;
  /** The primary screen's output name, for a popover asked for without a click. */
  primary(): string | null;
  /** The applets' commands in the launcher (commands.ts): fed the installed ones, answered on their connections. */
  commands?: AppletCommands;
  /** Dashi's power mode for applets with `power.mode` (power.ts); connected to the mode store once the laptop starts. */
  power?: AppletPower;
  /** Applets' controls in Control Center (controls.ts): fed the installed ones, their state from their connections. */
  controls?: AppletControls;
  /** One popover at a time with the shell's menus (popovers.ts). */
  popovers?: AppletPopovers;
}

/** The screen a popover goes on, in points, from the compositor's `outputs`. */
export async function popoverScreen(compositor: Compositor | null, output: string | null, primary: string | null): Promise<PopoverScreen | null> {
  if (!compositor) return { name: null, width: 1280, height: 800, barHeight: MENU_BAR_HEIGHT };
  const screens = screensOf(await compositor.outputs());
  const screen = screens.find((each) => each.name === output) ?? screens.find((each) => each.name === primary) ?? screens[0];
  if (!screen) return null;
  const width = screen.frame?.width ?? Math.round(screen.width / screen.scale);
  const height = screen.frame?.height ?? Math.round(screen.height / screen.scale);
  return { name: screen.name, width, height, barHeight: MENU_BAR_HEIGHT };
}

export function startApplets({ compositor, extras, openOverlay, primary, commands, power, controls, popovers }: StartAppletsOptions): () => void {
  const grants = new AppletGrants(compositor);
  const context: Omit<AppletContext, "installed"> = {
    extras,
    grants,
    ...(commands ? { commands } : {}),
    ...(power ? { power } : {}),
    ...(controls ? { controls } : {}),
    ...(popovers ? { popovers } : {}),
    screen: (output) => popoverScreen(compositor, output, primary()),
    // Under the popover, over everything else below the bar: a click on it closes the popover.
    // The bar stays clickable, so the item again also closes it (connection.ts).
    catcher: (placement: Placement, onOutside: () => void) => {
      const handle = openOverlay(
        {
          title: "Applet popover",
          width: 1,
          height: 1,
          surface: {
            layer: "top",
            anchor: ["top", "bottom", "left", "right"],
            exclusiveZone: -1,
            margin: { top: MENU_BAR_HEIGHT },
            keyboard: "none",
            namespace: "dashi.applet-catcher",
            ...(placement.output === null ? {} : { output: placement.output }),
          },
        },
        <View testID="applet-catcher" style={{ flex: 1, backgroundColor: "#00000000" }} onPress={onOutside} />,
      );
      return () => handle.close();
    },
  };
  const stopEveryone = serveApplets({ ...context, path: appletsSocketPath() });

  const askConsent = (applet: InstalledApplet, update: boolean): Promise<boolean> =>
    new Promise((resolve) => {
      let answered = false;
      const answer = (yes: boolean): void => {
        if (answered) return;
        answered = true;
        handle.close();
        resolve(yes);
      };
      const handle = openOverlay(
        {
          title: "Add applet",
          width: APPLET_CONSENT.width,
          height: APPLET_CONSENT.height,
          // Never the keyboard by itself: a stray Enter typed elsewhere must not answer it.
          surface: { layer: "overlay", keyboard: "on-demand", namespace: "dashi.applet-consent" },
        },
        <AppletConsentCard
          manifest={applet.manifest}
          kind={update ? "update" : "allow"}
          granted={applet.record.consent}
          signed={applet.record.source === "catalog"}
          icon={applet.manifest.icon ? join(applet.dir, applet.manifest.icon) : null}
          onAnswer={answer}
        />,
        () => answer(false),
      );
    });

  const runtime = process.env.XDG_RUNTIME_DIR;
  const launcher = runtime
    ? new AppletLauncher({
        root: appletsRoot(),
        dataRoot: appletDataRoot(),
        runtimeDir: runtime,
        context,
        bun: process.execPath,
        metalHost: METAL_HOST,
        runScript: fileURLToPath(new URL("../../bin/dashi-applet-run.ts", import.meta.url)),
        dashiVersion: SDK_VERSION,
        askConsent,
        onInstalled: (applets: readonly InstalledApplet[]) => {
          commands?.setInstalled(applets);
          controls?.setInstalled(applets);
        },
      })
    : null;
  // A press on the tile of an applet that isn't running starts it.
  if (launcher) controls?.setWake((id) => launcher.wake(id));
  launcher?.start();
  // Pulled versions are turned off even when Software isn't opened.
  const stopKillSwitch = watchKillSwitch();
  return () => {
    stopKillSwitch();
    stopEveryone();
    launcher?.stop();
  };
}
