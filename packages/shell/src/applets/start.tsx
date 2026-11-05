/**
 * Applets in the shell: everyone's socket (`dashi-applets.sock`), the
 * installed applets in their sandboxes (launcher.ts), the layer-shell grants
 * for popovers (grants.ts), the sheet that catches a click outside an open
 * popover, and the consent sheet. main.tsx starts this once.
 */

import { SDK_VERSION } from "@dashi/applet";
import { View } from "@mirinjs/metal";
import { METAL_HOST } from "../apps.ts";
import type { Compositor } from "../compositor.ts";
import { parseScreens } from "../displays.ts";
import type { ExtrasStore } from "../extras/index.ts";
import type { OpenOverlay } from "../overlay.tsx";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import type { AppletContext } from "./connection.ts";
import { APPLET_CONSENT, AppletConsentSheet } from "./consent-sheet.tsx";
import { AppletGrants } from "./grants.ts";
import { appletDataRoot, appletsRoot, type InstalledApplet } from "./installed.ts";
import { AppletLauncher } from "./launcher.ts";
import type { PopoverScreen } from "./placement.ts";
import { appletsSocketPath, type Placement } from "./protocol.ts";
import { serveApplets } from "./server.ts";

export interface StartAppletsOptions {
  compositor: Compositor | null;
  extras: ExtrasStore;
  openOverlay: OpenOverlay;
  /** The primary screen's output name, for a popover asked for without a click. */
  primary(): string | null;
}

/** The screen a popover goes on, in points, from the compositor's `outputs`. */
async function popoverScreen(compositor: Compositor | null, output: string | null, primary: string | null): Promise<PopoverScreen | null> {
  if (!compositor) return { name: null, width: 1280, height: 800, barHeight: MENU_BAR_HEIGHT };
  const screens = parseScreens(await compositor.request("outputs"));
  const screen = screens.find((each) => each.name === output) ?? screens.find((each) => each.name === primary) ?? screens[0];
  if (!screen) return null;
  const width = screen.frame?.width ?? Math.round(screen.width / screen.scale);
  const height = screen.frame?.height ?? Math.round(screen.height / screen.scale);
  return { name: screen.name, width, height, barHeight: MENU_BAR_HEIGHT };
}

export function startApplets({ compositor, extras, openOverlay, primary }: StartAppletsOptions): () => void {
  const grants = new AppletGrants(compositor);
  const context: Omit<AppletContext, "installed"> = {
    extras,
    grants,
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
        <AppletConsentSheet manifest={applet.manifest} update={update} onAnswer={answer} />,
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
        runScript: new URL("../../bin/dashi-applet-run.ts", import.meta.url).pathname,
        dashiVersion: SDK_VERSION,
        askConsent,
      })
    : null;
  launcher?.start();
  return () => {
    stopEveryone();
    void launcher?.stop();
  };
}
